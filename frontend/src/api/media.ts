// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * media.ts — API client cho Kho phương tiện (Phase Media Library 2026-06-11).
 */
import { api } from './index';

export interface MediaAssetItem {
  id: string;
  kind: 'image' | 'video' | 'file';
  name: string;
  visibility: 'private' | 'public';
  ownerUserId: string | null;
  tagIds: string[];
  usageCount: number;
  url: string | null;
  thumbnailUrl: string | null;
  sizeBytes: number | null;
  durationSec?: number | null;
  createdAt: string;
  // Watermark per-ảnh (GĐ2) — backend trả khi list/detail.
  watermarkEnabled?: boolean;
  watermarkPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
  watermarkOpacity?: number;
  watermarkUrl?: string | null;
  // Privacy (D11): ảnh lưu từ nick Riêng tư → cần xác nhận khi chia sẻ công khai.
  sourceFromPrivateNick?: boolean;
  favorited?: boolean;
  // 2026-06-15: nguồn để hiển thị "ảnh từ nick nào / sale nào / kích thước".
  source?: 'upload' | 'saved_from_chat';
  ownerName?: string | null;       // tên sale (chủ sở hữu)
  sourceNickName?: string | null;  // tên nick Zalo nguồn (null = upload tay / nick đã xóa)
  width?: number | null;           // kích thước px (ảnh mới); null = ảnh cũ chưa đo → hiện '—'
  height?: number | null;
}

export interface ListMediaParams {
  kind?: string;
  tag?: string;
  folderId?: string;
  visibility?: string;
  q?: string;
  limit?: number;
  // Lever 2 (lọc sâu) — anh chốt 2026-06-12.
  since?: '7d' | '30d' | '90d';
  sizeMin?: number;
  sizeMax?: number;
  sort?: 'recent' | 'newest' | 'most_used' | 'name';
  // 2026-06-16: phân trang theo trang + lọc theo người tải lên (block picker).
  skip?: number;
  ownerUserId?: string;
}

/** Liệt kê kho (scope theo owner + visibility ở backend). */
export async function listMedia(params: ListMediaParams = {}): Promise<MediaAssetItem[]> {
  const { data } = await api.get('/media', { params });
  return data.items as MediaAssetItem[];
}

/** Như listMedia nhưng KÈM tổng số khớp filter (để phân trang: "Trang X/Y" + đếm). */
export async function listMediaPaged(
  params: ListMediaParams = {},
): Promise<{ items: MediaAssetItem[]; total: number }> {
  const { data } = await api.get('/media', { params });
  return { items: data.items as MediaAssetItem[], total: (data.total as number) ?? 0 };
}

/** Danh sách người tải lên (có ảnh trong scope) + số lượng — đổ vào dropdown lọc người upload. */
export async function listMediaUploaders(
  params: { kind?: string; visibility?: string } = {},
): Promise<Array<{ id: string; name: string; count: number }>> {
  const { data } = await api.get('/media/uploaders', { params });
  return data.uploaders as Array<{ id: string; name: string; count: number }>;
}

/** Tải tệp lên kho (multipart). */
export async function uploadMedia(
  files: File[],
  opts: { visibility?: 'private' | 'public'; folderId?: string; tagIds?: string[] } = {},
): Promise<{ assets: Array<{ id: string; name: string; deduped: boolean }> }> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  if (opts.visibility) form.append('visibility', opts.visibility);
  if (opts.folderId) form.append('folderId', opts.folderId);
  if (opts.tagIds) form.append('tagIds', JSON.stringify(opts.tagIds));
  const { data } = await api.post('/media/upload', form);
  return data;
}

/** Lưu 1 tin nhắn (ảnh/file khách hoặc mình gửi) vào kho. */
export async function saveFromChat(
  messageId: string,
  visibility?: 'private' | 'public',
): Promise<{ asset: { id: string; name: string }; deduped: boolean }> {
  const { data } = await api.post('/media/save-from-chat', { messageId, visibility });
  return data;
}

/** Lưu NHIỀU tin nhắn (cả album / chọn nhiều ảnh) vào kho 1 lần. */
export async function saveFromChatBatch(
  messageIds: string[],
  visibility?: 'private' | 'public',
): Promise<{ savedCount: number; dedupedCount: number; blocked: number; skipped: number; failed: number; assets: Array<{ id: string; name: string }> }> {
  const { data } = await api.post('/media/save-from-chat-batch', { messageIds, visibility });
  return data;
}

/** Chèn 1 asset từ kho vào 1 hội thoại (gửi đi). addTags: gắn tag/dự án LÚC GỬI (2026-06-15). */
export async function sendMediaToConversation(
  assetId: string,
  conversationId: string,
  caption?: string,
  addTags?: string[],
): Promise<{ message: unknown }> {
  const { data } = await api.post(`/media/${assetId}/send`, { conversationId, caption, addTags });
  return data;
}

// ── GĐ2 ──────────────────────────────────────────────────────────────────────
export interface MediaFolder {
  id: string;
  name: string;
  kind: string;
  visibility: 'private' | 'public';
  ownerUserId: string | null;
}

/** Sửa quyền/tên/tag/thư mục của 1 asset. confirmShare=true: xác nhận chia sẻ ảnh nick Riêng tư (D11). */
export async function updateMedia(
  id: string,
  patch: { name?: string; visibility?: 'private' | 'public'; tagIds?: string[]; folderId?: string | null; confirmShare?: boolean },
): Promise<{ asset: { id: string; name: string; visibility: string; tagIds: string[] } }> {
  const { data } = await api.patch(`/media/${id}`, patch);
  return data;
}

