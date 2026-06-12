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
  createdAt: string;
  // Watermark per-ảnh (GĐ2) — backend trả khi list/detail.
  watermarkEnabled?: boolean;
  watermarkPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
  watermarkOpacity?: number;
  watermarkUrl?: string | null;
  // Privacy (D11): ảnh lưu từ nick Riêng tư → cần xác nhận khi chia sẻ công khai.
  sourceFromPrivateNick?: boolean;
  favorited?: boolean;
}

export interface ListMediaParams {
  kind?: string;
  tag?: string;
  folderId?: string;
  visibility?: string;
  q?: string;
  limit?: number;
}

/** Liệt kê kho (scope theo owner + visibility ở backend). */
export async function listMedia(params: ListMediaParams = {}): Promise<MediaAssetItem[]> {
  const { data } = await api.get('/media', { params });
  return data.items as MediaAssetItem[];
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

/** Chèn 1 asset từ kho vào 1 hội thoại (gửi đi). */
export async function sendMediaToConversation(
  assetId: string,
  conversationId: string,
  caption?: string,
): Promise<{ message: unknown }> {
  const { data } = await api.post(`/media/${assetId}/send`, { conversationId, caption });
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

/** Archive (xóa mềm) 1 asset khỏi kho. */
export async function archiveMedia(id: string): Promise<{ ok: boolean }> {
  const { data } = await api.delete(`/media/${id}`);
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

/** Gợi ý ảnh theo ngữ cảnh hội thoại (match tag khách). */
export async function suggestMedia(
  conversationId: string,
): Promise<{ items: MediaAssetItem[]; matchedTags: string[] }> {
  const { data } = await api.get('/media/suggest', { params: { conversationId } });
  return data;
}

/** Tạo thư mục. */
export async function createMediaFolder(
  name: string,
  visibility: 'private' | 'public' = 'private',
): Promise<{ folder: { id: string; name: string } }> {
  const { data } = await api.post('/media/folders', { name, visibility });
  return data;
}
