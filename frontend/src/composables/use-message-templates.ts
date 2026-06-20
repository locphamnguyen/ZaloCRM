// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { ref } from 'vue';
import { api } from '@/api';

export interface RichPayload {
  text: string;
  styles?: Array<{ st: string; start: number; len: number }>;
}

export interface MessageTemplate {
  id: string;
  name: string;
  shortcut?: string | null;
  content: string;
  contentRich?: RichPayload | null;
  category?: string | null;
  folderId?: string | null;
  visibility?: 'public' | 'private';
  tagIds?: string[];
  isPersonal?: boolean;
  isMine?: boolean;
  manualSendCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface MessageTemplateFolder {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  ownerUserId?: string | null;
  _count?: { templates: number };
}

export interface TemplateListFilter {
  folderId?: string;
  visibility?: string;
  tags?: string;        // 'tagA,tagB'
  category?: string;
  search?: string;
  includeArchived?: boolean;
}

export function useMessageTemplates() {
  const templates = ref<MessageTemplate[]>([]);
  const folders = ref<MessageTemplateFolder[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  async function fetchTemplates(filter: TemplateListFilter = {}) {
    loading.value = true;
    try {
      const params: Record<string, string> = {};
      if (filter.folderId) params.folderId = filter.folderId;
      if (filter.visibility) params.visibility = filter.visibility;
      if (filter.tags) params.tags = filter.tags;
      if (filter.category) params.category = filter.category;
      if (filter.search) params.search = filter.search;
      if (filter.includeArchived) params.includeArchived = 'true';
      const res = await api.get('/automation/templates', { params });
      templates.value = res.data.templates ?? [];
    } finally {
      loading.value = false;
    }
  }

  async function fetchFolders() {
    const res = await api.get('/automation/template-folders');
    folders.value = res.data.folders ?? [];
  }

  async function createTemplate(payload: Partial<MessageTemplate>) {
    saving.value = true;
    try {
      const res = await api.post('/automation/templates', payload);
      return res.data as MessageTemplate;
    } finally {
      saving.value = false;
    }
  }

  async function updateTemplate(id: string, payload: Partial<MessageTemplate>) {
    saving.value = true;
    try {
      const res = await api.put(`/automation/templates/${id}`, payload);
      return res.data as MessageTemplate;
    } finally {
      saving.value = false;
    }
  }

  async function deleteTemplate(id: string) {
    saving.value = true;
    try {
      await api.delete(`/automation/templates/${id}`);
      return true;
    } finally {
      saving.value = false;
    }
  }

  async function createFolder(payload: { name: string; visibility: 'public' | 'private' }) {
    const res = await api.post('/automation/template-folders', payload);
    return res.data as MessageTemplateFolder;
  }

  async function updateFolder(id: string, payload: Partial<MessageTemplateFolder>) {
    const res = await api.put(`/automation/template-folders/${id}`, payload);
    return res.data as MessageTemplateFolder;
  }

  async function deleteFolder(id: string, force = false) {
    await api.delete(`/automation/template-folders/${id}${force ? '?force=true' : ''}`);
    return true;
  }

  async function trackUse(id: string) {
    try { await api.post(`/automation/templates/${id}/track-use`); } catch { /* non-critical */ }
  }

  return {
    templates, folders, loading, saving,
    fetchTemplates, fetchFolders,
    createTemplate, updateTemplate, deleteTemplate,
    createFolder, updateFolder, deleteFolder, trackUse,
  };
}
