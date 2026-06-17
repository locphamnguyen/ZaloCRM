// Module dùng chung: render biến template trong nội dung Khối.
// 2026-06-07 — tách từ engine/action-handlers/send-message.ts để CẢ engine handler
// LẪN endpoint chat "gửi Khối vào hội thoại" dùng CHUNG một logic render, không lệch.
//
// ~36 BIẾN (Phase 1 module Attribute — anh chốt 2026-06-17, mở rộng từ 8 biến 2026-06-15).
// Lôi từ bảng Khách hàng (Cha) + Friend row (per-nick). Phân cấp:
//   • KH Cha (cố định theo người): gender/name*/phone/email/facebook/tiktok/age/occupation/
//     province/district/ward/address/income/status/source/next_appt/score/first_active/
//     last_active/last_message/last_inbound/last_outbound/last_interaction
//   • Per-nick (đổi theo nick đang chat): crm_*/uid/nick_name/kb_status/became_friend/
//     nick_status/msg_count  ← từ Friend(contactId × assignedNickId)
//   • Sale (theo nick gửi): sale/sale_full
// Fallback: biến tên/xưng hô → "Anh Chị"/"em"; biến dữ kiện (sđt, fb, ngày…) → "" (rỗng, không
// hiện "null"/giữ token). Biến không tồn tại trong text → giữ nguyên.

import { prisma } from '../../../shared/database/prisma-client.js';

export interface TemplateVarValues {
  // Tên & xưng hô
  gender: string; name: string; name_full: string; name_first: string;
  crm_full: string; crm_first: string; crm_last: string;
  // Liên hệ & MXH
  phone: string; email: string; facebook: string; tiktok: string;
  // Nhân khẩu & địa chỉ
  age: string; occupation: string; province: string; district: string; ward: string; address: string; income: string;
  // Pipeline / CRM
  status: string; nick_status: string; source: string; next_appt: string; score: string;
  // Hoạt động & tương tác
  first_active: string; last_active: string; last_message: string;
  last_inbound: string; last_outbound: string; last_interaction: string; msg_count: string;
  // Per-nick (Friend)
  uid: string; nick_name: string; kb_status: string; became_friend: string;
  // Sale
  sale: string; sale_full: string;
}

const TOKEN_ORDER: Array<keyof TemplateVarValues> = [
  'gender', 'name', 'name_full', 'name_first', 'crm_full', 'crm_first', 'crm_last',
  'phone', 'email', 'facebook', 'tiktok',
  'age', 'occupation', 'province', 'district', 'ward', 'address', 'income',
  'status', 'nick_status', 'source', 'next_appt', 'score',
  'first_active', 'last_active', 'last_message', 'last_inbound', 'last_outbound', 'last_interaction', 'msg_count',
  'uid', 'nick_name', 'kb_status', 'became_friend',
  'sale', 'sale_full',
];

const firstWord = (s: string) => s.trim().split(/\s+/)[0] ?? '';
const lastWord = (s: string) => { const w = s.trim().split(/\s+/); return w[w.length - 1] ?? ''; };
const fmtDate = (d: Date | null | undefined): string =>
  d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
const KB_LABEL: Record<string, string> = {
  friend: 'Đã kết bạn', pending_friend: 'Đã gửi mời', chatting_stranger: 'Đang nhắn lạ', ghost: 'Đã ngắt', none: 'Người lạ',
};

/**
 * Query DB + tính ~36 giá trị biến. DÙNG CHUNG cho renderTemplate + renderTemplateDetailed (DRY).
 * @param contactId      Contact (KH Cha) → mọi biến cấp người
 * @param assignedNickId ZaloAccount.id — chủ nick → {sale*}; + Friend(contactId×nick) → {crm_*}/{uid}/per-nick
 */
