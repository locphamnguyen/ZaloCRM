// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * template-variables.ts — DANH SÁCH 8 BIẾN cá nhân hóa DÙNG CHUNG (anh chốt 2026-06-15).
 *
 * Nguồn chân lý DUY NHẤT cho mọi UI soạn thảo (Block editor, Mẫu tin nhắn, ô chat).
 * Trước đây biến định nghĩa rải rác (BlockEditorDialog + quick-template-popup...) → trùng
 * lặp, dễ lệch. Gom 1 chỗ.
 *
 * BE render (backend/.../blocks/render-template.ts) PHẢI khớp danh sách `code` này.
 *   {gender}    Giới tính (Anh/Chị/Anh Chị)
 *   {name}      Tên khách (last word fullName)          [GIỮ TƯƠNG THÍCH]
 *   {name_full} Tên khách đầy đủ (full fullName)
 *   {crm_full}  Tên gợi nhớ (per-nick = Friend.aliasInNick, 2-way Zalo) → fallback fullName
 *   {crm_first} Tên gợi nhớ - chữ đầu
 *   {crm_last}  Tên gợi nhớ - chữ cuối
 *   {sale}      Tên sale (last word)                    [GIỮ TƯƠNG THÍCH]
 *   {sale_full} Tên sale đầy đủ
 */
