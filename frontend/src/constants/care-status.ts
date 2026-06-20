// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * 9 enum care status đề xuất theo Dev Spec mockup contacts-approach-b-v3.
 * Đây là per-nick care status (Friend.customerCareStatus). Khác với
 * contact.status (pipeline cấp KH).
 */
export const CARE_STATUSES = [
  { value: 'new',           label: '🆕 Mới',          chip: 'chip-grey' },
  { value: 'new_stranger',  label: '🆕 Mới (lạ)',     chip: 'chip-cyan' },
  { value: 'interested',    label: '💬 Quan tâm',     chip: 'chip-info' },
  { value: 'nurturing',     label: '🤝 Chăm sóc',     chip: 'chip-purple' },
  { value: 'negotiating',   label: '⚡ Đàm phán',     chip: 'chip-warning' },
  { value: 'hot',           label: '🔥 Nóng',         chip: 'chip-error' },
  { value: 'cold',          label: '❄ Lạnh',          chip: 'chip-grey' },
  { value: 'closed',        label: '✅ Đã chốt',      chip: 'chip-success' },
  { value: 'lost',          label: '❌ Mất',          chip: 'chip-error' },
] as const;

export type CareStatusValue = typeof CARE_STATUSES[number]['value'];
