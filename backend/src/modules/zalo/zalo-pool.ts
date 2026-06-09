/**
 * ZaloAccountPool — singleton that manages live Zalo SDK instances.
 * Handles QR login, session reconnect, message listener lifecycle,
 * and credential persistence to the database.
 *
 * Note: zca-js is imported via createRequire because its TypeScript
 * declarations don't expose named exports in ESM mode.
 */
import { createRequire } from 'module';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { attachZaloListener, type UserInfoCacheEntry } from './zalo-listener-factory.js';
import { emitWebhook } from '../api/webhook-service.js';
import { startMessageSync, stopMessageSync } from './zalo-message-sync.js';
import { backfillIfEmpty } from './zalo-history-backfill.js';
import { readFile } from 'fs/promises';
import { imageSize } from 'image-size';
import { withProxy } from './proxy-util.js';
import { writeTransition, type ZaloStatus, type StatusReason } from './status-log-service.js';

// zca-js has no reliable ESM type exports — load via CJS interop
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Zalo } = require('zca-js') as { Zalo: new (opts: { logging: boolean; selfListen?: boolean; imageMetadataGetter?: (path: string) => Promise<{ width: number; height: number; size: number }> }) => any };

async function imageMetadataGetter(filePath: string) {
  const data = await readFile(filePath);
  const info = imageSize(data);
  if (!info.width || !info.height) throw new Error(`Cannot read image size: ${filePath}`);
  return { width: info.width, height: info.height, size: data.length };
}

interface ZaloCredentials {
  cookie: any;
  imei: string;
  userAgent: string;
}

interface ZaloInstance {
  zalo: any;
  api: any;
  status: 'connected' | 'disconnected' | 'qr_pending' | 'connecting';
  displayName?: string;
  zaloUid?: string;
  lastActivity: Date;
  // Fix flap 2026-06-06: mỗi lần connect/reconnect cấp 1 epoch tăng dần. Listener
  // factory giữ epoch của nó; sự kiện 'closed' chỉ được xử lý nếu epoch khớp instance
  // hiện tại → bỏ qua 'closed' đến từ listener cũ đã bị thay thế (chống self-collision loop).
  epoch: number;
}

// Map zaloPool status → ZaloStatus enum cho status log.
// 'connecting' không được log (intermediate, không count vào uptime).
function mapToLogStatus(status: string): ZaloStatus | null {
  if (status === 'connected') return 'connected';
  if (status === 'disconnected') return 'disconnected';
  if (status === 'qr_pending') return 'qr_pending';
  if (status === 'auth_failed') return 'auth_failed';
  if (status === 'expired') return 'expired';
  return null; // 'connecting' và các status khác → skip
}

// Default reason cho mỗi status nếu caller không truyền context cụ thể.
function defaultReason(status: ZaloStatus): StatusReason {
  switch (status) {
    case 'connected': return 'login';
    case 'disconnected': return 'disconnect';
    case 'qr_pending': return 'session_expired';
    case 'auth_failed': return 'auth_fail';
    case 'expired': return 'session_expired';
  }
}

class ZaloAccountPool {
  private instances = new Map<string, ZaloInstance>();
  private io: Server | null = null;
  // Shared user-info cache passed into each listener context
  private userInfoCache = new Map<string, UserInfoCacheEntry>();
  // Circuit breaker: track disconnect timestamps per account
  private disconnectHistory = new Map<string, number[]>();

  // ── Fix flap 2026-06-06 ──
  // epochCounter: nguồn epoch tăng dần toàn cục cho mọi connect/reconnect.
  private epochCounter = 0;
  // reconnecting: in-flight guard per account — chặn 2 luồng (autoReconnect 30s timer +
  // health-check cron) cùng vào reconnect() tạo WS chồng nhau.
  private reconnecting = new Set<string>();

