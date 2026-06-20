// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-operations.ts — DRY wrapper for all zca-js API calls.
 * Every Zalo operation goes through this service:
 *   1. Resolve account → get API instance from ZaloPool
 *   2. Check rate limits (per operation type)
 *   3. Execute zca-js call
 *   4. Handle session-expired errors (auto-reconnect + retry once)
 *   5. Emit Socket.IO events
 *   6. Return result or throw typed error
 */
import type { Server } from 'socket.io';
import { zaloPool } from '../modules/zalo/zalo-pool.js';
import { zaloRateLimiter } from '../modules/zalo/zalo-rate-limiter.js';
import { logger } from './utils/logger.js';
import { prisma } from './database/prisma-client.js';

// ── Error types ─────────────────────────────────────────────────────────────
export class ZaloOpError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_CONNECTED' | 'RATE_LIMITED' | 'SESSION_EXPIRED' | 'API_ERROR' | 'INVALID_PARAMS',
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ZaloOpError';
  }
}

// ── Operation categories for rate limiting ──────────────────────────────────
export type OpCategory =
  | 'message'       // send text, image, video, voice, link, card, sticker, forward
  | 'reaction'      // add reaction
  | 'chat_action'   // typing, delete, undo, edit, pin/unpin, reply
  | 'group_admin'   // create, rename, avatar, settings, add/remove members, deputy, transfer, block
  | 'group_read'    // list, info, members, polls, invite links, pending
  | 'friend_action' // add, accept, reject, cancel, remove, block, alias
  // 2026-06-06 (Anh chốt) — TÁCH friend_read cũ thành 3 nhóm để quota không ăn lẫn:
  | 'friend_lookup' // findUser (Tìm SĐT→UID — việc của chiến dịch gửi lời mời)
  | 'contact_sync'  // getAllFriends (đọc/đồng bộ danh bạ — chạy nền khi reconnect)
  | 'friend_read'   // còn lại: online, recommendations, sent requests, alias list
  | 'profile'       // update name, avatar, status
  | 'query';        // getUserInfo, getGroupInfo — read-only

// ── Types ───────────────────────────────────────────────────────────────────
interface ExecOptions {
  accountId: string;
  category: OpCategory;
  operation: string;           // human-readable name for logging
  io?: Server | null;          // Socket.IO server for event emission
  socketEvent?: string;        // event name to emit on success
  socketRoom?: string;         // room to emit to (default: org-level)
  socketPayload?: any;         // data to emit (merged with result)
  suppressErrorLog?: (err: any) => boolean;
}

interface ZaloCredentials {
  cookie: any;
  imei: string;
  userAgent: string;
}

// ── Reconnect mutex ─────────────────────────────────────────────────────────
const reconnecting = new Map<string, Promise<void>>();

async function attemptReconnect(accountId: string): Promise<void> {
  // If already reconnecting this account, wait for it
  const existing = reconnecting.get(accountId);
  if (existing) return existing;

  const attempt = (async () => {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { sessionData: true },
    });
    const session = account?.sessionData as ZaloCredentials | null;
    if (!session?.imei) {
      throw new ZaloOpError('No saved session for reconnect', 'SESSION_EXPIRED', 401);
    }
    logger.info(`[zalo-ops:${accountId}] Auto-reconnecting after session expiry...`);
    await zaloPool.reconnect(accountId, session);
  })();

  reconnecting.set(accountId, attempt);
  try {
    await attempt;
  } finally {
    reconnecting.delete(accountId);
  }
}

// ── Session expiry detection ────────────────────────────────────────────────
// Strict patterns to avoid false positives (e.g. "session data parsing" errors)
const SESSION_EXPIRED_PATTERNS = [
  'session expired',
  'session has expired',
  'not logged in',
  'login required',
  'cookie expired',
  'cookie is invalid',
  'invalid session',
  'invalid token',
];

