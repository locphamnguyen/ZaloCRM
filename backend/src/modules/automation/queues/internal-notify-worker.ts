// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M4 — Internal Notify BullMQ Worker (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// Privacy v2 (memory M51.4 + B4):
//   - File này thuộc module system-notifications scope private-hs ONLY
//   - Public main branch dynamic import + try/catch NUỐT lỗi
//     (worker existence check: nếu null → silent skip job)
//   - check-private-leak.sh chạy trước push main upstream
//
// 6 hooks (anh chốt section 16 design doc):
//   1. no-zalo (P4)             — KH không có Zalo, sale gọi điện
//   2. send-error (P5)          — sendFriendRequest fail, notify lý do
//   3. friend-accept (M51.4-a)  — KH bấm Đồng ý, sale chat ngay
//   4. friend-reject (M51.4-b)  — KH bấm Từ chối, low priority
//   5. customer-reply (M51.4-c) — KH reply tin sequence (KHẨN HIGH)
//                                 + debounce 60s tránh spam khi KH gõ nhiều tin
//   6. friend-accept-late       — KH accept lâu sau (debounce status)
//
// Reuse sendSystemNotificationToUser có sẵn:
//   - Resolve recipient + sender Zalo nick
//   - Channel fallback (zalo / crm_panel)
//   - SystemNotification row + Zalo SDK dispatch

import { Worker, type Job } from 'bullmq';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getBullMQRedis } from './redis-connection.js';
import { QUEUE_NAMES, getInternalNotifyQueue } from './queue-registry.js';

export type NotifyHookKind =
  | 'no-zalo'
  | 'send-error'
  | 'friend-accept'
  | 'friend-reject'
  | 'customer-reply'
  | 'friend-accept-late'
  // I5 2026-06-03 — reaction tích cực/tiêu cực + KH block nick
  | 'reaction-positive'
  | 'reaction-negative'
  | 'customer-block';

export interface InternalNotifyJobData {
  kind: NotifyHookKind;
  orgId: string;
  targetUserId: string;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  nickId?: string;
  nickName?: string;
  triggerId?: string;
  triggerName?: string;
  sequenceName?: string;
  stepInfo?: { idx: number; total: number };
  errorMessage?: string;
  replyPreview?: string;
  customerScore?: number;
  link?: string;
  // I5 2026-06-03 — reaction hooks
  emoji?: string;
  // T9 2026-06-07 (CareSession D-notify): khóa chống double-send. Khi set,
  // dùng làm BullMQ jobId → đa phiên cùng (eventId, recipient) → 1 tin duy nhất.
  // Khuyến nghị: `${eventId}-${targetUserId}`.
  dedupeKey?: string;
}

// ════════════════════════════════════════════════════════════════════════
// 2026-06-04 (Anh chốt) — Tin nội bộ dùng ĐỊNH DẠNG ZALO (styled text + urgency)
// thay vì text thuần. zca-js TextStyle: b/i/u/s + màu Red/Orange/Yellow/Green +
// Small/Big. Urgency: Default/Important/Urgent (Zalo hiện cờ "Khẩn" đỏ + chuông).
//
// styles[] = mảng {start, len, st} theo VỊ TRÍ KÝ TỰ. Để tránh bẫy off-by-one
// tiếng Việt (memory reference_ai_phrase_based_pattern), KHÔNG đếm tay — build
// text trước rồi dùng text.indexOf(phrase) tính start (phrase-based).
// ════════════════════════════════════════════════════════════════════════

// Mirror zca-js TextStyle (KHÔNG import zca-js vào worker — coupling; system-notify
// -service mới import thật. Giá trị string PHẢI khớp zca-js sendMessage.d.ts).
const ZS = {
  Bold: 'b',
  Italic: 'i',
  Underline: 'u',
  Red: 'c_db342e',
  Orange: 'c_f27806',
  Yellow: 'c_f7b503',
  Green: 'c_15a85f',
  Big: 'f_18',
} as const;
type ZStyle = (typeof ZS)[keyof typeof ZS];

// Urgency mirror (0=Default, 1=Important, 2=Urgent).
type ZUrgency = 0 | 1 | 2;

