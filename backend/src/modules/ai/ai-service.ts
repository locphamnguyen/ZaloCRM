// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import { getProviderConfig, getAvailableProviders, resolveProviderApiKey, getProviderBaseUrl } from './provider-registry.js';
import { generateWithAnthropic } from './providers/anthropic.js';
import { generateWithGemini } from './providers/gemini.js';
import { generateWithOpenaiCompat } from './providers/openai-compat.js';
import { buildReplyDraftPrompt } from './prompts/reply-draft.js';
import { buildSummaryPrompt } from './prompts/summary.js';
import { buildSentimentPrompt } from './prompts/sentiment.js';
import { parseAppointmentRuleBased } from './appointment-fallback-parser.js';

export type AiTaskType = 'reply_draft' | 'summary' | 'sentiment';

type MessageContext = { senderType: string; senderName: string | null; content: string | null; sentAt: Date };
type SentimentResult = { label: 'positive' | 'neutral' | 'negative'; confidence: number; reason: string };

function detectLanguage(text: string): 'vi' | 'en' {
  if (/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text)) return 'vi';
  const vietnameseHints = [' khách ', ' chào ', ' tư vấn ', ' báo giá ', ' sản phẩm ', ' giúp ', ' nhé ', ' không '];
  return vietnameseHints.some((hint) => (` ${text.toLowerCase()} `).includes(hint)) ? 'vi' : 'en';
}

function escapeXmlBoundary(text: string): string {
  return text.replace(/<\/?conversation_context>/gi, '');
}

function buildConversationContext(messages: MessageContext[]) {
  return messages
    .map((msg) => {
      const author = msg.senderType === 'self' ? 'staff' : (msg.senderName || 'customer');
      const content = escapeXmlBoundary(msg.content || '(empty)');
      return `[${msg.sentAt.toISOString()}] ${author}: ${content}`;
    })
    .join('\n');
}

// M53 2026-05-30: exported để ai-virtual-chat-service reuse
export async function getProviderApiKey(orgId: string, provider: string) {
  /* Ưu tiên key per-org (UI, mã hoá) → legacy plain → env fallback. */
  return resolveProviderApiKey(orgId, provider);
}

export async function getAiConfig(orgId: string) {
  let aiConfig = await prisma.aiConfig.findUnique({ where: { orgId } });
  if (!aiConfig) {
    aiConfig = await prisma.aiConfig.create({
      data: { orgId, provider: config.aiDefaultProvider, model: config.aiDefaultModel, maxDaily: 500, enabled: true },
    });
  }
  const availableProviders = await getAvailableProviders(orgId);
  return { ...aiConfig, availableProviders };
}

export async function updateAiConfig(orgId: string, input: { provider?: string; model?: string; maxDaily?: number; enabled?: boolean }) {
  return prisma.aiConfig.upsert({
    where: { orgId },
    create: {
      orgId,
      provider: input.provider || config.aiDefaultProvider,
      model: input.model || config.aiDefaultModel,
      maxDaily: input.maxDaily ?? 500,
      enabled: input.enabled ?? true,
    },
    update: {
      provider: input.provider,
      model: input.model,
      maxDaily: input.maxDaily,
      enabled: input.enabled,
    },
  });
}

export async function getAiUsage(orgId: string) {
  const currentConfig = await getAiConfig(orgId);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const usedToday = await prisma.aiSuggestion.count({ where: { orgId, createdAt: { gte: startOfDay } } });
  return {
    usedToday,
    maxDaily: currentConfig.maxDaily,
    remaining: Math.max(0, currentConfig.maxDaily - usedToday),
    enabled: currentConfig.enabled,
  };
}

async function loadConversation(conversationId: string, orgId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    include: {
      contact: { select: { fullName: true } },
      messages: {
        where: { isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: 40,
        select: { senderType: true, senderName: true, content: true, sentAt: true },
      },
    },
  });
  if (!conversation) throw new Error('Conversation not found');
  return { ...conversation, messages: [...conversation.messages].reverse() };
}

