import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { addEmailToQueue } from '../queue/email.queue.js';
import { getOrCreateDefaultSender } from '../services/mail.service.js';
import { indexEmail, searchEmails } from '../services/elasticsearch.service.js';

// Grace window for explicit startTime values: allows for request latency / clock skew
// between the client and server without rejecting a timestamp the user genuinely meant
// as "now". Omitting startTime entirely continues to mean "send now" and is unaffected.
const START_TIME_PAST_GRACE_MS = 60 * 1000;

const scheduleSchema = z.object({
  recipients: z.array(z.string().email('Invalid email address')).min(1, 'At least one recipient is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  startTime: z
    .string()
    .optional() // omitted => "send now", always valid
    .refine(
      (val) => {
        if (val === undefined) return true;
        const parsed = new Date(val);
        if (Number.isNaN(parsed.getTime())) return false;
        return parsed.getTime() >= Date.now() - START_TIME_PAST_GRACE_MS;
      },
      {
        message:
          'startTime must be a valid ISO date and must not be in the past (a ~60 second grace window is allowed). Omit startTime entirely to send immediately.',
      }
    ),
  delayBetweenEmails: z.number().min(0).default(2), // in seconds
  hourlyLimit: z.number().min(1).default(200),
  senderId: z.string().optional(),
  userId: z.string().optional(),
});

export async function scheduleEmails(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = scheduleSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.flatten() });
      return;
    }

    const { recipients, subject, body, startTime, delayBetweenEmails, hourlyLimit, senderId, userId } = parseResult.data;

    let defaultSenderInfo: any = null;
    if (!senderId) {
      defaultSenderInfo = await getOrCreateDefaultSender();
    }

    const baseStartTime = startTime ? new Date(startTime) : new Date();
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const createdJobs = [];

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i].trim();
      const targetTime = new Date(baseStartTime.getTime() + i * (delayBetweenEmails * 1000));

      // 1. Create DB record in SCHEDULED status
      const emailRecord = await prisma.emailJob.create({
        data: {
          recipient,
          subject,
          body,
          scheduledAt: targetTime,
          status: 'SCHEDULED',
          batchId,
          delayBetweenEmails,
          hourlyLimit,
          senderId: senderId || undefined,
          userId: userId || undefined,
        },
      });

      // 2. Index in Elasticsearch
      indexEmail({
        id: emailRecord.id,
        recipient: emailRecord.recipient,
        subject: emailRecord.subject,
        body: emailRecord.body,
        status: emailRecord.status,
        senderEmail: defaultSenderInfo?.senderEmail,
        scheduledAt: emailRecord.scheduledAt,
        createdAt: emailRecord.createdAt,
      }).catch((e) => console.warn('ES indexing warning:', e.message));

      // 3. Add to BullMQ with deterministic jobId = emailRecord.id
      await addEmailToQueue(
        {
          emailJobId: emailRecord.id,
          recipient,
          subject,
          body,
          senderId,
          userId,
          delayBetweenEmails,
          hourlyLimit,
        },
        targetTime
      );

      createdJobs.push(emailRecord);
    }

    res.status(201).json({
      success: true,
      message: `Successfully scheduled ${createdJobs.length} email(s)`,
      batchId,
      jobs: createdJobs,
    });
  } catch (error: any) {
    console.error('Error scheduling emails:', error);
    res.status(500).json({ error: 'Failed to schedule emails', message: error.message });
  }
}

export async function getScheduledEmails(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const skip = (page - 1) * limit;

    const where: any = {
      status: {
        in: ['SCHEDULED', 'PROCESSING', 'RATE_LIMITED'],
      },
    };

    if (search) {
      where.OR = [
        { recipient: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [emails, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
        include: { sender: { select: { name: true, email: true } } },
      }),
      prisma.emailJob.count({ where }),
    ]);

    res.json({
      success: true,
      data: emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error fetching scheduled emails:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled emails', message: error.message });
  }
}

export async function getSentEmails(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const skip = (page - 1) * limit;

    const where: any = {
      status: {
        in: ['SENT', 'FAILED'],
      },
    };

    if (search) {
      where.OR = [
        { recipient: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [emails, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: { sender: { select: { name: true, email: true } } },
      }),
      prisma.emailJob.count({ where }),
    ]);

    res.json({
      success: true,
      data: emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error fetching sent emails:', error);
    res.status(500).json({ error: 'Failed to fetch sent emails', message: error.message });
  }
}

export async function searchEmailsHandler(req: Request, res: Response): Promise<void> {
  try {
    const q = req.query.q as string;
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const results = await searchEmails({ query: q, status, page, limit });
    res.json({ success: true, ...results });
  } catch (error: any) {
    console.error('Error in search:', error);
    res.status(500).json({ error: 'Failed to execute search', message: error.message });
  }
}

export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const [scheduled, sent, failed, rateLimited, total] = await Promise.all([
      prisma.emailJob.count({ where: { status: 'SCHEDULED' } }),
      prisma.emailJob.count({ where: { status: 'SENT' } }),
      prisma.emailJob.count({ where: { status: 'FAILED' } }),
      prisma.emailJob.count({ where: { status: 'RATE_LIMITED' } }),
      prisma.emailJob.count(),
    ]);

    res.json({
      success: true,
      stats: {
        scheduled,
        sent,
        failed,
        rateLimited,
        total,
      },
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats', message: error.message });
  }
}

export async function getEmailById(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const email = await prisma.emailJob.findUnique({
      where: { id },
      include: { sender: { select: { name: true, email: true } } },
    });

    if (!email) {
      res.status(404).json({ error: 'Email not found', message: `No email job exists with id ${id}` });
      return;
    }

    res.json({ success: true, data: email });
  } catch (error: any) {
    console.error('Error fetching email by id:', error);
    res.status(500).json({ error: 'Failed to fetch email', message: error.message });
  }
}

export async function getSenders(req: Request, res: Response): Promise<void> {
  try {
    await getOrCreateDefaultSender();
    const senders = await prisma.senderAccount.findMany({
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, senders });
  } catch (error: any) {
    console.error('Error fetching senders:', error);
    res.status(500).json({ error: 'Failed to fetch senders', message: error.message });
  }
}
