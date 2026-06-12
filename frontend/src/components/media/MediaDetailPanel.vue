<template>
  <aside class="m-panel">
    <header class="p-head">
      <b>Chi tiết</b>
      <button class="x" @click="$emit('close')">✕</button>
    </header>
    <div class="p-body">
      <div class="preview">
        <img v-if="asset.thumbnailUrl" :src="wmUrl || asset.thumbnailUrl" alt="" />
        <span v-else class="ph">{{ asset.kind === 'video' ? '🎬' : asset.kind === 'file' ? '📄' : '🖼' }}</span>
      </div>

      <div class="fld">
        <label>Tên</label>
        <input v-model="name" class="ipt" @blur="saveName" />
      </div>

      <div class="fld">
        <label>Quyền xem</label>
        <div class="seg">
          <span :class="{ on: visibility === 'public' }" @click="setVis('public')">Công khai</span>
          <span :class="{ on: visibility === 'private' }" @click="setVis('private')">Riêng tư</span>
        </div>
        <div v-if="fromPrivateNick" class="warn">
          🔒 Ảnh lưu từ nick Riêng tư — có thể chứa thông tin khách. Cần xác nhận khi chia sẻ Công khai.
        </div>
      </div>

      <!-- Watermark: toggle BẬT/TẮT + chọn góc + độ mờ (G1 + GĐ2) -->
      <div v-if="asset.kind === 'image'" class="fld">
        <label>Đóng dấu logo HS (Watermark)</label>
        <label class="wm-toggle">
          <input type="checkbox" :checked="wmEnabled" :disabled="wmLoading" @change="onToggleWatermark" />
          <span>{{ wmEnabled ? 'Đang BẬT — gửi kèm logo' : 'Đang TẮT — gửi ảnh gốc' }}</span>
        </label>

        <div v-if="wmEnabled" class="wm-opts">
          <div class="wm-line">
            <span class="wm-lbl">Vị trí</span>
            <select v-model="wmPosition" class="wm-sel" :disabled="wmLoading" @change="regenWatermark">
              <option value="bottom-right">Góc dưới phải</option>
              <option value="bottom-left">Góc dưới trái</option>
              <option value="top-right">Góc trên phải</option>
              <option value="top-left">Góc trên trái</option>
              <option value="center">Giữa ảnh</option>
            </select>
          </div>
          <div class="wm-line">
            <span class="wm-lbl">Độ mờ</span>
            <input
              v-model.number="wmOpacity" type="range" min="0.1" max="1" step="0.05"
              class="wm-range" :disabled="wmLoading" @change="regenWatermark"
            />
            <span class="wm-val">{{ Math.round(wmOpacity * 100) }}%</span>
          </div>
          <div v-if="wmLoading" class="hint">Đang tạo bản có logo…</div>
        </div>
        <div class="hint">Bản gốc luôn được giữ. Watermark là phiên bản riêng để gửi khách.</div>
      </div>

      <div class="fld">
        <label>Tag dự án</label>
        <div class="tags">
          <span v-for="t in tagIds" :key="t" class="tg coral">{{ t }} <i @click="removeTag(t)">✕</i></span>
          <input v-model="newTag" class="tg-input" placeholder="+ tag" @keyup.enter="addTag" />
        </div>
      </div>

      <div class="fld stat">
        <label>Thống kê</label>
        <div>Đã dùng <b>{{ asset.usageCount }}</b> lần · {{ sizeText }}</div>
      </div>
    </div>
    <footer class="p-foot">
      <button class="btn-insert" @click="openInsert">↗ Chèn vào chat</button>
      <button class="btn-fav" :class="{ on: isFav }" @click="doFavorite">{{ isFav ? '★' : '☆' }}</button>
      <button class="btn-danger" @click="doArchive">🗑</button>
    </footer>

    <!-- Picker hội thoại để "Chèn vào chat" (G1) -->
    <MediaSendPicker
      v-if="showInsert"
      :asset-id="asset.id"
      :asset-name="asset.name"
      :watermark-url="wmEnabled ? wmUrl : null"
      @close="showInsert = false"
      @sent="onInserted"
    />

    <!-- D11: xác nhận chia sẻ ảnh từ nick Riêng tư ra Công khai -->
    <ConfirmShareDialog
      v-if="showShareConfirm"
      @cancel="cancelShare"
      @confirm="confirmShare"
    />
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { updateMedia, archiveMedia, watermarkMedia, removeWatermark, toggleFavorite, type MediaAssetItem, type MediaFolder } from '@/api/media';
import { useToast } from '@/composables/use-toast';
import MediaSendPicker from '@/components/media/MediaSendPicker.vue';
import ConfirmShareDialog from '@/components/media/ConfirmShareDialog.vue';

const props = defineProps<{ asset: MediaAssetItem; folders: MediaFolder[] }>();
const emit = defineEmits<{ close: []; updated: [patch: Partial<MediaAssetItem>]; archived: [id: string] }>();
const toast = useToast();

