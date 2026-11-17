import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { prisma } from '../config/prisma.js';

export const EMAIL_QUEUE_NAME = 'email-send-queue';

export interface EmailJobData {
  emailJobId: string;
  recipient: string;
  subject: string;
  body: string;
  senderId?: string;
  userId?: string;
  delayBetweenEmails?: number;
  hourlyLimit?: number;
  rescheduleCount?: number;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 2000,
    removeOnFail: 5000,
  },
});

/**
 * Adds an email job to BullMQ delayed queue with support for deterministic versioned IDs.
 * Used for both initial scheduling and subsequent rate-limit or throttle rescheduling.
 */
export async function addEmailToQueue(
  jobData: EmailJobData,
  scheduledAt: Date,
  customJobId?: string
): Promise<string> {
  const now = Date.now();
  const targetTime = new Date(scheduledAt).getTime();
  const delay = Math.max(0, targetTime - now);
  const queueJobId = customJobId || jobData.emailJobId;

  // Check if a job with this exact execution ID already exists in delayed/waiting state
  const existingJob = await emailQueue.getJob(queueJobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'delayed' || state === 'waiting' || state === 'active') {
      console.log(`ℹ️ [Queue] Job ${queueJobId} is already in state '${state}'. Skipping duplicate add.`);
      return existingJob.id!;
    }
  }

  const job = await emailQueue.add('send-email', jobData, {
    jobId: queueJobId,
    delay,
  });

  // Update DB record with latest active queue execution ID
  await prisma.emailJob.update({
    where: { id: jobData.emailJobId },
    data: { jobId: job.id },
  });

  console.log(
    `⏱️ [Queue] Enqueued email ${jobData.emailJobId} (jobId: ${job.id}) to ${jobData.recipient} with delay: ${delay}ms (scheduled for ${new Date(targetTime).toISOString()})`
  );

  return job.id!;
}