export interface TemplateVariable {
  code: string;       // placeholder chèn vào text, vd '{crm_full}'
  label: string;      // tên hiển thị cho sale
  icon: string;       // mdi icon
  group: 'kh' | 'sale'; // nhóm UI cũ: khách hàng / sale (giữ tương thích)
  example: string;    // ví dụ giá trị (preview/tooltip)
  cat?: string;       // 2026-06-17: phân nhóm chi tiết (UI gom theo nhóm); 'pernick'=đổi theo nick đang chat
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // ── Tên & xưng hô ──
  { code: '{gender}',     label: 'Giới tính (Anh/Chị)',    icon: 'mdi-human-male-female',  group: 'kh',   example: 'Anh',           cat: 'Tên & xưng hô' },
  { code: '{name}',       label: 'Tên khách',              icon: 'mdi-account-outline',    group: 'kh',   example: 'Lộc',           cat: 'Tên & xưng hô' },
  { code: '{name_full}',  label: 'Tên khách đầy đủ',       icon: 'mdi-account',            group: 'kh',   example: 'Trần Văn Lộc',  cat: 'Tên & xưng hô' },
  { code: '{name_first}', label: 'Họ (chữ đầu)',           icon: 'mdi-account',            group: 'kh',   example: 'Trần',          cat: 'Tên & xưng hô' },
  { code: '{crm_full}',   label: 'Tên gợi nhớ (đầy đủ)',   icon: 'mdi-bookmark-outline',   group: 'kh',   example: 'Lộc Q7',        cat: 'pernick' },
  { code: '{crm_first}',  label: 'Tên gợi nhớ (chữ đầu)',  icon: 'mdi-bookmark',           group: 'kh',   example: 'Lộc',           cat: 'pernick' },
  { code: '{crm_last}',   label: 'Tên gợi nhớ (chữ cuối)', icon: 'mdi-bookmark',           group: 'kh',   example: 'Q7',            cat: 'pernick' },
  // ── Liên hệ & MXH ──
  { code: '{phone}',      label: 'SĐT chính',              icon: 'mdi-phone',              group: 'kh',   example: '0908 278 807',  cat: 'Liên hệ' },
  { code: '{email}',      label: 'Email',                  icon: 'mdi-email-outline',      group: 'kh',   example: 'an@gmail.com',  cat: 'Liên hệ' },
  { code: '{facebook}',   label: 'Link Facebook',          icon: 'mdi-facebook',           group: 'kh',   example: 'fb.com/an',     cat: 'Liên hệ' },
  { code: '{tiktok}',     label: 'Link TikTok',            icon: 'mdi-music-note',         group: 'kh',   example: '@an',           cat: 'Liên hệ' },
  // ── Nhân khẩu & địa chỉ ──
  { code: '{age}',        label: 'Tuổi',                   icon: 'mdi-cake-variant',       group: 'kh',   example: '33',            cat: 'Nhân khẩu & Địa chỉ' },
  { code: '{occupation}', label: 'Nghề nghiệp',            icon: 'mdi-briefcase-outline',  group: 'kh',   example: 'Kinh doanh',    cat: 'Nhân khẩu & Địa chỉ' },
  { code: '{province}',   label: 'Tỉnh / Thành',           icon: 'mdi-map-marker-outline', group: 'kh',   example: 'Hà Nội',        cat: 'Nhân khẩu & Địa chỉ' },
  { code: '{district}',   label: 'Quận / Huyện',           icon: 'mdi-map-marker-outline', group: 'kh',   example: 'Cầu Giấy',      cat: 'Nhân khẩu & Địa chỉ' },
  { code: '{ward}',       label: 'Phường / Xã',            icon: 'mdi-map-marker-outline', group: 'kh',   example: 'Dịch Vọng',     cat: 'Nhân khẩu & Địa chỉ' },
  { code: '{address}',    label: 'Địa chỉ chi tiết',       icon: 'mdi-home-map-marker',    group: 'kh',   example: 'Số 12…',        cat: 'Nhân khẩu & Địa chỉ' },
  { code: '{income}',     label: 'Mức thu nhập',           icon: 'mdi-cash',               group: 'kh',   example: '30–50tr',       cat: 'Nhân khẩu & Địa chỉ' },
  // ── Pipeline / CRM ──
  { code: '{status}',     label: 'Trạng thái KH',          icon: 'mdi-flag-outline',       group: 'kh',   example: 'Nóng',          cat: 'Pipeline / CRM' },
  { code: '{nick_status}',label: 'Trạng thái KH (nick này)',icon: 'mdi-flag',              group: 'kh',   example: 'Tiếp cận',      cat: 'pernick' },
  { code: '{source}',     label: 'Nguồn khách',            icon: 'mdi-source-branch',      group: 'kh',   example: 'Facebook Ads',  cat: 'Pipeline / CRM' },
  { code: '{next_appt}',  label: 'Lịch hẹn kế',            icon: 'mdi-calendar-clock',     group: 'kh',   example: '18/06 14:00',   cat: 'Pipeline / CRM' },
  { code: '{score}',      label: 'Lead score',             icon: 'mdi-star-outline',       group: 'kh',   example: '86',            cat: 'Pipeline / CRM' },
  // ── Hoạt động & tương tác ──
  { code: '{first_active}',label: 'Ngày active đầu',        icon: 'mdi-calendar-start',     group: 'kh',   example: '02/05/2026',    cat: 'Hoạt động' },
  { code: '{last_active}', label: 'Ngày active cuối',       icon: 'mdi-calendar-end',       group: 'kh',   example: '17/06/2026',    cat: 'Hoạt động' },
  { code: '{last_message}',label: 'Tin KH gần nhất',        icon: 'mdi-message-text-outline',group: 'kh',  example: 'Cho xin báo giá',cat: 'Hoạt động' },
  { code: '{last_inbound}',label: 'Lúc KH nhắn cuối',       icon: 'mdi-message-arrow-left', group: 'kh',   example: '17/06/2026',    cat: 'Hoạt động' },
  { code: '{last_outbound}',label: 'Lúc sale nhắn cuối',    icon: 'mdi-message-arrow-right',group: 'kh',   example: '17/06/2026',    cat: 'Hoạt động' },
  { code: '{last_interaction}',label: 'Tương tác cuối',     icon: 'mdi-gesture-tap',        group: 'kh',   example: '17/06/2026',    cat: 'Hoạt động' },
  { code: '{msg_count}',  label: 'Tổng tin in/out (nick)', icon: 'mdi-counter',            group: 'kh',   example: '48/53',         cat: 'pernick' },
  // ── Per-nick (Friend) ──
  { code: '{uid}',        label: 'UID Zalo (nick này)',    icon: 'mdi-identifier',         group: 'kh',   example: '2014 0981…',    cat: 'pernick' },
  { code: '{nick_name}',  label: 'Tên nick đang chat',     icon: 'mdi-account-box-outline',group: 'kh',   example: 'Thành Phạm',    cat: 'pernick' },
  { code: '{kb_status}',  label: 'Trạng thái kết bạn',     icon: 'mdi-account-check-outline',group: 'kh',  example: 'Đã kết bạn',    cat: 'pernick' },
  { code: '{became_friend}',label: 'Ngày kết bạn',         icon: 'mdi-calendar-heart',     group: 'kh',   example: '10/05/2026',    cat: 'pernick' },
  // ── Sale ──
  { code: '{sale}',       label: 'Tên sale',               icon: 'mdi-account-tie-outline',group: 'sale', example: 'Thành',         cat: 'Sale' },
  { code: '{sale_full}',  label: 'Tên sale đầy đủ',        icon: 'mdi-account-tie',        group: 'sale', example: 'Phạm Chí Thành',cat: 'Sale' },
];

/** Map code → ví dụ, để preview render nhanh trong UI (ô chat / popup). */
export const TEMPLATE_VAR_EXAMPLES: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.code, v.example]),
);
