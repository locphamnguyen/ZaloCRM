// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * reminder-sync.ts — Sync reminder card từ Zalo client thành Appointment trong CRM.
 *
 * Gọi từ message-handler.ts ngay sau khi Message row được tạo (chỉ với reminder card
 * variant: contentType='contact_card', action='show.profile', params.actions[*].data
 * chứa "create_reminder*"). Dedup theo (orgId, externalRef=reminderId) để edit/repeat
 * fire không tạo trùng row.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

interface SyncInput {
  orgId: string;
  contactId: string | null;
  messageId: string;
  content: string | null;
  contentType: string;
  senderUid: string;
}

function extractFromCard(parsed: Record<string, unknown>): {
  reminderId: string;
  title: string;
  startTime: number | null;
  emoji: string;
  repeat: number;
} | null {
  if (parsed.action !== 'show.profile') return null;
  const paramsRaw = parsed.params;
  const params = typeof paramsRaw === 'string'
    ? (() => { try { return JSON.parse(paramsRaw); } catch { return null; } })()
    : (paramsRaw as Record<string, unknown> | null);
  if (!params) return null;

  const actions = Array.isArray(params.actions) ? params.actions : [];
  for (const a of actions) {
    const dataRaw = (a as { data?: unknown }).data;
    if (typeof dataRaw !== 'string' || !dataRaw.includes('create_reminder')) continue;
    let dataObj: Record<string, unknown>;
    try { dataObj = JSON.parse(dataRaw); } catch { continue; }
    const inner = typeof dataObj.data === 'string'
      ? (() => { try { return JSON.parse(dataObj.data as string); } catch { return null; } })()
      : (dataObj.data as Record<string, unknown> | null);
    if (!inner) continue;

    const reminderId = String(inner.reminderId || '');
    if (!reminderId) continue;
    const startTime = Number(inner.startTime || 0) || null;
    const repeat = Number(inner.repeat || 0);
    const innerParams = inner.params as Record<string, unknown> | undefined;
    const title = String(innerParams?.title || String(parsed.title || '').replace(/^[⏰🔔📅]\s*/u, '').trim());
    const emoji = String(inner.emoji || '⏰');
    return { reminderId, title, startTime, emoji, repeat };
  }
  return null;
}

export async function syncReminderFromMessage(input: SyncInput): Promise<void> {
  try {
    if (input.contentType !== 'contact_card') return;
    if (!input.contactId) return; // group chat: Phase A bỏ qua
    if (!input.content) return;

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(input.content); } catch { return; }

    const reminder = extractFromCard(parsed);
    if (!reminder) return;

    const apptDate = reminder.startTime ? new Date(reminder.startTime) : new Date();
    // Time hiển thị phải tính theo timezone VN (server có thể chạy UTC trong Docker).
    // Format thủ công thay vì toLocaleTimeString vì các phiên bản Node có locale data khác nhau.
    const apptTime = reminder.startTime
      ? (() => {
          const d = new Date(reminder.startTime);
          // Cộng 7 giờ để chuyển UTC sang Asia/Ho_Chi_Minh (UTC+7, không có DST)
          const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
          const hh = String(vn.getUTCHours()).padStart(2, '0');
          const mm = String(vn.getUTCMinutes()).padStart(2, '0');
          return `${hh}:${mm}`;
        })()
      : null;

    await prisma.appointment.upsert({
      where: { orgId_externalRef: { orgId: input.orgId, externalRef: reminder.reminderId } },
      update: {
        appointmentDate: apptDate,
        appointmentTime: apptTime,
        notes: reminder.title || undefined,
        emoji: reminder.emoji,
        zaloMessageId: input.messageId,
      },
      create: {
        id: randomUUID(),
        orgId: input.orgId,
        contactId: input.contactId,
        appointmentDate: apptDate,
        appointmentTime: apptTime,
        type: reminder.repeat > 0 ? 'recurring' : 'reminder',
        status: 'scheduled',
        notes: reminder.title || null,
        source: 'zalo',
        externalRef: reminder.reminderId,
        zaloMessageId: input.messageId,
        emoji: reminder.emoji,
      },
    });

    logger.info(`[reminder-sync] Synced Zalo reminder ${reminder.reminderId} → Appointment (orgId=${input.orgId})`);
  } catch (err) {
    logger.warn('[reminder-sync] Failed to sync:', err);
  }
}