  // ── Sprint v3 (2026-06-03) — Sticky 24h Hold notification timers ──
  // Mỗi nick disconnect tạo 3 setTimeout (T+2 phút, T+6h, T+23h). Khi nick
  // reconnect, clear toàn bộ chain. Tránh notify "trễ" sau khi nick đã hồi.
  private stickyHoldNotificationTimers = new Map<string, NodeJS.Timeout[]>();

  setIO(io: Server): void {
    this.io = io;
  }

  /** Accessor cho module ngoài (friend-sync-service, ...) cần emit socket
   *  mà không cần register listener — dùng zaloPool như central IO registry. */
  getIO(): Server | null {
    return this.io;
  }

  /**
   * Fix flap 2026-06-06: dọn instance + listener + message-sync CŨ của 1 account
   * TRƯỚC khi tạo instance mới trong loginQR()/reconnect().
   *
   * Root cause flap: reconnect() ghi đè instances Map nhưng KHÔNG stop listener cũ →
   * WS cũ vẫn sống (retryOnClose) → Zalo thấy 2 WS cùng 1 nick → đóng bớt → 'closed' →
   * onDisconnected → autoReconnect → lặp vô hạn (nick Thành Phạm: 30 đứt/30 phút).
   *
   * stop() = ws.close(1000) + reset listener — an toàn cho cả instance đã chết.
   * Không xoá key Map ở đây vì caller set entry mới ngay sau đó.
   */
  private teardownExisting(accountId: string): void {
    const prev = this.instances.get(accountId);
    if (prev?.api?.listener) {
      try {
        prev.api.listener.stop();
      } catch (err) {
        logger.warn(`[zalo:${accountId}] teardownExisting: stop old listener failed:`, err);
      }
    }
    stopMessageSync(accountId);
  }

