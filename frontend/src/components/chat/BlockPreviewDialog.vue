<!--
  BlockPreviewDialog — Phase 1 MVP 2026-06-04 (Mockup 4 approved)
  Hiển thị Khối render như KH thấy trên Zalo + nút "📤 Gửi cho KH" để xác nhận.
  Có nút "🔄 Random variant khác" + "← Quay lại chọn Khối" + "✏️ Sửa Khối".
-->
<template>
  <v-dialog
    :model-value="visible"
    max-width="780"
    @update:model-value="(v) => { if (!v) emit('close'); }"
  >
    <div class="bpd-card">
      <!-- Header -->
      <header class="bpd-head">
        <span class="bpd-icon">{{ blockIcon }}</span>
        <div class="bpd-head-info">
          <div class="bpd-title">{{ block.name }}</div>
          <div class="bpd-meta">
            <span v-if="block.folder?.visibility === 'private'" class="bpd-vis private"><LockIcon :size="12" :stroke-width="2" /> Riêng tư</span>
            <span v-else class="bpd-vis public"><UnlockIcon :size="12" :stroke-width="2" /> Công khai</span>
            <span v-if="block.folder" class="bpd-meta-seg"> · <FolderIcon :size="12" :stroke-width="2" /> {{ block.folder.name }}</span>
            <span class="bpd-meta-seg"> · <PackageIcon :size="12" :stroke-width="2" /> {{ componentsCount }} thành phần</span>
            <span v-if="variantCount > 0" class="bpd-meta-seg"> · <ShuffleIcon :size="12" :stroke-width="2" /> {{ variantCount }} mẫu</span>
            <span v-if="randomBadge" class="bpd-random-chip"><DicesIcon :size="12" :stroke-width="2" /> {{ randomBadge }}</span>
          </div>
        </div>
        <button v-if="hasTextVariants" class="bpd-random-btn" @click="rerollPreview"><RefreshCwIcon :size="14" :stroke-width="2" /> Random variant khác</button>
        <button class="bpd-close" @click="emit('close')"><XIcon :size="18" :stroke-width="2" /></button>
      </header>

      <!-- Body: Zalo preview -->
      <div class="bpd-body">
        <div class="bpd-time-label"><SmartphoneIcon :size="13" :stroke-width="2" /> KH sẽ thấy thế này trên Zalo · {{ contactName }} · {{ currentHHmm }}</div>

        <div class="bpd-zalo-window">
          <template v-if="block.actionType === 'send_message'">
            <template v-for="(c, idx) in renderedComponents" :key="idx">
              <!-- eslint-disable-next-line vue/no-v-html — render Zalo rich-text (đậm/nghiêng), text từ Khối nội bộ -->
              <div v-if="c.kind === 'text'" class="bpd-bubble out" v-html="textHtml(c)"></div>
              <div v-else-if="c.kind === 'image'" class="bpd-image-card">
                <div class="bpd-image-thumb"></div>
                <div v-if="c.caption" class="bpd-image-caption">{{ c.caption }}</div>
              </div>
              <div v-else-if="c.kind === 'album'" class="bpd-album">
                <div v-for="(_item, i) in c.items.slice(0, 4)" :key="i" class="bpd-album-item"></div>
                <div v-if="c.items.length > 4" class="bpd-album-more">+{{ c.items.length - 4 }}</div>
              </div>
              <div v-else-if="c.kind === 'file'" class="bpd-file">
                <span class="bpd-file-icon">📕</span>
                <div class="bpd-file-info">
                  <div class="bpd-file-name">{{ c.filename || 'file.pdf' }}</div>
                  <div class="bpd-file-meta">{{ c.sizeBytes ? formatSize(c.sizeBytes) : '' }}</div>
                </div>
              </div>
              <div v-else-if="c.kind === 'video'" class="bpd-video">
                🎬 Video
              </div>
              <div class="bpd-time">
                {{ currentHHmm }} ·
                <span class="bpd-tin-label">Tin {{ idx + 1 }}/{{ renderedComponents.length }}</span>
              </div>
            </template>
            <div v-if="renderedComponents.length === 0" class="bpd-empty">
              Khối này chưa có thành phần nào
            </div>
          </template>

          <template v-else-if="block.actionType === 'request_friend'">
            <div class="bpd-bubble out">{{ renderedGreeting }}</div>
            <div class="bpd-time">{{ currentHHmm }} · Lời mời kết bạn</div>
          </template>
        </div>

        <div class="bpd-info">
          <TimerIcon :size="13" :stroke-width="2" /> Tổng thời gian gửi: ~{{ estimatedSeconds }} giây · KH thấy {{ renderedComponents.length || 1 }} tin liên tiếp như đang chat thật
        </div>
      </div>

      <!-- Footer -->
      <footer class="bpd-foot">
        <!-- previewOnly: dùng trong builder Luồng → chỉ xem trước, không gửi -->
        <div v-if="previewOnly" class="bpd-recipient">
          <div class="bpd-recipient-avatar"><EyeIcon :size="18" :stroke-width="2" /></div>
          <div class="bpd-recipient-info">
            <div class="bpd-recipient-label">Xem trước khối</div>
            <div class="bpd-recipient-nick">KH mẫu thấy như thế này trên Zalo</div>
          </div>
        </div>
        <div v-else class="bpd-recipient">
          <div class="bpd-recipient-avatar">{{ contactName.charAt(0).toUpperCase() }}</div>
          <div class="bpd-recipient-info">
            <div class="bpd-recipient-label">Gửi tới <b>{{ contactName }}</b></div>
            <div class="bpd-recipient-nick">Qua nick <b>{{ nickName }}</b></div>
          </div>
        </div>
        <button class="bpd-btn" @click="emit('close')">
          <ArrowLeftIcon v-if="!previewOnly" :size="14" :stroke-width="2" />{{ previewOnly ? 'Đóng' : ' Quay lại chọn Khối' }}
        </button>
        <button v-if="!previewOnly" class="bpd-btn-primary" @click="onConfirmSend"><SendIcon :size="14" :stroke-width="2" /> Gửi cho KH</button>
      </footer>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Block } from '@/api/automation/types';
