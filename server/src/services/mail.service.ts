import nodemailer, { Transporter } from 'nodemailer';
import { prisma } from '../config/prisma.js';

interface SendMailParams {
  to: string;
  subject: string;
  body: string;
  senderId?: string;
}

interface SendMailResult {
  messageId: string;
  previewUrl: string | false;
  senderEmail: string;
}

let defaultTransporter: Transporter | null = null;
let defaultSenderEmail = '';

export async function getOrCreateDefaultSender(): Promise<{ transporter: Transporter; senderEmail: string }> {
  if (defaultTransporter) {
    return { transporter: defaultTransporter, senderEmail: defaultSenderEmail };
  }

  // Check if default sender exists in DB
  let sender = await prisma.senderAccount.findFirst({
    where: { isDefault: true },
  });

  if (!sender) {
    let testUser = 'demo.reachinbox@ethereal.email';
    let testPass = 'ethereal_demo_pass_123';

    try {
      console.log('📬 Creating new Ethereal test account...');
      const testAccount = await nodemailer.createTestAccount();
      testUser = testAccount.user;
      testPass = testAccount.pass;
    } catch (err: any) {
      console.warn('⚠️ Could not connect to Ethereal API to create account, using fallback credentials:', err.message);
    }

    sender = await prisma.senderAccount.create({
      data: {
        name: 'ReachInbox Demo Sender',
        email: testUser,
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        user: testUser,
        pass: testPass,
        hourlyLimit: 200,
        delaySeconds: 2,
        isDefault: true,
      },
    });

    console.log(`✅ Created default Ethereal sender: ${sender.email}`);
  }

  defaultSenderEmail = sender.email;
  defaultTransporter = nodemailer.createTransport({
    host: sender.host,
    port: sender.port,
    secure: sender.secure,
    auth: {
      user: sender.user,
      pass: sender.pass,
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  });

  return { transporter: defaultTransporter, senderEmail: defaultSenderEmail };
}

export async function getTransporterForSender(senderId?: string): Promise<{ transporter: Transporter; senderEmail: string; senderName: string }> {
  if (!senderId) {
    const { transporter, senderEmail } = await getOrCreateDefaultSender();
    return { transporter, senderEmail, senderName: 'ReachInbox Mailer' };
  }

  const sender = await prisma.senderAccount.findUnique({
    where: { id: senderId },
  });

  if (!sender) {
    const { transporter, senderEmail } = await getOrCreateDefaultSender();
    return { transporter, senderEmail, senderName: 'ReachInbox Mailer' };
  }

  const transporter = nodemailer.createTransport({
    host: sender.host,
    port: sender.port,
    secure: sender.secure,
    auth: {
      user: sender.user,
      pass: sender.pass,
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  });

  return {
    transporter,
    senderEmail: sender.email,
    senderName: sender.name,
  };
}

export async function sendEmail({ to, subject, body, senderId }: SendMailParams): Promise<SendMailResult> {
  const { transporter, senderEmail, senderName } = await getTransporterForSender(senderId);

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject,
      text: body,
      html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">${body.replace(/\n/g, '<br/>')}</div>`,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    console.log(`📧 Email sent to ${to} | ID: ${info.messageId} | Preview: ${previewUrl || 'N/A'}`);

    return {
      messageId: info.messageId,
      previewUrl,
      senderEmail,
    };
  } catch (err: any) {
    // Real SMTP failure (auth error, connection reset, timeout, etc). Do not fabricate a
    // fake success here - propagate the error so the worker can record a genuine FAILED
    // state and let BullMQ's retry policy decide whether to try again.
    console.error(`❌ SMTP send failed for ${to}:`, err.message);
    throw err;
  }
}
