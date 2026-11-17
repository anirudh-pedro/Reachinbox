import { describe, it } from 'node:test';
import assert from 'node:assert';

function parseEmailLeads(content: string, existingRecipients: string[] = []) {
  const rawTokens = content
    .split(/[\r\n,;]+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const validEmails: string[] = [];
  let duplicatesCount = 0;
  let invalidCount = 0;

  const seen = new Set<string>(existingRecipients.map((r) => r.toLowerCase()));

  for (const token of rawTokens) {
    if (/^(email|emails|email\s*address|recipient|name)$/i.test(token)) {
      continue;
    }

    if (emailRegex.test(token)) {
      const lower = token.toLowerCase();
      if (seen.has(lower)) {
        duplicatesCount++;
      } else {
        seen.add(lower);
        validEmails.push(token);
      }
    } else {
      const embeddedMatches = token.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (embeddedMatches && embeddedMatches.length > 0) {
        for (const em of embeddedMatches) {
          const lower = em.toLowerCase();
          if (seen.has(lower)) {
            duplicatesCount++;
          } else {
            seen.add(lower);
            validEmails.push(em);
          }
        }
      } else {
        invalidCount++;
      }
    }
  }

  return {
    validEmails,
    validCount: validEmails.length,
    duplicatesRemoved: duplicatesCount,
    invalidCount,
  };
}

describe('CSV & Text Email Lead Parser', () => {
  it('parses valid comma-separated and newline-separated emails', () => {
    const raw = `alex@example.com, john.doe@company.org\r\nsarah@startup.io`;
    const res = parseEmailLeads(raw);
    assert.strictEqual(res.validCount, 3);
    assert.strictEqual(res.duplicatesRemoved, 0);
    assert.strictEqual(res.invalidCount, 0);
    assert.deepStrictEqual(res.validEmails, [
      'alex@example.com',
      'john.doe@company.org',
      'sarah@startup.io',
    ]);
  });

  it('detects and removes duplicate email addresses case-insensitively', () => {
    const raw = `test@example.com\nTEST@EXAMPLE.COM\nTest@Example.Com\nother@example.com`;
    const res = parseEmailLeads(raw);
    assert.strictEqual(res.validCount, 2);
    assert.strictEqual(res.duplicatesRemoved, 2);
    assert.strictEqual(res.validEmails[0], 'test@example.com');
    assert.strictEqual(res.validEmails[1], 'other@example.com');
  });

  it('ignores standard CSV header rows', () => {
    const raw = `Email Address\nalice@reachinbox.ai\nbob@reachinbox.ai`;
    const res = parseEmailLeads(raw);
    assert.strictEqual(res.validCount, 2);
    assert.strictEqual(res.invalidCount, 0);
  });

  it('correctly extracts embedded emails and tracks invalid rows', () => {
    const raw = `
      "Oliver Brown" <oliver@reachinbox.ai>,
      invalid-email-string,
      not_an_email@,
      valid.lead@outreach.com
    `;
    const res = parseEmailLeads(raw);
    assert.strictEqual(res.validCount, 2);
    assert.strictEqual(res.invalidCount, 2);
    assert.ok(res.validEmails.includes('oliver@reachinbox.ai'));
    assert.ok(res.validEmails.includes('valid.lead@outreach.com'));
  });

  it('deduplicates against already existing recipients in the compose list', () => {
    const existing = ['already.here@test.com'];
    const raw = `already.here@test.com, new.recipient@test.com`;
    const res = parseEmailLeads(raw, existing);
    assert.strictEqual(res.validCount, 1);
    assert.strictEqual(res.duplicatesRemoved, 1);
    assert.strictEqual(res.validEmails[0], 'new.recipient@test.com');
  });
});

