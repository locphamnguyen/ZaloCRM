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
  // Accounts manually disabled — suppress auto-reconnect
  private manuallyDisabled = new Set<string>();

  setIO(io: Server): void {
    this.io = io;
  }

  /** Accessor cho module ngoài (friend-sync-service, ...) cần emit socket
   *  mà không cần register listener — dùng zaloPool như central IO registry. */
  getIO(): Server | null {
    return this.io;
  }

  // Initiate QR-based login; emits QR events to frontend via Socket.IO
  async loginQR(accountId: string, proxyUrl?: string | null): Promise<void> {
    this.manuallyDisabled.delete(accountId);
    const zalo = new Zalo({ logging: false, selfListen: true, imageMetadataGetter });
    this.instances.set(accountId, { zalo, api: null, status: 'qr_pending', lastActivity: new Date() });

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

      let activeAccountId = accountId;
      const instance = this.instances.get(accountId)!;
      instance.api = api;
      instance.status = 'connected';
      instance.lastActivity = new Date();

      const ownId = await api.getOwnId();
      instance.zaloUid = ownId;

      // Check if an archived account with the same zaloUid exists — restore it
      const archivedAccount = await prisma.zaloAccount.findFirst({
        where: { zaloUid: String(ownId), archivedAt: { not: null }, purged: false, id: { not: accountId } },
        select: { id: true },
      });
      if (archivedAccount) {
        logger.info(`[zalo:${accountId}] Found archived account ${archivedAccount.id} with same zaloUid — restoring`);
        // Transfer session to archived account + unarchive
        const currentAccount = await prisma.zaloAccount.findUnique({
          where: { id: accountId },
          select: { sessionData: true, proxyUrl: true },
        });
        await prisma.zaloAccount.update({
          where: { id: archivedAccount.id },
          data: {
            archivedAt: null,
            status: 'connected',
            sessionData: currentAccount?.sessionData ?? undefined,
            zaloUid: String(ownId),
            lastConnectedAt: new Date(),
          },
        });
        // Delete the new empty account
        await prisma.zaloAccount.delete({ where: { id: accountId } }).catch(() => {});
        // Switch pool instance to old account ID
        this.instances.delete(accountId);
        this.instances.set(archivedAccount.id, instance);
        activeAccountId = archivedAccount.id;
      }

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await prisma.zaloAccount.update({
            where: { id: activeAccountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          });
        }
      } catch {}

      this.attachListener(activeAccountId, api);
      this.io?.emit('zalo:connected', { accountId: activeAccountId, zaloUid: ownId });
      await this.updateAccountDB(activeAccountId, 'connected', ownId, 'qr_scan');
      prisma.zaloAccount.findUnique({ where: { id: activeAccountId }, select: { orgId: true } })
        .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.connected', { accountId: activeAccountId }))
        .catch(() => {});

      this.backfillOrphanedConversations(activeAccountId, api).catch((err) => {
        logger.warn(`[zalo:${activeAccountId}] Backfill orphaned conversations failed:`, err);
      });

      backfillIfEmpty(api, activeAccountId).catch((err) => {
        logger.warn(`[zalo:${activeAccountId}] Initial history backfill failed:`, err);
      });

      this.autoSyncOnConnect(activeAccountId);
    } catch (err) {
      const instance = this.instances.get(accountId);
      if (instance) instance.status = 'disconnected';
      this.io?.emit('zalo:error', { accountId, error: String(err) });
      throw err;
    }
  }

  // Reconnect using previously saved session credentials
  async reconnect(accountId: string, credentials: ZaloCredentials, proxyUrl?: string | null): Promise<void> {
    this.manuallyDisabled.delete(accountId);
    const zalo = new Zalo({ logging: false, selfListen: true, imageMetadataGetter });
    this.instances.set(accountId, { zalo, api: null, status: 'connecting', lastActivity: new Date() });

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
    attachZaloListener({
      accountId,
      api,
      io: this.io,
      userInfoCache: this.userInfoCache,
      onDisconnected: (id) => {
        // If manually disabled, skip all reconnect logic
        if (this.manuallyDisabled.has(id)) return;

        const inst = this.instances.get(id);
        if (inst) inst.status = 'disconnected';
        this.updateAccountDB(id, 'disconnected', null, 'disconnect');
        stopMessageSync(id);
        // Emit webhook for disconnect (fire-and-forget)
        prisma.zaloAccount.findUnique({ where: { id }, select: { orgId: true } })
          .then((rec) => rec && emitWebhook(rec.orgId, 'zalo.disconnected', { accountId: id }))
          .catch(() => {});

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
    } catch (err) {
      logger.error(`[zalo:${accountId}] updateAccountDB error:`, err);
    }
  }

  // Auto-reconnect using saved session from DB
  private async autoReconnect(accountId: string): Promise<void> {
    // Skip if manually disabled via disconnect/disable action
    if (this.manuallyDisabled.has(accountId)) return;
    const inst = this.instances.get(accountId);
    // Skip if already reconnected
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
    this.manuallyDisabled.add(accountId);
    const instance = this.instances.get(accountId);
    if (instance) {
      instance.status = 'disconnected';
    }
    this.instances.delete(accountId);
    if (instance?.api?.listener) {
      try { instance.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping listener:`, err);
      }
    }
    stopMessageSync(accountId);
  }

  // Disconnect for session refresh (daily cron) — does NOT mark as manually disabled
  disconnectForRefresh(accountId: string): void {
    const instance = this.instances.get(accountId);
    this.instances.delete(accountId);
    if (instance?.api?.listener) {
      try { instance.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping listener:`, err);
      }
    }
    stopMessageSync(accountId);
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

      let contact = await prisma.contact.findFirst({
        where: { zaloUid: uid, orgId: account.orgId },
        select: { id: true },
      });

      if (!contact) {
        let zaloName = '';
        let avatar = '';
        let phone = '';
        try {
          const result = await api.getUserInfo(uid);
          const profiles = result?.changed_profiles || {};
          const profile = profiles[uid] || profiles[`${uid}_0`];
          if (profile) {
            zaloName = profile.zaloName || profile.zalo_name || profile.displayName || profile.display_name || '';
            avatar = profile.avatar || '';
            phone = profile.phoneNumber || '';
          }
        } catch (err) {
          logger.warn(`[zalo:${accountId}] getUserInfo failed for ${uid}:`, err);
        }

        const { randomUUID } = await import('node:crypto');
        contact = await prisma.contact.create({
          data: {
            id: randomUUID(),
            orgId: account.orgId,
            zaloUid: uid,
            fullName: zaloName || 'Unknown',
            avatarUrl: avatar || null,
            phone: phone || null,
          },
          select: { id: true },
        });
      }

      await prisma.conversation.update({
        where: { id: conv.id },
        data: { contactId: contact.id },
      });
    }

    logger.info(`[zalo:${accountId}] Backfill complete: ${orphaned.length} conversation(s) linked`);
  }
}

export const zaloPool = new ZaloAccountPool();
