<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-dialog :model-value="modelValue" max-width="480" persistent @update:model-value="emit('update:modelValue', $event)">
    <v-card class="invite-card">
      <v-card-title class="invite-title">
        <span class="ic">👋</span> Gửi lời mời kết bạn
      </v-card-title>
      <v-card-text class="invite-body">
        <div class="receiver" v-if="receiverName">
          Tới: <strong>{{ receiverName }}</strong>
        </div>
        <label class="msg-label">Lời chào (sẽ gửi kèm lời mời):</label>
        <v-textarea
          v-model="message"
          variant="outlined"
          rows="3"
          auto-grow
          counter="200"
          maxlength="200"
          placeholder="Xin chào, mình muốn kết bạn với bạn"
          hide-details="auto"
          class="msg-input"
        />
        <div class="hints">
          <button class="hint-chip" type="button" @click="message = 'Xin chào, mình muốn kết bạn với bạn'">Mặc định</button>
          <button class="hint-chip" type="button" @click="message = 'Chào bạn, mình là sale bên Hs Holding. Kết bạn để mình tư vấn nhé!'">Sale intro</button>
          <button class="hint-chip" type="button" @click="message = ''">Để trống</button>
        </div>
      </v-card-text>
      <v-card-actions class="invite-actions">
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="onCancel">Huỷ</v-btn>
        <v-btn color="primary" :loading="loading" @click="onSubmit">Gửi lời mời</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  receiverName?: string | null;
  loading?: boolean;
  /** Lời chào mặc định (override default text) */
  defaultMessage?: string;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'submit', message: string): void;
}>();

const message = ref(props.defaultMessage || 'Xin chào, mình muốn kết bạn với bạn');

watch(() => props.modelValue, (v) => {
  if (v) {
    message.value = props.defaultMessage || 'Xin chào, mình muốn kết bạn với bạn';
  }
});

function onCancel() {
  emit('update:modelValue', false);
}

function onSubmit() {
  emit('submit', message.value.trim());
}
</script>

<style scoped>
.invite-card { border-radius: 12px; }
.invite-title {
  font-size: 16px;
  font-weight: 600;
  padding: 16px 20px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.invite-title .ic { font-size: 20px; }
.invite-body { padding: 8px 20px 4px; }
.receiver {
  color: #475569;
  font-size: 13px;
  margin-bottom: 10px;
}
.msg-label {
  display: block;
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
  margin-bottom: 6px;
}
.msg-input { font-size: 14px; }
.hints {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.hint-chip {
  font-size: 11px;
  padding: 4px 8px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 999px;
  background: #f8fafc;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
}
.hint-chip:hover {
  background: #e2e8f0;
  border-color: rgba(0,0,0,0.2);
}
.invite-actions { padding: 8px 20px 16px; }
</style>
