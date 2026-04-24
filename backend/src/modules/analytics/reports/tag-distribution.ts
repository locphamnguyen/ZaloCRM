/**
 * tag-distribution.ts — Contact count per CRM tag, org-scoped.
 * Joins ContactTagLink → CrmTag, filters by tag.orgId.
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface TagDistributionItem {
  tagId: string;
  name: string;
  color: string;
  source: string;
  contactCount: number;
  percent: number;
}

export interface TagDistributionResult {
  tags: TagDistributionItem[];
}

export async function getTagDistribution(orgId: string): Promise<TagDistributionResult> {
  // Raw group-by: count distinct contactIds per tag, restricted to org's tags.
  // ContactTagLink has no direct orgId — scoped via CrmTag.orgId.
  const rows = await prisma.$queryRaw<
    Array<{
      tag_id: string;
      name: string;
      color: string;
      source: string;
      contact_count: bigint;
    }>
  >`
    SELECT
      t.id          AS tag_id,
      t.name,
      t.color,
      t.source,
      COUNT(DISTINCT l.contact_id)::bigint AS contact_count
    FROM crm_tags t
    LEFT JOIN contact_tag_links l ON l.tag_id = t.id
    WHERE t.org_id = ${orgId}
    GROUP BY t.id, t.name, t.color, t.source
    ORDER BY contact_count DESC, t.name ASC
  `;

  if (rows.length === 0) return { tags: [] };

  const total = rows.reduce((sum, r) => sum + Number(r.contact_count), 0);

  return {
    tags: rows.map((r) => ({
      tagId: r.tag_id,
      name: r.name,
      color: r.color,
      source: r.source,
      contactCount: Number(r.contact_count),
      percent: total > 0 ? Math.round((Number(r.contact_count) / total) * 1000) / 10 : 0,
    })),
  };
}
