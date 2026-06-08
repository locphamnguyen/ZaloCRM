<!--
  NotifyOwnerBox — bảng "Báo nội bộ" 3 đích.
  - I10 2026-06-04: owner làm thật, manager/group khóa "Đang phát triển".
  - CareSession 2026-06-07 (T10e): MỞ KHÓA manager + group khi v-model là OBJECT.
    Backward-compat: v-model boolean → mode cũ (chỉ owner). v-model object
    {owner, manager, zaloGroup} → 3 đích bật/tắt độc lập.
-->
<template>
  <div class="notify-box">
    <div class="notify-title">🔔 Báo nội bộ khi sự kiện xảy ra</div>
    <!-- Owner -->
    <label class="notify-row">
      <input type="checkbox" class="notify-check" :checked="cfg.owner" @change="set('owner', $event)" />
      <span class="notify-label">→ <span class="who">Sale phụ trách nick</span></span>
      <span class="nbadge ok">Hoạt động</span>
    </label>
    <!-- Manager -->
    <label class="notify-row" :class="{ locked: !objectMode }">
      <input type="checkbox" class="notify-check" :checked="cfg.manager" :disabled="!objectMode" @change="set('manager', $event)" />
      <span class="notify-label">→ <span class="who">Quản lý của Sale</span></span>
      <span class="nbadge" :class="objectMode ? 'ok' : 'dev'">{{ objectMode ? 'Hoạt động' : 'Đang phát triển' }}</span>
    </label>
    <!-- Group -->
    <label class="notify-row" :class="{ locked: !objectMode }">
      <input type="checkbox" class="notify-check" :checked="cfg.zaloGroup" :disabled="!objectMode" @change="set('zaloGroup', $event)" />
      <span class="notify-label">→ <span class="who">Nhóm Zalo báo cáo</span></span>
      <span class="nbadge" :class="objectMode ? 'ok' : 'dev'">{{ objectMode ? 'Hoạt động' : 'Đang phát triển' }}</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface NotifyCfg { owner: boolean; manager: boolean; zaloGroup: boolean }
const props = defineProps<{ modelValue: boolean | NotifyCfg }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean | NotifyCfg): void }>();

// Object mode = 3 đích mở khóa; boolean mode = chỉ owner (backward-compat).
const objectMode = computed(() => typeof props.modelValue === 'object' && props.modelValue !== null);

const cfg = computed<NotifyCfg>(() => {
  if (objectMode.value) return props.modelValue as NotifyCfg;
  return { owner: props.modelValue as boolean, manager: false, zaloGroup: false };
});

function set(key: keyof NotifyCfg, e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (objectMode.value) {
    emit('update:modelValue', { ...cfg.value, [key]: checked });
  } else if (key === 'owner') {
    emit('update:modelValue', checked);
  }
}
</script>

<style scoped>
.notify-box{margin-top:11px;border:1px solid var(--border,#dddddd);border-radius:7px;background:var(--bg-soft,#f8fafc);padding:9px 12px;}
.notify-title{font-size:12px;font-weight:700;color:var(--text,#181d26);margin-bottom:6px;}
.notify-row{display:flex;align-items:center;gap:9px;padding:5px 0;border-top:1px dashed var(--border,#dddddd);cursor:pointer;}
.notify-row:first-of-type{border-top:none;}
.notify-row.locked{cursor:default;}
.notify-check{width:17px;height:17px;flex-shrink:0;accent-color:#0a7d3c;cursor:pointer;}
.notify-check:disabled{cursor:not-allowed;opacity:.5;}
.notify-label{flex:1;font-size:12.5px;color:var(--text-2,#333840);}
.notify-label .who{font-weight:600;color:var(--text,#181d26);}
.nbadge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap;}
.nbadge.ok{background:#e8f6ee;color:#0a7d3c;}
.nbadge.dev{background:#f0ecff;color:#6b4bd8;border:1px dashed #c5b6f5;}
</style>
