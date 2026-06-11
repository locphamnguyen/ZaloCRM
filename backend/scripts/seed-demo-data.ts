/**
 * seed-demo-data.ts — Tạo dữ liệu DEMO cho ZaloCRM (org "Thiên Phúc").
 * Gồm: 5 phòng ban, 30 nhân viên, ~120 khách hàng, và kịch bản marketing demo
 * (templates, blocks, sequences, triggers, broadcasts, care-sessions).
 *
 * Chạy từ host:
 *   cd backend && DATABASE_URL=$DATABASE_URL \
 *     npx tsx scripts/seed-demo-data.ts
 *
 * Idempotent: nếu đã seed (có phòng "Ban Giám Đốc") → bỏ qua. Xoá demo cũ: tự xoá tay.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Portable: org tự resolve từ tài khoản chủ (owner) — chạy được trên BẤT KỲ server nào sau
// khi đã đăng ký owner. Có thể ép org cụ thể qua env SEED_ORG_ID.
let ORG_ID = process.env.SEED_ORG_ID || '';
const DEMO_PASSWORD = 'Demo@1234';

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const DEM = ['Văn', 'Thị', 'Hữu', 'Đức', 'Minh', 'Thanh', 'Quốc', 'Hồng', 'Ngọc', 'Gia', 'Tuấn', 'Thu'];
const TEN = ['An', 'Bình', 'Cường', 'Dũng', 'Em', 'Phúc', 'Giang', 'Hà', 'Hải', 'Khoa', 'Lan', 'Linh', 'Mai', 'Nam', 'Oanh', 'Phương', 'Quân', 'Sơn', 'Trang', 'Uyên', 'Vy', 'Yến', 'Bảo', 'Châu', 'Đạt', 'Hùng', 'Kiên', 'Loan', 'My', 'Như'];
const PROVINCES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Bình Dương', 'Đồng Nai', 'Nghệ An'];
const SOURCES = ['FB', 'TT', 'GT', 'CN', 'zalo', 'phone_import'];
const STATUSES = ['new', 'contacted', 'interested', 'converted', 'lost'];
const CRM_TAGS = ['vip', 'tiem-nang', 'quan-tam', 'cho-bao-gia', 'da-chot', 'kho-tinh'];

const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
function fullName(): string {
  return `${rand(HO)} ${rand(DEM)} ${rand(TEN)}`;
}

async function main() {
  // ── Resolve org từ owner (portable) ────────────────────────────────
  const owner = await prisma.user.findFirst({
    where: ORG_ID ? { orgId: ORG_ID, role: 'owner' } : { role: 'owner' },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) throw new Error('Chưa có tài khoản chủ (owner). Hãy đăng ký owner qua trang /setup trước, rồi chạy lại seed.');
  ORG_ID = owner.orgId;
  console.log(`→ Seed vào org ${ORG_ID}`);

  // ── Idempotency guard ──────────────────────────────────────────────
  const existed = await prisma.department.findFirst({ where: { orgId: ORG_ID, name: 'Ban Giám Đốc' } });
  if (existed) {
    console.log('⚠ Demo đã seed (có phòng "Ban Giám Đốc"). Bỏ qua. Muốn seed lại → xoá demo cũ tay.');
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // ── 1. Phòng ban (cây: BGĐ root → 4 phòng con) ─────────────────────
  console.log('→ Tạo 5 phòng ban...');
  const bgd = await prisma.department.create({
    data: { orgId: ORG_ID, name: 'Ban Giám Đốc', parentId: null, path: 'tmp', depth: 0, displayOrder: 0 },
  });
  await prisma.department.update({ where: { id: bgd.id }, data: { path: `/${bgd.id}/` } });

  const childDeptNames = ['Phòng Kinh Doanh', 'Phòng Marketing', 'Phòng Chăm Sóc Khách Hàng', 'Phòng Kỹ Thuật'];
  const childDepts: { id: string; name: string }[] = [];
  for (let i = 0; i < childDeptNames.length; i++) {
    const d = await prisma.department.create({
      data: { orgId: ORG_ID, name: childDeptNames[i], parentId: bgd.id, path: 'tmp', depth: 1, displayOrder: i + 1 },
    });
    await prisma.department.update({ where: { id: d.id }, data: { path: `/${bgd.id}/${d.id}/` } });
    childDepts.push({ id: d.id, name: childDeptNames[i] });
  }
  const allDepts = [{ id: bgd.id, name: 'Ban Giám Đốc' }, ...childDepts];

  // Phân bổ 30 nhân viên: BGĐ 2, KD 12, MKT 6, CSKH 7, KT 3
  const distribution: { deptIdx: number; count: number }[] = [
    { deptIdx: 0, count: 2 }, { deptIdx: 1, count: 12 }, { deptIdx: 2, count: 6 },
    { deptIdx: 3, count: 7 }, { deptIdx: 4, count: 3 },
  ];

  // ── 2. 30 nhân viên + gán phòng ban ────────────────────────────────
  console.log('→ Tạo 30 nhân viên...');
  const saleUserIds: string[] = [];
  let empSeq = 0;
  for (const { deptIdx, count } of distribution) {
    const dept = allDepts[deptIdx];
    for (let j = 0; j < count; j++) {
      empSeq++;
      const phone = `84901${String(empSeq).padStart(6, '0')}`; // normalized cua 0901000001..030 (login go 0901000001)
      const name = fullName();
      const u = await prisma.user.create({
        data: {
          orgId: ORG_ID,
          fullName: name,
          phone,
          email: `nv${empSeq}.demo@thienphuc.vn`,
          passwordHash,
          role: deptIdx === 0 ? 'admin' : 'member',
          isActive: true,
        },
      });
      await prisma.departmentMember.create({
        data: { departmentId: dept.id, userId: u.id, deptRole: j === 0 ? 'leader' : 'member' },
      });
      if (deptIdx === 1 || deptIdx === 3) saleUserIds.push(u.id); // KD + CSKH = sale chăm KH
    }
  }
  if (!saleUserIds.length) saleUserIds.push(owner.id);

  // ── 3. ~120 khách hàng demo ────────────────────────────────────────
  console.log('→ Tạo 120 khách hàng demo...');
  const contactIds: string[] = [];
  for (let i = 1; i <= 120; i++) {
    const c = await prisma.contact.create({
      data: {
        orgId: ORG_ID,
        fullName: fullName(),
        phone: `09870${String(i).padStart(5, '0')}`,
        phoneNormalized: `84987${String(i).padStart(6, '0')}`,
        source: rand(SOURCES),
        status: rand(STATUSES),
        assignedUserId: rand(saleUserIds),
        leadScore: randInt(0, 100),
        gender: rand(['male', 'female']),
        province: rand(PROVINCES),
        tags: Math.random() < 0.5 ? [rand(CRM_TAGS)] : [],
        metadata: { demo: true },
        sourceDate: new Date(Date.now() - randInt(0, 90) * 86400000),
      },
    });
    contactIds.push(c.id);
  }

  // ── 4. MARKETING — templates ───────────────────────────────────────
  console.log('→ Tạo templates...');
  const mtFolder = await prisma.messageTemplateFolder.create({
    data: { orgId: ORG_ID, name: 'Mẫu tin chung', createdById: owner.id, visibility: 'public' },
  });
  const templates = [
    { name: 'Chào khách mới', shortcut: '/chao', content: 'Dạ em chào anh/chị ạ! Em là tư vấn viên bên Thiên Phúc, anh/chị cần em hỗ trợ gì ạ?' },
    { name: 'Gửi báo giá', shortcut: '/baogia', content: 'Dạ em gửi anh/chị bảng báo giá chi tiết ạ. Anh/chị tham khảo giúp em nhé!' },
    { name: 'Nhắc hẹn', shortcut: '/nhachen', content: 'Dạ em nhắc anh/chị mình có lịch hẹn vào ngày mai ạ. Anh/chị sắp xếp được không ạ?' },
    { name: 'Cảm ơn sau mua', shortcut: '/camon', content: 'Em cảm ơn anh/chị đã tin tưởng Thiên Phúc ạ! Có gì cần hỗ trợ anh/chị nhắn em nhé.' },
    { name: 'Chăm sóc định kỳ', shortcut: '/csdk', content: 'Dạ anh/chị dạo này khoẻ không ạ? Bên em có chương trình ưu đãi mới, em gửi anh/chị tham khảo nhé!' },
  ];
  for (const t of templates) {
    await prisma.messageTemplate.create({
      data: { orgId: ORG_ID, folderId: mtFolder.id, name: t.name, shortcut: t.shortcut, content: t.content, createdById: owner.id, visibility: 'public', category: 'CSKH' },
    });
  }

  // ── 5. MARKETING — blocks ──────────────────────────────────────────
  console.log('→ Tạo blocks...');
  const blockFolder = await prisma.blockFolder.create({
    data: { orgId: ORG_ID, name: 'Khối automation', createdById: owner.id },
  });
  const mkData = (actionType: string, content: object) => ({
    orgId: ORG_ID, folderId: blockFolder.id, name: '', actionType, content, createdById: owner.id,
  });
  const blocks: { id: string; name: string }[] = [];
  const blockDefs = [
    { name: 'Kết bạn khách FB', actionType: 'request_friend', content: { greetingVariants: ['Chào anh/chị, em là tư vấn viên bên Thiên Phúc, kết bạn để em hỗ trợ mình ạ!', 'Em chào anh/chị, em bên Thiên Phúc ạ, anh/chị kết bạn giúp em nhé!'] } },
    { name: 'Tin chào lead mới', actionType: 'send_message', content: { textVariants: ['Dạ em chào anh/chị, em hỗ trợ tư vấn sản phẩm bên Thiên Phúc ạ!', 'Em chào anh/chị ạ, anh/chị quan tâm sản phẩm nào để em tư vấn kỹ hơn ạ?'] } },
    { name: 'Tin gửi ưu đãi', actionType: 'send_message', content: { textVariants: ['Bên em đang có ưu đãi giảm 20% cho khách mới ạ, anh/chị tham khảo nhé!'] } },
    { name: 'Tin nhắc chốt đơn', actionType: 'send_message', content: { textVariants: ['Dạ ưu đãi áp dụng đến cuối tuần này thôi ạ, anh/chị cân nhắc sớm giúp em nhé!'] } },
  ];
  for (const b of blockDefs) {
    const created = await prisma.block.create({ data: { ...mkData(b.actionType, b.content), name: b.name } });
    blocks.push({ id: created.id, name: b.name });
  }

  // ── 6. MARKETING — sequences + steps ───────────────────────────────
  console.log('→ Tạo sequences...');
  const seq1 = await prisma.automationSequence.create({
    data: { orgId: ORG_ID, name: 'Chuỗi chăm sóc lead mới', description: 'Chào → ưu đãi → nhắc chốt', createdById: owner.id, enabled: true },
  });
  const seqSteps1 = [blocks[1], blocks[2], blocks[3]]; // chào, ưu đãi, nhắc chốt
  for (let i = 0; i < seqSteps1.length; i++) {
    await prisma.sequenceStep.create({
      data: { sequenceId: seq1.id, blockId: seqSteps1[i].id, stepOrder: i + 1, delayMinutes: i === 0 ? 0 : randInt(60, 2880) },
    });
  }
  const seq2 = await prisma.automationSequence.create({
    data: { orgId: ORG_ID, name: 'Chuỗi kết bạn & chào', description: 'Kết bạn → chào hỏi', createdById: owner.id, enabled: true },
  });
  await prisma.sequenceStep.create({ data: { sequenceId: seq2.id, blockId: blocks[0].id, stepOrder: 1, delayMinutes: 0 } });
  await prisma.sequenceStep.create({ data: { sequenceId: seq2.id, blockId: blocks[1].id, stepOrder: 2, delayMinutes: 120 } });

  const seq3 = await prisma.automationSequence.create({
    data: { orgId: ORG_ID, name: 'Chuỗi tái kích hoạt KH cũ', description: 'Chăm sóc định kỳ', createdById: owner.id, enabled: false },
  });
  await prisma.sequenceStep.create({ data: { sequenceId: seq3.id, blockId: blocks[2].id, stepOrder: 1, delayMinutes: 0 } });

  // ── 7. MARKETING — broadcasts ──────────────────────────────────────
  console.log('→ Tạo broadcasts...');
  const broadcasts: { id: string }[] = [];
  const bcDefs = [
    { name: 'Broadcast ưu đãi tháng 6', blockId: blocks[2].id, scheduleKind: 'now', state: 'completed', total: 120, sent: 118 },
    { name: 'Broadcast chốt cuối tuần', blockId: blocks[3].id, scheduleKind: 'scheduled', state: 'scheduled', total: 80, sent: 0 },
    { name: 'Broadcast chào KH mới', blockId: blocks[1].id, scheduleKind: 'now', state: 'draft', total: 0, sent: 0 },
  ];
  for (const bc of bcDefs) {
    const created = await prisma.automationBroadcast.create({
      data: {
        orgId: ORG_ID, name: bc.name, blockId: bc.blockId,
        segmentSpec: { type: 'filter', filters: [{ field: 'status', op: 'in', value: ['interested', 'contacted'] }] },
        scheduleKind: bc.scheduleKind, state: bc.state,
        scheduledAt: bc.scheduleKind === 'scheduled' ? new Date(Date.now() + 2 * 86400000) : null,
        totalRecipients: bc.total, sentCount: bc.sent, deliveredCount: bc.sent, createdById: owner.id,
      },
    });
    broadcasts.push({ id: created.id });
  }

  // ── 8. MARKETING — triggers ────────────────────────────────────────
  console.log('→ Tạo triggers...');
  const triggerDefs = [
    { name: 'Tự động chào khi có lead mới', eventType: 'contact_created', category: 'general', bindingKind: 'sequence', sequenceId: seq1.id, state: 'active' },
    { name: 'Kết bạn khi khách nhắn từ khoá', eventType: 'keyword', category: 'keyword', bindingKind: 'block', blockId: blocks[0].id, state: 'active', eventFilter: { keywords: ['quan tâm', 'báo giá', 'tư vấn'] } },
    { name: 'Gửi ưu đãi khi khách inbox', eventType: 'message_received', category: 'general', bindingKind: 'broadcast', broadcastId: broadcasts[0].id, state: 'paused' },
    { name: 'Chuỗi kết bạn tự động', eventType: 'contact_created', category: 'general', bindingKind: 'sequence', sequenceId: seq2.id, state: 'draft' },
  ];
  const triggers: { id: string }[] = [];
  for (const t of triggerDefs) {
    const created = await prisma.automationTrigger.create({
      data: {
        orgId: ORG_ID, name: t.name, eventType: t.eventType, category: t.category,
        bindingKind: t.bindingKind, sequenceId: (t as any).sequenceId ?? null,
        blockId: (t as any).blockId ?? null, broadcastId: (t as any).broadcastId ?? null,
        eventFilter: (t as any).eventFilter ?? undefined,
        state: t.state, enabled: t.state === 'active', createdById: owner.id,
      },
    });
    triggers.push({ id: created.id });
  }

  // ── 9. MARKETING — care-sessions (cần nick connected) ──────────────
  console.log('→ Tạo care-sessions...');
  const nick = await prisma.zaloAccount.findFirst({
    where: { orgId: ORG_ID, archivedAt: null },
    orderBy: { lastConnectedAt: 'desc' },
    select: { id: true, ownerUserId: true },
  });
  if (nick) {
    const careContactIds = contactIds.slice(0, 12);
    const states = ['active', 'active', 'active', 'closed'];
    const closedReasons = ['sale_resolved', 'deal_won', 'janitor_silence', 'customer_blocked'];
    for (let i = 0; i < careContactIds.length; i++) {
      const state = rand(states);
      const cs = await prisma.careSession.create({
        data: {
          orgId: ORG_ID, contactId: careContactIds[i], nickId: nick.id,
          ownerUserId: nick.ownerUserId ?? owner.id,
          sourceType: i % 2 === 0 ? 'trigger' : 'sequence_manual',
          sourceTriggerId: i % 2 === 0 ? triggers[0].id : null,
          state,
          closedReason: state === 'closed' ? rand(closedReasons) : null,
          closedAt: state === 'closed' ? new Date() : null,
          interestWindowUntil: new Date(Date.now() + randInt(1, 7) * 86400000),
          lastCustomerActivityAt: new Date(Date.now() - randInt(0, 5) * 86400000),
        },
      });
      // vài event log
      await prisma.careSessionEvent.create({
        data: { sessionId: cs.id, eventId: `demo-open-${cs.id}`, eventType: 'opened', payload: { demo: true } },
      });
      if (Math.random() < 0.6) {
        await prisma.careSessionEvent.create({
          data: { sessionId: cs.id, eventId: `demo-reply-${cs.id}`, eventType: 'reply', payload: { text: 'Khách quan tâm sản phẩm' } },
        });
      }
    }
  } else {
    console.log('  ⚠ Không có nick Zalo nào → bỏ qua care-sessions.');
  }

  console.log('\n✅ HOÀN TẤT seed demo:');
  console.log(`   - 5 phòng ban, 30 nhân viên (mật khẩu: ${DEMO_PASSWORD}, login bằng phone 0901000001..030 hoặc email nvN.demo@thienphuc.vn)`);
  console.log('   - 120 khách hàng demo');
  console.log('   - Marketing: 5 templates, 4 blocks, 3 sequences, 3 broadcasts, 4 triggers, ~12 care-sessions');
}

main()
  .catch((e) => { console.error('❌ Seed lỗi:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
