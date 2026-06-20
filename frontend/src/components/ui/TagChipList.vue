<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="tag-chip-list">
    <span v-for="tag in modelValue" :key="tag" class="tag-chip" :class="chipClass">
      {{ tag }}
      <span v-if="!readonly" class="x" @click="remove(tag)">×</span>
    </span>

    <input
      v-if="adding"
      v-model="draft"
      ref="input"
      class="tag-input"
      :placeholder="placeholder"
      @keydown.enter="commit"
      @keydown.escape="cancel"
      @blur="commit"
    />
    <button
      v-else-if="!readonly"
      class="tag-chip add"
      @click="startAdd"
    >+ {{ addLabel }}</button>

    <span v-if="!modelValue.length && readonly" class="empty">—</span>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string[];
  readonly?: boolean;
  chipClass?: string;
  placeholder?: string;
  addLabel?: string;
}>(), {
  readonly: false,
  chipClass: 'chip-grey',
  placeholder: 'Tag mới…',
  addLabel: 'Thêm',
});

const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>();

const adding = ref(false);
const draft = ref('');
const input = ref<HTMLInputElement | null>(null);

function startAdd() {
  adding.value = true;
  draft.value = '';
  nextTick(() => input.value?.focus());
}
function commit() {
  const t = draft.value.trim();
  if (t && !props.modelValue.includes(t)) {
    emit('update:modelValue', [...props.modelValue, t]);
  }
  adding.value = false;
  draft.value = '';
}
function cancel() {
  adding.value = false;
  draft.value = '';
}
function remove(tag: string) {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag));
}
</script>

<style scoped>
.tag-chip-list {
  display: flex; flex-wrap: wrap; gap: 4px;
  align-items: center;
}
.tag-chip {
  padding: 3px 7px;
  border-radius: 7px;
  font-size: 11px;
  display: inline-flex; align-items: center; gap: 4px;
}
.chip-grey    { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); }
.chip-info    { background: rgba(33,150,243,0.12); color: #1565c0; }
.chip-zalo    { background: rgba(255,167,38,0.18); color: #ef6c00; }
.chip-success { background: rgba(0,200,83,0.12);   color: #00897b; }

.tag-chip .x {
  cursor: pointer;
  opacity: 0.55;
  font-weight: 700;
}
.tag-chip .x:hover { opacity: 1; color: var(--smax-error); }

.tag-chip.add {
  background: transparent;
  border: 1px dashed var(--smax-grey-300);
  color: var(--smax-grey-700);
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 7px;
  font-family: inherit;
  font-size: 11px;
}
.tag-chip.add:hover {
  background: var(--smax-grey-50);
  border-color: var(--smax-primary);
  color: var(--smax-primary);
}

.tag-input {
  border: 1px solid var(--smax-primary);
  outline: none;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 11px;
  width: 110px;
  font-family: inherit;
}

.empty { color: var(--smax-grey-300); font-size: 11px; }
</style>
