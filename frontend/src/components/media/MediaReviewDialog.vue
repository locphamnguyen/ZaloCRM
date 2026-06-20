<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  MediaReviewDialog — Bảng review 1 ảnh/video/file TRƯỚC khi gửi (Anh chốt 2026-06-15).
  Click 1 mục trong tab Media (cột chat) → mở popup overlay này:
    • Xem trước (ảnh xem ảnh, video play, file icon+tên)
    • Thông số: nick nguồn · sale · ngày · dung lượng · kích thước
    • Gắn / THÁO tag — LƯU NGAY khi bấm (không cần gửi). Autocomplete từ list tag kho.
      Ai cũng gắn được tag cho ảnh công khai (đúng chốt của Anh).
    • Nút Gửi (gửi mục này vào hội thoại đang mở) + Hủy.
  Theme Atlas v2 của chat (Lucide icon, action #1786be — KHÔNG emoji).
-->
<template>
  <div class="mr-overlay" @click.self="$emit('close')">
    <div class="mr-box">
      <header class="mr-head">
        <b class="mr-ttl" :title="local.name">{{ local.name }}</b>
        <button class="mr-x" title="Đóng" @click="$emit('close')"><XIcon :size="16" :stroke-width="2" /></button>
      </header>

      <div class="mr-body">
        <!-- 1. THÔNG SỐ (trên cùng) -->
        <dl class="mr-dl">
          <dt>Nguồn</dt>
          <dd><component :is="sourceIcon" :size="13" :stroke-width="1.9" class="mr-ddic" /> {{ sourceText }}</dd>
          <dt>Người lưu</dt>
          <dd>{{ local.ownerName || '—' }}</dd>
          <dt>Ngày lưu</dt>
          <dd>{{ fmtDate(local.createdAt) }}</dd>
          <dt>Dung lượng</dt>
          <dd>{{ sizeText }}</dd>
          <dt v-if="local.kind !== 'file'">Kích thước</dt>
          <dd v-if="local.kind !== 'file'">{{ dimText }}</dd>
        </dl>

        <!-- 2. THANH TAG: tháo (✕) + thêm (autocomplete) — LƯU NGAY. Dropdown bung LÊN TRÊN
             (mr-addrow position:relative + mr-ac bottom) để không bị preview phía dưới đè. -->
        <div class="mr-tags">
          <div class="mr-tlabel"><TagIcon :size="12" :stroke-width="2" /> Tag / dự án của ảnh</div>
          <div class="mr-chips">
            <span v-for="tag in tagIds" :key="tag" class="mr-chip">
              #{{ tag }}
              <button class="mr-chip-x" :disabled="savingTag" title="Tháo tag" @click="removeTag(tag)"><XIcon :size="11" :stroke-width="2.4" /></button>
            </span>
            <span v-if="tagIds.length === 0" class="mr-empty">Chưa có tag — bấm ô dưới để chọn tag có sẵn hoặc gõ tag mới</span>
          </div>
          <div class="mr-addrow">
            <input
              v-model="newTag" class="mr-input" autocomplete="off"
              placeholder="+ Thêm tag · Tab điền nốt · Enter thêm" :disabled="savingTag"
              @keydown="onTagKeydown"
              @input="acIndex = 0"
              @focus="focused = true"
              @blur="onTagBlur"
            />
            <!-- Dropdown gợi ý tự dựng — bung LÊN TRÊN ô nhập, nền bán trong suốt (mờ ~30%)
                 để vẫn thấy ảnh/video/file phía dưới xuyên qua (Anh chốt 2026-06-16). -->
            <ul v-if="suggestions.length" class="mr-ac">
              <li
                v-for="(s, i) in suggestions" :key="s"
                class="mr-ac-item" :class="{ on: i === acIndex }"
                @mousedown.prevent="pickSuggestion(s)"
                @mouseenter="acIndex = i"
              >#{{ s }}</li>
            </ul>
          </div>
          <div v-if="savingTag" class="mr-saving">Đang lưu tag…</div>
        </div>

        <!-- 3. XEM TRƯỚC (dưới thanh tag) -->
        <div class="mr-preview">
          <img v-if="local.kind === 'image' && (local.url || local.thumbnailUrl)" :src="local.url || local.thumbnailUrl || ''" alt="" />
          <video v-else-if="local.kind === 'video' && local.url" :src="local.url" controls preload="metadata" />
          <div v-else class="mr-ph">
            <component :is="kindIcon" :size="52" :stroke-width="1.4" />
            <span v-if="local.kind === 'file'" class="mr-ph-name">{{ local.name }}</span>
          </div>
        </div>
      </div>

      <footer class="mr-foot">
        <button class="mr-cancel" :disabled="sending" @click="$emit('close')">Hủy</button>
        <button class="mr-send" :disabled="sending" @click="doSend">
          <SendIcon :size="14" :stroke-width="2" /> {{ sending ? 'Đang gửi…' : 'Gửi' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { sendMediaToConversation, updateMedia, listMediaTags, type MediaAssetItem } from '@/api/media';
import { useToast } from '@/composables/use-toast';
import {
  Image as ImageIcon, FileText as FileIcon, Video as VideoIcon,
  Smartphone as NickIcon, Upload as UploadIcon, Tag as TagIcon,
  Send as SendIcon, X as XIcon,
} from 'lucide-vue-next';

const props = defineProps<{ asset: MediaAssetItem; conversationId: string }>();
const emit = defineEmits<{ close: []; sent: []; tagsChanged: [id: string, tagIds: string[]] }>();
const toast = useToast();

// Bản sao tag để sửa tại chỗ (lưu ngay lên server, đồng bộ ngược ra list qua tagsChanged).
const local = computed(() => props.asset);
const tagIds = ref<string[]>([...(props.asset.tagIds ?? [])]);
// Resync tag nếu đổi asset (hardening — hiện cha dùng v-if remount nên không xảy ra, nhưng
// nếu sau này swap :asset không unmount thì chip tag không bị kẹt của asset cũ).
watch(() => props.asset.id, () => { tagIds.value = [...(props.asset.tagIds ?? [])]; });
const newTag = ref('');
const savingTag = ref(false);
const sending = ref(false);
const allTags = ref<string[]>([]); // autocomplete: tag kho đã dùng

const kindIcon = computed(() => local.value.kind === 'video' ? VideoIcon : local.value.kind === 'file' ? FileIcon : ImageIcon);
const isFromChatNick = computed(() => local.value.source === 'saved_from_chat' && !!local.value.sourceNickName);
const sourceIcon = computed(() => isFromChatNick.value ? NickIcon : UploadIcon);
const sourceText = computed(() => {
  const sale = local.value.ownerName ? ` · ${local.value.ownerName}` : '';
  if (isFromChatNick.value) return `${local.value.sourceNickName}${sale}`;
  if (local.value.source === 'saved_from_chat') return `Lưu từ chat${sale}`;
  return `Tải lên thủ công${sale}`;
});
const sizeText = computed(() => {
  const b = local.value.sizeBytes ?? 0;
  if (!b) return '—';
  return b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
});
const dimText = computed(() => {
  const w = local.value.width; const h = local.value.height;
  return w && h ? `${w} × ${h} px` : '—';
});
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}

// LƯU NGAY: gắn/tháo tag → PATCH /media/:id set tagIds mới (chuẩn hóa lowercase ở BE).
async function saveTags(next: string[]) {
  const prev = tagIds.value;
  tagIds.value = next; // optimistic
  savingTag.value = true;
  try {
    const res = await updateMedia(props.asset.id, { tagIds: next });
    tagIds.value = res.asset.tagIds; // dùng bản BE đã chuẩn hóa (lowercase/dedup)
    emit('tagsChanged', props.asset.id, tagIds.value);
  } catch (e: any) {
    tagIds.value = prev; // revert nếu lỗi
    toast.warning(e?.response?.data?.error || 'Không lưu được tag');
  } finally {
    savingTag.value = false;
  }
}
function addTagValue(raw: string) {
  const t = raw.trim().toLowerCase();
  newTag.value = '';
  acIndex.value = 0;
  if (!t || tagIds.value.includes(t)) return;
  saveTags([...tagIds.value, t]);
}
function removeTag(tag: string) {
  saveTags(tagIds.value.filter((t) => t !== tag));
}

// ── Autocomplete tag tự dựng (Anh chốt 2026-06-15) ──────────────────────────
// Gợi ý = tag kho (allTags) khớp tiền tố chuỗi đang gõ, bỏ tag ảnh đã có, tối đa 6.
// Tab = điền nốt gợi ý đầu vào ô (chưa thêm). Enter = thêm tag (đang gõ hoặc gợi ý chọn).
// ↑↓ = di chuyển. Esc = đóng gợi ý. Click = thêm. Gõ-trùng-y-hệt-1-gợi-ý vẫn ẩn dropdown.
const acIndex = ref(0);
// Đang focus ô nhập? → để hiện sẵn tag kho lúc ô CÒN RỖNG (anh chốt 2026-06-16: trước
// đây gợi ý chỉ bung khi gõ chữ → mở dialog tưởng "không có tag có sẵn để chọn").
const focused = ref(false);
const suggestions = computed<string[]>(() => {
  const q = newTag.value.trim().toLowerCase();
  const picked = new Set(tagIds.value);
  const pool = allTags.value.filter((t) => !picked.has(t));
  // Ô rỗng + đang focus → hiện tag kho có sẵn để CHỌN NHANH (cap 8 cho gọn).
  if (!q) return focused.value ? pool.slice(0, 8) : [];
  const hits = pool.filter((t) => t.startsWith(q));
  // gõ đúng y hệt 1 tag duy nhất → khỏi gợi ý (không lặp lại cái đã gõ).
  if (hits.length === 1 && hits[0] === q) return [];
  return hits.slice(0, 6);
});
function pickSuggestion(s: string) { addTagValue(s); }
// Rời ô → tắt focus (ẩn dropdown). Click 1 gợi ý dùng mousedown.prevent nên KHÔNG blur →
// thêm xong vẫn giữ focus, dropdown hiện tiếp tag còn lại (gắn nhiều tag nhanh).
function onTagBlur() { focused.value = false; }
function onTagKeydown(e: KeyboardEvent) {
  const list = suggestions.value;
  if (e.key === 'Tab') {
    // Tab = ĐIỀN NỐT gợi ý đang chọn vào ô (chưa thêm, gõ tiếp được). Chỉ chặn khi có gợi ý.
    if (list.length) { e.preventDefault(); newTag.value = list[acIndex.value] ?? list[0]; acIndex.value = 0; }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    // Có gợi ý đang trỏ → thêm gợi ý đó; không thì thêm đúng chuỗi đang gõ.
    addTagValue(list.length ? (list[acIndex.value] ?? newTag.value) : newTag.value);
    return;
  }
  if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); acIndex.value = (acIndex.value + 1) % list.length; return; }
  if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); acIndex.value = (acIndex.value - 1 + list.length) % list.length; return; }
  if (e.key === 'Escape' && list.length) { e.preventDefault(); newTag.value = ''; }
}

