// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension
/**
 * target-cron.ts — Worker Mục tiêu (auto kết bạn).
 *
 * Tick mỗi 30s, mỗi job active thử gửi TỐI ĐA 1 lời mời/tick, tôn trọng giãn cách
 * delaySecMin..Max + khung giờ 8h-21h (dùng chung broadcast-service). 2 nguồn target:
 *   - customer_list: CustomerListEntry có hasZalo=true — cần findUser qua SĐT trước
 *     (attemptFriendRequest, campaign-service có sẵn).
 *   - group_scan: GroupMember (isFriend=false) của scan — ĐÃ có UID sẵn (memberUid),
 *     gửi thẳng không cần findUser (attemptFriendRequestByUid).
 *
 * QUAN TRỌNG: cả 2 hàm attemptFriendRequest*() tạo FriendshipAttempt NGAY (unique
 * theo nick+contact) trước khi gọi Zalo API — nếu cứ gọi đều khi nick đã chạm trần
 * friend_action, sẽ "đốt" vĩnh viễn từng contact thành lỗi (không thể thử lại contact
 * đó với nick này nữa). Nên PRE-CHECK qua zaloRateLimiter.checkLimits() (không tốn gì,
 * không ghi nhận) trước khi thử — nick chạm trần thì bỏ qua tick, không đụng contact nào.
 *
 * TIN CHÀO (vòng 6): job bật welcomeEnabled → item 'sent' được đánh welcomeStatus
 * 'waiting'. Mỗi tick, pass thứ 2 đối chiếu FriendshipAttempt.state='accepted' (do
 * friend-event-handler cập nhật từ event Zalo thật) → gửi tin chào (welcomeMsg hoặc
 * xoay vòng welcomeBlockIds, dùng chung resolveJobContent với Broadcast), tối đa
 * 1 tin/job/tick, giãn cách delaySecMin..Max riêng. Job 'done' (hết lời mời) VẪN
 * tiếp tục chào khách chấp nhận muộn — chỉ 'paused' mới dừng cả hai.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { zaloOps, ZaloOpError } from '../../shared/zalo-operations.js';
import { resolveOrCreateContact } from '../contacts/resolve-contact.js';
import { attemptFriendRequest, attemptFriendRequestByUid } from '../campaign/campaign-service.js';
import { renderMessage, randomDelayMs, isWithinSendWindow } from '../broadcast/broadcast-service.js';
import { resolveJobContent } from '../broadcast/broadcast-cron.js';
import { downloadMediaToTemp } from '../chat/chat-media-helpers.js';

let running = false;

export function startTargetCron(): void {
  cron.schedule('*/30 * * * * *', async () => {
    if (running) return; // chống chồng tick khi findUser/sendFriendRequest chậm
    running = true;
    try {
      await runTargetTick();
    } catch (err) {
      logger.error('[target-cron] tick error', err);
    } finally {
      running = false;
    }
  });
  logger.info('[target-cron] scheduled every 30s');
}

type JobRow = {
  id: string; orgId: string; sourceType: string; customerListId: string | null; groupScanId: string | null;
  zaloAccountId: string; requestMsg: string; maxTotal: number; delaySecMin: number; delaySecMax: number;
  lastSentAt: Date | null; sentCount: number; noZaloCount: number; failedCount: number;
  welcomeEnabled: boolean;
};

type WelcomeJobRow = {
  id: string; orgId: string; zaloAccountId: string;
  delaySecMin: number; delaySecMax: number;
  welcomeMsg: string; welcomeBlockIds: string[]; welcomedCount: number; lastWelcomeAt: Date | null;
};

