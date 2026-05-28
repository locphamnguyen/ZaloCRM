<template>
  <div class="rich-text-editor" :class="{ focused: isFocused, 'has-content': !!modelValue }">
    <!-- Toolbar — chỉ hiện khi showToolbar=true. Anh chốt 2026-05-21: thêm color + size. -->
    <div v-if="showToolbar" class="editor-toolbar d-flex align-center ga-1">
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('bold') ? 'primary' : undefined"
        title="Đậm (Ctrl+B)"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <BoldIcon :size="16" :stroke-width="2" />
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('italic') ? 'primary' : undefined"
        title="Nghiêng (Ctrl+I)"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <ItalicIcon :size="16" :stroke-width="2" />
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('underline') ? 'primary' : undefined"
        title="Gạch chân (Ctrl+U)"
        @click="editor?.chain().focus().toggleUnderline().run()"
      >
        <UnderlineIcon :size="16" :stroke-width="2" />
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('strike') ? 'primary' : undefined"
        title="Gạch ngang"
        @click="editor?.chain().focus().toggleStrike().run()"
      >
        <StrikethroughIcon :size="16" :stroke-width="2" />
      </v-btn>

      <v-divider vertical class="mx-1" />

      <!-- Color picker UX v2: button A có gạch dưới màu hiện tại (chuẩn Word/Office). -->
      <v-menu :close-on-content-click="true" location="top">
        <template #activator="{ props: actProps }">
          <button
            type="button"
            class="color-trigger"
            v-bind="actProps"
            title="Màu chữ"
          >
            <span class="color-trigger-A">A</span>
            <span class="color-trigger-bar" :style="{ background: currentColorCss }"></span>
          </button>
        </template>
        <div class="color-palette-v2">
          <div class="palette-title">Màu chữ</div>
          <div class="palette-grid">
            <button
              v-for="c in COLOR_OPTIONS"
              :key="c.value || 'default'"
              type="button"
              class="color-swatch-v2"
              :class="{ active: c.value === null ? !hasAnyColor : editor?.isActive('zaloColor', { color: c.value }) }"
              :style="{ '--swatch': c.css }"
              :title="c.label"
              @click="applyColor(c.value)"
            >
              <span v-if="!c.value" class="swatch-default-mark">A</span>
              <span v-else-if="c.value === currentColorValue" class="swatch-check">✓</span>
            </button>
          </div>
        </div>
      </v-menu>

      <!-- Font size — 4 cấp (Small/Default/Big/Rất Lớn) -->
      <v-menu :close-on-content-click="true" location="top">
        <template #activator="{ props: actProps }">
          <button
            type="button"
            class="size-trigger"
            v-bind="actProps"
            title="Cỡ chữ"
          >
            <TypeIcon :size="14" :stroke-width="2" class="mr-1" />
            <span class="size-trigger-label">{{ currentSizeLabel }}</span>
          </button>
        </template>
        <div class="size-menu">
          <div class="palette-title">Cỡ chữ</div>
          <button
            v-for="s in SIZE_OPTIONS"
            :key="s.value || 'default'"
            type="button"
            class="size-item"
            :class="{ active: s.value === null ? !hasAnySize : editor?.isActive('zaloSize', { size: s.value }) }"
            @click="applySize(s.value)"
          >
            <span :style="{ fontSize: s.preview }">{{ s.label }}</span>
            <span v-if="s.value !== null && s.value === currentSizeValue" class="size-check">✓</span>
            <span v-else-if="s.value === null && !hasAnySize" class="size-check">✓</span>
          </button>
        </div>
      </v-menu>

      <v-divider vertical class="mx-1" />

      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('bulletList') ? 'primary' : undefined"
        title="Danh sách dấu chấm"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        <ListIcon :size="16" :stroke-width="2" />
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('orderedList') ? 'primary' : undefined"
        title="Danh sách số"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        <ListOrderedIcon :size="16" :stroke-width="2" />
      </v-btn>

      <v-divider vertical class="mx-1" />

      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('codeBlock') ? 'primary' : undefined"
        title="Khối code"
        @click="editor?.chain().focus().toggleCodeBlock().run()"
      >
        <CodeIcon :size="16" :stroke-width="2" />
      </v-btn>

    </div>

    <!-- AI Format — luôn hiện khi có text trong editor, không phụ thuộc vào toolbar.
         Nổi ở góc phải trên của vùng editor để user paste text vào là thấy ngay. -->
    <button
      v-if="modelValue.trim()"
      type="button"
      class="ai-format-btn ai-format-floating"
      :class="{ loading: aiFormatLoading }"
      :disabled="aiFormatLoading"
      title="AI tự format đoạn text — bold tiêu đề, màu giá tiền, size lớn tiêu đề..."
      @click="onAiFormat"
    >
      <SparklesIcon v-if="!aiFormatLoading" :size="14" :stroke-width="2" />
      <v-progress-circular v-else indeterminate size="12" width="2" />
      <span>{{ aiFormatLoading ? 'Đang format...' : 'AI Format' }}</span>
    </button>

    <!-- Editor content -->
    <EditorContent :editor="editor" class="editor-content" />
  </div>
