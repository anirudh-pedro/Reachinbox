/**
 * Standalone BullMQ worker entrypoint.
 *
 * Use this as the container/process entrypoint when the worker is deployed
 * independently from the Express API (RUN_WORKER_IN_PROCESS=false on the API side).
 * Locally, `npm run dev` still starts the worker inside the API process by default
 * (see src/index.ts) - nothing changes for local development unless you explicitly
 * run `npm run worker` instead.
 *
 * IMPORTANT: this file intentionally duplicates two initialization steps that
 * src/index.ts also performs, because both are process-local state:
 *  - services/slack.service.ts registers an in-memory EventEmitter listener
 *    (rateLimitEvents) for RATE_LIMIT_TRIPPED. If this worker runs in a separate
 *    process from wherever that listener is registered, rate-limit Slack alerts
 *    would silently never fire - no error, just silence. Importing it here makes
 *    the worker self-sufficient regardless of how it's deployed.
 *  - services/elasticsearch.service.ts tracks an `isElasticsearchAvailable` flag
 *    in module-level memory, set only by calling initElasticsearch(). Without
 *    calling it here too, this worker's indexEmail() calls would silently no-op
 *    even if Elasticsearch is healthy.
 */
import './config/env.js';
import dotenv from 'dotenv';
dotenv.config();

import { prisma } from './config/prisma.js';
import { redisConnection } from './config/redis.js';
import { initElasticsearch } from './services/elasticsearch.service.js';
import './services/slack.service.js';
import { emailWorker } from './queue/email.worker.js';

console.log('======================================================');
console.log('👷 ReachInbox standalone worker process starting...');
console.log('======================================================');

initElasticsearch().catch((err: any) => {
  console.warn('⚠️ Elasticsearch init warning (worker):', err.message);
});

let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Worker received ${signal}. Shutting down gracefully...`);

  try {
    await emailWorker.close();
    console.log('✅ BullMQ worker closed (finished in-flight jobs).');
  } catch (err: any) {
    console.error('⚠️ Error closing worker:', err.message);
  }

  try {
    await redisConnection.quit();
    console.log('✅ Redis connection closed.');
  } catch (err: any) {
    console.error('⚠️ Error closing Redis connection:', err.message);
  }

  try {
    await prisma.$disconnect();
    console.log('✅ Prisma disconnected.');
  } catch (err: any) {
    console.error('⚠️ Error disconnecting Prisma:', err.message);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
