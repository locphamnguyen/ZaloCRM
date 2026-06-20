// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * bridge-bus.ts — Bus sự kiện nội bộ cho Cầu Zalo ↔ Telegram (Phase 0).
 *
 * Phát "message.persisted" SAU KHI tin đã ghi vào DB (hậu-commit). Phase 1 (module
 * telegram-bridge) subscribe bus này để mirror tin sang Telegram.
 *
 * VÌ SAO ở tầng ứng dụng, KHÔNG ở Prisma `$extends`:
 *   Extension RLS (prisma-client.ts) bọc mỗi write trong base.$transaction([...]). Nếu emit
 *   trong query-extension, sự kiện bắn TRƯỚC khi transaction commit → có thể đẩy lên Telegram
 *   một tin rốt cuộc bị rollback (tin ma). Gọi publishMessagePersisted() SAU khi
 *   prisma.message.create() đã resolve = chắc chắn hậu-commit (outside-voice P1, 2026-06-18).
 *
 * Payload tối thiểu (chỉ id): subscriber tự query lại message/conversation/config để tránh
 * phụ thuộc vào việc caller đã load sẵn field nào.
 */
import { EventEmitter } from 'node:events';
import { logger } from './utils/logger.js';

export interface MessagePersistedEvent {
  messageId: string;
  conversationId: string;
}

class BridgeBus extends EventEmitter {}

export const bridgeBus = new BridgeBus();
// Cầu có thể có nhiều listener (mirror, status-sync...) — nới trần để không cảnh báo leak giả.
bridgeBus.setMaxListeners(50);

/**
 * Phát sự kiện tin vừa được lưu (hậu-commit). FIRE-AND-FORGET: nuốt mọi lỗi của listener
 * để KHÔNG làm hỏng luồng lưu tin chính (mirror Telegram là phụ, core là chính).
 */
export function publishMessagePersisted(ev: MessagePersistedEvent): void {
  try {
    bridgeBus.emit('message.persisted', ev);
  } catch (err) {
    logger.warn(`[bridge-bus] listener lỗi khi xử message.persisted (bỏ qua): ${String(err)}`);
  }
}