// M53 2026-05-30: exported để ai-virtual-chat-service reuse
export async function generateText(provider: string, apiKey: string, model: string, system: string, prompt: string, maxTokens?: number, baseUrlOverride?: string) {
  const providerDef = getProviderConfig(provider);
  const baseUrl = baseUrlOverride || providerDef?.baseUrl || '';

  if (provider === 'anthropic') return generateWithAnthropic(baseUrl, apiKey, model, system, prompt, maxTokens);
  if (provider === 'gemini') return generateWithGemini(baseUrl, apiKey, model, system, prompt, maxTokens);

  /* OpenAI, Qwen, Kimi all use OpenAI-compatible chat/completions API */
  if (provider === 'openai') return generateWithOpenaiCompat(`${baseUrl}/v1/chat/completions`, apiKey, model, system, prompt, maxTokens, 'max_completion_tokens');
  if (provider === 'qwen') return generateWithOpenaiCompat(`${baseUrl}/compatible-mode/v1/chat/completions`, apiKey, model, system, prompt, maxTokens);
  if (provider === 'kimi') return generateWithOpenaiCompat(`${baseUrl}/v1/chat/completions`, apiKey, model, system, prompt, maxTokens);

  throw new Error(`Unsupported AI provider: ${provider}`);
}

async function saveSuggestion(input: { orgId: string; conversationId: string | null; messageId?: string; type: AiTaskType; content: string; confidence: number }) {
  return prisma.aiSuggestion.create({
    data: {
      orgId: input.orgId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      confidence: input.confidence,
    },
  });
}