function isSessionExpiredError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return SESSION_EXPIRED_PATTERNS.some(p => msg.includes(p));
}

/**
 * Lỗi mạng tạm thời (chập chờn) — Zalo server đóng socket khi upload nhiều ảnh
 * cùng lúc (album 6-7 tấm), hoặc blip mạng. Retry thường thành công.
 * Bằng chứng: "sendImage failed: TypeError: fetch failed" + "SocketError: other side closed"
 * + Symbol(undici UND_ERR_SOCKET) khi gửi album 7 ảnh (zca-js Promise.all upload song song).
 */
function isTransientNetworkError(err: any): boolean {
  // undici socket errors mang Symbol UND_ERR — bắt cả ở err và err.cause.
  const undiciFlag = (e: any) => e && (e[Symbol.for('undici.error.UND_ERR')] === true
    || Object.getOwnPropertySymbols(e).some((s) => String(s).includes('UND_ERR')));
  if (undiciFlag(err) || undiciFlag(err?.cause)) return true;
  const msg = (String(err?.message || '') + ' ' + String(err?.cause?.message || '')).toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('other side closed') ||
    msg.includes('socket') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('und_err')
  );
}

function isMalformedJsonResponseError(err: any): boolean {
  // SyntaxError từ V8 JSON.parse có nhiều variant:
  //   "Unexpected token X in JSON at position Y"
  //   "Unexpected end of JSON input"
  //   "No number after minus sign in JSON at position Y"
  //   "X is not valid JSON" (Node 20+)
  // → catch theo class hoặc substring "JSON" + position phrase.
  if (err?.name === 'SyntaxError') return true;
  const msg = String(err?.message || err || '');
  return (
    msg.includes('Unexpected token') ||
    msg.includes('Unexpected end of JSON input') ||
    msg.includes('in JSON at position') ||
    msg.includes('is not valid JSON')
  );
}

// ── Core execution engine ───────────────────────────────────────────────────
/**
 * Execute a zca-js operation with all safety layers.
 *
 * @param opts - account, category, operation name, socket config
 * @param fn  - callback receiving the zca-js `api` instance, returns result
 * @returns The result of fn(api)
 * @throws ZaloOpError with typed code
 *
 * Usage:
 *   const result = await zaloOps.exec(
 *     { accountId, category: 'message', operation: 'sendMessage' },
 *     (api) => api.sendMessage({ msg: 'hello' }, threadId, 0)
 *   );
 */
