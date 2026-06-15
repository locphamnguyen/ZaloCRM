// Phase 7 — AutomationSequence types & PURE validators.
//
// IMPORTANT: This file must NOT import prisma so it can be unit-tested in
// isolation without DATABASE_URL. DB-reaching helpers live in ./block-refs.ts.
//
// Sequence = ordered composition of Blocks with explicit delays between steps.
// Steps array shape:
//   [{ stepId, blockId, delayMinutes, exitCondition? }, ...]
//
// delayMinutes is the wait BEFORE this step executes, relative to the previous
// step's completion. delayMinutes=0 for step 1 means "run immediately at enroll".

export interface SequenceStep {
  stepId: string;            // stable identifier (UI uses for drag-drop, react keys)
  blockId: string;           // FK to Block.id
  delayMinutes: number;      // wait BEFORE this step executes (≥ 0)
  exitCondition?: string;    // optional gate name, future use
}

// Đơn vị giãn cách (luật 2) — lưu nguyên đơn vị, KHÔNG làm tròn về phút (anh chốt
// Open Q#1: UI cho chọn "giây" nên không quy về phút). Worker quy ra ms lúc enqueue.
export type SendGapUnit = 'second' | 'minute' | 'hour' | 'day';
// 2026-06-15 (anh chốt): giãn cách RANDOM trong khoảng [min, max] cùng 1 đơn vị. Mặc
// định 15-30 phút. Engine pick ngẫu nhiên mỗi lần enqueue bước kế (mỗi step 1 giá trị
// riêng — "pick ngay khi gửi xong step, lưu trong job cho step kế"). value (cũ, cố định)
// giữ để tương thích data cũ: thiếu min/max → coi min=max=value.
export interface SendGap {
  min?: number;
  max?: number;
  value?: number; // legacy — cố định (data cũ trước 2026-06-15)
  unit: SendGapUnit;
}

export interface SequenceRuntimeRules {
  // ── 4 luật mới (Sequence recode Đợt 1, 2026-06-13) ──
  // Luật 1 — giờ hoạt động. Worker gate giờ qua đây (BỎ trigger.sendHourStart/End ở
  // đường sequence-manual; trước đây allowedHourRange là dead config).
  allowedHourRange?: [number, number];
  // Luật 2 — giãn cách giữa các lần gửi (giây→ngày). Worker tính delay bước kế từ đây
  // (thay step.delayMinutes nếu set). Trước đây randomDelayPerSend là dead config.
  sendGap?: SendGap;
  // Luật 3 — chống spam: không enroll lại CÙNG luồng cho 1 KH trong X ngày (default 30).
  reEnrollCooldownDays?: number;

  // ── Luật cũ — đọc-nếu-có, UI 4-luật KHÔNG phơi (giữ để không vỡ data cũ, D1.5) ──
  randomDelayPerSend?: { min: number; max: number };
  perNickThrottle?: boolean;
  crossNickRecencyDays?: number;
  stopOnAccept?: boolean;
}

// Default runtime rules baked from memory rules:
//   - project_zalocrm_automation_delay_rules: 15-45 phút, hour 6-22
//   - project_zalocrm_per_nick_throttle_gate: BẬT
//   - project_zalocrm_cross_nick_friendship_recency: configurable per campaign
export const DEFAULT_RUNTIME_RULES: SequenceRuntimeRules = {
  allowedHourRange: [6, 22],
  randomDelayPerSend: { min: 15, max: 45 },
  perNickThrottle: true,
  crossNickRecencyDays: 30,
  stopOnAccept: true,
};

// ── Validators (pure — no DB) ──────────────────────────────────────────────

