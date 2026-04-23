#!/usr/bin/env tsx
/**
 * migrate-existing-tags.ts
 *
 * One-shot idempotent script: copies Contact.tags (String[]) into CrmTag + ContactTagLink.
 * Safe to re-run — uses upsert throughout.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/migrate-existing-tags.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Processing ${orgs.length} org(s)…`);

  let totalOrgs = 0;
  let totalTagsCreated = 0;
  let totalLinksCreated = 0;

  for (const org of orgs) {
    const contacts = await prisma.contact.findMany({
      where: { orgId: org.id },
      select: { id: true, tags: true },
    });

    // Collect unique tag names for this org (skip non-strings)
    const allTagNames = new Set<string>();
    for (const contact of contacts) {
      const raw = contact.tags;
      if (!Array.isArray(raw)) continue;
      for (const entry of raw) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
          allTagNames.add(entry.trim());
        }
      }
    }

    // Upsert CrmTag per unique name
    const tagIdByName = new Map<string, string>();
    let orgTagsCreated = 0;
    for (const name of allTagNames) {
      const tag = await prisma.crmTag.upsert({
        where: { orgId_name_source: { orgId: org.id, name, source: 'crm' } },
        create: { orgId: org.id, name, source: 'crm', color: '#888' },
        update: {},
        select: { id: true },
      });
      tagIdByName.set(name, tag.id);
      orgTagsCreated++;
    }

    // Upsert ContactTagLink per contact tag entry
    let orgLinksCreated = 0;
    for (const contact of contacts) {
      const raw = contact.tags;
      if (!Array.isArray(raw)) continue;
      for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim().length === 0) continue;
        const tagId = tagIdByName.get(entry.trim());
        if (!tagId) continue;
        await prisma.contactTagLink.upsert({
          where: { contactId_tagId: { contactId: contact.id, tagId } },
          create: {
            contactId: contact.id,
            tagId,
            source: 'crm',
            appliedBy: 'migration',
          },
          update: {},
        });
        orgLinksCreated++;
      }
    }

    if (orgTagsCreated > 0 || orgLinksCreated > 0) {
      console.log(`  org=${org.name}: contacts=${contacts.length} tags_upserted=${orgTagsCreated} links_upserted=${orgLinksCreated}`);
    }

    totalOrgs++;
    totalTagsCreated += orgTagsCreated;
    totalLinksCreated += orgLinksCreated;
  }

  console.log(`\nDone. orgs_processed=${totalOrgs} tags_created=${totalTagsCreated} links_created=${totalLinksCreated}`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