</template>

<script setup lang="ts">
import { watch, onBeforeUnmount, ref, computed } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { Mark, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

// Lucide icons (anh chốt 2026-05-22 — bộ icon đồng bộ thay MDI)
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough as StrikethroughIcon,
  Type as TypeIcon,
  List as ListIcon,
  ListOrdered as ListOrderedIcon,
  Code as CodeIcon,
  Sparkles as SparklesIcon,
} from 'lucide-vue-next';

const toast = useToast();
// Note: @tiptap/starter-kit v3+ đã bundle Underline + Strike trong default extensions.

// ── Custom marks 2026-05-21: zaloColor + zaloSize ────────────────────────
// Tiptap v3 không bundle Color/TextStyle/FontSize → em viết custom mark đơn giản.
// Mỗi mark có 1 attr — color hex (vd 'db342e') hoặc size value (vd '13', '18').
const ZaloColorMark = Mark.create({
  name: 'zaloColor',
  addAttributes() {
    return {
      color: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-color'), renderHTML: (attrs) => attrs.color ? { 'data-color': attrs.color } : {} },
    };
  },
  parseHTML() { return [{ tag: 'span[data-color]' }]; },
  renderHTML({ HTMLAttributes }) {
    const color = HTMLAttributes['data-color'];
    return ['span', mergeAttributes(HTMLAttributes, color ? { style: `color:#${color}` } : {}), 0];
  },
});

const ZaloSizeMark = Mark.create({
  name: 'zaloSize',
  addAttributes() {
    return {
      size: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-size'), renderHTML: (attrs) => attrs.size ? { 'data-size': attrs.size } : {} },
    };
  },
  parseHTML() { return [{ tag: 'span[data-size]' }]; },
  renderHTML({ HTMLAttributes }) {
    const size = HTMLAttributes['data-size'];
    return ['span', mergeAttributes(HTMLAttributes, size ? { style: `font-size:${size}px` } : {}), 0];
  },
});

// ── Color + Size palette ─────────────────────────────────────────────────
// Mapping với Zalo TextStyle enum: c_db342e/f27806/f7b503/15a85f + f_13/f_18.
const COLOR_OPTIONS = [
  { value: null,       label: 'Mặc định', css: 'transparent', cssBorder: '#9ca3af' },
  { value: 'db342e',   label: 'Đỏ',       css: '#db342e' },
  { value: 'f27806',   label: 'Cam',      css: '#f27806' },
  { value: 'f7b503',   label: 'Vàng',     css: '#f7b503' },
  { value: '15a85f',   label: 'Xanh lá',  css: '#15a85f' },
  { value: '2962ff',   label: 'Xanh dương', css: '#2962ff' },
] as const;

