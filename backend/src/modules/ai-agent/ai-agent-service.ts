// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AI Agent 24/7 — tự trả lời khách trên nick Zalo cá nhân.
 *
 * Luồng: message-handler phát `message_received` (chỉ tin KH, không phải backfill) →
 * agent hẹn giờ trả lời cho hội thoại đó (debounce: khách nhắn liên tiếp thì gộp lại,
 * trả lời 1 lần) → tới giờ thì kiểm tra lại mọi điều kiện an toàn → gọi AI → gửi Zalo.
 *
 * An toàn chống khoá nick:
 *  - Mặc định TẮT, chỉ chạy trên nick được chọn, chỉ hội thoại 1-1 (không nhóm).
 *  - Chỉ TRẢ LỜI khách vừa nhắn (không bao giờ nhắn chủ động).
 *  - Delay ngẫu nhiên như người gõ + trần per nick/giờ, per nick/ngày, per hội thoại/ngày,
 *    cộng thêm rate limiter chung của hệ thống (zaloOps).
 *  - Sale vừa nhắn trong hội thoại → agent nhường. Khách cần người thật → gửi câu chuyển
 *    tiếp 1 lần rồi im lặng handoffPauseHours.
 *
 * Giới hạn: timer nằm trong RAM — restart backend thì tin đang chờ sẽ không được trả lời.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { automationEventBus, type AutomationEvent } from '../../shared/ee-registry/event-bus.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { getIo } from '../../shared/event-buffer.js';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { getAiConfig, getProviderApiKey, generateText } from '../ai/ai-service.js';
import { getProviderBaseUrl } from '../ai/provider-registry.js';
import { buildAgentSystemPrompt } from './ai-agent-prompt.js';
import { computeReplyDelayMs, isWithinWorkHours, matchesHandoff, parseAgentOutput } from './ai-agent-rules.js';

export const AGENT_SENT_VIA = 'ai_agent';
const CONTEXT_MESSAGES = 20;

type AgentConfig = Awaited<ReturnType<typeof getAgentConfig>>;

const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
let unsubscribe: (() => void) | null = null;

export async function getAgentConfig(orgId: string) {
  const existing = await prisma.aiAgentConfig.findUnique({ where: { orgId } });
  if (existing) return existing;
  return prisma.aiAgentConfig.create({ data: { orgId } });
}