export async function runTargetTick(): Promise<void> {
  const now = new Date();
  if (!isWithinSendWindow(now)) return; // ngoài khung giờ 8h-21h — chờ tick sau

  const jobs = await runSystemQuery(() =>
    prisma.targetJob.findMany({
      where: { status: 'active' },
      select: {
        id: true, orgId: true, sourceType: true, customerListId: true, groupScanId: true, zaloAccountId: true,
        requestMsg: true, maxTotal: true, delaySecMin: true, delaySecMax: true,
        lastSentAt: true, sentCount: true, noZaloCount: true, failedCount: true,
        welcomeEnabled: true,
      },
    }),
  );

  for (const job of jobs) {
    await withTenant(job.orgId, () => processJob(job, now))
      .catch((err) => logger.error(`[target-cron] job=${job.id} error`, err));
  }

  // ── Pass 2: Tin chào khách vừa chấp nhận kết bạn ─────────────────────────
  // Job 'done' vẫn chào (khách chấp nhận muộn nhiều ngày sau khi hết lời mời).
  const welcomeJobs = await runSystemQuery(() =>
    prisma.targetJob.findMany({
      where: { welcomeEnabled: true, status: { in: ['active', 'done'] } },
      select: {
        id: true, orgId: true, zaloAccountId: true, delaySecMin: true, delaySecMax: true,
        welcomeMsg: true, welcomeBlockIds: true, welcomedCount: true, lastWelcomeAt: true,
      },
    }),
  );

  for (const job of welcomeJobs) {
    await withTenant(job.orgId, () => processWelcome(job, now))
      .catch((err) => logger.error(`[target-cron] welcome job=${job.id} error`, err));
  }
}

/**
 * Gửi tin chào cho khách ĐÃ chấp nhận kết bạn (tối đa 1 tin/job/tick).
 * Đối chiếu: TargetRunItem(welcomeStatus='waiting') × FriendshipAttempt(state='accepted').
 */
