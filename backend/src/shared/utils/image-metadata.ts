// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Minimal image metadata reader — parse width/height from common formats
 * (PNG, JPEG, GIF, WebP, BMP) by reading first ~30 bytes.
 *
 * Tránh dùng dependency npm (image-size, sharp) — chỉ cần dimensions cho
 * Zalo upload `imageMetadataGetter` callback.
 */
import * as fs from 'node:fs/promises';

export interface ImageMetadata {
  width: number;
  height: number;
  size: number;
}

/** Đọc kích thước ảnh từ file → {width, height, size}. Trả null nếu không parse được. */
export async function readImageMetadata(filePath: string): Promise<ImageMetadata | null> {
  try {
    const stat = await fs.stat(filePath);
    const size = stat.size;
    if (size < 16) return null;

    // Đọc 64 bytes đầu — đủ để parse mọi header
    const fd = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(64);
    await fd.read(buf, 0, 64, 0);
    await fd.close();

    const dims = parseDimensions(buf);
    if (!dims) return { width: 0, height: 0, size }; // fallback dimensions
    return { width: dims.width, height: dims.height, size };
  } catch {
    return null;
  }
}

function parseDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG: signature 89 50 4E 47 0D 0A 1A 0A, then IHDR at offset 16-23
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF: "GIF87a" or "GIF89a", width LE at 6, height LE at 8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // BMP: "BM" magic, width LE at 18 (DWORD), height LE at 22
  if (buf[0] === 0x42 && buf[1] === 0x4D) {
    return { width: buf.readUInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  }

  // WebP: "RIFF" + 4 bytes size + "WEBP"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    // VP8 = "VP8 ", VP8L = "VP8L", VP8X = "VP8X"
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      // Extended: width-1 (3 bytes LE) at 24, height-1 (3 bytes LE) at 27
      const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
      const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
      return { width: w, height: h };
    }
    if (chunk === 'VP8 ') {
      // Lossy: width/height tại offset 26-29 (2 bytes LE each, mask 0x3FFF)
      const w = buf.readUInt16LE(26) & 0x3FFF;
      const h = buf.readUInt16LE(28) & 0x3FFF;
      return { width: w, height: h };
    }
    if (chunk === 'VP8L') {
      // Lossless: bit-packed; w = (b21 | b22<<8) & 0x3FFF + 1, etc.
      const b1 = buf.readUInt32LE(21);
      const w = (b1 & 0x3FFF) + 1;
      const h = ((b1 >> 14) & 0x3FFF) + 1;
      return { width: w, height: h };
    }
  }

  // JPEG: starts with FF D8. Cần đọc thêm — không thể chỉ với 64 bytes đầu.
  // Để đơn giản: trả 0×0 — Zalo SDK chấp nhận size=0 dimensions.
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    return { width: 0, height: 0 };
  }

  return null;
}

/** Đọc full file để parse JPEG dimensions (slower path). */
export async function readJpegDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const data = await fs.readFile(filePath);
    let i = 2; // skip SOI marker FF D8
    while (i < data.length) {
      // Find next marker
      if (data[i] !== 0xFF) return null;
      const marker = data[i + 1];
      // SOF markers: C0-C3, C5-C7, C9-CB, CD-CF
      if ((marker >= 0xC0 && marker <= 0xC3) ||
          (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) ||
          (marker >= 0xCD && marker <= 0xCF)) {
        // SOF: length(2) + precision(1) + height(2 BE) + width(2 BE)
        const height = data.readUInt16BE(i + 5);
        const width = data.readUInt16BE(i + 7);
        return { width, height };
      }
      // Skip this segment
      const segLen = data.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
    return null;
  } catch {
    return null;
  }
}

/** Combined getter — tự gọi JPEG slow-path khi cần. */
export async function imageMetadataGetter(filePath: string): Promise<ImageMetadata | null> {
  const meta = await readImageMetadata(filePath);
  if (!meta) return null;
  if (meta.width === 0 && meta.height === 0) {
    // Likely JPEG — try slow path
    const jpeg = await readJpegDimensions(filePath);
    if (jpeg) return { width: jpeg.width, height: jpeg.height, size: meta.size };
  }
  return meta;
}
