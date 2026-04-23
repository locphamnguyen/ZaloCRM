/**
 * group-view.ts — Pinia store for group view state.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  listGroupViews,
  createGroupView,
  updateGroupView,
  deleteGroupView,
  type GroupView,
  type CreateGroupViewPayload,
  type UpdateGroupViewPayload,
} from '@/api/group-views';

export { type GroupView };

export const useGroupViewStore = defineStore('groupView', () => {
  const views = ref<GroupView[]>([]);
  const active = ref<GroupView | null>(null);
  const loading = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      views.value = await listGroupViews();
    } catch (err) {
      console.error('[groupView store] load error:', err);
    } finally {
      loading.value = false;
    }
  }

  async function create(payload: CreateGroupViewPayload): Promise<GroupView | null> {
    try {
      const view = await createGroupView(payload);
      views.value.push(view);
      return view;
    } catch (err) {
      console.error('[groupView store] create error:', err);
      return null;
    }
  }

  async function update(id: string, payload: UpdateGroupViewPayload): Promise<GroupView | null> {
    try {
      const updated = await updateGroupView(id, payload);
      const idx = views.value.findIndex((v) => v.id === id);
      if (idx !== -1) views.value[idx] = updated;
      if (active.value?.id === id) active.value = updated;
      return updated;
    } catch (err) {
      console.error('[groupView store] update error:', err);
      return null;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await deleteGroupView(id);
      views.value = views.value.filter((v) => v.id !== id);
      if (active.value?.id === id) active.value = null;
      return true;
    } catch (err) {
      console.error('[groupView store] remove error:', err);
      return false;
    }
  }

  function setActive(viewOrNull: GroupView | null): void {
    active.value = viewOrNull;
  }

  return { views, active, loading, load, create, update, remove, setActive };
});
