// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * clamav-client.ts — GĐ13b (2026-06-13): quét virus file upload bằng ClamAV (clamd INSTREAM).
 *
 * Giao thức clamd INSTREAM (TCP 3310, không cần thư viện ngoài — raw net.Socket):
 *   gửi "zINSTREAM\0" → từng chunk: <uint32 BE độ-dài><bytes> → kết "\0\0\0\0"
 *   nhận: "stream: OK\0"  hoặc  "stream: <Tên> FOUND\0"
 *
 * THIẾT KẾ AN TOÀN (CEO must-fix GĐ13b):
 *  - FAIL-OPEN mặc định: clamd chưa bật / lỗi / timeout → CHO upload qua (chỉ log warn),
 *    KHÔNG chặn người dùng vì hạ tầng AV trục trặc. Bật fail-closed bằng MEDIA_AV_FAIL_CLOSED=1.
 *  - Cờ MEDIA_AV_ENABLED: mặc định TẮT → scanBuffer trả 'skipped' ngay (không kết nối).
 *    → Deploy code này KHÔNG vỡ gì kể cả khi chưa thêm container clamav.
 *  - File > MAX_SCAN_BYTES (50MB): KHÔNG quét (clamd mặc định giới hạn 25-100MB, gửi to dễ
 *    timeout/đầy RAM) → trả 'unscanned' để caller LOG cảnh báo (không câm — CEO must-fix).
 *
 *   upload buffer ──► scanBuffer()
 *      │                  ├─ AV tắt ──────────► 'skipped'  (cho qua)
 *      │                  ├─ >50MB ───────────► 'unscanned'(cho qua + caller log warn)
 *      │                  ├─ clamd OK sạch ───► 'clean'    (cho qua)
 *      │                  ├─ clamd FOUND ─────► 'infected' (CHẶN 422)
 *      │                  └─ clamd lỗi/timeout ┐
 *      │                       fail-open(default)└► 'error' (cho qua + log)  / fail-closed → CHẶN
 */
import net from 'node:net';
import { logger } from '../utils/logger.js';

export type ScanResult =
  | { status: 'clean' }
  | { status: 'infected'; virus: string }
  | { status: 'skipped' }        // AV tắt
  | { status: 'unscanned'; reason: string } // file quá lớn — cho qua nhưng caller phải log
  | { status: 'error'; message: string };   // clamd lỗi/timeout — caller quyết theo fail policy

const MAX_SCAN_BYTES = 50 * 1024 * 1024; // >50MB: bỏ qua scan, đánh cờ unscanned
const SCAN_TIMEOUT_MS = 15000;
const CHUNK = 64 * 1024;

function avEnabled(): boolean { return process.env.MEDIA_AV_ENABLED === '1'; }
/** fail-closed (chặn khi AV lỗi) chỉ khi đặt rõ '1'. Mặc định fail-OPEN. */
export function avFailClosed(): boolean { return process.env.MEDIA_AV_FAIL_CLOSED === '1'; }

/**
 * Quét 1 buffer qua clamd INSTREAM. KHÔNG throw — luôn trả ScanResult để caller xử theo
 * fail policy. Caller (media-routes) chịu trách nhiệm CHẶN khi 'infected' (luôn) và khi
 * 'error' + fail-closed.
 */
export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  if (!avEnabled()) return { status: 'skipped' };
  if (buffer.length > MAX_SCAN_BYTES) {
    return { status: 'unscanned', reason: `file ${Math.round(buffer.length / 1048576)}MB > ${MAX_SCAN_BYTES / 1048576}MB` };
  }
  const host = process.env.CLAMAV_HOST || 'clamav';
  const port = parseInt(process.env.CLAMAV_PORT || '3310', 10);

  return new Promise<ScanResult>((resolve) => {
    const socket = new net.Socket();
    let replied = false;
    const chunks: Buffer[] = [];
    const done = (r: ScanResult) => { if (!replied) { replied = true; try { socket.destroy(); } catch { /* */ } resolve(r); } };

    socket.setTimeout(SCAN_TIMEOUT_MS);
    socket.on('timeout', () => done({ status: 'error', message: 'clamd timeout' }));
    socket.on('error', (e) => done({ status: 'error', message: (e as Error).message }));
    socket.on('data', (d: Buffer | string) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8');
      if (/\bOK\0?$/.test(reply.trim()) && !/FOUND/.test(reply)) return done({ status: 'clean' });
      const m = reply.match(/:\s*(.+?)\s+FOUND/);
      if (m) return done({ status: 'infected', virus: m[1] });
      return done({ status: 'error', message: `clamd reply lạ: ${reply.slice(0, 80)}` });
    });

    socket.connect(port, host, () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const slice = buffer.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(slice.length, 0);
        socket.write(len);
        socket.write(slice);
      }
      // kết thúc stream: chunk độ dài 0
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
  });
}

/**
 * Helper cho route: quét + quyết định CHẶN hay không (gom logic fail policy 1 chỗ, DRY).
 * Trả { blocked, reason } — caller chỉ cần: if (blocked) return 422.
 * Log audit đầy đủ (infected/unscanned/error) — KHÔNG câm.
 */
export async function scanOrPass(
  buffer: Buffer,
  ctx: { filename?: string; userId?: string },
): Promise<{ blocked: boolean; reason?: string; result: ScanResult }> {
  const result = await scanBuffer(buffer);
  const who = `user=${ctx.userId ?? '?'} file=${ctx.filename ?? '?'}`;
  switch (result.status) {
    case 'clean':
    case 'skipped':
      return { blocked: false, result };
    case 'infected':
      logger.warn(`[media][av] CHẶN file nhiễm virus ${result.virus} — ${who}`);
      return { blocked: true, reason: `Tệp nhiễm virus (${result.virus}) — không được tải lên.`, result };
    case 'unscanned':
      logger.warn(`[media][av] file KHÔNG quét (${result.reason}) — cho qua nhưng đánh cờ. ${who}`);
      return { blocked: false, result };
    case 'error':
      if (avFailClosed()) {
        logger.warn(`[media][av] clamd lỗi (${result.message}) + FAIL-CLOSED → CHẶN. ${who}`);
        return { blocked: true, reason: 'Hệ thống quét virus tạm lỗi — thử lại sau.', result };
      }
      logger.warn(`[media][av] clamd lỗi (${result.message}) + fail-open → cho qua. ${who}`);
      return { blocked: false, result };
  }
}
