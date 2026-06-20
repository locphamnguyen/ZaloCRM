// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * status-migration.ts — One-off seed 8 default Status rows per org +
 * convert Contact.status enum text → Contact.statusId FK. Idempotent.
 *
 * Order ascending = thứ tự ưu tiên (Cha aggregate = MAX(sons.status.order)):
 *   1 Mất       (terminal, lowest)
 *   2 Thất Bại  (terminal)
 *   3 Mới       (default for new Contact)
 *   4 Tiếp cận
 *   5 Hẹn gặp
 *   6 Nóng
 *   7 Tiềm năng
 *   8 Chốt      (terminal, highest)
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

interface SeedStatus {
  name: string;
  order: number;
  color: string;
  isTerminal?: boolean;
  isDefault?: boolean;
}

const DEFAULT_STATUSES: SeedStatus[] = [
  { name: 'Mất',       order: 1, color: '#71717A', isTerminal: true },
  { name: 'Thất Bại',  order: 2, color: '#EF4444', isTerminal: true },
  { name: 'Mới',       order: 3, color: '#9CA3AF', isDefault: true },
  { name: 'Tiếp cận',  order: 4, color: '#3B82F6' },
  { name: 'Hẹn gặp',   order: 5, color: '#06B6D4' },
  { name: 'Nóng',      order: 6, color: '#F97316' },
  { name: 'Tiềm năng', order: 7, color: '#EAB308' },
  { name: 'Chốt',      order: 8, color: '#22C55E', isTerminal: true },
];

// Mapping enum text cũ → tên status mới
const LEGACY_ENUM_MAP: Record<string, string> = {
  'new':        'Mới',
  'contacted':  'Tiếp cận',
  'interested': 'Tiềm năng',
  'converted':  'Chốt',
  'lost':       'Mất',
};

export interface StatusMigrationResult {
  orgsProcessed: number;
  statusesSeeded: number;
  contactsConverted: number;
}

export async function migrateStatusTable(): Promise<StatusMigrationResult> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const result: StatusMigrationResult = { orgsProcessed: 0, statusesSeeded: 0, contactsConverted: 0 };

  for (const org of orgs) {
    result.orgsProcessed++;
    // Seed 8 default statuses (idempotent via upsert by orgId+name)
    const created = await Promise.all(DEFAULT_STATUSES.map(async (s) => {
      const upserted = await prisma.status.upsert({
        where: { orgId_name: { orgId: org.id, name: s.name } },
        create: {
          orgId: org.id,
          name: s.name,
          order: s.order,
          color: s.color,
          isTerminal: s.isTerminal ?? false,
          isDefault: s.isDefault ?? false,
        },
        update: {}, // KHÔNG ghi đè user-edited rows
      });
      return upserted;
    }));
    result.statusesSeeded += created.length;
    const byName = new Map(created.map((s) => [s.name, s.id]));

    // Convert Contact.status enum → statusId (chỉ contact chưa có statusId)
    for (const [enumVal, statusName] of Object.entries(LEGACY_ENUM_MAP)) {
      const statusId = byName.get(statusName);
      if (!statusId) continue;
      const { count } = await prisma.contact.updateMany({
        where: { orgId: org.id, status: enumVal, statusId: null },
        data: { statusId },
      });
      result.contactsConverted += count;
    }

    // Default 'Mới' cho Contact chưa có statusId AND chưa có legacy enum match
    const defaultStatusId = byName.get('Mới');
    if (defaultStatusId) {
      const { count } = await prisma.contact.updateMany({
        where: { orgId: org.id, statusId: null },
        data: { statusId: defaultStatusId },
      });
      result.contactsConverted += count;
    }
  }

  logger.info(`[status-migration] orgs=${result.orgsProcessed} statuses=${result.statusesSeeded} converted=${result.contactsConverted}`);
  return result;
}