export function validateSteps(
  steps: unknown,
): { ok: true; steps: SequenceStep[] } | { ok: false; error: string } {
  if (!Array.isArray(steps)) return { ok: false, error: 'steps phải là mảng' };
  if (steps.length === 0) return { ok: false, error: 'sequence cần ít nhất 1 step' };

  const seenStepIds = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (typeof s !== 'object' || s === null) {
      return { ok: false, error: `step #${i + 1} phải là object` };
    }
    const step = s as Record<string, unknown>;
    if (typeof step.stepId !== 'string' || !step.stepId) {
      return { ok: false, error: `step #${i + 1} thiếu stepId` };
    }
    if (seenStepIds.has(step.stepId)) {
      return { ok: false, error: `stepId '${step.stepId}' bị trùng` };
    }
    seenStepIds.add(step.stepId);

    if (typeof step.blockId !== 'string' || !step.blockId) {
      return { ok: false, error: `step '${step.stepId}' thiếu blockId` };
    }
    if (typeof step.delayMinutes !== 'number' || step.delayMinutes < 0) {
      return { ok: false, error: `step '${step.stepId}' delayMinutes phải là số ≥ 0` };
    }
    // Cap delay at 60 days = 86400 minutes (defensive against typos like delayDays in minutes field)
    if (step.delayMinutes > 86400) {
      return { ok: false, error: `step '${step.stepId}' delayMinutes > 60 ngày, kiểm tra lại` };
    }
  }
  return { ok: true, steps: steps as SequenceStep[] };
}

export function validateRuntimeRules(
  rules: unknown,
): { ok: true; rules: SequenceRuntimeRules } | { ok: false; error: string } {
  if (rules === null || rules === undefined) return { ok: true, rules: {} };
  if (typeof rules !== 'object') return { ok: false, error: 'runtimeRules phải là object' };
  const r = rules as Record<string, unknown>;

  if (r.allowedHourRange !== undefined) {
    if (!Array.isArray(r.allowedHourRange) || r.allowedHourRange.length !== 2) {
      return { ok: false, error: 'allowedHourRange phải là [start, end]' };
    }
    const [start, end] = r.allowedHourRange as unknown[];
    if (typeof start !== 'number' || typeof end !== 'number'
        || start < 0 || start > 23 || end < 0 || end > 23 || start > end) {
      return { ok: false, error: 'allowedHourRange giá trị 0-23, start ≤ end' };
    }
  }

  if (r.randomDelayPerSend !== undefined) {
    if (typeof r.randomDelayPerSend !== 'object' || r.randomDelayPerSend === null) {
      return { ok: false, error: 'randomDelayPerSend phải là { min, max }' };
    }
    const d = r.randomDelayPerSend as Record<string, unknown>;
    if (typeof d.min !== 'number' || typeof d.max !== 'number' || d.min < 0 || d.max < d.min) {
      return { ok: false, error: 'randomDelayPerSend.min/max phải là số, min ≤ max' };
    }
  }

  // Luật 2 — sendGap { min, max, unit } (random) HOẶC { value, unit } (legacy cố định).
  if (r.sendGap !== undefined) {
    if (typeof r.sendGap !== 'object' || r.sendGap === null) {
      return { ok: false, error: 'sendGap phải là { min, max, unit }' };
    }
    const g = r.sendGap as Record<string, unknown>;
    const hasRange = typeof g.min === 'number' || typeof g.max === 'number';
    if (hasRange) {
      if (typeof g.min !== 'number' || typeof g.max !== 'number' || g.min < 0 || g.max < g.min) {
        return { ok: false, error: 'sendGap.min/max phải là số ≥ 0, min ≤ max' };
      }
    } else if (typeof g.value !== 'number' || g.value < 0) {
      return { ok: false, error: 'sendGap cần { min, max } hoặc { value } là số ≥ 0' };
    }
    if (!['second', 'minute', 'hour', 'day'].includes(g.unit as string)) {
      return { ok: false, error: "sendGap.unit phải là 'second'|'minute'|'hour'|'day'" };
    }
  }

  // Luật 3 — reEnrollCooldownDays.
  if (r.reEnrollCooldownDays !== undefined) {
    if (typeof r.reEnrollCooldownDays !== 'number' || r.reEnrollCooldownDays < 0) {
      return { ok: false, error: 'reEnrollCooldownDays phải là số ≥ 0' };
    }
  }

  if (r.perNickThrottle !== undefined && typeof r.perNickThrottle !== 'boolean') {
    return { ok: false, error: 'perNickThrottle phải là boolean' };
  }
  if (r.crossNickRecencyDays !== undefined) {
    if (typeof r.crossNickRecencyDays !== 'number' || r.crossNickRecencyDays < 0) {
      return { ok: false, error: 'crossNickRecencyDays phải là số ≥ 0' };
    }
  }
  if (r.stopOnAccept !== undefined && typeof r.stopOnAccept !== 'boolean') {
    return { ok: false, error: 'stopOnAccept phải là boolean' };
  }

  return { ok: true, rules: r as SequenceRuntimeRules };
}
