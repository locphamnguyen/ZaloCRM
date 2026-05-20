/**
 * activity-types.ts — UI mapping cho ActivityLog (icon, label tiếng Việt,
 * default visibility trong compact timeline).
 *
 * Backend tham chiếu trong:
 *   backend/src/modules/activity/action-types.ts
 *
 * Default visibility:
 *   true  = mặc định HIỆN trong compact view (timeline panel Ghi chú)
 *   false = mặc định ẨN, user tự bật trong settings (sync nhiều, có thể nhiễu)
 */

export type ActivityCategory =
  | 'customer_info'
  | 'tags_crm'
  | 'tags_zalo'
  | 'status_care'
  | 'score'
  | 'appointment'
  | 'interaction'
  | 'system'
  | 'automation';

export interface CategoryMeta {
  label: string;
  icon: string;
  color: string;
  defaultVisible: boolean;
}

export const CATEGORY_META: Record<ActivityCategory, CategoryMeta> = {
  customer_info: { label: 'Thông tin KH',  icon: '📝', color: '#1976D2', defaultVisible: true },
  tags_crm:      { label: 'Tag CRM',       icon: '🏷️', color: '#7B1FA2', defaultVisible: true },
  tags_zalo:     { label: 'Tag Zalo',      icon: '🔵', color: '#0288D1', defaultVisible: false }, // sync nhiều
  status_care:   { label: 'Trạng thái',    icon: '🔄', color: '#388E3C', defaultVisible: true },
  score:         { label: 'Điểm số',       icon: '📈', color: '#F57C00', defaultVisible: true },
  appointment:   { label: 'Lịch hẹn',      icon: '📅', color: '#C2185B', defaultVisible: true },
  interaction:   { label: 'Tương tác',     icon: '💬', color: '#5D4037', defaultVisible: false }, // nhiều event
  system:        { label: 'Hệ thống',      icon: '⚙️', color: '#546E7A', defaultVisible: false },
  automation:    { label: 'Tự động (Bot)', icon: '🤖', color: '#00897B', defaultVisible: false },
};

/* Action-level metadata — icon đặc biệt + label động cho từng action.
 * Nếu action không có ở đây → fallback CATEGORY_META[category].icon + action raw. */
export interface ActionMeta {
  label: string;
  icon?: string;
}

