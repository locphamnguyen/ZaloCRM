/**
 * media-service.ts — Phase Media Library 2026-06-11.
 *
 * Tầng SERVICE của kho phương tiện. Biết Prisma + orgId; gọi xuống storage
 * (uploadBuffer đã dedup theo sha256) rồi upsert MediaAsset/MediaBlob.
 *
 * Kiến trúc 2 tầng (eng review E2):
 *   storage (minio-client) → trả {contentHash, deduped, url, ...}  ← KHÔNG biết DB
 *   service (file này)     → upsert MediaAsset (danh tính) + MediaBlob (variant)
 *
 * COUPLING bắt buộc (eng review D9): kể cả khi storage dedup-hit (deduped=true),
 * service VẪN upsert MediaBlob theo [orgId,contentHash] + tăng usageCount asset,
 * nếu không các lần dedup-hit (đặc biệt mirror tin khách) sẽ không vào catalog.
 *
 * Xử lý lỗi (eng review D10):
 *   • P2002 (2 sale upload cùng bytes đồng thời) → coi như dedup-hit, đọc lại bản có sẵn.
 *   • sharp lỗi (ảnh hỏng/format lạ) → fallback lưu ảnh GỐC + log warn (compressImage).
 */
import sharp from 'sharp';
import { imageSize } from 'image-size';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { prisma } from '../../shared/database/prisma-client.js';
import { uploadBuffer } from '../../shared/storage/minio-client.js';
import { candidateDownloadUrls } from '../chat/chat-media-helpers.js';
import { logger } from '../../shared/utils/logger.js';
import type { MediaAsset, MediaBlob } from '@prisma/client';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
// Ngưỡng nén: cạnh dài tối đa + chất lượng webp. Ảnh bảng giá/mặt bằng giữ rõ chữ.
const MAX_EDGE = 2000;
const WEBP_QUALITY = 82;
// GIF (ảnh động) KHÔNG nén qua sharp (mất animation) — giữ nguyên.
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type MediaKind = 'image' | 'video' | 'file';
export type MediaSource = 'upload' | 'saved_from_chat';

export interface RegisterAssetInput {
  orgId: string;
  buffer: Buffer;
  mimeType: string;
  /** Phân loại để route nén/thumbnail. */
  kind: MediaKind;
  /** Tên hiển thị trong kho (mặc định = originalFilename). */
  name?: string;
  originalFilename?: string;
  ownerUserId?: string | null;
  createdById?: string | null;
  /** 'private' (mặc định, fail-closed) | 'public'. */
  visibility?: 'private' | 'public';
  source?: MediaSource;
  /** Nếu lưu từ chat của nick Riêng tư → nick nguồn (enforce redact privacy). */
  sourceZaloAccountId?: string | null;
  tagIds?: string[];
  folderId?: string | null;
}

export interface RegisterAssetResult {
  asset: MediaAsset;
  blob: MediaBlob;
  /** true nếu bytes đã tồn tại từ trước (không tốn thêm ô lưu trữ MinIO). */
  deduped: boolean;
}

/**
 * Nén ảnh (sharp): resize cạnh dài về MAX_EDGE, encode webp chất lượng cao.
 * D10(2): sharp lỗi (ảnh hỏng/format lạ) → fallback trả buffer GỐC + log warn.
 * GIF/video/file → trả nguyên bytes (không nén qua sharp).
 *
 * @returns { buffer, mimeType, width?, height?, compressed }
 */
export async function compressImage(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string; width?: number; height?: number; compressed: boolean }> {
  if (!COMPRESSIBLE.has(mimeType)) {
    // GIF / non-image → giữ nguyên, chỉ đọc kích thước nếu là ảnh.
    let w: number | undefined;
    let h: number | undefined;
    if (IMAGE_MIMES.has(mimeType)) {
      try {
        const dim = imageSize(buffer);
        w = dim.width;
        h = dim.height;
      } catch { /* ảnh không đọc được dimension — bỏ qua */ }
    }
    return { buffer, mimeType, width: w, height: h, compressed: false };
  }
  try {
    const img = sharp(buffer, { failOn: 'error' });
    const meta = await img.metadata();
    const needResize = (meta.width ?? 0) > MAX_EDGE || (meta.height ?? 0) > MAX_EDGE;
    let pipeline = img.rotate(); // tôn trọng EXIF orientation
    if (needResize) {
      pipeline = pipeline.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true });
    }
    const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
    return {
      buffer: out.data,
      mimeType: 'image/webp',
      width: out.info.width,
      height: out.info.height,
      compressed: true,
    };
  } catch (err) {
    // D10(2): không để mất ảnh — fallback bản gốc.
    logger.warn('[media] compressImage failed, fallback to original:', (err as Error)?.message ?? err);
    return { buffer, mimeType, compressed: false };
  }
}