async function exec<T>(opts: ExecOptions, fn: (api: any) => Promise<T>): Promise<T> {
  const { accountId, category, operation } = opts;

  // 1. Check connection
  const instance = zaloPool.getInstance(accountId);
  if (!instance?.api || instance.status !== 'connected') {
    throw new ZaloOpError(
      `Zalo account not connected (status: ${instance?.status ?? 'unknown'})`,
      'NOT_CONNECTED',
      400,
    );
  }

  // 2. Rate limit check
  const limit = await zaloRateLimiter.checkLimits(accountId, category);
  if (!limit.allowed) {
    throw new ZaloOpError(limit.reason || 'Rate limited', 'RATE_LIMITED', 429);
  }

  // 3. Execute with retry on session expiry + transient network blip.
  //    MAX_ATTEMPTS=3 để lỗi socket tạm thời (album nhiều ảnh) có cơ hội thử lại.
  const MAX_ATTEMPTS = 3;
  let lastError: any;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn(instance.api);

      // Record successful operation. (getAllFriends giờ là category 'contact_sync'
      // nên đã tự đếm vào rl:daily:nick:contact_sync — không cần recordOperation riêng.)
      zaloRateLimiter.recordSend(accountId, category);

      // 4. Emit Socket.IO event if configured
      if (opts.io && opts.socketEvent) {
        const payload = opts.socketPayload
          ? { accountId, ...opts.socketPayload, result }
          : { accountId, operation, result };
        if (opts.socketRoom) {
          opts.io.to(opts.socketRoom).emit(opts.socketEvent, payload);
        } else {
          opts.io.emit(opts.socketEvent, payload);
        }
      }

      return result;
    } catch (err: any) {
      lastError = err;

      // On first attempt, check if session expired → reconnect + retry
      if (attempt === 0 && isSessionExpiredError(err)) {
        logger.warn(`[zalo-ops:${accountId}] Session expired during ${operation}, attempting reconnect...`);
        try {
          await attemptReconnect(accountId);
          // After reconnect, get fresh API instance
          const freshInstance = zaloPool.getInstance(accountId);
          if (freshInstance?.api && freshInstance.status === 'connected') {
            // Use fresh API directly — don't mutate the captured reference
            const retryResult = await fn(freshInstance.api);
            zaloRateLimiter.recordSend(accountId, category);
            return retryResult;
          }
        } catch (reconnectErr) {
          logger.error(`[zalo-ops:${accountId}] Reconnect failed:`, reconnectErr);
          throw new ZaloOpError(
            'Session expired and reconnect failed. QR re-login required.',
            'SESSION_EXPIRED',
            401,
          );
        }
      }

      // Lỗi mạng tạm thời (socket đứt khi upload album nhiều ảnh) → retry với backoff.
      if (isTransientNetworkError(err) && attempt < MAX_ATTEMPTS - 1) {
        const delayMs = 400 * (attempt + 1); // 400ms, 800ms
        logger.warn(`[zalo-ops:${accountId}] ${operation} lỗi mạng tạm thời (attempt ${attempt + 1}/${MAX_ATTEMPTS}), thử lại sau ${delayMs}ms: ${err?.message ?? err}`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Non-session, non-transient error or last attempt — throw
      break;
    }
  }

  // Wrap unknown errors — preserve Zalo error code in message for diagnostics
  if (lastError instanceof ZaloOpError) throw lastError;
  if (opts.suppressErrorLog?.(lastError)) {
    logger.debug(`[zalo-ops:${accountId}] ${operation} skipped noisy SDK error:`, lastError?.message ?? lastError);
  } else {
    logger.error(`[zalo-ops:${accountId}] ${operation} failed:`, lastError);
  }
  const zaloCode = lastError?.code; // ZaloApiError exposes .code = Zalo error_code (e.g., 113, 222)
  const msg = lastError?.message || String(lastError);

  // User-friendly message cho 1 số Zalo error code phổ biến (2026-05-21).
  if (operation === 'undo' && zaloCode === 112) {
    throw new ZaloOpError(
      'Tin vừa gửi cần Zalo vài giây xử lý. Đợi ~10s sau khi gửi rồi thử thu hồi lại.',
      'INVALID_PARAMS',
      400,
    );
  }

  throw new ZaloOpError(
    `${operation} failed: ${msg}${zaloCode != null ? ` [zalo:${zaloCode}]` : ''}`,
    'API_ERROR',
    500,
  );
}

// ── Pre-built operations ────────────────────────────────────────────────────

// ─── Messaging ──────────────────────────────────────────────────────────────
async function sendMessage(accountId: string, threadId: string, threadType: 0 | 1, msg: any, io?: Server | null) {
  return exec({ accountId, category: 'message', operation: 'sendMessage', io, socketEvent: 'chat:message' },
    (api) => api.sendMessage(msg, threadId, threadType));
}

// 2026-06-12 FIX: thêm `msg` (kể cả '') vào payload. zca-js sendMessage.cjs:445 đọc
// `msg.length` → thiếu msg = crash undefined. Có msg + attachments là local path CÓ ĐUÔI
// ảnh (.jpg/.png/.webp) → Zalo nhận ẢNH INLINE (không phải file). caption tùy chọn.
async function sendImage(accountId: string, threadId: string, threadType: 0 | 1, attachments: any[], io?: Server | null, caption: string = '') {
  return exec({ accountId, category: 'message', operation: 'sendImage', io },
    (api) => api.sendMessage({ msg: caption, attachments }, threadId, threadType));
}