import { applyRichFormat, plainFormat, type StyleMark } from '@/composables/use-rich-format';
// Icon chrome — Lucide line (anh chốt 2026-06-08, bỏ emoji nút).
import {
  RefreshCw as RefreshCwIcon,
  X as XIcon,
  ArrowLeft as ArrowLeftIcon,
  Send as SendIcon,
  Lock as LockIcon,
  Unlock as UnlockIcon,
  Folder as FolderIcon,
  Package as PackageIcon,
  Shuffle as ShuffleIcon,
  Dices as DicesIcon,
  Smartphone as SmartphoneIcon,
  Eye as EyeIcon,
  Timer as TimerIcon,
} from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    block: Block;
    contactName: string;
    nickName: string;
    // 2026-06-07 — builder Luồng dùng chế độ chỉ-xem-trước: ẩn nút "Gửi cho KH",
    // đổi footer thành "KH mẫu". Mặc định false → giữ nguyên hành vi ở chat.
    previewOnly?: boolean;
  }>(),
  { previewOnly: false },
);

const emit = defineEmits<{
  send: [blockId: string];
  close: [];
}>();

const rerollKey = ref(0);

interface RenderedTextComponent { kind: 'text'; text: string; styles?: StyleMark[] }
interface RenderedImage { kind: 'image'; url: string; caption?: string }
interface RenderedAlbum { kind: 'album'; items: Array<{ url: string }> }
interface RenderedFile { kind: 'file'; filename?: string; url: string; sizeBytes?: number }
interface RenderedVideo { kind: 'video'; url: string }
type RenderedComponent = RenderedTextComponent | RenderedImage | RenderedAlbum | RenderedFile | RenderedVideo;

const blockIcon = computed(() => {
  if (props.block.actionType === 'request_friend') return '🤝';
  return '📨';
});

// Render text component → HTML (đậm/nghiêng/gạch theo styles Zalo). Có styles thì
// applyRichFormat, không thì plainFormat (escape + linebreak). Fix preview HTML 2026-06-07.
function textHtml(c: RenderedTextComponent): string {
  return c.styles && c.styles.length > 0 ? applyRichFormat(c.text, c.styles, []) : plainFormat(c.text);
}

const currentHHmm = computed(() => {
  const d = new Date();
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
});

const componentsCount = computed(() => {
  const c = props.block.content as any;
  if (Array.isArray(c?.components)) return c.components.length;
  if (Array.isArray(c?.textVariants)) return 1 + (Array.isArray(c?.attachments) ? c.attachments.length : 0);
  return 1;
});

const variantCount = computed(() => {
  const c = props.block.content as any;
  if (Array.isArray(c?.greetingVariants)) return c.greetingVariants.length;
  if (Array.isArray(c?.textVariants)) return c.textVariants.length;
  if (Array.isArray(c?.components)) {
    let n = 0;
    for (const cmp of c.components) {
      if (cmp?.kind === 'text') n += (Array.isArray(cmp.variants) ? cmp.variants.length : 0) + 1;
    }
    return n;
  }
  return 0;
});

