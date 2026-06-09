// ════════════════════════════════════════════════════════════════════════
// CareSession notify — PRIVACY RENDER theo đích (eng-review D8) — 2026-06-07
// ════════════════════════════════════════════════════════════════════════
//
// 1 HÀM THUẦN duy nhất quyết định "đích này thấy thông tin gì" (Privacy v2).
// Mọi đường gửi notify PHẢI đi qua renderNotifyForTarget — KHÔNG tự ghép nội dung
// ở chỗ gửi → tránh rò SĐT/nội dung khách ra nhóm (vùng nhạy cảm, test bắt buộc).
//
//   ┌─ Mức ẩn theo đích (anh chốt 2026-06-07) ──────────────────────────────┐
//   │ owner   → ĐẦY ĐỦ: tên + SĐT + nội dung tin (sale phụ trách, thấy hết) │
//   │ manager → tên + loại sự kiện, ẩn SĐT + nội dung (cấp trên theo dõi)    │
//   │ group   → tên VIẾT TẮT + loại sự kiện, KHÔNG SĐT/nội dung (nhiều người)│
//   └───────────────────────────────────────────────────────────────────────┘

export type NotifyTarget = 'owner' | 'manager' | 'group';

export type CareNotifyEvent =
  | 'reply'
  | 'reaction_pos'
  | 'reaction_neg'
  | 'friend_accept'
  | 'friend_reject'
  | 'blocked'
  | 'lead';

export interface NotifyRenderInput {
  target: NotifyTarget;
  eventType: CareNotifyEvent;
  contactName: string;
  contactPhone?: string | null;
  contentPreview?: string | null; // nội dung tin khách (chỉ owner thấy)
  saleName?: string | null; // dùng cho group: "KH của [sale]"
  triggerName?: string | null;
}

const EVENT_LABEL: Record<CareNotifyEvent, string> = {
  reply: 'vừa trả lời',
  reaction_pos: 'thả cảm xúc tích cực',
  reaction_neg: 'thả cảm xúc tiêu cực',
  friend_accept: 'đồng ý kết bạn',
  friend_reject: 'từ chối kết bạn',
  blocked: 'đã chặn nick',
  lead: 'trở thành Lead',
};

const EVENT_ICON: Record<CareNotifyEvent, string> = {
  reply: '💬',
  reaction_pos: '❤️',
  reaction_neg: '💔',
  friend_accept: '🤝',
  friend_reject: '🙅',
  blocked: '🚫',
  lead: '⭐',
};

/** Viết tắt tên cho group: "Nguyễn Văn Hùng" → "Nguyễn Văn H." */
export function abbreviateName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'KH';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    // 1 từ: giữ tối đa 3 ký tự đầu + "."
    return parts[0].length <= 3 ? parts[0] : `${parts[0].slice(0, 3)}.`;
  }
  // Nhiều từ: giữ hết trừ từ cuối, từ cuối viết tắt 1 ký tự + "."
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(' ');
  return `${head} ${last.charAt(0)}.`;
}

/**
 * Render nội dung notify theo đích — HÀM THUẦN (không I/O, dễ test).
 * @returns chuỗi đã ẩn thông tin đúng mức cho đích.
 */
export function renderNotifyForTarget(input: NotifyRenderInput): string {
  const icon = EVENT_ICON[input.eventType];
  const label = EVENT_LABEL[input.eventType];

  switch (input.target) {
    case 'owner': {
      // ĐẦY ĐỦ: tên + SĐT + nội dung.
      const phone = input.contactPhone ? ` (${input.contactPhone})` : '';
      let line = `${icon} ${input.contactName}${phone} ${label}`;
      if (input.contentPreview && (input.eventType === 'reply')) {
        line += `: "${input.contentPreview}"`;
      }
      if (input.triggerName) line += ` — ${input.triggerName}`;
      return line;
    }
    case 'manager': {
      // Tên + loại sự kiện, ẩn SĐT + nội dung.
      let line = `${icon} ${input.contactName} ${label}`;
      if (input.triggerName) line += ` (${input.triggerName})`;
      return line;
    }
    case 'group': {
      // Tên viết tắt + loại sự kiện, KHÔNG SĐT/nội dung.
      const abbr = abbreviateName(input.contactName);
      const owner = input.saleName ? ` của ${input.saleName}` : '';
      return `${icon} KH ${abbr}${owner} ${label}`;
    }
  }
}
