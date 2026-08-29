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

export async function addEmailToQueue(jobData: EmailJobData, scheduledAt: Date): Promise<string> {
  const now = Date.now();
  const targetTime = new Date(scheduledAt).getTime();
  const delay = Math.max(0, targetTime - now);

  const job = await emailQueue.add('send-email', jobData, {
    jobId: jobData.emailJobId, // Deterministic ID for idempotency & restart persistence
    delay,
  });

  // Update DB record with job ID
  await prisma.emailJob.update({
    where: { id: jobData.emailJobId },
    data: { jobId: job.id },
  });

  console.log(`⏱️ Enqueued email ${jobData.emailJobId} to ${jobData.recipient} with delay: ${delay}ms (run at ${new Date(targetTime).toISOString()})`);

  return job.id!;
}
