// Seed 60 mẫu tin nhắn (4 dự án × 15) — Anh chốt 2026-06-09.
// Idempotent: skip mẫu đã tồn tại theo (orgId, name). Re-run an toàn.
//
// Chạy:  npx tsx prisma/seeds/seed-message-templates.ts [orgId]
//   - Không truyền orgId → dùng org đầu tiên trong DB.
//
// Parser marker → {text, styles[]} (st: 'b' | 'c_RRGGBB'). Tự tính offset trên TEXT SẠCH
// (sau khi gỡ marker) nên không lệch — KHÔNG đếm tay.

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  SEED_TEMPLATES, PROJECT_TAGS, PROJECT_SHORTCUT_PREFIX, functionKeyFromName,
} from './message-templates-data.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('❌ DATABASE_URL chưa set'); process.exit(1); }
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const COLOR_HEX: Record<string, string> = {
  'đỏ': 'db342e', 'cam': 'f27806', 'vàng': 'f7b503', 'xanhla': '15a85f', 'xanhduong': '2962ff',
};

interface Style { st: string; start: number; len: number }

/**
 * Parse marker → { text, styles }.
 *   **...**            → st:'b'
 *   [[c:tên]]...[[/]]  → st:'c_RRGGBB'
 * Quét tuần tự, build TEXT SẠCH dần, offset tính trên text sạch (chuẩn Zalo).
 */
function parseMarkers(raw: string): { text: string; styles: Style[] } {
  let text = '';
  const styles: Style[] = [];
  let i = 0;
  while (i < raw.length) {
    // bold
    if (raw.startsWith('**', i)) {
      const end = raw.indexOf('**', i + 2);
      if (end !== -1) {
        const inner = parseMarkers(raw.slice(i + 2, end)); // hỗ trợ màu lồng trong đậm
        const start = text.length;
        text += inner.text;
        styles.push({ st: 'b', start, len: inner.text.length });
        for (const s of inner.styles) styles.push({ st: s.st, start: start + s.start, len: s.len });
        i = end + 2;
        continue;
      }
    }
    // color [[c:tên]]...[[/]]
    if (raw.startsWith('[[c:', i)) {
      const tagEnd = raw.indexOf(']]', i);
      if (tagEnd !== -1) {
        const colorName = raw.slice(i + 4, tagEnd).trim();
        const close = raw.indexOf('[[/]]', tagEnd);
        if (close !== -1) {
          const inner = parseMarkers(raw.slice(tagEnd + 2, close));
          const start = text.length;
          text += inner.text;
          const hex = COLOR_HEX[colorName];
          if (hex) styles.push({ st: `c_${hex}`, start, len: inner.text.length });
          for (const s of inner.styles) styles.push({ st: s.st, start: start + s.start, len: s.len });
          i = close + 5;
          continue;
        }
      }
    }
    text += raw[i];
    i += 1;
  }
  return { text, styles };
}

async function main() {
  const orgId = process.argv[2];
  const org = orgId
    ? await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) { console.error('❌ Không tìm thấy org. Truyền orgId hoặc tạo org trước.'); process.exit(1); }

  // người tạo: lấy owner/admin đầu tiên của org để gán createdById
  const creator = await prisma.user.findFirst({
    where: { orgId: org.id, role: { in: ['owner', 'admin'] } },
    select: { id: true },
  }) ?? await prisma.user.findFirst({ where: { orgId: org.id }, select: { id: true } });
  if (!creator) { console.error('❌ Org chưa có user nào.'); process.exit(1); }

  console.log(`📂 Seed mẫu tin nhắn cho org ${org.id} (creator ${creator.id})`);

  // 1 folder công khai "Mẫu dự án" (idempotent theo name)
  let folder = await prisma.messageTemplateFolder.findFirst({
    where: { orgId: org.id, name: 'Mẫu dự án' }, select: { id: true },
  });
  if (!folder) {
    folder = await prisma.messageTemplateFolder.create({
      data: {
        id: randomUUID(), orgId: org.id, name: 'Mẫu dự án',
        visibility: 'public', createdById: creator.id,
      },
      select: { id: true },
    });
    console.log('  ✓ Tạo folder "Mẫu dự án" (công khai)');
  } else {
    console.log('  • Folder "Mẫu dự án" đã có, dùng lại');
  }

  let created = 0, updated = 0;
  for (const tag of PROJECT_TAGS) {
    const prefix = PROJECT_SHORTCUT_PREFIX[tag];
    const usedShortcuts = new Set<string>();
    for (const tpl of SEED_TEMPLATES[tag]) {
      // Sinh shortcut "/<prefix><fn>", thêm số nếu trùng trong cùng dự án.
      let sc = tpl.shortcut ?? `${prefix}${functionKeyFromName(tpl.name)}`;
      let base = sc, n = 2;
      while (usedShortcuts.has(sc)) { sc = `${base}${n}`; n += 1; }
      usedShortcuts.add(sc);

      const { text, styles } = parseMarkers(tpl.body);
      const exists = await prisma.messageTemplate.findFirst({
        where: { orgId: org.id, name: tpl.name }, select: { id: true, shortcut: true },
      });
      if (exists) {
        // Idempotent backfill: cập shortcut nếu chưa có.
        if (!exists.shortcut) {
          await prisma.messageTemplate.update({ where: { id: exists.id }, data: { shortcut: sc } });
          updated += 1;
        }
        continue;
      }

      await prisma.messageTemplate.create({
        data: {
          id: randomUUID(), orgId: org.id, createdById: creator.id, ownerUserId: null,
          folderId: folder.id, visibility: 'public',
          name: tpl.name, shortcut: sc, content: text,
          contentRich: { text, styles },
          category: tpl.category, tagIds: [tag],
        },
      });
      created += 1;
    }
  }

  console.log(`✅ Xong: tạo ${created} mẫu mới, backfill shortcut ${updated} mẫu cũ. Tổng 60.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