async function resolveVars(contactId: string, assignedNickId: string): Promise<TemplateVarValues> {
  const [contact, ownerUser, friend, nick] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        fullName: true, gender: true, phone: true, email: true,
        socialFacebook: true, socialTiktok: true,
        birthYear: true, occupation: true, incomeRange: true,
        province: true, district: true, ward: true, addressLine: true,
        source: true, nextAppointment: true, leadScore: true,
        firstContactDate: true, lastActivity: true,
        lastInboundAt: true, lastInboundPreview: true,
        lastOutboundAt: true, lastInteractionAt: true,
        statusRef: { select: { name: true } },
      },
    }),
    prisma.user.findFirst({ where: { zaloAccounts: { some: { id: assignedNickId } } }, select: { fullName: true } }),
    // Friend row PER-NICK (cặp contactId × nick đang chat) → tên gợi nhớ, uid, quan hệ, status per-nick.
    prisma.friend.findFirst({
      where: { contactId, zaloAccountId: assignedNickId },
      select: {
        aliasInNick: true, zaloUidInNick: true, relationshipKind: true, becameFriendAt: true,
        totalInbound: true, totalOutbound: true, statusRef: { select: { name: true } },
      },
    }),
    prisma.zaloAccount.findUnique({ where: { id: assignedNickId }, select: { displayName: true } }),
  ]);

  const fullName = (contact?.fullName ?? '').trim();
  const saleFull = (ownerUser?.fullName ?? 'em').trim();
  // Tên gợi nhớ: ưu tiên aliasInNick per-nick; trống → fallback tên thật KH (anh chốt).
  const crmFull = ((friend?.aliasInNick ?? '').trim()) || fullName;
  const age = contact?.birthYear ? String(new Date().getFullYear() - contact.birthYear) : '';

  return {
    gender: contact?.gender === 'female' ? 'Chị' : contact?.gender === 'male' ? 'Anh' : 'Anh Chị',
    name: lastWord(fullName) || 'Anh Chị',
    name_full: fullName || 'Anh Chị',
    name_first: firstWord(fullName),
    crm_full: crmFull || 'Anh Chị',
    crm_first: firstWord(crmFull) || 'Anh Chị',
    crm_last: lastWord(crmFull) || 'Anh Chị',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    facebook: contact?.socialFacebook ?? '',
    tiktok: contact?.socialTiktok ?? '',
    age,
    occupation: contact?.occupation ?? '',
    province: contact?.province ?? '',
    district: contact?.district ?? '',
    ward: contact?.ward ?? '',
    address: contact?.addressLine ?? '',
    income: contact?.incomeRange ?? '',
    status: contact?.statusRef?.name ?? '',
    nick_status: friend?.statusRef?.name ?? '',
    source: contact?.source ?? '',
    next_appt: fmtDate(contact?.nextAppointment),
    score: contact?.leadScore != null ? String(contact.leadScore) : '',
    first_active: fmtDate(contact?.firstContactDate),
    last_active: fmtDate(contact?.lastActivity),
    last_message: (contact?.lastInboundPreview ?? '').trim(),
    last_inbound: fmtDate(contact?.lastInboundAt),
    last_outbound: fmtDate(contact?.lastOutboundAt),
    last_interaction: fmtDate(contact?.lastInteractionAt),
    msg_count: friend ? `${friend.totalInbound}/${friend.totalOutbound}` : '',
    uid: friend?.zaloUidInNick ?? '',
    nick_name: nick?.displayName ?? '',
    kb_status: friend ? (KB_LABEL[friend.relationshipKind] ?? '') : '',
    became_friend: fmtDate(friend?.becameFriendAt),
    sale: lastWord(saleFull) || 'em',
    sale_full: saleFull || 'em',
  };
}

/** Thay 8 token {key} bằng giá trị. Thứ tự cố định (TOKEN_ORDER) cho shiftStylesForRender khớp. */
function applyVars(raw: string, v: TemplateVarValues): string {
  let out = raw;
  for (const k of TOKEN_ORDER) out = out.replaceAll(`{${k}}`, v[k]);
  return out;
}

/**
 * Render 8 biến template trong chuỗi.
 * @param raw            chuỗi gốc (có thể chứa các token {gender}/{name}/{crm_full}/...)
 * @param contactId      Contact để lấy fullName + gender + tên gợi nhớ fallback
 * @param assignedNickId ZaloAccount.id — chủ nick → {sale*}; xác định Friend per-nick → {crm_*}
 */
export async function renderTemplate(
  raw: string,
  contactId: string,
  assignedNickId: string,
): Promise<string> {
  if (!raw.includes('{')) return raw;
  const v = await resolveVars(contactId, assignedNickId);
  return applyVars(raw, v);
}