async function doSend() {
  if (sending.value) return;
  sending.value = true;
  try {
    // Tag đã lưu sẵn ở trên (không cần addTags lúc gửi nữa) → chỉ gửi.
    await sendMediaToConversation(props.asset.id, props.conversationId);
    toast.success(`Đã gửi "${local.value.name}"`);
    emit('sent');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi thất bại');
  } finally {
    sending.value = false;
  }
}

onMounted(async () => {
  try { allTags.value = (await listMediaTags(100)).map((t) => t.tag); } catch { /* autocomplete phụ */ }
});
</script>

<style scoped>
.mr-overlay { position: fixed; inset: 0; z-index: 140; background: rgba(15,23,42,.42); display: flex; align-items: center; justify-content: center; }
.mr-box {
  /* Theme Atlas v2 chuẩn (khớp MediaTabPanel/màn chat HS Holding). */
  --ink:#141a24; --body:#475066; --muted:#8b93a7; --hairline:#e7eaf0; --canvas:#fff;
  --soft:#f1f4f9; --action:#1786be; --action-soft:#e4f1f8; --coral:#aa2d00;
  width: 460px; max-width: 94vw; max-height: 88vh; background: var(--canvas); border-radius: 12px;
  box-shadow: 0 18px 56px rgba(15,23,42,.28); display: flex; flex-direction: column; overflow: hidden;
}
.mr-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--hairline); }
.mr-ttl { font-size: 14px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mr-x { border: none; background: none; cursor: pointer; color: var(--muted); display: inline-flex; flex-shrink: 0; }
.mr-body { padding: 16px; overflow: auto; flex: 1; min-height: 0; }
.mr-preview { background: var(--soft); border: 1px solid var(--hairline); border-radius: 10px; height: 220px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-top: 14px; }
.mr-preview img, .mr-preview video { max-width: 100%; max-height: 100%; object-fit: contain; }
.mr-ph { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--muted); }
.mr-ph-name { font-size: 12px; max-width: 90%; text-align: center; word-break: break-word; }
.mr-dl { display: grid; grid-template-columns: 92px 1fr; gap: 5px 10px; margin: 0 0 14px; }
.mr-dl dt { font-size: 12px; color: var(--muted); }
.mr-dl dd { font-size: 12.5px; color: var(--ink); margin: 0; display: flex; align-items: center; gap: 5px; min-width: 0; }
.mr-ddic { color: var(--muted); flex-shrink: 0; }
.mr-tags { border-top: 1px solid var(--hairline); padding-top: 12px; }
.mr-tlabel { display: flex; align-items: center; gap: 5px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); font-weight: 600; margin-bottom: 8px; }
.mr-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 9px; min-height: 26px; align-items: center; }
.mr-chip { display: inline-flex; align-items: center; gap: 3px; background: #e4f1f8; border: 1px solid #bfddec; color: var(--action); border-radius: 9999px; padding: 3px 5px 3px 11px; font-size: 12px; }
.mr-chip-x { border: none; background: none; cursor: pointer; color: var(--action); display: inline-flex; padding: 1px; border-radius: 9999px; }
.mr-chip-x:hover { background: rgba(23,134,190,.18); }
.mr-empty { font-size: 11.5px; color: var(--muted); }
.mr-addrow { position: relative; display: flex; gap: 8px; }
.mr-input { flex: 1; border: 1px solid var(--hairline); border-radius: 7px; padding: 7px 10px; font-size: 12.5px; outline: none; color: var(--ink); }
.mr-input:focus { border-color: var(--action); }
/* Dropdown autocomplete (Atlas v2) — bung LÊN TRÊN ô nhập (bottom) để không bị preview đè.
   Nền bán trong suốt (mờ ~30%) + blur nhẹ → vẫn thấy ảnh/video/file phía dưới xuyên qua. */
.mr-ac { position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 20; margin: 0; padding: 4px; list-style: none;
  background: rgba(255,255,255,.72); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  border: 1px solid var(--hairline); border-radius: 8px; box-shadow: 0 -8px 24px rgba(15,23,42,.18); max-height: 188px; overflow: auto; }
.mr-ac-item { padding: 6px 10px; font-size: 12.5px; color: var(--body); border-radius: 6px; cursor: pointer; }
.mr-ac-item.on { background: var(--action-soft); color: var(--action); font-weight: 600; }
.mr-saving { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
.mr-foot { display: flex; gap: 8px; align-items: center; padding: 12px 16px; border-top: 1px solid var(--hairline); background: var(--soft); }
.mr-cancel { border: 1px solid var(--hairline); background: var(--canvas); color: var(--muted); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; min-height: 36px; }
/* Nút Gửi: màu hành động chuẩn HS (action #1786be) — nổi + đúng nhận diện theme. */
.mr-send { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: none; background: var(--action); color: #fff; border-radius: 8px; padding: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer; min-height: 36px; }
.mr-send:hover { background: #1370a0; }
.mr-send:disabled, .mr-cancel:disabled, .mr-chip-x:disabled { opacity: .55; cursor: default; }
</style>