async function sendSticker(
  accountId: string,
  sticker: { id: number; cateId: number; type: number },
  threadId: string,
  threadType: 0 | 1,
) {
  return exec({ accountId, category: 'message', operation: 'sendSticker' },
    (api) => api.sendSticker(sticker, threadId, threadType));
}

async function sendLink(accountId: string, threadId: string, threadType: 0 | 1, link: any) {
  return exec({ accountId, category: 'message', operation: 'sendLink' },
    (api) => api.sendLink(link, threadId, threadType));
}

// ─── Reminders / Nhắc hẹn (2026-06-16) ──────────────────────────────────────
// zca-js createReminder/editReminder/removeReminder. type 0=user, 1=group (như threadType).
// startTime = epoch ms; repeat 0=None,1=Daily,2=Weekly,3=Monthly. Trả ReminderUser có reminderId.
async function createReminder(
  accountId: string, threadId: string, threadType: 0 | 1,
  options: { title: string; startTime?: number; repeat?: number; emoji?: string },
): Promise<any> {
  return exec({ accountId, category: 'message', operation: 'createReminder' },
    (api) => api.createReminder(options, threadId, threadType));
}
async function editReminder(
  accountId: string, threadId: string, threadType: 0 | 1,
  options: { title: string; topicId: string; startTime?: number; repeat?: number; emoji?: string },
): Promise<any> {
  return exec({ accountId, category: 'message', operation: 'editReminder' },
    (api) => api.editReminder(options, threadId, threadType));
}
async function removeReminder(
  accountId: string, reminderId: string, threadId: string, threadType: 0 | 1,
): Promise<any> {
  return exec({ accountId, category: 'message', operation: 'removeReminder' },
    (api) => api.removeReminder(reminderId, threadId, threadType));
}

async function sendCard(accountId: string, threadId: string, threadType: 0 | 1, cardData: any) {
  return exec({ accountId, category: 'message', operation: 'sendCard' },
    (api) => api.sendCard(cardData, threadId, threadType));
}

async function sendVoice(accountId: string, threadId: string, threadType: 0 | 1, voicePath: string, duration?: number) {
  return exec({ accountId, category: 'message', operation: 'sendVoice' },
    (api) => api.sendVoice(voicePath, threadId, threadType, duration));
}

async function sendVideo(accountId: string, threadId: string, threadType: 0 | 1, videoPayload: any, io?: Server | null) {
  return exec({ accountId, category: 'message', operation: 'sendVideo', io },
    (api) => api.sendVideo(videoPayload, threadId, threadType));
}

async function sendFile(accountId: string, threadId: string, threadType: 0 | 1, filePaths: string[], io?: Server | null, caption: string = '') {
  return exec({ accountId, category: 'message', operation: 'sendFile', io },
    (api) => api.sendMessage({ msg: caption, attachments: filePaths }, threadId, threadType));
}

async function uploadAttachment(accountId: string, threadId: string, threadType: 0 | 1, paths: string[]) {
  return exec({ accountId, category: 'message', operation: 'uploadAttachment' },
    (api) => api.uploadAttachment(paths, threadId, threadType) as Promise<unknown[]>);
}

// FIX 2026-05-21 round-2: zca-js forwardMessage trả [zalo:112] nếu thiếu reference của tin
// gốc. Zalo server kiểm tra forward phải có msgId+ts của tin nguồn. Truyền reference object.
async function forwardMessage(
  accountId: string,
  text: string,
  threadIds: string[],
  threadType: 0 | 1,
  reference?: { id: string; ts: number; logSrcType?: number; fwLvl?: number },
) {
  return exec({ accountId, category: 'message', operation: 'forwardMessage' },
    (api) => api.forwardMessage(
      {
        message: text,
        reference: reference
          ? { id: reference.id, ts: reference.ts, logSrcType: reference.logSrcType ?? 0, fwLvl: reference.fwLvl ?? 0 }
          : undefined,
      },
      threadIds,
      threadType,
    ));
}

