/**
 * rate-limiter.ts — Per-key (600/min) and per-org (6000/min) rate limiting.
 * Runs as Fastify preHandler AFTER apiKeyMiddleware (requires publicApiContext).
 * Uses ApiKeyUsage table with minute-bucket upsert for persistence + org-wide sum.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

const PER_KEY_LIMIT = 600;
const PER_ORG_LIMIT = 6000;

function currentMinuteBucket(): Date {
  return new Date(Math.floor(Date.now() / 60_000) * 60_000);
}

export async function rateLimiterMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { apiKeyId, orgId } = request.publicApiContext;
  const bucket = currentMinuteBucket();

  // Upsert usage row for this key+bucket, then read current count
  let keyCount: number;
  try {
    const usage = await prisma.apiKeyUsage.upsert({
      where: { apiKeyId_bucket: { apiKeyId, bucket } },
      create: { apiKeyId, bucket, count: 1 },
      update: { count: { increment: 1 } },
    });
    keyCount = usage.count;
  } catch {
    // On upsert failure, allow the request through rather than hard-fail
    return;
  }

  if (keyCount > PER_KEY_LIMIT) {
    reply.header('Retry-After', '60');
    return reply.status(429).send({
      error: {
        code: 'rate_limit_exceeded',
        message: `Per-key rate limit of ${PER_KEY_LIMIT} requests/min exceeded`,
      },
    });
  }

  // Org-wide check: sum all keys for this org in the current minute
  try {
    const orgKeys = await prisma.apiKey.findMany({
      where: { orgId, revokedAt: null },
      select: { id: true },
    });
    const orgKeyIds = orgKeys.map((k) => k.id);

    const orgUsage = await prisma.apiKeyUsage.aggregate({
      where: { apiKeyId: { in: orgKeyIds }, bucket },
      _sum: { count: true },
    });

    const orgTotal = orgUsage._sum.count ?? 0;
    if (orgTotal > PER_ORG_LIMIT) {
      reply.header('Retry-After', '60');
      return reply.status(429).send({
        error: {
          code: 'org_rate_limit_exceeded',
          message: `Org-wide rate limit of ${PER_ORG_LIMIT} requests/min exceeded`,
        },
      });
    }
  } catch {
    // Non-critical — allow through if org check fails
  }
}
