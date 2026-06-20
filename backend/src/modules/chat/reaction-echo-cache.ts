// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * reaction-echo-cache.ts — In-memory cache để phân biệt SDK self-echo vs genuine app reaction.
 *
 * Vấn đề (2026-05-21):
 *   - CRM POST /reactions → SDK addReaction → Zalo server → SDK echo về listener
 *     → handleZaloReaction tạo DB row DUPLICATE (cùng emoji của anh) → UI 2 tim.
 *   - FIX cũ: skip if reactorZaloUid === ownAccount.zaloUid → SAI vì cũng skip
 *     genuine reaction từ Zalo App của anh (cùng nick UID).
 *
 * Giải pháp: cache theo (zaloMsgId, emoji, reactorUid) với expiry 5s.
 *   - POST handler set cache sau khi SDK addReaction return.
 *   - handleZaloReaction check cache:
 *       + Hit + chưa hết hạn → skip (CRM self-echo, đã ghi DB từ POST handler).
 *       + Miss / expired → proceed (genuine reaction từ Zalo App hoặc user khác).
 *   - Sau khi check, xoá entry để không skip nhầm lần sau.
 *
 * Edge case:
 *   - Anh react CRM ❤️ rồi 6s sau react Zalo App ❤️ trên cùng tin → cache expired →
 *     Zalo App reaction được proceed → DB có 1 row 'crm' + 1 row 'zalo' cùng emoji.
 *     Đây là KH thực sự muốn vậy? Không, anh chỉ react 1 lần qua app sau khi đã react CRM
 *     thì là toggle/replace. Logic này cần handle riêng nếu user complain.
 *   - Anh react CRM ❤️ + < 5s react Zalo App 😡 (khác emoji) → cache key khác → 😡 proceed.
 *     Đúng — 2 emoji khác nhau là 2 reaction độc lập.
 */

interface EchoEntry {
  expiresAt: number;
}

const TTL_MS = 5000;
const cache = new Map<string, EchoEntry>();

function keyOf(zaloMsgId: string, emoji: string, reactorUid: string): string {
  return `${zaloMsgId}|${emoji}|${reactorUid}`;
}

/** Mark an SDK echo as expected after CRM POST /reactions completes the SDK call. */
export function markExpected(zaloMsgId: string, emoji: string, reactorUid: string): void {
  if (!zaloMsgId || !emoji || !reactorUid) return;
  cache.set(keyOf(zaloMsgId, emoji, reactorUid), { expiresAt: Date.now() + TTL_MS });
  prune();
}

/** Check + consume an expected echo. Returns true if this echo should be skipped. */
export function consumeIfExpected(zaloMsgId: string, emoji: string, reactorUid: string): boolean {
  const key = keyOf(zaloMsgId, emoji, reactorUid);
  const entry = cache.get(key);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return false;
  }
  cache.delete(key);
  return true;
}

function prune(): void {
  // Lazy prune: chỉ xoá entries hết hạn khi size vượt 1000 (tránh memory creep dài hạn).
  if (cache.size < 1000) return;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k);
  }
}
