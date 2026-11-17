process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getHourKey,
  getMillisecondsUntilNextHour,
} from '../src/services/rate-limiter.service.js';

describe('Rate Limiter Key Generation & Window Logic', () => {
  it('generates consistent UTC hourly keys in YYYYMMDDHH format', () => {
    const fixedDate = new Date('2026-08-30T14:45:00.000Z');
    const key = getHourKey(fixedDate);
    assert.strictEqual(key, '2026083014');
  });

  it('correctly calculates remaining milliseconds until next hour window with safety offset', () => {
    const fixedDate = new Date('2026-08-30T14:45:00.000Z');
    const { delayMs, nextHour } = getMillisecondsUntilNextHour(fixedDate);

    // 15 minutes = 900,000 ms + 2,000 ms safety buffer = 902,000 ms
    assert.strictEqual(delayMs, 902000);
    assert.strictEqual(nextHour.toISOString(), '2026-08-30T15:00:02.000Z');
  });
});

describe('Atomic Lua Rate Limiter Simulation', () => {
  // Simulates the exact Redis Lua script logic in memory
  function simulateHourlyLimit(
    store: Map<string, string>,
    senderId: string,
    hourKey: string,
    limit: number
  ) {
    const counterKey = `ratelimit:emails:${senderId}:${hourKey}`;
    const alertKey = `ratelimit:alert:${senderId}:${hourKey}`;

    const current = parseInt(store.get(counterKey) || '0', 10);

    if (current < limit) {
      const nextVal = current + 1;
      store.set(counterKey, nextVal.toString());
      return { allowed: true, currentCount: nextVal, shouldAlert: false };
    } else {
      const alerted = store.has(alertKey);
      let shouldAlert = false;
      if (!alerted) {
        store.set(alertKey, '1');
        shouldAlert = true;
      }
      return { allowed: false, currentCount: current, shouldAlert };
    }
  }

  it('allows sends up to configured hourly limit and increments counter', () => {
    const store = new Map<string, string>();
    const sender = 'sender_a';
    const hour = '2026083010';
    const limit = 3;

    const r1 = simulateHourlyLimit(store, sender, hour, limit);
    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r1.currentCount, 1);

    const r2 = simulateHourlyLimit(store, sender, hour, limit);
    assert.strictEqual(r2.allowed, true);
    assert.strictEqual(r2.currentCount, 2);

    const r3 = simulateHourlyLimit(store, sender, hour, limit);
    assert.strictEqual(r3.allowed, true);
    assert.strictEqual(r3.currentCount, 3);
  });

  it('blocks when limit is reached and triggers shouldAlert ONLY on the first breach', () => {
    const store = new Map<string, string>();
    const sender = 'sender_a';
    const hour = '2026083010';
    const limit = 2;

    simulateHourlyLimit(store, sender, hour, limit); // count = 1
    simulateHourlyLimit(store, sender, hour, limit); // count = 2

    // 1st breach: should block and alert
    const breach1 = simulateHourlyLimit(store, sender, hour, limit);
    assert.strictEqual(breach1.allowed, false);
    assert.strictEqual(breach1.currentCount, 2);
    assert.strictEqual(breach1.shouldAlert, true);

    // 2nd breach in the same window: should block but NOT re-trigger alert (prevents Slack spam)
    const breach2 = simulateHourlyLimit(store, sender, hour, limit);
    assert.strictEqual(breach2.allowed, false);
    assert.strictEqual(breach2.currentCount, 2);
    assert.strictEqual(breach2.shouldAlert, false);

    // 3rd breach: still no alert
    const breach3 = simulateHourlyLimit(store, sender, hour, limit);
    assert.strictEqual(breach3.allowed, false);
    assert.strictEqual(breach3.shouldAlert, false);
  });

  it('keeps separate senders completely isolated from each other', () => {
    const store = new Map<string, string>();
    const hour = '2026083010';

    // sender_1 reaches limit
    simulateHourlyLimit(store, 'sender_1', hour, 1);
    const s1Blocked = simulateHourlyLimit(store, 'sender_1', hour, 1);
    assert.strictEqual(s1Blocked.allowed, false);

    // sender_2 has its own quota and is allowed
    const s2Allowed = simulateHourlyLimit(store, 'sender_2', hour, 5);
    assert.strictEqual(s2Allowed.allowed, true);
    assert.strictEqual(s2Allowed.currentCount, 1);
  });
});
