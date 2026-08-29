import { EventEmitter } from 'events';
import { redisConnection } from '../config/redis.js';

export const rateLimitEvents = new EventEmitter();

// Lua script to atomically check and increment hourly rate limits
const CHECK_AND_INCREMENT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2]) or 7200

local current = tonumber(redis.call('get', key) or '0')

if current < limit then
  local next_val = redis.call('incr', key)
  if next_val == 1 then
    redis.call('expire', key, ttl)
  end
  return { 1, next_val } -- { 1 = allowed, current count }
else
  return { 0, current } -- { 0 = rate limit reached, current count }
end
`;

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  delayUntilNextHourMs: number;
  nextHourTimestamp: Date;
}

export function getHourKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  return `${y}${m}${d}${h}`;
}

export function getMillisecondsUntilNextHour(now: Date = new Date()): { delayMs: number; nextHour: Date } {
  const nextHour = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() + 1,
      0,
      2, // 2 seconds into next hour to avoid boundary race
      0
    )
  );
  const delayMs = Math.max(1000, nextHour.getTime() - now.getTime());
  return { delayMs, nextHour };
}

/**
 * Checks and increments the hourly rate limit atomically in Redis.
 */
export async function checkAndIncrementHourlyLimit(
  senderId: string = 'default',
  limit: number = 200
): Promise<RateLimitCheckResult> {
  const hourKey = getHourKey();
  const redisKey = `ratelimit:emails:${senderId}:${hourKey}`;
  const { delayMs, nextHour } = getMillisecondsUntilNextHour();

  // Execute atomic Lua script
  const result = (await redisConnection.eval(
    CHECK_AND_INCREMENT_LUA,
    1,
    redisKey,
    limit.toString(),
    '7200'
  )) as [number, number];

  const allowed = result[0] === 1;
  const currentCount = result[1];

  return {
    allowed,
    currentCount,
    limit,
    delayUntilNextHourMs: delayMs,
    nextHourTimestamp: nextHour,
  };
}

/**
 * Enforces a minimum delay between consecutive sends per sender across all concurrent workers.
 */
export async function enforcePerSenderDelay(senderId: string = 'default', minDelaySeconds: number = 2): Promise<void> {
  if (minDelaySeconds <= 0) return;

  const minDelayMs = minDelaySeconds * 1000;
  const throttleKey = `throttle:last_send:${senderId}`;

  // Acquire lock/last send timestamp
  const now = Date.now();
  const lastSendStr = await redisConnection.get(throttleKey);

  if (lastSendStr) {
    const lastSend = parseInt(lastSendStr, 10);
    const elapsed = now - lastSend;
    if (elapsed < minDelayMs) {
      const waitTime = minDelayMs - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  // Update last send timestamp with TTL
  await redisConnection.set(throttleKey, Date.now().toString(), 'PX', Math.max(minDelayMs * 2, 10000));
}

/**
 * Resets rate limit counters for testing purposes
 */
export async function resetSenderRateLimit(senderId: string = 'default'): Promise<void> {
  const hourKey = getHourKey();
  const redisKey = `ratelimit:emails:${senderId}:${hourKey}`;
  await redisConnection.del(redisKey);
  await redisConnection.del(`throttle:last_send:${senderId}`);
}
