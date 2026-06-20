// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-rich-to-markup.ts — Atlas v3 2026-06-08
 *
 * Chuyển payload {text, styles[]} của RichTextEditor (mã Zalo: b/i/u/s/c_HEX/f_NN)
 * NGƯỢC về markup string mà backend lưu (Organization.welcomeMessageTemplate) +
 * text-formatter.ts re-compile được.
 *
 * Vì sao cần: trang "Tin chào mừng" cho admin soạn WYSIWYG (bôi đậm/màu/cỡ giống
 * edit block Zalo), nhưng kho lưu vẫn là markup (để {{placeholders}} giữ literal +
 * substitute trước khi gửi). Đây là chiều editor → markup khi bấm Lưu.
 *
 * Inline markup phát ra (khớp INLINE_RULES trong text-formatter.ts):
 *   b → **…**   i → *…*   u → {underline}…{/underline}   s → ~~…~~
 *   c_db342e → {red}   c_f27806 → {orange}   c_f7b503 → {yellow}
 *   c_15a85f → {green}  c_2962ff → {blue}
 *   f_18/f_22 → {big}   f_13 → {small}
 *
 * Placeholder {{x}}: là text thường trong payload → đi qua nguyên vẹn (không style),
 * không cần xử lý riêng. formatMessage cũng bỏ qua {{x}}.
 *
 * LƯU Ý round-trip: ký hiệu markup gốc ('*', '**', '{red}') KHÔNG còn trong payload
 * (đã compile thành text+styles), nên ta tái dựng từ styles. Cú pháp khối (#, >, -, 1.)
 * không tái dựng — thay bằng inline styles tương đương → KH thấy y hệt trên Zalo
 * (bold/màu/cỡ đúng vị trí), chỉ khác cách viết nguồn.
 */

interface ZaloStyle {
  st: string;
  start: number;
  len: number;
}

// Mã Zalo → cặp tag mở/đóng markup. Trả null nếu không hỗ trợ (bỏ qua an toàn).
function markupTag(st: string): { open: string; close: string } | null {
  switch (st) {
    case 'b': return { open: '**', close: '**' };
    case 'i': return { open: '*', close: '*' };
    case 'u': return { open: '{underline}', close: '{/underline}' };
    case 's': return { open: '~~', close: '~~' };
    case 'c_db342e': return { open: '{red}', close: '{/red}' };
    case 'c_f27806': return { open: '{orange}', close: '{/orange}' };
    case 'c_f7b503': return { open: '{yellow}', close: '{/yellow}' };
    case 'c_15a85f': return { open: '{green}', close: '{/green}' };
    case 'c_2962ff': return { open: '{blue}', close: '{/blue}' };
    case 'f_13': return { open: '{small}', close: '{/small}' };
    case 'f_18': return { open: '{big}', close: '{/big}' };
    case 'f_22': return { open: '{big}', close: '{/big}' }; // "Rất Lớn" → {big} (markup không có cấp lớn hơn)
    default: return null;
  }
}

// Thứ tự lồng tag ổn định: màu/cỡ ngoài cùng → b/i/u/s trong → tránh tag chéo nhau.
const NEST_ORDER = ['c_', 'f_', 'b', 'i', 'u', 's'];
function styleRank(st: string): number {
  if (st.startsWith('c_')) return 0;
  if (st.startsWith('f_')) return 1;
  const i = NEST_ORDER.indexOf(st);
  return i >= 0 ? i : 99;
}

/**
 * Build markup string từ {text, styles}. Quét theo ký tự, mở/đóng tag tại biên thay đổi.
 * Mỗi đoạn ký tự liên tiếp cùng tập style → bọc 1 lần (gọn markup, không bọc từng ký tự).
 */
export function zaloRichToMarkup(text: string, styles: ZaloStyle[] = []): string {
  if (!text) return '';
  const len = text.length;

  // Tập mã style active cho từng ký tự (chỉ giữ mã có markup hỗ trợ).
  const perChar: string[][] = Array.from({ length: len }, () => []);
  for (const s of styles) {
    if (!s || typeof s.start !== 'number' || typeof s.len !== 'number' || s.len <= 0) continue;
    if (!markupTag(s.st)) continue; // mã lạ → bỏ qua, không làm hỏng text
    const start = Math.max(0, s.start | 0);
    const end = Math.min(len, start + (s.len | 0));
    for (let i = start; i < end; i++) {
      if (!perChar[i].includes(s.st)) perChar[i].push(s.st);
    }
  }

  let out = '';
  let openKeys: string[] = []; // tag đang mở (theo đúng thứ tự đã mở)

  const openTags = (keys: string[]) =>
    keys.map((k) => markupTag(k)?.open ?? '').join('');
  // Đóng theo thứ tự ngược (tag mở sau đóng trước → cân bằng).
  const closeTags = (keys: string[]) =>
    [...keys].reverse().map((k) => markupTag(k)?.close ?? '').join('');

  for (let i = 0; i < len; i++) {
    const ch = text[i];

    // Newline: luôn đóng hết tag đang mở rồi xuống dòng "trần" (markup parse theo dòng,
    // không bọc tag vắt qua '\n'). Tag sẽ tự mở lại ở ký tự có style kế tiếp.
    if (ch === '\n') {
      out += closeTags(openKeys);
      openKeys = [];
      out += '\n';
      continue;
    }

    const wantKeys = perChar[i].slice().sort((a, b) => styleRank(a) - styleRank(b));
    if (wantKeys.join(',') !== openKeys.join(',')) {
      out += closeTags(openKeys);
      out += openTags(wantKeys);
      openKeys = wantKeys;
    }
    out += ch;
  }
  out += closeTags(openKeys);
  return out;
}
