// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * privacy-leak-guard.ts — Điểm kiểm soát tập trung CHỐNG TÁI PHẠM (2026-06-11, Đợt 3.1).
 *
 * KHÔNG tự sửa response (tránh vỡ UI nếu đoán sai field). Thay vào đó: hook onSend
 * QUÉT response của route có config.contentClass = 'content' | 'mixed', tìm DẤU HIỆU
 * lộ nội dung/PII của nick Riêng tư (privacyMode='main') mà CHƯA được redact, rồi GHI
 * CẢNH BÁO vào log. Đội kỹ thuật thấy cảnh báo → biết endpoint mới quên gọi redact.
 *
 * Heuristic (cố ý bảo thủ, ít false-positive):
 *   - Tìm trong payload object có { privacyMode: 'main', ownerUserId: X } (nick main)
 *     đi kèm trong CÙNG object cha có field content-bearing chưa blur:
 *       content / lastMessageContent / fullName / phone / aliasInNick / lastInboundPreview
 *     mà KHÔNG có cờ redacted=true.
 *   - Chỉ cảnh báo khi viewer KHÔNG phải org-admin (admin xem được là hợp lệ ở 1 số
 *     route; nhưng nick main thì kể cả admin cũng phải redact — nên vẫn cảnh báo, chỉ
 *     hạ mức nếu cần). Ở bản này: cảnh báo mọi viewer để bắt triệt để.
 *
 * Hiệu năng: chỉ quét route content/mixed (số ít), duyệt nông + cắt sớm; bỏ qua nếu
 * payload quá lớn (>2000 node) để không thành bottleneck.
 */
import type { FastifyInstance } from 'fastify';
import { logger } from '../../shared/utils/logger.js';

const BLUR = '▒';
const MAX_NODES = 2000;

// Field content-bearing: nếu CÒN giá trị thật (không phải blur/null) kèm nick main → nghi lộ.
const CONTENT_FIELDS = [
  'content',
  'originalContent',
  'lastMessageContent',
  'lastInboundPreview',
  'lastOutboundPreview',
  'aliasInNick',
  'fullName',
  'crmName',
];

function looksBlurred(v: unknown): boolean {
  return typeof v === 'string' && v.includes(BLUR);
}

/**
 * Quét 1 object: nếu nó (hoặc object con trực tiếp) mô tả nick main mà có field
 * content chưa blur + không cờ redacted → trả về field đầu tiên nghi lộ.
 */
function inspectNode(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  // Xác định node này "thuộc nick main" — qua privacyMode trực tiếp hoặc qua
  // zaloAccount.privacyMode (Friend/Conversation row).
  const pm = node.privacyMode ?? node.zaloAccount?.privacyMode;
  if (pm !== 'main') return null;
  if (node.redacted === true) return null; // đã đánh dấu redact → OK
  for (const f of CONTENT_FIELDS) {
    const val = node[f];
    if (val != null && val !== '' && !looksBlurred(val)) {
      return f;
    }
  }
  return null;
}

/** Duyệt nông (BFS, cắt sớm) tìm node nghi lộ. */
function scanPayload(payload: any): { field: string; sample: string } | null {
  let count = 0;
  const queue: any[] = [payload];
  while (queue.length && count < MAX_NODES) {
    const cur = queue.shift();
    count++;
    if (Array.isArray(cur)) {
      for (const item of cur) if (item && typeof item === 'object') queue.push(item);
      continue;
    }
    if (cur && typeof cur === 'object') {
      const hit = inspectNode(cur);
      if (hit) {
        const raw = String(cur[hit] ?? '');
        return { field: hit, sample: raw.slice(0, 20) };
      }
      for (const k of Object.keys(cur)) {
        const v = (cur as any)[k];
        if (v && typeof v === 'object') queue.push(v);
      }
    }
  }
  return null;
}

/**
 * Đăng ký hook onSend giám sát rò rỉ privacy. Gọi 1 lần khi build app, SAU khi
 * các route đã đăng ký (Fastify áp hook cho mọi route đăng ký sau).
 * Đặt ở app.ts trước khi register routes (hook onSend áp toàn cục).
 */
export function registerPrivacyLeakGuard(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    try {
      // Lấy route config (chứa contentClass annotation). Fastify expose qua
      // request.routeOptions.config (v4+); fallback các vị trí cũ để an toàn version.
      const cfg =
        (request as any).routeOptions?.config ??
        (reply as any).routeOptions?.config ??
        (request as any).context?.config;
      const contentClass = cfg?.contentClass;
      if (contentClass !== 'content' && contentClass !== 'mixed') return payload;

      // payload có thể là string JSON (Fastify serialize trước onSend) hoặc object.
      let obj: any = null;
      if (typeof payload === 'string' && payload.length > 1 && payload.length < 2_000_000) {
        if (payload[0] !== '{' && payload[0] !== '[') return payload;
        try { obj = JSON.parse(payload); } catch { return payload; }
      } else if (payload && typeof payload === 'object') {
        obj = payload;
      } else {
        return payload;
      }

      const leak = scanPayload(obj);
      if (leak) {
        const user = (request as any).user;
        logger.warn(
          `[privacy-leak-guard] NGHI LỘ nick Riêng tư chưa redact: route=${request.method} ${request.url} ` +
          `field=${leak.field} sample="${leak.sample}..." viewer=${user?.id ?? '?'} ` +
          `→ endpoint này có thể quên gọi redact (contentClass=${contentClass}).`,
        );
      }
    } catch (err) {
      // Guard KHÔNG được làm hỏng response — nuốt mọi lỗi.
      logger.debug('[privacy-leak-guard] scan error (bỏ qua):', err);
    }
    return payload;
  });
}
