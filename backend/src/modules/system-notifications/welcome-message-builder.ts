// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * welcome-message-builder.ts — Phase user-create-with-zalo 2026-05-27
 *
 * Build tin Zalo gửi sale mới khi admin tạo user. Trả về {text, styles, attachments}
 * sẵn sàng feed vào api.sendMessage().
 *
 * Template = markup markdown-like (text-formatter.ts) lấy từ Organization.welcomeMessageTemplate.
 * Admin sửa được trong UI Thông báo hệ thống. Nếu org chưa setup template,
 * fallback DEFAULT_TEMPLATE ở dưới.
 *
 * Placeholder hỗ trợ (em substitute trước khi compile styles):
 *   {{fullName}}        {{email}}            {{phone}}             {{password}}
 *   {{loginUrl}}        {{orgName}}          {{departmentName}}    {{roleName}}
 *   {{adminPhone}}      {{strangerNotice}}   ← auto-fill khi sale chưa kết bạn
 *
 * Variant:
 *   - 'friend'   : {{strangerNotice}} = '' (dòng biến mất)
 *   - 'stranger' : {{strangerNotice}} = câu nhắc kết bạn (highlight cam/xanh)
 */

import type { FormattedMessage, TextStyle as InternalTextStyle } from '../../shared/text-formatter.js';
import { formatMessage } from '../../shared/text-formatter.js';

export type WelcomeVariant = 'friend' | 'stranger';

/**
 * FIX 2026-05-27 bug "tin login plain text không có format":
 * text-formatter return {offset, length, style: 'bold' | ...} nhưng zca-js sendMessage cần
 * {start, len, st: 'b' | 'i' | 'c_db342e' | ...}. Phải convert trước khi pass vào api.sendMessage.
 *
 * zca-js TextStyle enum (dist/apis/sendMessage.d.ts):
 *   Bold='b', Italic='i', Underline='u', StrikeThrough='s',
 *   Red='c_db342e', Orange='c_f27806', Yellow='c_f7b503', Green='c_15a85f',
 *   Small='f_13', Big='f_18',
 *   UnorderedList='lst_1', OrderedList='lst_2'
 */
export interface ZaloSendStyle {
  start: number;
  len: number;
  st: string;
}

const COLOR_HEX_TO_ZALO_ST: Record<string, string> = {
  '#e84343': 'c_db342e', // red
  '#f5a623': 'c_f27806', // orange
  '#f8e71c': 'c_f7b503', // yellow
  '#2ecc71': 'c_15a85f', // green
  '#2962ff': 'c_2962ff', // blue (Atlas v3 2026-06-08 — khớp palette RichTextEditor)
};

export function toZaloStyles(textStyles: InternalTextStyle[]): ZaloSendStyle[] {
  const out: ZaloSendStyle[] = [];
  for (const s of textStyles) {
    let st: string | null = null;
    switch (s.style) {
      case 'bold': st = 'b'; break;
      case 'italic': st = 'i'; break;
      case 'underline': st = 'u'; break;
      case 'strikethrough': st = 's'; break;
      case 'big': st = 'f_18'; break;
      case 'small': st = 'f_13'; break;
      case 'code': st = 'i'; break; // zca-js không có code, fallback italic
      case 'color':
        st = (s.color && COLOR_HEX_TO_ZALO_ST[s.color]) ?? null;
        break;
    }
    if (st) out.push({ start: s.offset, len: s.length, st });
  }
  return out;
}

/**
 * FIX 2026-05-27 bug "SĐT hiển thị 84xxx": sale chỉ quen format 0xxx.
 * normalizePhone() biến 0931... → 84931... (canonical cho DB).
 * Em viết hàm ngược lại CHỈ để display trong template (DB vẫn lưu canonical).
 */
export function denormalizePhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  const s = String(phone).trim();
  if (s.startsWith('84') && (s.length === 11 || s.length === 12)) {
    return '0' + s.slice(2);
  }
  return s;
}

export interface WelcomeMessageInput {
  fullName: string;
  email: string | null;
  phone: string;
  password: string;
  loginUrl: string;
  orgName: string;
  departmentName: string | null;
  roleName: string | null;
  adminPhone: string | null;
  variant: WelcomeVariant;
}

export interface WelcomeMessagePayload {
  /** Plain text sau khi compile (cho log + fallback). */
  plainText: string;
  /** Formatted message ready cho api.sendMessage({msg, styles, mentions}). */
  formatted: FormattedMessage;
  /** Attachment file paths (welcome image), or empty array. */
  attachments: string[];
}

export const DEFAULT_WELCOME_TEMPLATE = `# 🎉 Chào mừng đến {{orgName}}

**Anh/Chị:** {{fullName}}
**Phòng ban:** {{departmentName}}
**Chức vụ:** {{roleName}}

## 🔑 Thông tin đăng nhập

**Email:** {{email}}
**SĐT đăng nhập:** {{phone}}
**Mật khẩu tạm:** {red}{{password}}{/red}
**Link đăng nhập:** {{loginUrl}}

## ⚠️ Lưu ý quan trọng

- Vui lòng **đổi mật khẩu** ngay sau lần đăng nhập đầu tiên
{{strangerNotice}}
- Mọi thắc mắc liên hệ admin: **{{adminPhone}}**

> *Tin nhắn tự động từ {{orgName}}*`;

