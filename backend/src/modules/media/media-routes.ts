/**
 * media-routes.ts — Phase Media Library 2026-06-11 (GĐ1).
 *
 * Kho phương tiện: list / upload / "Lưu từ chat" / chèn vào chat.
 * RBAC (checklist điều 2-3): authMiddleware toàn route + requireGrant('media', …).
 * Scope owner (checklist điều 1): sale chỉ thấy asset của mình (ownerUserId) HOẶC
 *   asset Công khai (visibility='public'); media.view_all bypass scope (admin/marketing).
 * Privacy (checklist điều 4): "Lưu từ chat" của nick Riêng tư (privacyMode='main')
 *   → asset mặc định private + ghi sourceZaloAccountId; chỉ chính chủ nick lưu được.
 * UID per-cặp-nick (checklist điều 7): chèn vào chat gửi theo conversation.externalThreadId.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { registerAsset, bumpUsage, resolveSavedVisibility, generateWatermarkVariant, disableWatermark, logMediaUsage, normalizeTags, type MediaKind } from './media-service.js';
import { downloadMediaToTemp } from '../chat/chat-media-helpers.js';
import { createMediaMessage, getUserFullName } from '../chat/chat-helpers.js';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { generateThumbnail, sendNativeVideo } from '../../shared/video-processor.js';
import { uploadBuffer, getObjectBuffer, keyFromPublicUrl } from '../../shared/storage/minio-client.js';
import { scanOrPass } from '../../shared/security/clamav-client.js';
import { readFile } from 'node:fs/promises';
import { logger } from '../../shared/utils/logger.js';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
// File types: tái dùng list của chat-attachment (KHÔNG mở rộng tùy tiện — checklist reuse).
const ALLOWED_FILE = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/zip', 'application/x-zip-compressed',
];
// Giới hạn (design review E5): ảnh >15MB báo quá lớn.
const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 500 * 1024 * 1024;
const FILE_MAX = 1024 * 1024 * 1024;

// GĐ13a Thùng rác Media (2026-06-12): giữ trong thùng rác 30 ngày rồi cron tự dọn (xóa hàng DB,
// KHÔNG đụng byte MinIO). TRASH_EMPTY_BATCH: dọn-sạch-thủ-công xóa tối đa N/lần tránh khóa DB lâu.
export const TRASH_RETENTION_DAYS = 30;
const TRASH_EMPTY_BATCH = 500;

function classify(mime: string): MediaKind | null {
  if (ALLOWED_IMAGE.includes(mime)) return 'image';
  if (ALLOWED_VIDEO.includes(mime)) return 'video';
  if (ALLOWED_FILE.includes(mime)) return 'file';
  return null;
}

// Nhận diện loại media THẬT theo ĐUÔI file (anh chốt 2026-06-12). Zalo nhiều khi gửi
// video/ảnh dưới dạng ĐÍNH KÈM FILE (contentType='file') → mặc định lưu thành kind='file'
// → video lọt tab Tệp, gửi đi mất player. Đuôi cho biết thật sự là gì → nâng cấp kind.
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic']);
function kindFromExt(ext: string): MediaKind | null {
  const e = ext.replace(/^\./, '').toLowerCase();
  if (VIDEO_EXTS.has(e)) return 'video';
  if (IMAGE_EXTS.has(e)) return 'image';
  return null;
}

// mime → đuôi (chỉ các loại tệp được phép). Dùng để vá file cũ lưu trước khi có tên thật
// (mime octet-stream) hoặc tên không có đuôi → suy đuôi để Zalo bên nhận mở được.
const MIME_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};

/**
 * Tên file (kèm ĐUÔI) để gửi cho khách. zca-js lấy tên + đuôi mà khách NHÌN THẤY từ
 * basename của đường dẫn temp (path.basename + path.extname). Thiếu đuôi → Zalo hiển thị
 * "file lỗi/không mở được". Ưu tiên: original_filename → name. Nếu vẫn thiếu đuôi → suy
 * đuôi từ url-basename rồi từ mime. File cũ ("Lưu từ chat", mime octet-stream) → .bin
 * cuối cùng để ít nhất có đuôi (khách đổi tên mở được) thay vì file lỗi hoàn toàn.
 */
export function buildSendFileName(
  asset: { name: string; originalFilename?: string | null },
  blob: { mimeType: string; publicUrl: string },
): string {
  const base = (asset.originalFilename || asset.name || 'tep').replace(/[\\/]+/g, '_').trim();
  const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(base);
  if (hasExt) return base;
  // suy đuôi từ url-basename (vd .../<hash>.pdf)
  let ext = '';
  try {
    const urlName = decodeURIComponent(new URL(blob.publicUrl).pathname.split('/').pop() || '');
    const m = urlName.match(/\.[A-Za-z0-9]{2,5}$/);
    if (m) ext = m[0];
  } catch { /* ignore */ }
  if (!ext) ext = MIME_EXT[blob.mimeType] || '.bin';
  return base + ext;
}

/**
 * Kết quả lưu 1 tin nhắn vào kho (dùng chung cho single + batch/album).
 * status: 'ok' | 'skipped' (tin không có media) | 'blocked' (nick Riêng tư không phải chủ) | 'error'.
 */
interface SaveOneResult {
  messageId: string;
  status: 'ok' | 'skipped' | 'blocked' | 'error';
  asset?: { id: string; name: string };
  deduped?: boolean;
  reason?: string;
}

/**
 * Lưu 1 tin nhắn (ảnh/file) vào kho — DRY helper cho /save-from-chat (1 tin) và
 * /save-from-chat-batch (cả album / chọn nhiều). KHÔNG throw: trả status để batch
 * tổng hợp (1 ảnh lỗi không làm hỏng cả album). Giữ nguyên privacy guard D11 + audit.
 */
