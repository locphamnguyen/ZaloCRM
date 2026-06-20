// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zinstant-proxy-routes.ts — Parse Zalo zinstant bank card → trả structured data.
 *
 * Zalo HTML có VietQR EMVCo string embed (e.g. 00020101021138550010A000000727...).
 * Parse TLV (Tag-Length-Value) format để extract bank BIN + account number.
 * Frontend render UI riêng dùng img.vietqr.io cho QR thật.
 *
 * Security: whitelist hostname Zalo CDN. Public endpoint vì iframe khó pass auth.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { getZaloScope } from '../zalo/zalo-scope.js';
import { authMiddleware } from '../auth/auth-middleware.js';

// Public routes (no auth) — bankcard parser is hit from Zalo iframe context
// where cookies don't reliably forward, and sticker assets are read-only CDN
// proxies. Everything else (user-info endpoints that expose phone/DOB) must
// require a valid JWT — see PII enumeration fix in phase 03 of security plan.
const PUBLIC_PATH_PREFIXES = [
  '/api/v1/zalo-bankcard',
  '/api/v1/zalo-sticker', // covers /zalo-sticker/:catId/:id and /zalo-sticker-list
];

// Hard cap on batch lookup size to slow down enumeration by an authenticated
// attacker. 200 was the legacy value; 50 is enough for typical group views.
const USER_INFO_BATCH_CAP = 50;

// In-memory cache cho sticker metadata — key = `${catId}:${id}`
interface StickerMeta {
  type: number;
  staticUrl: string;
  spriteUrl: string | null;
  totalFrames: number;
  duration: number;
  size: number; // frame size 130x130
}
const stickerMetaCache = new Map<string, { data: StickerMeta; expiresAt: number }>();
const STICKER_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const ALLOWED_HOSTS = new Set([
  'zinst-stc.zadn.vn',
  'zinst-stc-pc.zadn.vn',
]);

// Vietnam bank BIN → metadata. Source: napas.com.vn + img.vietqr.io bank list.
const BANK_BIN_MAP: Record<string, { code: string; shortName: string; fullName: string; color: string }> = {
  '970423': { code: 'TPB', shortName: 'TPBank', fullName: 'Ngân hàng TPBank', color: '#6E1F95' },
  '970407': { code: 'TCB', shortName: 'Techcombank', fullName: 'Ngân hàng Techcombank', color: '#E60012' },
  '970436': { code: 'VCB', shortName: 'Vietcombank', fullName: 'Ngân hàng Vietcombank', color: '#1A8847' },
  '970422': { code: 'MB', shortName: 'MB Bank', fullName: 'Ngân hàng MB', color: '#172A6E' },
  '970418': { code: 'BIDV', shortName: 'BIDV', fullName: 'Ngân hàng BIDV', color: '#016648' },
  '970432': { code: 'VPB', shortName: 'VPBank', fullName: 'Ngân hàng VPBank', color: '#00A14B' },
  '970415': { code: 'ICB', shortName: 'VietinBank', fullName: 'Ngân hàng VietinBank', color: '#005EAB' },
  '970416': { code: 'ACB', shortName: 'ACB', fullName: 'Ngân hàng ACB', color: '#005AAA' },
  '970403': { code: 'STB', shortName: 'Sacombank', fullName: 'Ngân hàng Sacombank', color: '#00A862' },
  '970405': { code: 'AGRIBANK', shortName: 'Agribank', fullName: 'Ngân hàng Agribank', color: '#9E2031' },
  '970448': { code: 'OCB', shortName: 'OCB', fullName: 'Ngân hàng OCB', color: '#003F8C' },
  '970454': { code: 'VCCB', shortName: 'VietCapital', fullName: 'Ngân hàng Bản Việt', color: '#E1251B' },
  '970441': { code: 'VIB', shortName: 'VIB', fullName: 'Ngân hàng VIB', color: '#005BAA' },
  '970443': { code: 'SHB', shortName: 'SHB', fullName: 'Ngân hàng SHB', color: '#005DAA' },
  '970426': { code: 'MSB', shortName: 'MSB', fullName: 'Ngân hàng Hàng Hải', color: '#E20019' },
  '970437': { code: 'HDB', shortName: 'HDBank', fullName: 'Ngân hàng HDBank', color: '#ED1B2F' },
  '970438': { code: 'BAB', shortName: 'BacABank', fullName: 'Ngân hàng Bắc Á', color: '#003B71' },
};

