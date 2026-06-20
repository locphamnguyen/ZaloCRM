// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * M53 2026-05-30 — AI Trợ Lý cho Virtual Chat (KH no-Zalo).
 * Anh chốt 2026-05-30: KHÔNG auto-quét Zalo (M52). AI chỉ chạy khi sale gõ tin
 * trong virtual conv, fire-and-forget từ chat-routes, emit kết quả qua socket.
 *
 * Flow:
 * 1. shouldTriggerAi() — skip nếu tin <5 ký tự HOẶC match noise regex
 * 2. throttle Redis 5s/conv — tránh spam
 * 3. buildContext() — load 10 tin gần nhất + Contact context + prompt
 * 4. generateText() — gọi AI provider (Gemini mặc định)
 * 5. parseResponse() — split text reply + JSON entities, validate Zod
 * 6. Lưu Message senderType='ai_assistant' + metadata.extracted
 * 7. Emit socket 'chat:message' + 'chat:ai-suggestion'
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getAiConfig, getProviderApiKey, generateText } from './ai-service.js';
import { getProviderBaseUrl } from './provider-registry.js';
import { DEFAULT_VIRTUAL_CHAT_PROMPT } from './prompts/virtual-chat-assistant.js';
import { safeParseEntities, type ExtractedEntities } from './schemas/extracted-entities.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { assertAiCapability, auditAiAction } from './ai-capabilities.js';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';

const THROTTLE_MS = 5_000;
const throttleMap = new Map<string, number>(); // in-memory fallback (no Redis)
const AI_TIMEOUT_MS = 15_000;

interface TriggerInput {
  conversationId: string;
  triggerMessageId: string;
  orgId: string;
}

/**
 * Fire-and-forget entry point. Gọi từ chat-routes sau khi save sale message
 * trong virtual conv. KHÔNG block HTTP response.
 */
export async function triggerVirtualChatAiReply(
  input: TriggerInput,
  io: Server | null,
): Promise<void> {
  // Phase 6 #12 — AI tự hành động in-process: bọc withTenant để MỌI DB op của AI
  // mang tenant context (qua tenant-guard + RLS khi enforce). AI không vượt mặt
  // gateway như một user vô danh.
  await withTenant(input.orgId, () => runVirtualChatAiReply(input, io));
}