export async function generateAiOutput(input: { orgId: string; conversationId: string; type: AiTaskType; messageId?: string }) {
  const [currentConfig, conversation] = await Promise.all([
    getAiConfig(input.orgId),
    loadConversation(input.conversationId, input.orgId),
  ]);

  if (!currentConfig.enabled) throw new Error('AI is disabled for this organization');

  // Atomic quota check — count inside transaction to prevent TOCTOU race
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const withinQuota = await tenantTransaction(async (tx) => {
    const usedToday = await tx.aiSuggestion.count({ where: { orgId: input.orgId, createdAt: { gte: startOfDay } } });
    return usedToday < currentConfig.maxDaily;
  });
  if (!withinQuota) throw new Error('AI daily quota exceeded');

  const apiKey = await getProviderApiKey(input.orgId, currentConfig.provider);
  if (!apiKey) throw new Error('AI provider key is not configured');

  const contextText = buildConversationContext(conversation.messages);
  const language = detectLanguage(contextText);
  const customerName = conversation.contact?.fullName || 'customer';
  const userPrompt = [
    `<conversation_context>`,
    `Customer: ${customerName}`,
    contextText,
    `</conversation_context>`,
  ].join('\n');

  const system = input.type === 'reply_draft'
    ? buildReplyDraftPrompt(language)
    : input.type === 'summary'
      ? buildSummaryPrompt(language)
      : buildSentimentPrompt(language);

  const raw = await generateText(currentConfig.provider, apiKey, currentConfig.model, system, userPrompt, undefined, await getProviderBaseUrl(input.orgId, currentConfig.provider));

  if (input.type === 'sentiment') {
    let parsed: SentimentResult;
    try {
      parsed = JSON.parse(raw) as SentimentResult;
    } catch {
      parsed = { label: 'neutral', confidence: 0.4, reason: raw };
    }
    const normalized = {
      label: ['positive', 'negative', 'neutral'].includes(parsed.label) ? parsed.label : 'neutral',
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0.4,
      reason: parsed.reason || raw,
    };
    await saveSuggestion({
      orgId: input.orgId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      type: 'sentiment',
      content: JSON.stringify(normalized),
      confidence: normalized.confidence,
    });
    return normalized;
  }

  const text = raw.trim();
  await saveSuggestion({
    orgId: input.orgId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    type: input.type,
    content: text,
    confidence: 0.8,
  });
  return { content: text, confidence: 0.8 };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Parse a free-form note ("Thứ 6 gọi lại khách", "3 ngày nữa nhắn tin chốt giá")
 * into a structured appointment proposal. Returns null if AI can't find a clear
 * date/time intent — caller falls back to manual create.
 * ────────────────────────────────────────────────────────────────────────── */
export type ParsedAppointment = {
  date: string | null;       // YYYY-MM-DD
  time: string | null;       // HH:MM (24h)
  type: string | null;       // 'call' | 'message' | 'meeting' | 'follow_up' | null
  location: string | null;   // địa điểm gặp (nếu detect)
  summary: string;           // tiêu đề ngắn cho lịch hẹn
  hasIntent: boolean;        // true nếu phát hiện ý định lập lịch (kể cả thông tin chưa đủ)
  missingFields: string[];   // ['date','time','location'] — field nào AI thiếu, FE prompt user điền
  confidence: number;        // 0..1
  source?: 'ai' | 'fallback'; // 'ai'=Gemini OK, 'fallback'=rule-based (AI fail/quota)
};

export async function parseAppointmentFromText(input: { orgId: string; text: string; now?: Date }): Promise<ParsedAppointment & { source?: 'ai' | 'fallback' } | null> {
  const now = input.now || new Date();
  const currentConfig = await getAiConfig(input.orgId);

  // ── Fallback rule-based parser luôn chạy trước/song song để có kết quả nếu AI fail.
  //    Result được trả nếu AI throw (429 quota, timeout, network). source='fallback'
  //    để FE hiển thị hint "AI hết quota — đã dùng rule-based".
  const fallback = parseAppointmentRuleBased(input.text, now);

  if (!currentConfig.enabled) {
    // AI tắt → chỉ trả fallback nếu có intent
    return fallback.hasIntent ? { ...fallback, source: 'fallback' } : null;
  }
  const apiKey = await getProviderApiKey(input.orgId, currentConfig.provider);
  if (!apiKey) {
    logger.warn('[ai-parse] No API key — using rule-based fallback');
    return fallback.hasIntent ? { ...fallback, source: 'fallback' } : null;
  }
  const today = now.toISOString().slice(0, 10);
  const weekday = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][now.getDay()];

  const system = [
    'You parse a Vietnamese CRM note into an appointment proposal. Return STRICT JSON ONLY, no prose.',
    'Output schema:',
    '{ "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "type": "call"|"message"|"meeting"|"follow_up"|null, "location": string|null, "summary": string, "hasIntent": boolean, "missingFields": string[], "confidence": number_0_to_1 }',
    '',
    'PHÁT HIỆN Ý ĐỊNH RỘNG (hasIntent=true):',
    '- BẤT KỲ từ khoá thời gian: "thứ X", "ngày N", "DD/MM", "mai", "kia", "tuần sau", "tháng sau", "N ngày nữa", "sáng/chiều/tối", "lúc HH giờ", "trước/sau Tết", "đầu/giữa/cuối tháng", "đầu/cuối tuần"',
    '- HOẶC từ khoá hành động hẹn: "gọi lại", "nhắn lại", "gặp", "ghé", "đến", "chốt", "ký", "xem nhà", "qua văn phòng", "tới chỗ"',
    '- HOẶC từ khoá địa điểm: "tại [địa điểm]", "ở [địa điểm]", "[tên building/đường/quận]", "VP", "showroom", "căn hộ", "dự án [name]"',
    '- HOẶC từ khoá quan tâm cần theo dõi: "follow up", "theo dõi", "check lại", "phải gọi"',
    '→ Có 1 trong các nhóm trên → hasIntent=true. Trả các field detect được, field nào không có → null + thêm vào missingFields.',
    '',
    `Hôm nay là ${today} (${weekday}). Tính ngày tuyệt đối cho "thứ X" (sang tuần tới nếu thứ đã qua), "N ngày nữa", "mai"=ngày mai, "kia"=ngày kia.`,
    '"sáng"=09:00, "chiều"=14:00, "tối"=19:00. "trưa"=12:00.',
    'type rules: "gọi"/"call"→call, "nhắn"→message, "gặp"/"ghé"/"đến"/"xem nhà"→meeting, fallback→follow_up.',
    'location: trích nguyên văn cụm địa điểm nếu có. KHÔNG có → null + thêm "location" vào missingFields.',
    'summary: 1 câu ≤120 ký tự mô tả việc cần làm.',
    '',
    'missingFields: liệt kê field thiếu trong ["date","time","location"] để FE prompt user điền tiếp.',
    'confidence: > 0.7 khi date+time+intent rõ, 0.4-0.7 khi 1-2 field có, < 0.4 khi mơ hồ.',
    '',
    'CHỈ trả hasIntent=false khi note hoàn toàn KHÔNG liên quan hẹn (vd "khách thích nhà 3pn", "đã gửi báo giá").',
    'Khi hasIntent=false → tất cả field null/empty array, confidence=0.',
  ].join('\n');

  const userPrompt = `<note>\n${escapeXmlBoundary(input.text)}\n</note>\nReturn JSON only.`;

  let raw: string;
  try {
    raw = await generateText(currentConfig.provider, apiKey, currentConfig.model, system, userPrompt, undefined, await getProviderBaseUrl(input.orgId, currentConfig.provider));
  } catch (err: unknown) {
    // AI fail (429 quota, timeout, network) → fallback to rule-based parser
    const msg = err instanceof Error ? err.message : String(err);
    const is429 = msg.includes('429');
    if (fallback.hasIntent) {
      logger.warn(`[ai-parse] AI failed (${is429 ? 'quota/rate-limit 429' : msg}) — using rule-based fallback`);
      return { ...fallback, source: 'fallback' };
    }
    // Không fallback được nữa → rethrow để FE biết là AI fail
    throw new Error(is429 ? 'AI hết quota (429) — vui lòng đợi reset hoặc đổi provider' : msg);
  }

  // Strip code fences if model wrapped JSON in ```json ... ```
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: Partial<ParsedAppointment> & { hasIntent?: boolean; missingFields?: string[]; location?: string | null };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    // AI trả response không parse được → fallback
    if (fallback.hasIntent) {
      logger.warn('[ai-parse] AI returned unparseable JSON — using rule-based fallback');
      return { ...fallback, source: 'fallback' };
    }
    return null;
  }

  const hasIntent = !!parsed.hasIntent;
  if (!hasIntent) {
    // AI says no intent — nhưng rule-based có thể detect ra → ưu tiên fallback nếu nó tự tin
    if (fallback.hasIntent && fallback.confidence >= 0.5) {
      logger.info('[ai-parse] AI says no intent but rule-based detected → using fallback');
      return { ...fallback, source: 'fallback' };
    }
    return {
      date: null, time: null, type: null, location: null,
      summary: '', hasIntent: false, missingFields: [], confidence: 0,
    };
  }

  const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence as number)) : 0.4;
  const validType = parsed.type && ['call', 'message', 'meeting', 'follow_up'].includes(parsed.type) ? parsed.type : null;
  const dateOk = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date);
  const timeOk = parsed.time && /^\d{2}:\d{2}$/.test(parsed.time);
  const location = parsed.location ? String(parsed.location).slice(0, 200) : null;

  const missing: string[] = Array.isArray(parsed.missingFields) ? parsed.missingFields.filter((f: string) => ['date', 'time', 'location'].includes(f)) : [];
  // Sanity: đảm bảo missing đúng với data
  if (!dateOk && !missing.includes('date')) missing.push('date');
  if (!timeOk && !missing.includes('time')) missing.push('time');
  if (!location && !missing.includes('location')) missing.push('location');

  return {
    date: dateOk ? parsed.date! : null,
    time: timeOk ? parsed.time! : null,
    type: validType,
    location,
    summary: (parsed.summary || '').slice(0, 200),
    hasIntent: true,
    missingFields: missing,
    confidence,
    source: 'ai',
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * AI Format Rich Text (2026-05-21) — anh paste 1 đoạn raw text (vd giới thiệu
 * dự án bất động sản) → AI return {text, styles[]} format Zalo (bold/italic/
 * color/size). Sale chỉ việc bấm gửi → KH nhận tin sinh động.
 * ────────────────────────────────────────────────────────────────────────── */
export interface ZaloRichStyle { st: string; start: number; len: number }
export interface AiFormatResult { text: string; styles: ZaloRichStyle[]; source: 'ai' | 'fallback' }

// 2026-05-21 v4 fix: switch từ offset-based sang phrase-based. AI bị off-by-one khi
// đếm character với tiếng Việt diacritics + bullets. Format mới: AI trả chuỗi cần
// highlight, BE tự indexOf để tính offset chính xác → robust 100%.
const AI_FORMAT_SYSTEM_PROMPT = `Bạn là chuyên gia format tin nhắn bán hàng tiếng Việt cho Zalo. Nhận 1 đoạn text → trả JSON {"ranges": [...]} liệt kê các chuỗi cần highlight.

OUTPUT SCHEMA:
{
  "ranges": [
    {"phrase": "chuỗi cần highlight", "styles": ["b", "c_db342e"]},
    ...
  ]
}

QUY TẮC:
1. "phrase" PHẢI là chuỗi GIỐNG NGUYÊN VĂN xuất hiện trong input (case-sensitive, đầy đủ dấu tiếng Việt). KHÔNG sửa, KHÔNG bỏ ký tự, KHÔNG thêm khoảng trắng thừa.
2. "styles" là array các style code áp cho phrase đó.
3. Mỗi phrase chỉ apply 1 lần (lần xuất hiện đầu tiên trong text). Nếu cần highlight 2 chỗ giống nhau → list 2 lần.
4. KHÔNG wrap JSON trong markdown. Output JSON thuần.

STYLE CODES:
- "b" = đậm | "i" = nghiêng | "u" = gạch chân | "s" = gạch ngang
- "c_db342e" = đỏ | "c_f27806" = cam | "c_15a85f" = xanh lá | "c_2962ff" = xanh dương

NGUYÊN TẮC FORMAT (chọn lọc, không bôi quá nhiều):
- Tên sản phẩm / dòng đầu nổi bật → ["b", "c_db342e"]
- Số tiền / % giảm / giá → ["b", "c_db342e"]
- Địa chỉ / vị trí → ["b", "c_f27806"]
- Thời gian / deadline / khoảng cách phút → ["b", "c_db342e"]
- USP / lợi ích chính → ["b", "c_15a85f"]
- SĐT / hotline → ["b", "c_2962ff"]
- Highlight quan trọng KHÁC → "b" only

MAX 15 ranges per response. Chọn lọc highlight quan trọng nhất. KHÔNG bôi bullet "- " / "+ ".

VÍ DỤ INPUT:
"- Dự án Sunshine City tọa lạc tại Q.7\\n- Giá từ 2.5 tỷ (giảm 200tr)\\n- Hotline: 0901-123-456"

VÍ DỤ OUTPUT:
{"ranges":[
  {"phrase":"Sunshine City","styles":["b","c_db342e"]},
  {"phrase":"Q.7","styles":["b","c_f27806"]},
  {"phrase":"2.5 tỷ","styles":["b","c_db342e"]},
  {"phrase":"giảm 200tr","styles":["b","c_db342e"]},
  {"phrase":"0901-123-456","styles":["b","c_2962ff"]}
]}`;

function isValidStyleCode(st: string): boolean {
  return /^(b|i|u|s|c_[0-9a-fA-F]{6}|f_\d{1,3}|lst_[12])$/.test(st);
}

/**
 * 2026-05-21 v4: Convert AI response ranges (phrase-based) → Zalo styles (offset-based).
 * Robust với Vietnamese diacritics — KHÔNG dùng AI offset, dùng JS String.indexOf chuẩn.
 *
 * AI return: [{phrase: "Sunshine City", styles: ["b", "c_db342e"]}, ...]
 * Convert: text.indexOf(phrase) → start. phrase.length → len.
 *
 * Edge cases:
 * - phrase không tìm thấy trong text → bỏ qua (AI hallucinate phrase không tồn tại)
 * - Cùng phrase xuất hiện 2 lần trong AI list → highlight 2 chỗ (first + next after first)
 */
function rangesToStyles(text: string, rangesRaw: unknown): ZaloRichStyle[] {
  if (!Array.isArray(rangesRaw)) return [];
  const styles: ZaloRichStyle[] = [];
  // Track lần xuất hiện đã dùng để hỗ trợ phrase duplicate (highlight 2 chỗ).
  const usedOffsets = new Map<string, number>(); // phrase → next searchFrom

  for (const r of rangesRaw) {
    if (!r || typeof r !== 'object') continue;
    const phrase = String((r as { phrase: unknown }).phrase || '').trim();
    const styleCodes = (r as { styles: unknown }).styles;
    if (!phrase || !Array.isArray(styleCodes)) continue;

    const searchFrom = usedOffsets.get(phrase) ?? 0;
    const idx = text.indexOf(phrase, searchFrom);
    if (idx < 0) continue; // phrase không tồn tại trong text → skip (AI hallucinated)
    usedOffsets.set(phrase, idx + phrase.length); // lần sau search sau range này

    const len = phrase.length;
    for (const code of styleCodes) {
      const st = String(code || '');
      if (!isValidStyleCode(st)) continue;
      styles.push({ st, start: idx, len });
    }
  }
  return styles;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sales-to-sales handoff message (2026-05-22 v2) — anh chốt template cứng
 * cho tab "🎯 CRM" widget "Đồng đội cùng chăm KH". Khi sale A click "AI nhắn
 * sale B phối hợp" → assemble tin nội bộ theo template KHÔNG dùng AI (tránh
 * bug AI fail lần 1, predictable output, không tốn quota).
 *
 * Template anh cho (2026-05-22):
 *   "Anh/Chị {toSaleName} ơi, KH {khName} em đang chăm đã ở trạng thái
 *    {status} và tương tác được Nhiệt {priorityScore}, điểm {leadScore} rồi.
 *    [Có lịch hẹn {appt}] Em thấy KH này có tương tác với Anh/Chị ngày gần
 *    nhất là {lastInteractionWithTarget}, Anh/Chị review lại KH này để mình
 *    cùng chăm tìm phương án chuyển đổi nhé."
 * ────────────────────────────────────────────────────────────────────────── */
export type SalesHandoffInput = {
  orgId: string;
  fromSaleName: string;
  toSaleName: string;
  contact: {
    displayName: string;
    phone?: string | null;
    statusLabel?: string | null;
    priorityScore?: number | null;
    leadScore?: number | null;
    engagementPattern?: string | null;
    nextAppointmentAt?: Date | null;
    nextAppointmentLocation?: string | null;
  };
  targetActivity?: {
    lastInboundAt?: Date | null;     // KH gửi tin cuối cho nick của target sale
    lastOutboundAt?: Date | null;    // Target sale gửi tin cuối cho KH
    lastInteractionAt?: Date | null; // Tổng quát (max(inbound, outbound))
    totalInbound?: number;
    totalOutbound?: number;
  };
};

export type SalesHandoffResult = { content: string; source: 'template' };

function formatVnDateTime(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

function relativeVnDays(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) {
    const hours = Math.max(1, Math.floor(diffMs / 3600000));
    return `${hours} giờ trước`;
  }
  if (days === 1) return 'hôm qua';
  return `${days} ngày trước`;
}

function patternLabel(p?: string | null): string {
  switch (p) {
    case 'hot': return 'nóng';
    case 'champion': return 'champion';
    case 'stable': return 'ổn định';
    case 'cooling': return 'đang nguội';
    case 'cold': return 'lạnh';
    case 'noise': return 'chưa đủ data';
    default: return '';
  }
}

export function aiGenerateSalesHandoffMessage(input: SalesHandoffInput): SalesHandoffResult {
  const t = input.targetActivity || {};

  // Trạng thái: statusLabel (CRM status) hoặc engagementPattern
  const statusText = input.contact.statusLabel?.trim()
    || patternLabel(input.contact.engagementPattern)
    || 'đang chăm';

  // Số liệu Nhiệt + Điểm — chỉ thêm nếu có
  const numBits: string[] = [];
  if (input.contact.priorityScore != null) numBits.push(`Nhiệt ${input.contact.priorityScore}`);
  if (input.contact.leadScore != null) numBits.push(`điểm ${input.contact.leadScore}`);
  const numText = numBits.length ? ` và tương tác được ${numBits.join(', ')}` : '';

  // Lịch hẹn (nếu có)
  let apptText = '';
  if (input.contact.nextAppointmentAt) {
    const at = formatVnDateTime(input.contact.nextAppointmentAt);
    const loc = input.contact.nextAppointmentLocation ? ` tại ${input.contact.nextAppointmentLocation}` : '';
    apptText = ` KH có lịch hẹn vào ${at}${loc}.`;
  }

  // Lần tương tác gần nhất giữa target sale × KH
  // Ưu tiên lastInteractionAt → lastInboundAt → lastOutboundAt
  const lastTouch = t.lastInteractionAt || t.lastInboundAt || t.lastOutboundAt;
  let touchText = '';
  if (lastTouch) {
    touchText = `Em thấy KH này có tương tác với Anh/Chị ngày gần nhất là ${relativeVnDays(lastTouch)}, `;
  } else {
    touchText = `Em thấy KH này chưa có nhiều tương tác với Anh/Chị, `;
  }

  const content = [
    `Anh/Chị ${input.toSaleName} ơi, `,
    `KH ${input.contact.displayName} em đang chăm đã ở trạng thái ${statusText}${numText} rồi.`,
    apptText,
    ` ${touchText}`,
    `Anh/Chị review lại KH này để mình cùng chăm tìm phương án chuyển đổi nhé.`,
  ].join('').replace(/\s+/g, ' ').trim();

  // Save vào aiSuggestion để track (best-effort, nullable conversationId 2026-05-28)
  saveSuggestion({
    orgId: input.orgId,
    conversationId: null,
    type: 'reply_draft',
    content: JSON.stringify({ kind: 'sales_handoff', content }),
    confidence: 1.0,
  }).catch(() => {});

  return { content, source: 'template' };
}

export async function aiFormatRichText(input: { orgId: string; rawText: string }): Promise<AiFormatResult> {
  const text = (input.rawText || '').toString();
  if (!text.trim()) return { text, styles: [], source: 'fallback' };

  const currentConfig = await getAiConfig(input.orgId);
  if (!currentConfig.enabled) return { text, styles: [], source: 'fallback' };

  // Quota check (cùng counter với các AI task khác)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const usedToday = await prisma.aiSuggestion.count({ where: { orgId: input.orgId, createdAt: { gte: startOfDay } } });
  if (usedToday >= currentConfig.maxDaily) throw new Error('AI daily quota exceeded');

  const apiKey = await getProviderApiKey(input.orgId, currentConfig.provider);
  if (!apiKey) return { text, styles: [], source: 'fallback' };

  try {
    // 2026-05-21 fix: cap đủ cho JSON output dài (text + nhiều style overlap per range).
    // Test với đoạn dự án 800 chars input → Gemini muốn trả ~7900 chars JSON ≈ 5000 tokens.
    // Set 8000 = sát limit Gemini 2.5 Flash (8192) + buffer. Nếu vẫn cap → cần shrink prompt.
    const raw = await generateText(currentConfig.provider, apiKey, currentConfig.model, AI_FORMAT_SYSTEM_PROMPT, text, 8000, await getProviderBaseUrl(input.orgId, currentConfig.provider));

    let parsed: { ranges?: unknown } | null = null;
    try {
      // Strip robust: bỏ ```json/```js/``` wrapper + BOM + leading text trước `{`.
      let cleaned = raw.replace(/^﻿/, '').trim();
      cleaned = cleaned.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      if (!cleaned.startsWith('{')) {
        const firstBrace = cleaned.indexOf('{');
        if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
      }
      parsed = JSON.parse(cleaned);
    } catch (e) {
      logger.warn(`[ai-format-rich] JSON parse fail (len=${raw.length}): ${raw.slice(0, 300)}... [end:${raw.slice(-100)}]`);
      return { text, styles: [], source: 'fallback' };
    }
    // v4: phrase-based → BE tự indexOf → offsets chính xác 100%
    const styles = rangesToStyles(text, parsed?.ranges);

    // Save vào aiSuggestion để track quota (nullable conversationId 2026-05-28)
    await saveSuggestion({
      orgId: input.orgId,
      conversationId: null,               // format-rich không gắn vào conv cụ thể
      type: 'reply_draft',                // reuse type để tránh schema migration
      content: JSON.stringify({ kind: 'format_rich', styles }),
      confidence: 0.85,
    }).catch(() => {});

    return { text, styles, source: 'ai' };
  } catch (err) {
    logger.warn('[ai-format-rich] AI call failed:', err);
    return { text, styles: [], source: 'fallback' };
  }
}