/** Xóa 1 asset khỏi kho → vào THÙNG RÁC (xóa mềm, giữ file gốc). GĐ13a. */
export async function archiveMedia(id: string): Promise<{ ok: boolean }> {
  const { data } = await api.delete(`/media/${id}`);
  return data;
}

// ── GĐ13a: Thùng rác Media ──────────────────────────────────────────────────
export interface TrashItem extends MediaAssetItem {
  archivedAt: string;
  trashedById: string | null;
  daysUntilPurge: number; // còn N ngày trước khi cron tự dọn khỏi danh sách
}

/** Danh sách asset trong thùng rác (archivedAt != null) — có phân trang cursor. */
export async function listTrash(
  params: { kind?: string; limit?: number; cursor?: string } = {},
): Promise<{ items: TrashItem[]; nextCursor: string | null }> {
  const { data } = await api.get('/media/trash', { params });
  return data;
}

/** Khôi phục 1 asset từ thùng rác về kho. */
export async function restoreMedia(id: string): Promise<{ ok: boolean }> {
  const { data } = await api.post(`/media/${id}/restore`);
  return data;
}

/** Xóa vĩnh viễn 1 asset khỏi kho NGAY (chỉ khi đang ở thùng rác). Cần quyền media.delete. */
export async function permanentDeleteMedia(id: string): Promise<{ ok: boolean }> {
  const { data } = await api.delete(`/media/${id}/permanent`);
  return data;
}

/** Dọn sạch thùng rác (theo batch). Trả số đã xóa + còn nữa không. */
export async function emptyTrash(): Promise<{ ok: boolean; deleted: number; hasMore: boolean }> {
  const { data } = await api.delete('/media/trash/empty');
  return data;
}

/** GĐ12: gán folder / thêm tag HÀNG LOẠT cho nhiều ảnh (multi-select trên /media). */
export async function bulkUpdateMedia(
  ids: string[],
  patch: { folderId?: string | null; addTags?: string[] },
): Promise<{ ok: boolean; updated: number }> {
  const { data } = await api.patch('/media/bulk', { ids, ...patch });
  return data;
}

/** Đóng dấu logo HS lên 1 ảnh (BẬT watermark per-ảnh + chọn góc/độ mờ). */
export async function watermarkMedia(
  id: string,
  opts: { position?: string; opacity?: number } = {},
): Promise<{ blobId: string; url: string }> {
  const { data } = await api.post(`/media/${id}/watermark`, opts);
  return data;
}

/** TẮT watermark per-ảnh — gửi lại ảnh gốc (giữ bản watermark variant nếu cần bật lại). */
export async function removeWatermark(id: string): Promise<{ ok: boolean }> {
  const { data } = await api.delete(`/media/${id}/watermark`);
  return data;
}

/** Liệt kê thư mục kho. */
export async function listMediaFolders(): Promise<MediaFolder[]> {
  const { data } = await api.get('/media/folders');
  return data.folders as MediaFolder[];
}

/** Toggle yêu thích 1 ảnh (vào/khỏi bộ sưu tập cá nhân). */
export async function toggleFavorite(id: string): Promise<{ favorited: boolean }> {
  const { data } = await api.post(`/media/${id}/favorite`);
  return data;
}

/** Danh sách ảnh yêu thích của user. */
export async function listFavorites(): Promise<MediaAssetItem[]> {
  const { data } = await api.get('/media/favorites');
  return data.items as MediaAssetItem[];
}

/** Gửi nhiều ảnh (album) vào 1 hội thoại 1 lần. */
export async function sendAlbumToConversation(
  assetIds: string[], conversationId: string, caption?: string,
): Promise<{ sent: number }> {
  const { data } = await api.post('/media/album/send', { assetIds, conversationId, caption });
  return data;
}

/** Thống kê kho: top ảnh hay dùng + tổng quan (đo hiệu quả). */
export async function mediaStats(): Promise<{
  totalAssets: number;
  totalUsage: number;
  topUsed: Array<{ id: string; name: string; kind: string; usageCount: number; thumbnailUrl: string | null }>;
}> {
  const { data } = await api.get('/media/stats');
  return data;
}

/** Gợi ý ảnh theo ngữ cảnh hội thoại (match tag khách). contactTags = TOÀN BỘ tag khách
 *  (cho chip gợi ý lúc gửi — eng-review #C); matchedTags chỉ là tag GIAO với ảnh-kho. */
export async function suggestMedia(
  conversationId: string,
): Promise<{ items: MediaAssetItem[]; matchedTags: string[]; contactTags: string[] }> {
  const { data } = await api.get('/media/suggest', { params: { conversationId } });
  return data;
}

/** Danh sách tag đang dùng (autocomplete + chip "tag hay dùng" lúc gửi). Scope owner ở BE. */
export async function listMediaTags(
  limit = 50,
): Promise<Array<{ tag: string; count: number }>> {
  const { data } = await api.get('/media/tags', { params: { limit } });
  return data.tags as Array<{ tag: string; count: number }>;
}

/** Tạo thư mục. */
export async function createMediaFolder(
  name: string,
  visibility: 'private' | 'public' = 'private',
): Promise<{ folder: { id: string; name: string } }> {
  const { data } = await api.post('/media/folders', { name, visibility });
  return data;
}
