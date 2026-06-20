// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * minio-client.ts — MinIO/S3 storage client for chat attachments.
 * Uploads return a public URL suitable for zca-js sendImage/sendVideo.
 *
 * Phase Media Library 2026-06-11 — content-hash dedup (eng review E1):
 *   uploadBuffer giờ key theo sha256 BYTES THẬT (media/{hash}{ext}).
 *   statObject → nếu object đã tồn tại thì SKIP putObject, trả URL bản cũ.
 *   → 1 ảnh gửi N lần = 1 object duy nhất. Storage layer KHÔNG biết Prisma;
 *   việc upsert MediaAsset/MediaBlob nằm ở tầng service (MediaService).
 */
import { Client } from 'minio';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { config } from '../../config/index.js';

function parseEndpoint(url: string): { endPoint: string; port: number; useSSL: boolean } {
  const u = new URL(url);
  const useSSL = u.protocol === 'https:';
  const port = u.port ? parseInt(u.port) : (useSSL ? 443 : 80);
  return { endPoint: u.hostname, port, useSSL };
}

const { endPoint, port, useSSL } = parseEndpoint(config.s3Endpoint);

export const minioClient = new Client({
  endPoint,
  port,
  useSSL,
  accessKey: config.s3AccessKey,
  secretKey: config.s3SecretKey,
  region: config.s3Region,
});

const BUCKET = config.s3Bucket;

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  mimeType: string;
  /** sha256 (hex) của bytes thật lưu — khóa dedup ở tầng service. */
  contentHash: string;
  /** true nếu object đã tồn tại (đã skip putObject — không tốn thêm ô lưu trữ). */
  deduped: boolean;
}

/**
 * Upload buffer lên MinIO với CONTENT-HASH DEDUP.
 * Key = `media/{sha256}{ext}`. Nếu object đã tồn tại (statObject OK) → skip
 * putObject và trả URL bản cũ (deduped=true). Cùng bytes upload N lần = 1 object.
 *
 * KHÔNG đụng Prisma. Caller (MediaService) lo upsert MediaAsset/MediaBlob theo
 * contentHash trả về.
 */
export async function uploadBuffer(buffer: Buffer, mimeType: string, originalName?: string): Promise<UploadResult> {
  // 2026-06-11: từ chối buffer rỗng — tránh tạo object MinIO 0-byte (ảnh/sticker hỏng).
  if (!buffer || buffer.length === 0) throw new Error('uploadBuffer: empty buffer (refusing 0-byte object)');
  const ext = originalName ? extname(originalName) : mimeToExt(mimeType);
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const key = `media/${contentHash}${ext}`;
  const url = `${config.s3PublicUrl}/${BUCKET}/${key}`;

  // Dedup: object đã tồn tại? → skip upload, trả bản cũ.
  const exists = await minioClient.statObject(BUCKET, key).then(() => true).catch(() => false);
  if (exists) {
    return { key, url, size: buffer.length, mimeType, contentHash, deduped: true };
  }

  await minioClient.putObject(BUCKET, key, buffer, buffer.length, {
    'Content-Type': mimeType,
    'Cache-Control': 'public, max-age=31536000',
  });
  return { key, url, size: buffer.length, mimeType, contentHash, deduped: false };
}

function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'video/quicktime') return '.mov';
  if (mime === 'video/webm') return '.webm';
  return '';
}

export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(BUCKET, config.s3Region);
  }
}

/**
 * 2026-06-13: kiểm key an toàn để proxy-download — chấp nhận MỌI object THUỘC BUCKET của mình
 * (cả `media/{hash}.ext` từ Kho LẪN `YYYY-MM-DD/{uuid}.ext` từ chat thường / mirror inbound).
 * 2026-06-13 (vá sau): TRƯỚC chỉ nhận prefix `media/` → file gửi qua chat thường (key theo ngày)
 * bị cổng tải trả 404 dù file CÒN SỐNG trong MinIO (đo thực tế: 1.424 file dính). Nới: nhận key bất
 * kỳ trong bucket, CHỈ chặn rỗng / path-traversal (`..`) / key tuyệt đối (`/` đầu). URL ngoài bucket
 * (vd Zalo CDN dlfl.vn) tự loại ở keyFromPublicUrl (không khớp marker /BUCKET/ → trả '').
 */
function isSafeObjectKey(key: string): boolean {
  return !!key && !key.startsWith('/') && !key.includes('..') && !key.includes('\0');
}

/**
 * 2026-06-13: lấy 1 object trong bucket dưới dạng stream để CRM proxy-download (gắn tên file thật
 * qua Content-Disposition). Trả null nếu key không an toàn / không tồn tại.
 */
export async function getObjectStream(key: string): Promise<NodeJS.ReadableStream | null> {
  if (!isSafeObjectKey(key)) return null;
  try {
    await minioClient.statObject(BUCKET, key); // tồn tại?
    return await minioClient.getObject(BUCKET, key);
  } catch {
    return null;
  }
}

/**
 * 2026-06-13: đọc TOÀN BỘ object thành Buffer (cho proxy-download). Dùng thay vì pipe stream
 * thẳng vào Fastify reply — pipe MinIO-stream → reply ĐÔI KHI TREO (socket hang up, đã gặp).
 * File kho nhỏ (vài MB) nên buffer an toàn. Trả null nếu key sai prefix / không tồn tại.
 */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const stream = await getObjectStream(key);
  if (!stream) return null;
  try {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** Trích object key (media/{hash}.ext) từ public URL kho. Trả '' nếu URL không thuộc bucket. */
export function keyFromPublicUrl(url: string): string {
  if (!url) return '';
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return '';
  try { return decodeURIComponent(url.slice(i + marker.length).split('?')[0]); } catch { return ''; }
}