export interface NotifyStyle {
  start: number;
  len: number;
  st: ZStyle;
}

// StyleBuilder — gom text từng dòng + ghi nhớ phrase cần tô.
// Dùng indexOf để tính start (phrase-based, an toàn tiếng Việt).
class StyleBuilder {
  private text = '';
  private styles: NotifyStyle[] = [];

  /** Thêm 1 dòng text. */
  line(s: string): this {
    if (this.text.length > 0) this.text += '\n';
    this.text += s;
    return this;
  }

  /** Thêm dòng text VÀ tô nguyên dòng đó với nhiều style.
   *  len theo CODE-UNIT (s.length) — KHÔNG dùng [...s].length (code-point).
   *  zca-js JSON.stringify + slice + Zalo đều thao tác trên JS string index
   *  (code-unit UTF-16). Emoji = 2 code-unit; đếm code-point gây lệch (cắt cụt
   *  chữ cuối). Nhất quán với mark() (cũng dùng .length). */
  styledLine(s: string, ...sts: ZStyle[]): this {
    const start = this.text.length === 0 ? 0 : this.text.length + 1; // +1 cho '\n'
    this.line(s);
    for (const st of sts) this.styles.push({ start, len: s.length, st });
    return this;
  }

  /** Tô 1 phrase trong toàn bộ text (lần xuất hiện đầu tiên). */
  mark(phrase: string, ...sts: ZStyle[]): this {
    const idx = this.text.indexOf(phrase);
    if (idx >= 0) {
      // start/len theo code-unit (JS string index) — zca-js cũng dùng vị trí JS.
      for (const st of sts) this.styles.push({ start: idx, len: phrase.length, st });
    }
    return this;
  }

  build(): { content: string; styles: NotifyStyle[] } {
    return { content: this.text, styles: this.styles };
  }
}

