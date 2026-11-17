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

const transporterCache = new Map<string, { transporter: Transporter; senderEmail: string; senderName: string }>();

export async function getOrCreateDefaultSender(): Promise<{ transporter: Transporter; senderEmail: string; senderName: string }> {
  const cached = transporterCache.get('default');
  if (cached) {
    return cached;
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
        hourlyLimit: parseInt(process.env.DEFAULT_MAX_HOURLY_LIMIT || '200', 10),
        delaySeconds: parseInt(process.env.DEFAULT_MIN_DELAY_SECONDS || '2', 10),
        isDefault: true,
      },
    });

    console.log(`✅ Created default Ethereal sender: ${sender.email}`);
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

  const entry = {
    transporter,
    senderEmail: sender.email,
    senderName: sender.name,
  };

  transporterCache.set('default', entry);
  transporterCache.set(sender.id, entry);

  return entry;
}

export async function getTransporterForSender(senderId?: string): Promise<{ transporter: Transporter; senderEmail: string; senderName: string }> {
  if (!senderId) {
    return getOrCreateDefaultSender();
  }

  const cached = transporterCache.get(senderId);
  if (cached) {
    return cached;
  }

  const sender = await prisma.senderAccount.findUnique({
    where: { id: senderId },
  });

  if (!sender) {
    return getOrCreateDefaultSender();
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

  const entry = {
    transporter,
    senderEmail: sender.email,
    senderName: sender.name,
  };

  transporterCache.set(sender.id, entry);
  return entry;
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
    console.error(`❌ SMTP send failed for ${to}:`, err.message);
    throw err;
  }
}
