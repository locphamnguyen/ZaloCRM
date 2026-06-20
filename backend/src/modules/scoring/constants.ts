// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/constants.ts — Default seed data cho Phase 6 Lead Scoring Engine.
 *
 * Match với CEO review design 2026-05-15:
 *   Weights:   E 35% · I 30% · F 15% · V 20%
 *   Decay:     -1/-3/-5/-8 per ngày (3-7/7-14/14-30/30-60)
 *   Stages:    8 stages BĐS pipeline (Mới → Tiếp cận → ... → Chốt)
 *   Bottleneck: Stage 1-2-3 (Mới/Tiếp cận/Hẹn gặp)
 *
 * Tất cả tunable từ Settings UI sau khi seed. Đây chỉ là defaults.
 */

import type {
  SignalRuleSeed,
  StageTransitionSeed,
  StuckThresholdSeed,
  NbaTemplateSeed,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL RULES — 30+ rules tăng/hạ điểm theo dimension
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_SIGNAL_RULES: SignalRuleSeed[] = [
  // ── ENGAGEMENT (35% weight) — Tương tác ─────────────────────────────────
  {
    signalKey: 'inbound_message',
    dimension: 'engagement',
    ruleType: 'action',
    delta: 3,
    capPerDay: 15, // max +15/ngày
    label: 'KH gửi tin nhắn',
  },
  {
    signalKey: 'fast_response',
    dimension: 'engagement',
    ruleType: 'action',
    delta: 5,
    capPerDay: 5,
    label: 'KH phản hồi nhanh (< 5 phút)',
  },
  {
    signalKey: 'long_message',
    dimension: 'engagement',
    ruleType: 'action',
    delta: 2,
    capPerDay: 10,
    label: 'KH gửi tin dài (> 50 ký tự)',
  },
  {
    signalKey: 'voice_or_call',
    dimension: 'engagement',
    ruleType: 'action',
    delta: 8,
    label: 'KH gửi voice / video call',
  },
  {
    signalKey: 'kh_reacts',
    dimension: 'engagement',
    ruleType: 'action',
    delta: 1,
    capPerDay: 5,
    label: 'KH react / reply tin của mình',
  },
  {
    signalKey: 'kh_initiates_after_silent',
    dimension: 'engagement',
    ruleType: 'action',
    delta: 15,
    capTotal: null, // mỗi lần re-engage đều cộng
    label: 'KH chủ động chat lại sau im lặng',
  },

  // ── INTENT (30% weight) — Ý định mua qua keyword ────────────────────────
  {
    signalKey: 'ask_price',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 15,
    keywords: ['giá bao nhiêu', 'rao bao nhiêu', 'bao tiền', 'giá rao', 'giá thật'],
    label: 'KH hỏi giá rõ ràng',
  },
  {
    signalKey: 'ask_payment',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 20,
    keywords: ['trả trước', 'vay được không', 'thanh toán', 'đóng góp', 'trả góp', 'lãi suất'],
    label: 'KH hỏi về thanh toán',
  },
  {
    signalKey: 'ask_project_detail',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 10,
    keywords: ['vị trí', 'view', 'hướng', 'diện tích', 'mặt tiền', 'tầng', 'số phòng'],
    label: 'KH hỏi chi tiết dự án',
  },
  {
    signalKey: 'ask_documents',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 12,
    keywords: ['tài liệu', 'bảng giá', 'brochure', 'pdf', 'gửi file', 'thông tin chi tiết'],
    label: 'KH xin tài liệu / báo giá',
  },
  {
    signalKey: 'ask_legal',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 18,
    keywords: ['hợp đồng', 'hđ', 'công chứng', 'sổ đỏ', 'sổ hồng', 'pháp lý', 'thủ tục'],
    label: 'KH hỏi thủ tục pháp lý',
  },
  {
    signalKey: 'ask_promo',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 10,
    keywords: ['ưu đãi', 'khuyến mãi', 'chiết khấu', 'giảm giá', 'tặng'],
    label: 'KH hỏi ưu đãi / khuyến mãi',
  },
  {
    signalKey: 'mention_decisionmaker',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 8,
    keywords: ['vợ em', 'chồng em', 'anh trai', 'gia đình', 'ba mẹ', 'bố mẹ', 'cha mẹ'],
    label: 'KH đề cập decision-maker khác',
  },
  {
    signalKey: 'ask_future',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: 15,
    keywords: ['khi nào bàn giao', 'tháng nào ký', 'năm sau', 'cuối năm', 'sang năm'],
    label: 'KH đặt câu hỏi tương lai',
  },

  // ── INTENT — Action milestones (event-based) ────────────────────────────
  {
    signalKey: 'appointment_book',
    dimension: 'intent',
    ruleType: 'action',
    delta: 25,
    capTotal: 50, // max +50 từ booking (tránh spam)
    label: 'Đã đặt lịch xem nhà',
  },
  {
    signalKey: 'appointment_complete',
    dimension: 'intent',
    ruleType: 'action',
    delta: 35,
    label: 'Hoàn thành lịch xem nhà',
  },
  {
    signalKey: 'document_sent',
    dimension: 'intent',
    ruleType: 'action',
    delta: 15,
    capPerDay: 15,
    label: 'Đã nhận báo giá',
  },
  {
    signalKey: 'deposit',
    dimension: 'intent',
    ruleType: 'action',
    delta: 50,
    label: 'Đặt cọc giữ chỗ',
  },
  {
    signalKey: 'sign_contract',
    dimension: 'intent',
    ruleType: 'action',
    delta: 50,
    label: 'Ký hợp đồng mua bán',
  },

  // ── FIT (15% weight) — Phù hợp dự án (profile-based) ────────────────────
  {
    signalKey: 'budget_match',
    dimension: 'fit',
    ruleType: 'profile',
    delta: 20,
    capTotal: 20,
    label: 'Ngân sách khớp dự án',
  },
  {
    signalKey: 'location_match',
    dimension: 'fit',
    ruleType: 'profile',
    delta: 10,
    capTotal: 10,
    label: 'Vị trí mong muốn khớp dự án',
  },
  {
    signalKey: 'type_match',
    dimension: 'fit',
    ruleType: 'profile',
    delta: 8,
    capTotal: 8,
    label: 'Loại hình (gia đình/căn hộ) khớp dự án',
  },
  {
    signalKey: 'referral_link',
    dimension: 'fit',
    ruleType: 'profile',
    delta: 15,
    capTotal: 15,
    label: 'Người thân/bạn đã mua dự án cùng',
  },

  // ── VELOCITY (20% weight) — Đà tăng nhiệt ───────────────────────────────
  {
    signalKey: 'streak_3days',
    dimension: 'velocity',
    ruleType: 'velocity',
    delta: 5,
    capPerDay: 5,
    label: '3 ngày liên tiếp có tương tác',
  },
  {
    signalKey: 'trend_up_week',
    dimension: 'velocity',
    ruleType: 'velocity',
    delta: 10,
    capPerDay: 10,
    label: 'Score tăng tuần qua',
  },
  {
    signalKey: 'action_chain',
    dimension: 'velocity',
    ruleType: 'velocity',
    delta: 15,
    label: 'Chuỗi action (book → xem → đàm phán)',
  },

  // ── NEGATIVE SIGNALS ────────────────────────────────────────────────────
  {
    signalKey: 'seen_zoned',
    dimension: 'engagement',
    ruleType: 'action',
    delta: -3,
    capPerDay: 9, // max -9/ngày
    label: 'KH "seen" tin nhưng không reply',
  },
  {
    signalKey: 'short_reply',
    dimension: 'engagement',
    ruleType: 'action',
    delta: -2,
    capPerDay: 6,
    label: 'KH trả lời ngắn 1-2 từ',
  },
  {
    signalKey: 'refuse_meeting',
    dimension: 'intent',
    ruleType: 'action',
    delta: -10,
    label: 'KH từ chối lịch hẹn',
  },
  {
    signalKey: 'ask_competitor',
    dimension: 'intent',
    ruleType: 'keyword',
    delta: -8,
    keywords: ['bên kia giá', 'dự án khác giá', 'so sánh với'],
    label: 'KH hỏi giá competitor',
  },
  {
    signalKey: 'slow_response_self',
    dimension: 'engagement',
    ruleType: 'action',
    delta: -5,
    label: 'Sale phản hồi chậm > 24h (cảnh báo)',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// STAGE TRANSITION RULES — auto-promote logic giữa 8 stages
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_STAGE_TRANSITIONS: StageTransitionSeed[] = [
  {
    fromStage: 'Mới',
    toStage: 'Tiếp cận',
    criteria: { minEngagement: 20, minInboundCount: 2 },
    requiresManualConfirm: false,
  },
  {
    fromStage: 'Tiếp cận',
    toStage: 'Hẹn gặp',
    criteria: {
      minEngagement: 40,
      minIntent: 30,
      requiresAction: ['appointment_book'],
    },
    requiresManualConfirm: false,
  },
  {
    fromStage: 'Hẹn gặp',
    toStage: 'Nóng',
    criteria: { requiresAction: ['appointment_complete'] },
    requiresManualConfirm: false,
  },
  {
    fromStage: 'Nóng',
    toStage: 'Tiềm năng',
    criteria: {
      minIntent: 70,
      minDaysInStage: 5,
      // Đàm phán giá detect qua signal "ask_promo" hoặc "ask_payment" trong 7 ngày
    },
    requiresManualConfirm: true, // sale verify
  },
  {
    fromStage: 'Tiềm năng',
    toStage: 'Chốt',
    criteria: {
      requiresAction: ['deposit', 'sign_contract'],
    },
    requiresManualConfirm: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// STUCK THRESHOLDS — phát hiện đình trệ per-stage
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_STUCK_THRESHOLDS: StuckThresholdSeed[] = [
  {
    stage: 'Mới',
    thresholdDays: 7,
    extraDecayPerDay: 2,
    nbaTemplateKey: 'stuck_stage_new_greeting',
    alertLabel: 'Chưa được tiếp cận — cần liên hệ ngay',
  },
  {
    stage: 'Tiếp cận',
    thresholdDays: 14,
    extraDecayPerDay: 1,
    nbaTemplateKey: 'stuck_stage_approach_tour',
    alertLabel: 'KH chat ít — gửi video tour + brochure',
  },
  {
    stage: 'Hẹn gặp',
    thresholdDays: 30,
    extraDecayPerDay: 2,
    nbaTemplateKey: 'stuck_stage_meeting_videocall',
    alertLabel: 'Chưa đi xem — đề xuất gọi video / tour 360°',
  },
  {
    stage: 'Nóng',
    thresholdDays: 21,
    extraDecayPerDay: 2,
    nbaTemplateKey: 'stuck_stage_hot_promo',
    alertLabel: 'Chưa quyết — push ưu đãi tháng này',
  },
  {
    stage: 'Tiềm năng',
    thresholdDays: 14,
    extraDecayPerDay: 3,
    nbaTemplateKey: 'stuck_stage_potential_call',
    alertLabel: 'KH do dự — gọi điện trực tiếp',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// NBA TEMPLATES — Next Best Action messages
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_NBA_TEMPLATES: NbaTemplateSeed[] = [
  {
    key: 'stuck_stage_new_greeting',
    label: 'Lời chào + dự án highlight (KH stuck stage Mới)',
    contentTemplate:
      'Chào anh/chị {{customerName}}! Em là sale của dự án {{projectName}}. ' +
      'Tháng này dự án có ưu đãi đặc biệt: {{promoMonth}}. ' +
      'Anh/chị có muốn em gửi thông tin chi tiết không ạ?',
    category: 'stuck',
  },
  {
    key: 'stuck_stage_approach_tour',
    label: 'Video tour + brochure (KH stuck stage Tiếp cận)',
    contentTemplate:
      'Anh/chị {{customerName}}, em gửi video giới thiệu nhanh dự án {{projectName}} ' +
      '({{viewingLink}}) và bảng giá chi tiết. Nếu thuận tiện, em sắp xếp ' +
      'gọi video tour trực tiếp giúp anh/chị xem rõ hơn ạ.',
    category: 'stuck',
  },
  {
    key: 'stuck_stage_meeting_videocall',
    label: 'Đề xuất video call thay xem trực tiếp (stuck stage Hẹn gặp)',
    contentTemplate:
      'Anh/chị {{customerName}}, em hiểu việc đi xem trực tiếp có thể bất tiện. ' +
      'Em đề xuất gọi video call 15 phút để em tour thực tế qua camera ' +
      'và giải đáp mọi câu hỏi. Anh/chị thuận tiện khung giờ nào ạ?',
    category: 'stuck',
  },
  {
    key: 'stuck_stage_hot_promo',
    label: 'Push ưu đãi (stuck stage Nóng)',
    contentTemplate:
      'Anh/chị {{customerName}}, ưu đãi tháng này còn áp dụng tới {{promoMonth}}: ' +
      'giảm 5% + tặng nội thất 200tr nếu ký trước ngày 20. Anh/chị xem giúp em ' +
      'có thể quyết được không ạ?',
    category: 'hot_close',
  },
  {
    key: 'stuck_stage_potential_call',
    label: 'Gọi điện trực tiếp (stuck stage Tiềm năng)',
    contentTemplate:
      'Anh/chị {{customerName}}, em sẽ gọi anh/chị lúc {{callTime}} để bàn ' +
      'chi tiết thủ tục và phương án thanh toán. Nếu bận giờ đó, anh/chị ' +
      'báo em khung khác ạ.',
    category: 'hot_close',
  },
  {
    key: 'cold_reengage_30d',
    label: 'Re-engage KH lâu không tương tác',
    contentTemplate:
      'Anh/chị {{customerName}}, lâu rồi mình chưa trao đổi! Em gửi update ' +
      'tiến độ dự án {{projectName}}: {{progressUpdate}}. ' +
      'Anh/chị còn quan tâm thì em hỗ trợ tiếp ạ.',
    category: 'cold_reengage',
  },
  {
    key: 'hot_close_push',
    label: 'Push chốt KH ready (score ≥ 80)',
    contentTemplate:
      'Anh/chị {{customerName}}, em thấy mình đã tìm hiểu kỹ rồi. ' +
      'Em xin phép chốt giúp anh/chị căn {{unitInfo}} ' +
      'với giá {{priceInfo}} + ưu đãi {{promoMonth}}. ' +
      'Anh/chị xác nhận giúp em để em làm thủ tục đặt cọc ạ.',
    category: 'hot_close',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIG VALUES (sync với schema defaults)
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_SCORING_CONFIG = {
  weightEngagement: 35,
  weightIntent: 30,
  weightFit: 15,
  weightVelocity: 20,
  decayDay3to7: -1,
  decayDay7to14: -3,
  decayDay14to30: -5,
  decayDay30to60: -8,
  autoPromote: true,
  stuckDetectionEnabled: true,
  explainabilityEnabled: true,
};
