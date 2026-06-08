// Module dùng chung: render biến template trong nội dung Khối.
// 2026-06-07 — tách từ engine/action-handlers/send-message.ts để CẢ engine handler
// LẪN endpoint chat "gửi Khối vào hội thoại" dùng CHUNG một logic render, không lệch.
//
// Chuẩn anh chốt 2026-05-28:
//   {gender} — "Anh"/"Chị"/"Anh Chị" lấy từ Contact.gender (fallback "Anh Chị")
//   {name}   — last word của Contact.fullName (VN convention)
//   {sale}   — last word của user.fullName (chủ nick được assigned)

import { prisma } from '../../../shared/database/prisma-client.js';

/**
 * Render template variables {gender}/{name}/{sale}.
 * @param raw            chuỗi gốc (có thể chứa {gender}/{name}/{sale})
 * @param contactId      Contact để lấy fullName + gender
 * @param assignedNickId ZaloAccount.id — chủ nick → {sale}
 */
export async function renderTemplate(
  raw: string,
  contactId: string,
  assignedNickId: string,
): Promise<string> {
  if (!raw.includes('{')) return raw;

  const [contact, ownerUser] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { fullName: true, gender: true },
    }),
    prisma.user.findFirst({
      where: { zaloAccounts: { some: { id: assignedNickId } } },
      select: { fullName: true },
    }),
  ]);

  const genderStr =
    contact?.gender === 'female' ? 'Chị' : contact?.gender === 'male' ? 'Anh' : 'Anh Chị';
  const name = (contact?.fullName ?? '').trim().split(/\s+/).pop() ?? 'Anh Chị';
  const sale = (ownerUser?.fullName ?? 'em').trim().split(/\s+/).pop() ?? 'em';

  return raw
    .replaceAll('{gender}', genderStr)
    .replaceAll('{name}', name)
    .replaceAll('{sale}', sale);
}
