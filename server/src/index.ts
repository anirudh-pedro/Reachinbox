import './config/env.js';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import emailRoutes from './routes/email.routes.js';
import slackRoutes from './routes/slack.routes.js';
import { serverAdapter } from './queue/bull-board.js';
import './services/slack.service.js'; // Start Slack event listener (also needed here for the direct testSlackNotification endpoint)
import { getOrCreateDefaultSender } from './services/mail.service.js';
import { initElasticsearch } from './services/elasticsearch.service.js';
import { prisma } from './config/prisma.js';
import { redisConnection } from './config/redis.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Whether this process should also run the BullMQ worker in-process.
// Defaults to true so local `npm run dev` behavior is completely unchanged.
// Set to "false" in production when the worker runs as its own container/process
// (see server/src/worker.ts and docker-compose.prod.yml).
const RUN_WORKER_IN_PROCESS = process.env.RUN_WORKER_IN_PROCESS !== 'false';
let emailWorkerRef: import('bullmq').Worker | null = null;

// CORS: supports one or more allowed origins (comma-separated), e.g. for a Vercel
// frontend URL in production. Falls back to FRONTEND_URL (single origin, existing
// behavior) and then to the local dev default, so no existing deployment breaks.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Middleware
app.use(cors({
  origin(origin, callback) {
    // Allow requests with no Origin header (curl, server-to-server, health checks).
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));
app.use(express.json());

// Bull-Board Queue Dashboard
app.use('/admin/queues', serverAdapter.getRouter());

// API Routes
app.use('/api/emails', emailRoutes);
app.use('/api/auth/slack', slackRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'ReachInbox Scheduler API',
  });
});

// Real dependency health check: verifies PostgreSQL and Redis are actually reachable,
// not just that the HTTP server is up.
app.get('/health', async (req, res) => {
  const dependencies: { postgres: boolean; redis: boolean } = {
    postgres: false,
    redis: false,
  };
  const errors: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    dependencies.postgres = true;
  } catch (err: any) {
    errors.postgres = err.message;
  }

  try {
    const pong = await redisConnection.ping();
    dependencies.redis = pong === 'PONG';
    if (!dependencies.redis) {
      errors.redis = `Unexpected PING response: ${pong}`;
    }
  } catch (err: any) {
    errors.redis = err.message;
  }

  const allHealthy = dependencies.postgres && dependencies.redis;

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    dependencies,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  });
});

// Root endpoint info
app.get('/', (req, res) => {
  res.json({
    message: 'ReachInbox Email Job Scheduler API is running',
    endpoints: {
      health: '/api/health',
      dependencyHealth: '/health',
      emails: '/api/emails',
      slackAuth: '/api/auth/slack',
      queueDashboard: '/admin/queues',
    },
  });
});

// Start Server
const server = app.listen(Number(PORT), HOST, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  console.log(`📊 Bull-Board Queue Dashboard: http://${HOST}:${PORT}/admin/queues`);
  console.log(`📧 API Base: http://${HOST}:${PORT}/api/emails`);
  console.log(`🔔 Slack API: http://${HOST}:${PORT}/api/auth/slack`);
  console.log(`🌐 CORS allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`👷 Worker running in this process: ${RUN_WORKER_IN_PROCESS}`);
  console.log(`======================================================\n`);

  try {
    await getOrCreateDefaultSender();
  } catch (err: any) {
    console.warn('⚠️ Could not initialize default Ethereal sender on boot:', err.message);
  }

  // Initialize Elasticsearch
  try {
    await initElasticsearch();
  } catch (err: any) {
    console.warn('⚠️ Elasticsearch init warning:', err.message);
  }

  // Optionally start the BullMQ worker in this same process (local dev default).
  // In production, the worker typically runs as its own container with
  // RUN_WORKER_IN_PROCESS=false here and server/src/worker.ts as its entrypoint.
  if (RUN_WORKER_IN_PROCESS) {
    try {
      const workerModule = await import('./queue/email.worker.js');
      emailWorkerRef = workerModule.emailWorker;
    } catch (err: any) {
      console.error('❌ Failed to start in-process worker:', err.message);
    }
  }
});

// Graceful shutdown: stop accepting new HTTP connections, let in-flight requests
// finish, close the BullMQ worker (if running here) so it stops picking up new jobs
// and finishes any job it's mid-processing, then close DB/Redis connections.
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  server.close(() => {
    console.log('✅ HTTP server closed (no longer accepting new connections).');
  });

  try {
    if (emailWorkerRef) {
      await emailWorkerRef.close();
      console.log('✅ BullMQ worker closed.');
    }
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