// ─── Chat Actions ───────────────────────────────────────────────────────────
// zca-js v2 expects nested dest: { data: {msgId, cliMsgId}, threadId, type }
async function addReaction(
  accountId: string,
  reaction: any,
  dest: { data: { msgId: string; cliMsgId: string }; threadId: string; type: 0 | 1 },
) {
  return exec({ accountId, category: 'reaction', operation: 'addReaction' },
    (api) => api.addReaction(reaction, dest));
}

async function sendTypingEvent(accountId: string, threadId: string, threadType: 0 | 1) {
  return exec({ accountId, category: 'chat_action', operation: 'sendTypingEvent' },
    (api) => api.sendTypingEvent(threadId, threadType));
}

async function deleteMessage(accountId: string, msgId: string, cliMsgId: string, ownerId: string, threadId: string, threadType: 0 | 1, onlyMe: boolean) {
  // FIX 2026-06-18: zca-js deleteMessage nhận OBJECT dest, không phải positional.
  // Trước đây gọi positional → dest = msgId (string) → lib đọc dest.data.uidFrom của
  // undefined → 500 "Cannot read properties of undefined (reading 'uidFrom')".
  // ownerId = uidFrom (uid người gửi). threadType (0 user/1 group) → type.
  return exec({ accountId, category: 'chat_action', operation: 'deleteMessage' },
    (api) => api.deleteMessage(
      { data: { cliMsgId, msgId, uidFrom: ownerId }, threadId, type: threadType },
      onlyMe,
    ));
}

// FIX 2026-05-21: zca-js api.undo(payload, threadId, type) — payload object { msgId, cliMsgId }.
// Trước đây gọi positional `api.undo(msgId, cliMsgId, ownerId, threadId, threadType)` → SDK throw
// (signature mismatch) → nút thu hồi không hoạt động.
async function undoMessage(
  accountId: string,
  msgId: string,
  cliMsgId: string,
  _ownerId: string, // giữ tham số cho backward compat — zca-js không cần
  threadId: string,
  threadType: 0 | 1,
) {
  return exec({ accountId, category: 'chat_action', operation: 'undo' },
    async (api) => {
      // RACE CONDITION FIX v2 (2026-05-22): Zalo trả error 112 cho tin <~30s
      // (chưa kịp propagate index server). Em test: tin 65s → success, <60s → race.
      // Retry 3 lần với delay tăng dần (3s, 5s, 7s) → tổng 15s đủ cover tin <15s old.
      // Tin <0-15s old vẫn có thể fail nếu Zalo index chậm, FE catch error sẽ
      // tự hiển thị message "đợi vài giây rồi thử lại".
      const tryUndo = async () => api.undo({ msgId, cliMsgId }, threadId, threadType);
      const delays = [3000, 5000, 7000];

      for (let i = 0; i < delays.length; i++) {
        try {
          return await tryUndo();
        } catch (err: any) {
          if (err?.code !== 112) throw err;
          logger.info(`[zalo-ops:${accountId}] undo got [zalo:112], retry ${i+1}/${delays.length} after ${delays[i]}ms (msgId=${msgId})`);
          await new Promise((resolve) => setTimeout(resolve, delays[i]));
        }
      }

      // Final attempt sau khi đã đợi 15s
      return tryUndo();
    });
}

