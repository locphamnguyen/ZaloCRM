import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { renderMessageTemplate } from '../template-renderer.js';
import { zaloPool } from '../../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../../zalo/zalo-rate-limiter.js';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../../contacts/contact-aggregate.js';
import { formatMessage } from '../../../shared/text-formatter.js';

export async function sendTemplateAction(input: {
  templateId: string;
  orgId: string;
  conversationId: string;
  zaloAccountId: string;
  threadId: string | null;
  threadType: string;
  context: {
    org?: { id: string; name: string | null } | null;
    contact?: { id: string; fullName: string | null; crmName?: string | null; phone: string | null; status: string | null } | null;
    conversation?: { id: string } | null;
  };
}) {
  if (!input.threadId) return null;

  const template = await prisma.messageTemplate.findFirst({
    where: { id: input.templateId, orgId: input.orgId },
    select: { id: true, content: true },
  });
  if (!template) return null;

  const content = renderMessageTemplate(template.content, input.context).trim();
  if (!content) return null;

  // T7b (YC2 2026-06-20): nick ĐÃ XÓA (archivedAt) → automation BỎ QUA im lặng (đúng — nick
  // ngừng làm việc thì không tự gửi). Tránh chạy xuống SDK với api null/lỗi mơ hồ.
  const acc = await prisma.zaloAccount.findUnique({
    where: { id: input.zaloAccountId },
    select: { archivedAt: true },
  });
  if (acc?.archivedAt) return null;

  const instance = zaloPool.getInstance(input.zaloAccountId);
  if (!instance?.api) return null;

  const limits = await zaloRateLimiter.checkLimits(input.zaloAccountId);
  if (!limits.allowed) return null;

  zaloRateLimiter.recordSend(input.zaloAccountId);
  const threadType = input.threadType === 'group' ? 1 : 0;

  // Phase 6 polish — convert markdown trong template (**bold**, *italic*, {red}...{/red})
  // → Zalo style ranges. Trước fix này, KH nhận `**Bold**` plain text.
  const formatted = formatMessage(content);
  const sendPayload: Record<string, unknown> = { msg: formatted.text };
  if (formatted.styles?.length) sendPayload.styles = formatted.styles;
  if (formatted.mentions?.length) sendPayload.mentions = formatted.mentions;

  const sendResult = await instance.api.sendMessage(sendPayload, input.threadId, threadType);
  const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');

  const created = await prisma.message.create({
    data: {
      id: randomUUID(),
      conversationId: input.conversationId,
      zaloMsgId: zaloMsgId || null,
      zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
      senderType: 'self',
      senderUid: null,
      senderName: 'Automation',
      content,
      contentType: 'text',
      sentAt: new Date(),
      // Phase metrics 2026-05-22: bot gửi
      sentVia: 'automation',
    },
  });

  const aggInput = {
    conversationId: input.conversationId,
    message: {
      id: created.id,
      content: created.content,
      contentType: created.contentType,
      sentAt: created.sentAt,
      senderType: 'self' as const,
    },
  };
  void applyContactAggregateFromMessage(aggInput);
  void applyFriendAggregate(aggInput);

  return created;
}
