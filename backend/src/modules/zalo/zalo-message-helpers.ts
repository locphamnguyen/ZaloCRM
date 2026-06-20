// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-message-helpers.ts — utilities for processing incoming Zalo messages.
 * Detects content type from msgType and updates contact avatars fire-and-forget.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

// Well-known msgType keyword patterns — used to suppress noise logging
const KNOWN_MSG_TYPE_PATTERNS = [
  'photo', 'image', 'sticker', 'video', 'voice',
  'gif', 'link', 'location', 'file', 'doc',
  'recommended', 'card', 'bank', 'transfer',
  'call', 'voip', 'qr', 'remind', 'todo',
  'poll', 'vote', 'note', 'forward',
];

/**
 * Map zca-js msgType string to a normalized content type label.
 * Falls back to 'text' for unrecognised types or plain-string content.
 */
export function detectContentType(msgType: string | undefined, content: any): string {
  if (!msgType) return 'text';

  // ── FIX 2026-05-21: action-based dispatch PHẢI chạy trước msgType keyword check ──
  // Zalo wrap call/bank/qr trong cùng family "recommended.*" → nếu để keyword check
  // "recommended/card" ăn trước, call message sẽ bị classify nhầm thành 'contact_card'
  // (KH gọi 39s lúc 12:10 = content_type='contact_card' thay vì 'call' → bị bỏ qua
  // trong engagement call_count). Lưu ý: Zalo có typo "recommened" (thiếu chữ 'd') —
  // match cả 2 để safe.
  if (typeof content === 'object' && content !== null) {
    const action = typeof content.action === 'string' ? content.action : '';
    if (action.includes('calltime') || action.includes('misscall')) return 'call';
    if (action === 'zinstant.bankcard') return 'bank_transfer';
    if (typeof content.description === 'string' && content.description.includes('qrCodeUrl')) {
      return 'qr_code';
    }
    // FIX G1 2026-05-21: action="recommened.link" / "recommended.link" = KH share link
    // có preview (FB reel, Maps, YouTube...) — lẽ ra phải là 'link', không phải 'contact_card'.
    // 635 row cũ bị classify sai vì rơi vào keyword check "recommended/card" ở dưới.
    // Yêu cầu thêm href hợp lệ để tránh false-positive với link rỗng.
    if (
      (action === 'recommened.link' || action === 'recommended.link') &&
      typeof content.href === 'string' && content.href.startsWith('http')
    ) {
      return 'link';
    }
    // Fallback shape detection cho call (1 số SDK version dùng key khác)
    if (content.callDuration !== undefined || content.callType !== undefined) return 'call';
  }

  if (msgType.includes('photo') || msgType.includes('image')) return 'image';
  if (msgType.includes('sticker')) return 'sticker';
  if (msgType.includes('video')) return 'video';
  if (msgType.includes('voice')) return 'voice';
  if (msgType.includes('gif')) return 'gif';
  if (msgType.includes('link')) return 'link';
  if (msgType.includes('location')) return 'location';
  if (msgType.includes('file') || msgType.includes('doc')) return 'file';
  if (msgType.includes('recommended') || msgType.includes('card')) return 'contact_card';

  // Special message types
  if (msgType.includes('bank') || msgType.includes('transfer')) return 'bank_transfer';
  if (msgType.includes('call') || msgType.includes('voip')) return 'call';
  if (msgType.includes('qr')) return 'qr_code';
  if (msgType.includes('remind') || msgType.includes('todo')) return 'reminder';
  if (msgType.includes('poll') || msgType.includes('vote')) return 'poll';
  if (msgType.includes('note')) return 'note';
  if (msgType.includes('forward')) return 'forwarded';

  // Check content object shape for action-based messages
  if (typeof content === 'object' && content !== null) {
    const action = typeof content.action === 'string' ? content.action : '';
    // Zalo dùng action "recommened.calltime" (gọi thành công) / "recommened.misscall" (nhỡ)
    // Lưu ý typo "recommened" thay vì "recommended" — match cả 2.
    if (action.includes('calltime') || action.includes('misscall')) return 'call';
    if (action === 'msginfo.actionlist' || action === 'rtf') {
      // rtf = rich-text-format (bot Smax/Zalo gửi) — vẫn rich
      if (action === 'msginfo.actionlist') return 'reminder';
    }
    // QR Code (VietQR/bank): description chứa JSON string với key qrCodeUrl
    // Zalo lưu dưới contact_card variant — detect bằng content shape thay vì msgType
    if (typeof content.description === 'string' && content.description.includes('qrCodeUrl')) {
      return 'qr_code';
    }
    // Bank account card (zinstant variant): action='zinstant.bankcard', title/href trống,
    // bank info ở params.item.data_url (zinstant HTML render URL).
    if (action === 'zinstant.bankcard' || (typeof content.params === 'string' && content.params.includes('zinstant.bankcard'))) {
      return 'bank_transfer';
    }
    if (content.bankCode || content.bankName) return 'bank_transfer';
    if (content.callDuration !== undefined || content.callType) return 'call';
    // Link auto-unfurl: có thumb + href + action rỗng (không phải reminder/call/bank)
    // Zalo msgType cho link đôi khi chỉ là 'webchat' hoặc rỗng → detect bằng shape
    if (
      typeof content.href === 'string' && content.href.startsWith('http') &&
      (typeof content.thumb === 'string' || typeof content.title === 'string') &&
      !action
    ) {
      return 'link';
    }

    // Log unknown types for analysis before returning rich
    if (!KNOWN_MSG_TYPE_PATTERNS.some((p) => msgType.includes(p))) {
      logger.info(`[zalo:msgType] Unknown object type: "${msgType}" action="${action}"`, {
        contentKeys: Object.keys(content),
      });
    }
    return 'rich';
  }

  // Log unknown string-content types for discovery
  if (!KNOWN_MSG_TYPE_PATTERNS.some((p) => msgType.includes(p))) {
    logger.info(`[zalo:msgType] Unknown string type: "${msgType}"`, {
      contentPreview: typeof content === 'string' ? content.slice(0, 100) : undefined,
    });
  }

  return 'text';
}