// NOTE 2026-05-21: zca-js KHÔNG support edit message thật. Trước đây gọi
// `api.sendMessage({msg, editMsgId, editCliMsgId})` — editMsgId/editCliMsgId bị ignore →
// sendMessage gửi TIN MỚI → hiện 2 tin giống nhau trong UI. Giải pháp: NGỪNG gọi Zalo SDK,
// chỉ update DB + đánh dấu editedAt. Sale phải hiểu edit chỉ áp dụng trên CRM, KHÔNG sync Zalo.
// Hàm này no-op để route compile, route tự handle DB write.
async function editMessage(
  _accountId: string,
  _msgId: string,
  _cliMsgId: string,
  _content: string,
  _threadId: string,
  _threadType: 0 | 1,
) {
  return { skipped: true } as const;
}

async function pinConversation(accountId: string, pin: boolean, threadId: string, threadType: 0 | 1) {
  return exec({ accountId, category: 'chat_action', operation: pin ? 'pin' : 'unpin' },
    (api) => api.setPinnedConversations(pin, threadId, threadType));
}

async function getPinConversations(accountId: string) {
  return exec({ accountId, category: 'query', operation: 'getPinConversations' },
    (api) => api.getPinConversations());
}

// ─── Group Management ───────────────────────────────────────────────────────
async function createGroup(accountId: string, options: { name: string; memberIds: string[] }) {
  return exec({ accountId, category: 'group_admin', operation: 'createGroup' },
    (api) => api.createGroup(options));
}

async function renameGroup(accountId: string, name: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'renameGroup' },
    (api) => api.changeGroupName(name, groupId));
}

async function changeGroupAvatar(accountId: string, avatarPath: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'changeGroupAvatar' },
    (api) => api.changeGroupAvatar(avatarPath, groupId));
}

async function updateGroupSettings(accountId: string, settings: any, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'updateGroupSettings' },
    (api) => api.updateGroupSettings(settings, groupId));
}

async function addUserToGroup(accountId: string, userIds: string[], groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'addUserToGroup' },
    (api) => api.addUserToGroup(userIds, groupId));
}

async function removeUserFromGroup(accountId: string, userIds: string[], groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'removeUserFromGroup' },
    (api) => api.removeUserFromGroup(userIds, groupId));
}

async function addGroupDeputy(accountId: string, userId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'addGroupDeputy' },
    (api) => api.addGroupDeputy(userId, groupId));
}

async function removeGroupDeputy(accountId: string, userId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'removeGroupDeputy' },
    (api) => api.removeGroupDeputy(userId, groupId));
}

async function changeGroupOwner(accountId: string, newOwnerId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'changeGroupOwner' },
    (api) => api.changeGroupOwner(newOwnerId, groupId));
}

async function blockGroupMember(accountId: string, userId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'blockGroupMember' },
    (api) => api.addGroupBlockedMember(userId, groupId));
}

async function unblockGroupMember(accountId: string, userId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'unblockGroupMember' },
    (api) => api.removeGroupBlockedMember(userId, groupId));
}

async function leaveGroup(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'leaveGroup' },
    (api) => api.leaveGroup(groupId));
}

async function disperseGroup(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'disperseGroup' },
    (api) => api.disperseGroup(groupId));
}

// ─── Group Read ─────────────────────────────────────────────────────────────
async function getGroupInfo(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_read', operation: 'getGroupInfo' },
    (api) => api.getGroupInfo(groupId));
}

async function getAllGroups(accountId: string) {
  return exec({ accountId, category: 'group_read', operation: 'getAllGroups' },
    (api) => api.getAllGroups());
}

async function getGroupMembersInfo(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_read', operation: 'getGroupMembersInfo' },
    (api) => api.getGroupMembersInfo(groupId));
}

async function getGroupBlockedMembers(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_read', operation: 'getGroupBlockedMembers' },
    (api) => api.getGroupBlockedMember({}, groupId));
}

async function getPendingGroupMembers(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_read', operation: 'getPendingGroupMembers' },
    (api) => api.getPendingGroupMembers(groupId));
}

async function getGroupLinkDetail(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_read', operation: 'getGroupLinkDetail' },
    (api) => api.getGroupLinkDetail(groupId));
}

