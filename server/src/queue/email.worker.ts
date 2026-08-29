import { Worker, Job } from 'bullmq';
import { redisConfig } from '../config/redis.js';
import { prisma } from '../config/prisma.js';
import { sendEmail } from '../services/mail.service.js';
import { EMAIL_QUEUE_NAME, EmailJobData, addEmailToQueue } from './email.queue.js';
import {
  checkAndIncrementHourlyLimit,
  enforcePerSenderDelay,
  rateLimitEvents,
} from '../services/rate-limiter.service.js';
import { indexEmail } from '../services/elasticsearch.service.js';
import { Redis } from 'ioredis';

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
const MAX_ATTEMPTS = 3; // keep in sync with emailQueue's defaultJobOptions.attempts in email.queue.ts
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
      return;
    }

    if (emailRecord.status === 'SENT') {
      console.log(`✨ [Worker] Email ${emailJobId} is already marked as SENT. Skipping.`);
      return;
    }

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
      console.log(`⏳ Rescheduling email ${emailJobId} to next window at ${rateLimitCheck.nextHourTimestamp.toISOString()} (delay: ${rateLimitCheck.delayUntilNextHourMs}ms)`);

      // Update DB to RATE_LIMITED status with new scheduledAt timestamp
      await prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status: 'RATE_LIMITED',
          scheduledAt: rateLimitCheck.nextHourTimestamp,
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
        scheduledAt: rateLimitCheck.nextHourTimestamp,
        createdAt: emailRecord.createdAt,
      }).catch((e) => console.warn('ES indexing warning:', e.message));

      // Emit event for Slack notification (Phase 3)
      rateLimitEvents.emit('RATE_LIMIT_TRIPPED', {
        senderId: effectiveSenderId,
        senderEmail: emailRecord.sender?.email || 'default@reachinbox.test',
        userId: userId || emailRecord.userId,
        hourlyLimit: effectiveHourlyLimit,
        currentCount: rateLimitCheck.currentCount,
        emailJobId,
        nextHourTimestamp: rateLimitCheck.nextHourTimestamp,
      });

      // Reschedule into next window (DO NOT DROP OR PERMANENTLY FAIL)
      await addEmailToQueue(job.data, rateLimitCheck.nextHourTimestamp);

      return {
        rateLimited: true,
        rescheduledTo: rateLimitCheck.nextHourTimestamp,
        message: 'Rate limit reached. Rescheduled to next hour window.',
      };
    }

    // Update status to PROCESSING
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'PROCESSING' },
    });

    try {
      // 3. Enforce Inter-send Throttle per sender across all concurrent workers
      await enforcePerSenderDelay(effectiveSenderId, effectiveDelaySeconds);

      // 4. Send via Ethereal SMTP
      const result = await sendEmail({
        to: recipient,
        subject,
        body,
        senderId: effectiveSenderId !== 'default' ? effectiveSenderId : undefined,
      });

      // 5. Mark as SENT in DB
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

      // 6. Update document in Elasticsearch
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
      // job.attemptsMade counts attempts completed BEFORE the current one (0 on the
      // first run of this handler) and BullMQ only increments it after this handler
      // throws (see bullmq's Job.moveToFailed / shouldRetryJob: it decides whether to
      // retry via `attemptsMade + 1 < opts.attempts` BEFORE bumping attemptsMade).
      // So "is this the last attempt BullMQ will make" is exactly
      // (attemptsMade + 1) >= MAX_ATTEMPTS - verified against the installed bullmq
      // source rather than assumed.
      const currentAttemptNumber = job.attemptsMade + 1;
      const isFinalAttempt = currentAttemptNumber >= MAX_ATTEMPTS;

      console.error(
        `❌ [Worker] Failed to send email ${emailJobId} (attempt ${currentAttemptNumber}/${MAX_ATTEMPTS}):`,
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

        // Update in Elasticsearch
        indexEmail({
          id: emailJobId,
          recipient,
          subject,
          body,
          status: 'FAILED',
          senderEmail: emailRecord.sender?.email,
          scheduledAt: emailRecord.scheduledAt,
          createdAt: emailRecord.createdAt,
        }).catch((e) => console.warn('ES indexing warning:', e.message));
      } else {
        console.warn(`🔁 [Worker] Email ${emailJobId} will be retried by BullMQ (attempt ${currentAttemptNumber} of ${MAX_ATTEMPTS} failed).`);

        // Record the error and bump the attempts counter for visibility, but do not
        // flip status to a terminal FAILED state - BullMQ is about to retry this job
        // per its configured backoff, so the row should not look permanently dead.
        // Status stays PROCESSING (already set above) until the next attempt or
        // final failure updates it.
        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            error: err.message,
            attempts: { increment: 1 },
          },
        });
      }

      throw err;
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