// 4 cấp size — Zalo enum chuẩn: f_13 (Small), f_18 (Big). f_22 = "Rất Lớn" — Zalo
// render được dù không có trong enum (community-tested 2026-05-21).
const SIZE_OPTIONS = [
  { value: '13', label: 'Nhỏ',     preview: '11px' },
  { value: null, label: 'Mặc định', preview: '14px' },
  { value: '18', label: 'Lớn',     preview: '17px' },
  { value: '22', label: 'Rất Lớn', preview: '20px' },
] as const;

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  showToolbar?: boolean;
}>(), {
  placeholder: 'Nhập tin nhắn...',
  showToolbar: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
  typing: [];
  'paste-image': [files: File[]];
}>();

const isFocused = ref(false);

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      blockquote: false,
    }),
    Placeholder.configure({ placeholder: props.placeholder }),
    ZaloColorMark,
    ZaloSizeMark,
  ],
  editorProps: {
    handleKeyDown(_view, event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        emit('submit');
        return true;
      }
      return false;
    },
    handlePaste(_view, event) {
      const items = event.clipboardData?.items;
      if (!items) return false;
      const imgFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) imgFiles.push(f);
        }
      }
      if (imgFiles.length) {
        event.preventDefault();
        emit('paste-image', imgFiles);
        return true;
      }
      return false;
    },
    attributes: { class: 'tiptap-input' },
  },
  onUpdate({ editor: ed }) {
    const text = ed.getText();
    emit('update:modelValue', text);
    emit('typing');
  },
  onFocus() { isFocused.value = true; },
  onBlur() { isFocused.value = false; },
});

// Sync external modelValue changes into editor
watch(() => props.modelValue, (val) => {
  if (!editor.value) return;
  const current = editor.value.getText();
  if (val !== current) {
    editor.value.commands.setContent(val || '');
  }
});

// ── Apply color / size to selection ──────────────────────────────────────
function applyColor(color: string | null) {
  if (!editor.value) return;
  if (color === null) {
    editor.value.chain().focus().unsetMark('zaloColor').run();
  } else {
    editor.value.chain().focus().setMark('zaloColor', { color }).run();
  }
}
function applySize(size: string | null) {
  if (!editor.value) return;
  if (size === null) {
    editor.value.chain().focus().unsetMark('zaloSize').run();
  } else {
    editor.value.chain().focus().setMark('zaloSize', { size }).run();
  }
}

// 2026-05-21 UX fix: track current color/size để vẽ thanh bar dưới chữ A (chuẩn Word).
const currentColorValue = computed<string | null>(() => {
  for (const c of COLOR_OPTIONS) {
    if (c.value && editor.value?.isActive('zaloColor', { color: c.value })) return c.value;
  }
  return null;
});
const currentColorCss = computed<string>(() => {
  const v = currentColorValue.value;
  return v ? `#${v}` : 'transparent';
});
const hasAnyColor = computed<boolean>(() => currentColorValue.value !== null);

const currentSizeValue = computed<string | null>(() => {
  for (const s of SIZE_OPTIONS) {
    if (s.value && editor.value?.isActive('zaloSize', { size: s.value })) return s.value;
  }
  return null;
});
const currentSizeLabel = computed<string>(() => {
  const v = currentSizeValue.value;
  if (!v) return 'Mặc định';
  const o = SIZE_OPTIONS.find((x) => x.value === v);
  return o?.label || 'Mặc định';
});
const hasAnySize = computed<boolean>(() => currentSizeValue.value !== null);

function clear() {
  editor.value?.commands.clearContent(true);
}

function focus(position?: 'start' | 'end' | number) {
  editor.value?.commands.focus(position);
}

function insertText(text: string) {
  if (!text) return;
  editor.value?.chain().focus().insertContent(text).run();
}

// ── Rich payload extract (mở rộng 2026-05-21) ───────────────────────────
// Walk Tiptap JSON doc → trả về { text, styles } theo format zca-js Zalo SDK:
//   b / i / u / s    → inline marks
//   c_RRGGBB         → màu chữ (zaloColor)
//   f_NN             → cỡ chữ (zaloSize)
//   lst_1 / lst_2    → bullet / numbered list (apply per line)