interface BankCardData {
  bankBin: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  qrContent: string;
  color: string;
  logoUrl: string;
  qrImageUrl: string;
}

/**
 * Parse VietQR EMVCo string → bank BIN + account number.
 * Format: 38XX 0010A000000727 01XX 0006<6-digit BIN> 01XX <account-number> 0208...
 */
function parseVietQR(qrString: string): { bankBin: string; accountNumber: string } | null {
  // Tìm field 38 (Merchant Account Info), bên trong có subfield 01 (account)
  // Đơn giản: regex match bank BIN (luôn 6 số sau 0006) + account (sau 01XX)
  const binMatch = qrString.match(/0006(\d{6})/);
  if (!binMatch) return null;
  // Account number: ngay sau bin, format 01<length><account>
  const afterBin = qrString.substring(qrString.indexOf(binMatch[0]) + 10);
  const accMatch = afterBin.match(/^01(\d{2})(\d+)/);
  if (!accMatch) return null;
  const accLen = parseInt(accMatch[1]);
  return {
    bankBin: binMatch[1],
    accountNumber: accMatch[2].substring(0, accLen),
  };
}

export async function zinstantProxyRoutes(app: FastifyInstance): Promise<void> {
  // Auth gate: every route in this plugin requires a valid JWT EXCEPT the
  // explicitly-public bankcard and sticker prefixes. Previously every
  // endpoint was unauthenticated, letting anyone enumerate Zalo user PII
  // (phone, DOB) through /zalo-user-info/* via the host org's accounts.
  app.addHook('preHandler', async (request, reply) => {
    if (PUBLIC_PATH_PREFIXES.some((p) => request.url.startsWith(p))) return;
    await authMiddleware(request, reply);
  });

  // GET /api/v1/zalo-bankcard?url=<encoded zalo cdn url> → structured JSON
  // Public endpoint — chỉ parse public Zalo CDN content, không lộ data CRM
  app.get('/api/v1/zalo-bankcard', async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.query as { url?: string };
    if (!url) return reply.status(400).send({ error: 'url query required' });

    let parsed: URL;
    try { parsed = new URL(url); } catch { return reply.status(400).send({ error: 'invalid url' }); }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return reply.status(403).send({ error: 'host not allowed' });
    }

    try {
      const res = await fetch(parsed.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZaloCRM/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return reply.status(res.status).send({ error: 'upstream error' });
      const body = await res.text();

      // Extract VietQR EMVCo string từ HTML (trong action=transfer&content=...)
      // EMVCo strings bắt đầu bằng 00020101 (Payload Format + Static QR)
      const qrMatch = body.match(/content=(00020101[^&"']+)/);
      if (!qrMatch) {
        logger.info('[bankcard] No VietQR string in HTML — render fallback');
        return reply.send({ raw: true, message: 'Không phân tích được mã QR' });
      }

      const qrContent = decodeURIComponent(qrMatch[1]).replace(/&amp;/g, '&');
      const parsedQr = parseVietQR(qrContent);
      if (!parsedQr) {
        return reply.send({ raw: true, message: 'Không parse được VietQR EMVCo' });
      }

      const meta = BANK_BIN_MAP[parsedQr.bankBin];
      const data: BankCardData = {
        bankBin: parsedQr.bankBin,
        bankCode: meta?.code || 'UNKNOWN',
        bankName: meta?.fullName || `Ngân hàng (BIN ${parsedQr.bankBin})`,
        accountNumber: parsedQr.accountNumber,
        qrContent,
        color: meta?.color || '#1976d2',
        logoUrl: meta ? `https://api.vietqr.io/img/${meta.code}.png` : '',
        // img.vietqr.io tạo QR image động — không cần lưu, không cần key
        qrImageUrl: meta
          ? `https://img.vietqr.io/image/${meta.code}-${parsedQr.accountNumber}-compact.png`
          : '',
      };

      reply
        .header('Cache-Control', 'public, max-age=3600')
        .send(data);
    } catch (err) {
      logger.warn('[bankcard-proxy] fetch error:', err);
      return reply.status(502).send({ error: 'upstream fetch failed' });
    }
  });

  // ── GET /api/v1/zalo-sticker/:catId/:id — redirect tới sticker URL thật
  // Dùng zca-js getStickerCategoryDetail (cần auth Zalo session) để lookup URL.
  // Public endpoint vì <img src> không pass JWT header.
  app.get('/api/v1/zalo-sticker/:catId/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { catId, id } = request.params as { catId: string; id: string };
    if (!catId || !id) return reply.status(400).send({ error: 'catId and id required' });

    const cacheKey = `${catId}:${id}`;
    const wantImage = (request.query as { img?: string }).img === '1';
    const cached = stickerMetaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (wantImage) {
        return reply.header('Cache-Control', 'public, max-age=86400').redirect(cached.data.staticUrl);
      }
      return reply.header('Cache-Control', 'public, max-age=86400').send(cached.data);
    }

    // Public endpoint cho <img src> — JWT không pass qua img tag.
    // Tự verify nếu có header (route được gọi từ axios api.get); nếu không có → fallback
    // dùng any connected account trong org bất kỳ (sticker URL public của Zalo CDN).
    let user: { id: string; orgId: string; role: string } | null = null;
    try {
      await request.jwtVerify();
      user = request.user as any;
    } catch { /* no JWT — fallback */ }

    // 2026-06-11 FIX (sticker hỏng/vỡ): chọn account theo trạng thái SỐNG của pool, KHÔNG
    // theo DB status — DB hay kẹt 'qr_pending' sau re-QR dù pool đang connected → trước đây
    // where:{status:'connected'} không khớp account nào → 503 → <img> sticker vỡ. Pool mới
    // là nguồn thật để gọi getStickersDetail.
    const liveConnectedIds = Object.entries(zaloPool.getAllStatuses())
      .filter(([, s]) => s === 'connected')
      .map(([accId]) => accId);
    let account: { id: string } | null = null;
    if (liveConnectedIds.length) {
      if (user?.id && user.orgId) {
        const scope = await getZaloScope(user.id, user.orgId, user.role);
        const allowed = scope.isOrgAdmin
          ? liveConnectedIds
          : liveConnectedIds.filter((accId) => scope.accessibleIds.includes(accId));
        account = await prisma.zaloAccount.findFirst({
          where: { orgId: user.orgId, id: { in: allowed } },
          select: { id: true },
        });
      } else {
        // No-auth path (img tag): bất kỳ nick nào pool đang connected.
        account = await prisma.zaloAccount.findFirst({
          where: { id: { in: liveConnectedIds } },
          select: { id: true },
          orderBy: { lastConnectedAt: 'desc' },
        });
      }
    }
    if (!account) return reply.status(503).send({ error: 'no connected Zalo account' });

    const instance = zaloPool.getInstance(account.id);
    const api = instance?.api as { getStickersDetail?: (ids: number[]) => Promise<unknown[]> } | undefined;
    if (!api?.getStickersDetail) {
      logger.warn(`[sticker] getStickersDetail not available on account ${account.id}`);
      return reply.status(503).send({ error: 'Zalo API not available' });
    }

    try {
      // getStickersDetail trả: {stickerUrl (static), stickerSpriteUrl (animation sprite),
      // totalFrames, duration, type}. Type=7 thường có sprite cho animation.
      const details = await api.getStickersDetail([Number(id)]);
      const sticker = (details?.[0] || {}) as Record<string, unknown>;

      if ((request.query as { debug?: string }).debug === '1') {
        return reply.send(sticker);
      }

      const staticUrl = String(sticker.stickerUrl || '');
      const spriteUrl = sticker.stickerSpriteUrl ? String(sticker.stickerSpriteUrl) : null;

      if (!staticUrl) {
        return reply.status(404).send({ error: 'sticker URL not found' });
      }

      const meta: StickerMeta = {
        type: Number(sticker.type || 0),
        staticUrl,
        spriteUrl,
        totalFrames: Number(sticker.totalFrames || 1),
        duration: Number(sticker.duration || 0), // ms per frame
        size: 130, // Zalo default frame size
      };

      stickerMetaCache.set(cacheKey, { data: meta, expiresAt: Date.now() + STICKER_CACHE_TTL_MS });
      if (wantImage) {
        return reply.header('Cache-Control', 'public, max-age=86400').redirect(staticUrl);
      }
      return reply.header('Cache-Control', 'public, max-age=86400').send(meta);
    } catch (err) {
      logger.warn('[sticker] fetch error:', err);
      return reply.status(502).send({ error: 'upstream Zalo API failed' });
    }
  });

  // ── GET /api/v1/zalo-sticker-list — fetch popular categories cho picker
  // Trả category list để frontend hiển thị sticker picker
  app.get('/api/v1/zalo-sticker-list', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { keyword } = request.query as { keyword?: string };

    // Phase Zalo Account Mutation Gate 2026-05-27: scope org + accessible
    const user = request.user!;
    const scope = await getZaloScope(user.id, user.orgId, user.role);
    const account = await prisma.zaloAccount.findFirst({
      where: {
        orgId: user.orgId,
        status: 'connected',
        ...(scope.isOrgAdmin ? {} : { id: { in: scope.accessibleIds } }),
      },
      select: { id: true, displayName: true },
    });
    if (!account) {
      logger.warn(`[sticker-list] no connected account — user=${user.id} role=${user.role} isOrgAdmin=${scope.isOrgAdmin} accessibleIds=${scope.accessibleIds.length}`);
      return reply.status(503).send({ error: 'no connected Zalo account' });
    }

    const instance = zaloPool.getInstance(account.id);
    const stickerApi = instance?.api as {
      getStickers?: (k: string) => Promise<number[]>;
      getStickersDetail?: (ids: number[]) => Promise<unknown[]>;
    } | undefined;

    if (!instance) {
      logger.warn(`[sticker-list] instance null in pool — account=${account.id} (${account.displayName}). Pool not loaded?`);
      return reply.status(503).send({ error: 'Zalo instance not ready — vào "Quản lý nick" reconnect rồi thử lại' });
    }
    if (!stickerApi?.getStickers || !stickerApi.getStickersDetail) {
      logger.warn(`[sticker-list] SDK methods missing — account=${account.id} hasGetStickers=${!!stickerApi?.getStickers} hasGetStickersDetail=${!!stickerApi?.getStickersDetail}`);
      return reply.status(503).send({ error: 'Zalo sticker API not available (SDK version mismatch?)' });
    }

    try {
      const kw = keyword || 'vui';
      logger.info(`[sticker-list] fetching kw="${kw}" via account=${account.id} (${account.displayName})`);
      const ids = await stickerApi.getStickers(kw);
      logger.info(`[sticker-list] getStickers("${kw}") returned ${ids?.length ?? 0} ids: ${JSON.stringify(ids?.slice(0, 5))}...`);
      if (!ids || ids.length === 0) {
        // KHÔNG cache empty response — tránh stuck UI 10 phút
        return reply.header('Cache-Control', 'no-store').send({ stickers: [], debug: { keyword: kw, accountUsed: account.displayName, idsReturned: 0 } });
      }

      const details = await stickerApi.getStickersDetail(ids.slice(0, 40));
      logger.info(`[sticker-list] getStickersDetail returned ${details?.length ?? 0} details`);
      const stickers = details.map((d) => {
        const s = d as Record<string, unknown>;
        return {
          id: Number(s.id),
          catId: Number(s.cateId),
          type: Number(s.type || 0),
          staticUrl: String(s.stickerUrl || ''),
          spriteUrl: s.stickerSpriteUrl ? String(s.stickerSpriteUrl) : null,
          totalFrames: Number(s.totalFrames || 1),
          duration: Number(s.duration || 0),
        };
      });
      // Chỉ cache khi có data
      return reply.header('Cache-Control', stickers.length > 0 ? 'private, max-age=600' : 'no-store').send({ stickers });
    } catch (err: any) {
      logger.warn(`[sticker-list] fetch error: ${err?.message || err} stack=${err?.stack?.slice(0, 300)}`);
      return reply.status(502).send({ error: 'upstream Zalo API failed', detail: err?.message });
    }
  });

  // ── GET /api/v1/zalo-user-info/:uid — lookup Zalo user info bằng UID
  // Dùng cho: avatar member group + popup info user khi click tên/mention
  // Cache 10 phút theo UID
  const userInfoCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  const USER_INFO_TTL_MS = 10 * 60 * 1000;

  function normalizeProfile(uid: string, profile: Record<string, unknown>) {
    const bizPkgRaw = profile.bizPkg as Record<string, unknown> | null | undefined;
    return {
      uid: String(uid),
      userId: String(profile.userId || uid),
      username: String(profile.username || ''),
      globalId: String(profile.globalId || ''),
      zaloName: String(profile.zaloName || profile.zalo_name || ''),
      displayName: String(profile.displayName || profile.display_name || profile.zaloName || ''),
      avatar: String(profile.avatar || ''),
      avatarBig: String(profile.avatarBig || profile.avatar || ''),
      bgavatar: String(profile.bgavatar || ''),
      coverPhoto: String(profile.cover || profile.coverPhoto || ''),
      gender: Number(profile.gender ?? -1),
      dob: profile.dob || null,
      sdob: profile.sdob || null,
      phoneNumber: String(profile.phoneNumber || ''),
      status: String(profile.status || ''),
      isFr: Number(profile.isFr ?? 0),
      isBlocked: Number(profile.isBlocked ?? 0),
      isActive: Number(profile.isActive ?? 0),
      isActivePC: Number(profile.isActivePC ?? 0),
      isActiveWeb: Number(profile.isActiveWeb ?? 0),
      isValid: Number(profile.isValid ?? 0),
      lastActionTime: Number(profile.lastActionTime ?? 0),
      lastUpdateTime: Number(profile.lastUpdateTime ?? 0),
      type: Number(profile.type ?? 0),
      accountStatus: Number(profile.accountStatus ?? 0),
      userMode: Number(profile.user_mode ?? profile.userMode ?? 0),
      bizPkg: bizPkgRaw ? {
        label: bizPkgRaw.label ?? null,
        pkgId: Number(bizPkgRaw.pkgId ?? 0),
        createdTs: Number(bizPkgRaw.createdTs ?? 0),
      } : null,
      isExtensionAccount: Number(profile.isExtensionAccount ?? 0),
      oaInfo: profile.oaInfo ?? null,
      oaStatus: profile.oa_status ?? profile.oaStatus ?? null,
    };
  }

  async function resolveProfile(uid: string, accountIds: string[]): Promise<Record<string, unknown> | null> {
    for (const accId of accountIds) {
      const instance = zaloPool.getInstance(accId);
      const userApi = instance?.api as {
        getUserInfo?: (uid: string) => Promise<{ changed_profiles?: Record<string, Record<string, unknown>> }>;
      } | undefined;
      if (!userApi?.getUserInfo) continue;
      try {
        const result = await userApi.getUserInfo(uid);
        const profiles = result?.changed_profiles || {};
        const p = profiles[uid] || profiles[`${uid}_0`];
        if (p && (p.zaloName || p.zalo_name || p.displayName || p.avatar)) {
          return normalizeProfile(uid, p);
        }
      } catch (err) {
        // Miss bình thường khi nick không sở hữu UID (per-nick UID) → debug, không warn.
        logger.debug(`[user-info] account ${accId} miss for ${uid}:`, err);
      }
    }
    return null;
  }

  // ── POST /api/v1/zalo-user-info/batch — bulk lookup tránh N+1 HTTP request từ FE
  // Body: { uids: string[] } → trả { users: { [uid]: profile|null } }
  // Hit cache trước, miss thì fetch song song qua tất cả connected accounts.
  // ── Fix 2026-06-03 (Anh báo: nhóm chat "máy chủ đang lỗi", click user không load) ──
  // Route đọc request.user!.id NHƯNG thiếu preHandler authMiddleware → request.user=null
  // → TypeError 500 silent → FE toast "Máy chủ lỗi". Pattern bẫy đã ghi memory
  // reference_zalocrm_auth_missing_trap.md.
  app.post('/api/v1/zalo-user-info/batch', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { uids, accountId } = (request.body || {}) as { uids?: string[]; accountId?: string };
    if (!Array.isArray(uids) || uids.length === 0) return { users: {} };

    const uniqueUids = Array.from(new Set(uids.filter(u => typeof u === 'string' && u.length > 0))).slice(0, USER_INFO_BATCH_CAP);
    const users: Record<string, Record<string, unknown> | null> = {};
    const misses: string[] = [];

    for (const uid of uniqueUids) {
      const cached = userInfoCache.get(uid);
      if (cached && cached.expiresAt > Date.now()) {
        users[uid] = cached.data;
      } else {
        misses.push(uid);
      }
    }

    if (misses.length === 0) return { users };

    // Phase Zalo Account Mutation Gate 2026-05-27: scope org + accessible
    const userForScope = request.user!;
    const scope = await getZaloScope(userForScope.id, userForScope.orgId, userForScope.role);

    // PERF 2026-06-11 (anh báo lag VPS): UID là PER-NICK. Trước đây mỗi uid loop TẤT CẢ
    // nick → nhóm 20 người × 50 nick = 1000 lượt Zalo SDK/lần mở nhóm (gây lag + spam
    // 1000 log). Nếu FE truyền accountId (nick của hội thoại) → CHỈ gọi đúng nick đó.
    // Fallback thử-tất-cả khi không có accountId (giữ tương thích).
    let accountIds: string[];
    if (accountId && (scope.isOrgAdmin || scope.accessibleIds.includes(accountId))) {
      accountIds = [accountId];
    } else {
      const accounts = await prisma.zaloAccount.findMany({
        where: {
          orgId: userForScope.orgId,
          status: 'connected',
          ...(scope.isOrgAdmin ? {} : { id: { in: scope.accessibleIds } }),
        },
        select: { id: true },
      });
      if (accounts.length === 0) {
        misses.forEach(uid => { users[uid] = null; });
        return { users };
      }
      accountIds = accounts.map(a => a.id);
    }

    await Promise.all(misses.map(async (uid) => {
      const data = await resolveProfile(uid, accountIds);
      if (data) {
        userInfoCache.set(uid, { data, expiresAt: Date.now() + USER_INFO_TTL_MS });
        users[uid] = data;
      } else {
        users[uid] = null;
      }
    }));

    return reply.header('Cache-Control', 'private, max-age=60').send({ users });
  });

  // Fix 2026-06-03: cùng bug như batch — thêm preHandler authMiddleware
  // ── Fix 2026-06-03 (Anh báo): thêm ?force=1 để bypass cache → load SDK
  //    profile mới nhất, đồng bộ Contact.gender + avatarUrl ngay khi sale
  //    mở dialog user info ở /chat. Anh chốt: mỗi lần open dialog → refresh
  //    background → update Contact nếu khác.
  app.get('/api/v1/zalo-user-info/:uid', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { uid } = request.params as { uid: string };
    const { force, accountId } = request.query as { force?: string; accountId?: string };
    const bypassCache = force === '1' || force === 'true';
    if (!uid) return reply.status(400).send({ error: 'uid required' });

    const cached = userInfoCache.get(uid);
    if (!bypassCache && cached && cached.expiresAt > Date.now()) {
      return reply.header('Cache-Control', 'private, max-age=600').send(cached.data);
    }

    // Phase Zalo Account Mutation Gate 2026-05-27: scope org + accessible (cross-tenant fix)
    const userForScope = request.user!;
    const scopeForLookup = await getZaloScope(userForScope.id, userForScope.orgId, userForScope.role);

    // PERF 2026-06-11 (anh báo lag VPS 30-50 nick): UID là PER-NICK (mỗi nick có UID
    // khác nhau cho cùng người — xem reference_zalo_per_account_uid). Trước đây thử
    // TẤT CẢ nick connected của org → product 50 nick = 50 lượt gọi Zalo SDK (49 lỗi
    // "Tham số không hợp lệ") ~538ms mỗi lần mở dialog + đốt quota Zalo. Nếu FE truyền
    // accountId (nick của hội thoại đang mở) → CHỈ gọi đúng nick đó (~30ms). Fallback
    // thử-tất-cả chỉ khi KHÔNG có accountId (giữ tương thích các chỗ gọi khác).
    let accounts: Array<{ id: string }>;
    if (accountId) {
      // Chỉ gọi đúng nick — verify nick thuộc scope (chống cross-tenant + nick ngoài quyền).
      const allowed = scopeForLookup.isOrgAdmin || scopeForLookup.accessibleIds.includes(accountId);
      accounts = allowed ? [{ id: accountId }] : [];
    } else {
      accounts = await prisma.zaloAccount.findMany({
        where: {
          orgId: userForScope.orgId,
          status: 'connected',
          ...(scopeForLookup.isOrgAdmin ? {} : { id: { in: scopeForLookup.accessibleIds } }),
        },
        select: { id: true },
      });
    }
    if (accounts.length === 0) return reply.status(503).send({ error: 'no connected Zalo account' });

    let profile: Record<string, unknown> | null = null;
    for (const acc of accounts) {
      const instance = zaloPool.getInstance(acc.id);
      const userApi = instance?.api as {
        getUserInfo?: (uid: string) => Promise<{ changed_profiles?: Record<string, Record<string, unknown>> }>;
      } | undefined;
      if (!userApi?.getUserInfo) continue;
      try {
        const result = await userApi.getUserInfo(uid);
        const profiles = result?.changed_profiles || {};
        const p = profiles[uid] || profiles[`${uid}_0`];
        // Chấp nhận khi profile có ít nhất zaloName hoặc avatar (không rỗng)
        if (p && (p.zaloName || p.zalo_name || p.displayName || p.avatar)) {
          profile = p;
          break;
        }
      } catch (err) {
        // Miss là BÌNH THƯỜNG khi thử nick không sở hữu UID này (per-nick UID) → debug,
        // không warn (trước đây spam 1000+ dòng/phút khi product nhiều nick).
        logger.debug(`[user-info] account ${acc.id} miss for ${uid}:`, err);
      }
    }

    if (!profile) return reply.status(404).send({ error: 'user not found in any account' });

    try {

      // Normalize fields — full Zalo getUserInfo response shape
      const bizPkgRaw = profile.bizPkg as Record<string, unknown> | null | undefined;
      const data = {
        uid: String(uid),
        userId: String(profile.userId || uid),
        username: String(profile.username || ''), // Zalo handle (t_xxx)
        globalId: String(profile.globalId || ''),
        zaloName: String(profile.zaloName || profile.zalo_name || ''),
        displayName: String(profile.displayName || profile.display_name || profile.zaloName || ''),
        avatar: String(profile.avatar || ''),
        avatarBig: String(profile.avatarBig || profile.avatar || ''),
        bgavatar: String(profile.bgavatar || ''),
        coverPhoto: String(profile.cover || profile.coverPhoto || ''),
        gender: Number(profile.gender ?? -1), // 0=Nam, 1=Nữ
        dob: profile.dob || null,
        sdob: profile.sdob || null,
        phoneNumber: String(profile.phoneNumber || ''),
        status: String(profile.status || ''), // Bio/status text user tự đặt
        // Trạng thái KB + active state
        isFr: Number(profile.isFr ?? 0),
        isBlocked: Number(profile.isBlocked ?? 0),
        isActive: Number(profile.isActive ?? 0),
        isActivePC: Number(profile.isActivePC ?? 0),
        isActiveWeb: Number(profile.isActiveWeb ?? 0),
        isValid: Number(profile.isValid ?? 0),
        // Thời gian (epoch ms)
        lastActionTime: Number(profile.lastActionTime ?? 0),
        lastUpdateTime: Number(profile.lastUpdateTime ?? 0),
        // Account meta
        type: Number(profile.type ?? 0),
        accountStatus: Number(profile.accountStatus ?? 0),
        userMode: Number(profile.user_mode ?? profile.userMode ?? 0),
        // Biz/OA info
        bizPkg: bizPkgRaw ? {
          label: bizPkgRaw.label ?? null,
          pkgId: Number(bizPkgRaw.pkgId ?? 0),
          createdTs: Number(bizPkgRaw.createdTs ?? 0),
        } : null,
        isExtensionAccount: Number(profile.isExtensionAccount ?? 0),
        oaInfo: profile.oaInfo ?? null,
        oaStatus: profile.oa_status ?? profile.oaStatus ?? null,
      };
      userInfoCache.set(uid, { data, expiresAt: Date.now() + USER_INFO_TTL_MS });

      // ── Fix 2026-06-03 (Anh báo): update Contact gender + avatar nếu khác ──
      // SDK trả gender: 0=male, 1=female, -1=unknown. Map sang enum Contact.gender.
      // Update Contact theo zaloUid nếu data SDK mới hơn data DB (gender hoặc avatar khác).
      // Fire-and-forget, không block response.
      void (async () => {
        try {
          const genderMap: Record<number, 'male' | 'female' | null> = {
            0: 'male',
            1: 'female',
          };
          const sdkGender = genderMap[data.gender] ?? null;
          const sdkAvatar = data.avatarBig || data.avatar || null;
          const sdkZaloName = data.zaloName || null;

          // FIX #1 (2026-06-18, anh báo gender bị ép sai): tra contact theo zaloGlobalId
          // (ID canonical XUYÊN NICK) thay vì zaloUid=uid (per-nick → click qua nick khác là
          // TRẬT, fix không vào đúng KH → F5 lại về giá trị cũ). Fallback zaloUid khi thiếu globalId.
          const gid = data.globalId && data.globalId !== 'undefined' ? data.globalId : null;
          const contact = await prisma.contact.findFirst({
            where: gid
              ? { orgId: userForScope.orgId, zaloGlobalId: gid }
              : { orgId: userForScope.orgId, zaloUid: uid },
            // FIX 2026-06-03: Contact dùng `zaloUsername` (zalo_username), KHÔNG có
            // cột `zaloName` → typecheck fail + cập nhật tên Zalo từ SDK âm thầm hỏng.
            select: { id: true, gender: true, genderLocked: true, avatarUrl: true, zaloUsername: true },
          });
          if (!contact) return;

          const updateData: Record<string, unknown> = {};
          // FIX #2 (2026-06-18): KHÔNG đè gender nếu đã KHOÁ (sale chỉnh tay) → chống ghi đè ngược.
          if (sdkGender && !contact.genderLocked && contact.gender !== sdkGender) updateData.gender = sdkGender;
          if (sdkAvatar && contact.avatarUrl !== sdkAvatar) updateData.avatarUrl = sdkAvatar;
          if (sdkZaloName && contact.zaloUsername !== sdkZaloName) updateData.zaloUsername = sdkZaloName;

          if (Object.keys(updateData).length > 0) {
            await prisma.contact.update({
              where: { id: contact.id },
              data: updateData,
            });
            logger.info(`[user-info] refresh updated Contact ${contact.id} fields: ${Object.keys(updateData).join(',')}`);
          }

          // Fix 2026-06-16 (anh báo avatar/tên KH lệch SDK): persist luôn Friend per-nick
          // (zaloAvatarUrl/zaloDisplayName). Header chat đọc fallback từ field này, và sau
          // reload list lấy lại từ DB → trước đây chỉ update Contact nên vẫn lệch. Chỉ
          // update khi có accountId (nick đang xem, đã verify scope ở trên) để target đúng
          // cặp nick × UID per-nick (zaloUidInNick = uid).
          if (accountId && (sdkAvatar || sdkZaloName)) {
            const friendPatch: Record<string, unknown> = {};
            if (sdkAvatar) friendPatch.zaloAvatarUrl = sdkAvatar;
            if (sdkZaloName) friendPatch.zaloDisplayName = sdkZaloName;
            const fr = await prisma.friend.updateMany({
              where: { zaloAccountId: accountId, zaloUidInNick: uid },
              data: friendPatch,
            });
            if (fr.count > 0) {
              logger.info(`[user-info] refresh updated Friend (nick ${accountId} uid ${uid}) fields: ${Object.keys(friendPatch).join(',')}`);
            }
          }
        } catch (updateErr) {
          logger.warn(`[user-info] Contact refresh update failed for ${uid}:`, updateErr);
        }
      })();

      return reply.header('Cache-Control', 'private, max-age=600').send(data);
    } catch (err) {
      logger.warn(`[user-info] fetch error for ${uid}:`, err);
      return reply.status(502).send({ error: 'upstream Zalo API failed' });
    }
  });
}
