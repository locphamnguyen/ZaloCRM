/**
 * tags.ts — Pinia store for CRM tags, Zalo tags, contact tag links, and auto-tag rules.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  listContactTags,
  addContactTag,
  removeContactTag,
  listAutoTagRules,
  createAutoTagRule,
  updateAutoTagRule,
  deleteAutoTagRule,
  testAutoTagRule,
  type Tag,
  type ContactTag,
  type AutoTagRule,
  type CreateTagPayload,
  type UpdateTagPayload,
  type CreateRulePayload,
  type UpdateRulePayload,
} from '@/api/tags';

export { type Tag, type ContactTag, type AutoTagRule };

export const useTagsStore = defineStore('tags', () => {
  const crmTags = ref<Tag[]>([]);
  const zaloTags = ref<Tag[]>([]);
  const rules = ref<AutoTagRule[]>([]);
  const loading = ref(false);
  // Map: contactId → ContactTag[]
  const contactTagsMap = ref<Map<string, ContactTag[]>>(new Map());

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      const [crm, zalo, ruleList] = await Promise.all([
        listTags('crm'),
        listTags('zalo'),
        listAutoTagRules(),
      ]);
      crmTags.value = crm;
      zaloTags.value = zalo;
      rules.value = ruleList;
    } catch (err) {
      console.error('[tags store] loadAll error:', err);
    } finally {
      loading.value = false;
    }
  }

  // ── Tag CRUD ────────────────────────────────────────────────────────────

  async function createTagAction(payload: CreateTagPayload): Promise<Tag | null> {
    try {
      const tag = await createTag(payload);
      if (tag.source === 'crm') crmTags.value.push(tag);
      else zaloTags.value.push(tag);
      return tag;
    } catch (err) {
      console.error('[tags store] createTag error:', err);
      return null;
    }
  }

  async function updateTagAction(id: string, payload: UpdateTagPayload): Promise<Tag | null> {
    try {
      const updated = await updateTag(id, payload);
      const listRef = updated.source === 'crm' ? crmTags : zaloTags;
      const idx = listRef.value.findIndex((t) => t.id === id);
      if (idx !== -1) listRef.value[idx] = updated;
      return updated;
    } catch (err) {
      console.error('[tags store] updateTag error:', err);
      return null;
    }
  }

  async function deleteTagAction(id: string): Promise<boolean> {
    try {
      await deleteTag(id);
      crmTags.value = crmTags.value.filter((t) => t.id !== id);
      zaloTags.value = zaloTags.value.filter((t) => t.id !== id);
      return true;
    } catch (err) {
      console.error('[tags store] deleteTag error:', err);
      return false;
    }
  }

  // ── Contact tags ────────────────────────────────────────────────────────

  async function loadContactTags(contactId: string): Promise<void> {
    try {
      const tags = await listContactTags(contactId);
      contactTagsMap.value.set(contactId, tags);
    } catch (err) {
      console.error('[tags store] loadContactTags error:', err);
    }
  }

  async function addContactTagAction(contactId: string, tagId: string): Promise<boolean> {
    try {
      await addContactTag(contactId, tagId);
      await loadContactTags(contactId);
      return true;
    } catch (err) {
      console.error('[tags store] addContactTag error:', err);
      return false;
    }
  }

  async function removeContactTagAction(contactId: string, tagId: string): Promise<boolean> {
    try {
      await removeContactTag(contactId, tagId);
      const current = contactTagsMap.value.get(contactId) ?? [];
      contactTagsMap.value.set(contactId, current.filter((ct) => ct.tagId !== tagId));
      return true;
    } catch (err) {
      console.error('[tags store] removeContactTag error:', err);
      return false;
    }
  }

  // ── Auto-tag rules ──────────────────────────────────────────────────────

  async function createRule(payload: CreateRulePayload): Promise<AutoTagRule | null> {
    try {
      const rule = await createAutoTagRule(payload);
      rules.value.push(rule);
      return rule;
    } catch (err) {
      console.error('[tags store] createRule error:', err);
      return null;
    }
  }

  async function updateRule(id: string, payload: UpdateRulePayload): Promise<AutoTagRule | null> {
    try {
      const updated = await updateAutoTagRule(id, payload);
      const idx = rules.value.findIndex((r) => r.id === id);
      if (idx !== -1) rules.value[idx] = updated;
      return updated;
    } catch (err) {
      console.error('[tags store] updateRule error:', err);
      return null;
    }
  }

  async function deleteRule(id: string): Promise<boolean> {
    try {
      await deleteAutoTagRule(id);
      rules.value = rules.value.filter((r) => r.id !== id);
      return true;
    } catch (err) {
      console.error('[tags store] deleteRule error:', err);
      return false;
    }
  }

  async function testRule(id: string, samplePayload: unknown) {
    return testAutoTagRule(id, samplePayload);
  }

  return {
    crmTags,
    zaloTags,
    rules,
    loading,
    contactTagsMap,
    loadAll,
    createTag: createTagAction,
    updateTag: updateTagAction,
    deleteTag: deleteTagAction,
    loadContactTags,
    addContactTag: addContactTagAction,
    removeContactTag: removeContactTagAction,
    createRule,
    updateRule,
    deleteRule,
    testRule,
  };
});