interface ZaloStyle { st: string; start: number; len: number }
interface TiptapMark { type: string; attrs?: Record<string, unknown> }
interface TiptapNode {
  type: string;
  text?: string;
  marks?: TiptapMark[];
  content?: TiptapNode[];
}

const MARK_TO_ZALO: Record<string, string> = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strike: 's',
};

function extractRichPayload(doc: TiptapNode | null): { text: string; styles: ZaloStyle[] } {
  if (!doc) return { text: '', styles: [] };
  const styles: ZaloStyle[] = [];
  let textBuf = '';
  // Track list context — apply lst_1/lst_2 per line inside list nodes.
  let listType: 'bullet' | 'ordered' | null = null;

  function pushStyle(st: string, start: number, len: number) {
    if (len > 0 && st) styles.push({ st, start, len });
  }

  function walkNode(node: TiptapNode, blockListType: typeof listType) {
    if (node.type === 'text' && typeof node.text === 'string') {
      const start = textBuf.length;
      textBuf += node.text;
      const len = node.text.length;
      if (len === 0) return;
      for (const mark of node.marks || []) {
        if (mark.type === 'zaloColor') {
          const color = String(mark.attrs?.color || '');
          if (color) pushStyle(`c_${color}`, start, len);
        } else if (mark.type === 'zaloSize') {
          const size = String(mark.attrs?.size || '');
          if (size) pushStyle(`f_${size}`, start, len);
        } else {
          const st = MARK_TO_ZALO[mark.type];
          if (st) pushStyle(st, start, len);
        }
      }
      return;
    }
    if (node.type === 'hardBreak') {
      textBuf += '\n';
      return;
    }
    // Block separator: paragraph / list item / code block → linebreak (except first block).
    const isBlock = ['paragraph', 'listItem', 'codeBlock', 'heading'].includes(node.type);
    if (isBlock && textBuf.length > 0) textBuf += '\n';

    // List wrapper → set context for child listItems.
    let childListType = blockListType;
    if (node.type === 'bulletList') childListType = 'bullet';
    else if (node.type === 'orderedList') childListType = 'ordered';

    // ListItem: capture line start, apply lst_X after walking children.
    if (node.type === 'listItem' && blockListType) {
      const lineStart = textBuf.length;
      (node.content || []).forEach((c) => walkNode(c, blockListType));
      const lineLen = textBuf.length - lineStart;
      pushStyle(blockListType === 'bullet' ? 'lst_1' : 'lst_2', lineStart, lineLen);
      return;
    }

    (node.content || []).forEach((c) => walkNode(c, childListType));
  }

  walkNode(doc, listType);
  return { text: textBuf, styles };
}

function getRichPayload(): { text: string; styles: ZaloStyle[] } {
  if (!editor.value) return { text: '', styles: [] };
  return extractRichPayload(editor.value.getJSON() as TiptapNode);
}

// ── AI Auto-format 2026-05-21 ───────────────────────────────────────────
const aiFormatLoading = ref(false);
async function onAiFormat() {
  if (!editor.value) return;
  const rawText = editor.value.getText();
  if (!rawText.trim()) return;
  aiFormatLoading.value = true;
  try {
    const res = await api.post('/ai/format-rich', { text: rawText });
    const data = res.data as { text: string; styles: Array<{ st: string; start: number; len: number }>; source: 'ai' | 'fallback' };
    if (data.source === 'fallback' || !data.styles || data.styles.length === 0) {
      toast.warning('AI chưa apply được format (đoạn quá ngắn hoặc AI tắt). Anh tự format hoặc gửi plain text.');
      return;
    }
    applyRichPayload(data);
    toast.success(`AI đã format ${data.styles.length} đoạn — anh xem rồi bấm gửi`);
  } catch (err: any) {
    const msg = err?.response?.data?.error || 'Lỗi gọi AI Format';
    toast.error(msg);
  } finally {
    aiFormatLoading.value = false;
  }
}

