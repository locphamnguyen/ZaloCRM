/**
 * privacy-redact-regression.test.ts — Test hồi quy BẢO MẬT Riêng tư (2026-06-11, Đợt 3.2).
 *
 * Vùng cực nhạy cảm: nick Riêng tư (privacyMode='main') lộ nội dung tin nhắn / PII
 * khách cho cấp trên / đồng nghiệp không phải chính chủ = mất niềm tin hệ thống.
 * Test này khoá các BẤT BIẾN của tầng redact để mọi thay đổi tương lai không tái phạm.
 *
 * Quy tắc vàng (canSeeConversationContent):
 *   Nội dung/PII của nick main CHỈ hiện khi viewer LÀ CHỦ NICK *VÀ* ĐÃ UNLOCK OTP.
 *   admin/owner org KHÔNG được miễn trừ. Nick 'sub' (Thường) luôn hiện đầy đủ.
 */
import { describe, it, expect } from 'vitest';
import {
  canSeeConversationContent,
  redactMessage,
  redactFriend,
  redactContact,
  PRIVACY_BLUR_TOKEN,
  type PrivacyContext,
} from '../src/modules/privacy/redact.js';

const BLUR = PRIVACY_BLUR_TOKEN;

const mainNick = { zaloAccount: { privacyMode: 'main', ownerUserId: 'OWNER' } };
const subNick = { zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' } };

const ctxOwnerUnlocked: PrivacyContext = { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: true };
const ctxOwnerLocked: PrivacyContext = { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: false };
const ctxOther: PrivacyContext = { viewerUserId: 'STRANGER', orgId: 'O1', privacyUnlocked: false };
// "admin xem" mô phỏng: vẫn là 1 viewer khác chủ nick → KHÔNG được miễn trừ.
const ctxAdminLike: PrivacyContext = { viewerUserId: 'ADMIN', orgId: 'O1', privacyUnlocked: true };

describe('canSeeConversationContent — quy tắc vàng', () => {
  it('nick sub luôn xem được (mọi viewer)', () => {
    expect(canSeeConversationContent(subNick, ctxOther)).toBe(true);
    expect(canSeeConversationContent(subNick, ctxOwnerLocked)).toBe(true);
  });
  it('nick main: chỉ chủ nick + đã unlock', () => {
    expect(canSeeConversationContent(mainNick, ctxOwnerUnlocked)).toBe(true);
  });
  it('nick main: chủ nick CHƯA unlock → KHÔNG xem', () => {
    expect(canSeeConversationContent(mainNick, ctxOwnerLocked)).toBe(false);
  });
  it('nick main: người khác (kể cả đã unlock của chính họ) → KHÔNG xem', () => {
    expect(canSeeConversationContent(mainNick, ctxOther)).toBe(false);
    expect(canSeeConversationContent(mainNick, ctxAdminLike)).toBe(false);
  });
});

describe('redactMessage — nội dung tin nhắn nick main', () => {
  const msg = {
    id: 'm1', conversationId: 'c1', content: 'GIA CAN HO 5 TY',
    originalContent: 'GIA CAN HO 5 TY', senderName: 'Chị Lan', senderUid: 'uid_lan',
    attachments: [{ url: 'http://x/cmnd.jpg' }], contentType: 'image',
    senderType: 'contact', sentAt: new Date(),
  };
  it('người khác → content + đính kèm + tên người gửi đều bị che', () => {
    const r = redactMessage(msg, mainNick, ctxOther);
    expect(r.content).toBe(BLUR);
    expect(r.attachments).toEqual([]);
    expect(r.senderName).toBeNull();
    expect(r.senderUid).toBeNull();
    expect(r.contentType).toBe('text'); // ẩn cả loại (image leak signal)
    expect(r.redacted).toBe(true);
  });
  it('chủ nick đã unlock → nội dung thật', () => {
    const r = redactMessage(msg, mainNick, ctxOwnerUnlocked);
    expect(r.content).toBe('GIA CAN HO 5 TY');
    expect(r.redacted).toBeUndefined();
  });
  it('nick sub → nội dung thật cho mọi người', () => {
    const r = redactMessage(msg, subNick, ctxOther);
    expect(r.content).toBe('GIA CAN HO 5 TY');
  });
});

describe('redactFriend — preview tin + danh tính KH nick main', () => {
  const friend = {
    id: 'f1', aliasInNick: 'KH VIP', zaloUidInNick: 'uid_kh',
    lastInboundPreview: 'Em oi con hang khong', lastOutboundPreview: 'Da con anh',
    zaloDisplayName: 'Tai Nguyen', zaloGlobalId: 'g1', zaloUsername: 't_tai',
    zaloAvatarUrl: 'http://x/a.jpg', leadScore: 90,
    contact: { id: 'c1', fullName: 'Nguyen Van Tai', crmName: 'Tai', phone: '0901', email: 'a@b.c' },
    zaloAccount: { privacyMode: 'main', ownerUserId: 'OWNER' },
  };
  it('người khác → blur preview/alias/danh tính + PII nhúng, GIỮ metadata', () => {
    const r: any = redactFriend(friend, ctxOther);
    expect(r.aliasInNick).toBe(BLUR);
    expect(r.zaloUidInNick).toBeNull();
    expect(r.lastInboundPreview).toBe(BLUR);
    expect(r.lastOutboundPreview).toBe(BLUR);
    expect(r.zaloDisplayName).toBe(BLUR);
    expect(r.zaloGlobalId).toBeNull();
    expect(r.zaloUsername).toBeNull();
    expect(r.contact.fullName).toBe(BLUR);
    expect(r.contact.phone).toBeNull();
    expect(r.leadScore).toBe(90); // metadata GIỮ
    expect(r.redacted).toBe(true);
  });
  it('chủ nick đã unlock → thật', () => {
    const r: any = redactFriend(friend, { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: true });
    expect(r.aliasInNick).toBe('KH VIP');
    expect(r.redacted).toBeUndefined();
  });
  it('nick sub → thật', () => {
    const r: any = redactFriend({ ...friend, zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' } }, ctxOther);
    expect(r.aliasInNick).toBe('KH VIP');
  });
  it('FAIL-CLOSED: thiếu privacyMode (select sót) → vẫn blur', () => {
    const r: any = redactFriend({ ...friend, zaloAccount: { ownerUserId: 'OWNER' } } as any, ctxOther);
    expect(r.aliasInNick).toBe(BLUR);
    expect(r.redacted).toBe(true);
  });
});

describe('redactContact — PII khách hàng', () => {
  const contact = {
    id: 'c1', orgId: 'O1', fullName: 'Nguyen Van Tai', phone: '0901', email: 'a@b.c',
    leadScore: 70, engagementScore: 5,
  };
  it('blur fullName + giữ metadata score', () => {
    const r = redactContact(contact, ctxOther);
    expect(r.fullName).toBe(BLUR);
    expect(r.redacted).toBe(true);
    expect(r.leadScore).toBe(70);
    // PII thật KHÔNG được lọt qua (allowlist — không spread object gốc)
    expect(r.phone).toBeUndefined();
    expect(r.email).toBeUndefined();
  });
});