/**
 * Như renderTemplate nhưng TRẢ THÊM các giá trị biến đã resolve — để shiftStylesForRender (D6)
 * dịch offset format theo độ dài giá trị thật. values rỗng nếu raw không chứa biến.
 */
export async function renderTemplateDetailed(
  raw: string,
  contactId: string,
  assignedNickId: string,
): Promise<{ rendered: string; values: TemplateVarValues }> {
  const empty = Object.fromEntries(TOKEN_ORDER.map((k) => [k, ''])) as unknown as TemplateVarValues;
  if (!raw.includes('{')) return { rendered: raw, values: empty };
  const v = await resolveVars(contactId, assignedNickId);
  return { rendered: applyVars(raw, v), values: v };
}

type Style = { st: string; start: number; len: number };

/**
 * GĐ Block-media (2026-06-13 D6): giữ ĐỊNH DẠNG (đậm/màu) khi text có biến {name}/{gender}/{sale}.
 *
 * Vấn đề: style {start,len} là offset ký tự trên text GỐC. Sau khi renderTemplate thay biến
 * (vd "{name}"→"Thành"), độ dài đổi → offset cũ lệch. Trước đây code BỎ HẾT style khi có '{'
 * (an toàn nhưng MẤT format).
 *
 * Cách AN TOÀN (KHÔNG đếm offset mù — bài học off-by-one tiếng Việt [[reference_ai_phrase_based_pattern]]):
 * tái chạy replace TỪNG token theo thứ tự, dịch start/len của style theo độ lệch độ dài THẬT của
 * biến tại vị trí token. Quy tắc dịch chuẩn:
 *   - token NẰM TRƯỚC style (token.end ≤ style.start): dịch CẢ start (start += delta).
 *   - token NẰM TRONG style (token nằm gọn trong [start, start+len)): MỞ RỘNG len (len += delta).
 *   - token CẮT NGANG ranh giới style: KHÔNG an toàn → trả null (caller fallback bỏ style).
 *   - token NẰM SAU style: không ảnh hưởng.
 * delta = (độ dài giá trị thật) − (độ dài token). Giá trị thật suy ngược từ rawText vs renderedText
 * KHÔNG đáng tin (trùng lặp), nên ta nhận map gender/name/sale value VÀO hàm.
 *
 * @returns styles đã dịch, HOẶC null nếu không an toàn (caller bỏ style — giữ hành vi cũ).
 */
export function shiftStylesForRender(
  rawText: string,
  styles: Style[],
  values: TemplateVarValues,
): Style[] | null {
  if (!styles.length) return styles;
  if (!rawText.includes('{')) return styles; // không có biến → offset giữ nguyên

  // Regex từ TOKEN_ORDER, sort DÀI→NGẮN để alternation không match nhầm phần đầu
  // (vd {name_full} không bị {name} ăn mất) — JS regex ưu tiên nhánh đầu khớp.
  const keysByLen = [...TOKEN_ORDER].sort((a, b) => b.length - a.length);
  const tokenRe = new RegExp('\\{(' + keysByLen.join('|') + ')\\}', 'g');
  const tokens: Array<{ start: number; end: number; delta: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rawText)) !== null) {
    const key = m[1] as keyof TemplateVarValues;
    const valueLen = [...(values[key] ?? '')].length; // guard: biến thiếu → coi như rỗng
    const tokenLen = m[0].length;
    tokens.push({ start: m.index, end: m.index + tokenLen, delta: valueLen - tokenLen });
  }
  if (tokens.length === 0) return styles;

  const out: Style[] = [];
  for (const s of styles) {
    let start = s.start;
    let len = s.len;
    const sEnd = s.start + s.len;
    for (const t of tokens) {
      if (t.end <= s.start) {
        start += t.delta;            // token đứng trước → dời cả vùng
      } else if (t.start >= s.start && t.end <= sEnd) {
        len += t.delta;              // token nằm gọn trong vùng → giãn/co len
      } else if (t.start < sEnd && t.end > s.start) {
        return null;                 // cắt ngang ranh giới → không an toàn
      }
      // token sau vùng (t.start ≥ sEnd) → bỏ qua
    }
    if (start < 0 || len <= 0) return null; // phòng lệch âm bất thường
    out.push({ st: s.st, start, len });
  }
  return out;
}
