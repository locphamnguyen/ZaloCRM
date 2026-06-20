import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';
import type { Contact } from '@/composables/use-contacts';
import { useAuthStore } from '@/stores/auth';
import { applyPendingTags, registerPendingTags } from '@/composables/use-pending-mutations';
import { usePrivacyStore } from '@/stores/privacy';
import { useWorkScope } from '@/composables/use-work-scope';
import { classifyIncoming } from '@/composables/work-scope-logic';

interface ZaloAccount {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  /** Privacy Phase 2026-05-22 — 'main' = nick chính chủ (privacy mode on), 'sub' = công khai */
  privacyMode?: 'main' | 'sub';
  /** Owner user của nick (chính chủ) — dùng cho gate UI privacy blur + composer lock */
  ownerUserId?: string | null;
}

export interface AiSentiment {
  label: 'positive' | 'neutral' | 'negative';
  confidence: number;
  reason: string;
}

export interface AiConfig {
  provider: string;
  model: string;
  maxDaily: number;
  enabled: boolean;
  hasAnthropicKey?: boolean;
  hasGeminiKey?: boolean;
}

interface ConversationMessage {
  content: string | null;
  contentType: string;
  senderType: string;
  sentAt: string;
  isDeleted: boolean;
  // Optional — backend trả ở /messages event nhưng /conversations list không kèm (lưu lookaside cho socket update).
  id?: string;
  zaloMsgId?: string | null;
  editedAt?: string | null;
}

export interface ReplyMessageRef {
  msgId: string;
  cliMsgId?: string;
  /** Nội dung tin nhắn gốc — Zalo lưu trong field 'msg'; FE map thành 'content' */
  content: string;
  msgType: string;
  uidFrom: string;
  /** Tên người gửi gốc — Zalo lưu trong 'fromD'; FE map thành 'senderName' */
  senderName: string;
  ts: string;
  propertyExt?: Record<string, unknown>;
  ttl?: number;
}

interface RawMessage extends Omit<Message, 'reactions' | 'reply' | 'reactionDetails'> {
  quote?: ReplyMessageRef | null;
  reactions?: Array<{ emoji: string; reactorId: string; reactorName?: string | null; reactorSource?: string | null; count?: number; reacted?: boolean }>;
}

export interface FriendshipInfo {
  id?: string;
  /** friend | pending_friend | chatting_stranger | ghost | none */
  relationshipKind: string;
  /** none | pending_sent | pending_received | accepted | rejected | removed | blocked */
  friendshipStatus: string;
  /** Đã từng nhắn 1-1 chưa. False = chỉ kết bạn Zalo / sync */
  hasConversation?: boolean;
  becameFriendAt: string | null;
  firstMessageAt: string | null;
  /** Friend.updatedAt — last status change timestamp (Prisma auto). Dùng cho pendingDaysLabel
   *  để phản ánh "thời điểm pending status được set/refresh" thay vì firstMessageAt. */
  updatedAt?: string | null;
  /** Per-pair counters (RIÊNG cặp nick × KH này, KHÔNG phải Contact aggregate) */
  totalInbound?: number;
  totalOutbound?: number;
  /** Per-pair leadScore — sale chăm KH này từ nick này */
  leadScore?: number;
  statusRef?: { id: string; name: string; color: string | null; order: number } | null;
  /** Zalo native labels synced từ Zalo client (Friend.zaloLabels) */
  zaloLabels?: Array<{ id?: string; name?: string; color?: string }>;
  /** Per-pair CRM tags (kèm Zalo-mirrored "🔵 X" tags). Source of truth Friend-level.
   *  Tag v2 manual lưu SLUG (vd "tiem-nang") — resolve qua use-tag-taxonomy ở UI. */
  crmTagsPerNick?: string[];
  /** Auto-tags engine (Friend.autoTags) — key cố định (active/cold/ready/…). */
  autoTags?: string[];
  /** "Tên gợi nhớ" — alias sale đặt qua Zalo Real, sync 2-way với CRM. */
  aliasInNick?: string | null;
  /** Avatar/tên Zalo per-nick (Friend.zaloAvatarUrl/zaloDisplayName) — header fallback
   *  khi Contact chưa có. Trước 2026-06-16 header đọc qua cast; khai báo để patch typed. */
  zaloAvatarUrl?: string | null;
  zaloDisplayName?: string | null;
}

export interface Conversation {
  id: string;
  threadType: 'user' | 'group';
  contact: Contact | null;
  zaloAccount: ZaloAccount | null;
  /** Tên nhóm Zalo (chỉ có khi threadType=group) — backend resolve qua getGroupInfo */
  groupName?: string | null;
  /** Avatar nhóm Zalo URL (chỉ có khi threadType=group) */
  groupAvatarUrl?: string | null;
  /** Số thành viên nhóm */
  groupMembersCount?: number | null;
  /** External thread ID (group id từ Zalo, hoặc UID per-nick cho user thread) */
  externalThreadId?: string | null;
  /** Friend record per-pair (chỉ user thread) — backend join từ Friend table */
  friendship?: FriendshipInfo | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isReplied: boolean;
  isPinned?: boolean;
  messages?: ConversationMessage[];
  /** M53 2026-05-30: Virtual conversation cho KH no-Zalo. Tin nhắn lưu nội bộ, KHÔNG gửi qua Zalo SDK. */
  isVirtual?: boolean;
}

export interface MessageReactionView {
  emoji: string;
  count: number;
  reacted: boolean;
}

// 2026-06-20 (anh báo popup reaction chỉ hiện "Người dùng"): per-user rows GIỮ LẠI để
// popup hiện đúng ai (tên thật) + emoji của họ. ReactionView (emoji+count) là tổng hợp,
// vứt mất reactor → phải giữ riêng mảng detail này.
export interface MessageReactionDetail {
  reactorId: string;
  reactorName: string | null;
  reactorSource: string | null; // "crm" | "zalo"
  emoji: string;
}