// ════════════════════════════════════════════════════════════════════════
// Template rendering — section 16 design doc + memory M51.4
// 2026-06-04 — trả thêm styles[] + urgency cho định dạng Zalo.
// ════════════════════════════════════════════════════════════════════════
function renderTemplate(data: InternalNotifyJobData): {
  title: string;
  content: string;
  priority: 'low' | 'normal' | 'high';
  styles?: NotifyStyle[];
  urgency?: ZUrgency;
} {
  const name = data.contactName ?? data.contactPhone ?? 'KH ẩn danh';
  const phone = data.contactPhone ?? '';
  const nick = data.nickName ?? data.nickId ?? '';
  const link = data.link ?? '';
  // Luồng + bước gần nhất (Anh chốt: tin nào cũng ghi rõ KH ở luồng nào, bước nào).
  const flow = data.sequenceName ?? data.triggerName ?? '';
  const stepTxt = data.stepInfo ? `Bước ${data.stepInfo.idx}/${data.stepInfo.total}` : '';
  const flowLine = flow
    ? `📍 Luồng: ${flow}${stepTxt ? ` › ${stepTxt}` : ''}`
    : stepTxt
      ? `📍 ${stepTxt}`
      : '';
  const DIV = '─────────────────────────';

  // ── KHẨN: customer-reply / reaction-negative / customer-block ──
  if (data.kind === 'customer-reply') {
    const preview = (data.replyPreview ?? '').slice(0, 100);
    const scoreHint = data.customerScore !== undefined ? ` ⭐ Điểm ${data.customerScore}` : '';
    const T = '🔥 KHÁCH ĐANG NHẮN — TRẢ LỜI NGAY';
    const b = new StyleBuilder()
      .styledLine(T, ZS.Bold, ZS.Red, ZS.Big)
      .line(DIV)
      .line(`👤 ${name} (${phone})${scoreHint}`)
      .line(`💬 "${preview}"`);
    if (flowLine) b.line(flowLine);
    b.line('⏸ Chuỗi đã tạm dừng vì KH phản hồi.').line(`👉 Vào trả lời ngay: ${link}`);
    b.mark(`${name} (${phone})`, ZS.Bold).mark(`"${preview}"`, ZS.Italic);
    if (flowLine) b.mark(flowLine, ZS.Underline);
    const { content, styles } = b.build();
    return { title: T, content, priority: 'high', styles, urgency: 2 };
  }

  if (data.kind === 'reaction-negative') {
    const T = '😡 CẢNH BÁO — KHÁCH KHÓ CHỊU';
    const b = new StyleBuilder()
      .styledLine(T, ZS.Bold, ZS.Red, ZS.Big)
      .line(DIV)
      .line(`👤 ${name} (${phone})`)
      .line(`😡 Thả cảm xúc ${data.emoji ?? '😡'} vào tin của nick ${nick}`);
    if (flowLine) b.line(flowLine);
    b.line('⏸ Chuỗi bám đuổi đã tạm dừng 48h.').line(`👉 Vào cứu ngay kẻo mất khách: ${link}`);
    b.mark(`${name} (${phone})`, ZS.Bold);
    if (flowLine) b.mark(flowLine, ZS.Underline);
    const { content, styles } = b.build();
    return { title: T, content, priority: 'high', styles, urgency: 2 };
  }

  if (data.kind === 'customer-block') {
    const T = '🚫 KHÁCH ĐÃ CHẶN NICK — MỤC TIÊU DỪNG';
    const b = new StyleBuilder()
      .styledLine(T, ZS.Bold, ZS.Red, ZS.Big)
      .line(DIV)
      .line(`👤 ${name} (${phone})`)
      .line(`🚫 Đã chặn nick ${nick}`);
    if (flowLine) b.line(`${flowLine} › dừng hẳn`);
    b.line(`👉 Xem lại: ${link}`);
    b.mark(`${name} (${phone})`, ZS.Bold);
    const { content, styles } = b.build();
    return { title: T, content, priority: 'high', styles, urgency: 2 };
  }

  // ── KH ĐỒNG Ý KẾT BẠN — thời điểm vàng, gợi ý gọi Zalo (Anh chốt 2026-06-04) ──
  if (data.kind === 'friend-accept' || data.kind === 'friend-accept-late') {
    const late = data.kind === 'friend-accept-late';
    const T = late
      ? '🕐 KHÁCH ĐỒNG Ý KẾT BẠN (sau thời gian dài)'
      : '🤝 KHÁCH VỪA ĐỒNG Ý KẾT BẠN — THỜI ĐIỂM VÀNG';
    const b = new StyleBuilder()
      .styledLine(T, ZS.Bold, ZS.Green, ZS.Big)
      .line(DIV)
      .line(`👤 ${name} (${phone})`)
      .line(`✅ Vừa bấm Đồng ý trên nick ${nick}`);
    if (flowLine) b.line(`${flowLine} › chuẩn bị vào chuỗi`);
    b.styledLine('💡 Khách vừa mở cửa — hành động ngay khi còn nóng:', ZS.Orange, ZS.Bold)
      .line('   📞 Gọi Zalo cho khách (tỷ lệ chốt cao nhất lúc này)')
      .line('   💬 Nhắn chào hỏi cá nhân, đừng để bot chạy một mình')
      .line(`👉 Mở chat: ${link}`);
    b.mark(`${name} (${phone})`, ZS.Bold).mark('📞 Gọi Zalo cho khách', ZS.Green, ZS.Bold);
    const { content, styles } = b.build();
    return { title: T, content, priority: late ? 'normal' : 'high', styles, urgency: 1 };
  }

  // ── KH thả cảm xúc tích cực ──
  if (data.kind === 'reaction-positive') {
    const T = '❤️ KHÁCH ĐANG QUAN TÂM';
    const b = new StyleBuilder()
      .styledLine(T, ZS.Bold, ZS.Orange)
      .line(DIV)
      .line(`👤 ${name} (${phone})`)
      .line(`❤️ Thả ${data.emoji ?? '❤️'} vào tin nick ${nick}`);
    if (flowLine) b.line(flowLine);
    b.line(`💡 Tranh thủ chăm sóc — nhắn hoặc gọi Zalo: ${link}`);
    b.mark(`${name} (${phone})`, ZS.Bold);
    const { content, styles } = b.build();
    return { title: T, content, priority: 'normal', styles, urgency: 1 };
  }

  // ── KH từ chối kết bạn (thấp) ──
  if (data.kind === 'friend-reject') {
    const T = '❌ Khách từ chối kết bạn';
    const b = new StyleBuilder()
      .styledLine(T, ZS.Bold)
      .line(DIV)
      .line(`👤 ${name} (${phone}) · nick ${nick}`);
    if (flowLine) b.line(`${flowLine} › chuỗi vẫn chạy qua hộp người lạ`);
    else b.line('Chuỗi bám đuổi vẫn chạy qua hộp người lạ.');
    if (link) b.line(`👉 ${link}`);
    const { content, styles } = b.build();
    return { title: T, content, priority: 'low', styles, urgency: 0 };
  }

  // ── Các case còn lại (no-zalo / send-error) giữ text thuần như cũ ──
  switch (data.kind) {
    case 'no-zalo':
      return {
        title: `📵 ${name} không có Zalo`,
        content: `${name} (${phone}) không có Zalo. Gọi điện thoại liên hệ trực tiếp.`,
        priority: 'normal',
      };

    case 'send-error':
      return {
        title: `❌ Không gửi được kết bạn`,
        content: `Không gửi được kết bạn cho ${name}. Lý do: ${data.errorMessage ?? 'không rõ'}. Mục tiêu: ${data.triggerName ?? ''} ${link ? `\n${link}` : ''}`,
        priority: 'normal',
      };

    default:
      return {
        title: `📨 Thông báo automation`,
        content: `Sự kiện ${data.kind} cho ${name}`,
        priority: 'normal',
      };
  }
}

