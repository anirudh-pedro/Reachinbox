import { Client } from '@elastic/elasticsearch';
import { prisma } from '../config/prisma.js';

const node = process.env.ELASTICSEARCH_NODE || 'http://127.0.0.1:9200';

export const esClient = new Client({
  node,
  requestTimeout: 3000,
  maxRetries: 1,
});

export const EMAILS_INDEX = 'emails';

let isElasticsearchAvailable = false;

export async function initElasticsearch(): Promise<boolean> {
  try {
    const health = await esClient.cluster.health();
    console.log(`🔍 Elasticsearch Connected (status: ${health.status})`);
    isElasticsearchAvailable = true;

    // Check if index exists
    const exists = await esClient.indices.exists({ index: EMAILS_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: EMAILS_INDEX,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              recipient: {
                type: 'text',
                fields: { keyword: { type: 'keyword', ignore_above: 256 } },
              },
              subject: { type: 'text' },
              body: { type: 'text' },
              status: { type: 'keyword' },
              senderEmail: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              etherealPreviewUrl: { type: 'keyword' },
              createdAt: { type: 'date' },
            },
          },
        },
      });
      console.log(`✅ Elasticsearch index '${EMAILS_INDEX}' initialized.`);
    }

    return true;
  } catch (err: any) {
    console.warn('⚠️ Elasticsearch not reachable. Search fallback to PostgreSQL will be enabled:', err.message);
    isElasticsearchAvailable = false;
    return false;
  }
}

export interface EmailDoc {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  senderEmail?: string;
  scheduledAt: Date | string;
  sentAt?: Date | string | null;
  etherealPreviewUrl?: string | null;
  createdAt: Date | string;
}

export async function indexEmail(email: EmailDoc): Promise<void> {
  if (!isElasticsearchAvailable) return;

  try {
    await esClient.index({
      index: EMAILS_INDEX,
      id: email.id,
      document: {
        id: email.id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        senderEmail: email.senderEmail,
        scheduledAt: new Date(email.scheduledAt).toISOString(),
        sentAt: email.sentAt ? new Date(email.sentAt).toISOString() : null,
        etherealPreviewUrl: email.etherealPreviewUrl || null,
        createdAt: new Date(email.createdAt).toISOString(),
      },
    });
  } catch (err: any) {
    console.warn(`⚠️ Failed to index email ${email.id} in Elasticsearch:`, err.message);
  }
}

export interface SearchParams {
  query?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export async function searchEmails(params: SearchParams) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const query = params.query?.trim() || '';
  const status = params.status?.trim();
  const from = (page - 1) * limit;

  // 1. Try Elasticsearch first
  if (isElasticsearchAvailable) {
    try {
      const mustClauses: any[] = [];

      if (query) {
        mustClauses.push({
          multi_match: {
            query,
            fields: ['recipient^3', 'subject^2', 'body', 'senderEmail'],
            fuzziness: 'AUTO',
          },
        });
      } else {
        mustClauses.push({ match_all: {} });
      }

      if (status && status !== 'ALL') {
        mustClauses.push({
          term: { status: status.toUpperCase() },
        });
      }

      const response = await esClient.search({
        index: EMAILS_INDEX,
        from,
        size: limit,
        body: {
          query: {
            bool: {
              must: mustClauses,
            },
          },
          sort: [{ createdAt: { order: 'desc' } }],
        },
      });

      const total = typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0;
      const data = response.hits.hits.map((hit) => hit._source);

      return {
        source: 'elasticsearch',
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (err: any) {
      console.warn('⚠️ Elasticsearch search error, falling back to PostgreSQL:', err.message);
    }
  }

  // 2. Fallback to PostgreSQL
  const where: any = {};
  if (status && status !== 'ALL') {
    where.status = status.toUpperCase();
  }
  if (query) {
    where.OR = [
      { recipient: { contains: query, mode: 'insensitive' } },
      { subject: { contains: query, mode: 'insensitive' } },
      { body: { contains: query, mode: 'insensitive' } },
    ];
  }

  const [emails, total] = await Promise.all([
    prisma.emailJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: from,
      take: limit,
      include: { sender: { select: { name: true, email: true } } },
    }),
    prisma.emailJob.count({ where }),
  ]);

  return {
    source: 'postgres_fallback',
    data: emails,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