export interface Message {
  id: string;
  content: string | null;
  contentType: string;
  senderType: string;
  senderName: string | null;
  senderUid?: string | null;
  sentAt: string;
  isDeleted: boolean;
  zaloMsgId: string | null;
  /** Numeric Snowflake từ Zalo — primary sort key match Zalo Web (BigInt serialized as string). */
  zaloMsgIdNum?: string | null;
  albumKey: string | null;
  albumIndex: number | null;
  albumTotal: number | null;
  reply?: ReplyMessageRef | null;
  reactions?: MessageReactionView[];
  /** Per-user reaction rows (ai thả emoji gì) — cho popup chi tiết. */
  reactionDetails?: MessageReactionDetail[];
  // Edit audit (2026-05-21) — set khi sale sửa tin trên CRM. Edit chỉ áp dụng local, không sync Zalo.
  originalContent?: string | null;
  editedAt?: string | null;
  /** Privacy 2026-05-22 — true = server đã redact (non-owner xem nick privacy='main'). UI blur. */
  redacted?: boolean;
  /** Read receipts (Wave 1+2) — chỉ có giá trị cho tin OUTGOING (senderType='self') */
  deliveredAt?: string | null;
  seenAt?: string | null;
  /** M55 2026-05-30 — sender attribution cho multi-sale cùng chăm.
   *  Tin self lưu sale nào gõ qua CRM UI. Khác user hiện viewer → render mini avatar. */
  repliedByUserId?: string | null;
  repliedBy?: { id: string; fullName: string | null; email: string | null } | null;
  /** M55 — virtual chat indicators */
  isLocal?: boolean;
  /** Anh chốt 2026-06-03 — Persist Zalo SDK TGroupMessage.mentions để FE
   *  render mention theo pos+len thay vì đoán regex. Chỉ group có. */
  mentions?: Array<{ uid: string; pos: number; len: number; type: 0 | 1 }> | null;
  // ── Luồng Mục Tiêu M11 source identity 2026-06-01 ──
  // sentVia enum: 'user' | 'user_native' | 'automation' | 'ai_assistant' | 'system'
  // Note (Anh chốt 2026-06-02): user_native vẫn lưu trong DB nhưng FE map về
  // variant 'user_crm' với syncedFromNative=true (icon 🔄 trailing).
  sentVia?: string;
  // FK BullMQ jobId (string DASH pattern), null cho tin sale gõ tay
  automationTaskId?: string | null;
  automationStepIndex?: number | null;
  // metadata mở rộng cho M11: sender = { kind, name, detail?, sequenceId?, stepIdx?, syncedFromNative? }
  metadata?: {
    sender?: {
      // Kind: 4 variant (Anh chốt 2026-06-02 hợp nhất user_native vào user_crm).
      // Legacy 'user_native' vẫn accept ở payload BE để backward compat — FE remap.
      kind?: 'user_crm' | 'user_native' | 'bot_automation' | 'bot_ai' | 'bot_system';
      name?: string;
      detail?: string;
      sequenceId?: string;
      stepIdx?: number;
      // Flag distinguish CRM thuần vs Native sync (sale gõ trên app Zalo)
      syncedFromNative?: boolean;
    };
    [key: string]: unknown;
  } | null;
}

/** Sort comparator: primary by zaloMsgIdNum (Zalo Snowflake), fallback sentAt cho row chưa echo */
function compareMessages(a: Message, b: Message): number {
  const aNum = a.zaloMsgIdNum;
  const bNum = b.zaloMsgIdNum;
  if (aNum && bNum) {
    // Compare BigInt từ string — chính xác cho mọi length (lex sort không work nếu length khác)
    const diff = BigInt(aNum) - BigInt(bNum);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  }
  // 1 trong 2 chưa có zaloMsgIdNum → fallback sentAt
  return new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
}

// In-memory cache per-conv messages — quay lại conv cũ render ngay, fetch fresh background.
const messagesCache = new Map<string, Message[]>();

// M-tier tab-switch fix (2026-05-21) — per-filter-key conversation list cache.
// Stale-while-revalidate: chuyển tab → paint từ cache NGAY (0ms lag), bg fetch update.
// Trước fix: mỗi lần chuyển tab user chờ 1-3s HTTP+DB roundtrip → loading spinner.
// Cache key encode toàn bộ filter params (tab, threadType, accountIds, search, ...).
const conversationsCache = new Map<string, { data: Conversation[]; fetchedAt: number }>();
const CONV_CACHE_MAX_ENTRIES = 16;  // ~4 tabs × ~4 filter variants

// Debug hook (DEV only) — expose cache state via window.__zaloCRMConvCache để
// diagnose cache miss khi tab switch vẫn cảm giác lag. Inspect:
//   window.__zaloCRMConvCache.size, .keys(), .get(key)
//   window.__zaloCRMConvCacheLog (last 20 hit/miss events with key)
if (typeof window !== 'undefined') {
  (window as unknown as { __zaloCRMConvCache: typeof conversationsCache }).__zaloCRMConvCache = conversationsCache;
  (window as unknown as { __zaloCRMConvCacheLog: Array<{ t: number; event: string; key: string }> }).__zaloCRMConvCacheLog = [];
}
function logCacheEvent(event: 'hit' | 'miss' | 'set', key: string) {
  if (typeof window === 'undefined') return;
  const log = (window as unknown as { __zaloCRMConvCacheLog: Array<{ t: number; event: string; key: string }> }).__zaloCRMConvCacheLog;
  log.push({ t: Date.now(), event, key });
  if (log.length > 20) log.shift();
}

function evictOldConvCacheIfNeeded() {
  if (conversationsCache.size <= CONV_CACHE_MAX_ENTRIES) return;
  const entries = Array.from(conversationsCache.entries()).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const evictCount = entries.length - CONV_CACHE_MAX_ENTRIES;
  for (let i = 0; i < evictCount; i++) conversationsCache.delete(entries[i][0]);
}

// Merge contact: backend list endpoint trả 14 field hẹp; detail endpoint /conversations/:id
// trả full ~50 field. Khi list refresh chạy sau detail load, MERGE giữ field detail
// (gender/totals/birthDate/lastOutboundAt/autoTags/priorityScore...) thay vì replace.
function mergeContactPreserveDetail<T extends { id?: string } | null | undefined>(
  existing: T,
  incoming: T,
): T {
  if (!incoming) return incoming;
  if (!existing || existing.id !== incoming.id) return incoming;
  return { ...existing, ...incoming } as T;
}

/**
 * Merge list incoming (fresh fetch) với existing (state hiện tại):
 * - Conv có trong incoming: lấy fresh + preserve contact detail
 * - Conv có trong existing nhưng KHÔNG trong incoming + nằm trong preserveIds
 *   (vd conv stub từ Lead Pool đang được select, lastMessageAt=null không vào
 *   top 100 fresh) → giữ lại + APPEND vào CUỐI (vì lastMessageAt=null thuộc cuối).
 *   Fix 2026-05-29: trước đây stub bị wipe → UI clear trắng khi fetchConversations rerun.
 */
function mergeConvListPreserveDetail(
  existing: Conversation[],
  incoming: Conversation[],
  preserveIds?: Set<string>,
): Conversation[] {
  const existingMap = new Map(existing.map(c => [c.id, c]));
  const incomingIds = new Set(incoming.map(c => c.id));
  const merged: Conversation[] = incoming.map(c => {
    const prev = existingMap.get(c.id);
    if (!prev) return c;
    return { ...c, contact: mergeContactPreserveDetail(prev.contact, c.contact) };
  });
  // Preserve stub/selected conv that didn't make incoming list
  if (preserveIds && preserveIds.size > 0) {
    for (const id of preserveIds) {
      if (!incomingIds.has(id)) {
        const stub = existingMap.get(id);
        if (stub) merged.push(stub); // append cuối — lastMessageAt=null sort cuối tự nhiên
      }
    }
  }
  return merged;
}

