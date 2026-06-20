// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';
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
  orgId?: string; // FIX #A 2026-06-16: cache orgId để emit sự kiện vào đúng room org (không broadcast bare)
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
   * FIX #A (2026-06-16): emit sự kiện account-level vào ĐÚNG room org thay vì `io.emit` BARE.
   *
   * Trước đây `zalo:connected`/`zalo:error`/`zalo:reconnect-failed` dùng `this.io.emit(...)`
   * = broadcast TOÀN server (mọi org, mọi sale). Hệ quả:
   *   1. Bất kỳ nick nào (kể cả cron tự reconnect) connect → bắn tới FE đang treo QR của
   *      người KHÁC → FE tưởng "kết nối thành công" giả (gốc trigger bug báo-giả).
   *   2. Lỗ cross-tenant: org A nhận {accountId, zaloUid} của org B.
   * Sửa: gửi vào `org:${orgId}` (room đã auto-join từ token ở socket-auth.ts) → chỉ sale
   * cùng org nhận. orgId cache trong instance để tránh query lặp. (qr/scanned/duplicate đã
   * `.to(account:)` từ trước — đây gom connected/error/reconnect-failed cho nhất quán.)
   */
  private async emitAccountEventToOrg(accountId: string, event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.io) return;
    try {
      const inst = this.instances.get(accountId);
      let orgId = inst?.orgId;
      if (!orgId) {
        const rec = await prisma.zaloAccount.findUnique({ where: { id: accountId }, select: { orgId: true } });
        orgId = rec?.orgId;
        if (orgId && inst) inst.orgId = orgId; // cache cho lần sau
      }
      if (orgId) this.io.to(`org:${orgId}`).emit(event, payload);
      else logger.warn(`[zalo-pool] emitAccountEventToOrg: không tìm orgId cho account ${accountId} (event=${event})`);
    } catch (err) {
      logger.error(`[zalo-pool] emitAccountEventToOrg lỗi (event=${event}):`, err);
    }
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
    // Fix lifecycle 2026-06-10: nick kẹt qr_pending/connecting do logout bên ngoài hoặc
    // breaker chặn. User CHỦ ĐỘNG quét QR lại → phải dọn SẠCH mọi state cũ trước khi tạo
    // instance mới, nếu không QR mới không sinh / bị instance ma ghi đè.
    const prev = this.instances.get(accountId);
    const hadStale = !!prev;
    logger.info(
      `[zalo:${accountId}] loginQR start — prevInstance=${hadStale ? prev!.status : 'none'} epoch=${prev?.epoch ?? '-'}`,
    );

    // (1) Dọn listener/WS/message-sync cũ (Fix flap 2026-06-06).
    this.teardownExisting(accountId);
    // (2) Nhả in-flight reconnect guard — nếu 1 reconnect cũ kẹt guard sẽ chặn luồng sau.
    this.reconnecting.delete(accountId);
    // (3) Clear sticky-hold notification timers — user đang re-login, không cần báo "nick chết".
    const holdTimers = this.stickyHoldNotificationTimers.get(accountId);
    if (holdTimers?.length) {
      holdTimers.forEach(clearTimeout);
      this.stickyHoldNotificationTimers.delete(accountId);
    }
    // (4) RESET circuit breaker: breaker chỉ để chặn AUTO-reconnect, KHÔNG được chặn người
    //     dùng quét QR thủ công. Xoá lịch sử disconnect để nick "sạch" sau khi re-login.
    if (this.disconnectHistory.delete(`dc_${accountId}`)) {
      logger.info(`[zalo:${accountId}] loginQR — circuit breaker history cleared (manual QR re-login)`);
    }

    const epoch = ++this.epochCounter;
    // (5) Bump epoch + set instance mới NGAY → mọi autoReconnect timer cũ đang chờ (30s/2min)
    //     khi fire sẽ thấy epoch lệch / status mới và bỏ qua, không ghi đè instance QR mới.
    const zalo = new Zalo({ logging: false, selfListen: true, imageMetadataGetter });
    this.instances.set(accountId, { zalo, api: null, status: 'qr_pending', lastActivity: new Date(), epoch });
    logger.info(`[zalo:${accountId}] loginQR — fresh instance created (epoch=${epoch}), waiting for QR event…`);

    // FIX #2 (2026-06-16): giới hạn số lần QR tự sinh lại. Trước đây QRCodeExpired luôn gọi
    // retry() VÔ HẠN trên CÙNG phiên SDK → QR sinh lại mãi nhưng quét không ăn ("tạo QR mới
    // không có tác dụng"). Sau MAX_QR_RETRY lần hết hạn → DỪNG retry, emit qr-session-dead để
    // FE hiện nút "Quét lại" → tạo phiên FRESH (loginQR mới, epoch mới).
    const MAX_QR_RETRY = 3;
    let qrExpiredCount = 0;
    // FIX #6 (2026-06-16): epoch guard. login lần 2 trên cùng nick tạo instance mới (epoch++);
    // callback của phiên CŨ vẫn sống tới khi QR cũ expire → nếu nó emit sẽ trộn QR/ghi đè state
    // của phiên mới. Chỉ xử lý event nếu epoch callback CÒN khớp instance hiện tại.
    const isCurrentEpoch = () => this.instances.get(accountId)?.epoch === epoch;

    try {
      const api: any = await withProxy(proxyUrl, () => zalo.loginQR({}, (event: any) => {
        if (!isCurrentEpoch()) return; // phiên cũ bị thay → bỏ qua mọi event (FIX #6)
        switch (event.type) {
          case 0: // QRCodeGenerated
            logger.info(`[zalo:${accountId}] loginQR — QR code generated, emitting to socket room`);
            this.io?.to(`account:${accountId}`).emit('zalo:qr', { accountId, qrImage: event.data.image });
            break;
          case 1: // QRCodeExpired
            qrExpiredCount++;
            if (qrExpiredCount >= MAX_QR_RETRY) {
              // Hết lượt tự sinh lại → dừng phiên, báo FE cần quét lại thủ công (fresh).
              logger.info(`[zalo:${accountId}] loginQR — QR hết hạn ${qrExpiredCount} lần, DỪNG retry (cần quét lại)`);
              this.io?.to(`account:${accountId}`).emit('zalo:qr-session-dead', { accountId });
              // KHÔNG gọi retry → phiên loginQR này kết thúc. teardown để giải phóng.
              this.teardownExisting(accountId);
              return;
            }
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

      // FIX #6 (2026-06-16, code-review): epoch guard KHÔNG chỉ trong callback mà CẢ sau khi
      // loginQR resolve. Nếu giữa lúc chờ resolve có teardown + tạo instance MỚI (autoReconnect
      // timer, hoặc user bấm "Tạo QR mới" — fix #2 làm việc này phổ biến hơn), epoch đã bị bump
      // → KHÔNG ghi đè instance mới (tránh 2 WS/listener cùng nick → tái phát flap). Đóng api cũ.
      if (this.instances.get(accountId)?.epoch !== epoch) {
        logger.warn(`[zalo:${accountId}] loginQR resolve nhưng epoch đã đổi (${epoch}→${this.instances.get(accountId)?.epoch}) → bỏ qua, đóng api cũ`);
        try { api?.listener?.stop?.(); } catch { /* ignore */ }
        return;
      }

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
          await runSystemQuery(() => prisma.zaloAccount.update({
            where: { id: accountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          }));
        }
      } catch {}

      // Fix ② (Anh chốt 2026-06-11): ghi zaloUid TRƯỚC khi attach listener / emit connected.
      // Nếu nick này (ownId) đã thuộc record khác → updateAccountDB ném DUPLICATE_ZALO_UID;
      // ta báo socket rõ ràng + dọn record qr_pending rác, KHÔNG để treo "đang quét" im lặng.
      try {
        await this.updateAccountDB(accountId, 'connected', ownId, 'qr_scan');
      } catch (err) {
        if ((err as { code?: string })?.code === 'DUPLICATE_ZALO_UID') {
          const dup = await this.findOwnerOfZaloUid(ownId, accountId);
          const ownerName = dup?.ownerName ?? null;
          this.teardownExisting(accountId); // ngắt WS vừa mở của record rác
          this.io?.to(`account:${accountId}`).emit('zalo:duplicate', {
            accountId,
            zaloUid: ownId,
            existingAccountId: dup?.accountId ?? null,
            owner: ownerName,
            message: ownerName
              ? `Nick này đang do ${ownerName} quản lý. Liên hệ chủ tổ chức để chuyển giao.`
              : 'Nick này đã tồn tại trong hệ thống. Dùng "Kết nối lại" trên nick cũ.',
          });
          await this.cleanupGhostAccount(accountId);
          return; // dừng luồng login — không attach listener cho record đã xoá
        }
        throw err;
      }

      this.attachListener(accountId, api);
      void this.emitAccountEventToOrg(accountId, 'zalo:connected', { accountId, zaloUid: ownId });
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
      void this.emitAccountEventToOrg(accountId, 'zalo:error', { accountId, error: String(err) });
      throw err;
    }
  }

  // Reconnect using previously saved session credentials
  async reconnect(accountId: string, credentials: ZaloCredentials, proxyUrl?: string | null): Promise<void> {
    // FIX 2 nick-ghost (Anh chốt 2026-06-13): GUARD eligibility GOM 1 CHỖ. Mọi đường
    // reconnect (boot app.ts, health-check cron, route /reconnect tay, autoReconnect
    // timer) đều đi qua đây → đặt điều kiện "thẻ ma KHÔNG reconnect" tại nguồn duy nhất.
    //   • zaloUid=null  → chưa từng connect thật = thẻ ma (qr_pending/disconnected rỗng).
    //   • archivedAt!=null → nick đã xoá mềm/ẩn.
    // Mở WS cho thẻ ma bằng session cũ → 2 WS cùng tài khoản Zalo → KICKOUT_BY_WORKER
    // loop → "login treo". Chặn TỪ GỐC ở đây thay vì vá từng đường (DRY, không sót).
    const eligibility = await runSystemQuery(() =>
      prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { zaloUid: true, archivedAt: true, disconnectReason: true },
      }),
    );
    if (!eligibility || eligibility.zaloUid === null || eligibility.archivedAt !== null) {
      logger.info(
        `[zalo:${accountId}] reconnect() skip — thẻ ma/đã ẩn (zaloUid=${eligibility?.zaloUid ?? 'missing'}, archived=${eligibility?.archivedAt ? 'yes' : 'no'})`,
      );
      return;
    }
    // 2026-06-16 (Anh chốt: "Ngắt là ngắt thật"): GUARD MANUAL gom CHUNG 1 chỗ ở đây — chặn
    // MỌI đường reconnect tự động/ngầm (boot app.ts, health-check cron×2, autoReconnect timer,
    // route /reconnect, bulk-action, zalo-operations attemptReconnect) làm SỐNG LẠI nick sale
    // đã NGẮT THỦ CÔNG. Muốn dùng lại → sale bấm "Kết nối lại" → quét QR (loginQR, KHÔNG qua
    // hàm này). Bịt 1 chỗ thay vì vá từng đường (tránh sót như boot).
    if (eligibility.disconnectReason === 'manual') {
      logger.info(`[zalo:${accountId}] reconnect() skip — sale đã NGẮT THỦ CÔNG (manual), chỉ QR mới nối lại`);
      return;
    }

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

      // FIX #4b (2026-06-16): VERIFY uid sau reconnect khớp uid CŨ của nick. Session đã lưu
      // thuộc 1 tài khoản Zalo; nếu đăng nhập ra uid KHÁC (cực hiếm — session bị thay/đổi chủ)
      // thì KHÔNG ghi đè danh tính nick (tránh ghi nhầm uid người khác vào row này âm thầm).
      if (eligibility.zaloUid && ownId && ownId !== eligibility.zaloUid) {
        logger.error(`[zalo:${accountId}] reconnect uid LỆCH: session đăng nhập ra ${ownId} ≠ uid cũ ${eligibility.zaloUid} → từ chối ghi đè`);
        this.teardownExisting(accountId);
        if (instance) instance.status = 'disconnected';
        await this.updateAccountDB(accountId, 'qr_pending', null, 'reconnect_failed'); // uid lệch (chi tiết ở log error trên)
        void this.emitAccountEventToOrg(accountId, 'zalo:reconnect-failed', {
          accountId, error: 'Phiên đăng nhập không khớp nick này — cần quét QR lại.',
        });
        this.reconnecting.delete(accountId);
        return;
      }
      instance.zaloUid = ownId;

      // Fetch own profile info for avatar
      try {
        const userInfo = await api.getUserInfo(ownId);
        const profiles = userInfo?.changed_profiles || {};
        const profile = profiles[ownId] || profiles[`${ownId}_0`];
        if (profile?.avatar) {
          await runSystemQuery(() => prisma.zaloAccount.update({
            where: { id: accountId },
            data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
          }));
        }
      } catch {}

      this.attachListener(accountId, api);
      await this.updateAccountDB(accountId, 'connected', ownId, 'reconnect_ok');
      void this.emitAccountEventToOrg(accountId, 'zalo:connected', { accountId, zaloUid: ownId });
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
      void this.emitAccountEventToOrg(accountId, 'zalo:reconnect-failed', { accountId, error: String(err) });
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
        // MẤT KẾT NỐI THỤ ĐỘNG (2026-06-16): nick rớt do Zalo/mạng (KHÔNG phải sale bấm Ngắt).
        // Ghi reason='passive' + mốc rớt để FE đếm "đã mất kết nối X phút Y giây" tăng dần.
        // KHÔNG ghi đè nếu đã 'manual' (sale ngắt thủ công rồi nick mới rớt — giữ nguyên manual).
        void runSystemQuery(() => prisma.zaloAccount.updateMany({
          where: { id, NOT: { disconnectReason: 'manual' } },
          data: { disconnectReason: 'passive', disconnectedAt: new Date() },
        })).catch((err) => logger.warn(`[zalo:${id}] set passive disconnect lỗi:`, err));
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
          void this.emitAccountEventToOrg(id, 'zalo:reconnect-failed', { accountId: id, error: 'Session không ổn định, cần đăng nhập QR lại' });
          this.disconnectHistory.delete(key);
          return; // DON'T reconnect
        }

        // Normal auto-reconnect after 30 seconds.
        // Fix lifecycle 2026-06-10: capture epoch hiện tại — nếu trước khi timer fire user đã
        // quét QR lại (loginQR bump epoch + tạo instance mới), timer này sẽ tự bỏ qua (xem
        // guard epoch trong autoReconnect) thay vì ghi đè instance QR mới.
        setTimeout(() => this.autoReconnect(id, myEpoch), 30_000);
      },
    });

    // Start periodic group message sync backup
    startMessageSync(api, accountId);
  }

  // Persist session credentials to DB
  private saveCredentials(accountId: string, credentials: ZaloCredentials): void {
    // 2026-06-11: system-context — pool ghi nền (không tenant ctx), tránh RLS chặn.
    runSystemQuery(() => prisma.zaloAccount
      .update({ where: { id: accountId }, data: { sessionData: credentials as any } }))
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
      // 2026-06-11 FIX (gốc rễ DB status kẹt 'qr_pending' → offline sai khắp nơi: chat
      // picker, labels, sticker, system-notify...). Hai nguyên nhân:
      //  (a) zaloUid UNIQUE collision (P2002): nick re-QR cùng người → nick CŨ (đã archived)
      //      vẫn giữ zaloUid → set lại trên nick mới ném P2002 → status KHÔNG ghi được.
      //      → giải phóng uid khỏi nick ĐÃ ARCHIVED trước (nick đó đã bị xoá/ẩn, nhả uid OK).
      //  (b) pool chạy NỀN (boot reconnect/cron) không có tenant ctx → bọc runSystemQuery.
      //
      // FIX 0 nick-ghost (Anh chốt 2026-06-13): CHỈ nhả uid khỏi nick ĐÃ ARCHIVED.
      // Trước: updateMany xoá uid khỏi MỌI nick khác (kể cả nick đang SỐNG) → quét QR
      // trúng nick đã login ở record khác sẽ CƯỚP uid của nó (nick cũ mất uid → thành
      // thẻ ma) thay vì báo trùng. Giờ: nếu nick KHÁC đang sống (archivedAt=null) giữ uid
      // → KHÔNG đụng → prisma.update set uid sẽ ném P2002 → loginQR bắt DUPLICATE_ZALO_UID
      // → emit zalo:duplicate (khôi phục báo trùng). Đây là chống một nguồn đẻ thẻ ma.
      const updated = await runSystemQuery(async () => {
        if (zaloUid !== null) {
          await prisma.zaloAccount.updateMany({
            where: { zaloUid, id: { not: accountId }, archivedAt: { not: null } },
            data: { zaloUid: null },
          });
        }
        return prisma.zaloAccount.update({
          where: { id: accountId },
          data: {
            status,
            ...(zaloUid !== null ? { zaloUid } : {}),
            // 2026-06-16: nick connected lại → CLEAR trạng thái mất kết nối (manual/passive)
            // để FE thôi hiện "đã ngắt/đã mất kết nối".
            // T8 (YC2 2026-06-20): + CLEAR archivedAt → nick ĐÃ XÓA login lại (quét QR đúng
            // tài khoản) tự SỐNG DẬY, hội thoại/tin nhắn cũ hiện lại. An toàn vì chỉ clear khi
            // status='connected' (nick THẬT đã login WS thành công, api!=null). Nick-ma không
            // bao giờ tới 'connected' (api=null) nên không bị clear nhầm.
            ...(status === 'connected' ? { lastConnectedAt: new Date(), disconnectReason: null, disconnectedAt: null, archivedAt: null } : {}),
          },
          select: { orgId: true, ownerUserId: true },
        });
      });

      // FIX CORE nick trùng — tầng 2 (Anh chốt 2026-06-12). Khi nick này connect THẬT
      // (có zaloUid), NGẮT mọi GHOST cũ cùng owner còn lửng lơ (qr_pending, chưa UID) để
      // chúng NGỪNG tranh chấp session → hết KICKOUT_BY_WORKER + loop QR. Bắt cả ghost
      // tạo TRƯỚC fix route (vd nick "Thanh Vỹ" baee7ba5). Chỉ ngắt ghost CHƯA connect
      // (zaloUid=null) → KHÔNG đụng nick thật thứ 2 của owner. Xoá session_data để pool
      // ngừng auto-reconnect; KHÔNG xoá record (giữ data bạn bè/hội thoại gắn vào — admin
      // gộp sau). Fire-and-forget, bọc runSystemQuery (chạy nền không tenant ctx).
      if (status === 'connected' && zaloUid !== null) {
        void runSystemQuery(() =>
          prisma.zaloAccount.updateMany({
            where: {
              orgId: updated.orgId,
              ownerUserId: updated.ownerUserId,
              id: { not: accountId },
              zaloUid: null,
              status: 'qr_pending',
              archivedAt: null,
            },
            data: { status: 'disconnected', sessionData: Prisma.JsonNull },
          }),
        ).then((r) => {
          if (r.count > 0) {
            logger.info(`[zalo:${accountId}] ngắt ${r.count} ghost qr_pending cùng owner (chống tranh chấp session nick trùng)`);
            // Ngắt khỏi pool nếu ghost đang chạy listener (đá nhau live). Thu thập id
            // TRƯỚC rồi disconnect (disconnect xoá khỏi this.instances → tránh sửa Map
            // đang lặp).
            const ghostIds = [...this.instances]
              .filter(([id, inst]) => id !== accountId && inst.status === 'qr_pending')
              .map(([id]) => id);
            for (const id of ghostIds) {
              try { this.disconnect(id); } catch { /* best-effort */ }
            }
          }
        }).catch((err) => {
          logger.warn(`[zalo:${accountId}] dọn ghost cùng owner lỗi (bỏ qua): ${String(err)}`);
        });
      }

      // Status log: chỉ ghi khi status thuộc enum ZaloStatus. Skip 'connecting' (intermediate).
      const logStatus = mapToLogStatus(status);
      if (logStatus) {
        const logReason: StatusReason = reason ?? defaultReason(logStatus);
        // Fire-and-forget — không block updateAccountDB nếu status log lỗi.
        void runSystemQuery(() => writeTransition({
          accountId,
          orgId: updated.orgId,
          status: logStatus,
          reason: logReason,
        }));
      }

      // FIX 2026-06-08 (Anh chốt): nick vừa chuyển 'connected' → respawn nick-worker NGAY
      // (không chờ sweeper 30s). Cốt cho trường hợp nick re-login sau restart server: bootstrap
      // đã chạy lúc nick còn disconnected → bỏ sót; hook này bắt ngay khi nick online lại.
      // Import động tránh import vòng zalo-pool ↔ nick-worker. Fire-and-forget, idempotent
      // (startNickWorker skip nếu đã có worker / chỉ spawn nếu nick gắn trigger active).
      if (status === 'connected') {
        void import('../../shared/ee-registry/automation.js')
          .then((m) => m.respawnNickWorkerIfActive(accountId, updated.orgId))
          .catch((err) =>
            logger.warn(`[zalo:${accountId}] respawn nick-worker on connect failed: ${String(err)}`),
          );
      }
    } catch (err) {
      // Fix ② (Anh chốt 2026-06-11): P2002 trên zalo_uid = nick này (zaloUid) ĐÃ tồn tại
      // ở record khác → user quét trùng nick đã có. KHÔNG nuốt im như trước; ném lỗi có
      // cấu trúc để caller (loginQR) báo socket tử tế + dọn record qr_pending rác.
      if ((err as { code?: string })?.code === 'P2002') {
        const target = (err as { meta?: { target?: string[] } })?.meta?.target ?? [];
        const onZaloUid = Array.isArray(target) ? target.some((t) => String(t).includes('zalo_uid')) : true;
        if (onZaloUid) {
          logger.warn(`[zalo:${accountId}] updateAccountDB: zaloUid ${zaloUid} đã tồn tại ở nick khác (P2002)`);
          const dupErr = new Error('zalo_uid_already_exists') as Error & { code: string; zaloUid: string | null };
          dupErr.code = 'DUPLICATE_ZALO_UID';
          dupErr.zaloUid = zaloUid;
          throw dupErr;
        }
      }
      logger.error(`[zalo:${accountId}] updateAccountDB error:`, err);
    }
  }

  /**
   * Tra nick đang SỞ HỮU một zaloUid (để báo "nick đã thuộc ai" khi quét trùng). Fix ②.
   * T9 (YC2 2026-06-20): `includeArchived` — khi true, tìm cả nick ĐÃ XÓA (archived) giữ uid
   * để báo "nick đã xóa của người khác". Mặc định false → giữ nguyên hành vi loginQR (chỉ nick
   * sống). Lưu ý: chống đẻ record mồ côi nằm ở T8 (revive clear archivedAt) + T9b (check-phone
   * cho FE login đúng id cũ), KHÔNG ở đây; updateMany nhả uid (FIX 0) giữ nguyên.
   */
  private async findOwnerOfZaloUid(
    zaloUid: string,
    excludeAccountId: string,
    includeArchived = false,
  ): Promise<{ accountId: string; ownerName: string | null; ownedByMe: false } | null> {
    const rec = await prisma.zaloAccount.findFirst({
      where: { zaloUid, NOT: { id: excludeAccountId }, ...(includeArchived ? {} : { archivedAt: null }) },
      select: { id: true, owner: { select: { fullName: true } } },
    });
    return rec ? { accountId: rec.id, ownerName: rec.owner?.fullName ?? null, ownedByMe: false } : null;
  }

  /**
   * Dọn record qr_pending RÁC vừa tạo khi quét trúng nick trùng (Fix ②). An toàn:
   * chỉ xoá nếu record vẫn qr_pending VÀ chưa có zaloUid (chưa từng connect thành công)
   * VÀ không có dữ liệu thật gắn vào (conversation/message). Tránh xoá nhầm nick thật.
   */
  private async cleanupGhostAccount(accountId: string): Promise<void> {
    try {
      const acc = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { status: true, zaloUid: true, _count: { select: { conversations: true } } },
      });
      if (!acc || acc.zaloUid || acc.status === 'connected' || acc._count.conversations > 0) {
        return; // không phải ghost → giữ lại
      }
      // Xoá access trước (FK) rồi xoá account. Hard delete OK vì đây là record rỗng vừa tạo.
      await prisma.zaloAccountAccess.deleteMany({ where: { zaloAccountId: accountId } });
      await prisma.zaloAccount.delete({ where: { id: accountId } });
      logger.info(`[zalo:${accountId}] dọn record qr_pending rác sau khi quét trùng nick`);
    } catch (err) {
      logger.warn(`[zalo:${accountId}] cleanupGhostAccount lỗi (bỏ qua):`, err);
    }
  }

  // Auto-reconnect using saved session from DB.
  // `expectedEpoch`: epoch của instance lúc lên lịch timer. Nếu instance hiện tại có epoch
  // khác → đã bị thay thế (vd: user quét QR lại) → KHÔNG auto-reconnect đè lên.
  private async autoReconnect(accountId: string, expectedEpoch?: number): Promise<void> {
    const inst = this.instances.get(accountId);
    // Skip if already reconnected or manually disconnected
    if (inst?.status === 'connected') return;
    // Fix lifecycle 2026-06-10: instance đã bị supersede (user re-login QR) → bỏ timer cũ.
    if (expectedEpoch !== undefined && inst && inst.epoch !== expectedEpoch) {
      logger.info(`[zalo:${accountId}] autoReconnect skipped — superseded (epoch ${expectedEpoch} != current ${inst.epoch})`);
      return;
    }
    // qr_pending = đang chờ user quét QR thủ công → không auto-reconnect đè.
    if (inst?.status === 'qr_pending') {
      logger.info(`[zalo:${accountId}] autoReconnect skipped — instance đang qr_pending (chờ quét QR)`);
      return;
    }

    try {
      const account = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { sessionData: true, proxyUrl: true, disconnectReason: true },
      });
      // 2026-06-16: NGẮT THỦ CÔNG (manual) → KHÔNG auto-reconnect (ngắt là ngắt thật).
      if (account?.disconnectReason === 'manual') {
        logger.info(`[zalo:${accountId}] autoReconnect skipped — sale đã NGẮT THỦ CÔNG (manual)`);
        return;
      }
      const session = account?.sessionData as ZaloCredentials | null;
      if (session?.imei) {
        logger.info(`[zalo:${accountId}] Auto-reconnecting...`);
        await this.reconnect(accountId, session, account?.proxyUrl);
      } else {
        logger.warn(`[zalo:${accountId}] No saved session, cannot auto-reconnect`);
        void this.emitAccountEventToOrg(accountId, 'zalo:reconnect-failed', { accountId, error: 'No saved session' });
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

  /**
   * FIX 3 nick-ghost (Anh chốt 2026-06-13): bộ dọn thẻ ma ĐỊNH KỲ.
   *
   * Vì sao cần: lớp dọn tầng-2 (updateAccountDB) chỉ ngắt ghost KHI nick thật connect.
   * Nếu nick thật KHÔNG BAO GIỜ connect ổn định (đúng tình huống login treo), thẻ ma
   * qr_pending nằm lại vĩnh viễn → vẫn hiện ở /contacts, vẫn đẻ Friend. Cron này dọn
   * chủ động, không phụ thuộc nick thật.
   *
   * An toàn:
   *   • CHỈ thẻ ma: zaloUid=null (chưa từng connect thật) + qr_pending/disconnected.
   *   • Quá hạn: createdAt < now()-24h (T4b 2026-06-20: đổi 15ph→24h — nick-ma phải HIỆN
   *     24h ở UI với badge "Đang chờ quét QR" trước khi ẩn; 15ph quá sớm, sale quét QR dở
   *     để lâu sẽ thấy nick-ma biến mất giữa chừng).
   *   • lastConnectedAt=null: chưa từng online → loại nick thật cũ (qua purge nhả uid
   *     nhưng có lastConnectedAt) khỏi tầm xoá. Đây là chốt phân biệt thẻ-ma vs nick-thật-cũ.
   *   • ẨN bằng archivedAt (xoá mềm), KHÔNG hard-delete → giữ lịch sử + Friend/Conversation
   *     (cascade) còn nguyên, admin gộp sau.
   *
   * @returns số thẻ ma đã ẩn (để test + log).
   */
  async cleanupStaleGhosts(staleMinutes = 24 * 60): Promise<number> {
    const cutoff = new Date(Date.now() - staleMinutes * 60_000);
    try {
      return await runSystemQuery(async () => {
        const ghosts = await prisma.zaloAccount.findMany({
          where: {
            zaloUid: null,
            archivedAt: null,
            lastConnectedAt: null,
            status: { in: ['qr_pending', 'disconnected'] },
            createdAt: { lt: cutoff },
          },
          select: { id: true },
        });
        if (ghosts.length === 0) return 0;
        const ids = ghosts.map((g) => g.id);
        // Ngắt khỏi pool nếu đang chạy listener (best-effort, trước khi ẩn).
        for (const id of ids) {
          try { this.disconnect(id); } catch { /* best-effort */ }
        }
        await prisma.zaloAccount.updateMany({
          where: { id: { in: ids } },
          data: { archivedAt: new Date(), status: 'disconnected', sessionData: Prisma.JsonNull },
        });
        logger.info(`[zalo:cleanup] ẩn ${ids.length} thẻ ma qr_pending quá ${Math.round(staleMinutes / 60)}h (chống tái phát nick trùng)`);
        return ids.length;
      });
    } catch (err) {
      logger.warn(`[zalo:cleanup] cleanupStaleGhosts lỗi (bỏ qua): ${String(err)}`);
      return 0;
    }
  }
}

export const zaloPool = new ZaloAccountPool();
