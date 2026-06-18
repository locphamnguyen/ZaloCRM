// ════════════════════════════════════════════════════════════════════════
// Block Reason Catalog — Observability "vì sao không gửi" (2026-06-18)
// ════════════════════════════════════════════════════════════════════════
//
// 1 NGUỒN SỰ THẬT cho câu chữ tiếng Việt của mọi lý do "bước không được gửi".
// SERVER là nguồn (KT-1 eng-review): BE gắn sẵn `label` + `hint` vào event/đáp ứng,
// FE chỉ hiển thị — KHÔNG tự dịch. Sửa câu chữ CHỈ ở file này.
//
// File THUẦN (không I/O) → unit test trực tiếp. Dynamic time (vd "chạy lại 14:21") KHÔNG
// nằm ở đây — lấy từ nextRunAt của per-row dashboard; hint ở đây là câu tĩnh chung.
//
// Liên quan: block-logger.ts (logBlockOnce/clearBlockMarker dùng catalog này),
// worker-guards.ts + sequence-step-worker.ts (nguồn các code), event-log-service.ts (cột category).

/** Nhóm lý do — dùng cho cột `category` (lọc nhanh) + gom badge. */
export type BlockCategory =
  | 'quota_message_exhausted' // hết 200 tin/ngày (RATE_LIMITED hoặc quota peek lúc gửi)
  | 'quota_friend_exhausted' // hết lượt kết bạn/ngày
  | 'outside_hour_window' // ngoài giờ gửi
  | 'nick_gap' // nick đang nghỉ tay (throttle giữa 2 lần)
  | 'nick_offline' // nick chưa online / QR pending / connecting
  | 'awaiting_reply' // KH vừa trả lời → tạm dừng
  | 'multi_nick' // khách đã có nhiều nick add
  | 'cross_nick_recency' // mới add gần đây
  | 'sequence_disabled' // kịch bản bám đuổi đang tắt / không tìm thấy
  | 'content_missing' // nội dung bước bị xoá/lưu trữ
  | 'config_error' // step out of range / unsupported action
  | 'internal' // kỹ thuật (stale epoch) — không hiện cho sale
  | 'unknown';

export type BlockKind = 'defer' | 'skip'; // defer = sẽ tự chạy lại; skip = bỏ qua hẳn

export interface BlockReasonInfo {
  category: BlockCategory;
  /** Nhãn ngắn tiếng Việt hiển thị cho sale. */
  label: string;
  /** Gợi ý hành động (câu tĩnh; thời gian cụ thể lấy từ nextRunAt). */
  hint: string;
  kind: BlockKind;
  /** Độ ưu tiên hiển thị trên badge (cao = nổi trước). */
  priority: number;
  /** false = lý do thuần kỹ thuật, không nổi lên badge/giao diện sale. */
  showToSale: boolean;
}