async function saveOneMessageToMedia(args: {
  orgId: string;
  userId: string;
  messageId: string;
  visibility?: 'private' | 'public';
}): Promise<SaveOneResult> {
  const { orgId, userId, messageId } = args;
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversation: { orgId } },
    include: { conversation: { include: { zaloAccount: true } } },
  });
  if (!message) return { messageId, status: 'error', reason: 'Không tìm thấy tin nhắn' };

  const nick = message.conversation.zaloAccount;
  const isPrivateNick = nick.privacyMode === 'main';
  const vis = resolveSavedVisibility({
    nickPrivacyMode: nick.privacyMode,
    nickOwnerUserId: nick.ownerUserId,
    viewerUserId: userId,
    requested: args.visibility,
  });
  if (vis.blocked) {
    return { messageId, status: 'blocked', reason: 'Tin từ nick Riêng tư — chỉ chính chủ nick mới lưu được.' };
  }

  let parsed: any = {};
  try { parsed = JSON.parse(message.content || '{}'); } catch { /* not json */ }
  const url: string | undefined = parsed.href || parsed.hdUrl || parsed.normalUrl || parsed.url || parsed.fileUrl;
  if (!url) return { messageId, status: 'skipped', reason: 'Tin này không có media để lưu' };

  const ct = message.contentType;
  let kind: MediaKind = ct === 'image' ? 'image' : ct === 'video' ? 'video' : 'file';

  // FIX 2026-06-12 (anh báo: tệp toàn "Lưu từ chat" → sale không phân biệt được).
  // Zalo lưu TÊN FILE THẬT (kèm đuôi) ở content.title, KHÔNG phải content.name. Đọc theo thứ
  // tự title → fileName → name → fileUrl-basename. Ảnh thì không có title → giữ "Lưu từ chat".
  const urlBase = (() => { try { return decodeURIComponent(String(url).split('/').pop() || ''); } catch { return ''; } })();
  // FIX 2026-06-12 (anh báo file .doc/.xlsx lỗi): Zalo còn để ĐUÔI CHUẨN ở
  // content.params.fileExt ("doc"/"xlsx"...). params là STRING json lồng → parse lần 2.
  // Đây là nguồn đuôi đáng tin nhất; dùng để VÁ đuôi khi title thiếu đuôi.
  const fileExt: string = (() => {
    try {
      const p = typeof parsed.params === 'string' ? JSON.parse(parsed.params) : parsed.params;
      const e = String(p?.fileExt || '').replace(/^\./, '').toLowerCase().trim();
      return /^[a-z0-9]{1,5}$/.test(e) ? e : '';
    } catch { return ''; }
  })();
  let realName: string | undefined =
    parsed.title || parsed.fileName || parsed.name
    || (kind !== 'image' && urlBase && /\.[A-Za-z0-9]{2,5}$/.test(urlBase) ? urlBase : undefined);
  // Nếu có tên nhưng THIẾU đuôi mà Zalo báo fileExt → ghép đuôi (vd "Hợp đồng" + ".doc").
  if (realName && fileExt && !/\.[A-Za-z0-9]{2,5}$/.test(realName)) {
    realName = `${realName}.${fileExt}`;
  }

  // FIX 2026-06-12 (anh báo video .mp4 lọt tab Tệp): Zalo gửi video dưới dạng ĐÍNH KÈM file
  // (contentType='file') → kind='file' → vào tab Tệp, gửi đi mất player. Đuôi (fileExt hoặc
  // đuôi của realName) cho biết THẬT là video → nâng kind='file'→'video' để vào tab Video,
  // có thumbnail, gửi đi NATIVE. Chỉ NÂNG file→video (anh chốt); ảnh Zalo gửi đúng kind sẵn.
  if (kind === 'file') {
    const extForKind = fileExt || (realName?.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] ?? '');
    if (kindFromExt(extForKind) === 'video') {
      kind = 'video';
      logger.info(`[media][audit] nhận diện video từ đuôi .${extForKind} (Zalo gửi dạng file) msg=${messageId}`);
    }
  }
  // 2026-06-20 (anh chốt): ẢNH Zalo không kèm tên → thay "Lưu từ chat" giống hệt nhau bằng
  // "[tên cuối của sale] dd/mm" (vd "Ngoán 20/06") cho dễ phân biệt + biết ai lưu, khi nào.
  // Áp cho MỌI fallback (ảnh/video/file thiếu tên thật). Sale vẫn đổi tên lại được trong kho.
  const saver = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  const saleLast =
    (saver?.fullName ?? '').trim().split(/\s+/).pop()
    || (nick.displayName ?? '').trim().split(/\s+/).pop()
    || 'Chat';
  const ddmm = (message.sentAt ?? new Date()).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
  });
  const mediaName = realName || `${saleLast} ${ddmm}`;

  // Validation file (audit 2026-06-12): save-from-chat KHÔNG qua classify() như /upload.
  // Chặn đuôi nguy hiểm (thực thi) để file độc không vào kho rồi gửi lại khách. KHÔNG dùng
  // whitelist cứng vì file Zalo nhiều khi mime=octet-stream hợp lệ (pdf/excel) sẽ bị chặn nhầm.
  if (kind === 'file') {
    const fname = String(mediaName || url || '').toLowerCase();
    const DANGEROUS = ['.exe', '.bat', '.cmd', '.scr', '.com', '.pif', '.msi', '.js', '.jar', '.vbs', '.ps1', '.sh'];
    if (DANGEROUS.some((ext) => fname.endsWith(ext))) {
      logger.warn(`[media][audit] chặn lưu file nguy hiểm user=${userId} name=${fname}`);
      return { messageId, status: 'blocked', reason: 'Loại tệp này không được phép lưu vào kho (bảo mật).' };
    }
  }

  let tmp: { path: string; cleanup: () => Promise<void> } | null = null;
  try {
    tmp = await downloadMediaToTemp({ url, filename: realName }, ct);
    const buf = await readFile(tmp.path);
    // GĐ13b: quét virus file lưu-từ-chat (fail-open mặc định; AV tắt → skip). Nhiễm → chặn lưu.
    const av = await scanOrPass(buf, { filename: realName, userId });
    if (av.blocked) return { messageId, status: 'blocked', reason: av.reason };
    const mimeType = parsed.mime
      || (kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'application/octet-stream');
    const res = await registerAsset({
      orgId, buffer: buf, mimeType, kind,
      name: mediaName,
      originalFilename: realName,
      ownerUserId: userId, createdById: userId,
      visibility: vis.visibility,
      source: 'saved_from_chat',
      // 2026-06-15: ghi nick nguồn cho MỌI ảnh lưu từ chat (cả nick thường) để hiện "ảnh từ
      // nick nào". Cờ ENFORCE privacy tách riêng — chỉ true khi nick Riêng tư (privacyMode='main').
      sourceZaloAccountId: nick.id,
      sourceIsPrivateNick: isPrivateNick,
    });
    logger.info(`[media][audit] save_from_chat asset=${res.asset.id} user=${userId} visibility=${vis.visibility} fromPrivateNick=${isPrivateNick} deduped=${res.deduped}`);
    await logMediaUsage({
      orgId, mediaAssetId: res.asset.id, eventType: 'saved_from_chat', userId,
      conversationId: message.conversationId,
      meta: { visibility: vis.visibility, fromPrivateNick: isPrivateNick, deduped: res.deduped },
    });
    return { messageId, status: 'ok', asset: { id: res.asset.id, name: res.asset.name }, deduped: res.deduped };
  } catch (err: any) {
    logger.error('[media] save-from-chat error:', err);
    return { messageId, status: 'error', reason: err?.message ?? 'save failed' };
  } finally {
    await tmp?.cleanup().catch(() => {});
  }
}

