/**
 * custom-attrs.ts — Pinia store for custom attribute definitions.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  listAttrDefs,
  createAttrDef,
  updateAttrDef,
  deleteAttrDef,
  type AttrDef,
  type CreateAttrDefPayload,
  type UpdateAttrDefPayload,
} from '@/api/custom-attrs-api';

export { type AttrDef };

export const useCustomAttrsStore = defineStore('customAttrs', () => {
  const defs = ref<AttrDef[]>([]);
  const loading = ref(false);
  let loaded = false;

  async function fetch(force = false): Promise<void> {
    if (loaded && !force) return;
    loading.value = true;
    try {
      defs.value = await listAttrDefs();
      loaded = true;
    } catch (err) {
      console.error('[customAttrs store] fetch error:', err);
    } finally {
      loading.value = false;
    }
  }

  async function create(payload: CreateAttrDefPayload): Promise<AttrDef | null> {
    try {
      const def = await createAttrDef(payload);
      defs.value.push(def);
      return def;
    } catch (err) {
      console.error('[customAttrs store] create error:', err);
      return null;
    }
  }

  async function update(id: string, payload: UpdateAttrDefPayload): Promise<AttrDef | null> {
    try {
      const updated = await updateAttrDef(id, payload);
      const idx = defs.value.findIndex((d) => d.id === id);
      if (idx !== -1) defs.value[idx] = updated;
      return updated;
    } catch (err) {
      console.error('[customAttrs store] update error:', err);
      return null;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await deleteAttrDef(id);
      defs.value = defs.value.filter((d) => d.id !== id);
      return true;
    } catch (err) {
      console.error('[customAttrs store] remove error:', err);
      return false;
    }
  }

  return { defs, loading, fetch, create, update, remove };
});