// Map theo RAW code mà worker/guards phát ra. Khi thêm code mới → thêm 1 dòng ở đây.
const CATALOG: Record<string, BlockReasonInfo> = {
  quota_message_exhausted: { category: 'quota_message_exhausted', label: 'Hết 200 tin/ngày', hint: 'Tự chạy lại 00:00', kind: 'defer', priority: 90, showToSale: true },
  // alias từ guard peek + Zalo SDK
  quota_capped: { category: 'quota_message_exhausted', label: 'Hết 200 tin/ngày', hint: 'Tự chạy lại 00:00', kind: 'defer', priority: 90, showToSale: true },
  RATE_LIMITED: { category: 'quota_message_exhausted', label: 'Hết 200 tin/ngày', hint: 'Tự chạy lại 00:00', kind: 'defer', priority: 90, showToSale: true },

  quota_friend_exhausted: { category: 'quota_friend_exhausted', label: 'Hết lượt kết bạn hôm nay', hint: 'Tự chạy lại 00:00', kind: 'defer', priority: 88, showToSale: true },

  outside_hour_window: { category: 'outside_hour_window', label: 'Ngoài giờ gửi', hint: 'Tự chạy lại khi tới giờ gửi', kind: 'defer', priority: 70, showToSale: true },

  nick_gap: { category: 'nick_gap', label: 'Nick đang nghỉ tay', hint: 'Tự chạy lại sau ít phút', kind: 'defer', priority: 50, showToSale: true },

  nick_offline: { category: 'nick_offline', label: 'Nick chưa online', hint: 'Bật/đăng nhập lại nick để chạy tiếp', kind: 'defer', priority: 80, showToSale: true },
  nick_qr_pending: { category: 'nick_offline', label: 'Nick chờ quét QR', hint: 'Quét QR đăng nhập nick để chạy tiếp', kind: 'defer', priority: 80, showToSale: true },
  nick_connecting: { category: 'nick_offline', label: 'Nick đang kết nối', hint: 'Đợi nick online lại', kind: 'defer', priority: 78, showToSale: true },

  awaiting_reply: { category: 'awaiting_reply', label: 'KH vừa trả lời — tạm dừng', hint: 'Tự chạy lại khi hết giờ giữ (hoặc bấm gửi ngay)', kind: 'defer', priority: 60, showToSale: true },

  multi_nick: { category: 'multi_nick', label: 'Khách đã có nhiều nick add', hint: 'Bỏ qua để tránh spam khách', kind: 'skip', priority: 40, showToSale: true },
  cross_nick_recency: { category: 'cross_nick_recency', label: 'Mới add/nhắn gần đây', hint: 'Bỏ qua để tránh trùng', kind: 'skip', priority: 38, showToSale: true },

  sequence_disabled: { category: 'sequence_disabled', label: 'Kịch bản bám đuổi đang TẮT', hint: 'Bật kịch bản để chạy tiếp', kind: 'skip', priority: 95, showToSale: true },
  sequence_not_found: { category: 'sequence_disabled', label: 'Không tìm thấy kịch bản bám đuổi', hint: 'Gắn lại kịch bản cho Mục tiêu', kind: 'skip', priority: 95, showToSale: true },

  block_not_found: { category: 'content_missing', label: 'Nội dung bước đã bị xoá', hint: 'Sửa lại bước trong kịch bản', kind: 'skip', priority: 85, showToSale: true },
  block_archived: { category: 'content_missing', label: 'Nội dung bước đã lưu trữ', hint: 'Khôi phục/sửa lại bước trong kịch bản', kind: 'skip', priority: 85, showToSale: true },

  step_out_of_range: { category: 'config_error', label: 'Bước vượt ngoài kịch bản', hint: 'Kiểm tra lại số bước của kịch bản', kind: 'skip', priority: 30, showToSale: true },
  unsupported_action: { category: 'config_error', label: 'Loại hành động chưa hỗ trợ', hint: 'Kiểm tra cấu hình bước', kind: 'skip', priority: 30, showToSale: true },

  stale_epoch: { category: 'internal', label: 'Bỏ qua (job cũ do gắn lại luồng)', hint: '', kind: 'skip', priority: 0, showToSale: false },
};

const UNKNOWN: BlockReasonInfo = {
  category: 'unknown',
  label: 'Chưa rõ lý do',
  hint: 'Kiểm tra log kỹ thuật',
  kind: 'defer',
  priority: 10,
  showToSale: true,
};

/**
 * Tra info từ 1 raw code (deferReason / skip reason / SDK code). Chuẩn hoá:
 * - 'unsupported_action_xxx' → 'unsupported_action'
 * - 'trigger_paused' / 'trigger_*' → unknown (không phải lý do gửi-từng-bước)
 * Luôn trả 1 object (fallback UNKNOWN) — không bao giờ undefined.
 */
export function resolveBlockReason(rawCode: string | null | undefined): BlockReasonInfo {
  if (!rawCode) return UNKNOWN;
  // Worker/guard phát reason kèm hậu tố, vd "outside_hour_window (VN 22h, allowed 8-22)" hay
  // "nick_gap (1234ms remaining)" → lấy token đầu trước khoảng trắng/ngoặc.
  const code = rawCode.trim().split(/[\s(]/)[0];
  if (CATALOG[code]) return CATALOG[code];
  // Chuẩn hoá prefix unsupported_action_*
  if (code.startsWith('unsupported_action')) return CATALOG.unsupported_action;
  if (code.startsWith('nick_')) return CATALOG.nick_offline; // nick_* lạ → coi như offline
  return UNKNOWN;
}

/** Category tương ứng 1 raw code (để ghi cột `category`). */
export function categoryOf(rawCode: string | null | undefined): BlockCategory {
  return resolveBlockReason(rawCode).category;
}

/** Tất cả raw code đã khai báo (cho test completeness). */
export function allBlockCodes(): string[] {
  return Object.keys(CATALOG);
}

/** Tất cả category (cho clearBlockMarker xoá gọn theo danh sách, khỏi SCAN keyspace). */
export const ALL_BLOCK_CATEGORIES: BlockCategory[] = [
  'quota_message_exhausted',
  'quota_friend_exhausted',
  'outside_hour_window',
  'nick_gap',
  'nick_offline',
  'awaiting_reply',
  'multi_nick',
  'cross_nick_recency',
  'sequence_disabled',
  'content_missing',
  'config_error',
  'internal',
  'unknown',
];