// ════════════════════════════════════════════════════════════════════════
// Debounce — customer-reply hook (memory M51.4-c)
// 1 KH reply nhiều tin liên tục < 60s → chỉ bắn 1 notify, preview = tin mới nhất
// ════════════════════════════════════════════════════════════════════════
async function shouldDebounceCustomerReply(
  contactId: string,
  triggerId: string | undefined,
): Promise<boolean> {
  const redis = getBullMQRedis();
  const key = `notify-debounce:reply:${contactId}:${triggerId ?? 'none'}`;
  // SETNX với TTL 60s — nếu return 0 = đã có pending notify trong 60s qua
  const setResult = await redis.set(key, '1', 'EX', 60, 'NX');
  return setResult === null; // null = key đã tồn tại (debounced)
}

// ════════════════════════════════════════════════════════════════════════
// Job processor — single tick per notify
// ════════════════════════════════════════════════════════════════════════
async function processJob(job: Job<InternalNotifyJobData>): Promise<{ status: string; reason?: string }> {
  const data = job.data;
  const tag = `[notify-${data.kind} job=${job.id}]`;

  // Debounce customer-reply hook
  if (data.kind === 'customer-reply' && data.contactId) {
    const debounced = await shouldDebounceCustomerReply(data.contactId, data.triggerId);
    if (debounced) {
      logger.info(`${tag} debounced — already notified < 60s ago`);
      return { status: 'debounced' };
    }
  }

  // Check user notification preferences (memory M51.4)
  const user = await prisma.user.findUnique({
    where: { id: data.targetUserId },
    select: { id: true, fullName: true },
  });
  if (!user) {
    return { status: 'skipped', reason: 'target_user_not_found' };
  }

  // Render template (2026-06-04 — kèm styles[] + urgency cho định dạng Zalo)
  const { title, content, priority, styles, urgency } = renderTemplate(data);

  // Dynamic import system-notify-service — PRIVATE-HS ONLY MODULE
  // Public main branch: module thiếu → import return null → silent skip
  let sendNotify: ((input: {
    orgId: string;
    targetUserId: string;
    type: string;
    title: string;
    content: string;
    priority?: 'low' | 'normal' | 'high';
    styles?: NotifyStyle[];
    urgency?: ZUrgency;
  }) => Promise<unknown>) | null = null;

  try {
    const mod = await import('../../system-notifications/system-notify-service.js');
    sendNotify = mod.sendSystemNotificationToUser ?? null;
  } catch (err) {
    logger.warn(
      `${tag} system-notifications module unavailable (private-hs only?): ${(err as Error).message}`,
    );
  }

  if (!sendNotify) {
    return { status: 'skipped', reason: 'system_notify_module_missing' };
  }

  // Dispatch notification
  try {
    await sendNotify({
      orgId: data.orgId,
      targetUserId: data.targetUserId,
      type: data.kind,
      title,
      content,
      priority,
      styles,
      urgency,
    });
    logger.info(`${tag} dispatched to user ${user.fullName} priority=${priority}`);

    // Audit event log
    await prisma.automationEventLog.create({
      data: {
        orgId: data.orgId,
        triggerId: data.triggerId,
        contactId: data.contactId,
        nickId: data.nickId,
        eventType: `internal_notify_${data.kind.replace(/-/g, '_')}`,
        detail: `→ user ${user.fullName} (${priority})`,
      },
    });

    return { status: 'sent' };
  } catch (err) {
    logger.error(`${tag} dispatch failed: ${(err as Error).message}`);
    throw err; // BullMQ retry
  }
}