/**
 * Đăng ký 1 media vào kho: nén (nếu ảnh) → upload dedup → upsert Asset+Blob.
 *
 * Dedup ở 2 tầng:
 *   1. Storage: uploadBuffer skip putObject nếu object đã tồn tại (deduped).
 *   2. DB: upsert MediaBlob theo [orgId,contentHash]; nếu trùng → đọc lại,
 *      tăng usageCount của asset đang trỏ tới (KHÔNG tạo asset mới).
 */
export async function registerAsset(input: RegisterAssetInput): Promise<RegisterAssetResult> {
  const {
    orgId,
    mimeType,
    kind,
    ownerUserId = null,
    createdById = null,
    visibility = 'private',
    source = 'upload',
    sourceZaloAccountId = null,
    tagIds = [],
    folderId = null,
  } = input;

  // 1. Nén (chỉ ảnh) — variant 'original' đã-nén là bytes thật lưu.
  const processed = kind === 'image'
    ? await compressImage(input.buffer, mimeType)
    : { buffer: input.buffer, mimeType, width: undefined, height: undefined, compressed: false };

  const originalFilename = input.originalFilename ?? null;
  const name = input.name ?? originalFilename ?? 'Media';

  // 2. Upload dedup → contentHash của bytes THẬT LƯU.
  const up = await uploadBuffer(processed.buffer, processed.mimeType, originalFilename ?? undefined);

  // 3. Đã có blob với contentHash này trong org? → dedup-hit ở tầng DB.
  const existingBlob = await prisma.mediaBlob.findUnique({
    where: { orgId_contentHash: { orgId, contentHash: up.contentHash } },
    include: { asset: true },
  });
  if (existingBlob) {
    // S8 observability: log dedup-hit (đo tiết kiệm thật — bao nhiêu ô lưu trữ né được).
    logger.info(`[media][dedup] hit org=${orgId} hash=${up.contentHash.slice(0, 12)} reusedAsset=${existingBlob.assetId} source=${source}`);
    // Tăng lượt dùng asset đang sở hữu blob này (catalog vẫn cập nhật khi dedup-hit).
    const asset = await prisma.mediaAsset.update({
      where: { id: existingBlob.assetId },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return { asset, blob: existingBlob, deduped: true };
  }
  // S8: log MISS (bytes mới hoàn toàn) — để tính hit-rate = hit/(hit+miss).
  logger.info(`[media][dedup] miss org=${orgId} hash=${up.contentHash.slice(0, 12)} source=${source}`);

  // 4. Tạo Asset (danh tính) + Blob (variant original) trong 1 transaction.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          orgId,
          kind,
          name,
          ownerUserId,
          createdById,
          visibility,
          source,
          sourceZaloAccountId,
          folderId,
          tagIds,
          originalFilename,
        },
      });
      const blob = await tx.mediaBlob.create({
        data: {
          orgId,
          assetId: asset.id,
          contentHash: up.contentHash,
          variantType: 'original',
          minioKey: up.key,
          publicUrl: up.url,
          mimeType: up.mimeType,
          sizeBytes: up.size,
          width: processed.width ?? null,
          height: processed.height ?? null,
        },
      });
      return { asset, blob };
    });
    return { ...result, deduped: up.deduped };
  } catch (err) {
    // D10(1): 2 sale upload cùng bytes đồng thời → 1 ăn P2002 trên [orgId,contentHash].
    // Coi như dedup-hit: đọc lại blob bản kia + tăng usageCount, KHÔNG báo lỗi 500.
    if ((err as { code?: string }).code === 'P2002') {
      const blob = await prisma.mediaBlob.findUnique({
        where: { orgId_contentHash: { orgId, contentHash: up.contentHash } },
        include: { asset: true },
      });
      if (blob) {
        const asset = await prisma.mediaAsset.update({
          where: { id: blob.assetId },
          data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
        });
        return { asset, blob, deduped: true };
      }
    }
    throw err;
  }
}

