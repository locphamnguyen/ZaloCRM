// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-notes — CRM notes thread on a contact.
 * Flat thread (root + 1-level replies), emoji reactions, AI appointment parse.
 */
import { ref, computed } from 'vue';
import { api } from '@/api/index';

export interface NoteReaction {
  id: string;
  emoji: string;
  userId: string;
  user?: { fullName: string | null };
}

export interface NoteAppointmentLink {
  id: string;
  appointmentDate: string;
  appointmentTime: string | null;
  status: string;
  type: string | null;
}

export interface Note {
  id: string;
  contactId: string;
  parentNoteId: string | null;
  authorUserId: string;
  author?: { id: string; fullName: string | null; email: string };
  body: string;
  suggestedAppointmentId: string | null;
  appointment?: NoteAppointmentLink | null;
  createdAt: string;
  updatedAt: string;
  reactions: NoteReaction[];
  replies?: Note[];
}

export interface ParsedAppointment {
  date: string | null;
  time: string | null;
  type: 'call' | 'message' | 'meeting' | 'follow_up' | null;
  location: string | null;
  summary: string;
  hasIntent: boolean;
  missingFields: string[];   // 'date' | 'time' | 'location'
  confidence: number;
  source?: 'ai' | 'fallback'; // 'ai'=Gemini OK, 'fallback'=rule-based khi AI fail
}

export function useNotes(getContactId: () => string | null) {
  const notes = ref<Note[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  const rootCount = computed(() => notes.value.length);

  async function fetch() {
    const contactId = getContactId();
    if (!contactId) { notes.value = []; return; }
    loading.value = true;
    try {
      const { data } = await api.get(`/contacts/${contactId}/notes`);
      notes.value = data.notes || [];
    } catch (err) {
      console.error('[notes] fetch error', err);
      notes.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function create(body: string, parentNoteId: string | null = null): Promise<Note | null> {
    const contactId = getContactId();
    if (!contactId || !body.trim()) return null;
    saving.value = true;
    try {
      const { data } = await api.post(`/contacts/${contactId}/notes`, { body: body.trim(), parentNoteId });
      const created: Note = data.note;
      if (parentNoteId) {
        const root = notes.value.find(n => n.id === parentNoteId);
        if (root) {
          root.replies = root.replies || [];
          root.replies.push(created);
        }
      } else {
        notes.value.unshift(created);
      }
      return created;
    } catch (err) {
      console.error('[notes] create error', err);
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function update(id: string, body: string): Promise<boolean> {
    saving.value = true;
    try {
      const { data } = await api.patch(`/notes/${id}`, { body: body.trim() });
      const next: Note = data.note;
      // Update in tree
      const root = notes.value.find(n => n.id === id);
      if (root) Object.assign(root, next);
      else {
        for (const r of notes.value) {
          const reply = r.replies?.find(x => x.id === id);
          if (reply) { Object.assign(reply, next); break; }
        }
      }
      return true;
    } catch (err) {
      console.error('[notes] update error', err);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await api.delete(`/notes/${id}`);
      const rootIdx = notes.value.findIndex(n => n.id === id);
      if (rootIdx !== -1) notes.value.splice(rootIdx, 1);
      else {
        for (const r of notes.value) {
          if (r.replies) {
            const i = r.replies.findIndex(x => x.id === id);
            if (i !== -1) { r.replies.splice(i, 1); break; }
          }
        }
      }
      return true;
    } catch (err) {
      console.error('[notes] delete error', err);
      return false;
    }
  }

  async function toggleReaction(noteId: string, emoji: string, currentUserId: string): Promise<void> {
    try {
      const { data } = await api.post(`/notes/${noteId}/reactions`, { emoji });
      const note = findNote(noteId);
      if (!note) return;
      if (data.toggled === 'removed') {
        note.reactions = note.reactions.filter(r => !(r.userId === currentUserId && r.emoji === emoji));
      } else if (data.reaction) {
        // Server returns reaction with `userId` already (matches NoteReaction shape).
        note.reactions.push({ ...data.reaction, userId: data.reaction.userId ?? currentUserId });
      }
    } catch (err) {
      console.error('[notes] reaction error', err);
    }
  }

  function findNote(id: string): Note | null {
    const root = notes.value.find(n => n.id === id);
    if (root) return root;
    for (const r of notes.value) {
      const reply = r.replies?.find(x => x.id === id);
      if (reply) return reply;
    }
    return null;
  }

  async function aiParse(noteId: string): Promise<ParsedAppointment | null> {
    try {
      const { data } = await api.post(`/notes/${noteId}/ai-parse`);
      return data.parsed || null;
    } catch (err) {
      console.error('[notes] AI parse error', err);
      return null;
    }
  }

  async function linkAppointment(noteId: string, appointmentId: string): Promise<boolean> {
    try {
      const { data } = await api.post(`/notes/${noteId}/link-appointment`, { appointmentId });
      const next: Note = data.note;
      const target = findNote(noteId);
      if (target) Object.assign(target, next);
      return true;
    } catch (err) {
      console.error('[notes] link appointment error', err);
      return false;
    }
  }

  return {
    notes,
    loading,
    saving,
    rootCount,
    fetch,
    create,
    update,
    remove,
    toggleReaction,
    aiParse,
    linkAppointment,
  };
}
