import { Redis, RedisOptions } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const isTest = process.env.NODE_ENV === 'test' || process.argv.some((arg) => arg.includes('test'));

export const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: isTest,
  retryStrategy(times) {
    if (isTest) return null; // Do not reconnect infinitely during tests
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
};

export const redisConnection = new Redis(redisConfig);

if (!isTest) {
  redisConnection.on('connect', () => {
    console.log('⚡ Connected to Redis successfully');
  });

  redisConnection.on('error', (err) => {
    console.error('❌ Redis Connection Error:', err.message);
  });
}
