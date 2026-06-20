<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <Teleport to="body">
    <div v-if="visible" class="quick-template-popup" :style="popupStyle" @keydown="onKey">
    <div class="qtp-card">
      <!-- Header: tiêu đề + filter chip dự án -->
      <div class="qtp-head">
        <div class="qtp-title">
          <v-icon size="14">mdi-message-flash-outline</v-icon>
          Mẫu tin nhắn <span class="qtp-count">{{ filtered.length }}</span>
        </div>
        <div class="qtp-tagbar">
          <button class="qtp-tag" :class="{ active: !tagFilter }" @click="tagFilter = ''">Tất cả</button>
          <button v-for="tag in PROJECT_TAGS" :key="tag" class="qtp-tag"
            :class="{ active: tagFilter === tag }" @click="tagFilter = tagFilter === tag ? '' : tag">
            {{ shortTag(tag) }}
          </button>
        </div>
      </div>

      <!-- Xem trước (gọn, ở TRÊN danh sách — sát mép trên popup) -->
      <div v-if="previewText" class="qtp-preview">
        <span class="qtp-preview-lbl">Xem trước:</span> {{ previewText }}
      </div>

      <!-- Danh sách mẫu (ở DƯỚI — sát ô nhập, dễ thấy + chọn nhất) -->
      <div class="qtp-list">
        <button
          v-for="(tpl, i) in filtered"
          :key="tpl.id"
          class="qtp-item"
          :class="{ active: i === selectedIndex }"
          @click="selectTemplate(tpl)"
          @mouseenter="selectedIndex = i"
        >
          <v-icon :icon="tpl.isPersonal ? 'mdi-account' : 'mdi-account-group'" size="15"
            :color="tpl.isPersonal ? '#1786be' : '#9ca3af'" class="qtp-item-icon" />
          <span class="qtp-item-body">
            <span class="qtp-item-name">
              {{ tpl.name }}
              <span v-if="tpl.shortcut" class="qtp-item-sc">/{{ tpl.shortcut }}</span>
            </span>
            <span class="qtp-item-sub">{{ plainOf(tpl) }}</span>
          </span>
          <span v-if="(tpl.tagIds || []).length" class="qtp-item-tag">{{ shortTag(tpl.tagIds![0]) }}</span>
        </button>
        <div v-if="!filtered.length" class="qtp-empty">Không tìm thấy mẫu nào</div>
      </div>

      <div class="qtp-foot">↑↓ chọn · Enter chèn · Esc đóng</div>
    </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';

interface RichPayload { text: string; styles?: Array<{ st: string; start: number; len: number }> }
interface Template {
  id: string;
  name: string;
  shortcut?: string | null;
  content: string;
  contentRich?: RichPayload | null;
  category: string | null;
  tagIds?: string[];
  isPersonal: boolean;
}
// crmAlias = tên gợi nhớ PER-NICK (Friend.aliasInNick của cặp KH × nick đang chat).
// Dùng cho {crm_*}. Trống → fallback fullName (khớp BE render-template.ts).
interface ContactCtx { fullName?: string | null; gender?: string | null; crmAlias?: string | null }

const PROJECT_TAGS = ['Emerald Garden View', 'Emerald Boulevard', 'Emerald River Park', 'Monrei Sài Gòn'];

const props = defineProps<{
  visible: boolean;
  query: string;
  templates: Template[];
  contact?: ContactCtx | null;
  saleFullName?: string | null;
  anchorEl?: HTMLElement | null; // ô nhập — popup neo ngay trên, Teleport ra body để không bị cha cắt
}>();

const emit = defineEmits<{
  // Trả rich payload {text, styles} (giữ đậm/màu) + id để track-use.
  select: [payload: RichPayload, templateId: string];
  close: [];
}>();

const selectedIndex = ref(0);
const tagFilter = ref('');

// ── Định vị popup (fixed) ngay TRÊN ô nhập. Teleport ra body nên tự tính toạ độ
// từ anchor (.editor-wrap) để thoát overflow:hidden của .input-area. ──
const popupStyle = ref<Record<string, string>>({});
function recalcPosition() {
  const el = props.anchorEl;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const width = Math.min(480, Math.max(320, r.width));
  let left = r.left;
  // không tràn mép phải
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (left < 8) left = 8;
  popupStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    // mọc LÊN TRÊN ô nhập: bottom neo theo mép trên của anchor.
    bottom: `${window.innerHeight - r.top + 6}px`,
    width: `${width}px`,
    maxHeight: `${Math.min(420, r.top - 16)}px`, // không vượt quá khoảng trống phía trên
  };
}