/**
 * Quyết định visibility + có chặn không khi "Lưu vào Media" từ chat (privacy guard).
 * Hàm THUẦN (không DB) để test được rule bảo mật — khu vực đã từng lộ.
 *
 * Rule (eng review D11 + checklist điều 4):
 *  • Nick Riêng tư (privacyMode='main'):
 *      - viewer KHÔNG phải chủ nick → CHẶN (blocked=true).
 *      - viewer là chủ nick → cho lưu nhưng LUÔN private (kể cả xin public).
 *  • Nick Thường (sub/khác): theo lựa chọn của sale (requested ?? 'private').
 */
export function resolveSavedVisibility(args: {
  nickPrivacyMode: string | null | undefined;
  nickOwnerUserId: string | null | undefined;
  viewerUserId: string;
  requested?: 'private' | 'public';
}): { blocked: boolean; visibility: 'private' | 'public'; forcedPrivate: boolean } {
  const isPrivateNick = args.nickPrivacyMode === 'main';
  if (isPrivateNick) {
    if (args.nickOwnerUserId !== args.viewerUserId) {
      return { blocked: true, visibility: 'private', forcedPrivate: true };
    }
    // chủ nick lưu được nhưng ép private (không cho public lộ PII khách).
    return { blocked: false, visibility: 'private', forcedPrivate: true };
  }
  return { blocked: false, visibility: args.requested ?? 'private', forcedPrivate: false };
}

/**
 * Tăng lượt dùng khi 1 asset được gửi đi (chèn vào chat / album).
 */
export async function bumpUsage(assetId: string): Promise<void> {
  await prisma.mediaAsset
    .update({ where: { id: assetId }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } })
    .catch(() => { /* asset đã archive/xóa — bỏ qua */ });
}

export type MediaUsageEventType =
  | 'sent_chat' | 'sent_album' | 'broadcast' | 'saved_from_chat' | 'made_public';

/**
 * Ghi 1 sự kiện dùng media (S8 observability + tách event type usageCount).
 * KHÔNG throw — log lỗi là phụ trợ, không được làm hỏng luồng gửi/lưu chính.
 */
export async function logMediaUsage(args: {
  orgId: string;
  mediaAssetId: string;
  eventType: MediaUsageEventType;
  userId?: string | null;
  conversationId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.mediaUsageEvent.create({
      data: {
        orgId: args.orgId,
        mediaAssetId: args.mediaAssetId,
        eventType: args.eventType,
        userId: args.userId ?? null,
        conversationId: args.conversationId ?? null,
        meta: (args.meta ?? undefined) as any,
      },
    });
  } catch (err) {
    logger.warn('[media] logMediaUsage failed:', (err as Error)?.message ?? err);
  }
}

// ── Watermark (GĐ2) — sinh blob variant 'watermarked' từ blob gốc ─────────────
// Logo HS đặt ở static/brand. Cache buffer 1 lần (không đọc đĩa mỗi lần watermark).
let _logoCache: Buffer | null = null;
async function loadLogo(): Promise<Buffer> {
  if (_logoCache) return _logoCache;
  const logoPath = resolvePath(process.cwd(), 'static', 'brand', 'zalocrm-logo-ngang.png');
  _logoCache = await readFile(logoPath);
  return _logoCache;
}

/**
 * Tạo bản WATERMARK của 1 asset (eng review E2/D13: watermark = blob variant MỚI).
 * Lấy blob 'original' → composite logo HS góc dưới-phải → upload (dedup theo hash)
 * → tạo MediaBlob variantType='watermarked'. Bản gốc giữ nguyên.
 *
 * @returns blob watermark (mới hoặc đã có nếu trùng hash).
 * @throws nếu asset không phải ảnh / không có blob gốc.
 */