async function runVirtualChatAiReply(
  input: TriggerInput,
  io: Server | null,
): Promise<void> {
  try {
    const { conversationId, triggerMessageId, orgId } = input;

    // 1. Throttle 5s/conversation
    const lastFire = throttleMap.get(conversationId) ?? 0;
    if (Date.now() - lastFire < THROTTLE_MS) {
      logger.debug(`[ai-virtual-chat] Throttled conv=${conversationId}`);
      return;
    }
    throttleMap.set(conversationId, Date.now());

    // 2. Load AI config + check enabled + quota
    const config = await getAiConfig(orgId);
    if (!config.enabled || !config.aiAssistantEnabled) {
      logger.debug(`[ai-virtual-chat] Disabled for org=${orgId}`);
      return;
    }

    // Quota check
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const usedToday = await prisma.aiSuggestion.count({
      where: { orgId, createdAt: { gte: startOfDay } },
    });
    if (usedToday >= config.maxDaily) {
      logger.warn(`[ai-virtual-chat] Quota exhausted org=${orgId} used=${usedToday}/${config.maxDaily}`);
      io?.emit('chat:ai-quota-exhausted', { orgId, usedToday, maxDaily: config.maxDaily });
      return;
    }

    // 3. Load trigger message + check skip noise
    const triggerMsg = await prisma.message.findFirst({
      where: { id: triggerMessageId, conversationId },
      select: { content: true, senderType: true },
    });
    if (!triggerMsg || triggerMsg.senderType !== 'self') return;
    const content = (triggerMsg.content ?? '').trim();
    if (!shouldTriggerAi(content, config.aiAssistantSkipNoisePattern)) {
      logger.debug(`[ai-virtual-chat] Skip noise content="${content.slice(0, 30)}"`);
      return;
    }

    // 4. Build context
    const ctx = await buildContext(conversationId, orgId);
    if (!ctx) return;

    const apiKey = await getProviderApiKey(orgId, config.provider);
    if (!apiKey) {
      logger.warn(`[ai-virtual-chat] No API key for provider=${config.provider}`);
      return;
    }

    const systemPrompt = config.aiAssistantPromptTemplate || DEFAULT_VIRTUAL_CHAT_PROMPT;
    const userPrompt = buildUserPrompt(ctx);

    // 5. Generate AI reply with timeout
    let raw: string;
    try {
      raw = await Promise.race([
        generateText(config.provider, apiKey, config.model, systemPrompt, userPrompt, 800, await getProviderBaseUrl(orgId, config.provider)),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('AI timeout')), AI_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      logger.warn(`[ai-virtual-chat] AI failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // 6. Parse response — split text + JSON
    const { reply, entities } = parseResponse(raw);
    if (!reply) {
      logger.warn(`[ai-virtual-chat] Empty reply parsed`);
      return;
    }

    // 7. Save AI message + emit socket — capability check (deny-by-default).
    assertAiCapability('save_ai_message');
    const localMsgId = `local:${randomUUID()}`;
    const aiMessage = await prisma.message.create({
      data: {
        id: randomUUID(),
        conversationId,
        zaloMsgId: localMsgId,
        zaloMsgIdNum: null,
        senderType: 'ai_assistant',
        senderUid: 'ai:virtual-chat',
        senderName: 'Trợ lý',
        content: reply,
        contentType: 'text',
        sentAt: new Date(),
        isLocal: true,
        sentVia: 'system',
        ...(entities
          ? { metadata: { extracted: entities, source: 'gemini-virtual-chat' } as object }
          : {}),
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // Track quota
    await prisma.aiSuggestion.create({
      data: {
        orgId,
        conversationId,
        messageId: aiMessage.id,
        type: 'virtual_chat_reply',
        content: reply.slice(0, 2000),
        confidence: entities?.confidenceScore ?? 0,
      },
    });

    // Audit hành động AI tự động (actorType='bot').
    auditAiAction(orgId, 'virtual_chat_reply', { conversationId, messageId: aiMessage.id });

    const safeMessage = { ...aiMessage, zaloMsgIdNum: null as string | null };
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { zaloAccountId: true, zaloAccount: { select: { privacyMode: true, ownerUserId: true } } },
    });
    // PRIVACY 2026-06-11: qua emit-chat (redact + scope org).
    await emitChatMessage({
      io,
      orgId,
      accountId: conv?.zaloAccountId ?? '',
      conversationId,
      message: safeMessage,
      privacyMode: conv?.zaloAccount?.privacyMode ?? 'sub',
      ownerUserId: conv?.zaloAccount?.ownerUserId ?? null,
      extra: { _virtual: true, _aiAssistant: true },
    });
    if (entities) {
      // ai-suggestion chỉ là entities (metadata), scope org để chặn cross-tenant.
      io?.to(`org:${orgId}`).emit('chat:ai-suggestion', {
        conversationId,
        messageId: aiMessage.id,
        entities,
      });
    }
  } catch (err) {
    logger.error('[ai-virtual-chat] Trigger error:', err);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function shouldTriggerAi(content: string, skipPattern: string): boolean {
  if (!content || content.length < 5) return false;
  try {
    const re = new RegExp(skipPattern, 'i');
    return !re.test(content);
  } catch {
    // Bad regex from admin → fail open (trigger AI)
    return true;
  }
}

interface ContextData {
  history: Array<{ role: 'sale' | 'ai'; content: string }>;
  contact: {
    fullName: string | null;
    phone: string | null;
    gender: string | null;
    birthYear: number | null;
    occupation: string | null;
    incomeRange: string | null;
    province: string | null;
    district: string | null;
    source: string | null;
  };
  latestSaleMessage: string;
}

async function buildContext(conversationId: string, orgId: string): Promise<ContextData | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId, isVirtual: true },
    include: {
      contact: {
        select: {
          fullName: true,
          phone: true,
          gender: true,
          birthYear: true,
          occupation: true,
          incomeRange: true,
          province: true,
          district: true,
          source: true,
        },
      },
      messages: {
        where: { isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: 10,
        select: { senderType: true, content: true, sentAt: true },
      },
    },
  });
  if (!conv) return null;
  const ordered = [...conv.messages].reverse();
  const latestSale = ordered.filter((m) => m.senderType === 'self').slice(-1)[0];
  if (!latestSale) return null;
  return {
    history: ordered.map((m) => ({
      role: m.senderType === 'ai_assistant' ? ('ai' as const) : ('sale' as const),
      content: m.content ?? '',
    })),
    contact: conv.contact ?? {
      fullName: null, phone: null, gender: null, birthYear: null,
      occupation: null, incomeRange: null, province: null, district: null, source: null,
    },
    latestSaleMessage: latestSale.content ?? '',
  };
}

function buildUserPrompt(ctx: ContextData): string {
  const contactSummary = JSON.stringify(ctx.contact, null, 2);
  const historyText = ctx.history
    .map((h) => `[${h.role === 'sale' ? 'SALE' : 'TRỢ LÝ'}]: ${h.content}`)
    .join('\n');
  return [
    '<contact_context>',
    contactSummary,
    '</contact_context>',
    '',
    '<conversation_history>',
    historyText,
    '</conversation_history>',
    '',
    '<latest_sale_message>',
    ctx.latestSaleMessage,
    '</latest_sale_message>',
    '',
    'Hãy reply theo nhiệm vụ 1 + 2 trong system prompt. KHÔNG quên block ---JSON---.',
  ].join('\n');
}

/**
 * Parse AI response → tách text reply + JSON entities.
 * Format mong đợi: [reply text]\n---JSON---\n{...}
 */
export function parseResponse(raw: string): {
  reply: string;
  entities: ExtractedEntities | null;
} {
  if (!raw) return { reply: '', entities: null };
  const separator = '---JSON---';
  const idx = raw.indexOf(separator);
  if (idx < 0) {
    // Không có JSON block — return reply text only
    return { reply: raw.trim(), entities: null };
  }
  const replyPart = raw.slice(0, idx).trim();
  let jsonPart = raw.slice(idx + separator.length).trim();
  // Strip code fences nếu có
  jsonPart = jsonPart.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let entities: ExtractedEntities | null = null;
  try {
    const parsed = JSON.parse(jsonPart);
    const validated = safeParseEntities(parsed);
    if (validated.success) {
      entities = validated.data;
    } else {
      logger.warn(`[ai-virtual-chat] Entities validation failed: ${validated.error}`);
    }
  } catch (err) {
    logger.warn(`[ai-virtual-chat] JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { reply: replyPart || raw.trim(), entities };
}