/**
 * Ngược của extractRichPayload — set editor content từ {text, styles[]}.
 * Dùng cho AI Auto-format: AI return → applyRichPayload → user thấy format ngay → bấm gửi.
 *
 * Cách hoạt động: set raw text → walk từng style range → setTextSelection + setMark.
 * Caveat: Zalo styles support per-char overlap (b + i + color cùng range). Tiptap setMark
 * idempotent → apply nhiều mark cùng range = OK.
 */
function applyRichPayload(payload: { text: string; styles?: Array<{ st: string; start: number; len: number }> }) {
  if (!editor.value) return;
  const text = payload.text || '';
  if (!text) return;

  // Set raw text first — convert \n thành paragraph break để Tiptap render đúng nhiều dòng.
  const lines = text.split('\n');
  const docContent = lines.map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }));
  editor.value.commands.setContent({ type: 'doc', content: docContent });

  // Build map: linear-text-pos → ProseMirror pos (ProseMirror tính cả block tokens).
  // Mỗi paragraph có +2 pos (open + close tokens), em map linear → doc pos.
  function linearToDocPos(linearPos: number): number {
    let remaining = linearPos;
    let docPos = 1; // start sau document open
    for (const line of lines) {
      if (remaining <= line.length) return docPos + remaining;
      remaining -= line.length + 1; // +1 cho \n giữa 2 paragraph
      docPos += line.length + 2;    // +2 cho close+open của paragraph kế tiếp
    }
    return docPos;
  }

  const styles = Array.isArray(payload.styles) ? payload.styles : [];
  for (const s of styles) {
    if (!s || typeof s.start !== 'number' || typeof s.len !== 'number' || s.len <= 0) continue;
    const from = linearToDocPos(s.start);
    const to = linearToDocPos(s.start + s.len);
    if (from >= to) continue;

    let markName: string;
    let attrs: Record<string, unknown> | undefined;
    if (s.st === 'b') markName = 'bold';
    else if (s.st === 'i') markName = 'italic';
    else if (s.st === 'u') markName = 'underline';
    else if (s.st === 's') markName = 'strike';
    else if (s.st.startsWith('c_')) { markName = 'zaloColor'; attrs = { color: s.st.slice(2) }; }
    else if (s.st.startsWith('f_')) { markName = 'zaloSize'; attrs = { size: s.st.slice(2) }; }
    else continue;

    editor.value.chain().setTextSelection({ from, to }).setMark(markName, attrs || {}).run();
  }
  editor.value.commands.focus('end');
}

defineExpose({ clear, focus, insertText, getRichPayload, applyRichPayload });

onBeforeUnmount(() => { editor.value?.destroy(); });
</script>