export async function generateWatermarkVariant(args: {
  orgId: string;
  assetId: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
  opacity?: number; // 0..1, mặc định 0.65
}): Promise<{ blobId: string; url: string; deduped: boolean }> {
  const position = args.position ?? 'bottom-right';
  const opacityIn = Math.min(1, Math.max(0.1, args.opacity ?? 0.65));
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: args.assetId, orgId: args.orgId },
    include: { blobs: true },
  });
  if (!asset) throw new Error('Asset không tồn tại');
  if (asset.kind !== 'image') throw new Error('Chỉ ảnh mới đóng được watermark');

  // BẬT/đổi góc-độ-mờ: nếu đã có variant watermark cũ → XÓA để sinh lại theo cấu hình mới.
  // (Trước đây trả luôn bản cũ → đổi góc/opacity không có tác dụng — đã sửa 2026-06-12.)
  const existed = asset.blobs.find((b) => b.variantType === 'watermarked');
  if (existed) {
    await prisma.mediaBlob.delete({ where: { id: existed.id } }).catch(() => { /* đã xóa */ });
  }

  const original = asset.blobs.find((b) => b.variantType === 'original');
  if (!original) throw new Error('Asset chưa có dữ liệu gốc');

  // Tải bytes gốc về — thử URL public rồi fallback host nội bộ s3Endpoint
  // (từ trong container, URL public có thể không resolve được — như forward media).
  let srcBuf: Buffer | null = null;
  for (const u of candidateDownloadUrls(original.publicUrl)) {
    try {
      const resp = await fetch(u, { signal: AbortSignal.timeout(30_000) });
      if (resp.ok) { srcBuf = Buffer.from(await resp.arrayBuffer()); break; }
    } catch { /* thử URL kế */ }
  }
  if (!srcBuf) throw new Error('Không tải được ảnh gốc để đóng watermark');
  const logo = await loadLogo();

  const base = sharp(srcBuf);
  const meta = await base.metadata();
  const bw = meta.width ?? 800;
  // Logo rộng ~22% ảnh, mờ theo opacity (tô lớp alpha đè để giảm độ đậm).
  const logoW = Math.max(80, Math.round(bw * 0.22));
  const opacity = opacityIn;
  // resize logo rồi nhân alpha bằng 1 lớp đen trong suốt qua composite 'dest-in'.
  const resized = await sharp(logo).resize(logoW).ensureAlpha().png().toBuffer();
  const dims = await sharp(resized).metadata();
  const alphaMask = await sharp({
    create: {
      width: dims.width ?? logoW,
      height: dims.height ?? logoW,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: opacity },
    },
  }).png().toBuffer();
  const logoResized = await sharp(resized)
    .composite([{ input: alphaMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const gravity = {
    'bottom-right': 'southeast', 'bottom-left': 'southwest',
    'top-right': 'northeast', 'top-left': 'northwest', 'center': 'center',
  }[position] as string;

  const out = await base
    .composite([{ input: logoResized, gravity }])
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  const up = await uploadBuffer(out.data, 'image/webp', `${asset.name}-wm.webp`);
  const blob = await prisma.mediaBlob.create({
    data: {
      orgId: args.orgId,
      assetId: asset.id,
      contentHash: up.contentHash,
      variantType: 'watermarked',
      minioKey: up.key,
      publicUrl: up.url,
      mimeType: up.mimeType,
      sizeBytes: up.size,
      width: out.info.width,
      height: out.info.height,
    },
  }).catch(async (err) => {
    // P2002: hash trùng blob khác (cực hiếm) → đọc lại.
    if ((err as { code?: string }).code === 'P2002') {
      const b = await prisma.mediaBlob.findUnique({ where: { orgId_contentHash: { orgId: args.orgId, contentHash: up.contentHash } } });
      if (b) return b;
    }
    throw err;
  });
  // Lưu cấu hình watermark per-ảnh → BẬT (gửi đi dùng bản watermark) + nhớ góc/độ mờ.
  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { watermarkEnabled: true, watermarkPosition: position, watermarkOpacity: opacityIn },
  }).catch(() => { /* asset đã archive — bỏ qua */ });
  return { blobId: blob.id, url: blob.publicUrl, deduped: up.deduped };
}

/**
 * TẮT watermark per-ảnh: gỡ blob 'watermarked' + đặt watermarkEnabled=false.
 * Bản gốc luôn giữ. Gửi đi sau đó dùng lại bản gốc.
 */
export async function disableWatermark(orgId: string, assetId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, orgId }, include: { blobs: { where: { variantType: 'watermarked' } } },
  });
  if (!asset) throw new Error('Asset không tồn tại');
  for (const b of asset.blobs) {
    await prisma.mediaBlob.delete({ where: { id: b.id } }).catch(() => { /* đã xóa */ });
  }
  await prisma.mediaAsset.update({ where: { id: assetId }, data: { watermarkEnabled: false } });
}
