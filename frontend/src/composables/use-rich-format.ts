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
