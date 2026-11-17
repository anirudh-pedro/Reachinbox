import { EventEmitter } from 'events';
import { redisConnection } from '../config/redis.js';

export const rateLimitEvents = new EventEmitter();

// Lua script to atomically check and increment hourly rate limits
// Keys:
//   KEYS[1] = ratelimit:emails:<senderId>:<hourKey>
//   KEYS[2] = ratelimit:alert:<senderId>:<hourKey>
// Args:
//   ARGV[1] = limit
//   ARGV[2] = ttl (seconds)
const CHECK_AND_INCREMENT_HOURLY_LUA = `
local counterKey = KEYS[1]
local alertKey = KEYS[2]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2]) or 7200

local current = tonumber(redis.call('get', counterKey) or '0')

if current < limit then
  local nextVal = redis.call('incr', counterKey)
  if nextVal == 1 then
    redis.call('expire', counterKey, ttl)
  end
  return { 1, nextVal, 0 } -- { 1 = allowed, current count, shouldAlert = 0 }
else
  -- Limit reached or exceeded
  local alerted = redis.call('get', alertKey)
  local shouldAlert = 0
  if not alerted then
    redis.call('set', alertKey, '1', 'EX', ttl)
    shouldAlert = 1
  end
  return { 0, current, shouldAlert } -- { 0 = rate limited, current count, shouldAlert }
end
`;

// Lua script to atomically enforce and reserve inter-send delay slots per sender
// Keys:
//   KEYS[1] = throttle:next_send:<senderId>
// Args:
//   ARGV[1] = now (timestamp in ms)
//   ARGV[2] = minDelayMs (milliseconds)
const ENFORCE_INTER_SEND_DELAY_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local minDelay = tonumber(ARGV[2])

local nextAllowed = tonumber(redis.call('get', key) or '0')

if now >= nextAllowed then
  -- Allowed immediately
  local newNextAllowed = now + minDelay
  redis.call('set', key, tostring(newNextAllowed), 'PX', math.max(minDelay * 10, 60000))
  return { 1, 0, newNextAllowed } -- { allowed = 1, waitMs = 0, nextAllowedTimestamp }
else
  -- Throttled: must wait
  local waitMs = nextAllowed - now
  local newNextAllowed = nextAllowed + minDelay
  redis.call('set', key, tostring(newNextAllowed), 'PX', math.max((waitMs + minDelay) * 10, 60000))
  return { 0, waitMs, nextAllowed } -- { allowed = 0, waitMs, reservedSendTime }
end
`;

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  shouldAlert: boolean;
  delayUntilNextHourMs: number;
  nextHourTimestamp: Date;
}

export interface ThrottleCheckResult {
  allowed: boolean;
  waitMs: number;
  targetTimestamp: Date;
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
 * Ensures that counters never exceed the configured limit and that only
 * ONE Slack notification is triggered per sender per hour window.
 */
export async function checkAndIncrementHourlyLimit(
  senderId: string = 'default',
  limit: number = 200
): Promise<RateLimitCheckResult> {
  const hourKey = getHourKey();
  const counterKey = `ratelimit:emails:${senderId}:${hourKey}`;
  const alertKey = `ratelimit:alert:${senderId}:${hourKey}`;
  const { delayMs, nextHour } = getMillisecondsUntilNextHour();

  try {
    const result = (await redisConnection.eval(
      CHECK_AND_INCREMENT_HOURLY_LUA,
      2,
      counterKey,
      alertKey,
      limit.toString(),
      '7200'
    )) as [number, number, number];

    const allowed = result[0] === 1;
    const currentCount = result[1];
    const shouldAlert = result[2] === 1;

    return {
      allowed,
      currentCount,
      limit,
      shouldAlert,
      delayUntilNextHourMs: delayMs,
      nextHourTimestamp: nextHour,
    };
  } catch (err: any) {
    console.error(`❌ [RateLimiter] Redis error in checkAndIncrementHourlyLimit for ${senderId}:`, err.message);
    // On Redis error, fail safely rather than silently dropping rate limits
    throw new Error(`Rate limiter service error: ${err.message}`);
  }
}

/**
 * Atomically checks and reserves an inter-send delay slot for the given sender.
 * If another email was sent recently, returns allowed: false with the waitMs and targetTimestamp
 * so the worker can reschedule the job via BullMQ instead of holding worker execution time.
 */
export async function checkSenderDelayThrottle(
  senderId: string = 'default',
  minDelaySeconds: number = 2
): Promise<ThrottleCheckResult> {
  if (minDelaySeconds <= 0) {
    return { allowed: true, waitMs: 0, targetTimestamp: new Date() };
  }

  const minDelayMs = minDelaySeconds * 1000;
  const throttleKey = `throttle:next_send:${senderId}`;
  const now = Date.now();

  try {
    const result = (await redisConnection.eval(
      ENFORCE_INTER_SEND_DELAY_LUA,
      1,
      throttleKey,
      now.toString(),
      minDelayMs.toString()
    )) as [number, number, number];

    const allowed = result[0] === 1;
    const waitMs = result[1];
    const targetTimestampMs = result[2];

    return {
      allowed,
      waitMs,
      targetTimestamp: new Date(targetTimestampMs),
    };
  } catch (err: any) {
    console.error(`❌ [RateLimiter] Redis error in checkSenderDelayThrottle for ${senderId}:`, err.message);
    throw new Error(`Inter-send throttle coordination error: ${err.message}`);
  }
}

/**
 * Calculates a staggered next-hour schedule time for a batch or sequence of rate-limited jobs
 * to preserve ordering and avoid stampedes at the start of the next hour.
 */
export async function getNextHourStaggeredTimestamp(
  senderId: string = 'default',
  delayBetweenEmailsSeconds: number = 2
): Promise<Date> {
  const { nextHour } = getMillisecondsUntilNextHour();
  const nextHourKey = getHourKey(nextHour);
  const cursorKey = `ratelimit:stagger_cursor:${senderId}:${nextHourKey}`;

  try {
    const offsetIndex = await redisConnection.incr(cursorKey);
    // Set 2 hour TTL on the cursor key on first increment
    if (offsetIndex === 1) {
      await redisConnection.expire(cursorKey, 7200);
    }

    const additionalDelayMs = (offsetIndex - 1) * Math.max(1, delayBetweenEmailsSeconds) * 1000;
    return new Date(nextHour.getTime() + additionalDelayMs);
  } catch (err) {
    // Fallback to base nextHour if cursor increment fails
    return nextHour;
  }
}

/**
 * Resets rate limit counters and throttle keys for testing purposes
 */
export async function resetSenderRateLimit(senderId: string = 'default'): Promise<void> {
  const hourKey = getHourKey();
  const redisKey = `ratelimit:emails:${senderId}:${hourKey}`;
  const alertKey = `ratelimit:alert:${senderId}:${hourKey}`;
  const throttleKey = `throttle:next_send:${senderId}`;
  await redisConnection.del(redisKey);
  await redisConnection.del(alertKey);
  await redisConnection.del(throttleKey);
  await redisConnection.del(`throttle:last_send:${senderId}`);
}
