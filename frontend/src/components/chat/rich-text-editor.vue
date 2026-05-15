<template>
  <div class="rich-text-editor" :class="{ focused: isFocused, 'has-content': !!modelValue }">
    <!-- Toolbar — chỉ hiện khi focus hoặc đang có nội dung (CSS animate) -->
    <div v-if="showToolbar" class="editor-toolbar d-flex align-center ga-1">
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('bold') ? 'primary' : undefined"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <v-icon size="16">mdi-format-bold</v-icon>
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('italic') ? 'primary' : undefined"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <v-icon size="16">mdi-format-italic</v-icon>
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('underline') ? 'primary' : undefined"
        @click="editor?.chain().focus().toggleUnderline().run()"
      >
        <v-icon size="16">mdi-format-underline</v-icon>
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('strike') ? 'primary' : undefined"
        @click="editor?.chain().focus().toggleStrike().run()"
      >
        <v-icon size="16">mdi-format-strikethrough</v-icon>
      </v-btn>
      <v-divider vertical class="mx-1" />
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('bulletList') ? 'primary' : undefined"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        <v-icon size="16">mdi-format-list-bulleted</v-icon>
      </v-btn>
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('orderedList') ? 'primary' : undefined"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        <v-icon size="16">mdi-format-list-numbered</v-icon>
      </v-btn>
      <v-divider vertical class="mx-1" />
      <v-btn
        icon size="x-small" variant="text"
        :color="editor?.isActive('codeBlock') ? 'primary' : undefined"
        @click="editor?.chain().focus().toggleCodeBlock().run()"
      >
        <v-icon size="16">mdi-code-braces</v-icon>
      </v-btn>
    </div>

    <!-- Editor content -->
    <EditorContent :editor="editor" class="editor-content" />
  </div>
</template>

<script setup lang="ts">
import { watch, onBeforeUnmount, ref } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
// Note: @tiptap/starter-kit v3+ đã bundle Underline trong default extensions.
// KHÔNG import + add Underline rời nữa — sẽ gây warning "Duplicate extension names found".

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  showToolbar?: boolean;       // Hiển thị format toolbar (B I U S list code) — mặc định FALSE.
                               //  Parent toggle qua T icon button khi cần.
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
      // Bắt paste image từ clipboard (Ctrl+V hình ảnh)
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

/** Clear editor content — called by parent after send */
function clear() {
  editor.value?.commands.clearContent(true);
}

/** Focus the editor. Position: 'start' | 'end' | number | undefined (= last cursor pos). */
function focus(position?: 'start' | 'end' | number) {
  editor.value?.commands.focus(position);
}

/** Insert plain text/emoji at cursor position */
function insertText(text: string) {
  if (!text) return;
  editor.value?.chain().focus().insertContent(text).run();
}

defineExpose({ clear, focus, insertText });

onBeforeUnmount(() => { editor.value?.destroy(); });
</script>

<style scoped>
.rich-text-editor {
  border: 1.5px solid var(--smax-grey-200, #ebedf0);
  border-radius: 9px;
  background: var(--smax-bg, #fff);
  transition: border-color 0.2s, box-shadow 0.2s;
  position: relative;
}
.rich-text-editor.focused,
.rich-text-editor:focus-within {
  border-color: var(--smax-primary, #2962ff);
  box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.10);
}

/* ── Format toolbar: hidden by default, parent toggle qua prop showToolbar=true.
 * Khi prop true → render `v-if="showToolbar"` ở template → element không tồn tại
 * khi false → 0 height, không reserve space. ── */
.editor-toolbar {
  height: 30px;
  padding: 3px 4px;
  border-bottom: 1px solid var(--smax-grey-100, #f5f6fa);
  overflow: hidden;
  background: var(--smax-grey-50, #fafbfc);
}

/* Editor content: auto-grow theo nội dung (min 60px ~ 2 dòng Zalo Web).
 * Max-height kế thừa từ parent .input-area (CSS variable --editor-max-h),
 * scroll bên trong nếu vượt. Mặc định 320px cho an toàn. */
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
.editor-content :deep(.tiptap-input p) {
  margin: 0;
}
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
