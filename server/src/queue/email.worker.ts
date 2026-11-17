import { Worker, Job } from 'bullmq';
import { redisConfig } from '../config/redis.js';
import { prisma } from '../config/prisma.js';
import { sendEmail } from '../services/mail.service.js';
import { EMAIL_QUEUE_NAME, EmailJobData, addEmailToQueue } from './email.queue.js';
import {
  checkAndIncrementHourlyLimit,
  checkSenderDelayThrottle,
  getNextHourStaggeredTimestamp,
  rateLimitEvents,
} from '../services/rate-limiter.service.js';
import { indexEmail } from '../services/elasticsearch.service.js';
import { Redis } from 'ioredis';

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
const MAX_ATTEMPTS = 3; // Keep in sync with emailQueue's defaultJobOptions.attempts in email.queue.ts
const workerRedis = new Redis(redisConfig);

export const emailWorker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobData>) => {
    const { emailJobId, recipient, subject, body, senderId, userId, delayBetweenEmails, hourlyLimit } = job.data;
    console.log(`\n🚀 [Worker] Processing email job ${job.id} for ${recipient}...`);

    // 1. Idempotency Check in Database
    const emailRecord = await prisma.emailJob.findUnique({
      where: { id: emailJobId },
      include: { sender: true },
    });

    if (!emailRecord) {
      console.warn(`⚠️ [Worker] Email record ${emailJobId} not found in DB. Skipping.`);
      return { skipped: true, reason: 'Record not found' };
    }

    if (emailRecord.status === 'SENT') {
      console.log(`✨ [Worker] Email ${emailJobId} is already marked as SENT. Skipping.`);
      return { skipped: true, reason: 'Already sent' };
    }

    if (emailRecord.status === 'FAILED') {
      console.warn(`🛑 [Worker] Email ${emailJobId} is permanently marked as FAILED. Skipping.`);
      return { skipped: true, reason: 'Permanently failed' };
    }

    // Versioning Check: If the DB's active jobId belongs to a newer execution, this job is stale
    if (emailRecord.jobId && emailRecord.jobId !== job.id) {
      console.warn(
        `🔁 [Worker] Job ${job.id} has been superseded by newer queue execution ${emailRecord.jobId}. Skipping.`
      );
      return { skipped: true, reason: 'Superseded by newer queue execution' };
    }

    // Distributed Lock per logical EmailJob ID to prevent concurrent worker execution
    const lockKey = `lock:email:${emailJobId}`;
    const acquiredLock = await workerRedis.set(lockKey, job.id!, 'PX', 60000, 'NX');
    if (!acquiredLock) {
      console.warn(`🔒 [Worker] Email ${emailJobId} is currently being processed by another worker. Skipping.`);
      return { skipped: true, reason: 'Locked by concurrent worker' };
    }

    try {
      const effectiveSenderId = senderId || emailRecord.senderId || 'default';
      const effectiveHourlyLimit = hourlyLimit || emailRecord.hourlyLimit || emailRecord.sender?.hourlyLimit || 200;
      const effectiveDelaySeconds =
        delayBetweenEmails !== undefined
          ? delayBetweenEmails
          : emailRecord.delayBetweenEmails ?? emailRecord.sender?.delaySeconds ?? 2;

      // 2. Atomic Hourly Rate Limit Check
      const rateLimitCheck = await checkAndIncrementHourlyLimit(effectiveSenderId, effectiveHourlyLimit);

      if (!rateLimitCheck.allowed) {
        console.warn(
          `🚨 [Worker] Rate limit REACHED for sender ${effectiveSenderId} (${rateLimitCheck.currentCount}/${effectiveHourlyLimit} this hour).`
        );

        // Staggered order-preserving schedule time in the next hour
        const nextHourTimestamp = await getNextHourStaggeredTimestamp(effectiveSenderId, effectiveDelaySeconds);
        const nextRescheduleCount = (job.data.rescheduleCount || 0) + 1;
        const newQueueJobId = `${emailJobId}:rate_limit:${nextRescheduleCount}`;

        console.log(
          `⏳ Rescheduling email ${emailJobId} to next window at ${nextHourTimestamp.toISOString()} with new jobId: ${newQueueJobId}`
        );

        // Update DB to RATE_LIMITED status with new scheduledAt timestamp and new queue jobId
        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'RATE_LIMITED',
            scheduledAt: nextHourTimestamp,
            jobId: newQueueJobId,
          },
        });

        // Update in Elasticsearch
        indexEmail({
          id: emailJobId,
          recipient,
          subject,
          body,
          status: 'RATE_LIMITED',
          senderEmail: emailRecord.sender?.email,
          scheduledAt: nextHourTimestamp,
          createdAt: emailRecord.createdAt,
        }).catch((e) => console.warn('ES indexing warning:', e.message));

        // Emit Slack alert ONLY on the first time the limit was tripped in this window
        if (rateLimitCheck.shouldAlert) {
          console.log(`🔔 [Worker] Triggering Slack rate-limit alert for sender ${effectiveSenderId}...`);
          rateLimitEvents.emit('RATE_LIMIT_TRIPPED', {
            senderId: effectiveSenderId,
            senderEmail: emailRecord.sender?.email || 'default@reachinbox.test',
            userId: userId || emailRecord.userId,
            hourlyLimit: effectiveHourlyLimit,
            currentCount: rateLimitCheck.currentCount,
            emailJobId,
            nextHourTimestamp,
          });
        } else {
          console.log(`ℹ️ [Worker] Rate limit alert already sent for sender ${effectiveSenderId} in this window.`);
        }

        // Reschedule into next window with new deterministic execution ID (NEVER DROPPED)
        await addEmailToQueue(
          { ...job.data, rescheduleCount: nextRescheduleCount },
          nextHourTimestamp,
          newQueueJobId
        );

        return {
          rateLimited: true,
          rescheduledTo: nextHourTimestamp,
          newJobId: newQueueJobId,
          message: 'Rate limit reached. Rescheduled to next hour window.',
        };
      }

      // 3. Atomic Per-Sender Inter-Send Delay Throttle
      const throttleCheck = await checkSenderDelayThrottle(effectiveSenderId, effectiveDelaySeconds);
      if (!throttleCheck.allowed) {
        if (throttleCheck.waitMs > 150) {
          // If wait time is substantial, reschedule via BullMQ rather than blocking worker thread
          const nextRescheduleCount = (job.data.rescheduleCount || 0) + 1;
          const newQueueJobId = `${emailJobId}:throttle:${nextRescheduleCount}`;

          console.log(
            `⏱️ [Worker] Inter-send throttle: spacing sender ${effectiveSenderId} by ${throttleCheck.waitMs}ms. Rescheduling via BullMQ (new jobId: ${newQueueJobId}).`
          );

          await prisma.emailJob.update({
            where: { id: emailJobId },
            data: {
              scheduledAt: throttleCheck.targetTimestamp,
              jobId: newQueueJobId,
            },
          });

          await addEmailToQueue(
            { ...job.data, rescheduleCount: nextRescheduleCount },
            throttleCheck.targetTimestamp,
            newQueueJobId
          );

          return {
            throttled: true,
            rescheduledTo: throttleCheck.targetTimestamp,
            newJobId: newQueueJobId,
          };
        } else if (throttleCheck.waitMs > 0) {
          // Very short micro-delay (< 150ms) can be waited directly without queue overhead
          await new Promise((resolve) => setTimeout(resolve, throttleCheck.waitMs));
        }
      }

      // 4. Update status to PROCESSING atomically
      await prisma.emailJob.updateMany({
        where: {
          id: emailJobId,
          status: { in: ['SCHEDULED', 'RATE_LIMITED', 'PROCESSING'] },
        },
        data: { status: 'PROCESSING' },
      });

      // 5. Send via Ethereal SMTP
      const result = await sendEmail({
        to: recipient,
        subject,
        body,
        senderId: effectiveSenderId !== 'default' ? effectiveSenderId : undefined,
      });

      // 6. Mark as SENT in DB
      const updated = await prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          etherealPreviewUrl: result.previewUrl || null,
          etherealMessageId: result.messageId,
          error: null,
        },
      });

      // 7. Update document in Elasticsearch
      indexEmail({
        id: emailJobId,
        recipient,
        subject,
        body,
        status: 'SENT',
        senderEmail: result.senderEmail,
        scheduledAt: updated.scheduledAt,
        sentAt: updated.sentAt,
        etherealPreviewUrl: result.previewUrl || null,
        createdAt: updated.createdAt,
      }).catch((e) => console.warn('ES indexing warning:', e.message));

      console.log(`✅ [Worker] Email ${emailJobId} successfully SENT!`);
      if (result.previewUrl) {
        console.log(`🔗 [Worker] Ethereal Preview URL: ${result.previewUrl}`);
      }

      return {
        success: true,
        emailJobId: updated.id,
        previewUrl: result.previewUrl,
        sentAt: updated.sentAt,
      };
    } catch (err: any) {
      const currentAttemptNumber = job.attemptsMade + 1;
      const isFinalAttempt = currentAttemptNumber >= MAX_ATTEMPTS;

      console.error(
        `❌ [Worker] Failed to process email ${emailJobId} (attempt ${currentAttemptNumber}/${MAX_ATTEMPTS}):`,
        err.message
      );

      if (isFinalAttempt) {
        console.error(`💀 [Worker] Email ${emailJobId} has exhausted all ${MAX_ATTEMPTS} attempts. Marking FAILED.`);

        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'FAILED',
            error: err.message,
            attempts: { increment: 1 },
          },
        });

        indexEmail({
          id: emailJobId,
          recipient,
          subject,
          body,
          status: 'FAILED',
          scheduledAt: emailRecord.scheduledAt,
          createdAt: emailRecord.createdAt,
        }).catch((e) => console.warn('ES indexing warning:', e.message));
      } else {
        console.warn(
          `🔁 [Worker] Email ${emailJobId} will be retried by BullMQ (attempt ${currentAttemptNumber} of ${MAX_ATTEMPTS} failed).`
        );

        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            error: err.message,
            attempts: { increment: 1 },
          },
        });
      }

      throw err;
    } finally {
      // Release distributed lock
      try {
        await workerRedis.del(lockKey);
      } catch (e: any) {
        console.warn(`⚠️ [Worker] Failed to release lock ${lockKey}:`, e.message);
      }
    }
  },
  {
    connection: workerRedis,
    concurrency,
  }
);

console.log(`👷 [Worker] Email worker started | queue: "${EMAIL_QUEUE_NAME}" | concurrency: ${concurrency}`);

emailWorker.on('completed', (job) => {
  console.log(`🎉 Job ${job.id} has completed successfully.`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`💥 Job ${job?.id} failed with error:`, err.message);
});

emailWorker.on('error', (err) => {
  console.error('💥 Worker internal error:', err.message);
});