export const ACTION_META: Record<string, ActionMeta> = {
  // customer_info
  customer_update:         { label: 'Cập nhật thông tin' },
  customer_create:         { label: 'Tạo KH', icon: '✨' },
  customer_rename:         { label: 'Đổi tên' },
  customer_phone_change:   { label: 'Đổi SĐT', icon: '📞' },
  customer_birthday_change:{ label: 'Đổi ngày sinh', icon: '🎂' },
  customer_gender_change:  { label: 'Đổi giới tính' },
  customer_assign:         { label: 'Gán phụ trách', icon: '👤' },
  friend_alias_change:     { label: 'Đổi tên gợi nhớ' },
  friend_zalo_name_change: { label: 'Tên Zalo đổi', icon: '🔄' },

  // tags_crm
  tag_add_crm:    { label: 'Gắn tag', icon: '➕' },
  tag_remove_crm: { label: 'Gỡ tag', icon: '➖' },
  tag_replace_crm:{ label: 'Đổi tag' },

  // tags_zalo
  tag_add_zalo:        { label: 'Gắn tag Zalo' },
  tag_remove_zalo:     { label: 'Gỡ tag Zalo' },
  tag_change_zalo:     { label: 'Chuyển tag Zalo' },
  zalo_label_renamed:  { label: 'Đổi tên tag Zalo' },
  zalo_label_deleted:  { label: 'Xoá tag Zalo' },

  // status_care
  status_change: { label: 'Đổi trạng thái' },

  // score
  score_change: { label: 'Đổi điểm' },

  // appointment
  appointment_create:     { label: 'Tạo lịch hẹn', icon: '✨' },
  appointment_update:     { label: 'Sửa lịch hẹn' },
  appointment_complete:   { label: 'Hoàn thành lịch', icon: '✅' },
  appointment_cancel:     { label: 'Huỷ lịch', icon: '❌' },
  appointment_reschedule: { label: 'Dời lịch', icon: '🔁' },
  appointment_no_show:    { label: 'Vắng mặt', icon: '😶' },

  // interaction
  first_inbound:           { label: 'KH nhắn lần đầu', icon: '📩' },
  first_outbound:          { label: 'Mình nhắn lần đầu', icon: '📤' },
  silent_30d:              { label: 'Im lặng 30 ngày', icon: '🔇' },
  call_logged:             { label: 'Đã gọi', icon: '📞' },
  meeting_logged:          { label: 'Đã gặp', icon: '🤝' },

  // system
  contact_link_parent:     { label: 'Liên kết KH cha' },
  contact_unlink_parent:   { label: 'Gỡ liên kết cha' },
  parent_candidate_accept: { label: 'Accept đề xuất cha' },
  contact_merge:           { label: 'Gộp KH' },
  contact_split:           { label: 'Tách KH' },
  data_import:             { label: 'Import dữ liệu', icon: '⬇️' },
  data_export:             { label: 'Export dữ liệu', icon: '⬆️' },

  // automation
  bot_tag_auto:       { label: 'Bot auto-tag' },
  bot_score_calc:     { label: 'Bot tính điểm' },
  bot_status_suggest: { label: 'Bot suggest status' },
  auto_tag_change:    { label: 'Cập nhật auto-tag', icon: '🤖' },
};

export function categoryOf(action: string, fallback: ActivityCategory = 'system'): ActivityCategory {
  // Same mapping as backend — duplicate ở FE để render độc lập
  const map: Record<string, ActivityCategory> = {
    customer_update: 'customer_info', customer_create: 'customer_info',
    customer_rename: 'customer_info', customer_phone_change: 'customer_info',
    customer_birthday_change: 'customer_info', customer_gender_change: 'customer_info',
    customer_assign: 'customer_info', friend_alias_change: 'customer_info',
    friend_zalo_name_change: 'customer_info',
    tag_add_crm: 'tags_crm', tag_remove_crm: 'tags_crm', tag_replace_crm: 'tags_crm',
    tag_add_zalo: 'tags_zalo', tag_remove_zalo: 'tags_zalo', tag_change_zalo: 'tags_zalo',
    zalo_label_renamed: 'tags_zalo', zalo_label_deleted: 'tags_zalo',
    status_change: 'status_care',
    score_change: 'score',
    appointment_create: 'appointment', appointment_update: 'appointment',
    appointment_complete: 'appointment', appointment_cancel: 'appointment',
    appointment_reschedule: 'appointment', appointment_no_show: 'appointment',
    first_inbound: 'interaction', first_outbound: 'interaction',
    silent_30d: 'interaction', call_logged: 'interaction', meeting_logged: 'interaction',
    contact_link_parent: 'system', contact_unlink_parent: 'system',
    parent_candidate_accept: 'system', contact_merge: 'system',
    contact_split: 'system', data_import: 'system', data_export: 'system',
    bot_tag_auto: 'automation', bot_score_calc: 'automation', bot_status_suggest: 'automation',
    auto_tag_change: 'automation',
  };
  return map[action] || fallback;
}

/** Default visible categories khi user chưa set preference */
export function getDefaultVisibleCategories(): ActivityCategory[] {
  return (Object.entries(CATEGORY_META) as [ActivityCategory, CategoryMeta][])
    .filter(([, m]) => m.defaultVisible)
    .map(([k]) => k);
}

/** All categories list cho settings dropdown */
export const ALL_CATEGORIES: ActivityCategory[] = Object.keys(CATEGORY_META) as ActivityCategory[];
