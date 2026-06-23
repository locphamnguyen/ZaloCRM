// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// use-rich-format.ts — render text + Zalo style marks ({st,start,len}) → HTML.
// 2026-06-07 — tách từ special-message-renderer.vue để BlockPreviewDialog (xem trước Khối)
// dùng CHUNG logic render rich-text (đậm/nghiêng/gạch/màu/cỡ) giống bubble chat thật.
// Trước đây preview chỉ in {{ text }} (escaped) → mất format. Giờ dùng applyRichFormat.

export interface StyleMark { st: string; start: number; len: number }
export interface MentionMark { pos?: number; start?: number; len: number; uid?: string; user_name?: string }

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Zalo TextStyle enum mapping:
//   b / i / u / s = bold/italic/underline/strikethrough
//   c_RRGGBB      = color · f_NN / s_NN = font size · lst_1/lst_2 = bullet/numbered
function openTagFor(st: string): string {
  if (st === 'b') return '<strong>';
  if (st === 'i') return '<em>';
  if (st === 'u') return '<u>';
  if (st === 's') return '<s>';
  if (st.startsWith('c_')) return `<span style="color:#${st.slice(2)}">`;
  if (st.startsWith('f_')) return `<span style="font-size:${st.slice(2)}px">`;
  if (st.startsWith('s_')) return `<span style="font-size:${st.slice(2)}px">`;
  return '';
}
function closeTagFor(st: string): string {
  if (st === 'b') return '</strong>';
  if (st === 'i') return '</em>';
  if (st === 'u') return '</u>';
  if (st === 's') return '</s>';
  if (st.startsWith('c_') || st.startsWith('f_') || st.startsWith('s_')) return '</span>';
  return '';
}

/**
 * Apply style marks to plain text → escaped HTML with bold/italic/color spans.
 * Walks text char-by-char, opens/closes tags at style boundaries. \n → <br>.
 */
export function applyRichFormat(text: string, sList: StyleMark[], mList: MentionMark[] = []): string {
  if (!text) return '';

  const len = text.length;
  const activePerChar: string[][] = Array.from({ length: len }, () => []);
  for (const m of sList) {
    const start = Math.max(0, m.start | 0);
    const end = Math.min(len, start + (m.len | 0));
    for (let i = start; i < end; i++) activePerChar[i].push(m.st);
  }
  const mentionRanges: Set<number>[] = mList.map((m) => {
    const start = Math.max(0, (m.pos ?? m.start ?? 0) | 0);
    const end = Math.min(len, start + (m.len | 0));
    const set = new Set<number>();
    for (let i = start; i < end; i++) set.add(i);
    return set;
  });
  const isMentionStart = (i: number) => mentionRanges.some((s) => s.has(i) && !s.has(i - 1));
  const isMentionEnd = (i: number) => mentionRanges.some((s) => s.has(i) && !s.has(i + 1));

  let out = '';
  let prevKey = '';
  const emitOpen = (keys: string[]) => keys.map(openTagFor).filter(Boolean).join('');
  const emitClose = (keys: string[]) => [...keys].reverse().map(closeTagFor).filter(Boolean).join('');

  let prevList: string[] = [];
  for (let i = 0; i < len; i++) {
    const cur = activePerChar[i].slice().sort();
    const curKey = cur.join(',');
    if (curKey !== prevKey) {
      out += emitClose(prevList);
      out += emitOpen(cur);
      prevList = cur;
      prevKey = curKey;
    }
    if (isMentionStart(i)) out += '<span class="mention">';
    const ch = text[i];
    if (ch === '\n') out += '<br>';
    else if (ch === '\r') { /* ignore */ }
    else out += escapeHtml(ch);
    if (isMentionEnd(i)) out += '</span>';
  }
  out += emitClose(prevList);
  return out;
}

