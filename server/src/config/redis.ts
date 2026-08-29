import { Redis, RedisOptions } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

export const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
};

export const redisConnection = new Redis(redisConfig);

redisConnection.on('connect', () => {
  console.log('⚡ Connected to Redis successfully');
});

redisConnection.on('error', (err) => {
  console.error('❌ Redis Connection Error:', err.message);
});