async function processWelcome(job: WelcomeJobRow, now: Date): Promise<void> {
  // Giãn cách chống block giữa 2 tin chào (dùng chung cấu hình delay của job)
  if (job.lastWelcomeAt && now.getTime() - job.lastWelcomeAt.getTime() < randomDelayMs(job.delaySecMin, job.delaySecMax)) {
    return;
  }

  // Join thẳng item 'waiting' × attempt 'accepted' — không giới hạn batch, tránh
  // bỏ sót khách chấp nhận muộn khi job có nhiều item chờ phía trước.
  const rows = await prisma.$queryRaw<Array<{ id: string; zalo_uid: string | null; name: string | null; phone: string | null }>>`
    SELECT tri.id, tri.zalo_uid, tri.name, tri.phone
      FROM target_run_items tri
      JOIN friendship_attempts fa
        ON fa.contact_id = tri.contact_id
       AND fa.zalo_account_id = ${job.zaloAccountId}
       AND fa.state = 'accepted'
     WHERE tri.job_id = ${job.id}
       AND tri.status = 'sent'
       AND tri.welcome_status = 'waiting'
       AND tri.contact_id IS NOT NULL
     ORDER BY tri.created_at ASC
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return; // chưa ai chấp nhận — chờ tick sau
  const item = { id: row.id, zaloUid: row.zalo_uid, name: row.name, phone: row.phone };

  // P4 (C2) — optimistic lock: waiting → sending. Chỉ tick thắng (count=1) mới gửi, tránh
  // 2 tick sát nhau cùng đọc 1 row 'waiting' rồi cùng gửi 1 khách. Trên RATE_LIMITED/
  // NOT_CONNECTED sẽ revert về 'waiting' để thử lại; crash sau claim → kẹt 'sending'
  // (trade-off at-most-once, cần sweeper reclaim nếu muốn).
  const claimed = await prisma.targetRunItem.updateMany({
    where: { id: item.id, welcomeStatus: 'waiting' },
    data: { welcomeStatus: 'sending' },
  });
  if (claimed.count !== 1) return; // tick khác đã claim row này

  if (!item.zaloUid) {
    // Thiếu UID (bất thường) — đánh failed để không kẹt hàng đợi
    await markWelcome(job.id, item.id, 'failed', 'thieu_zalo_uid');
    return;
  }

  try {
    // Nội dung: xoay vòng welcomeBlockIds (spin content) hoặc welcomeMsg gõ tay
    const content = await resolveJobContent(
      { messageText: job.welcomeMsg, imageUrl: null, contentBlockIds: job.welcomeBlockIds },
      job.welcomedCount,
      job.orgId,
    );
    const text = renderMessage(content.messageText, { name: item.name, phone: item.phone });
    if (!text.trim() && !content.imageUrl) {
      await markWelcome(job.id, item.id, 'failed', 'welcome_msg_rong');
      return;
    }

    if (content.imageUrl) {
      const media = await downloadMediaToTemp({ url: content.imageUrl }, 'image/jpeg');
      try {
        await zaloOps.sendImage(job.zaloAccountId, item.zaloUid, 0, [media.path], null, text);
      } finally {
        await media.cleanup().catch(() => {});
      }
    } else {
      await zaloOps.sendMessage(job.zaloAccountId, item.zaloUid, 0, { msg: text });
    }

    if (content.blockId) {
      await prisma.contentBlock.update({ where: { id: content.blockId }, data: { usageCount: { increment: 1 } } }).catch(() => {});
    }
    await markWelcome(job.id, item.id, 'sent', null);
    logger.info(`[target-cron] welcome job=${job.id} sent → uid=${item.zaloUid}`);
  } catch (err: any) {
    if (err instanceof ZaloOpError && (err.code === 'RATE_LIMITED' || err.code === 'NOT_CONNECTED')) {
      // Nick chạm trần tin/mất kết nối — revert claim 'sending' → 'waiting', chờ tick sau
      await prisma.targetRunItem.updateMany({
        where: { id: item.id, welcomeStatus: 'sending' }, data: { welcomeStatus: 'waiting' },
      }).catch(() => {});
      logger.warn(`[target-cron] welcome job=${job.id} paused by nick: ${err.code}`);
      return;
    }
    await markWelcome(job.id, item.id, 'failed', String(err?.message ?? err).slice(0, 500));
  }
}

async function markWelcome(jobId: string, itemId: string, status: 'sent' | 'failed', error: string | null): Promise<void> {
  await prisma.$transaction([
    prisma.targetRunItem.update({
      where: { id: itemId },
      data: { welcomeStatus: status, welcomeError: error, ...(status === 'sent' ? { welcomeSentAt: new Date() } : {}) },
    }),
    prisma.targetJob.update({
      where: { id: jobId },
      data: status === 'sent'
        ? { welcomedCount: { increment: 1 }, lastWelcomeAt: new Date() }
        : { welcomeFailedCount: { increment: 1 } },
    }),
  ]);
}

async function processJob(job: JobRow, now: Date): Promise<void> {
  // Giãn cách chống block giữa 2 lời mời
  if (job.lastSentAt && now.getTime() - job.lastSentAt.getTime() < randomDelayMs(job.delaySecMin, job.delaySecMax)) {
    return;
  }

  const processed = job.sentCount + job.noZaloCount + job.failedCount;
  if (processed >= job.maxTotal) {
    await prisma.targetJob.update({ where: { id: job.id }, data: { status: 'done' } });
    logger.info(`[target-cron] job=${job.id} done (maxTotal reached)`);
    return;
  }

  // Pre-check trần — KHÔNG ghi nhận gì, chỉ tránh "đốt" contact khi nick chạm trần.
  // failClosed (P5/D1): limiter lỗi → dừng luồng hàng loạt, không xả lời mời vượt trần.
  const check = await zaloRateLimiter.checkLimits(job.zaloAccountId, 'friend_action', { failClosed: true });
  if (!check.allowed) return; // chờ tick sau, giữ nguyên target chưa xử lý

  if (job.sourceType === 'group_scan') {
    // group_scan có UID sẵn → chỉ gọi sendFriendRequest (friend_action), không findUser.
    await processGroupScanTarget(job);
  } else {
    // customer_list gọi findUser (friend_lookup) TRƯỚC sendFriendRequest (friend_action).
    // Phải pre-check CẢ friend_lookup: nếu không, nick chạm trần friend_lookup vẫn tạo
    // FriendshipAttempt rồi findUser ném RATE_LIMITED → item 'failed' vĩnh viễn (C1).
    const lookup = await zaloRateLimiter.checkLimits(job.zaloAccountId, 'friend_lookup', { failClosed: true });
    if (!lookup.allowed) return; // chờ quota friend_lookup hồi, chưa đụng contact nào
    await processCustomerListTarget(job);
  }
}

// ── Nguồn: Tệp khách hàng (CustomerListEntry, cần findUser qua SĐT) ─────────
async function processCustomerListTarget(job: JobRow): Promise<void> {
  const done = await prisma.targetRunItem.findMany({ where: { jobId: job.id }, select: { entryId: true } });
  const entry = await prisma.customerListEntry.findFirst({
    where: {
      customerListId: job.customerListId ?? '',
      hasZalo: true,
      ...(done.length ? { id: { notIn: done.map((d) => d.entryId) } } : {}),
    },
    orderBy: { rowIndex: 'asc' },
    select: { id: true, phoneLocal: true, phoneE164: true, nameRaw: true, zaloName: true, zaloUid: true, contactId: true },
  });
  if (!entry) {
    await prisma.targetJob.update({ where: { id: job.id }, data: { status: 'done' } });
    logger.info(`[target-cron] job=${job.id} done (hết đối tượng trong tệp)`);
    return;
  }

  const phone = entry.phoneLocal ?? entry.phoneE164 ?? '';
  const name = entry.zaloName ?? entry.nameRaw ?? null;

  try {
    // Đảm bảo entry có Contact (attemptFriendRequest cần contactId) — tạo nếu chưa có.
    let contactId = entry.contactId;
    if (!contactId) {
      const c = await resolveOrCreateContact({
        orgId: job.orgId, zaloAccountId: job.zaloAccountId,
        zaloUidInNick: entry.zaloUid, phone: entry.phoneE164, fallbackFullName: name,
      });
      contactId = c.id;
      await prisma.customerListEntry.update({ where: { id: entry.id }, data: { contactId } });
    }

    // Gửi lời mời kết bạn — tái dùng nguyên vẹn attemptFriendRequest (đã có
    // audit trail FriendshipAttempt + mirror Friend "Đã gửi lời mời").
    const message = renderMessage(job.requestMsg, { name, phone });
    const outcome = await attemptFriendRequest({
      orgId: job.orgId, zaloAccountId: job.zaloAccountId, contactId, phone, message,
    });

    if (outcome.ok) {
      await recordItem(job.id, job.orgId, entry.id, phone, name, outcome.zaloUid, 'sent', null, contactId, job.welcomeEnabled);
      logger.info(`[target-cron] job=${job.id} sent → ${phone}`);
    } else if (outcome.state === 'no_zalo') {
      await recordItem(job.id, job.orgId, entry.id, phone, name, null, 'no_zalo', null);
    } else {
      await recordItem(job.id, job.orgId, entry.id, phone, name, null, 'failed', `${outcome.errorCode}: ${outcome.errorDetail}`.slice(0, 500));
    }
  } catch (err: any) {
    // Unique constraint (P2002) — nick này đã từng thử contact này rồi (vd trùng nguồn
    // giữa nhiều tệp). Ghi skipped, không tính lỗi, tiếp tục tick sau với entry kế tiếp.
    if (err?.code === 'P2002') {
      await recordItem(job.id, job.orgId, entry.id, phone, name, null, 'skipped', 'da_tung_thu_contact_nay');
      return;
    }
    await recordItem(job.id, job.orgId, entry.id, phone, name, null, 'failed', String(err?.message ?? err).slice(0, 500));
  }
}

// ── Nguồn: Quét nhóm (GroupMember, đã có UID sẵn, gửi thẳng không cần findUser) ──
async function processGroupScanTarget(job: JobRow): Promise<void> {
  const scan = await prisma.groupScan.findUnique({ where: { id: job.groupScanId ?? '' }, select: { groupIds: true } });
  const groupIds: string[] = Array.isArray(scan?.groupIds) ? (scan!.groupIds as unknown[]).map(String) : [];
  if (groupIds.length === 0) {
    await prisma.targetJob.update({ where: { id: job.id }, data: { status: 'done' } });
    logger.info(`[target-cron] job=${job.id} done (scan không còn tồn tại/rỗng)`);
    return;
  }

  // Nick luôn là member trong nhóm của chính nó — loại trừ, không tự kết bạn với chính mình.
  const self = await prisma.zaloAccount.findUnique({ where: { id: job.zaloAccountId }, select: { zaloUid: true } });

  const done = await prisma.targetRunItem.findMany({ where: { jobId: job.id }, select: { entryId: true } });
  const member = await prisma.groupMember.findFirst({
    where: {
      zaloAccountId: job.zaloAccountId,
      groupId: { in: groupIds },
      isFriend: false,
      ...(self?.zaloUid ? { memberUid: { not: self.zaloUid } } : {}),
      ...(done.length ? { id: { notIn: done.map((d) => d.entryId) } } : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, memberUid: true, displayName: true, zaloName: true },
  });
  if (!member) {
    await prisma.targetJob.update({ where: { id: job.id }, data: { status: 'done' } });
    logger.info(`[target-cron] job=${job.id} done (hết member chưa kết bạn trong nhóm đã quét)`);
    return;
  }

  const name = member.displayName ?? member.zaloName ?? null;

  try {
    let contactId: string;
    {
      const c = await resolveOrCreateContact({
        orgId: job.orgId, zaloAccountId: job.zaloAccountId,
        zaloUidInNick: member.memberUid, fallbackFullName: name,
      });
      contactId = c.id;
    }

    const message = renderMessage(job.requestMsg, { name, phone: null });
    const outcome = await attemptFriendRequestByUid({
      orgId: job.orgId, zaloAccountId: job.zaloAccountId, contactId, zaloUid: member.memberUid, message,
    });

    if (outcome.ok) {
      await recordItem(job.id, job.orgId, member.id, null, name, outcome.zaloUid, 'sent', null, contactId, job.welcomeEnabled);
      logger.info(`[target-cron] job=${job.id} sent → uid=${member.memberUid}`);
    } else {
      await recordItem(job.id, job.orgId, member.id, null, name, null, 'failed', `${outcome.errorCode}: ${outcome.errorDetail}`.slice(0, 500));
    }
  } catch (err: any) {
    if (err?.code === 'P2002') {
      await recordItem(job.id, job.orgId, member.id, null, name, null, 'skipped', 'da_tung_thu_contact_nay');
      return;
    }
    await recordItem(job.id, job.orgId, member.id, null, name, null, 'failed', String(err?.message ?? err).slice(0, 500));
  }
}

async function recordItem(
  jobId: string, orgId: string, entryId: string, phone: string | null, name: string | null,
  zaloUid: string | null, status: 'sent' | 'no_zalo' | 'failed' | 'skipped', error: string | null,
  contactId: string | null = null, welcomeEnabled = false,
): Promise<void> {
  const counter = status === 'sent' ? 'sentCount' : status === 'no_zalo' ? 'noZaloCount' : status === 'failed' ? 'failedCount' : null;
  // Job bật tin chào + lời mời gửi thành công → xếp hàng chờ khách chấp nhận (pass 2)
  const welcomeStatus = welcomeEnabled && status === 'sent' ? 'waiting' : null;
  await prisma.$transaction([
    prisma.targetRunItem.create({ data: { jobId, orgId, entryId, phone, name, zaloUid, status, error, contactId, welcomeStatus } }),
    prisma.targetJob.update({
      where: { id: jobId },
      data: { ...(counter ? { [counter]: { increment: 1 } } : {}), ...(status === 'sent' ? { lastSentAt: new Date() } : {}) },
    }),
  ]);
}
