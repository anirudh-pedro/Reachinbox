export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RATE_LIMITED';

export interface EmailJob {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt?: string | null;
  jobId?: string | null;
  batchId?: string | null;
  delayBetweenEmails?: number;
  hourlyLimit?: number;
  etherealPreviewUrl?: string | null;
  etherealMessageId?: string | null;
  error?: string | null;
  attempts?: number;
  createdAt: string;
  updatedAt: string;
  sender?: {
    name: string;
    email: string;
  } | null;
}

export interface SenderAccount {
  id: string;
  name: string;
  email: string;
  host: string;
  port: number;
  hourlyLimit: number;
  delaySeconds: number;
  isDefault: boolean;
}

export interface Stats {
  scheduled: number;
  sent: number;
  failed: number;
  rateLimited: number;
  total: number;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channel?: string;
  connectedAt?: string;
}

export interface User {
  name: string;
  email: string;
  avatar: string;
}
