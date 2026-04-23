/**
 * blocks-api.ts — Typed API wrappers for Block endpoints.
 * Routes are at /api/blocks (no /v1 prefix) so we use apiRoot instance.
 */
import axios from 'axios';
import { api } from '@/api/index';

// Separate instance for /api/blocks (not /api/v1/blocks)
export const apiRoot = axios.create({ baseURL: '' });
apiRoot.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Types ────────────────────────────────────────────────────────────────

export type BlockType = 'text' | 'html' | 'image' | 'video' | 'file' | 'link' | 'card';

export interface BlockAttachment {
  id: string;
  filename: string;
  mimeType: string;
  url: string;
  size: number;
}

export interface Block {
  id: string;
  name: string;
  type: BlockType;
  content: Record<string, unknown>;
  isShared: boolean;
  attachments: BlockAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface BlockListParams {
  type?: BlockType;
  q?: string;
  page?: number;
}

export interface BlockListResult {
  blocks: Block[];
  total: number;
}

export interface CreateBlockPayload {
  name: string;
  type: BlockType;
  content: Record<string, unknown>;
  isShared?: boolean;
}

export interface UpdateBlockPayload {
  name?: string;
  content?: Record<string, unknown>;
  isShared?: boolean;
}

export interface SendBlockPayload {
  conversationId: string;
}

export interface PreviewBlockPayload {
  contactId?: string;
}

// ─── API functions ────────────────────────────────────────────────────────

export async function listBlocks(params?: BlockListParams): Promise<BlockListResult> {
  const res = await apiRoot.get<BlockListResult>('/api/blocks', { params });
  return res.data;
}

export async function getBlock(id: string): Promise<Block> {
  const res = await apiRoot.get<{ block: Block }>(`/api/blocks/${id}`);
  return res.data.block;
}

export async function createBlock(payload: CreateBlockPayload): Promise<Block> {
  const res = await apiRoot.post<{ block: Block }>('/api/blocks', payload);
  return res.data.block;
}

export async function updateBlock(id: string, payload: UpdateBlockPayload): Promise<Block> {
  const res = await apiRoot.patch<{ block: Block }>(`/api/blocks/${id}`, payload);
  return res.data.block;
}

export async function deleteBlock(id: string): Promise<void> {
  await apiRoot.delete(`/api/blocks/${id}`);
}

export async function uploadAttachment(blockId: string, file: File): Promise<BlockAttachment> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiRoot.post<{ attachment: BlockAttachment }>(
    `/api/blocks/${blockId}/attachments`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data.attachment;
}

export async function deleteAttachment(blockId: string, attId: string): Promise<void> {
  await apiRoot.delete(`/api/blocks/${blockId}/attachments/${attId}`);
}

export async function sendBlock(blockId: string, payload: SendBlockPayload): Promise<{ messageIds: string[]; rendered: unknown }> {
  const res = await apiRoot.post(`/api/blocks/${blockId}/send`, payload);
  return res.data;
}

export async function previewBlock(blockId: string, payload: PreviewBlockPayload): Promise<{ rendered: unknown }> {
  const res = await apiRoot.post(`/api/blocks/${blockId}/preview`, payload);
  return res.data;
}

// Re-export api for contacts search used in BlockPreview
export { api };