// ════════════════════════════════════════════════════════════════════════
// Worker lifecycle
// ════════════════════════════════════════════════════════════════════════
let workerInstance: Worker<InternalNotifyJobData> | null = null;

export function startInternalNotifyWorker(): Worker {
  if (workerInstance) {
    logger.warn('[internal-notify-worker] already started');
    return workerInstance;
  }

  workerInstance = new Worker<InternalNotifyJobData>(
    QUEUE_NAMES.INTERNAL_NOTIFY,
    processJob,
    {
      connection: getBullMQRedis(),
      // Notify nhanh, không lock 1 nick — concurrency cao
      concurrency: 10,
    },
  );

  workerInstance.on('completed', (job) => {
    logger.info(
      `[internal-notify-worker] completed job=${job.id} kind=${job.data.kind} status=${job.returnvalue?.status}`,
    );
  });

  workerInstance.on('failed', (job, err) => {
    logger.error(
      `[internal-notify-worker] failed job=${job?.id} kind=${job?.data?.kind} attempt=${job?.attemptsMade}: ${err.message}`,
    );
  });

  workerInstance.on('error', (err) => {
    logger.error(`[internal-notify-worker] error: ${err.message}`);
  });

  logger.info('[internal-notify-worker] started concurrency=10');
  return workerInstance;
}

export async function stopInternalNotifyWorker(): Promise<void> {
  if (workerInstance) {
    logger.info('[internal-notify-worker] closing...');
    await workerInstance.close();
    workerInstance = null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Enqueue helpers — gọi từ event hooks M5
// ════════════════════════════════════════════════════════════════════════
export async function enqueueNotify(data: InternalNotifyJobData): Promise<void> {
  const queue = getInternalNotifyQueue();
  // T9 2026-06-07 (D-notify dedup): nếu có dedupeKey → dùng làm jobId. BullMQ tự
  // nuốt job trùng jobId → chống DOUBLE-SEND khi khách ở nhiều phiên cùng sale
  // (cùng eventId + recipient → 1 tin, không 2). DASH thay `:` (BullMQ v5 cấm `:`).
  const opts = data.dedupeKey
    ? { jobId: `notif-${data.dedupeKey.replace(/:/g, '-')}` }
    : undefined;
  await queue.add(data.kind, data, opts);
  logger.info(`[internal-notify] enqueued kind=${data.kind} target=${data.targetUserId}${data.dedupeKey ? ' dedupe=' + data.dedupeKey : ''}`);
}

// Convenience enqueuers cho từng hook
export const notifyNoZalo = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'no-zalo' });

export const notifySendError = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'send-error' });

export const notifyFriendAccept = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'friend-accept' });

export const notifyFriendReject = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'friend-reject' });

export const notifyCustomerReply = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'customer-reply' });

export const notifyFriendAcceptLate = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'friend-accept-late' });

// I5 2026-06-03 — reaction tích cực/tiêu cực + KH block nick
export const notifyReactionPositive = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'reaction-positive' });

export const notifyReactionNegative = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'reaction-negative' });

export const notifyCustomerBlock = (
  d: Omit<InternalNotifyJobData, 'kind'>,
): Promise<void> => enqueueNotify({ ...d, kind: 'customer-block' });
