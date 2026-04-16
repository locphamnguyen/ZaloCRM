<template>
  <div class="rich-text-editor" :class="{ focused: isFocused }">
    <!-- Toolbar -->
    <div v-if="showToolbar" class="editor-toolbar d-flex align-center ga-1 pa-1">
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
import Underline from '@tiptap/extension-underline';

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  showToolbar?: boolean;
}>(), {
  placeholder: 'Nhập tin nhắn...',
  showToolbar: true,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
  typing: [];
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
    Underline,
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

/** Focus the editor */
function focus() {
  editor.value?.commands.focus();
}

defineExpose({ clear, focus });

onBeforeUnmount(() => { editor.value?.destroy(); });
</script>

<style scoped>
.rich-text-editor {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  transition: border-color 0.2s;
}
.rich-text-editor.focused {
  border-color: rgba(0, 242, 255, 0.4);
}
.editor-toolbar {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.editor-content :deep(.tiptap-input) {
  padding: 8px 12px;
  min-height: 36px;
  max-height: 120px;
  overflow-y: auto;
  outline: none;
  font-size: 0.875rem;
  line-height: 1.5;
}
.editor-content :deep(.tiptap-input p) {
  margin: 0;
}
.editor-content :deep(.tiptap-input p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: rgba(255, 255, 255, 0.3);
  pointer-events: none;
  height: 0;
}
.editor-content :deep(.tiptap-input code) {
  background: rgba(0, 242, 255, 0.08);
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 0.85em;
}
.editor-content :deep(.tiptap-input pre) {
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 12px;
  border-radius: 6px;
  font-family: monospace;
  margin: 4px 0;
}
</style>