export function useChat() {
  const authStore = useAuthStore();
  const privacyStore = usePrivacyStore();
  function currentUserIdForPrivacy(): string | null { return authStore.user?.id ?? null; }
  function privacyUnlockedRef(): boolean { return !!privacyStore.isUnlocked; }
  const conversations = ref<Conversation[]>([]);
  const selectedConvId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  // Track conv mà messages.value đang chứa — để fetchMessages biết switch conv thì
  // wholesale replace (không merge tin từ conv khác), refresh cùng conv thì merge
  // (giữ tin socket đến trong lúc HTTP fly).
  const messagesConvId = ref<string | null>(null);
  const loadingConvs = ref(false);
  const loadingMsgs = ref(false);
  const sendingMsg = ref(false);
  // Wave 1 (2026-05-21) — KH đang gõ realtime. Key = conversationId (FE map từ
  // threadId qua selectedConv). Value = timestamp ms cuối cùng nhận typing event.
  // Auto-clear sau 5s không có event mới (timer per conv).
  const typingConvIds = ref<Map<string, number>>(new Map());
  const typingTimers = new Map<string, number>();
  const searchQuery = ref('');
  // STRANGLER FACADE (work-scope migration 2026-06-15): accountFilter giờ là LỚP VỎ
  // bắc qua workScope (nguồn chân lý mới). Mọi reader/writer cũ (.value get/set) chạy
  // nguyên KHÔNG đổi hành vi. Migrate dần readers sang useWorkScope trực tiếp; khi grep
  // sạch 'accountFilter' mới xóa computed này. v1 single-nick: scope [X] ↔ accountFilter 'X',
  // scope [] (TẤT CẢ nick có quyền) ↔ accountFilter null.
  const workScope = useWorkScope();
  const accountFilter = computed<string | null>({
    get: () => workScope.scopeAccountId() ?? null,
    set: (v) => workScope.lockToNick(v),
  });
  const aiSuggestion = ref('');
  const aiSuggestionLoading = ref(false);
  const aiSuggestionError = ref('');
  const aiSummary = ref('');
  const aiSummaryLoading = ref(false);
  const aiSentiment = ref<AiSentiment | null>(null);
  const aiSentimentLoading = ref(false);
  const aiUsage = ref({ usedToday: 0, maxDaily: 500, remaining: 500, enabled: true });
  const aiConfig = ref<AiConfig>({ provider: 'anthropic', model: 'claude-sonnet-4-6', maxDaily: 500, enabled: true });
  let socket: Socket | null = null;
  let convSyncTimer: ReturnType<typeof setTimeout> | null = null;
  // work-scope 2026-06-15 — badge "N tin nick khác": đếm tin OUT-OF-SCOPE per nick.
  // CHỈ đếm nick CÓ QUYỀN (server đã lọc nên accountId tới đây luôn trong quyền). Reset
  // khi đổi scope sang nick đó (T7). Bounded bởi số nick (≤50).
  const outOfScopeCounts = ref<Map<string, number>>(new Map());
  // FIX socket-chết v2 — trạng thái realtime cho badge "mất kết nối" ở header chat.
  const socketConnected = ref(true);

  // Debounce server-side reconcile: chỉ fetch full list sau 3s không có tin mới
  // → tránh lag khi nhận burst (chat group nhiều người gửi liên tiếp).
  function scheduleConvSync() {
    if (convSyncTimer) clearTimeout(convSyncTimer);
    convSyncTimer = setTimeout(() => {
      // bypassCache: socket đã optimistic move conv lên top. Nếu apply cache cũ
      // (data trước khi socket fires) sẽ ghi đè state → conv "tụt xuống xíu rồi
      // nhảy lên top" flicker. Đi thẳng server lấy fresh thay cache.
      void fetchConversations({ bypassCache: true });
      convSyncTimer = null;
    }, 3000);
  }

  // 2026-06-12 (anh báo "conv đang mở dính qua tab khác") — bản sao conv đang chọn.
  // Mục đích: cho phép GỠ conv khỏi list cột 2 khi nó không thuộc tab/filter hiện tại
  // (hết "dính tab"), mà cột 3 (MessageThread đọc selectedConv) KHÔNG bị trắng — vì
  // computed bên dưới fallback về bản sao này khi conv vắng mặt trong list.
  const selectedConvDetail = ref<Conversation | null>(null);
  const selectedConv = computed(() =>
    conversations.value.find(c => c.id === selectedConvId.value)
    || (selectedConvDetail.value?.id === selectedConvId.value ? selectedConvDetail.value : null),
  );

  function clearAiState() {
    aiSuggestion.value = '';
    aiSuggestionError.value = '';
    aiSummary.value = '';
    aiSentiment.value = null;
  }

  const extraFilters = ref<Record<string, string>>({});

  async function fetchConversations(opts?: { bypassCache?: boolean }) {
    const params = {
      limit: 100,
      search: searchQuery.value,
      accountId: accountFilter.value || undefined,
      ...extraFilters.value,
    };
    const cacheKey = JSON.stringify(params);
    const cached = opts?.bypassCache ? null : conversationsCache.get(cacheKey);

    // M-tier stale-while-revalidate: cache hit → paint NGAY (no spinner flash khi
    // chuyển tab). Cache miss → spinner (loading state) trong khi chờ HTTP.
    //
    // bypassCache=true cho socket-triggered refresh (scheduleConvSync sau khi
    // socket optimistic move conv lên top). Lý do: nếu apply cache cũ sẽ ghi đè
    // state đã được socket update → conv "tụt xuống xíu rồi nhảy lên top" flicker.
    // Fix 2026-05-29: preserve conv đang được select (vd stub từ Lead Pool,
    // lastMessageAt=null không vào top 100 → bị wipe → UI blank).
    // Fix 2026-06-10 (#1): KHI đang lọc theo tag → KHÔNG ép giữ conv đang mở nếu
    // không match filter.
    // Fix 2026-06-12 (anh báo "conv đang mở dính qua tab KHÁC"): KHÔNG preserve conv
    // active vào list nữa. Trước đây preserveIds giữ conv active kể cả khi nó không
    // thuộc tab mới → dính sang tab khác. Giờ cột 3 đã được giữ riêng qua
    // selectedConvDetail (computed selectedConv fallback) nên gỡ conv khỏi list cột 2
    // KHÔNG còn làm cột 3 trắng. Conv thuộc tab hiện tại vẫn có trong incoming bình
    // thường; conv không thuộc tab → ẩn khỏi cột 2 (đúng), cột 3 vẫn giữ nội dung.
    const preserveIds = undefined;

    if (cached) {
      logCacheEvent('hit', cacheKey);
      conversations.value = mergeConvListPreserveDetail(conversations.value, cached.data, preserveIds);
    } else {
      if (!opts?.bypassCache) logCacheEvent('miss', cacheKey);
      // Spinner chỉ hiện khi state thực sự rỗng (first load). bypassCache khi
      // state đã có data từ socket → không hiện spinner để tránh blink.
      if (conversations.value.length === 0) loadingConvs.value = true;
    }

    try {
      const res = await api.get('/conversations', { params });
      // Apply pending optimistic mutations (tag assigns chưa được BE confirm) trước khi
      // replace state — tránh fetchConversations chạy giữa lúc BE đang sync wipe UI optimistic.
      const fresh = applyPendingTags(res.data.conversations as Conversation[]);
      conversationsCache.set(cacheKey, { data: fresh, fetchedAt: Date.now() });
      logCacheEvent('set', cacheKey);
      evictOldConvCacheIfNeeded();
      // Merge để giữ detail fields (Contact full ~50 field từ /conversations/:id)
      // không bị wipe bởi narrow list response (14 field).
      conversations.value = mergeConvListPreserveDetail(conversations.value, fresh, preserveIds);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      loadingConvs.value = false;
    }
  }

  function normalizeMessage(message: RawMessage): Message {
    const counts = new Map<string, number>();
    const myEmojis = new Set<string>();
    const myId = authStore.user?.id || '';
    for (const reaction of message.reactions || []) {
      counts.set(reaction.emoji, (counts.get(reaction.emoji) || 0) + 1);
      if (myId && reaction.reactorId === myId) myEmojis.add(reaction.emoji);
    }
    const { reactions, quote, ...base } = message;

    // Normalize quote: Zalo lưu với field 'msg' + 'fromD' thay vì 'content' + 'senderName'.
    // Map sang ReplyMessageRef chuẩn để MessageBubble render đúng.
    // - msgType derive từ cliMsgType (Zalo numeric enum) hoặc parse attach JSON
    //   khi msg rỗng (vd reply tin ảnh: msg="" + attach có thumbUrl → infer 'image').
    let reply: ReplyMessageRef | null = null;
    if (quote) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = quote as any;
      const cliType = Number(q.cliMsgType ?? 0);
      let msgType = String(q.msgType ?? '');
      if (!msgType && cliType) {
        // Zalo cliMsgType enum (partial): 1=text, 19=link, 22=video, 23=sticker,
        // 24=voice, 30=file, 32=image, 38=card, 46=location
        msgType = ({ 1: 'text', 19: 'link', 22: 'video', 23: 'sticker',
          24: 'voice', 30: 'file', 32: 'image', 38: 'card', 46: 'location',
        } as Record<number, string>)[cliType] || '';
      }
      // Fallback: parse attach JSON nếu cliMsgType missing
      if (!msgType && typeof q.attach === 'string' && q.attach.length > 2) {
        try {
          const a = JSON.parse(q.attach);
          if (a.thumbUrl || a.oriUrl) msgType = 'image';
          else if (a.href) msgType = 'link';
        } catch { /* ignore */ }
      }
      reply = {
        msgId: String(q.msgId || q.msg_id || q.globalMsgId || ''),
        cliMsgId: q.cliMsgId,
        content: String(q.msg ?? q.content ?? ''),
        senderName: String(q.fromD ?? q.senderName ?? q.fromName ?? ''),
        msgType,
        uidFrom: String(q.uidFrom ?? q.uid_from ?? ''),
        ts: String(q.ts ?? ''),
        propertyExt: q.propertyExt,
        ttl: q.ttl,
      };
    }

    return {
      ...base,
      reply,
      reactions: Array.from(counts.entries()).map(([emoji, count]) => ({ emoji, count, reacted: myEmojis.has(emoji) })),
      // 2026-06-20: GIỮ per-user rows (reactorName từ BE) cho popup chi tiết — không vứt như trước.
      reactionDetails: (message.reactions || []).map((r) => ({
        reactorId: r.reactorId,
        reactorName: r.reactorName ?? null,
        reactorSource: r.reactorSource ?? null,
        emoji: r.emoji,
      })),
    };
  }

  // 2026-06-12 (anh báo "tin nhắn dính lẫn giữa các hội thoại" — P0 lộ dữ liệu).
  // Predicate dùng chung: conv `id` có còn là conv ĐANG mở/đang load không. Mọi thao
  // tác ghi vào messages.value / messagesCache PHẢI gate qua đây để response đến muộn
  // của conv A không ghi đè khi user đã sang conv B (race click nhanh A→B).
  function isConvCurrent(id: string): boolean {
    return selectedConvId.value === id && messagesConvId.value === id;
  }

  async function fetchMessages(convId: string) {
    // Switch conv → wholesale reset messages.value để không mix tin từ conv cũ.
    // Nếu cùng conv (refresh) → giữ messages hiện tại cho merge logic phía dưới.
    if (messagesConvId.value !== convId) {
      messages.value = [];
      messagesConvId.value = convId;
    }
    // Cache-then-refresh: nếu đã từng load conv này, set list ngay từ cache để
    // user thấy giao diện tin nhắn lập tức; rồi fetch fresh in background.
    // 2026-06-12: guard theo messagesConvId (vừa set ở trên) — nếu trong lúc await ngầm
    // conv đã đổi (re-entrant fast switch) thì KHÔNG paint cache của conv cũ vào thread.
    const cached = messagesCache.get(convId);
    if (cached) {
      if (messagesConvId.value === convId) {
        messages.value = cached;
        loadingMsgs.value = false;
      }
    } else {
      loadingMsgs.value = true;
    }
    try {
      const res = await api.get(`/conversations/${convId}/messages`, {
        params: { limit: 100 },
      });
      const list = (res.data.messages as RawMessage[]).map(normalizeMessage);
      // Merge thay vì wholesale replace: giữ msgs đã insert qua socket trong lúc HTTP
      // bay (BE replication lag có thể chưa thấy msg socket vừa nhận). CHỈ merge khi
      // messagesConvId.value === convId — đảm bảo socket items thuộc conv hiện tại,
      // không phải tin từ conv khác bị tích luỹ.
      if (isConvCurrent(convId)) {
        const beIds = new Set(list.map(m => m.id));
        const socketOnly = messages.value.filter(m => !beIds.has(m.id));
        if (socketOnly.length === 0) {
          messages.value = list;
        } else {
          const merged = [...list, ...socketOnly];
          merged.sort(compareMessages);
          messages.value = merged;
        }
      }
      // 2026-06-12 (P0 fix bleed-over) — CHỈ ghi cache khi conv VẪN là conv hiện tại.
      // Trước đây dòng này chạy vô điều kiện: response conv A đến muộn (sau khi user đã
      // sang B) ghi mảng của B (đang ở messages.value) vào cache key A → mở lại A hiện
      // tin B. + lưu SHALLOW COPY [...messages.value] thay vì reference sống: tách CẤU
      // TRÚC mảng (socket insertMessageSorted splice/push trên messages.value KHÔNG còn
      // đụng mảng đã cache) nhưng GIỮ CHUNG object tin nhắn — nên handler zalo:message-status
      // (cập nhật deliveredAt/seenAt in-place trên object) vẫn phản ánh đúng vào cache.
      // KHÔNG deep-clone: sẽ cắt object chung → vỡ dấu "đã nhận/đã xem" + tốn bộ nhớ ×100×50.
      if (isConvCurrent(convId)) {
        messagesCache.set(convId, [...messages.value]);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      if (selectedConvId.value === convId) loadingMsgs.value = false;
    }
  }

  async function fetchAiConfig() {
    try {
      const res = await api.get('/ai/config');
      aiConfig.value = {
        provider: res.data.provider,
        model: res.data.model,
        maxDaily: res.data.maxDaily,
        enabled: res.data.enabled,
        hasAnthropicKey: res.data.hasAnthropicKey,
        hasGeminiKey: res.data.hasGeminiKey,
      };
    } catch (err) {
      console.error('Failed to fetch AI config:', err);
    }
  }

  async function saveAiConfig(payload: AiConfig) {
    const res = await api.put('/ai/config', payload);
    aiConfig.value = {
      provider: res.data.provider,
      model: res.data.model,
      maxDaily: res.data.maxDaily,
      enabled: res.data.enabled,
      hasAnthropicKey: aiConfig.value.hasAnthropicKey,
      hasGeminiKey: aiConfig.value.hasGeminiKey,
    };
  }

  async function fetchAiUsage() {
    try {
      const res = await api.get('/ai/usage');
      aiUsage.value = res.data;
    } catch (err) {
      console.error('Failed to fetch AI usage:', err);
    }
  }

  async function generateAiSuggestion() {
    if (!selectedConvId.value) return;
    aiSuggestionLoading.value = true;
    aiSuggestionError.value = '';
    try {
      const res = await api.post('/ai/suggest', { conversationId: selectedConvId.value });
      aiSuggestion.value = res.data.content || '';
      await fetchAiUsage();
    } catch (err: any) {
      aiSuggestionError.value = err.response?.data?.error || 'Không thể tạo gợi ý AI';
    } finally {
      aiSuggestionLoading.value = false;
    }
  }

  async function generateAiSummary() {
    if (!selectedConvId.value) return;
    aiSummaryLoading.value = true;
    try {
      const res = await api.post(`/ai/summarize/${selectedConvId.value}`);
      aiSummary.value = res.data.content || '';
      await fetchAiUsage();
    } catch (err) {
      console.error('Failed to summarize conversation:', err);
    } finally {
      aiSummaryLoading.value = false;
    }
  }

  async function generateAiSentiment() {
    if (!selectedConvId.value) return;
    aiSentimentLoading.value = true;
    try {
      const res = await api.post(`/ai/sentiment/${selectedConvId.value}`);
      aiSentiment.value = res.data;
      await fetchAiUsage();
    } catch (err) {
      console.error('Failed to analyze sentiment:', err);
    } finally {
      aiSentimentLoading.value = false;
    }
  }

  async function selectConversation(convId: string) {
    selectedConvId.value = convId;
    clearAiState();
    // Nếu conv không có trong list (filter loại ra HOẶC vừa tạo mới qua
    // ensure-conversation từ dialog) → refresh list để MessageThread render được.
    // selectedConv = computed find trong list — list rỗng = blank UI.
    if (!conversations.value.find(c => c.id === convId)) {
      await fetchConversations();
    }
    // 2026-06-12 (anh báo load chậm 5-10s admin 50 nick) — paint tin nhắn TRƯỚC, rồi
    // detail (cột 3/4 header) + mark-read chạy SONG SONG (Promise.all) thay vì 2 round-trip
    // nối tiếp. fetchMessages gate việc paint thread; detail + mark-read KHÔNG cần cho
    // bong bóng tin nên không nên xếp hàng sau nhau. Tiết kiệm ~1 round-trip mỗi lần mở conv.
    await fetchMessages(convId);
    const detailTask = (async () => {
      try {
        const convDetail = await api.get(`/conversations/${convId}`);
        let conv = conversations.value.find(c => c.id === convId);
        if (!conv) {
          // 2026-05-28: Conv stub từ Lead Pool có thể không nằm trong 100 conv top
          // (lastMessageAt=null, sort sau hết). Push detail vào CUỐI list (không gim top —
          // fix 2026-05-29: trước đây unshift gim top, sau khi gửi tin nhắn đầu BE update
          // lastMessageAt → conv tự nhảy lên top theo sort tự nhiên).
          conversations.value = [...conversations.value, convDetail.data];
          conv = convDetail.data;
        } else {
          if (convDetail.data.contact) conv.contact = convDetail.data.contact;
          // friendship per-pair (counter, leadScore, status RIÊNG cặp nick×KH).
          // KHÔNG fallback contact aggregate vì các trường này khác semantics.
          // 2026-06-11 FIX (Bug auto-tag biến mất khi click): endpoint detail trả friendship
          // là TẬP CON của list (thiếu autoTags, statusName/Color, leadScore, stuckSince,
          // lastInbound/OutboundAt). Ghi đè cả cụm → XOÁ các field list-only → auto-tag +
          // status pill biến mất ở cột 2. → MERGE: detail thắng field nó có, giữ field list-only.
          if (convDetail.data.friendship !== undefined) {
            const det = convDetail.data.friendship;
            conv.friendship = det && conv.friendship ? { ...conv.friendship, ...det } : det;
          }
        }
        // 2026-06-12 — lưu bản sao conv đang chọn để cột 3 không trắng khi conv bị gỡ
        // khỏi list lúc đổi tab. Ưu tiên object trong list (đã merge detail), fallback raw.
        selectedConvDetail.value = conv ?? convDetail.data ?? null;
      } catch {
        // Non-critical
      }
    })();
    const markReadTask = (async () => {
      try {
        await api.post(`/conversations/${convId}/mark-read`);
        const conv = conversations.value.find(c => c.id === convId);
        if (conv) conv.unreadCount = 0;
      } catch {
        // Ignore mark-read errors
      }
    })();
    await Promise.all([detailTask, markReadTask]);
    // Note: Auto-sync Zalo profile được xử lý ở MessageThread.touchConversationProfile
    // (gọi POST /conversations/:id/touch-profile, cooldown 5min server-side). KHÔNG
    // duplicate ở đây để tránh spam SDK + 404 lên endpoint /contacts/:id/sync-zalo-profile
    // (legacy, đã bỏ).
    // AI summary + sentiment KHÔNG auto-fire mỗi lần đổi conv — user bấm nút refresh khi cần.
    // Trước đây 2 LLM call awaited mỗi switch = 2-10s + tốn quota.
    void fetchAiUsage();
  }

  async function sendMessage(content: string, replyMessageId?: string | null, styles?: Array<{ st: string; start: number; len: number }>) {
    if (!selectedConvId.value || !content.trim()) return;
    await sendMessageTo(selectedConvId.value, content, replyMessageId, styles);
  }

  /** Insert message vào messages.value đúng vị trí — primary key zaloMsgIdNum (Zalo Snowflake),
   *  fallback sentAt cho in-flight CRM message chưa nhận echo zaloMsgId.
   *  Binary search O(log N) — không re-sort toàn array. */
  function insertMessageSorted(msg: Message) {
    const arr = messages.value;
    // Fast path: append-to-end (msg mới nhất, thường case)
    if (arr.length === 0 || compareMessages(arr[arr.length - 1], msg) <= 0) {
      arr.push(msg);
      return;
    }
    // Binary search vị trí đầu tiên có order > msg
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareMessages(arr[mid], msg) <= 0) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, msg);
  }

  async function sendMessageTo(conversationId: string, content: string, replyMessageId?: string | null, styles?: Array<{ st: string; start: number; len: number }>) {
    if (!content.trim()) return;
    sendingMsg.value = true;
    try {
      // 2026-05-21 RTF: gắn styles vào payload nếu user format bold/italic/underline/strike.
      const payload: Record<string, unknown> = { content };
      if (replyMessageId) payload.replyMessageId = replyMessageId;
      if (styles && styles.length > 0) payload.styles = styles;
      const res = await api.post(`/conversations/${conversationId}/messages`, payload);
      if (conversationId === selectedConvId.value) {
        if (!messages.value.find(m => m.id === res.data.id)) {
          insertMessageSorted(res.data);
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      throw err;
    } finally {
      sendingMsg.value = false;
    }
  }

  // 2026-06-10 — Patch tag CRM (cột 2) NGAY khi sale gắn/gỡ tag manual ở khung chat.
  // TagCrmBar bắn 'friend-crm-tags-changed' {friendId, slugs} sau khi BE confirm.
  // Tìm conv theo friendship.id → ghi đè crmTagsPerNick (slug) → displayTags resolve
  // sang tên. Đăng ký pending-mutation để refetch chạy xen kẽ không wipe optimistic.
  function onFriendCrmTagsChanged(e: Event) {
    const detail = (e as CustomEvent).detail as { friendId?: string; slugs?: string[] } | undefined;
    if (!detail?.friendId) return;
    const slugs = Array.isArray(detail.slugs) ? detail.slugs : [];
    const conv = conversations.value.find(c => c.friendship?.id === detail.friendId);
    if (!conv || !conv.friendship) return;
    // Giữ lại tag Zalo-mirror "🔵 X" (không nằm trong manual slug list) + thay phần manual.
    const old = Array.isArray(conv.friendship.crmTagsPerNick) ? conv.friendship.crmTagsPerNick : [];
    const zaloMirror = old.filter(t => t.startsWith('🔵 '));
    conv.friendship.crmTagsPerNick = [...zaloMirror, ...slugs];
    registerPendingTags(conv.id, conv.friendship.crmTagsPerNick);
  }

  function initSocket() {
    window.addEventListener('friend-crm-tags-changed', onFriendCrmTagsChanged);
    socket = createAppSocket({
      // Badge "mất kết nối realtime" — cập nhật cờ cho header chat đọc.
      onStatusChange: (status) => {
        socketConnected.value = status === 'connected';
      },
      // Reconnect sau 1 khoảng chết → kéo lại tin cột 2 đã lỡ (socket không backfill).
      // bypassCache đảm bảo lấy fresh, không apply cache cũ trước lúc chết.
      onReconnect: () => {
        void fetchConversations({ bypassCache: true });
      },
    });
    // FIX 2 — wake reconnect khi quay lại tab / có mạng lại.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    socket.on('chat:message', (data: { message: Message; conversationId: string; accountId?: string; _privacyMeta?: { privacyMode?: string; ownerUserId?: string | null } }) => {
      // PRIVACY 2026-06-11 — Server GIỜ redact server-side trước khi emit (emit-chat.ts):
      // non-owner nhận bản đã blur, chính chủ đã unlock nhận bản thật ở room riêng.
      // Đoạn dưới chỉ còn là LỚP 2 (safety belt) đánh dấu redacted để UI blur — KHÔNG
      // còn là lớp bảo vệ duy nhất. (Trước 2026-06-11: server gửi raw content, FE tự
      // blur → mở DevTools là đọc được. Đã vá.)
      const meta = data._privacyMeta;
      if (meta?.privacyMode === 'main') {
        const myId = currentUserIdForPrivacy();
        const isOwner = !!myId && meta.ownerUserId === myId;
        const unlocked = privacyUnlockedRef();
        if (!isOwner || !unlocked) {
          (data.message as any).redacted = true;
          (data.message as any).content = '';
          (data.message as any).originalContent = null;
          (data.message as any).attachments = [];
        }
      }

      // ── work-scope guard (2026-06-15) ──────────────────────────────────────
      // Quyết định tin này làm gì dựa trên workScope. classifyIncoming (logic thuần,
      // đã unit-test). Đọc data.accountId Ở CẤP NGOÀI payload (emit-chat.ts:52), KHÔNG
      // data.message.zaloAccountId (field không tồn tại — bug v1).
      const cls = classifyIncoming({
        accountId: data.accountId,
        conversationId: data.conversationId,
        selectedConvId: selectedConvId.value,
        scope: workScope.accountIds.value,
      });

      // (a) THREAD ĐANG MỞ: LUÔN nhận tin (kể cả nick ngoài scope — vd vừa nav sang chưa
      // reload). KHÔNG bị guard chặn → không mất tin (fix bug v1.2).
      if (cls.insertThread) {
        if (!messages.value.find(m => m.id === data.message.id)) {
          // INSERT theo sortedBy sentAt thay vì push cuối array. Lý do: socket có
          // thể giao messages KHÔNG theo chronological order (vd old_messages backfill
          // delivers reverse, hoặc 2 msg cùng giây tới khác thứ tự server vs client).
          insertMessageSorted(normalizeMessage(data.message as RawMessage));
        }
      }

      // (b) OUT-OF-SCOPE (và không phải thread đang mở) → CHỈ đếm badge "N tin nick khác",
      // KHÔNG cho vào cột 2. Đây là chỗ "không load tin nick khác vào UI".
      if (cls.bumpBadge && data.accountId) {
        const m = new Map(outOfScopeCounts.value);
        m.set(data.accountId, (m.get(data.accountId) ?? 0) + 1);
        outOfScopeCounts.value = m;
        return; // KHÔNG optimistic cột-2, KHÔNG scheduleConvSync, KHÔNG dispatch
      }
      // Tin in-scope nhưng không updateColumn2 (vd thread đang mở out-of-scope): cũng dừng
      // optimistic cột-2 để không kéo conv ngoài scope lên list.
      if (!cls.updateColumn2) {
        return;
      }

      // Optimistic update conversation list — tránh fetch full HTTP mỗi message
      // (cũ: fetchConversations() per event → 143 rows re-render → lag rõ).
      const idx = conversations.value.findIndex(c => c.id === data.conversationId);
      if (idx !== -1) {
        const cur = conversations.value[idx];
        // 2026-06-12 (anh báo bug đồng bộ): tạo OBJECT MỚI cho conv thay vì mutate
        // in-place. Lý do: sau khi tách ticker 30s (commit 1c377f4) cột 2 KHÔNG còn
        // re-render định kỳ → mutate in-place conv.messages KHÔNG ép row re-render +
        // memoize preview (WeakMap key = conv object) trả CACHE CŨ → preview "đứng",
        // phải click/refresh mới cập nhật. Thay = object mới: ép v-for re-render row đó
        // + đổi WeakMap key → memoize tự invalidate. Fix cả cá nhân lẫn nhóm.
        const updatedContact = cur.contact ? { ...cur.contact } : cur.contact;
        if (updatedContact) {
          if (data.message.senderType === 'self') {
            updatedContact.totalOutbound = (updatedContact.totalOutbound ?? 0) + 1;
            updatedContact.lastOutboundAt = data.message.sentAt;
          } else {
            updatedContact.totalInbound = (updatedContact.totalInbound ?? 0) + 1;
            updatedContact.lastInboundAt = data.message.sentAt;
          }
          updatedContact.lastActivity = data.message.sentAt;
        }
        const isOpen = cur.id === selectedConvId.value;
        const conv = {
          ...cur,
          contact: updatedContact,
          lastMessageAt: data.message.sentAt,
          // preview tin mới nhất ngay
          messages: [data.message, ...(cur.messages || [])].slice(0, 1),
          unreadCount: (data.message.senderType !== 'self' && !isOpen)
            ? (cur.unreadCount ?? 0) + 1
            : cur.unreadCount,
        } as typeof cur;
        // Ghi đè bằng object mới + đẩy lên top. idx>0 → move; idx===0 (conv đang ở đầu,
        // vd conv đang mở) → vẫn replace tại chỗ để row re-render với object mới.
        if (idx > 0) {
          conversations.value.splice(idx, 1);
          conversations.value.unshift(conv);
        } else {
          conversations.value.splice(idx, 1, conv);
        }
      }
      // Debounce sync from server: chỉ fetch sau 3s im lặng → reconcile state
      // (tránh chạy mỗi tin → lag list khi nhận burst).
      scheduleConvSync();
      // 2026-06-12 (anh báo: tab "Ưu tiên" có tin mới mà badge KHÔNG tăng tới khi reload).
      // Gốc: conv thuộc tab Ưu tiên KHÔNG nằm trong conversations.value (list tab hiện tại)
      // → idx=-1 → optimistic update bỏ qua, VÀ badge priorityUnreadCount chỉ refresh lúc
      // mount/move/delete/mark-read, KHÔNG refresh khi có tin mới. Bắn event để ChatView
      // refresh badge (debounce 400ms — burst nhiều tin chỉ 1 lần gọi /counts). Chỉ tin
      // ĐẾN (không phải tin mình gửi) mới làm tăng unread tab Ưu tiên.
      if (data.message.senderType !== 'self' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('chat:inbound-message'));
      }
    });

    socket.on('chat:deleted', (data: { messageId?: string; zaloMsgId?: string; conversationId?: string }) => {
      // Cột 3: update message bubble trong thread đang mở
      const msg = messages.value.find(m => m.id === data.messageId || m.zaloMsgId === data.zaloMsgId);
      if (msg) msg.isDeleted = true;
      // Cột 2: update preview tin cuối trong conv list — match theo id/zaloMsgId.
      // 2026-06-12 — thay conv bằng OBJECT MỚI (không mutate in-place preview) cùng lý do
      // như chat:message: sau khi tách ticker 30s, mutate in-place KHÔNG ép row re-render +
      // memoize preview (WeakMap key=conv) trả cache cũ → "đã thu hồi" không hiện ở cột 2.
      // 2026-06-12 (code-review) — SCOPE theo conversationId khi server gửi kèm: zaloMsgId
      // chỉ unique theo (conversationId, zaloMsgId), 1 tin trong NHÓM mà 2 nick CRM cùng quản
      // lý → 2 row CÙNG zaloMsgId → thu hồi 1 cái đánh nhầm preview hội thoại kia. break sau
      // match (1 conv chỉ có 1 preview). Không có conversationId (fallback) → giữ match cũ.
      for (let i = 0; i < conversations.value.length; i++) {
        const conv = conversations.value[i];
        if (data.conversationId && conv.id !== data.conversationId) continue;
        const preview = conv.messages?.[0];
        if (preview && (preview.id === data.messageId || preview.zaloMsgId === data.zaloMsgId)) {
          conversations.value.splice(i, 1, {
            ...conv,
            messages: [{ ...preview, isDeleted: true }, ...(conv.messages || []).slice(1)],
          } as typeof conv);
          if (data.conversationId) break;
        }
      }
    });

    socket.on('chat:message-edited', (data: { messageId?: string; zaloMsgId?: string; conversationId?: string; content: string; originalContent?: string | null; editedAt?: string }) => {
      // Cột 3: cập nhật content + edit audit fields
      const msg = messages.value.find(m => m.id === data.messageId || m.zaloMsgId === data.zaloMsgId);
      if (msg) {
        msg.content = data.content;
        if (data.originalContent !== undefined) msg.originalContent = data.originalContent;
        if (data.editedAt) msg.editedAt = data.editedAt;
      }
      // Cột 2: preview tin cuối cũng đổi content + flag editedAt.
      // 2026-06-12 — thay conv bằng OBJECT MỚI (cùng lý do chat:message/chat:deleted):
      // mutate in-place không ép row re-render + memoize trả cache cũ → preview đứng.
      // 2026-06-12 (code-review) — SCOPE theo conversationId (xem chat:deleted) tránh sửa
      // nhầm preview hội thoại khác cùng zaloMsgId. break sau match khi có conversationId.
      for (let i = 0; i < conversations.value.length; i++) {
        const conv = conversations.value[i];
        if (data.conversationId && conv.id !== data.conversationId) continue;
        const preview = conv.messages?.[0];
        if (preview && (preview.id === data.messageId || preview.zaloMsgId === data.zaloMsgId)) {
          const newPreview = { ...preview, content: data.content };
          if (data.editedAt) newPreview.editedAt = data.editedAt;
          conversations.value.splice(i, 1, {
            ...conv,
            messages: [newPreview, ...(conv.messages || []).slice(1)],
          } as typeof conv);
          if (data.conversationId) break;
        }
      }
    });

    socket.on('chat:reactions', (data: { messageId?: string; msgId?: string; zaloMsgId?: string; reactions: { userId: string; userName: string; reaction: string; action: 'add' | 'remove'; totalCount?: number }[] }) => {
      const msg = messages.value.find(m => m.id === data.messageId || m.id === data.msgId || m.zaloMsgId === data.zaloMsgId);
      if (!msg) return;
      // Merge với reactions hiện có thay vì replace — tránh mất emoji của user khác
      const counts = new Map<string, number>();
      const myEmojis = new Set<string>();
      for (const r of msg.reactions || []) {
        counts.set(r.emoji, r.count);
        if (r.reacted) myEmojis.add(r.emoji);
      }
      // 2026-06-20: đồng bộ luôn per-user detail (cho popup) theo event realtime.
      const details: MessageReactionDetail[] = [...(msg.reactionDetails || [])];
      const myId = authStore.user?.id || '';
      for (const r of data.reactions) {
        const emoji = r.reaction;
        const isMine = r.userId === myId;
        // Cập nhật detail rows: add → thêm nếu chưa có; remove → bỏ (reactorId, emoji).
        if (r.action === 'add') {
          if (!details.some((d) => d.reactorId === r.userId && d.emoji === emoji)) {
            details.push({ reactorId: r.userId, reactorName: r.userName || null, reactorSource: null, emoji });
          }
        } else if (r.action === 'remove') {
          for (let i = details.length - 1; i >= 0; i--) {
            if (details[i].reactorId === r.userId && details[i].emoji === emoji) details.splice(i, 1);
          }
        }
        // ANTI-DRIFT FIX 2026-05-22: prefer authoritative totalCount từ BE post-mutation.
        // Trước fix: Zalo gửi 10 events → FE increment +1 mỗi event → count=10 realtime,
        // refresh REST trả 1 (DB composite key msg×reactor×emoji = 1 row) → mismatch.
        // Giờ BE emit totalCount = count thực từ DB → FE set thay vì increment.
        if (typeof r.totalCount === 'number') {
          if (r.totalCount > 0) counts.set(emoji, r.totalCount);
          else counts.delete(emoji);
          if (isMine) {
            if (r.action === 'add') myEmojis.add(emoji);
            else if (r.action === 'remove') myEmojis.delete(emoji);
          }
        } else if (r.action === 'add') {
          // Fallback cho legacy emit không kèm totalCount
          counts.set(emoji, (counts.get(emoji) || 0) + 1);
          if (isMine) myEmojis.add(emoji);
        } else if (r.action === 'remove') {
          const cur = (counts.get(emoji) || 0) - 1;
          if (cur > 0) counts.set(emoji, cur);
          else counts.delete(emoji);
          if (isMine) myEmojis.delete(emoji);
        }
      }
      msg.reactions = Array.from(counts.entries()).map(([emoji, count]) => ({ emoji, count, reacted: myEmojis.has(emoji) }));
      msg.reactionDetails = details;
    });

    // Pin/unpin: bypass cache vì pin state đã đổi server-side, cache cũ sẽ flicker
    // (pinned conv tụt xuống vị trí cũ rồi nhảy lại top khi fresh response về).
    socket.on('chat:pinned', () => {
      fetchConversations({ bypassCache: true });
    });

    socket.on('chat:unpinned', () => {
      fetchConversations({ bypassCache: true });
    });

    // Quyền truy cập nick đổi (grant/đổi/gỡ) — BE bắn tới user bị ảnh hưởng.
    // Refetch hội thoại (re-scope theo nick được phép) → nick bị gỡ rớt khỏi cột 2 NGAY,
    // không cần F5. Phát window event để cột 1 (nick list) cũng refetch.
    socket.on('zalo:access-changed', (data: { zaloAccountId: string; action: string; permission: string | null }) => {
      fetchConversations({ bypassCache: true });
      window.dispatchEvent(new CustomEvent('zalo-access-changed', { detail: data }));
    });

    // ─── WAVE 1 — KH đang gõ tin nhắn ─────────────────────────────────────
    // SDK fire mỗi ~2s khi KH còn gõ. Auto-clear sau 5s không có event mới
    // (timer per conv, reset mỗi lần nhận event mới — tránh nháy).
    socket.on('zalo:typing', (data: { accountId: string; threadId: string; threadType: string; ts: number }) => {
      const conv = conversations.value.find(
        c => c.externalThreadId === data.threadId && c.zaloAccount?.id === data.accountId,
      );
      if (!conv) return;
      const m = new Map(typingConvIds.value);
      m.set(conv.id, Date.now());
      typingConvIds.value = m;
      // Reset timer: nếu đã có timer cho conv này → clear, set timer mới 5s
      const existingTimer = typingTimers.get(conv.id);
      if (existingTimer) window.clearTimeout(existingTimer);
      const newTimer = window.setTimeout(() => {
        const m2 = new Map(typingConvIds.value);
        m2.delete(conv.id);
        typingConvIds.value = m2;
        typingTimers.delete(conv.id);
      }, 5000);
      typingTimers.set(conv.id, newTimer);
    });

    // ─── WAVE 1+2 — bubble status update (delivered/seen) ─────────────────
    socket.on('zalo:message-status', (data: {
      accountId: string;
      conversationId: string;
      messageId: string;
      zaloMsgId?: string | null;
      deliveredAt?: string | null;
      seenAt?: string | null;
    }) => {
      // Update local messages cache nếu đang mở conv đúng
      if (messagesConvId.value === data.conversationId) {
        const msg = messages.value.find(
          m => m.id === data.messageId || (data.zaloMsgId && m.zaloMsgId === data.zaloMsgId),
        );
        if (msg) {
          msg.deliveredAt = data.deliveredAt ?? msg.deliveredAt;
          msg.seenAt = data.seenAt ?? msg.seenAt;
        }
      }
      // Patch persistent cache (lần sau quay lại conv vẫn thấy status đúng)
      const cached = messagesCache.get(data.conversationId);
      if (cached) {
        const msg = cached.find(
          m => m.id === data.messageId || (data.zaloMsgId && m.zaloMsgId === data.zaloMsgId),
        );
        if (msg) {
          msg.deliveredAt = data.deliveredAt ?? msg.deliveredAt;
          msg.seenAt = data.seenAt ?? msg.seenAt;
        }
      }
    });
  }

  // FIX socket-chết v2 (FIX 2) — treo qua đêm xong mở lại tab / có mạng lại là realtime
  // SỐNG NGAY, không cần F5. Nếu socket đang chết thì ép connect lại (socket-io đọc token
  // tươi qua callback auth; heal-auth trong socket.ts lo refresh nếu token hết hạn).
  function wakeReconnect() {
    if (document.hidden) return;
    if (socket && !socket.connected) socket.connect();
  }
  function onVisible() { wakeReconnect(); }
  function onOnline() { wakeReconnect(); }

  // Fix 2026-06-16 (anh báo avatar/tên KH lệch SDK): khi dialog xem info Zalo lấy được
  // avatar/tên mới từ SDK, patch tại chỗ conversation đang xem → header chat + dòng trong
  // ConversationList cập nhật NGAY (cùng object reference với conversations.value, không
  // chờ F5). BE đã persist Contact+Friend song song nên reload sau đó vẫn đúng.
  function patchContactProfile(p: {
    uid: string;
    avatarUrl?: string | null;
    displayName?: string | null;
    gender?: number | null;
  }) {
    if (!p?.uid) return;
    // SDK gender: 0=Nam, 1=Nữ, -1/khác=chưa rõ → map sang enum Contact.gender (string).
    const genderStr = p.gender === 0 ? 'male' : p.gender === 1 ? 'female' : null;
    for (const conv of conversations.value) {
      if (conv.threadType !== 'user') continue;
      // Match theo per-nick UID (externalThreadId — chính UID dialog mở) hoặc zaloUid Contact.
      const match = conv.externalThreadId === p.uid || conv.contact?.zaloUid === p.uid;
      if (!match) continue;
      if (p.avatarUrl) {
        if (conv.contact) conv.contact.avatarUrl = p.avatarUrl;
        if (conv.friendship) conv.friendship.zaloAvatarUrl = p.avatarUrl;
      }
      // Chỉ vá tên Zalo per-nick (zaloDisplayName) — KHÔNG đụng fullName (tên CRM thủ công)
      // và aliasInNick, để giữ ưu tiên hiển thị header.
      if (p.displayName && conv.friendship) conv.friendship.zaloDisplayName = p.displayName;
      if (genderStr && conv.contact && conv.contact.gender !== genderStr) {
        conv.contact.gender = genderStr;
      }
    }
  }

  function destroySocket() {
    window.removeEventListener('friend-crm-tags-changed', onFriendCrmTagsChanged);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    socket?.disconnect();
    socket = null;
  }

  return {
    conversations,
    selectedConvId,
    selectedConv,
    messages,
    loadingConvs,
    loadingMsgs,
    sendingMsg,
    searchQuery,
    accountFilter,
    extraFilters,
    aiSuggestion,
    aiSuggestionLoading,
    aiSuggestionError,
    aiSummary,
    aiSummaryLoading,
    aiSentiment,
    aiSentimentLoading,
    aiUsage,
    aiConfig,
    fetchConversations,
    fetchAiConfig,
    saveAiConfig,
    fetchAiUsage,
    fetchMessages,
    selectConversation,
    patchContactProfile,
    sendMessage,
    sendMessageTo,
    generateAiSuggestion,
    generateAiSummary,
    generateAiSentiment,
    clearAiState,
    initSocket,
    destroySocket,
    getSocket: () => socket,
    typingConvIds,
    socketConnected,
    // work-scope 2026-06-15
    outOfScopeCounts,
    clearOutOfScopeBadge: (accountId: string) => {
      if (!outOfScopeCounts.value.has(accountId)) return;
      const m = new Map(outOfScopeCounts.value);
      m.delete(accountId);
      outOfScopeCounts.value = m;
    },
    workScope,
  };
}
