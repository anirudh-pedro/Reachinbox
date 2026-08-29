import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import emailRoutes from './routes/email.routes.js';
import slackRoutes from './routes/slack.routes.js';
import { serverAdapter } from './queue/bull-board.js';
import './queue/email.worker.js'; // Start worker process
import './services/slack.service.js'; // Start Slack event listener
import { getOrCreateDefaultSender } from './services/mail.service.js';
import { initElasticsearch } from './services/elasticsearch.service.js';
import { prisma } from './config/prisma.js';
import { redisConnection } from './config/redis.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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
app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Bull-Board Queue Dashboard: http://localhost:${PORT}/admin/queues`);
  console.log(`📧 API Base: http://localhost:${PORT}/api/emails`);
  console.log(`🔔 Slack API: http://localhost:${PORT}/api/auth/slack`);
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
});