const hasTextVariants = computed(() => variantCount.value > 1);

// Random pick variant logic — re-rendered when rerollKey changes
const renderedComponents = computed((): RenderedComponent[] => {
  void rerollKey.value; // dependency trigger
  const c = props.block.content as any;
  const out: RenderedComponent[] = [];

  if (Array.isArray(c?.components)) {
    for (const cmp of c.components) {
      if (cmp.kind === 'text') {
        const def = cmp.defaultVariant;
        const variants = Array.isArray(cmp.variants) ? cmp.variants : [];
        const pool = [def, ...variants].filter((v: any) => v && typeof v.text === 'string' && v.text.length > 0);
        if (pool.length === 0) continue;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        out.push({ kind: 'text', text: pick.text, styles: Array.isArray(pick.styles) ? pick.styles : [] });
      } else if (cmp.kind === 'image') {
        out.push({ kind: 'image', url: cmp.url, caption: cmp.caption });
      } else if (cmp.kind === 'album') {
        out.push({ kind: 'album', items: cmp.items || [] });
      } else if (cmp.kind === 'file') {
        out.push({ kind: 'file', filename: cmp.filename, url: cmp.url, sizeBytes: cmp.sizeBytes });
      } else if (cmp.kind === 'video') {
        out.push({ kind: 'video', url: cmp.url });
      }
    }
    return out;
  }
  // Legacy {textVariants, attachments}
  if (Array.isArray(c?.textVariants) && c.textVariants.length > 0) {
    const pick = c.textVariants[Math.floor(Math.random() * c.textVariants.length)];
    if (typeof pick === 'string' && pick.trim()) out.push({ kind: 'text', text: pick });
  }
  if (Array.isArray(c?.attachments)) {
    for (const a of c.attachments) {
      if (a.kind === 'image') out.push({ kind: 'image', url: a.url, caption: a.caption });
      else if (a.kind === 'file') out.push({ kind: 'file', filename: a.url?.split('/').pop(), url: a.url });
      else if (a.kind === 'video') out.push({ kind: 'video', url: a.url });
    }
  }
  return out;
});

const renderedGreeting = computed((): string => {
  void rerollKey.value;
  const c = props.block.content as any;
  const arr = Array.isArray(c?.greetingVariants) ? c.greetingVariants : [];
  if (arr.length === 0) return '(Lời chào trống)';
  return arr[Math.floor(Math.random() * arr.length)];
});

const randomBadge = computed(() => {
  if (variantCount.value <= 1) return '';
  // Em báo chung "variant random khi gửi" thay vì index cụ thể vì có thể nhiều text component
  return `${variantCount.value} biến thể, random khi gửi`;
});