let onScrollResize: (() => void) | null = null;
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick();
    recalcPosition();
    onScrollResize = () => recalcPosition();
    window.addEventListener('resize', onScrollResize);
    window.addEventListener('scroll', onScrollResize, true);
  } else if (onScrollResize) {
    window.removeEventListener('resize', onScrollResize);
    window.removeEventListener('scroll', onScrollResize, true);
    onScrollResize = null;
  }
});
watch(() => props.query, () => { if (props.visible) recalcPosition(); });
onBeforeUnmount(() => {
  if (onScrollResize) {
    window.removeEventListener('resize', onScrollResize);
    window.removeEventListener('scroll', onScrollResize, true);
  }
});

function shortTag(tag: string): string { return tag.replace(/^Emerald\s+/, '').replace('Sài Gòn', 'SG'); }

// Chuẩn hóa query gõ tắt (giống normalizeShortcut backend) để so prefix với shortcut.
function normQuery(q: string): string {
  return q.trim().replace(/^\/+/, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

const filtered = computed(() => {
  let list = props.templates;
  if (tagFilter.value) list = list.filter((t) => (t.tagIds || []).includes(tagFilter.value));
  const q = (props.query || '').toLowerCase().trim();
  if (q) {
    const qs = normQuery(props.query);
    // Cho điểm: shortcut khớp prefix = ưu tiên cao nhất → gõ "/giaegv" nhảy đúng mẫu.
    const scored = list
      .map((t) => {
        const sc = (t.shortcut || '').toLowerCase();
        let score = -1;
        if (qs && sc) {
          if (sc === qs) score = 100;          // khớp hệt
          else if (sc.startsWith(qs)) score = 80; // gõ tắt prefix
          else if (sc.includes(qs)) score = 40;
        }
        if (score < 0) {
          if (t.name.toLowerCase().includes(q)) score = 20;
          else if (plainOf(t).toLowerCase().includes(q)) score = 10;
        }
        return { t, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score);
    list = scored.map((x) => x.t);
  }
  return list;
});

watch(filtered, () => { selectedIndex.value = 0; });
watch(() => props.query, () => { selectedIndex.value = 0; });

function plainOf(tpl: Template): string {
  return tpl.contentRich?.text ?? tpl.content ?? '';
}

// ── Render biến {gender}/{name}/{sale} ĐỒNG THỜI trên text + styles (re-anchor offset).
// Quét tuần tự text, thay token bằng giá trị, dịch các style start/len theo độ lệch độ dài.
// Tránh lệch đậm/màu khi biến đổi độ dài (cảnh báo workflow zalo-html-send).
function renderRich(tpl: Template): RichPayload {
  const src: RichPayload = tpl.contentRich?.text
    ? { text: tpl.contentRich.text, styles: tpl.contentRich.styles ?? [] }
    : { text: tpl.content ?? '', styles: [] };

  // 8 biến (anh chốt 2026-06-15) — KHỚP backend render-template.ts. crm_* = tên gợi nhớ
  // per-nick (crmAlias) → fallback fullName.
  const gender = props.contact?.gender;
  const genderStr = gender === 'female' ? 'Chị' : gender === 'male' ? 'Anh' : 'Anh/Chị';
  const nameRaw = (props.contact?.fullName ?? '').trim();
  const nameLast = nameRaw ? (nameRaw.split(/\s+/).pop() ?? '') : '';
  const saleRaw = (props.saleFullName ?? '').trim();
  const saleLast = saleRaw ? (saleRaw.split(/\s+/).pop() ?? 'em') : 'em';
  const crmFull = ((props.contact?.crmAlias ?? '').trim()) || nameRaw; // trống → fallback fullName
  const crmWords = crmFull ? crmFull.split(/\s+/) : [];

  const repl: Record<string, string> = {
    '{gender}': genderStr,
    '{name}': nameLast,
    '{name_full}': nameRaw,
    '{crm_full}': crmFull,
    '{crm_first}': crmWords[0] ?? '',
    '{crm_last}': crmWords[crmWords.length - 1] ?? '',
    '{sale}': saleLast,
    '{sale_full}': saleRaw || 'em',
  };

  const styles = (src.styles ?? []).map((s) => ({ ...s }));
  let text = src.text;

  // Tìm tất cả vị trí token, xử lý từ TRÁI sang PHẢI, mỗi lần thay 1 token + dịch styles sau nó.
  // token DÀI trước token NGẮN ({name_full} trước {name}) để regex không khớp nhầm phần đầu.
  const tokenRe = /\{(gender|name_full|name|crm_full|crm_first|crm_last|sale_full|sale)\}/;
  let guard = 0;
  while (guard++ < 200) {
    const m = tokenRe.exec(text);
    if (!m) break;
    const at = m.index;
    const tokenLen = m[0].length;
    const value = repl[m[0]] ?? '';
    const delta = value.length - tokenLen;
    text = text.slice(0, at) + value + text.slice(at + tokenLen);
    if (delta !== 0) {
      for (const s of styles) {
        const end = s.start + s.len;
        if (s.start >= at + tokenLen) {
          s.start += delta;                 // style nằm hoàn toàn sau token → dịch cả
        } else if (end > at && s.start <= at) {
          s.len += delta;                   // token nằm trong vùng style → co/giãn độ dài
        } else if (s.start > at && s.start < at + tokenLen) {
          s.start = at + value.length;      // style bắt đầu giữa token (hiếm) → neo về cuối value
        }
      }
    }
  }
  // dọn style rỗng/âm
  const clean = styles.filter((s) => s.len > 0 && s.start >= 0);
  return { text, styles: clean };
}

const previewText = computed(() => {
  const tpl = filtered.value[selectedIndex.value];
  if (!tpl) return '';
  return renderRich(tpl).text;
});

function selectTemplate(tpl: Template) {
  emit('select', renderRich(tpl), tpl.id);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex.value = Math.max(selectedIndex.value - 1, 0); }
  else if (e.key === 'Enter') { e.preventDefault(); const tpl = filtered.value[selectedIndex.value]; if (tpl) selectTemplate(tpl); }
  else if (e.key === 'Escape') { emit('close'); }
}

defineExpose({ onKey });
</script>

<style scoped>
.quick-template-popup {
  /* Toạ độ fixed set qua :style (popupStyle) — Teleport ra body. */
  z-index: 3000;
}
.qtp-card {
  width: 100%;
  height: 100%;
  background: #fff;
  border: 1px solid #e3e6eb;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(20, 26, 36, .16);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.qtp-head { padding: 8px 10px 6px; border-bottom: 1px solid #eef0f3; }
.qtp-title { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 6px; }
.qtp-count { background: #e6f3fb; color: #0f6ea3; font-size: 10.5px; font-weight: 700; padding: 0 6px; border-radius: 999px; }
.qtp-tagbar { display: flex; gap: 5px; flex-wrap: wrap; }
.qtp-tag { font-size: 11px; padding: 3px 9px; border: 1px solid #e3e6eb; background: #fff; border-radius: 999px; color: #4b5563; cursor: pointer; white-space: nowrap; }
.qtp-tag:hover { border-color: #1786be; }
.qtp-tag.active { background: #e6f3fb; border-color: #1786be; color: #0f6ea3; font-weight: 600; }

/* Xem trước — gọn 2 dòng */
.qtp-preview {
  padding: 7px 11px;
  background: #f7f9fc;
  border-bottom: 1px solid #eef0f3;
  font-size: 12.5px;
  color: #374151;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qtp-preview-lbl { color: #9ca3af; font-size: 11px; font-weight: 600; }

/* Danh sách — chiếm phần còn lại, cuộn riêng, luôn thấy đủ */
.qtp-list { flex: 1; min-height: 0; max-height: 280px; overflow-y: auto; padding: 4px; }
.qtp-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 9px; border: none; background: none; border-radius: 8px;
  cursor: pointer; text-align: left;
}
.qtp-item:hover, .qtp-item.active { background: #e6f3fb; }
.qtp-item-icon { flex-shrink: 0; }
.qtp-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.qtp-item-name { font-size: 13px; font-weight: 600; color: #141a24; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qtp-item-sc { font-size: 11px; font-weight: 600; color: #0f6ea3; background: #eef6fb; padding: 1px 5px; border-radius: 5px; margin-left: 5px; font-family: ui-monospace, monospace; }
.qtp-item-sub { font-size: 11.5px; color: #6b7280; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qtp-item-tag { flex-shrink: 0; font-size: 10px; padding: 2px 7px; border-radius: 6px; background: #eef2f7; color: #4b5563; font-weight: 500; white-space: nowrap; }
.qtp-empty { padding: 18px; text-align: center; color: #9ca3af; font-size: 12.5px; font-style: italic; }

/* Footer hint */
.qtp-foot { padding: 5px 11px; border-top: 1px solid #eef0f3; font-size: 10.5px; color: #9ca3af; text-align: center; }
</style>
