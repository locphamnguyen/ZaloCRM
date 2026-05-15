/**
 * action-types.ts — Source of truth cho tất cả action types ghi vào ActivityLog.
 *
 * Mỗi action thuộc 1 category. Category dùng để filter UI (compact timeline +
 * full activity log page). UI mapping (icon, Vietnamese label, default visibility)
 * sống ở frontend/src/constants/activity-types.ts.
 */

export type ActivityCategory =
  | 'customer_info'   // Tên, SĐT, email, ngày sinh, giới tính... (Contact + Friend identity)
  | 'tags_crm'        // CRM-side tag user tự đặt (Contact.tags / Friend.crmTagsPerNick)
  | 'tags_zalo'       // Zalo native tag sync từ SDK (Friend.zaloLabels)
  | 'status_care'     // Care status (Contact.statusId / Friend.statusId)
  | 'score'           // Lead score (Contact.leadScore / Friend.leadScore)
  | 'appointment'    // Lịch hẹn: create / update / complete / cancel / reschedule
  | 'interaction'     // Tổng hợp interaction (first_inbound, silent_30d...) — KHÔNG log từng msg
  | 'system'          // contact_link_parent, merge, import, migration
  | 'automation';     // Bot actions (auto-tag, auto-score...)

export type ActorType = 'user' | 'bot' | 'system';

/* ── Action types — kèm category mapping. ──────────────────────────────── */

export const ACTION_CATEGORY: Record<string, ActivityCategory> = {
  // customer_info
  customer_update: 'customer_info',
  customer_create: 'customer_info',
  customer_rename: 'customer_info',
  customer_phone_change: 'customer_info',
  customer_birthday_change: 'customer_info',
  customer_gender_change: 'customer_info',
  customer_assign: 'customer_info',
  friend_alias_change: 'customer_info',
  friend_zalo_name_change: 'customer_info',

  // tags_crm
  tag_add_crm: 'tags_crm',
  tag_remove_crm: 'tags_crm',
  tag_replace_crm: 'tags_crm',

  // tags_zalo
  tag_add_zalo: 'tags_zalo',
  tag_remove_zalo: 'tags_zalo',
  tag_change_zalo: 'tags_zalo',          // gộp remove+add same friend same sync session
  zalo_label_renamed: 'tags_zalo',
  zalo_label_deleted: 'tags_zalo',

  // status_care
  status_change: 'status_care',

  // score
  score_change: 'score',

  // appointment
  appointment_create: 'appointment',
  appointment_update: 'appointment',
  appointment_complete: 'appointment',
  appointment_cancel: 'appointment',
  appointment_reschedule: 'appointment',
  appointment_no_show: 'appointment',

  // interaction
  first_inbound: 'interaction',
  first_outbound: 'interaction',
  silent_30d: 'interaction',
  call_logged: 'interaction',
  meeting_logged: 'interaction',

  // system
  contact_link_parent: 'system',
  contact_unlink_parent: 'system',
  parent_candidate_accept: 'system',
  contact_merge: 'system',
  contact_split: 'system',
  data_import: 'system',
  data_export: 'system',

  // automation
  bot_tag_auto: 'automation',
  bot_score_calc: 'automation',
  bot_status_suggest: 'automation',
};

export function categoryOf(action: string): ActivityCategory | null {
  return ACTION_CATEGORY[action] || null;
}