// ─── Group Invite Link Management ───────────────────────────────────────────
async function enableGroupLink(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'enableGroupLink' },
    (api) => api.enableGroupLink(groupId));
}

async function disableGroupLink(accountId: string, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'disableGroupLink' },
    (api) => api.disableGroupLink(groupId));
}

async function joinGroupByLink(accountId: string, linkId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'joinGroupByLink' },
    (api) => api.joinGroupLink(linkId));
}

// ─── Group Polls ────────────────────────────────────────────────────────────
async function createPoll(accountId: string, options: any, groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'createPoll' },
    (api) => api.createPoll(options, groupId));
}

async function getPollDetail(accountId: string, pollId: string) {
  return exec({ accountId, category: 'group_read', operation: 'getPollDetail' },
    (api) => api.getPollDetail(pollId));
}

async function votePoll(accountId: string, pollId: string, optionIds: number[], groupId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'votePoll' },
    (api) => api.votePoll(optionIds, pollId, groupId));
}

async function lockPoll(accountId: string, pollId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'lockPoll' },
    (api) => api.lockPoll(pollId));
}

async function sharePoll(accountId: string, pollId: string) {
  return exec({ accountId, category: 'group_admin', operation: 'sharePoll' },
    (api) => api.sharePoll(pollId));
}

// ─── Friend Operations ──────────────────────────────────────────────────────
async function getAllFriends(accountId: string) {
  // 2026-06-06 — đọc/đồng bộ danh bạ: category riêng 'contact_sync' (chạy nền,
  // KHÔNG ăn quota tìm khách của chiến dịch).
  return exec({ accountId, category: 'contact_sync', operation: 'getAllFriends' },
    (api) => api.getAllFriends());
}

async function findUser(accountId: string, query: string) {
  // 2026-06-06 — Tìm SĐT→UID: category riêng 'friend_lookup' (việc của chiến dịch
  // gửi lời mời, tách khỏi đồng bộ danh bạ nền).
  return exec({ accountId, category: 'friend_lookup', operation: 'findUser' },
    (api) => api.findUser(query));
}

async function getFriendOnlines(accountId: string) {
  try {
    return await exec(
      {
        accountId,
        category: 'friend_read',
        operation: 'getFriendOnlines',
        suppressErrorLog: isMalformedJsonResponseError,
      },
      (api) => api.getFriendOnlines(),
    );
  } catch (err) {
    if (isMalformedJsonResponseError(err)) {
      logger.debug(`[zalo-ops:${accountId}] getFriendOnlines returned malformed SDK response; using empty presence list`);
      return { onlines: [] };
    }
    throw err;
  }
}

async function getFriendRecommendations(accountId: string) {
  return exec({ accountId, category: 'friend_read', operation: 'getFriendRecommendations' },
    (api) => api.getFriendRecommendations());
}

async function sendFriendRequest(accountId: string, message: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'sendFriendRequest' },
    (api) => api.sendFriendRequest(message, userId));
}

async function acceptFriendRequest(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'acceptFriendRequest' },
    (api) => api.acceptFriendRequest(userId));
}

async function rejectFriendRequest(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'rejectFriendRequest' },
    (api) => api.rejectFriendRequest(userId));
}

async function cancelFriendRequest(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'cancelFriendRequest' },
    (api) => api.undoFriendRequest(userId));
}

async function getSentFriendRequests(accountId: string) {
  return exec({ accountId, category: 'friend_read', operation: 'getSentFriendRequests' },
    (api) => api.getSentFriendRequest());
}

async function getFriendRequestStatus(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_read', operation: 'getFriendRequestStatus' },
    (api) => api.getFriendRequestStatus(userId));
}

async function removeFriend(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'removeFriend' },
    (api) => api.removeFriend(userId));
}