/** Fallback: format raw text without style marks — escape + linebreak (no mention regex). */
export function plainFormat(text: string): string {
  if (!text) return '';
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-link URL + SĐT (2026-06-22 — anh báo UI chat: link/SĐT trong tin không bấm được)
// ───────────────────────────────────────────────────────────────────────────
// linkifyHtml chạy SAU khi style/mention tag đã chèn (trên chuỗi HTML đã render).
// Tách HTML thành [tag] và [text], CHỈ xử lý đoạn text → không phá tag, không match
// nhầm trong attribute. URL → <a class="link">; SĐT VN → <span class="phone-link">
// (click wiring ở message-bubble / special-message-renderer → tra Zalo qua nick hội thoại).
//
// SĐT: khớp dạng LIỀN-SỐ (vd "84936668266", "0936668266", "+84936668266") — dạng phổ
// biến trong tin hệ thống + copy-paste. Lookbehind (?<![\d.]) + lookahead (?![\d]) chặn
// khớp giữa số dài (UID Zalo 19 số, mã đơn…). Bỏ qua dạng có dấu cách "0904 808 000" để
// tránh gộp nhầm 2 số liền nhau (hiếm gặp trong tin hệ thống).
// 1 lượt regex, 3 nhánh (URL ưu tiên đầu để "nuốt" trọn link → số trong link không bị tách):
//   g1 = URL
//   g2 = SĐT VN CÓ DẤU PHÂN CÁCH (chấm/cách/gạch) — vd 0964.96.96.81 / 0938 821 425 / 090-368...
//        2026-06-23: quét log prod thấy ~46% SĐT sale gõ có dấu (nhất là dấu CHẤM) → trước
//        đây trượt hết. Nhóm 2-7 số, tối đa 5 nhóm → KHÔNG nuốt số lẻ của số kế bên.
//   g3 = SĐT VN SỐ LIỀN (vd 84936668266 / 0911234999) — chặn đuôi -\d để khỏi bắt nhầm MST.
// Mọi nhánh SĐT đều qua normalizePhoneVN (strip dấu + chuẩn 84xxx) nên tự loại ngày/giá/giờ/
// version/MST (prefix+độ dài sai → null → giữ nguyên text). Verify log prod: 98.5% SĐT, 0 false-positive.
const LINKIFY_RE = /(https?:\/\/[^\s<]+)|((?<![\d.])(?:\+?84|0)[.\-\s]?\d{1,4}(?:[.\-\s]\d{2,7}){1,5}(?![\d]))|((?<![\d.])(?:\+?84|0)\d{9,10}(?!\d)(?!-\d))/g;

/** Chuẩn hoá SĐT VN → "84xxxxxxxxx" (khớp BE find-by-phone). Strip mọi ký tự không phải số
 *  (dấu cách/chấm/gạch/+) rồi kiểm prefix+độ dài. null nếu không hợp lệ. */
function normalizePhoneVN(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('840')) d = '84' + d.slice(3);
  else if (d.startsWith('0')) d = '84' + d.slice(1);
  return /^84\d{9,10}$/.test(d) ? d : null;
}

/** Wrap URL + SĐT trong 1 đoạn text (đã escape). */
function linkifyTextChunk(text: string): string {
  return text.replace(LINKIFY_RE, (m: string, url?: string, phoneSep?: string, phoneRun?: string) => {
    if (url) {
      // Tách dấu câu cuối (. , ) ] …) ra khỏi URL để không dính vào href.
      const trail = (url.match(/[.,;:!?)\]]+$/) || [''])[0];
      const clean = trail ? url.slice(0, url.length - trail.length) : url;
      return `<a href="${clean}" target="_blank" rel="noopener" class="link">${clean}</a>${trail}`;
    }
    const phone = phoneSep || phoneRun;
    if (phone) {
      const norm = normalizePhoneVN(phone);
      if (!norm) return m; // không chuẩn hoá được (ngày/giá/MST…) → giữ nguyên text
      return `<span class="phone-link" data-phone="${norm}" title="Tra cứu người dùng Zalo qua số này">${phone}</span>`;
    }
    return m;
  });
}

/** Linkify URL + SĐT trên chuỗi HTML đã render — an toàn với tag (chỉ đụng text node). */
export function linkifyHtml(html: string): string {
  if (!html) return '';
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_m: string, tag?: string, text?: string) =>
    tag ? tag : linkifyTextChunk(text ?? ''),
  );
}
