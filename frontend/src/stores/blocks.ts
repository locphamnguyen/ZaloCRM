/**
 * blocks.ts — Pinia store for Block library state + mutations.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  uploadAttachment,
  deleteAttachment,
  type Block,
  type BlockListParams,
  type CreateBlockPayload,
  type UpdateBlockPayload,
} from '@/api/blocks-api';

export { type Block, type BlockListParams };

export const useBlocksStore = defineStore('blocks', () => {
  const blocks = ref<Block[]>([]);
  const total = ref(0);
  const loading = ref(false);

  async function fetch(params?: BlockListParams): Promise<void> {
    loading.value = true;
    try {
      const result = await listBlocks(params);
      blocks.value = result.blocks;
      total.value = result.total;
    } catch (err) {
      console.error('[blocks store] fetch error:', err);
    } finally {
      loading.value = false;
    }
  }

  async function create(payload: CreateBlockPayload): Promise<Block | null> {
    try {
      const block = await createBlock(payload);
      await fetch();
      return block;
    } catch (err) {
      console.error('[blocks store] create error:', err);
      return null;
    }
  }

  async function update(id: string, payload: UpdateBlockPayload): Promise<Block | null> {
    try {
      const block = await updateBlock(id, payload);
      const idx = blocks.value.findIndex((b) => b.id === id);
      if (idx !== -1) blocks.value[idx] = block;
      return block;
    } catch (err) {
      console.error('[blocks store] update error:', err);
      return null;
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await deleteBlock(id);
      blocks.value = blocks.value.filter((b) => b.id !== id);
      total.value = Math.max(0, total.value - 1);
      return true;
    } catch (err) {
      console.error('[blocks store] remove error:', err);
      return false;
    }
  }

  async function uploadBlockAttachment(blockId: string, file: File) {
    try {
      const att = await uploadAttachment(blockId, file);
      // Refresh the block in the list so attachments are up-to-date
      await fetch();
      return att;
    } catch (err) {
      console.error('[blocks store] uploadAttachment error:', err);
      return null;
    }
  }

  async function deleteBlockAttachment(blockId: string, attId: string): Promise<boolean> {
    try {
      await deleteAttachment(blockId, attId);
      await fetch();
      return true;
    } catch (err) {
      console.error('[blocks store] deleteAttachment error:', err);
      return false;
    }
  }

  return {
    blocks,
    total,
    loading,
    fetch,
    create,
    update,
    remove,
    uploadBlockAttachment,
    deleteBlockAttachment,
  };
});