const name = ref(props.asset.name);
const visibility = ref(props.asset.visibility);
const tagIds = ref<string[]>([...props.asset.tagIds]);
const newTag = ref('');
const isFav = ref(false);
const showInsert = ref(false);
const showShareConfirm = ref(false);

// Watermark state (per-ảnh, lưu bền ở backend).
const wmEnabled = ref(props.asset.watermarkEnabled ?? false);
const wmPosition = ref(props.asset.watermarkPosition ?? 'bottom-right');
const wmOpacity = ref(props.asset.watermarkOpacity ?? 0.65);
const wmUrl = ref<string | null>(props.asset.watermarkUrl ?? null);
const wmLoading = ref(false);

// Ảnh lưu từ nick Riêng tư (backend trả sourceFromPrivateNick) → cần xác nhận khi public.
const fromPrivateNick = computed(() => props.asset.sourceFromPrivateNick ?? false);

// Reset khi đổi asset chọn.
watch(() => props.asset.id, () => {
  name.value = props.asset.name;
  visibility.value = props.asset.visibility;
  tagIds.value = [...props.asset.tagIds];
  isFav.value = props.asset.favorited ?? false;
  wmEnabled.value = props.asset.watermarkEnabled ?? false;
  wmPosition.value = props.asset.watermarkPosition ?? 'bottom-right';
  wmOpacity.value = props.asset.watermarkOpacity ?? 0.65;
  wmUrl.value = props.asset.watermarkUrl ?? null;
  showInsert.value = false;
  showShareConfirm.value = false;
});

async function doFavorite() {
  try {
    const r = await toggleFavorite(props.asset.id);
    isFav.value = r.favorited;
    toast.success(r.favorited ? 'Đã thêm vào Yêu thích' : 'Đã bỏ khỏi Yêu thích');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không lưu được');
  }
}

const sizeText = computed(() => {
  const b = props.asset.sizeBytes ?? 0;
  return b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
});

async function patch(p: any, okMsg?: string) {
  try {
    await updateMedia(props.asset.id, p);
    emit('updated', p);
    if (okMsg) toast.success(okMsg);
  } catch (e: any) {
    // Fail-safe: backend yêu cầu xác nhận (FE flag có thể cũ) → mở dialog xác nhận.
    if (e?.response?.data?.code === 'NEED_SHARE_CONFIRM') {
      visibility.value = 'private';
      showShareConfirm.value = true;
      return;
    }
    toast.warning(e?.response?.data?.error || 'Không lưu được');
  }
}
function saveName() { if (name.value !== props.asset.name) patch({ name: name.value }); }

// D11: chuyển sang Công khai. Nếu ảnh từ nick Riêng tư → hỏi xác nhận trước.
function setVis(v: 'public' | 'private') {
  if (v === visibility.value) return;
  if (v === 'public' && fromPrivateNick.value) {
    showShareConfirm.value = true; // chờ xác nhận, chưa đổi
    return;
  }
  visibility.value = v;
  patch({ visibility: v });
}
function cancelShare() {
  showShareConfirm.value = false;
  visibility.value = 'private'; // giữ nguyên riêng tư
}
function confirmShare() {
  showShareConfirm.value = false;
  visibility.value = 'public';
  // confirmShare=true: báo backend đã xác nhận, cho phép public ảnh nick Riêng tư.
  patch({ visibility: 'public', confirmShare: true }, 'Đã chia sẻ Công khai');
}

function addTag() {
  const t = newTag.value.trim();
  if (t && !tagIds.value.includes(t)) { tagIds.value.push(t); patch({ tagIds: tagIds.value }); }
  newTag.value = '';
}
function removeTag(t: string) { tagIds.value = tagIds.value.filter((x) => x !== t); patch({ tagIds: tagIds.value }); }

// ── Watermark toggle ───────────────────────────────────────────────────────
async function onToggleWatermark(e: Event) {
  const on = (e.target as HTMLInputElement).checked;
  if (on) {
    wmEnabled.value = true;
    await regenWatermark();
  } else {
    wmLoading.value = true;
    try {
      await removeWatermark(props.asset.id);
      wmEnabled.value = false;
      wmUrl.value = null;
      emit('updated', { watermarkEnabled: false } as any);
      toast.success('Đã TẮT đóng dấu — sẽ gửi ảnh gốc');
    } catch (err: any) {
      wmEnabled.value = true; // revert
      toast.warning(err?.response?.data?.error || 'Không tắt được watermark');
    } finally {
      wmLoading.value = false;
    }
  }
}

