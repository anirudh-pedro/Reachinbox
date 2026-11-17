import { describe, it } from 'node:test';
import assert from 'node:assert';

function resolveTargetStatuses(params: { tab?: 'scheduled' | 'sent'; status?: string }): string[] {
  if (params.tab === 'scheduled') {
    return ['SCHEDULED', 'PROCESSING', 'RATE_LIMITED'];
  } else if (params.tab === 'sent') {
    return ['SENT', 'FAILED'];
  } else if (params.status && params.status !== 'ALL') {
    return params.status
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return [];
}

function buildEsMustClauses(query: string, statuses: string[]) {
  const mustClauses: any[] = [];

  if (query.trim()) {
    mustClauses.push({
      multi_match: {
        query: query.trim(),
        fields: ['recipient^3', 'subject^2', 'body', 'senderEmail'],
        fuzziness: 'AUTO',
      },
    });
  } else {
    mustClauses.push({ match_all: {} });
  }

  if (statuses.length === 1) {
    mustClauses.push({ term: { status: statuses[0] } });
  } else if (statuses.length > 1) {
    mustClauses.push({ terms: { status: statuses } });
  }

  return mustClauses;
}

function buildPostgresWhereClause(query: string, statuses: string[]) {
  const where: any = {};
  if (statuses.length === 1) {
    where.status = statuses[0];
  } else if (statuses.length > 1) {
    where.status = { in: statuses };
  }

  if (query.trim()) {
    where.OR = [
      { recipient: { contains: query.trim(), mode: 'insensitive' } },
      { subject: { contains: query.trim(), mode: 'insensitive' } },
      { body: { contains: query.trim(), mode: 'insensitive' } },
    ];
  }

  return where;
}

describe('Elasticsearch Query & Tab Filtering Logic', () => {
  it('correctly maps "scheduled" tab to SCHEDULED, PROCESSING, RATE_LIMITED', () => {
    const statuses = resolveTargetStatuses({ tab: 'scheduled' });
    assert.deepStrictEqual(statuses, ['SCHEDULED', 'PROCESSING', 'RATE_LIMITED']);
  });

  it('correctly maps "sent" tab to SENT, FAILED', () => {
    const statuses = resolveTargetStatuses({ tab: 'sent' });
    assert.deepStrictEqual(statuses, ['SENT', 'FAILED']);
  });

  it('builds valid Elasticsearch query clauses for scheduled search', () => {
    const statuses = resolveTargetStatuses({ tab: 'scheduled' });
    const clauses = buildEsMustClauses('investor update', statuses);

    assert.strictEqual(clauses.length, 2);
    assert.deepStrictEqual(clauses[0].multi_match.query, 'investor update');
    assert.deepStrictEqual(clauses[1].terms.status, ['SCHEDULED', 'PROCESSING', 'RATE_LIMITED']);
  });

  it('builds valid PostgreSQL fallback where clause', () => {
    const statuses = resolveTargetStatuses({ tab: 'sent' });
    const where = buildPostgresWhereClause('welcome', statuses);

    assert.deepStrictEqual(where.status, { in: ['SENT', 'FAILED'] });
    assert.strictEqual(where.OR.length, 3);
    assert.strictEqual(where.OR[0].recipient.contains, 'welcome');
  });
});

