import { api } from '@/api';
import type { Block, BlockFolder, BlockActionType } from './types';

const BLOCKS = '/automation/blocks';
const FOLDERS = '/automation/block-folders';

// ── Blocks ─────────────────────────────────────────────────────────────────

export interface BlockListQuery {
  channel?: string;
  actionType?: BlockActionType;
  folderId?: string;
  ownerNickId?: string;
  tags?: string[]; // 2026-06-04 — filter multi tag
  includeArchived?: boolean;
  limit?: number;
}

export async function listBlocks(query: BlockListQuery = {}): Promise<Block[]> {
  const params: Record<string, string> = {};
  if (query.channel) params.channel = query.channel;
  if (query.actionType) params.actionType = query.actionType;
  if (query.folderId) params.folderId = query.folderId;
  if (query.ownerNickId) params.ownerNickId = query.ownerNickId;
  if (query.tags && query.tags.length > 0) params.tags = query.tags.join(',');
  if (query.includeArchived) params.includeArchived = 'true';
  if (query.limit) params.limit = String(query.limit);
  const { data } = await api.get<{ blocks: Block[] }>(BLOCKS, { params });
  return data.blocks;
}

export async function getBlock(id: string): Promise<Block> {
  const { data } = await api.get<Block>(`${BLOCKS}/${id}`);
  return data;
}

export interface BlockCreateInput {
  name: string;
  channel?: string;
  actionType: BlockActionType;
  content: Record<string, unknown>;
  folderId?: string | null;
  ownerNickId?: string | null;
  isShared?: boolean;
  tagIds?: string[]; // 2026-06-04 — multi tag dự án/mục đích
}

export async function createBlock(input: BlockCreateInput): Promise<Block> {
  const { data } = await api.post<Block>(BLOCKS, input);
  return data;
}

export async function updateBlock(id: string, patch: Partial<BlockCreateInput>): Promise<Block> {
  const { data } = await api.put<Block>(`${BLOCKS}/${id}`, patch);
  return data;
}

export async function archiveBlock(id: string): Promise<Block> {
  const { data } = await api.post<Block>(`${BLOCKS}/${id}/archive`);
  return data;
}

export async function unarchiveBlock(id: string): Promise<Block> {
  const { data } = await api.post<Block>(`${BLOCKS}/${id}/unarchive`);
  return data;
}

export async function duplicateBlock(id: string): Promise<Block> {
  const { data } = await api.post<Block>(`${BLOCKS}/${id}/duplicate`);
  return data;
}

export async function deleteBlock(id: string): Promise<void> {
  await api.delete(`${BLOCKS}/${id}`);
}

// ── Block folders ──────────────────────────────────────────────────────────

export async function listFolders(): Promise<BlockFolder[]> {
  const { data } = await api.get<{ folders: BlockFolder[] }>(FOLDERS);
  return data.folders;
}

export interface FolderCreateInput {
  name: string;
  visibility?: 'public' | 'private'; // 2026-06-04 — Anh chốt
  parentId?: string | null;
  ownerNickId?: string | null;
  ownerUserId?: string | null;
}

export async function createFolder(input: FolderCreateInput): Promise<BlockFolder> {
  const { data } = await api.post<BlockFolder>(FOLDERS, input);
  return data;
}

export async function updateFolder(id: string, patch: Partial<FolderCreateInput>): Promise<BlockFolder> {
  const { data } = await api.put<BlockFolder>(`${FOLDERS}/${id}`, patch);
  return data;
}

export async function deleteFolder(id: string, force = false): Promise<void> {
  await api.delete(`${FOLDERS}/${id}`, { params: force ? { force: 'true' } : {} });
}

// ─── Phase 1 MVP 2026-06-04 — 3 endpoint mới (Anh chốt B+C Hybrid) ──────────

export async function listRecentBlocks(): Promise<Block[]> {
  const { data } = await api.get<{ blocks: Block[] }>('/me/blocks/recent');
  return data.blocks;
}

export interface ResolvedComponent {
  messageType: string;
  payload: Record<string, unknown>;
}
export interface ResolveForSendResult {
  blockId: string;
  blockName: string;
  actionType: BlockActionType;
  resolved: ResolvedComponent[];
}
export async function resolveBlockForSend(id: string): Promise<ResolveForSendResult> {
  const { data } = await api.post<ResolveForSendResult>(`${BLOCKS}/${id}/resolve-for-send`);
  return data;
}

export interface FromComposerInput {
  name: string;
  folderId?: string | null;
  tagIds?: string[];
  components: Array<Record<string, unknown>>;
}
export async function blockFromComposer(input: FromComposerInput): Promise<Block> {
  const { data } = await api.post<Block>(`${BLOCKS}/from-composer`, input);
  return data;
}

// ─── Gửi cả Khối vào 1 hội thoại (cột 4 tab Automation) 2026-06-07 ──────────
// Backend dispatch ĐỦ mọi thành phần (text/image/album/file/video) đúng thứ tự,
// giữ rich-text, render {gender}/{name}/{sale}, delay an toàn giữa tin. Tin hiện
// live ở cột 3 qua socket 'chat:message' (không cần refetch).
export interface SendBlockResult {
  ok: boolean;
  sentCount: number;
  totalMessages: number;
  partial: boolean;
  errors: Array<{ index: number; type: string; message: string }>;
  stub?: boolean;
}
export async function sendBlockToConversation(
  conversationId: string,
  blockId: string,
): Promise<SendBlockResult> {
  const { data } = await api.post<SendBlockResult>(
    `/conversations/${conversationId}/send-block`,
    { blockId },
  );
  return data;
}