export function agentNickIds(cfg: { zaloAccountIds: unknown }): string[] {
  return Array.isArray(cfg.zaloAccountIds) ? (cfg.zaloAccountIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

export function registerAiAgent(): void {
  if (unsubscribe) return;
  unsubscribe = automationEventBus.onType(['message_received'], (event) => onMessageReceived(event));
  logger.info('[ai-agent] listener registered');
}

export function stopAiAgent(): void {
  unsubscribe?.();
  unsubscribe = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

/** Số hội thoại đang chờ agent trả lời (hiển thị trên trang cài đặt). */
export function pendingCount(): number {
  return timers.size;
}

async function onMessageReceived(event: AutomationEvent): Promise<void> {
  const payload = (event.payload ?? {}) as { conversationId?: string; zaloAccountId?: string };
  const { conversationId, zaloAccountId } = payload;
  if (!conversationId || !zaloAccountId) return;

  await withTenant(event.orgId, async () => {
    const cfg = await getAgentConfig(event.orgId);
    if (!cfg.enabled || !agentNickIds(cfg).includes(zaloAccountId)) return;

    const delay = computeReplyDelayMs({
      mode: cfg.mode,
      now: new Date(),
      workStart: cfg.workStart,
      workEnd: cfg.workEnd,
      timezone: cfg.timezone,
      staffGraceMinutes: cfg.staffGraceMinutes,
      minDelaySec: cfg.minDelaySec,
      maxDelaySec: cfg.maxDelaySec,
    });
    schedule(event.orgId, conversationId, delay);
  });
}

function schedule(orgId: string, conversationId: string, delayMs: number) {
  const prev = timers.get(conversationId);
  if (prev) clearTimeout(prev); // khách nhắn tiếp → gộp, tính lại từ tin mới nhất
  const t = setTimeout(() => {
    timers.delete(conversationId);
    void withTenant(orgId, () => replyIfStillNeeded(orgId, conversationId)).catch((err) =>
      logger.error('[ai-agent] reply failed:', err),
    );
  }, delayMs);
  t.unref?.();
  timers.set(conversationId, t);
}

async function replyIfStillNeeded(orgId: string, conversationId: string): Promise<void> {
  if (running.has(conversationId)) return;
  running.add(conversationId);
  try {
    await doReply(orgId, conversationId);
  } finally {
    running.delete(conversationId);
  }
}

function skip(conversationId: string, reason: string) {
  logger.info(`[ai-agent] skip conv=${conversationId}: ${reason}`);
}

async function doReply(orgId: string, conversationId: string): Promise<void> {
  const cfg = await getAgentConfig(orgId);
  if (!cfg.enabled) return skip(conversationId, 'agent disabled');

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    select: {
      id: true,
      zaloAccountId: true,
      threadType: true,
      externalThreadId: true,
      isVirtual: true,
      deletedAt: true,
      contact: { select: { fullName: true, crmName: true } },
      zaloAccount: { select: { status: true, zaloUid: true, privacyMode: true, ownerUserId: true, org: { select: { name: true } } } },
    },
  });
  if (!conversation) return skip(conversationId, 'conversation not found');
  if (!agentNickIds(cfg).includes(conversation.zaloAccountId)) return skip(conversationId, 'nick not enabled');
  if (conversation.threadType !== 'user' || conversation.isVirtual || conversation.deletedAt) return skip(conversationId, 'not a 1-1 Zalo chat');
  if (!conversation.externalThreadId) return skip(conversationId, 'missing thread id');

  const recent = await prisma.message.findMany({
    where: { conversationId, isDeleted: false },
    orderBy: { sentAt: 'desc' },
    take: CONTEXT_MESSAGES,
    select: { senderType: true, content: true, contentType: true, sentAt: true, sentVia: true, metadata: true },
  });
  if (recent.length === 0 || recent[0].senderType !== 'contact') return skip(conversationId, 'already answered');

  const now = Date.now();

  // Sale vừa nhắn trong hội thoại → nhường cho người thật.
  const lastStaff = recent.find((m) => m.senderType === 'self' && m.sentVia !== AGENT_SENT_VIA);
  if (lastStaff && now - lastStaff.sentAt.getTime() < cfg.staffTakeoverMinutes * 60_000) {
    return skip(conversationId, 'staff is handling this chat');
  }

  // Đã chuyển người thật gần đây → im lặng.
  const lastHandoff = await prisma.message.findFirst({
    where: { conversationId, sentVia: AGENT_SENT_VIA, sentAt: { gte: new Date(now - cfg.handoffPauseHours * 3_600_000) }, metadata: { path: ['aiAgent', 'handoff'], equals: true } },
    select: { id: true },
  });
  if (lastHandoff) return skip(conversationId, 'handed off to staff');

  // Trần số tin agent gửi.
  const dayAgo = new Date(now - 24 * 3_600_000);
  const hourAgo = new Date(now - 3_600_000);
  const nickWhere = { sentVia: AGENT_SENT_VIA, conversation: { zaloAccountId: conversation.zaloAccountId } };
  const [nickHour, nickDay, convDay] = await Promise.all([
    prisma.message.count({ where: { ...nickWhere, sentAt: { gte: hourAgo } } }),
    prisma.message.count({ where: { ...nickWhere, sentAt: { gte: dayAgo } } }),
    prisma.message.count({ where: { conversationId, sentVia: AGENT_SENT_VIA, sentAt: { gte: dayAgo } } }),
  ]);
  if (nickHour >= cfg.maxPerNickHour) return skip(conversationId, `nick hourly cap ${cfg.maxPerNickHour}`);
  if (nickDay >= cfg.maxPerNickDay) return skip(conversationId, `nick daily cap ${cfg.maxPerNickDay}`);
  if (convDay >= cfg.maxPerConversationDay) return skip(conversationId, `conversation daily cap ${cfg.maxPerConversationDay}`);

  // Tin khách chưa được trả lời (từ tin cuối của mình trở về sau).
  const pendingCustomer: string[] = [];
  for (const m of recent) {
    if (m.senderType !== 'contact') break;
    pendingCustomer.unshift(describeMessage(m));
  }
  const customerText = pendingCustomer.join('\n');

  let reply: string;
  let handoff = false;
  if (matchesHandoff(customerText, cfg.handoffKeywords)) {
    reply = cfg.handoffMessage;
    handoff = true;
  } else {
    const generated = await generateReply(orgId, cfg, conversation, recent);
    if (!generated) return skip(conversationId, 'AI unavailable');
    handoff = generated.handoff;
    reply = generated.text || cfg.handoffMessage;
  }

  await sendAgentMessage({ orgId, conversation, content: reply, handoff });
}

function describeMessage(m: { content: string | null; contentType: string }): string {
  if (m.contentType === 'text' || m.contentType === 'rich') return m.content || '';
  const label: Record<string, string> = { image: '[Khách gửi hình ảnh]', video: '[Khách gửi video]', file: '[Khách gửi file]', sticker: '[Sticker]', voice: '[Tin nhắn thoại]', link: `[Link] ${m.content || ''}` };
  return label[m.contentType] ?? `[${m.contentType}]`;
}

async function generateReply(
  orgId: string,
  cfg: AgentConfig,
  conversation: { id: string; contact: { fullName: string | null; crmName: string | null } | null; zaloAccount: { org: { name: string } } },
  recentDesc: Array<{ senderType: string; content: string | null; contentType: string; sentAt: Date; sentVia: string }>,
): Promise<{ text: string; handoff: boolean } | null> {
  const ai = await getAiConfig(orgId);
  if (!ai.enabled) return null;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const used = await prisma.aiSuggestion.count({ where: { orgId, createdAt: { gte: startOfDay } } });
  if (used >= ai.maxDaily) return null;
  const apiKey = await getProviderApiKey(orgId, ai.provider);
  if (!apiKey) return null;

  const history = [...recentDesc]
    .reverse()
    .map((m) => `${m.senderType === 'self' ? 'Shop' : 'Khách'}: ${describeMessage(m).replace(/<\/?hoi_thoai>/gi, '')}`)
    .join('\n');
  const customerName = conversation.contact?.crmName || conversation.contact?.fullName || 'khách';
  const offHours = !isWithinWorkHours(new Date(), cfg.workStart, cfg.workEnd, cfg.timezone);
  const system = buildAgentSystemPrompt({ knowledgeBase: cfg.knowledgeBase, storeName: conversation.zaloAccount.org.name, offHours });
  const prompt = `Tên khách: ${customerName}\n<hoi_thoai>\n${history}\n</hoi_thoai>\nViết tin nhắn trả lời tiếp theo của Shop.`;

  try {
    const raw = await generateText(ai.provider, apiKey, ai.model, system, prompt, 400, await getProviderBaseUrl(orgId, ai.provider));
    const parsed = parseAgentOutput(raw);
    await prisma.aiSuggestion.create({
      data: { orgId, conversationId: conversation.id, type: 'agent_reply', content: parsed.text, confidence: parsed.handoff ? 0.5 : 0.8, accepted: true },
    });
    return parsed;
  } catch (err) {
    logger.error('[ai-agent] AI generate error:', err);
    return null;
  }
}

async function sendAgentMessage(input: {
  orgId: string;
  conversation: {
    id: string;
    zaloAccountId: string;
    externalThreadId: string | null;
    zaloAccount: { zaloUid: string | null; privacyMode: string; ownerUserId: string };
  };
  content: string;
  handoff: boolean;
}): Promise<void> {
  const { orgId, conversation, content, handoff } = input;
  let zaloMsgId = '';
  try {
    const result = (await zaloOps.sendMessage(conversation.zaloAccountId, conversation.externalThreadId!, 0, { msg: content })) as {
      message?: { msgId?: number | string } | null;
    };
    zaloMsgId = String(result?.message?.msgId ?? '');
  } catch (err) {
    logger.warn(`[ai-agent] Zalo send failed conv=${conversation.id}: ${(err as Error)?.message}`);
    return;
  }

  const message = await prisma.message.create({
    data: {
      id: randomUUID(),
      conversationId: conversation.id,
      zaloMsgId: zaloMsgId || null,
      zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
      senderType: 'self',
      senderUid: conversation.zaloAccount.zaloUid || '',
      senderName: 'AI Agent',
      content,
      contentType: 'text',
      sentAt: new Date(),
      sentVia: AGENT_SENT_VIA,
      metadata: { sender: { kind: 'ai_agent', name: 'AI Agent' }, aiAgent: { handoff } },
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    // handoff → để isReplied=false cho sale thấy trong bộ lọc "chưa trả lời".
    data: { lastMessageAt: new Date(), isReplied: !handoff },
  });

  await emitChatMessage({
    io: getIo(),
    orgId,
    accountId: conversation.zaloAccountId,
    conversationId: conversation.id,
    message: { ...message, zaloMsgIdNum: message.zaloMsgIdNum?.toString() ?? null },
    privacyMode: conversation.zaloAccount.privacyMode,
    ownerUserId: conversation.zaloAccount.ownerUserId,
  }).catch(() => {});

  logger.info(`[ai-agent] replied conv=${conversation.id}${handoff ? ' (handoff)' : ''}`);
}
