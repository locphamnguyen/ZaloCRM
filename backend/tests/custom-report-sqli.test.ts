/**
 * custom-report-sqli.test.ts — Regression test for SQL injection fix in
 * analytics custom report (phase 02 of security plan).
 *
 * Approach: structural test on Prisma.Sql output. We mock `prisma.$queryRaw`
 * to capture the tagged-template call, recursively flatten any nested
 * Prisma.Sql fragments, and assert that user-controlled values land in the
 * bound-param list — never in the literal SQL chunks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client BEFORE importing the module under test.
const queryRawMock = vi.fn();
vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: { $queryRaw: queryRawMock },
}));

const { executeCustomReport } = await import('../src/modules/analytics/reports/custom-report.js');

/**
 * Flatten a tagged-template call into (literalSql, boundValues).
 *
 * $queryRaw receives (strings: TemplateStringsArray, ...values: unknown[]).
 * Values that are nested Prisma.Sql (via Prisma.sql`...`) carry their own
 * strings + values arrays — we walk them so the assertion sees the real
 * bound-param leaves, not opaque Sql wrappers.
 */
function flatten(call: unknown[]): { sql: string; bound: unknown[] } {
  const strings = call[0] as readonly string[];
  const rawValues = call.slice(1);
  const bound: unknown[] = [];
  const parts: string[] = [strings[0] ?? ''];

  for (let i = 0; i < rawValues.length; i++) {
    const v = rawValues[i];
    if (isPrismaSql(v)) {
      const nested = flatten([v.strings, ...v.values]);
      parts.push(nested.sql);
      bound.push(...nested.bound);
    } else if (isPrismaRaw(v)) {
      // Prisma.raw is a server-controlled literal — treat as SQL text, not bound.
      parts.push(String(v.value ?? ''));
    } else {
      bound.push(v);
    }
    parts.push(strings[i + 1] ?? '');
  }
  return { sql: parts.join(''), bound };
}

function isPrismaSql(v: unknown): v is { strings: string[]; values: unknown[] } {
  return !!v && typeof v === 'object' && 'strings' in v && 'values' in v;
}
function isPrismaRaw(v: unknown): v is { value: unknown } {
  // Prisma.raw produces an object with a `value` string and no `strings` array.
  return !!v && typeof v === 'object' && 'value' in v && !('strings' in v);
}

describe('custom-report SQL injection regression', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
    queryRawMock.mockResolvedValue([]);
  });

  it('passes malicious filters.source as a BOUND parameter (not concatenated)', async () => {
    const malicious = "x' UNION SELECT password_hash, 1 FROM users--";
    await executeCustomReport('org-1', {
      metrics: ['contacts_new'],
      groupBy: 'day',
      dateRange: { from: '2024-01-01', to: '2024-12-31' },
      filters: { source: malicious },
    });

    const { sql, bound } = flatten(queryRawMock.mock.calls[0]);
    expect(bound).toContain(malicious);
    expect(sql).not.toContain(malicious);
    expect(sql).not.toContain('UNION SELECT');
  });

  it('passes filters.source through bound param even when benign', async () => {
    await executeCustomReport('org-1', {
      metrics: ['contacts_new'],
      groupBy: 'day',
      dateRange: { from: '2024-01-01', to: '2024-12-31' },
      filters: { source: 'facebook' },
    });
    const { sql, bound } = flatten(queryRawMock.mock.calls[0]);
    expect(bound).toContain('facebook');
    expect(sql).not.toContain("'facebook'");
  });

  it('omits sourceFilter fragment entirely when filters.source not provided', async () => {
    await executeCustomReport('org-1', {
      metrics: ['contacts_new'],
      groupBy: 'day',
      dateRange: { from: '2024-01-01', to: '2024-12-31' },
    });
    const { sql } = flatten(queryRawMock.mock.calls[0]);
    expect(sql).not.toContain('source =');
  });

  it('throws on invalid groupBy enum (no Prisma.raw escape)', async () => {
    await expect(
      executeCustomReport('org-1', {
        metrics: ['messages_sent'],
        // @ts-expect-error — intentionally invalid value
        groupBy: "day'; DROP TABLE users--",
        dateRange: { from: '2024-01-01', to: '2024-12-31' },
      }),
    ).rejects.toThrow();
  });

  it('happy path: appointments by user runs without error', async () => {
    queryRawMock.mockResolvedValue([
      { label: 'Alice', cnt: 5n },
      { label: 'Bob', cnt: 3n },
    ]);
    const result = await executeCustomReport('org-1', {
      metrics: ['appointments'],
      groupBy: 'user',
      dateRange: { from: '2024-01-01', to: '2024-12-31' },
    });
    expect(result.labels).toEqual(['Alice', 'Bob']);
    expect(result.datasets[0]?.data).toEqual([5, 3]);
  });
});

