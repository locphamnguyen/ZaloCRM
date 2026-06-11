/**
 * seed-demo-muctieu.ts — Bổ sung demo cho trang "Mục tiêu" (/marketing/triggers).
 * "Mục tiêu" = chiến dịch mời kết bạn 1 Tệp KH (CustomerList) → trigger
 * eventType='friend_invite_to_list' + segmentSpec.kind='customer_list_pool'.
 *
 * Tạo: 2 Tệp KH (CustomerList) + entries (lấy từ contacts demo) + 3 Mục tiêu (trigger).
 * Idempotent: skip nếu đã có trigger friend_invite_to_list trong org.
 *
 * Chạy: cd backend && DATABASE_URL=$DATABASE_URL \
 *   npx tsx scripts/seed-demo-muctieu.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
// Portable: org resolve từ owner (ép qua env SEED_ORG_ID nếu muốn).
let ORG_ID = process.env.SEED_ORG_ID || '';

async function main() {
  const owner = await prisma.user.findFirst({
    where: ORG_ID ? { orgId: ORG_ID, role: 'owner' } : { role: 'owner' },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) throw new Error('Chưa có owner — đăng ký owner qua /setup rồi chạy seed-demo-data trước.');
  ORG_ID = owner.orgId;

  const existed = await prisma.automationTrigger.findFirst({
    where: { orgId: ORG_ID, eventType: 'friend_invite_to_list' },
  });
  if (existed) {
    console.log('⚠ Đã có Mục tiêu (friend_invite_to_list). Bỏ qua.');
    return;
  }
  const nick = await prisma.zaloAccount.findFirst({
    where: { orgId: ORG_ID, archivedAt: null },
    orderBy: { lastConnectedAt: 'desc' },
    select: { id: true },
  });
  const frBlock = await prisma.block.findFirst({
    where: { orgId: ORG_ID, actionType: 'request_friend' },
    select: { id: true },
  });
  if (!nick || !frBlock) throw new Error('Cần 1 nick Zalo + 1 block request_friend (chạy seed-demo-data trước)');

  // Lấy contacts demo (phone 098700xxxx) làm entry
  const contacts = await prisma.contact.findMany({
    where: { orgId: ORG_ID, phone: { startsWith: '098700' } },
    select: { id: true, phone: true, fullName: true },
    take: 60,
  });

  const listDefs = [
    { name: 'Tệp KH FB tháng 6', slice: [0, 30] },
    { name: 'Tệp KH tiềm năng Q2', slice: [30, 60] },
  ];
  const listIds: string[] = [];
  for (const def of listDefs) {
    const part = contacts.slice(def.slice[0], def.slice[1]);
    const list = await prisma.customerList.create({
      data: {
        orgId: ORG_ID, createdById: owner.id, name: def.name,
        sourceType: 'paste',
        status: 'completed',
        totalEntries: part.length, validEntries: part.length, hasZaloEntries: part.length,
        endedAt: new Date(),
      },
    });
    listIds.push(list.id);
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      await prisma.customerListEntry.create({
        data: {
          customerListId: list.id, rowIndex: i + 1,
          phoneRaw: c.phone ?? '', nameRaw: c.fullName ?? null,
          phoneLocal: c.phone ?? null, phoneValid: true,
          contactId: c.id, hasZalo: true, status: 'valid',
        },
      });
    }
    console.log(`→ Tệp KH "${def.name}": ${part.length} entries`);
  }

  // 3 Mục tiêu (trigger friend_invite_to_list)
  const segmentSpec = (listId: string) => ({
    kind: 'customer_list_pool',
    listId,
    nickIds: [nick.id],
    skipRules: { recencyDays: 30, friendCap: 50, entryStatuses: ['valid'] },
  });
  const triggerDefs = [
    { name: 'Chiến dịch kết bạn KH FB', listId: listIds[0], state: 'active' },
    { name: 'Chiến dịch kết bạn KH tiềm năng', listId: listIds[1], state: 'paused' },
    { name: 'Chiến dịch kết bạn (nháp)', listId: listIds[0], state: 'draft' },
  ];
  for (const t of triggerDefs) {
    await prisma.automationTrigger.create({
      data: {
        orgId: ORG_ID, name: t.name,
        eventType: 'friend_invite_to_list', category: 'general',
        bindingKind: 'block', blockId: frBlock.id,
        segmentSpec: segmentSpec(t.listId),
        state: t.state, enabled: t.state === 'active', createdById: owner.id,
      },
    });
    console.log(`→ Mục tiêu "${t.name}" (${t.state})`);
  }

  console.log('\n✅ Đã tạo 2 Tệp KH + 3 Mục tiêu (trang /marketing/triggers).');
}

main()
  .catch((e) => { console.error('❌ Lỗi:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
