/**
 * push-service.ts — Push notification (FCM Android + APNs iOS) qua firebase-admin.
 *
 * Mục tiêu: Mobile App nhận thông báo khi KHÁCH nhắn tới nick sales (tin INBOUND).
 *
 * Nguyên tắc (KISS + error isolation TUYỆT ĐỐI):
 *   - LAZY init firebase-admin từ env. Thiếu creds → NO-OP (warn 1 lần, mọi hàm return im).
 *     KHÔNG throw, KHÔNG crash app — toàn hệ thống chạy bình thường, chỉ không có push.
 *   - Push fail KHÔNG bao giờ ảnh hưởng pipeline nhận/lưu/emit tin (caller gọi fire-and-forget,
 *     và mọi hàm ở đây tự bọc try/catch).
 *   - Token chết (unregistered/invalid) → tự xoá khỏi Device.
 *
 * Env (1 trong 2):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  — chuỗi JSON service account
 *   FIREBASE_SERVICE_ACCOUNT_PATH  — đường dẫn tới file service account JSON
 */
import { readFileSync } from 'node:fs';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { resolvePushTargetUserIds } from './push-targets.js';

// firebase-admin chỉ import động khi thật sự có creds (tránh khởi tạo thừa ở chế độ NO-OP).
type FirebaseMessaging = {
  sendEachForMulticast(message: unknown): Promise<{
    responses: Array<{ success: boolean; error?: { code?: string } }>;
  }>;
};

let messagingInstance: FirebaseMessaging | null = null;
let initAttempted = false;
let disabledWarned = false;

function readServiceAccount(): Record<string, unknown> | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim()) {
    try {
      return JSON.parse(json);
    } catch (err) {
      logger.warn('[push] FIREBASE_SERVICE_ACCOUNT_JSON parse failed:', (err as Error).message);
      return null;
    }
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && path.trim()) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      logger.warn('[push] FIREBASE_SERVICE_ACCOUNT_PATH read failed:', (err as Error).message);
      return null;
    }
  }
  return null;
}

/** Lazy init. Trả messaging instance hoặc null (NO-OP mode). */
async function getMessaging(): Promise<FirebaseMessaging | null> {
  if (initAttempted) return messagingInstance;
  initAttempted = true;

  const serviceAccount = readServiceAccount();
  if (!serviceAccount) {
    if (!disabledWarned) {
      logger.warn('[push] push disabled: no Firebase credentials');
      disabledWarned = true;
    }
    return null;
  }

  try {
    const appMod = await import('firebase-admin/app');
    const msgMod = await import('firebase-admin/messaging');
    if (appMod.getApps().length === 0) {
      appMod.initializeApp({ credential: appMod.cert(serviceAccount as any) });
    }
    messagingInstance = msgMod.getMessaging() as unknown as FirebaseMessaging;
    logger.info('[push] Firebase Admin initialized — push enabled');
    return messagingInstance;
  } catch (err) {
    logger.warn('[push] Firebase Admin init failed, push disabled:', (err as Error).message);
    messagingInstance = null;
    return null;
  }
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export interface PushPayload {
  title: string;
  body: string;
  /** BẮT BUỘC chứa conversationId + zaloAccountId (string) để app deep-link. */
  data: Record<string, string>;
}

/**
 * Gửi push tới mọi device của 1 user. NO-OP nếu thiếu creds hoặc user không có device.
 * Tự xoá token chết. KHÔNG ném lỗi ra ngoài.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const messaging = await getMessaging();
    if (!messaging) return;

    const devices = await prisma.device.findMany({
      where: { userId },
      select: { fcmToken: true },
    });
    const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
    if (tokens.length === 0) return;

    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });

    // Thu thập token chết để xoá.
    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success && r.error?.code && DEAD_TOKEN_CODES.has(r.error.code)) {
        dead.push(tokens[i]);
      }
    });
    if (dead.length > 0) {
      await prisma.device
        .deleteMany({ where: { fcmToken: { in: dead } } })
        .catch((err) => logger.warn('[push] dead token cleanup failed:', err));
      logger.debug(`[push] removed ${dead.length} dead token(s) for user=${userId}`);
    }
  } catch (err) {
    // Error isolation: push fail KHÔNG được ảnh hưởng gì.
    logger.warn('[push] sendPushToUser failed:', (err as Error).message);
  }
}

export interface NotifyNewInboundArgs {
  orgId: string;
  conversationId: string;
  zaloAccountId: string;
  privacyMode: string;
  ownerUserId: string | null;
  /** Message đã persist (id, content, contentType, senderName, ...). */
  message: any;
  /** Tên khách hiển thị (ưu tiên) — fallback message.senderName. */
  senderName?: string | null;
  /** userId của người gửi tin nếu là nội bộ (để loại khỏi target). Inbound KH thường null. */
  senderUserId?: string | null;
}

const PRIVATE_BODY = 'Bạn có tin nhắn mới';

/** Build preview body từ message (tôn trọng contentType — media không lộ text). */
function buildPreviewBody(message: any): string {
  const type = message?.contentType ?? 'text';
  if (type === 'text') {
    const content = String(message?.content ?? '').trim();
    if (!content) return 'Tin nhắn mới';
    return content.length > 120 ? `${content.slice(0, 120)}…` : content;
  }
  switch (type) {
    case 'image': return '📷 Hình ảnh';
    case 'video': return '🎥 Video';
    case 'voice':
    case 'audio': return '🎤 Tin nhắn thoại';
    case 'file': return '📎 Tệp đính kèm';
    case 'sticker': return 'Nhãn dán';
    case 'gif': return 'Ảnh động';
    case 'link': return '🔗 Liên kết';
    case 'call': return '📞 Cuộc gọi';
    default: return 'Tin nhắn mới';
  }
}

/**
 * Hook chính cho 1 tin INBOUND (KHÁCH gửi đến). Tính title/body theo privacy rồi bắn push
 * cho mọi user được phép xem nick (resolvePushTargetUserIds).
 *
 *  - Nick 'main' (Riêng tư): chỉ chủ nick (ownerUserId) thấy nội dung thật; người khác → body che.
 *  - Nick 'sub' (Thường): mọi target thấy preview thật.
 *
 * NO-OP an toàn nếu thiếu creds (getMessaging trả null trong sendPushToUser). KHÔNG ném lỗi.
 */
export async function notifyNewInboundMessage(args: NotifyNewInboundArgs): Promise<void> {
  try {
    const { orgId, conversationId, zaloAccountId, privacyMode, ownerUserId, message } = args;

    const title = (args.senderName ?? message?.senderName ?? 'Khách hàng').toString();
    const realBody = buildPreviewBody(message);
    const isPrivate = privacyMode === 'main';

    // Privacy đồng nhất với emit-chat: nick 'main' → người KHÔNG phải owner chỉ thấy body che
    // (PRIVATE_BODY), KHÔNG lộ nội dung trao đổi. Chủ nick (ownerUserId) thấy body thật.
    const redactedBody = isPrivate ? PRIVATE_BODY : realBody;

    const data: Record<string, string> = { conversationId, zaloAccountId };

    const targets = await resolvePushTargetUserIds(zaloAccountId, orgId, args.senderUserId ?? null);
    if (targets.length === 0) return;

    for (const userId of targets) {
      // Nick main + không phải owner → body đã che; owner (hoặc nick thường) → body thật.
      const body = isPrivate && userId !== ownerUserId ? redactedBody : realBody;
      await sendPushToUser(userId, { title, body, data });
    }
  } catch (err) {
    logger.warn('[push] notifyNewInboundMessage failed:', (err as Error).message);
  }
}
