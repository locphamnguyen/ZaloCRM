import { ref } from 'vue';
import type { Socket } from 'socket.io-client';
import { api } from '@/api/index';
import type { Message } from '@/composables/use-chat';

// Trạng thái typing và reply/edit
const typingUsers = ref<Map<string, { userId: string; userName: string }[]>>(new Map());
const replyingTo = ref<Message | null>(null);
const editingMessage = ref<Message | null>(null);

// Debounce typing — tránh spam server
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function useChatOperations() {
  async function addReaction(convId: string, msgId: string, reaction: string): Promise<void> {
    try {
      await api.post(`/conversations/${convId}/reactions`, { msgId, reaction });
    } catch (err) {
      console.error('Failed to add reaction:', err);
      throw err;
    }
  }

  function sendTypingEvent(convId: string): void {
    const existing = typingTimers.get(convId);
    if (existing) return; // đang trong cooldown 3s, bỏ qua

    api.post(`/conversations/${convId}/typing`).catch((err) => {
      console.error('Failed to send typing event:', err);
    });

    const timer = setTimeout(() => {
      typingTimers.delete(convId);
    }, 3000);
    typingTimers.set(convId, timer);
  }

  async function deleteMessage(convId: string, msgId: string): Promise<void> {
    try {
      await api.delete(`/conversations/${convId}/messages/${msgId}`);
    } catch (err) {
      console.error('Failed to delete message:', err);
      throw err;
    }
  }

  async function undoMessage(convId: string, msgId: string): Promise<void> {
    try {
      await api.post(`/conversations/${convId}/messages/${msgId}/undo`);
    } catch (err) {
      console.error('Failed to undo message:', err);
      throw err;
    }
  }

  async function editMessage(convId: string, msgId: string, content: string): Promise<void> {
    try {
      await api.post(`/conversations/${convId}/messages/${msgId}/edit`, { content });
    } catch (err) {
      console.error('Failed to edit message:', err);
      throw err;
    }
  }

  async function forwardMessage(convId: string, msgId: string, targetIds: string[]): Promise<void> {
    try {
      await api.post(`/conversations/${convId}/forward`, {
        msgId,
        targetConversationIds: targetIds,
      });
    } catch (err) {
      console.error('Failed to forward message:', err);
      throw err;
    }
  }

  async function pinConversation(convId: string): Promise<void> {
    try {
      await api.post(`/conversations/${convId}/pin`);
    } catch (err) {
      console.error('Failed to pin conversation:', err);
      throw err;
    }
  }

  async function unpinConversation(convId: string): Promise<void> {
    try {
      await api.post(`/conversations/${convId}/unpin`);
    } catch (err) {
      console.error('Failed to unpin conversation:', err);
      throw err;
    }
  }

  // Reply/edit helpers
  function setReplyTo(msg: Message) { replyingTo.value = msg; editingMessage.value = null; }
  function clearReplyTo() { replyingTo.value = null; }
  function setEditing(msg: Message) { editingMessage.value = msg; replyingTo.value = null; }
  function clearEditing() { editingMessage.value = null; }

  function registerSocketListeners(socket: Socket | null) {
    if (!socket) return;

    socket.on(
      'chat:typing',
      (data: { conversationId: string; typers: { userId: string; userName: string }[] }) => {
        try {
          typingUsers.value.set(data.conversationId, data.typers);
          // Trigger reactivity — Map mutations không tự reactive
          typingUsers.value = new Map(typingUsers.value);
        } catch (err) {
          console.error('[chat-ops] typing event error:', err);
        }
      },
    );

    socket.on(
      'chat:message-edited',
      (_data: { conversationId: string; msgId: string; content: string }) => {
        // Caller handles update via fetchMessages or direct mutation
      },
    );
  }

  return {
    typingUsers,
    replyingTo,
    editingMessage,
    addReaction,
    sendTypingEvent,
    deleteMessage,
    undoMessage,
    editMessage,
    forwardMessage,
    pinConversation,
    unpinConversation,
    setReplyTo,
    clearReplyTo,
    setEditing,
    clearEditing,
    registerSocketListeners,
  };
}