<style scoped>
.rich-text-editor {
  border: 1.5px solid var(--smax-grey-200, #ebedf0);
  border-radius: 9px;
  background: var(--smax-bg, #fff);
  transition: border-color 0.2s, box-shadow 0.2s;
  position: relative;
  /* Anh chốt 2026-05-22 (issue 1): overflow:hidden để border-radius CLIP content
     (toolbar bg) theo bo viền → 2 góc trên không bị "đứt nét" khi focus. */
  overflow: hidden;
}
.rich-text-editor.focused,
.rich-text-editor:focus-within {
  border-color: var(--smax-primary, #2962ff);
  box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.10);
}

.editor-toolbar {
  height: 30px;
  padding: 3px 4px;
  border-bottom: 1px solid var(--smax-grey-100, #f5f6fa);
  overflow: hidden;
  background: var(--smax-grey-50, #fafbfc);
}

/* Color trigger — kiểu Word/Office: chữ A có gạch dưới = màu hiện tại */
.color-trigger {
  display: inline-flex; flex-direction: column; align-items: center;
  width: 28px; height: 28px;
  border: 0; background: transparent;
  border-radius: 4px;
  cursor: pointer;
  padding: 2px 0 0;
  transition: background 0.12s ease;
  position: relative;
}
.color-trigger:hover { background: var(--smax-grey-100, #f3f4f6); }
.color-trigger-A {
  font-size: 14px; font-weight: 700;
  color: var(--smax-text, #212121);
  line-height: 1;
  margin-bottom: 2px;
}
.color-trigger-bar {
  display: block;
  width: 18px; height: 4px;
  border-radius: 1px;
  border: 1px solid var(--smax-grey-200, #e5e7eb);
  background: transparent;
}

/* Color palette v2 */
.color-palette-v2 {
  background: white;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.14);
  padding: 10px 12px;
  min-width: 200px;
}
.palette-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  color: var(--smax-grey-500, #6b7280);
  margin-bottom: 8px;
  letter-spacing: 0.04em;
}
.palette-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.color-swatch-v2 {
  width: 26px; height: 26px;
  border-radius: 6px;
  background: var(--swatch);
  border: 2px solid #e5e7eb;
  cursor: pointer;
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700;
  color: var(--smax-text);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.color-swatch-v2:hover {
  transform: scale(1.12);
  box-shadow: 0 2px 6px rgba(0,0,0,0.12);
}
.color-swatch-v2.active {
  border-color: var(--smax-primary, #2962ff);
  box-shadow: 0 0 0 2px var(--smax-primary-soft, #e3f2fd);
}
.swatch-default-mark { color: var(--smax-text); font-size: 13px; }
.swatch-check { color: white; font-size: 13px; font-weight: 700; text-shadow: 0 0 2px rgba(0,0,0,0.4); }

/* Size trigger — button có icon + label hiện size đang chọn */
.size-trigger {
  display: inline-flex; align-items: center;
  height: 28px;
  padding: 0 8px;
  border: 0; background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px; color: var(--smax-text);
  transition: background 0.12s ease;
}
.size-trigger:hover { background: var(--smax-grey-100, #f3f4f6); }
.size-trigger-label { font-weight: 500; }

/* Size dropdown */
.size-menu {
  display: flex; flex-direction: column;
  background: white;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.14);
  padding: 8px;
  min-width: 150px;
}
.size-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: 5px;
  font-family: inherit;
  color: var(--smax-text);
  transition: background 0.12s ease;
}
.size-item:hover { background: var(--smax-grey-100, #f3f4f6); }
.size-item.active {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
  font-weight: 600;
}
.size-check { color: var(--smax-primary, #2962ff); font-weight: 700; }

/* AI Format button — gradient tím-xanh kiểu "magic" */
.ai-format-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  border: 0;
  background: linear-gradient(135deg, #7c3aed 0%, #2962ff 100%);
  color: white;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  transition: transform 0.12s ease, opacity 0.12s ease, box-shadow 0.12s ease;
  white-space: nowrap;
}
.ai-format-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(124, 58, 237, 0.35);
}
.ai-format-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ai-format-btn.loading {
  opacity: 0.8;
}
.ai-format-floating {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 5;
}
.rich-text-editor { position: relative; }

/* Editor content */
.editor-content :deep(.tiptap-input) {
  padding: 8px 13px;
  min-height: 60px;
  max-height: var(--editor-max-h, 320px);
  overflow-y: auto;
  outline: none;
  font-size: 14px;
  line-height: 1.5;
  color: var(--smax-text, #212121);
  box-sizing: border-box;
}
.editor-content :deep(.tiptap-input p) { margin: 0; }
.editor-content :deep(.tiptap-input ul),
.editor-content :deep(.tiptap-input ol) {
  margin: 4px 0;
  padding-left: 22px;
}
.editor-content :deep(.tiptap-input ul li) { list-style: disc; }
.editor-content :deep(.tiptap-input ol li) { list-style: decimal; }
.editor-content :deep(.tiptap-input p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--smax-grey-300, #d4d8de);
  font-style: italic;
  pointer-events: none;
  height: 0;
}
.editor-content :deep(.tiptap-input code) {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
}
.editor-content :deep(.tiptap-input pre) {
  background: var(--smax-grey-100, #f5f6fa);
  padding: 8px 12px;
  border-radius: 7px;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  margin: 4px 0;
}
</style>