const STRANGER_NOTICE_LINE =
  '- Tin nhắn từ hệ thống có thể vào tab {orange}"Người lạ"{/orange} trên Zalo. Hãy {green}kết bạn với nick này{/green} để nhận thông báo dễ dàng hơn về sau';

/**
 * Substitute placeholder + dọn dòng trống do biến optional bị rỗng.
 *
 * - {{var}} replaced literal
 * - Nếu giá trị optional rỗng (departmentName, roleName, email) → dòng chứa nó bị xoá
 *   (tránh hiện "Email: " trống)
 * - {{strangerNotice}} = STRANGER_NOTICE_LINE hoặc '' tùy variant
 */
function substitute(template: string, input: WelcomeMessageInput): string {
  const vars: Record<string, string> = {
    fullName: input.fullName,
    email: input.email ?? '',
    // FIX 2026-05-27: hiển thị 0xxx cho sale dễ đọc (DB lưu 84xxx canonical, builder display ngược)
    phone: denormalizePhoneForDisplay(input.phone),
    password: input.password,
    loginUrl: input.loginUrl,
    orgName: input.orgName,
    departmentName: input.departmentName ?? '',
    roleName: input.roleName ?? '',
    adminPhone: denormalizePhoneForDisplay(input.adminPhone),
    strangerNotice: input.variant === 'stranger' ? STRANGER_NOTICE_LINE : '',
  };

  // Replace placeholders first
  let out = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`;
  });

  // Drop lines that became empty due to optional placeholders (e.g. "**Email:** " with nothing after).
  // Rules:
  //   1. Line containing ONLY a markdown-bold label + colon (after substitution removed value) → drop
  //      e.g. "**Phòng ban:** " → drop if departmentName was empty
  //   2. Line that's the {{strangerNotice}} placeholder when variant='friend' → already replaced with ''
  //      → results in blank line → collapse multiple blank lines to single
  const lines = out.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Drop "**Label:** " with no value after
    if (/^\*\*[^*]+:\*\*\s*$/.test(trimmed)) continue;
    // Drop "Mọi thắc mắc liên hệ admin: **" if adminPhone empty
    if (trimmed.endsWith('**') && /admin:\s*\*\*\s*\*\*\s*$/.test(trimmed)) continue;
    kept.push(line);
  }

  // Collapse 3+ consecutive blank lines to max 2 (markdown paragraph break)
  out = kept.join('\n').replace(/\n{3,}/g, '\n\n');
  return out;
}

/**
 * Build welcome message từ template (load từ DB hoặc default) + input.
 *
 * @param template    Org.welcomeMessageTemplate. Pass null để dùng DEFAULT_WELCOME_TEMPLATE.
 * @param input       Data substitute placeholders.
 * @param options     welcomeImagePath: gắn ảnh attachment nếu có.
 */
export function buildWelcomeMessage(
  template: string | null,
  input: WelcomeMessageInput,
  options: { welcomeImagePath?: string | null } = {},
): WelcomeMessagePayload {
  const markup = substitute(template ?? DEFAULT_WELCOME_TEMPLATE, input);
  const formatted = formatMessage(markup);
  const attachments = options.welcomeImagePath ? [options.welcomeImagePath] : [];
  return {
    plainText: formatted.text,
    formatted,
    attachments,
  };
}

/**
 * Build text-only fallback gửi cho admin khi tin chính fail. KHÔNG style, không attachment.
 */
export function buildAdminFallbackMessage(args: {
  saleName: string;
  salePhone: string;
  failureReason: string;
  credentials: { email: string | null; phone: string; password: string; loginUrl: string };
}): string {
  const { saleName, salePhone, failureReason, credentials } = args;
  return [
    `⚠️ TIN LOGIN GỬI SALE FAIL`,
    ``,
    `Sale: ${saleName} (${salePhone})`,
    `Lý do: ${failureReason}`,
    ``,
    `=== Credentials gốc (vui lòng chuyển thủ công cho sale) ===`,
    credentials.email ? `Email: ${credentials.email}` : null,
    `SĐT: ${credentials.phone}`,
    `Mật khẩu tạm: ${credentials.password}`,
    `Link: ${credentials.loginUrl}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Validate template có đủ biến critical không. Dùng trong PUT /org/welcome-template.
 * Trả về list lỗi rỗng = OK.
 */
export function validateTemplate(template: string): string[] {
  const errors: string[] = [];
  const required = ['{{password}}', '{{phone}}'];
  for (const key of required) {
    if (!template.includes(key)) {
      errors.push(`Template phải chứa biến ${key} (sale không nhận được thông tin login)`);
    }
  }
  return errors;
}