export interface AlbumInfo {
  albumKey: string | null;
  albumIndex: number | null;
  albumTotal: number | null;
}

/**
 * Extract multi-image album metadata from Zalo content payload.
 * Zalo tags each photo in an album with a shared group_layout_id and position.
 */
export function extractAlbumInfo(contentType: string, rawContent: unknown): AlbumInfo {
  const empty: AlbumInfo = { albumKey: null, albumIndex: null, albumTotal: null };
  if (contentType !== 'image' || typeof rawContent !== 'object' || rawContent === null) return empty;
  const paramsRaw = (rawContent as Record<string, unknown>).params;
  let params: Record<string, unknown> | null = null;
  try {
    params = typeof paramsRaw === 'string' ? JSON.parse(paramsRaw) : (paramsRaw as Record<string, unknown> | null);
  } catch {
    return empty;
  }
  if (!params || !params.is_group_layout || !params.group_layout_id) return empty;
  const idx = Number(params.id_in_group);
  const total = Number(params.total_item_in_group);
  return {
    albumKey: String(params.group_layout_id),
    albumIndex: Number.isFinite(idx) ? idx : null,
    albumTotal: Number.isFinite(total) ? total : null,
  };
}

/**
 * Fire-and-forget: fill in a missing avatarUrl on a Contact row.
 * Only updates rows where avatarUrl is currently null.
 */
export function updateContactAvatar(zaloUid: string, avatarUrl: string): void {
  prisma.contact
    .updateMany({
      where: { zaloUid, avatarUrl: null },
      data: { avatarUrl },
    })
    .catch(() => {});
}
