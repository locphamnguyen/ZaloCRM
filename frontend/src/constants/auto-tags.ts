/**
 * auto-tags.ts — Shared display map cho 9 auto-tags Phase 6+ (Friend.autoTags).
 *
 * Source of truth backend: scoring/types.ts AutoTagKey + AUTO_TAG_LABELS/ICONS/TOOLTIPS.
 *
 * Consumed by:
 *   - TagCrmBar.vue — render chip "AUTO" trong tag bar conv
 *   - ActivityItem.vue — render chip diff trong activity timeline khi action=auto_tag_change
 *   - FriendsView / ContactsView — render filter chip
 *
 * Color/tooltip/icon ĐỒNG BỘ — mọi UI hiện cùng tag phải giống hệt.
 */

export interface AutoTagDef {
  icon: string;
  label: string;
  color: string;
  tooltip: string;
}

export const AUTO_TAG_DISPLAY: Record<string, AutoTagDef> = {
  active: {
    icon: '🔥', label: 'Hoạt động', color: '#10B981',
    tooltip: '🔥 Hoạt động — KH vừa nhắn tin trong 24h qua. Đang tương tác tích cực, ưu tiên reply nhanh.',
  },
  cooling: {
    icon: '❄️', label: 'Đang nguội', color: '#60A5FA',
    tooltip: '❄️ Đang nguội — KH im lặng 7–14 ngày. Follow-up sớm trước khi nguội hẳn.',
  },
  cold: {
    icon: '🧊', label: 'Nguội', color: '#3B82F6',
    tooltip: '🧊 Nguội — KH im lặng 15–60 ngày. Cần chiến dịch re-engage (warm-up message hoặc voucher).',
  },
  frozen: {
    icon: '🥶', label: 'Đóng băng', color: '#1E40AF',
    tooltip: '🥶 Đóng băng — KH im lặng > 60 ngày. Coi như mất liên lạc, chỉ tiếp cận khi có chiến dịch lớn.',
  },
  rewarmed: {
    icon: '🔄', label: 'Ấm trở lại', color: '#F59E0B',
    tooltip: '🔄 Ấm trở lại — KH từng cold/frozen vừa nhắn lại trong 48h. Cơ hội re-engage, chăm sóc đặc biệt.',
  },
  stuck: {
    icon: '⏰', label: 'Đình trệ', color: '#EF4444',
    tooltip: '⏰ Đình trệ — KH dậm chân tại stage hiện tại quá threshold. Process gặp blocker, cần rà soát lý do.',
  },
  ready: {
    icon: '💯', label: 'Sẵn sàng chốt', color: '#059669',
    tooltip: '💯 Sẵn sàng chốt — Lead score ≥ 80. Push proposal/booking ngay.',
  },
  atrisk: {
    icon: '🚧', label: 'Có nguy cơ', color: '#DC2626',
    tooltip: '🚧 Có nguy cơ — Lead score giảm > 20 điểm trong 7 ngày. Engagement xuống, can thiệp giữ chân.',
  },
  'has-appointment': {
    icon: '📅', label: 'Có lịch hẹn', color: '#7C3AED',
    tooltip: '📅 Có lịch hẹn — Có Appointment scheduled tương lai. Chuẩn bị nội dung trước cuộc gặp.',
  },
};

/** Lookup safe — fallback cho key unknown (vd Phase 5 legacy hot-lead/warm-lead còn sót). */
export function getAutoTagDef(key: string): AutoTagDef {
  return AUTO_TAG_DISPLAY[key] ?? {
    icon: '🏷',
    label: key,
    color: '#9CA3AF',
    tooltip: `Auto-tag: ${key}`,
  };
}