  // Initiate QR-based login; emits QR events to frontend via Socket.IO
  async loginQR(accountId: string, proxyUrl?: string | null): Promise<void> {
    // Fix flap 2026-06-06: dọn listener/WS cũ trước khi tạo mới (tránh duplicate WS).
    this.teardownExisting(accountId);
    const epoch = ++this.epochCounter;
    const zalo = new Zalo({ logging: false, selfListen: true, imageMetadataGetter });
    this.instances.set(accountId, { zalo, api: null, status: 'qr_pending', lastActivity: new Date(), epoch });

    try {
      const api: any = await withProxy(proxyUrl, () => zalo.loginQR({}, (event: any) => {
        switch (event.type) {
          case 0: // QRCodeGenerated
            this.io?.to(`account:${accountId}`).emit('zalo:qr', { accountId, qrImage: event.data.image });
            break;
          case 1: // QRCodeExpired
            this.io?.to(`account:${accountId}`).emit('zalo:qr-expired', { accountId });
            event.actions?.retry();
            break;
          case 2: // QRCodeScanned
            this.io?.to(`account:${accountId}`).emit('zalo:scanned', {
              accountId,
              displayName: event.data.display_name,
              avatar: event.data.avatar,
            });
            break;
          case 4: // GotLoginInfo
            this.saveCredentials(accountId, {
              cookie: event.data.cookie,
              imei: event.data.imei,
              userAgent: event.data.userAgent,
            });
            break;
        }
      }));

      const instance = this.instances.get(accountId)!;
      instance.api = api;
      instance.status = 'connected';
      instance.lastActivity = new Date();

      const ownId = await api.getOwnId();
      instance.zaloUid = ownId;

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await prisma.zaloAccount.update({
            where: { id: accountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          });
        }
      } catch {}

      this.attachListener(accountId, api);
      this.io?.emit('zalo:connected', { accountId, zaloUid: ownId });
      await this.updateAccountDB(accountId, 'connected', ownId, 'qr_scan');
      // Emit webhook (orgId lookup is async, fire-and-forget)
      prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } })
        .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.connected', { accountId }))
        .catch(() => {});

      // Fire-and-forget: link orphaned conversations on login
      this.backfillOrphanedConversations(accountId, api).catch((err) => {
        logger.warn(`[zalo:${accountId}] Backfill orphaned conversations failed:`, err);
      });

      // Fire-and-forget: initial history backfill on first login (empty DB)
      backfillIfEmpty(api, accountId).catch((err) => {
        logger.warn(`[zalo:${accountId}] Initial history backfill failed:`, err);
      });

      // Fire-and-forget: pull Zalo labels lần đầu để Friend.zaloLabels + crmTagsPerNick
      // có data ngay sau khi connect — tránh phải bấm "Đồng bộ ngay" thủ công.
      this.autoSyncOnConnect(accountId);
    } catch (err) {
      const instance = this.instances.get(accountId);
      if (instance) instance.status = 'disconnected';
      this.io?.emit('zalo:error', { accountId, error: String(err) });
      throw err;
    }
  }

  // Reconnect using previously saved session credentials
  async reconnect(accountId: string, credentials: ZaloCredentials, proxyUrl?: string | null): Promise<void> {
    // Fix flap 2026-06-06: in-flight guard — chặn 2 luồng cùng reconnect 1 nick
    // (autoReconnect 30s timer + health-check cron) tạo WS chồng nhau.
    if (this.reconnecting.has(accountId)) {
      logger.info(`[zalo:${accountId}] reconnect() already in-flight, skip duplicate`);
      return;
    }
    this.reconnecting.add(accountId);

    // Fix flap 2026-06-06: dọn listener/WS cũ trước khi tạo mới (tránh duplicate WS
    // → Zalo evict → 'closed' loop). stop() = ws.close(1000)+reset, an toàn.
    this.teardownExisting(accountId);
    const epoch = ++this.epochCounter;
    const zalo = new Zalo({ logging: false, selfListen: true, imageMetadataGetter });
    this.instances.set(accountId, { zalo, api: null, status: 'connecting', lastActivity: new Date(), epoch });

    try {
      const api: any = await withProxy(proxyUrl, () => zalo.login({
        cookie: credentials.cookie,
        imei: credentials.imei,
        userAgent: credentials.userAgent,
      }));

      const instance = this.instances.get(accountId)!;
      instance.api = api;
      instance.status = 'connected';
      instance.lastActivity = new Date();

      const ownId = await api.getOwnId();
      instance.zaloUid = ownId;

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await prisma.zaloAccount.update({
            where: { id: accountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          });
        }
      } catch {}

      this.attachListener(accountId, api);
      await this.updateAccountDB(accountId, 'connected', ownId, 'reconnect_ok');
      this.io?.emit('zalo:connected', { accountId, zaloUid: ownId });
      prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } })
        .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.connected', { accountId }))
        .catch(() => {});

      // ── Sprint v3 (2026-06-03) — Sticky 24h Hold reconnect hook ──
      // Nick hồi: clear notification chain (T+2p/6h/23h) + log event.
      // KHÔNG cần clear nick_hold_since ở đây — sequence-step-worker khi gửi
      // step tiếp theo thành công sẽ tự clear cho entry của nó (per-entry).
      // Welcome-probe-worker khi tick lại + gửi welcome thành công sẽ tự
      // xoá welcomeLastError. Hold timestamp giữ tới khi worker xử xong KH.
      void this.handleStickyHoldReconnect(accountId).catch((err) =>
        logger.error(`[zalo:${accountId}] sticky-hold onConnected error:`, err),
      );

      // Fire-and-forget: link orphaned conversations on reconnect
      this.backfillOrphanedConversations(accountId, api).catch((err) => {
        logger.warn(`[zalo:${accountId}] Backfill orphaned conversations failed:`, err);
      });

      // Fire-and-forget: pull Zalo labels sau reconnect — bắt kịp thay đổi label
      // mà user thực hiện trên Zalo Real lúc CRM offline.
      this.autoSyncOnConnect(accountId);
    } catch (err) {
      const instance = this.instances.get(accountId);
      if (instance) instance.status = 'disconnected';
      await this.updateAccountDB(accountId, 'qr_pending', null, 'reconnect_failed');
      this.io?.emit('zalo:reconnect-failed', { accountId, error: String(err) });
    } finally {
      // Fix flap 2026-06-06: luôn nhả in-flight guard dù thành công hay lỗi.
      this.reconnecting.delete(accountId);
    }
  }

  /** Pull friends + aliases + labels cho account vừa connect via syncAccountFully wrapper.
   *  Fire-and-forget — 3 nhánh parallel trong wrapper. Errors logged, không throw. */
  private autoSyncOnConnect(accountId: string): void {
    void (async () => {
      const account = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { orgId: true },
      });
      if (!account) return;
      const { syncAccountFully } = await import('./friend-sync-service.js');
      const res = await syncAccountFully(accountId, account.orgId, {
        trigger: 'connect',
        io: this.io,
      });
      logger.info(
        `[zalo:${accountId}] Auto-sync on connect: friends_emitted=${res.friends?.emittedCount ?? 0} aliases=${res.aliasesUpdated} labels=${res.labelsUpdated} errors=${res.errors.length}`,
      );
      if (res.errors.length > 0) {
        logger.warn(`[zalo:${accountId}] Auto-sync errors: ${res.errors.join(' | ')}`);
      }
    })();
  }

  // Delegate listener setup to zalo-listener-factory
  private attachListener(accountId: string, api: any): void {
    // Fix flap 2026-06-06: capture epoch của instance HIỆN TẠI tại thời điểm attach.
    // 'closed' event đến từ listener cũ (epoch lỗi thời) sẽ bị bỏ qua trong onDisconnected.
    const myEpoch = this.instances.get(accountId)?.epoch ?? this.epochCounter;
    attachZaloListener({
      accountId,
      api,
      io: this.io,
      userInfoCache: this.userInfoCache,
      onDisconnected: (id) => {
        // Fix flap 2026-06-06: nếu instance hiện tại có epoch khác → listener này đã bị
        // thay thế bởi 1 reconnect mới hơn. Bỏ qua 'closed' của nó để không set
        // disconnected oan + không dồn circuit breaker bằng disconnect ma.
        const cur = this.instances.get(id);
        if (cur && cur.epoch !== myEpoch) {
          logger.info(`[zalo:${id}] Ignoring stale 'closed' from superseded listener (epoch ${myEpoch} != current ${cur.epoch})`);
          return;
        }
        const inst = cur;
        if (inst) inst.status = 'disconnected';
        this.updateAccountDB(id, 'disconnected', null, 'disconnect');
        stopMessageSync(id);
        // Emit webhook for disconnect (fire-and-forget)
        prisma.zaloAccount.findUnique({ where: { id }, select: { orgId: true, displayName: true } })
          .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.disconnected', { accountId: id }))
          .catch(() => {});

        // ── Sprint v3 (2026-06-03) — Sticky 24h Hold hook ──
        // Khi nick chết, tag tất cả entries + outbox đang giữ với nick_hold_since=NOW().
        // Sweeper sticky-hold sẽ reset KH về queue sau 24h nếu nick chưa hồi.
        // Notification 3 mốc: T+2 phút, T+6h, T+23h gửi cho Anh + chủ nick.
        void this.handleStickyHoldDisconnect(id).catch((err) =>
          logger.error(`[zalo:${id}] sticky-hold onDisconnected error:`, err),
        );

        // Circuit breaker: track disconnect count per account
        const now = Date.now();
        const key = `dc_${id}`;
        const history = (this.disconnectHistory.get(key) || []).filter(t => now - t < 5 * 60_000);
        history.push(now);
        this.disconnectHistory.set(key, history);

        if (history.length >= 5) {
          // >5 disconnects in 5 min → stop reconnecting, require QR re-login
          logger.error(`[zalo:${id}] Circuit breaker: ${history.length} disconnects in 5 min — stopping auto-reconnect. QR re-login required.`);
          this.updateAccountDB(id, 'qr_pending', null, 'session_expired');
          this.io?.emit('zalo:reconnect-failed', { accountId: id, error: 'Session không ổn định, cần đăng nhập QR lại' });
          this.disconnectHistory.delete(key);
          return; // DON'T reconnect
        }

        // Normal auto-reconnect after 30 seconds
        setTimeout(() => this.autoReconnect(id), 30_000);
      },
    });

    // Start periodic group message sync backup
    startMessageSync(api, accountId);
  }

  // Persist session credentials to DB
  private saveCredentials(accountId: string, credentials: ZaloCredentials): void {
    prisma.zaloAccount
      .update({ where: { id: accountId }, data: { sessionData: credentials as any } })
      .catch((err) => logger.error(`[zalo:${accountId}] saveCredentials error:`, err));
  }

  // Sync account status and zaloUid to DB
  // Anh chốt 2026-05-22: kèm ghi ZaloAccountStatusLog transition cho uptime tracking.
  // Optional `reason` để phân biệt context (login / reconnect_ok / disconnect / auth_fail).
  // Mặc định map theo status nếu không truyền.
  private async updateAccountDB(
    accountId: string,
    status: string,
    zaloUid: string | null,
    reason?: StatusReason,
  ): Promise<void> {
    try {
      const updated = await prisma.zaloAccount.update({
        where: { id: accountId },
        data: {
          status,
          ...(zaloUid !== null ? { zaloUid } : {}),
          ...(status === 'connected' ? { lastConnectedAt: new Date() } : {}),
        },
        select: { orgId: true },
      });

      // Status log: chỉ ghi khi status thuộc enum ZaloStatus. Skip 'connecting' (intermediate).
      const logStatus = mapToLogStatus(status);
      if (logStatus) {
        const logReason: StatusReason = reason ?? defaultReason(logStatus);
        // Fire-and-forget — không block updateAccountDB nếu status log lỗi.
        void writeTransition({
          accountId,
          orgId: updated.orgId,
          status: logStatus,
          reason: logReason,
        });
      }

      // FIX 2026-06-08 (Anh chốt): nick vừa chuyển 'connected' → respawn nick-worker NGAY
      // (không chờ sweeper 30s). Cốt cho trường hợp nick re-login sau restart server: bootstrap
      // đã chạy lúc nick còn disconnected → bỏ sót; hook này bắt ngay khi nick online lại.
      // Import động tránh import vòng zalo-pool ↔ nick-worker. Fire-and-forget, idempotent
      // (startNickWorker skip nếu đã có worker / chỉ spawn nếu nick gắn trigger active).
      if (status === 'connected') {
        void import('../automation/friend-invite/nick-worker.js')
          .then((m) => m.respawnNickWorkerIfActive(accountId, updated.orgId))
          .catch((err) =>
            logger.warn(`[zalo:${accountId}] respawn nick-worker on connect failed: ${String(err)}`),
          );
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] updateAccountDB error:`, err);
    }
  }

  // Auto-reconnect using saved session from DB
  private async autoReconnect(accountId: string): Promise<void> {
    const inst = this.instances.get(accountId);
    // Skip if already reconnected or manually disconnected
    if (inst?.status === 'connected') return;

    try {
      const account = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { sessionData: true, proxyUrl: true },
      });
      const session = account?.sessionData as ZaloCredentials | null;
      if (session?.imei) {
        logger.info(`[zalo:${accountId}] Auto-reconnecting...`);
        await this.reconnect(accountId, session, account?.proxyUrl);
      } else {
        logger.warn(`[zalo:${accountId}] No saved session, cannot auto-reconnect`);
        this.io?.emit('zalo:reconnect-failed', { accountId, error: 'No saved session' });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Auto-reconnect failed:`, err);
      // Retry again in 2 minutes
      setTimeout(() => this.autoReconnect(accountId), 120_000);
    }
  }

  // Stop listener and remove from pool
  disconnect(accountId: string): void {
    const instance = this.instances.get(accountId);
    if (instance?.api?.listener) {
      try { instance.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping listener:`, err);
      }
    }
    stopMessageSync(accountId);
    this.instances.delete(accountId);
  }

  getStatus(accountId: string): string {
    return this.instances.get(accountId)?.status ?? 'disconnected';
  }

  getAllStatuses(): Record<string, string> {
    const statuses: Record<string, string> = {};
    for (const [id, inst] of this.instances) statuses[id] = inst.status;
    return statuses;
  }

  // Return raw API instance for direct SDK calls (e.g. public API send message)
  getApi(accountId: string): any | null {
    const inst = this.instances.get(accountId);
    return inst?.status === 'connected' ? inst.api : null;
  }

  getInstance(accountId: string): ZaloInstance | undefined {
    return this.instances.get(accountId);
  }

  // Link orphaned conversations (contactId is null) to contacts via Zalo API
  private async backfillOrphanedConversations(accountId: string, api: any): Promise<void> {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { orgId: true },
    });
    if (!account) return;

    const orphaned = await prisma.conversation.findMany({
      where: { zaloAccountId: accountId, contactId: null, threadType: 'user' },
      select: { id: true, externalThreadId: true },
    });

    if (orphaned.length === 0) return;
    logger.info(`[zalo:${accountId}] Backfilling ${orphaned.length} orphaned conversation(s)`);

    for (const conv of orphaned) {
      const uid = conv.externalThreadId;
      if (!uid) continue;

      // Wave 1.5-B (B7 fix): dùng central resolver thay vì Contact.zaloUid only dedup
      // (vi phạm rule per-account UID — Phong Lâm 2 Contacts regression).
      const { resolveOrCreateContact } = await import('../contacts/resolve-contact.js');
      const resolved = await resolveOrCreateContact({
        orgId: account.orgId,
        zaloAccountId: accountId,
        zaloUidInNick: uid,
        enrichViaGetUserInfo: true,
      });

      await prisma.conversation.update({
        where: { id: conv.id },
        data: { contactId: resolved.id },
      });
    }

    logger.info(`[zalo:${accountId}] Backfill complete: ${orphaned.length} conversation(s) linked`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sprint v3 (2026-06-03) — Sticky 24h Hold helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Khi nick disconnect:
   * 1. Tag tất cả entries có claimed_by_nick_id=accountId + queueStatus in
   *    (processing, processed) với nick_hold_since=NOW() (nếu NULL).
   * 2. Tag outbox WELCOME_PROBE chưa gửi của nick này với
   *    nick_first_offline_at=NOW() (nếu NULL).
   * 3. Lên lịch 3 notification: T+2 phút, T+6h, T+23h.
   *    Anh chốt T+23h (không phải 24h) để Anh có 1 tiếng xử lý trước reset.
   */
  private async handleStickyHoldDisconnect(accountId: string): Promise<void> {
    const now = new Date();
    try {
      const [entryCount, outboxCount, nick] = await Promise.all([
        // #2 2026-06-06 — nickHoldSince ở bảng nối per-trigger.
        prisma.triggerQueueEntry.updateMany({
          where: {
            claimedByNickId: accountId,
            queueStatus: { in: ['processing', 'processed'] },
            nickHoldSince: null,
          },
          data: { nickHoldSince: now },
        }),
        prisma.friendRequestOutbox.updateMany({
          where: {
            nickId: accountId,
            kind: 'WELCOME_PROBE',
            welcomeOutcome: null,
            nickFirstOfflineAt: null,
          },
          data: { nickFirstOfflineAt: now },
        }),
        prisma.zaloAccount.findUnique({
          where: { id: accountId },
          select: { displayName: true, ownerUserId: true, orgId: true },
        }),
      ]);

      if (!nick) return;

      const affectedKh = entryCount.count + outboxCount.count;
      if (affectedKh === 0) {
        logger.debug(`[sticky-hold] ${accountId} disconnect — 0 KH bị ảnh hưởng, skip notification`);
        return;
      }

      logger.info(
        `[sticky-hold] ${accountId} disconnect — tag ${entryCount.count} entries + ${outboxCount.count} outbox. Lên lịch 3 mốc notification.`,
      );

      // Log event nick_disconnected
      await prisma.automationEventLog.create({
        data: {
          orgId: nick.orgId,
          nickId: accountId,
          eventType: 'nick_disconnected',
          eventPriority: 'warning',
          summary: `📡 Nick ${nick.displayName ?? accountId.slice(0, 8)} mất kết nối — ${affectedKh} KH bắt đầu hold 24h chờ nick hồi.`,
          metadata: {
            disconnectedAt: now.toISOString(),
            affectedEntries: entryCount.count,
            affectedOutbox: outboxCount.count,
          },
        },
      }).catch((err) => logger.warn(`[sticky-hold] log nick_disconnected failed:`, err));

      // Clear timer cũ nếu có (tránh duplicate khi disconnect 2 lần trong 5 phút)
      const existing = this.stickyHoldNotificationTimers.get(accountId) ?? [];
      existing.forEach(clearTimeout);

      // Schedule 3 mốc notification: T+2p / T+6h / T+23h
      const timers: NodeJS.Timeout[] = [
        setTimeout(() => void this.sendStickyHoldNotification(accountId, 'T+2p'), 2 * 60_000),
        setTimeout(() => void this.sendStickyHoldNotification(accountId, 'T+6h'), 6 * 60 * 60_000),
        setTimeout(() => void this.sendStickyHoldNotification(accountId, 'T+23h'), 23 * 60 * 60_000),
      ];
      this.stickyHoldNotificationTimers.set(accountId, timers);
    } catch (err) {
      logger.error(`[sticky-hold] handleStickyHoldDisconnect ${accountId} error:`, err);
    }
  }

  /**
   * Khi nick reconnect: clear notification timer chain. KHÔNG clear
   * nick_hold_since (per-entry, worker tự xử xong khi gửi step tiếp theo).
   */
  private async handleStickyHoldReconnect(accountId: string): Promise<void> {
    const timers = this.stickyHoldNotificationTimers.get(accountId);
    if (timers && timers.length > 0) {
      timers.forEach(clearTimeout);
      this.stickyHoldNotificationTimers.delete(accountId);
      logger.info(`[sticky-hold] ${accountId} reconnect — clear ${timers.length} pending notifications`);
    }

    // Log event nick_reconnected
    try {
      const nick = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { displayName: true, orgId: true },
      });
      if (!nick) return;
      await prisma.automationEventLog.create({
        data: {
          orgId: nick.orgId,
          nickId: accountId,
          eventType: 'nick_reconnected',
          eventPriority: 'info',
          summary: `✅ Nick ${nick.displayName ?? accountId.slice(0, 8)} hồi tỉnh — KH đang hold tiếp tục được chăm.`,
          metadata: { reconnectedAt: new Date().toISOString() },
        },
      });
    } catch (err) {
      logger.warn(`[sticky-hold] log nick_reconnected failed:`, err);
    }
  }

  /**
   * Gửi notification 1 trong 3 mốc (T+2p / T+6h / T+23h) qua kênh Zalo nội bộ
   * tới Anh (system notify nick) + chủ nick.
   *
   * Anh chốt câu 4: gửi cho cả 2 (Anh + chủ nick).
   */
  private async sendStickyHoldNotification(
    accountId: string,
    milestone: 'T+2p' | 'T+6h' | 'T+23h',
  ): Promise<void> {
    try {
      const nick = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: {
          displayName: true,
          status: true,
          ownerUserId: true,
          orgId: true,
        },
      });
      if (!nick) return;

      // Nick đã hồi → bỏ qua (defensive race check)
      if (nick.status === 'connected') {
        logger.debug(`[sticky-hold] ${accountId} ${milestone}: nick đã hồi, skip notification`);
        return;
      }

      // #2 2026-06-06 — đếm hàng đang hold ở bảng nối per-trigger.
      const affectedCount = await prisma.triggerQueueEntry.count({
        where: {
          claimedByNickId: accountId,
          nickHoldSince: { not: null },
        },
      });

      const nickDisplay = nick.displayName ?? accountId.slice(0, 8);
      let summary = '';
      if (milestone === 'T+2p') {
        summary = `📡 Nick ${nickDisplay} mất kết nối 2 phút — đang ảnh hưởng ${affectedCount} KH chờ welcome+sequence. Anh kiểm tra giúp.`;
      } else if (milestone === 'T+6h') {
        summary = `⏰ Nick ${nickDisplay} chết 6 giờ — ${affectedCount} KH chờ. Còn 18h nữa sẽ tự reset sang nick khác nếu nick chưa hồi.`;
      } else if (milestone === 'T+23h') {
        summary = `🚨 Nick ${nickDisplay} chết 23 giờ — ${affectedCount} KH chờ. CÒN 1 GIỜ nữa hệ thống sẽ reset KH về queue cho nick khác. Anh quyết định!`;
      }

      // Log event notification_sent
      await prisma.automationEventLog.create({
        data: {
          orgId: nick.orgId,
          nickId: accountId,
          eventType: 'notification_sent',
          eventPriority: milestone === 'T+23h' ? 'urgent' : 'warning',
          summary,
          metadata: {
            milestone,
            affectedCount,
            ownerUserId: nick.ownerUserId,
          },
        },
      });

      // ── Sprint v3 (2026-06-03) — Gửi tin Zalo nội bộ thật qua systemNotifyZaloAccount ──
      // Anh chốt câu 4: gửi cho Anh (org owner) + chủ nick. Dùng helper
      // sendSystemNotificationToUser từ module system-notifications.
      try {
        // Lazy-load để tránh circular dependency với private-hs module
        const mod = await import('../system-notifications/system-notify-service.js').catch(() => null);
        if (!mod) {
          logger.warn(`[sticky-hold] system-notify-service không khả dụng (private-hs path), skip Zalo send`);
          return;
        }
        const recipients = new Set<string>();
        // 1. Chủ nick
        if (nick.ownerUserId) recipients.add(nick.ownerUserId);
        // 2. Org owner (Anh Lộc)
        const orgOwner = await prisma.user.findFirst({
          where: { orgId: nick.orgId, role: 'owner' },
          select: { id: true },
        });
        if (orgOwner) recipients.add(orgOwner.id);

        const priority: 'normal' | 'high' = milestone === 'T+23h' ? 'high' : 'normal';
        const title = milestone === 'T+23h'
          ? `🚨 Còn 1h tới reset nick ${nickDisplay}`
          : milestone === 'T+6h'
            ? `⏰ Nick ${nickDisplay} chết 6h`
            : `📡 Nick ${nickDisplay} mất kết nối`;

        for (const userId of recipients) {
          void mod.sendSystemNotificationToUser({
            orgId: nick.orgId,
            targetUserId: userId,
            type: 'sticky_hold_notification',
            title,
            content: summary,
            priority,
          }).catch((err) =>
            logger.warn(`[sticky-hold] sendSystemNotificationToUser ${userId} failed: ${err?.message ?? err}`),
          );
        }
      } catch (sendErr) {
        logger.warn(`[sticky-hold] gửi Zalo nội bộ thất bại: ${(sendErr as Error)?.message ?? sendErr}`);
      }
      logger.info(`[sticky-hold] ${accountId} ${milestone}: ${summary}`);
    } catch (err) {
      logger.error(`[sticky-hold] sendStickyHoldNotification ${accountId} ${milestone}:`, err);
    }
  }
}

export const zaloPool = new ZaloAccountPool();