export async function mediaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/media — list kho (scope owner + visibility) ────────────────
  app.get(
    '/api/v1/media',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const q = request.query as {
        kind?: string; tag?: string; folderId?: string;
        visibility?: string; q?: string; limit?: string;
        // Lever 2 (anh chốt 2026-06-12): lọc sâu.
        since?: string;        // '7d' | '30d' | '90d' — tải lên/dùng trong N ngày
        sizeMin?: string; sizeMax?: string; // byte
        sort?: string;         // 'recent' (mặc định, theo lastUsedAt) | 'newest' (createdAt) | 'most_used' | 'name'
        // 2026-06-16: phân trang theo trang (block picker) + lọc theo người tải lên.
        skip?: string;         // offset — bỏ qua N kết quả đầu (page * limit)
        ownerUserId?: string;  // chỉ ảnh của 1 sale cụ thể (dropdown người upload)
      };

      // view_all → xem cả org; thường → chỉ asset của mình HOẶC public.
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const scopeWhere = canViewAll
        ? {}
        : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] };

      const where: any = {
        orgId: user.orgId,
        archivedAt: null,
        ...scopeWhere,
      };
      if (q.kind) where.kind = q.kind;
      if (q.visibility) where.visibility = q.visibility;
      if (q.folderId) where.folderId = q.folderId;
      // Tag lưu lowercase (normalizeTags) → lọc cũng lowercase để khớp dù sale gõ hoa (code-review #2).
      if (q.tag) where.tagIds = { has: q.tag.trim().toLowerCase() };
      if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
      // Lọc theo người tải lên (chủ sở hữu). AND với scopeWhere → sale thường chỉ thấy
      // ảnh CÔNG KHAI của người đó (đúng scope), admin view_all thấy tất cả.
      if (q.ownerUserId) where.ownerUserId = q.ownerUserId;
      // Thời gian: tải lên trong N ngày (createdAt).
      if (q.since) {
        const days = { '7d': 7, '30d': 30, '90d': 90 }[q.since];
        if (days) where.createdAt = { gte: new Date(Date.now() - days * 86400_000) };
      }
      // Size: lọc theo sizeBytes của blob 'original'.
      const sizeMin = q.sizeMin ? parseInt(q.sizeMin, 10) : null;
      const sizeMax = q.sizeMax ? parseInt(q.sizeMax, 10) : null;
      if (sizeMin || sizeMax) {
        where.blobs = { some: { variantType: 'original',
          ...(sizeMin ? { sizeBytes: { gte: sizeMin } } : {}),
          ...(sizeMax ? { sizeBytes: { lte: sizeMax } } : {}),
        } };
      }

      // Sắp xếp (Lever 2): recent (lastUsed) | newest (createdAt) | most_used | name.
      const orderBy: any = {
        recent: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        newest: [{ createdAt: 'desc' }],
        most_used: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
        name: [{ name: 'asc' }],
      }[q.sort ?? 'recent'] ?? [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];

      const limit = Math.min(parseInt(q.limit ?? '60', 10) || 60, 200);
      const skip = Math.max(parseInt(q.skip ?? '0', 10) || 0, 0);
      // include owner + sourceZaloAccount để hiện "ảnh từ nick nào / sale nào" trong 1 query
      // (chống N+1 — eng-review #6). select chỉ field cần, không kéo nguyên row nick/user.
      // total: tổng số khớp filter (KHÔNG phụ thuộc skip/take) → FE hiện "Trang X/Y" + đếm.
      const [total, assets] = await Promise.all([
        prisma.mediaAsset.count({ where }),
        prisma.mediaAsset.findMany({
          where,
          orderBy,
          skip,
          take: limit,
          include: {
            blobs: { where: { variantType: { in: ['original', 'watermarked'] } } },
            owner: { select: { fullName: true } },
            sourceZaloAccount: { select: { displayName: true } },
          },
        }),
      ]);

      // Bộ ảnh yêu thích của user (để FE hiện trạng thái ⭐ ngay trong list/panel).
      const favAlbum = await prisma.mediaAlbum.findFirst({
        where: { orgId: user.orgId, ownerUserId: userId, kind: 'favorite' }, select: { id: true },
      });
      const favSet = new Set<string>();
      if (favAlbum) {
        const favItems = await prisma.mediaAlbumItem.findMany({
          where: { albumId: favAlbum.id }, select: { mediaAssetId: true },
        });
        for (const fi of favItems) favSet.add(fi.mediaAssetId);
      }

      const items = assets.map((a) => {
        const blob = a.blobs.find((b) => b.variantType === 'original');
        const wm = a.blobs.find((b) => b.variantType === 'watermarked');
        return {
          id: a.id,
          kind: a.kind,
          name: a.name,
          visibility: a.visibility,
          ownerUserId: a.ownerUserId,
          tagIds: a.tagIds,
          usageCount: a.usageCount,
          url: blob?.publicUrl ?? null,
          // VIDEO/FILE KHÔNG fallback thumbnail = URL gốc (mp4/pdf) → tránh <img> vỡ.
          // Chỉ ẢNH mới dùng blob.publicUrl làm thumbnail. Video dùng thumbnailUrl thật (ffmpeg).
          thumbnailUrl: a.thumbnailUrl ?? (a.kind === 'image' ? blob?.publicUrl ?? null : null),
          sizeBytes: blob?.sizeBytes ?? null,
          durationSec: blob?.durationSec ?? null,
          createdAt: a.createdAt,
          // Watermark per-ảnh (GĐ2).
          watermarkEnabled: a.watermarkEnabled,
          watermarkPosition: a.watermarkPosition,
          watermarkOpacity: a.watermarkOpacity,
          watermarkUrl: wm?.publicUrl ?? null,
          // D11: ảnh lưu từ nick Riêng tư → FE hỏi xác nhận trước khi chia sẻ công khai.
          // 2026-06-15: đọc CỜ riêng (không suy từ sourceZaloAccountId nữa — nick thường giờ
          // cũng có id nguồn để hiển thị, nhưng KHÔNG phải Riêng tư).
          sourceFromPrivateNick: a.sourceIsPrivateNick,
          favorited: favSet.has(a.id),
          // Nguồn để HIỂN THỊ "ảnh từ nick nào / sale nào / kích thước" (createdAt đã có ở trên).
          source: a.source,
          ownerName: a.owner?.fullName ?? null,
          sourceNickName: a.sourceZaloAccount?.displayName ?? null,
          width: blob?.width ?? null,
          height: blob?.height ?? null,
        };
      });
      // total kèm theo để FE phân trang (block picker). Caller cũ chỉ đọc `items` → không vỡ.
      return { items, total };
    },
  );

  // ── GET /api/v1/media/uploaders — danh sách người tải lên (cho dropdown lọc) ──
  // Trả các sale có ảnh trong scope hiện tại + số lượng, để FE đổ vào dropdown "Người upload".
  // Nhận kind/visibility để dropdown KHỚP đúng view (vd block picker chỉ ảnh công khai).
  app.get(
    '/api/v1/media/uploaders',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const q = request.query as { kind?: string; visibility?: string };

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const scopeWhere = canViewAll
        ? {}
        : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] };

      const where: any = {
        orgId: user.orgId,
        archivedAt: null,
        ownerUserId: { not: null },
        ...scopeWhere,
      };
      if (q.kind) where.kind = q.kind;
      if (q.visibility) where.visibility = q.visibility;

      // groupBy lấy số ảnh mỗi owner trong 1 query, rồi join tên (chống N+1).
      const rows = await prisma.mediaAsset.groupBy({
        by: ['ownerUserId'],
        where,
        _count: { _all: true },
      });
      const ids = rows.map((r) => r.ownerUserId).filter((id): id is string => !!id);
      const users = ids.length
        ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
        : [];
      const nameById = new Map(users.map((u) => [u.id, u.fullName]));
      const uploaders = rows
        .filter((r) => r.ownerUserId)
        .map((r) => ({ id: r.ownerUserId!, name: nameById.get(r.ownerUserId!) ?? 'Không rõ', count: r._count._all }))
        .sort((a, b) => b.count - a.count);
      return { uploaders };
    },
  );

  // ── POST /api/v1/media/upload — tải ảnh/file lên kho (multipart) ───────────
  app.post(
    '/api/v1/media/upload',
    { preHandler: requireGrant('media', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      let visibility: 'private' | 'public' = 'private';
      let folderId: string | null = null;
      let tagIds: string[] = [];
      // BUG self-verify 2026-06-11: field 'visibility' có thể đến SAU file trong multipart
      // → đọc khi register thì còn 'private'. Fix: GOM file buffers + fields TRƯỚC, register SAU.
      const pending: Array<{ buffer: Buffer; mimeType: string; kind: MediaKind; filename: string }> = [];

      try {
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if (part.fieldname === 'visibility' && part.value === 'public') visibility = 'public';
            if (part.fieldname === 'folderId' && part.value) folderId = String(part.value);
            if (part.fieldname === 'tagIds' && part.value) {
              try { tagIds = JSON.parse(String(part.value)); } catch { /* ignore */ }
            }
            continue;
          }
          if (part.type !== 'file') continue;
          const kind = classify(part.mimetype);
          if (!kind) {
            return reply.status(415).send({ error: `Loại tệp không hỗ trợ: ${part.mimetype}` });
          }
          const buf = await part.toBuffer();
          const max = kind === 'image' ? IMAGE_MAX : kind === 'video' ? VIDEO_MAX : FILE_MAX;
          if (buf.length > max) {
            return reply.status(413).send({
              error: kind === 'image' ? 'Ảnh quá lớn (tối đa 15MB)' : `${kind} vượt ${max / 1024 / 1024}MB`,
            });
          }
          // GĐ13b: quét virus (fail-open mặc định; AV tắt → skip ngay). Chặn nếu nhiễm.
          const av = await scanOrPass(buf, { filename: part.filename, userId });
          if (av.blocked) return reply.status(422).send({ error: av.reason, code: 'AV_BLOCKED' });
          pending.push({ buffer: buf, mimeType: part.mimetype, kind, filename: part.filename });
        }

        // Register SAU khi đã đọc hết parts → visibility/folderId/tagIds chắc chắn đầy đủ.
        const created: any[] = [];
        for (const p of pending) {
          const res = await registerAsset({
            orgId: user.orgId,
            buffer: p.buffer,
            mimeType: p.mimeType,
            kind: p.kind,
            originalFilename: p.filename,
            ownerUserId: userId,
            createdById: userId,
            visibility,
            source: 'upload',
            tagIds,
            folderId,
          });
          created.push({ id: res.asset.id, name: res.asset.name, deduped: res.deduped });
        }
        if (created.length === 0) return reply.status(400).send({ error: 'Không có tệp nào' });
        return { assets: created };
      } catch (err: any) {
        logger.error('[media] upload error:', err);
        return reply.status(500).send({ error: err?.message ?? 'upload failed' });
      }
    },
  );

  // ── POST /api/v1/media/save-from-chat — "Lưu vào Media" từ bong bóng chat ──
  app.post(
    '/api/v1/media/save-from-chat',
    { preHandler: requireGrant('media', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { messageId: string; visibility?: 'private' | 'public' };
      if (!body?.messageId) return reply.status(400).send({ error: 'messageId required' });

      const r = await saveOneMessageToMedia({ orgId: user.orgId, userId, messageId: body.messageId, visibility: body.visibility });
      if (r.status === 'blocked') return reply.status(403).send({ error: r.reason, code: 'PRIVACY_LOCKED' });
      if (r.status === 'error') return reply.status(r.reason === 'Không tìm thấy tin nhắn' ? 404 : 500).send({ error: r.reason });
      if (r.status === 'skipped') return reply.status(400).send({ error: r.reason });
      return { asset: r.asset, deduped: r.deduped };
    },
  );

  // ── POST /api/v1/media/save-from-chat-batch — lưu NHIỀU tin (cả album / chọn 5-10 tấm) ──
  // Nhận messageIds[] (các tile cùng album, hoặc tập ảnh sale tự tick). Lưu lần lượt qua
  // dedup (ảnh trùng không tốn thêm). 1 ảnh lỗi/blocked KHÔNG làm hỏng cả batch — trả per-item.
  app.post(
    '/api/v1/media/save-from-chat-batch',
    { preHandler: requireGrant('media', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { messageIds: string[]; visibility?: 'private' | 'public' };
      if (!body?.messageIds?.length) return reply.status(400).send({ error: 'messageIds required' });
      if (body.messageIds.length > 30) return reply.status(400).send({ error: 'Tối đa 30 ảnh/lần' });

      const results: SaveOneResult[] = [];
      for (const mid of body.messageIds) {
        results.push(await saveOneMessageToMedia({ orgId: user.orgId, userId, messageId: mid, visibility: body.visibility }));
      }
      const saved = results.filter((r) => r.status === 'ok');
      const blocked = results.filter((r) => r.status === 'blocked').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      const failed = results.filter((r) => r.status === 'error').length;
      return {
        savedCount: saved.length,
        dedupedCount: saved.filter((r) => r.deduped).length,
        blocked, skipped, failed,
        assets: saved.map((r) => r.asset),
      };
    },
  );

  // ── POST /api/v1/media/:id/send — chèn 1 asset từ kho vào 1 hội thoại ──────
  app.post(
    '/api/v1/media/:id/send',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const body = request.body as { conversationId: string; caption?: string; addTags?: string[] };
      if (!body?.conversationId) return reply.status(400).send({ error: 'conversationId required' });

      // Asset phải thuộc org + (của mình HOẶC public HOẶC có view_all).
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: {
          id, orgId: user.orgId, archivedAt: null,
          ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }),
        },
        include: { blobs: { where: { variantType: { in: ['original', 'watermarked'] } } } },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media trong kho' });
      // WATERMARK BẬT → gửi bản có logo; ngược lại gửi bản gốc. (Ảnh mới đóng dấu được.)
      const original = asset.blobs.find((b) => b.variantType === 'original');
      const watermarked = asset.blobs.find((b) => b.variantType === 'watermarked');
      const blob = (asset.kind === 'image' && asset.watermarkEnabled && watermarked) ? watermarked : original;
      if (!blob) return reply.status(400).send({ error: 'Media chưa có dữ liệu (đã xóa khỏi kho?)' });

      const conversation = await prisma.conversation.findFirst({
        where: { id: body.conversationId, orgId: user.orgId },
        include: { zaloAccount: true },
      });
      if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });

      // T7b (YC2 2026-06-20): chặn gửi media qua nick ĐÃ XÓA (archivedAt) trước check kết nối.
      if (conversation.zaloAccount.archivedAt) {
        return reply.status(409).send({ error: 'Nick này đã bị xóa — chỉ xem lại lịch sử, không gửi được.', code: 'NICK_ARCHIVED' });
      }

      // Guard sớm: nick phải đang KẾT NỐI (status connected) — tránh treo khi nick
      // QR-pending/disconnected. zaloOps cũng check lại, nhưng báo sớm rõ hơn cho sale.
      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api || instance.status !== 'connected') {
        return reply.status(400).send({
          error: 'Nick Zalo chưa kết nối (cần quét QR đăng nhập lại nick).',
          code: 'NICK_NOT_CONNECTED',
        });
      }

      // PRIVACY: nick Riêng tư → chỉ chính chủ gửi được (như chat-attachment).
      if (conversation.zaloAccount.privacyMode === 'main'
        && conversation.zaloAccount.ownerUserId !== userId) {
        return reply.status(403).send({ error: 'Nick Riêng tư — chỉ chính chủ gửi được.', code: 'PRIVACY_LOCKED' });
      }

      const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
      if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

      const threadId = conversation.externalThreadId || ''; // UID per-cặp-nick (điều 7)
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const io = (app as any).io as Server;
      const userFullName = await getUserFullName(user.id);
      const caption = body.caption ?? '';

      // GĐ1: tải object kho về temp → gửi từ local path (như chat hiện tại).
      // (GĐ3 sẽ tối ưu forward/cache per-nick — chưa làm ở GĐ1.)
      let tmp: { path: string; cleanup: () => Promise<void> } | null = null;
      try {
        // ẢNH/VIDEO: KHÔNG truyền filename (name "Lưu từ chat" không đuôi → temp mất đuôi →
        // Zalo coi ảnh thành FILE). Để downloadMediaToTemp lấy đuôi .webp/.mp4 từ URL.
        // FILE (pdf/excel/doc): BẮT BUỘC truyền tên thật + đuôi — zca-js lấy tên+đuôi khách
        // nhìn thấy từ basename temp; thiếu đuôi → "file lỗi". (anh báo 2026-06-12.)
        const sendName = asset.kind === 'file' ? buildSendFileName(asset, blob) : undefined;
        tmp = await downloadMediaToTemp({ url: blob.publicUrl, filename: sendName }, asset.kind);
        zaloRateLimiter.recordSend(conversation.zaloAccountId);

        // Guard nick connected ở trên. Gửi qua zaloOps (check status + reconnect).
        let zaloMsgId = '';
        let content = '';
        if (asset.kind === 'image') {
          // ẢNH: sendImage (đã fix có msg) → temp CÓ đuôi .webp → Zalo nhận ẢNH INLINE.
          const sendResult: any = await zaloOps.sendImage(
            conversation.zaloAccountId, threadId, threadType as 0 | 1, [tmp.path], io, caption,
          );
          zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
          content = JSON.stringify({ href: blob.publicUrl, thumb: blob.publicUrl, size: blob.sizeBytes });
        } else if (asset.kind === 'video') {
          // VIDEO: gửi NATIVE (player + thumbnail + duration) như chat thường — KHÔNG sendFile
          // (sendFile làm video thành "file .mp4 tải về", mất player). Sinh thumbnail bằng ffmpeg,
          // mirror lên MinIO để lưu vào content. Native lỗi → fallback sendFile (vẫn gửi được).
          // (anh chốt 2026-06-12: video gửi từ kho phải đẹp như chat.)
          let thumbUrl: string = asset.thumbnailUrl ?? blob.publicUrl;
          let thumbPath: string | undefined;
          try {
            const gen = await generateThumbnail(tmp.path);
            thumbPath = gen.path;
            const thumbBuf = await readFile(gen.path);
            const up = await uploadBuffer(thumbBuf, 'image/jpeg', `${asset.name || 'video'}-thumb.jpg`);
            thumbUrl = up.url;
          } catch (e) {
            logger.warn('[media] video thumbnail gen failed (gửi từ kho):', (e as Error)?.message ?? e);
          }
          try {
            if (!instance?.api) throw new Error('nick api null');
            const sendResult: any = await sendNativeVideo({
              api: instance.api as any, videoPath: tmp.path, thumbnailPath: thumbPath,
              threadId, threadType: threadType as 0 | 1, message: caption,
            });
            zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
          } catch (e) {
            logger.warn('[media] sendNativeVideo lỗi → fallback sendFile:', (e as Error)?.message ?? e);
            const sendResult: any = await zaloOps.sendFile(
              conversation.zaloAccountId, threadId, threadType as 0 | 1, [tmp.path], io, caption,
            );
            zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
          }
          content = JSON.stringify({ href: blob.publicUrl, thumb: thumbUrl, thumbUrl, thumbnail: thumbUrl, size: blob.sizeBytes });
        } else {
          // FILE (pdf/excel/doc/zip): sendFile (zca-js đọc local path → đính kèm file).
          const sendResult: any = await zaloOps.sendFile(
            conversation.zaloAccountId, threadId, threadType as 0 | 1, [tmp.path], io, caption,
          );
          zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
          content = JSON.stringify({ href: blob.publicUrl, name: asset.name, size: blob.sizeBytes, mime: blob.mimeType });
        }

        const msg = await createMediaMessage({
          conversationId: conversation.id,
          zaloAccount: conversation.zaloAccount,
          repliedByUserId: user.id,
          zaloMsgId,
          contentType: asset.kind as 'image' | 'video' | 'file',
          content,
          metadata: { sender: { kind: 'user_crm', name: userFullName } },
          sentVia: 'user',
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });
        await bumpUsage(asset.id);
        // Gắn tag/dự án LÚC GỬI (anh chốt 2026-06-15): sale bấm chip gợi ý → tag dính vào ảnh,
        // bữa sau tìm lại dễ. Ghi tag TỰ DO (ai gửi cũng thêm được, kể cả ảnh công khai của
        // sale khác — Anh chốt ưu tiên tag phong phú cho ảnh dùng chung, KHÁC scope owner của
        // PATCH /:id và /bulk; CHỈ áp cho addTags lúc gửi, KHÔNG nới quyền sửa tên/visibility).
        if (Array.isArray(body.addTags) && body.addTags.length) {
          const merged = normalizeTags([...(asset.tagIds ?? []), ...body.addTags]);
          await prisma.mediaAsset.update({ where: { id: asset.id }, data: { tagIds: merged } });
        }
        await logMediaUsage({
          orgId: user.orgId, mediaAssetId: asset.id, eventType: 'sent_chat',
          userId, conversationId: conversation.id,
          meta: { watermarked: blob.variantType === 'watermarked', taggedOnSend: (body.addTags?.length ?? 0) > 0 },
        });

        await emitChatMessage({
          io,
          orgId: user.orgId,
          accountId: conversation.zaloAccountId,
          conversationId: conversation.id,
          message: msg,
          privacyMode: conversation.zaloAccount.privacyMode,
          ownerUserId: conversation.zaloAccount.ownerUserId,
        });
        return { message: msg };
      } catch (err: any) {
        logger.error('[media] send error:', err);
        return reply.status(500).send({ error: err?.message ?? 'send failed' });
      } finally {
        await tmp?.cleanup().catch(() => {});
      }
    },
  );

  // ── PATCH /api/v1/media/:id — sửa quyền/tên/tag (GĐ2) ──────────────────────
  app.patch(
    '/api/v1/media/:id',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string; visibility?: 'private' | 'public';
        tagIds?: string[]; folderId?: string | null; confirmShare?: boolean;
      };

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media (hoặc không thuộc bạn)' });

      // PRIVACY (D11 — anh chốt 2026-06-12: HỎI XÁC NHẬN thay vì chặn cứng):
      // Ảnh lưu từ nick Riêng tư → chuyển Công khai PHẢI kèm confirmShare=true (FE đã hiện
      // dialog "có thể chứa thông tin khách — chắc chắn chia sẻ?"). Thiếu → trả NEED_CONFIRM.
      // 2026-06-15: đọc CỜ sourceIsPrivateNick (KHÔNG suy từ sourceZaloAccountId — nick thường
      // giờ cũng có id nguồn nhưng không phải Riêng tư, không được bắt xác nhận oan).
      const sharingPrivateNickAsset = body.visibility === 'public' && asset.sourceIsPrivateNick;
      if (sharingPrivateNickAsset && !body.confirmShare) {
        return reply.status(409).send({
          error: 'Ảnh lưu từ nick Riêng tư — cần xác nhận trước khi chia sẻ Công khai.',
          code: 'NEED_SHARE_CONFIRM',
        });
      }

      const updated = await prisma.mediaAsset.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
          ...(body.tagIds !== undefined ? { tagIds: normalizeTags(body.tagIds) } : {}),
          ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
        },
      });

      // AUDIT privacy (S8): chuyển sang Công khai → ghi log (đặc biệt ảnh từ nick Riêng tư).
      if (body.visibility === 'public') {
        logger.info(`[media][audit] make_public asset=${id} user=${userId} fromPrivateNick=${asset.sourceIsPrivateNick}`);
        await logMediaUsage({
          orgId: user.orgId, mediaAssetId: id, eventType: 'made_public', userId,
          meta: { fromPrivateNick: asset.sourceIsPrivateNick, confirmed: !!body.confirmShare },
        });
      }
      return { asset: { id: updated.id, name: updated.name, visibility: updated.visibility, tagIds: updated.tagIds } };
    },
  );

  // ── PATCH /api/v1/media/bulk — gán folder / tag HÀNG LOẠT (GĐ12 multi-select) ─
  // Chỉ áp cho asset active CỦA MÌNH (hoặc view_all). KHÔNG đổi visibility ở bulk (tránh
  // vô tình chia sẻ ảnh nick Riêng tư — privacy; đổi visibility vẫn qua PATCH /:id đơn lẻ
  // có cổng confirmShare D11). folderId=null = bỏ khỏi thư mục.
  app.patch(
    '/api/v1/media/bulk',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { ids: string[]; folderId?: string | null; addTags?: string[] };
      if (!Array.isArray(body?.ids) || body.ids.length === 0) {
        return reply.status(400).send({ error: 'Thiếu danh sách ảnh (ids)' });
      }
      if (body.ids.length > 200) return reply.status(400).send({ error: 'Tối đa 200 mục/lần' });
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');

      // Chỉ lấy asset active thuộc phạm vi cho phép → chống sửa của người khác / đồ đã xóa.
      const scoped = await prisma.mediaAsset.findMany({
        where: {
          id: { in: body.ids }, orgId: user.orgId, archivedAt: null,
          ...(canViewAll ? {} : { ownerUserId: userId }),
        },
        select: { id: true, tagIds: true },
      });
      if (scoped.length === 0) return reply.status(404).send({ error: 'Không có mục hợp lệ để cập nhật' });

      // Gán folder: 1 update chung cho tất cả (cùng giá trị).
      if (body.folderId !== undefined) {
        await prisma.mediaAsset.updateMany({
          where: { id: { in: scoped.map((a) => a.id) } },
          data: { folderId: body.folderId },
        });
      }
      // Gán thêm tag: hợp nhất tag mới vào tag cũ per-asset (không ghi đè tag đang có).
      // normalizeTags: lowercase + dedup (gộp tag/dự án, không phân biệt hoa/thường — 2026-06-15).
      if (body.addTags && body.addTags.length) {
        const clean = normalizeTags(body.addTags);
        for (const a of scoped) {
          const merged = normalizeTags([...(a.tagIds ?? []), ...clean]);
          await prisma.mediaAsset.update({ where: { id: a.id }, data: { tagIds: merged } });
        }
      }
      logger.info(`[media][audit] bulk_update user=${userId} count=${scoped.length} folder=${body.folderId !== undefined} tags=${body.addTags?.length ?? 0}`);
      return { ok: true, updated: scoped.length };
    },
  );

  // ── DELETE /api/v1/media/:id — vào THÙNG RÁC (xóa MỀM, giữ object MinIO) ────
  // GĐ13a (2026-06-12): archivedAt = dấu thùng rác. grant 'edit' đủ (sale xóa ảnh CỦA MÌNH).
  // Xóa của người khác cần view_all (admin). Ghi trashedById để audit + scope khôi phục.
  app.delete(
    '/api/v1/media/:id',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });
      // INVARIANT: chỉ vào thùng rác, KHÔNG xóa object MinIO (giữ lịch sử chat cũ trỏ tới).
      await prisma.mediaAsset.update({ where: { id }, data: { archivedAt: new Date(), trashedById: userId } });
      logger.info(`[media][audit] trash asset=${id} user=${userId}`);
      return { ok: true };
    },
  );

  // ── GET /api/v1/media/download — tải file kho kèm ĐÚNG TÊN (2026-06-13, anh báo) ──────
  // Kho lưu object media/{hash}.ext → mở thẳng URL = tải về tên-hash. Endpoint proxy stream
  // file + Content-Disposition filename="tên thật" → trình duyệt tải đúng tên (như Zalo real).
  // Query: url (public URL kho) + name (tên hiển thị). Auth qua authMiddleware (hook preHandler).
  app.get(
    '/api/v1/media/download',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { url?: string; name?: string };
      if (!q.url) return reply.status(400).send({ error: 'Thiếu url' });
      const key = keyFromPublicUrl(q.url);
      if (!key) return reply.status(400).send({ error: 'URL không thuộc kho' });
      // BUFFER (không pipe stream) — pipe MinIO-stream vào reply đôi khi TREO (socket hang up,
      // anh gặp 2 file). Đọc hết thành Buffer rồi send → ổn định, file kho nhỏ vài MB.
      const buf = await getObjectBuffer(key);
      if (!buf) return reply.status(404).send({ error: 'Không tìm thấy tệp' });
      // Tên tải về: name truyền lên (đã có đuôi) → fallback basename của key. Lọc ký tự cấm header.
      const rawName = (q.name && q.name.trim()) || decodeURIComponent(key.split('/').pop() || 'tep');
      const safeName = rawName.replace(/["\r\n]/g, '').slice(0, 200);
      // RFC5987 cho tên Unicode (tiếng Việt) — filename* để trình duyệt giữ dấu.
      reply
        .header('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`)
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', String(buf.length))
        .header('Cache-Control', 'private, max-age=0');
      return reply.send(buf);
    },
  );

  // ── GET /api/v1/media/trash — danh sách asset trong thùng rác ──────────────
  // GĐ13a: chỉ asset archivedAt != null. Scope owner (sale) / view_all (admin). Có limit+cursor.
  // Trả thêm archivedAt + trashedById + daysUntilPurge (30 - số ngày đã trong thùng).
  app.get(
    '/api/v1/media/trash',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const q = request.query as { kind?: string; limit?: string; cursor?: string };
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const limit = Math.min(parseInt(q.limit ?? '60', 10) || 60, 200);

      const where: any = {
        orgId: user.orgId,
        archivedAt: { not: null },
        ...(canViewAll ? {} : { ownerUserId: userId }),
        ...(q.kind ? { kind: q.kind } : {}),
      };
      const assets = await prisma.mediaAsset.findMany({
        where,
        orderBy: [{ archivedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: { blobs: { where: { variantType: 'original' }, take: 1 } },
      });
      const hasMore = assets.length > limit;
      const page = hasMore ? assets.slice(0, limit) : assets;
      const now = Date.now();
      const items = page.map((a) => {
        const archivedMs = a.archivedAt ? a.archivedAt.getTime() : now;
        const daysInTrash = Math.floor((now - archivedMs) / 86400000);
        return {
          id: a.id, kind: a.kind, name: a.name, originalFilename: a.originalFilename,
          thumbnailUrl: a.thumbnailUrl, visibility: a.visibility, tagIds: a.tagIds,
          sizeBytes: a.blobs[0]?.sizeBytes ?? null, durationSec: a.blobs[0]?.durationSec ?? null,
          archivedAt: a.archivedAt, trashedById: a.trashedById,
          daysUntilPurge: Math.max(0, TRASH_RETENTION_DAYS - daysInTrash),
        };
      });
      return { items, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
    },
  );

  // ── POST /api/v1/media/:id/restore — khôi phục từ thùng rác về kho ─────────
  // GĐ13a: archivedAt về null + clear trashedById. Scope như DELETE (chủ / view_all).
  app.post(
    '/api/v1/media/:id/restore',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: { not: null }, ...(canViewAll ? {} : { ownerUserId: userId }) },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media trong thùng rác' });
      await prisma.mediaAsset.update({ where: { id }, data: { archivedAt: null, trashedById: null } });
      logger.info(`[media][audit] restore asset=${id} user=${userId}`);
      return { ok: true };
    },
  );

  // ── DELETE /api/v1/media/:id/permanent — xóa cứng 1 asset NGAY ─────────────
  // GĐ13a: cần grant media.delete (mạnh hơn edit). BẮT BUỘC asset đang ở thùng rác
  // (archivedAt != null) — chặn bypass xóa cứng asset active. KHÔNG đụng byte MinIO.
  app.delete(
    '/api/v1/media/:id/permanent',
    { preHandler: requireGrant('media', 'delete') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: { not: null }, ...(canViewAll ? {} : { ownerUserId: userId }) },
      });
      if (!asset) return reply.status(404).send({ error: 'Chỉ xóa vĩnh viễn được media đang trong thùng rác' });
      // Cascade Prisma: xóa asset → blob + album_item + usage_event tự xóa. KHÔNG xóa byte MinIO.
      await prisma.mediaAsset.delete({ where: { id } });
      logger.info(`[media][audit] permanent_delete asset=${id} user=${userId} (DB only, MinIO byte giữ)`);
      return { ok: true };
    },
  );

  // ── DELETE /api/v1/media/trash/empty — dọn sạch thùng rác (DB) ─────────────
  // GĐ13a: cần grant media.delete. Sale xóa của mình; admin (view_all) xóa cả org.
  // Batch theo cap để không khóa DB lâu. KHÔNG đụng byte MinIO.
  app.delete(
    '/api/v1/media/trash/empty',
    { preHandler: requireGrant('media', 'delete') },
    async (request: FastifyRequest) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const where: any = {
        orgId: user.orgId, archivedAt: { not: null },
        ...(canViewAll ? {} : { ownerUserId: userId }),
      };
      // Lấy id theo cap (deterministic) rồi xóa — tránh deleteMany ôm nghìn hàng 1 phát.
      const victims = await prisma.mediaAsset.findMany({
        where, select: { id: true }, orderBy: [{ archivedAt: 'asc' }, { id: 'asc' }], take: TRASH_EMPTY_BATCH,
      });
      if (victims.length === 0) return { ok: true, deleted: 0, hasMore: false };
      await prisma.mediaAsset.deleteMany({ where: { id: { in: victims.map((v) => v.id) } } });
      logger.info(`[media][audit] empty_trash user=${userId} deleted=${victims.length} (DB only)`);
      return { ok: true, deleted: victims.length, hasMore: victims.length === TRASH_EMPTY_BATCH };
    },
  );

  // ── POST /api/v1/media/:id/watermark — đóng dấu logo HS (sinh variant) ─────
  app.post(
    '/api/v1/media/:id/watermark',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { position?: any; opacity?: number };

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
        select: { id: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });
      try {
        const res = await generateWatermarkVariant({
          orgId: user.orgId, assetId: id, position: body.position, opacity: body.opacity,
        });
        return { blobId: res.blobId, url: res.url };
      } catch (err: any) {
        logger.error('[media] watermark error:', err);
        return reply.status(400).send({ error: err?.message ?? 'watermark failed' });
      }
    },
  );

  // ── DELETE /api/v1/media/:id/watermark — TẮT watermark (gửi lại ảnh gốc) ────
  app.delete(
    '/api/v1/media/:id/watermark',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
        select: { id: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });
      try {
        await disableWatermark(user.orgId, id);
        return { ok: true };
      } catch (err: any) {
        logger.error('[media] disable watermark error:', err);
        return reply.status(400).send({ error: err?.message ?? 'disable watermark failed' });
      }
    },
  );

  // ── GET /api/v1/media/folders — cây thư mục (scope owner + visibility) ─────
  app.get(
    '/api/v1/media/folders',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const folders = await prisma.mediaAlbum.findMany({
        where: {
          orgId: user.orgId,
          ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, kind: true, visibility: true, ownerUserId: true },
      });
      return { folders };
    },
  );

  // ── POST /api/v1/media/folders — tạo thư mục ──────────────────────────────
  app.post(
    '/api/v1/media/folders',
    { preHandler: requireGrant('media', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { name: string; visibility?: 'private' | 'public' };
      if (!body?.name?.trim()) return reply.status(400).send({ error: 'Tên thư mục bắt buộc' });
      const folder = await prisma.mediaAlbum.create({
        data: {
          orgId: user.orgId,
          name: body.name.trim(),
          kind: 'folder',
          visibility: body.visibility ?? 'private',
          ownerUserId: userId,
          createdById: userId,
        },
      });
      return { folder: { id: folder.id, name: folder.name } };
    },
  );

  // ── GET /api/v1/media/suggest?conversationId= — gợi ý ảnh theo NGỮ CẢNH (GĐ3a-4)
  // Match MediaAsset.tagIds với tag/dự án của Contact đang chat. Chỉ ảnh CÔNG KHAI
  // hoặc CỦA CHÍNH sale (không lộ ảnh riêng tư người khác — privacy).
  app.get(
    '/api/v1/media/suggest',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const q = request.query as { conversationId?: string };
      if (!q.conversationId) return { items: [], matchedTags: [], contactTags: [] };

      const conv = await prisma.conversation.findFirst({
        where: { id: q.conversationId, orgId: user.orgId },
        include: { contact: { select: { tags: true, autoTags: true } } },
      });
      if (!conv?.contact) return { items: [], matchedTags: [], contactTags: [] };

      // Gom tag khách (manual + auto, lowercase). Bỏ prefix 'auto:'.
      const raw = [
        ...(Array.isArray(conv.contact.tags) ? conv.contact.tags : []),
        ...(Array.isArray(conv.contact.autoTags) ? conv.contact.autoTags : []),
      ].map((t) => String(t).replace(/^auto:/, '').trim().toLowerCase()).filter(Boolean);
      const custTags = [...new Set(raw)];
      // 2026-06-20 (anh chốt): GỠ phần gợi-ý-ẢNH (items) — gợi ý không đúng + sale không dùng.
      // GIỮ contactTags để MediaSendPicker hiện chip "tag khách" khi sale gửi ảnh (vẫn dùng).
      // items/matchedTags trả rỗng để KHÔNG vỡ type FE cũ.
      void userId;
      return { items: [], matchedTags: [], contactTags: custTags };
    },
  );

  // ── GET /api/v1/media/tags — danh sách tag đang dùng (autocomplete) ─────────
  // 2026-06-15: gom tag distinct từ MediaAsset.tagIds (scope owner + public), kèm số lượng,
  // xếp theo phổ biến. Dùng cho autocomplete ô tag (panel chi tiết) + chip "tag hay dùng"
  // lúc gửi khi khách chưa có tag (empty-state). unnest mảng tagIds bằng raw SQL.
  app.get(
    '/api/v1/media/tags',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const q = request.query as { limit?: string };
      const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 200);
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      // Scope: view_all → cả org; thường → tag của ảnh mình HOẶC ảnh công khai (không lộ
      // tag riêng tư của sale khác). archived bỏ qua. Tag đã lowercase sẵn khi ghi.
      const rows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
        SELECT lower(tag) AS tag, COUNT(*)::bigint AS count
        FROM "media_assets", unnest("tag_ids") AS tag
        WHERE "org_id" = ${user.orgId}
          AND "archived_at" IS NULL
          ${canViewAll ? Prisma.empty : Prisma.sql`AND ("owner_user_id" = ${userId} OR "visibility" = 'public')`}
        GROUP BY lower(tag)
        ORDER BY count DESC, tag ASC
        LIMIT ${limit}
      `;
      return { tags: rows.map((r) => ({ tag: r.tag, count: Number(r.count) })) };
    },
  );

  // ── GET /api/v1/media/stats — top ảnh hay dùng + tổng quan (GĐ4 đo hiệu quả) ──
  app.get(
    '/api/v1/media/stats',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const scope = canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] };

      // Top 10 ảnh dùng nhiều nhất.
      const top = await prisma.mediaAsset.findMany({
        where: { orgId: user.orgId, archivedAt: null, usageCount: { gt: 0 }, ...scope },
        orderBy: { usageCount: 'desc' },
        take: 10,
        include: { blobs: { where: { variantType: 'original' }, take: 1 } },
      });

      // Tổng quan: số asset, tổng lượt dùng, ước lượng tiết kiệm (số blob vs số lần dùng).
      const totalAssets = await prisma.mediaAsset.count({ where: { orgId: user.orgId, archivedAt: null, ...scope } });
      const agg = await prisma.mediaAsset.aggregate({
        where: { orgId: user.orgId, archivedAt: null, ...scope },
        _sum: { usageCount: true },
      });
      const totalUsage = agg._sum.usageCount ?? 0;

      return {
        totalAssets,
        totalUsage,
        topUsed: top.map((a) => ({
          id: a.id, name: a.name, kind: a.kind, usageCount: a.usageCount,
          thumbnailUrl: a.thumbnailUrl ?? a.blobs[0]?.publicUrl ?? null,
        })),
      };
    },
  );

  // ── Bộ sưu tập YÊU THÍCH cá nhân (GĐ5) — MediaAlbum kind='favorite', 1/user ─
  async function getOrCreateFavoriteAlbum(orgId: string, userId: string) {
    let fav = await prisma.mediaAlbum.findFirst({ where: { orgId, ownerUserId: userId, kind: 'favorite' } });
    if (!fav) {
      fav = await prisma.mediaAlbum.create({
        data: { orgId, name: '⭐ Yêu thích của tôi', kind: 'favorite', visibility: 'private', ownerUserId: userId, createdById: userId },
      });
    }
    return fav;
  }

  // POST /media/:id/favorite — toggle yêu thích (thêm/bỏ khỏi bộ sưu tập cá nhân).
  app.post(
    '/api/v1/media/:id/favorite',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      // asset phải thuộc org + thấy được (của mình hoặc public).
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }) },
        select: { id: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });

      const fav = await getOrCreateFavoriteAlbum(user.orgId, userId);
      const existing = await prisma.mediaAlbumItem.findUnique({
        where: { albumId_mediaAssetId: { albumId: fav.id, mediaAssetId: id } },
      });
      if (existing) {
        await prisma.mediaAlbumItem.delete({ where: { id: existing.id } });
        return { favorited: false };
      }
      await prisma.mediaAlbumItem.create({ data: { albumId: fav.id, mediaAssetId: id } });
      return { favorited: true };
    },
  );

  // GET /media/favorites — danh sách ảnh yêu thích của user.
  app.get(
    '/api/v1/media/favorites',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const fav = await prisma.mediaAlbum.findFirst({ where: { orgId: user.orgId, ownerUserId: userId, kind: 'favorite' } });
      if (!fav) return { items: [] };
      const items = await prisma.mediaAlbumItem.findMany({
        where: { albumId: fav.id, asset: { archivedAt: null } },
        include: { asset: { include: { blobs: { where: { variantType: 'original' }, take: 1 } } } },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });
      return {
        items: items.map(({ asset: a }) => ({
          id: a.id, name: a.name, kind: a.kind, visibility: a.visibility,
          url: a.blobs[0]?.publicUrl ?? null,
          thumbnailUrl: a.thumbnailUrl ?? a.blobs[0]?.publicUrl ?? null,
          usageCount: a.usageCount,
        })),
      };
    },
  );

  // POST /media/album/send — gửi NHIỀU asset (cả album) vào 1 hội thoại 1 lần (GĐ5).
  app.post(
    '/api/v1/media/album/send',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { assetIds: string[]; conversationId: string; caption?: string };
      if (!body?.assetIds?.length || !body.conversationId) return reply.status(400).send({ error: 'assetIds + conversationId required' });
      if (body.assetIds.length > 12) return reply.status(400).send({ error: 'Tối đa 12 ảnh/lần' });

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const found = await prisma.mediaAsset.findMany({
        where: { id: { in: body.assetIds }, orgId: user.orgId, archivedAt: null, kind: 'image',
          ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }) },
        include: { blobs: { where: { variantType: { in: ['original', 'watermarked'] } } } },
      });
      if (found.length === 0) return reply.status(404).send({ error: 'Không có ảnh hợp lệ' });

      // FIX 2026-06-12 (anh báo: album sai thứ tự): Prisma findMany với `in[]` KHÔNG giữ
      // thứ tự assetIds (Postgres trả theo thứ tự nội bộ DB). Zalo zca-js thì gán idInGroup
      // theo ĐÚNG thứ tự mảng truyền vào. → Phải sắp lại `assets` theo thứ tự body.assetIds
      // (= thứ tự sale tick chọn) để album hiển thị đúng ý sale.
      const byId = new Map(found.map((a) => [a.id, a]));
      const assets = body.assetIds.map((id) => byId.get(id)).filter((a): a is typeof found[number] => !!a);

      // Chọn variant đúng cho từng ảnh: watermark BẬT → bản có logo, ngược lại bản gốc.
      const pickBlob = (a: typeof assets[number]) => {
        const orig = a.blobs.find((b) => b.variantType === 'original');
        const wm = a.blobs.find((b) => b.variantType === 'watermarked');
        return (a.watermarkEnabled && wm) ? wm : orig;
      };

      const conversation = await prisma.conversation.findFirst({
        where: { id: body.conversationId, orgId: user.orgId }, include: { zaloAccount: true },
      });
      if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });
      // T7b (YC2): chặn gửi qua nick ĐÃ XÓA trước check kết nối.
      if (conversation.zaloAccount.archivedAt) {
        return reply.status(409).send({ error: 'Nick này đã bị xóa — chỉ xem lại lịch sử, không gửi được.', code: 'NICK_ARCHIVED' });
      }
      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api || instance.status !== 'connected') {
        return reply.status(400).send({ error: 'Nick Zalo chưa kết nối', code: 'NICK_NOT_CONNECTED' });
      }
      if (conversation.zaloAccount.privacyMode === 'main' && conversation.zaloAccount.ownerUserId !== userId) {
        return reply.status(403).send({ error: 'Nick Riêng tư — chỉ chính chủ gửi.', code: 'PRIVACY_LOCKED' });
      }
      const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
      if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const io = (app as any).io as Server;
      // (Bỏ placeholder album → không cần userFullName/createMediaMessage ở đây nữa.)

      // download tất cả ảnh về temp → gửi 1 lần (sendFile nhiều path).
      const tmps: Array<{ path: string; cleanup: () => Promise<void> }> = [];
      try {
        for (const a of assets) {
          const blob = pickBlob(a);
          if (!blob) continue;
          // KHÔNG truyền filename (name mất đuôi → file lạ). Để lấy đuôi .webp từ URL.
          const tmp = await downloadMediaToTemp({ url: blob.publicUrl }, 'image');
          tmps.push(tmp);
        }
        zaloRateLimiter.recordSend(conversation.zaloAccountId);
        // sendImage (KHÔNG sendFile) → album ảnh inline, không thành file.
        const sendResult: any = await zaloOps.sendImage(
          conversation.zaloAccountId, threadId, threadType as 0 | 1, tmps.map((t) => t.path), io, body.caption ?? '',
        );
        // FIX 2026-06-12 (anh chốt — bug album hiển thị 8+1 rời realtime):
        // KHÔNG tạo placeholder 1-dòng cho album. Placeholder cũ (albumKey=null) hiện RỜI
        // ngay sau gửi; echo Zalo (~1-2s) gom N-1 ảnh kia → "8 chung + 1 rời", F5 mới đủ.
        // Bỏ placeholder → echo Zalo về (mỗi ảnh có albumKey chung) tự hiện ĐỦ N ảnh 1 cụm,
        // KHÔNG bao giờ lệch. Tradeoff: sale chờ ~1-2s thấy album (chấp nhận được).
        // KHÔNG bumpUsage/log ở đây nữa — chuyển sang khi echo về (tránh đếm khi gửi lỗi).
        // Vẫn đếm usage NGAY vì gửi đã thành công (sendImage không throw):
        await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 } });
        for (const a of assets) {
          await bumpUsage(a.id);
          await logMediaUsage({
            orgId: user.orgId, mediaAssetId: a.id, eventType: 'sent_album',
            userId, conversationId: conversation.id, meta: { albumCount: assets.length },
          });
        }
        const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
        return { sent: assets.length, zaloMsgId, viaEcho: true };
      } catch (err: any) {
        logger.error('[media] album send error:', err);
        // Lỗi mạng tạm thời khi upload nhiều ảnh (đã retry 3 lần vẫn fail) → báo rõ cho sale.
        const raw = String(err?.message ?? '');
        const isNet = /fetch failed|other side closed|socket|econnreset|und_err/i.test(raw);
        return reply.status(isNet ? 503 : 500).send({
          error: isNet
            ? `Gửi album ${assets.length} ảnh bị gián đoạn mạng (Zalo đóng kết nối khi tải nhiều ảnh). Thử lại, hoặc gửi ít ảnh hơn mỗi lần.`
            : (raw || 'gửi album lỗi'),
          code: isNet ? 'ALBUM_NETWORK' : undefined,
        });
      } finally {
        for (const t of tmps) await t.cleanup().catch(() => {});
      }
    },
  );
}
