import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { io, Socket } from 'socket.io-client';
import type { Contact } from '@/composables/use-contacts';
import { useAuthStore } from '@/stores/auth';
import { applyPendingTags } from '@/composables/use-pending-mutations';

interface ZaloAccount {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
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

interface RawMessage extends Omit<Message, 'reactions' | 'reply'> {
  quote?: ReplyMessageRef | null;
  reactions?: Array<{ emoji: string; reactorId: string; count?: number; reacted?: boolean }>;
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
  /** Per-pair counters (RIÊNG cặp nick × KH này, KHÔNG phải Contact aggregate) */
  totalInbound?: number;
  totalOutbound?: number;
  /** Per-pair leadScore — sale chăm KH này từ nick này */
  leadScore?: number;
  statusRef?: { id: string; name: string; color: string | null; order: number } | null;
  /** Zalo native labels synced từ Zalo client (Friend.zaloLabels) */
  zaloLabels?: Array<{ id?: string; name?: string; color?: string }>;
  /** Per-pair CRM tags (kèm Zalo-mirrored "🔵 X" tags). Source of truth Friend-level. */
  crmTagsPerNick?: string[];
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
}

export interface MessageReactionView {
  emoji: string;
  count: number;
  reacted: boolean;
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
  albumKey: string | null;
  albumIndex: number | null;
  albumTotal: number | null;
  reply?: ReplyMessageRef | null;
  reactions?: MessageReactionView[];
}

// In-memory cache per-conv messages — quay lại conv cũ render ngay, fetch fresh background.
const messagesCache = new Map<string, Message[]>();

export function useChat() {
  const authStore = useAuthStore();
  const conversations = ref<Conversation[]>([]);
  const selectedConvId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const loadingConvs = ref(false);
  const loadingMsgs = ref(false);
  const sendingMsg = ref(false);
  const searchQuery = ref('');
  const accountFilter = ref<string | null>(null);
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

  // Debounce server-side reconcile: chỉ fetch full list sau 3s không có tin mới
  // → tránh lag khi nhận burst (chat group nhiều người gửi liên tiếp).
  function scheduleConvSync() {
    if (convSyncTimer) clearTimeout(convSyncTimer);
    convSyncTimer = setTimeout(() => {
      void fetchConversations();
      convSyncTimer = null;
    }, 3000);
  }

  const selectedConv = computed(() =>
    conversations.value.find(c => c.id === selectedConvId.value) || null,
  );

  function clearAiState() {
    aiSuggestion.value = '';
    aiSuggestionError.value = '';
    aiSummary.value = '';
    aiSentiment.value = null;
  }

  const extraFilters = ref<Record<string, string>>({});

  async function fetchConversations() {
    loadingConvs.value = true;
    try {
      const res = await api.get('/conversations', {
        params: {
          limit: 100,
          search: searchQuery.value,
          accountId: accountFilter.value || undefined,
          ...extraFilters.value,
        },
      });
      // Apply pending optimistic mutations (tag assigns chưa được BE confirm) trước khi
      // replace state — tránh fetchConversations chạy giữa lúc BE đang sync wipe UI optimistic.
      conversations.value = applyPendingTags(res.data.conversations);
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
    };
  }

  async function fetchMessages(convId: string) {
    // Cache-then-refresh: nếu đã từng load conv này, set list ngay từ cache để
    // user thấy giao diện tin nhắn lập tức; rồi fetch fresh in background.
    const cached = messagesCache.get(convId);
    if (cached) {
      messages.value = cached;
      loadingMsgs.value = false;
    } else {
      loadingMsgs.value = true;
    }
    try {
      const res = await api.get(`/conversations/${convId}/messages`, {
        params: { limit: 100 },
      });
      const list = (res.data.messages as RawMessage[]).map(normalizeMessage);
      messagesCache.set(convId, list);
      // Tránh ghi đè khi user đã đổi sang conv khác trong lúc đợi response
      if (selectedConvId.value === convId) messages.value = list;
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
    await fetchMessages(convId);
    try {
      const convDetail = await api.get(`/conversations/${convId}`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv) {
        if (convDetail.data.contact) conv.contact = convDetail.data.contact;
        // friendship per-pair (counter, leadScore, status RIÊNG cặp nick×KH).
        // KHÔNG fallback contact aggregate vì các trường này khác semantics.
        if (convDetail.data.friendship !== undefined) conv.friendship = convDetail.data.friendship;
      }
    } catch {
      // Non-critical
    }
    try {
      await api.post(`/conversations/${convId}/mark-read`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv) conv.unreadCount = 0;
    } catch {
      // Ignore mark-read errors
    }
    // Note: Auto-sync Zalo profile được xử lý ở MessageThread.touchConversationProfile
    // (gọi POST /conversations/:id/touch-profile, cooldown 5min server-side). KHÔNG
    // duplicate ở đây để tránh spam SDK + 404 lên endpoint /contacts/:id/sync-zalo-profile
    // (legacy, đã bỏ).
    // AI summary + sentiment KHÔNG auto-fire mỗi lần đổi conv — user bấm nút refresh khi cần.
    // Trước đây 2 LLM call awaited mỗi switch = 2-10s + tốn quota.
    void fetchAiUsage();
  }

  async function sendMessage(content: string, replyMessageId?: string | null) {
    if (!selectedConvId.value || !content.trim()) return;
    await sendMessageTo(selectedConvId.value, content, replyMessageId);
  }

  /** Insert message vào messages.value đúng vị trí sort theo sentAt ASC.
   *  Binary search O(log N) — không re-sort toàn array. Dùng cho socket arrivals
   *  và sendMessageTo (msg vừa POST cũng có thể đến trễ hơn 1 msg từ socket khác). */
  function insertMessageSorted(msg: Message) {
    const arr = messages.value;
    const t = new Date(msg.sentAt).getTime();
    // Fast path: append-to-end (msg mới nhất, thường case)
    if (arr.length === 0 || new Date(arr[arr.length - 1].sentAt).getTime() <= t) {
      arr.push(msg);
      return;
    }
    // Binary search vị trí đầu tiên có sentAt > t
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (new Date(arr[mid].sentAt).getTime() <= t) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, msg);
  }

  async function sendMessageTo(conversationId: string, content: string, replyMessageId?: string | null) {
    if (!content.trim()) return;
    sendingMsg.value = true;
    try {
      const payload = replyMessageId ? { content, replyMessageId } : { content };
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

  function initSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('chat:message', (data: { message: Message; conversationId: string }) => {
      if (data.conversationId === selectedConvId.value) {
        if (!messages.value.find(m => m.id === data.message.id)) {
          // INSERT theo sortedBy sentAt thay vì push cuối array. Lý do: socket có
          // thể giao messages KHÔNG theo chronological order (vd old_messages backfill
          // delivers reverse, hoặc 2 msg cùng giây tới khác thứ tự server vs client).
          // Nếu push cuối thì msg cũ tới muộn → hiển thị sai vị trí (user báo
          // case "Đúng rồi bác" sent at 15:14:14 nhưng hiển thị SAU "ố toẹt vời"
          // sent at 15:14:23 vì old_messages giao ngược).
          insertMessageSorted(normalizeMessage(data.message as RawMessage));
        }
      }
      // Optimistic update conversation list — tránh fetch full HTTP mỗi message
      // (cũ: fetchConversations() per event → 143 rows re-render → lag rõ).
      const idx = conversations.value.findIndex(c => c.id === data.conversationId);
      if (idx !== -1) {
        const conv = conversations.value[idx];
        if (conv.contact) {
          if (data.message.senderType === 'self') {
            conv.contact.totalOutbound = (conv.contact.totalOutbound ?? 0) + 1;
            conv.contact.lastOutboundAt = data.message.sentAt;
          } else {
            conv.contact.totalInbound = (conv.contact.totalInbound ?? 0) + 1;
            conv.contact.lastInboundAt = data.message.sentAt;
          }
          conv.contact.lastActivity = data.message.sentAt;
        }
        conv.lastMessageAt = data.message.sentAt;
        // Cập nhật messages preview để conv list hiển thị tin mới nhất ngay
        conv.messages = [data.message, ...(conv.messages || [])].slice(0, 1);
        if (data.message.senderType !== 'self' && conv.id !== selectedConvId.value) {
          conv.unreadCount = (conv.unreadCount ?? 0) + 1;
        }
        // Move conv to top (in-place — sort theo lastMessageAt sẽ cần thêm overhead)
        if (idx > 0) {
          conversations.value.splice(idx, 1);
          conversations.value.unshift(conv);
        }
      }
      // Debounce sync from server: chỉ fetch sau 3s im lặng → reconcile state
      // (tránh chạy mỗi tin → lag list khi nhận burst).
      scheduleConvSync();
    });

    socket.on('chat:deleted', (data: { messageId?: string; zaloMsgId?: string }) => {
      const msg = messages.value.find(m => m.id === data.messageId || m.zaloMsgId === data.zaloMsgId);
      if (msg) msg.isDeleted = true;
    });

    socket.on('chat:message-edited', (data: { messageId?: string; zaloMsgId?: string; content: string }) => {
      const msg = messages.value.find(m => m.id === data.messageId || m.zaloMsgId === data.zaloMsgId);
      if (msg) msg.content = data.content;
    });

    socket.on('chat:reactions', (data: { messageId?: string; msgId?: string; zaloMsgId?: string; reactions: { userId: string; userName: string; reaction: string; action: 'add' | 'remove' }[] }) => {
      const msg = messages.value.find(m => m.id === data.messageId || m.id === data.msgId || m.zaloMsgId === data.zaloMsgId);
      if (!msg) return;
      // Merge với reactions hiện có thay vì replace — tránh mất emoji của user khác
      const counts = new Map<string, number>();
      const myEmojis = new Set<string>();
      for (const r of msg.reactions || []) {
        counts.set(r.emoji, r.count);
        if (r.reacted) myEmojis.add(r.emoji);
      }
      const myId = authStore.user?.id || '';
      for (const r of data.reactions) {
        const emoji = r.reaction;
        const isMine = r.userId === myId;
        if (r.action === 'add') {
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
    });

    socket.on('chat:pinned', () => {
      fetchConversations();
    });

    socket.on('chat:unpinned', () => {
      fetchConversations();
    });
  }

  function destroySocket() {
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
    sendMessage,
    sendMessageTo,
    generateAiSuggestion,
    generateAiSummary,
    generateAiSentiment,
    clearAiState,
    initSocket,
    destroySocket,
    getSocket: () => socket,
  };
}
