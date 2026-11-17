/**
 * Development seed script: Provisions multiple Ethereal SMTP sender accounts
 * in PostgreSQL with distinct hourly limits and delay configurations.
 * Run with: npm run seed:senders
 */
import nodemailer from 'nodemailer';
import { prisma } from '../config/prisma.js';

interface SenderSeedConfig {
  name: string;
  hourlyLimit: number;
  delaySeconds: number;
  isDefault: boolean;
}

const SENDERS_TO_SEED: SenderSeedConfig[] = [
  {
    name: 'Growth Outreach (Strict Limit: 5/hr)',
    hourlyLimit: 5, // Low limit for easy demonstration of rate limiting & Slack alerts
    delaySeconds: 2,
    isDefault: true,
  },
  {
    name: 'Sales Team (Limit: 50/hr)',
    hourlyLimit: 50,
    delaySeconds: 3,
    isDefault: false,
  },
  {
    name: 'Customer Success (Limit: 200/hr)',
    hourlyLimit: 200,
    delaySeconds: 1,
    isDefault: false,
  },
];

async function seedSenders() {
  console.log('🌱 Starting Ethereal multi-sender seed...');

  for (const config of SENDERS_TO_SEED) {
    try {
      console.log(`\n📬 Requesting new Ethereal test account for "${config.name}"...`);
      const testAccount = await nodemailer.createTestAccount();

      const existing = await prisma.senderAccount.findFirst({
        where: { name: config.name },
      });

      if (existing) {
        const updated = await prisma.senderAccount.update({
          where: { id: existing.id },
          data: {
            email: testAccount.user,
            user: testAccount.user,
            pass: testAccount.pass,
            hourlyLimit: config.hourlyLimit,
            delaySeconds: config.delaySeconds,
            isDefault: config.isDefault,
          },
        });
        console.log(`✅ Updated existing sender: ${updated.name} (${updated.email})`);
      } else {
        const created = await prisma.senderAccount.create({
          data: {
            name: config.name,
            email: testAccount.user,
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            user: testAccount.user,
            pass: testAccount.pass,
            hourlyLimit: config.hourlyLimit,
            delaySeconds: config.delaySeconds,
            isDefault: config.isDefault,
          },
        });
        console.log(`✅ Created sender: ${created.name} (${created.email})`);
        console.log(`   - Hourly Limit: ${created.hourlyLimit} emails/hr`);
        console.log(`   - Minimum Delay: ${created.delaySeconds}s`);
      }
    } catch (err: any) {
      console.error(`❌ Failed to seed sender "${config.name}":`, err.message);
    }
  }

  const allSenders = await prisma.senderAccount.findMany({
    select: { id: true, name: true, email: true, hourlyLimit: true, delaySeconds: true, isDefault: true },
  });

  console.log('\n======================================================');
  console.log(`🎉 Seeding complete. Total senders in database: ${allSenders.length}`);
  console.table(allSenders);
  console.log('======================================================\n');

  await prisma.$disconnect();
}

seedSenders().catch(async (e) => {
  console.error('Fatal seed error:', e);
  await prisma.$disconnect();
  process.exit(1);
});