async function regenWatermark() {
  if (!wmEnabled.value) return;
  wmLoading.value = true;
  try {
    const res = await watermarkMedia(props.asset.id, { position: wmPosition.value, opacity: wmOpacity.value });
    wmUrl.value = res.url;
    emit('updated', {
      watermarkEnabled: true, watermarkPosition: wmPosition.value,
      watermarkOpacity: wmOpacity.value, watermarkUrl: res.url,
    } as any);
    toast.success('Đã cập nhật bản có logo HS');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tạo được watermark');
  } finally {
    wmLoading.value = false;
  }
}

// ── Chèn vào chat ──────────────────────────────────────────────────────────
function openInsert() { showInsert.value = true; }
function onInserted() {
  showInsert.value = false;
  toast.success('Đã gửi vào hội thoại');
}

async function doArchive() {
  if (!window.confirm(`Xóa "${props.asset.name}" khỏi kho? (Lịch sử chat đã gửi không bị ảnh hưởng)`)) return;
  try {
    await archiveMedia(props.asset.id);
    emit('archived', props.asset.id);
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không xóa được');
  }
}
</script>

<style scoped>
.m-panel {
  --ink:#181d26; --body:#333840; --muted:#41454d; --hairline:#dddddd;
  --canvas:#fff; --soft:#f8fafc; --strong:#e0e2e6; --coral:#aa2d00;
  --r-sm:6px; --r-md:10px; --pill:9999px;
  width:380px; border-left:1px solid var(--hairline); flex-shrink:0; background:var(--soft);
  display:flex; flex-direction:column; min-height:0; position:relative;
}
.p-head { padding:14px 18px; border-bottom:1px solid var(--hairline); display:flex; align-items:center; justify-content:space-between; background:var(--canvas); color:var(--ink); }
.p-head .x { border:none; background:none; cursor:pointer; color:var(--muted); font-size:15px; }
.p-body { padding:18px; overflow:auto; flex:1; }
.preview { height:200px; background:var(--strong); border-radius:var(--r-md); display:flex; align-items:center; justify-content:center; margin-bottom:16px; overflow:hidden; }
.preview img { width:100%; height:100%; object-fit:contain; }
.preview .ph { font-size:48px; color:var(--muted); }
.fld { margin-bottom:16px; }
.fld label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:6px; font-weight:500; }
.ipt { width:100%; border:1px solid var(--hairline); border-radius:var(--r-sm); padding:7px 10px; font-size:14px; color:var(--ink); outline:none; }
.seg { display:inline-flex; border:1px solid var(--hairline); border-radius:var(--pill); overflow:hidden; font-size:12.5px; background:var(--canvas); }
.seg span { padding:6px 16px; cursor:pointer; color:var(--muted); }
.seg span.on { background:var(--ink); color:#fff; }
.warn { background:#f5e9d4; border:1px solid #e6d3ad; color:#6b5520; border-radius:var(--r-sm); padding:8px 11px; font-size:12px; margin-top:8px; }
.wm-toggle { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--body); cursor:pointer; }
.wm-toggle input { accent-color:var(--ink); cursor:pointer; }
.wm-opts { margin-top:10px; padding:10px 12px; background:var(--canvas); border:1px solid var(--hairline); border-radius:var(--r-sm); }
.wm-line { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.wm-line:last-child { margin-bottom:0; }
.wm-lbl { font-size:12px; color:var(--muted); width:54px; flex-shrink:0; }
.wm-sel { flex:1; border:1px solid var(--hairline); border-radius:var(--r-sm); padding:5px 8px; font-size:12.5px; color:var(--ink); background:var(--canvas); outline:none; }
.wm-range { flex:1; accent-color:var(--ink); }
.wm-val { font-size:12px; color:var(--ink); width:38px; text-align:right; }
.hint { font-size:11.5px; color:var(--muted); margin-top:5px; }
.tags { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.tg { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--hairline); border-radius:var(--pill); padding:3px 10px; font-size:11.5px; color:var(--muted); }
.tg.coral { background:#fbe9e2; border-color:#f0c4b3; color:var(--coral); }
.tg i { cursor:pointer; font-style:normal; }
.tg-input { border:1px dashed var(--hairline); border-radius:var(--pill); padding:3px 10px; font-size:11.5px; width:70px; outline:none; }
.stat div { font-size:13.5px; color:var(--ink); }
.p-foot { padding:14px 18px; border-top:1px solid var(--hairline); background:var(--canvas); display:flex; gap:8px; align-items:center; }
.btn-insert { flex:1; border:none; background:var(--ink); color:#fff; border-radius:var(--r-md); padding:9px; font-size:13px; font-weight:500; cursor:pointer; }
.btn-fav { border:1px solid var(--hairline); background:var(--canvas); color:var(--body); border-radius:var(--r-md); padding:9px 13px; font-size:15px; cursor:pointer; }
.btn-fav.on { background:#fef3c7; border-color:#f4d35e; color:#92710a; }
.btn-danger { border:1px solid #f0c4b3; background:#fbe9e2; color:var(--coral); border-radius:var(--r-md); padding:9px 13px; font-size:14px; cursor:pointer; }
</style>