async function changeFriendAlias(accountId: string, alias: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'changeFriendAlias' },
    (api) => api.changeFriendAlias(alias, userId));
}

async function removeFriendAlias(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'removeFriendAlias' },
    (api) => api.removeFriendAlias(userId));
}

async function getAliasList(accountId: string, count = 100, page = 1) {
  return exec({ accountId, category: 'friend_read', operation: 'getAliasList' },
    (api) => api.getAliasList(count, page));
}

async function blockUser(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'blockUser' },
    (api) => api.blockUser(userId));
}

async function unblockUser(accountId: string, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'unblockUser' },
    (api) => api.unblockUser(userId));
}

async function blockViewFeed(accountId: string, block: boolean, userId: string) {
  return exec({ accountId, category: 'friend_action', operation: 'blockViewFeed' },
    (api) => api.blockViewFeed(block, userId));
}

// ─── Profile ────────────────────────────────────────────────────────────────
async function getUserInfo(accountId: string, userId: string) {
  return exec({ accountId, category: 'query', operation: 'getUserInfo' },
    (api) => api.getUserInfo(userId));
}

async function getOwnId(accountId: string) {
  return exec({ accountId, category: 'query', operation: 'getOwnId' },
    (api) => api.getOwnId());
}

async function getAccountInfo(accountId: string) {
  return exec({ accountId, category: 'profile', operation: 'getAccountInfo' },
    (api) => api.getAccountInfo());
}

async function changeAccountAvatar(accountId: string, filePath: string) {
  return exec({ accountId, category: 'profile', operation: 'changeAccountAvatar' },
    (api) => api.changeAccountAvatar(filePath));
}

async function setOnlineStatus(accountId: string, online: boolean) {
  return exec({ accountId, category: 'profile', operation: 'setOnlineStatus' },
    (api) => api.setOnlineStatus(online));
}

async function getLastOnline(accountId: string, userId: string) {
  return exec({ accountId, category: 'query', operation: 'getLastOnline' },
    (api) => api.lastOnline(userId));
}

// ── Public API ──────────────────────────────────────────────────────────────
export const zaloOps = {
  // Core
  exec,

  // Messaging
  sendMessage,
  sendImage,
  sendSticker,
  sendLink,
  sendCard,
  sendVoice,

  // Reminders / Nhắc hẹn (2026-06-16)
  createReminder,
  editReminder,
  removeReminder,
  sendVideo,
  sendFile,
  uploadAttachment,
  forwardMessage,

  // Chat actions
  addReaction,
  sendTypingEvent,
  deleteMessage,
  undoMessage,
  editMessage,
  pinConversation,
  getPinConversations,

  // Group management
  createGroup,
  renameGroup,
  changeGroupAvatar,
  updateGroupSettings,
  addUserToGroup,
  removeUserFromGroup,
  addGroupDeputy,
  removeGroupDeputy,
  changeGroupOwner,
  blockGroupMember,
  unblockGroupMember,
  leaveGroup,
  disperseGroup,

  // Group read
  getGroupInfo,
  getAllGroups,
  getGroupMembersInfo,
  getGroupBlockedMembers,
  getPendingGroupMembers,
  getGroupLinkDetail,

  // Group invite links
  enableGroupLink,
  disableGroupLink,
  joinGroupByLink,

  // Group polls
  createPoll,
  getPollDetail,
  votePoll,
  lockPoll,
  sharePoll,

  // Friend operations
  getAllFriends,
  findUser,
  getFriendOnlines,
  getFriendRecommendations,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  getSentFriendRequests,
  getFriendRequestStatus,
  removeFriend,
  changeFriendAlias,
  removeFriendAlias,
  getAliasList,
  blockUser,
  unblockUser,
  blockViewFeed,

  // Profile/query
  getUserInfo,
  getOwnId,
  getAccountInfo,
  changeAccountAvatar,
  setOnlineStatus,
  getLastOnline,
};