const estimatedSeconds = computed(() => {
  const count = renderedComponents.value.length || 1;
  return Math.max(1, count * 2); // ~2s/component
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function rerollPreview() {
  rerollKey.value++;
}

function onConfirmSend() {
  emit('send', props.block.id);
}
</script>

<style scoped>
.bpd-card {
  background: #fff;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 88vh;
}

.bpd-head {
  padding: 14px 20px;
  border-bottom: 1px solid #e6e8eb;
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fafbfc;
}
.bpd-icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: rgba(59,130,246,0.12);
  color: #1d4ed8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
}
.bpd-head-info { flex: 1; min-width: 0; }
.bpd-title { font-size: 15px; font-weight: 700; color: #1f2328; }
.bpd-meta {
  font-size: 11.5px;
  color: #6b7280;
  margin-top: 3px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.bpd-vis.public { color: #10b981; font-weight: 600; }
.bpd-vis.private { color: #f59e0b; font-weight: 600; }
.bpd-random-chip {
  color: #92400e;
  background: #fef3c7;
  padding: 2px 8px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 10.5px;
}
.bpd-random-btn {
  padding: 6px 12px;
  border: 1px solid #d4d7dc;
  border-radius: 7px;
  background: #fff;
  color: #1f2328;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.bpd-random-btn:hover { background: #f4f5f7; }
.bpd-close {
  width: 30px;
  height: 30px;
  background: transparent;
  border: 0;
  cursor: pointer;
  border-radius: 6px;
  color: #6b7280;
  font-size: 16px;
}
.bpd-close:hover { background: #f4f5f7; color: #1f2328; }

.bpd-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
  background: linear-gradient(180deg, #e3f2fd 0%, #bbdefb 100%);
}
.bpd-time-label {
  font-size: 11.5px;
  color: #475569;
  text-align: center;
  padding: 6px 0;
  font-weight: 500;
}
.bpd-zalo-window {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.bpd-bubble {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.bpd-bubble.out {
  background: #fff;
  color: #1f2328;
  border: 1px solid #e3e6ea;
  align-self: flex-end;
  border-bottom-right-radius: 5px;
}

.bpd-image-card {
  align-self: flex-end;
  border-radius: 14px;
  overflow: hidden;
  border-bottom-right-radius: 5px;
  max-width: 280px;
}
.bpd-image-thumb {
  width: 280px;
  height: 180px;
  background: linear-gradient(135deg, #a7f3d0, #10b981);
}
.bpd-image-caption {
  padding: 7px 11px;
  background: #fff;
  font-size: 12px;
}

.bpd-album {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
  width: 280px;
  border-radius: 14px;
  overflow: hidden;
  align-self: flex-end;
  border-bottom-right-radius: 5px;
  position: relative;
}
.bpd-album-item {
  aspect-ratio: 1;
  background: linear-gradient(135deg, #fde68a, #f59e0b);
}
.bpd-album-item:nth-child(2) { background: linear-gradient(135deg, #a7f3d0, #10b981); }
.bpd-album-item:nth-child(3) { background: linear-gradient(135deg, #bfdbfe, #3b82f6); }
.bpd-album-item:nth-child(4) { background: linear-gradient(135deg, #fbcfe8, #ec4899); }
.bpd-album-more {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 50%;
  height: 50%;
  background: rgba(0,0,0,0.5);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}

.bpd-file {
  align-self: flex-end;
  background: #fff;
  border-radius: 12px;
  padding: 11px 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  max-width: 280px;
  border-bottom-right-radius: 5px;
}
.bpd-file-icon { font-size: 24px; }
.bpd-file-info { flex: 1; min-width: 0; }
.bpd-file-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #1f2328;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bpd-file-meta { font-size: 10.5px; color: #9ca3af; margin-top: 1px; }

.bpd-video {
  align-self: flex-end;
  background: #1f2328;
  color: #fff;
  border-radius: 12px;
  padding: 36px 60px;
  font-size: 13px;
  border-bottom-right-radius: 5px;
}

.bpd-time {
  font-size: 10.5px;
  color: #475569;
  align-self: flex-end;
  padding: 0 6px;
  margin-top: -3px;
}
.bpd-tin-label {
  background: rgba(255,255,255,0.6);
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
}

.bpd-empty {
  align-self: center;
  font-size: 12px;
  color: #475569;
  font-style: italic;
  background: rgba(255,255,255,0.6);
  padding: 20px;
  border-radius: 10px;
}

.bpd-info {
  text-align: center;
  font-size: 11px;
  color: #1e3a8a;
  background: rgba(255,255,255,0.7);
  padding: 8px 14px;
  border-radius: 10px;
  margin-top: 14px;
  font-weight: 500;
}

.bpd-foot {
  padding: 14px 20px;
  background: #fff;
  border-top: 1px solid #e6e8eb;
  display: flex;
  align-items: center;
  gap: 12px;
}
.bpd-recipient {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}
.bpd-recipient-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 12px;
}
.bpd-recipient-info { flex: 1; min-width: 0; }
.bpd-recipient-label { font-size: 12.5px; color: #1f2328; }
.bpd-recipient-nick { font-size: 10.5px; color: #9ca3af; margin-top: 1px; }
.bpd-btn {
  padding: 9px 14px;
  border: 1px solid #d4d7dc;
  border-radius: 7px;
  background: #fff;
  color: #1f2328;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.bpd-btn:hover { background: #f4f5f7; }
.bpd-btn-primary {
  padding: 10px 20px;
  border: 0;
  border-radius: 7px;
  background: #3b82f6;
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.bpd-btn-primary:hover { background: #1d4ed8; }

/* Icon Lucide chrome — căn giữa với text (2026-06-08). */
.bpd-btn, .bpd-btn-primary, .bpd-random-btn, .bpd-close,
.bpd-vis, .bpd-meta-seg, .bpd-random-chip, .bpd-time-label, .bpd-info,
.bpd-recipient-avatar { display: inline-flex; align-items: center; gap: 4px; }
.bpd-time-label, .bpd-info { gap: 5px; }
.bpd-recipient-avatar { justify-content: center; }
.bpd-icon svg, .bpd-close svg, .bpd-random-btn svg, .bpd-btn svg, .bpd-btn-primary svg,
.bpd-vis svg, .bpd-meta-seg svg, .bpd-random-chip svg, .bpd-time-label svg,
.bpd-info svg, .bpd-recipient-avatar svg { display: block; }
</style>
