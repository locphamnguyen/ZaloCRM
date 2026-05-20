<template>
  <Teleport to="body">
    <div v-if="modelValue" class="apt-dialog-backdrop" @click.self="$emit('update:modelValue', false)">
      <div class="apt-dialog">
        <div class="apt-dialog-head">
          <span>{{ headerTitle }}</span>
          <button class="dialog-close" @click="$emit('update:modelValue', false)"><v-icon size="16">mdi-close</v-icon></button>
        </div>
        <div class="apt-dialog-body">
          <!-- Title -->
          <div class="apt-form-row col">
            <label>Tiêu đề</label>
            <input type="text" v-model="form.summary" placeholder="Mô tả ngắn việc cần làm" />
          </div>

          <!-- Date with quick chips -->
          <div class="apt-form-row col">
            <label>Ngày hẹn</label>
            <div class="date-row">
              <input type="date" v-model="form.date" class="date-input" />
              <div class="quick-chips">
                <button
                  v-for="opt in DATE_QUICK"
                  :key="opt.label"
                  class="chip"
                  :class="{ active: form.date === opt.value }"
                  @click="form.date = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Time -->
          <div class="apt-form-row col">
            <label>Giờ hẹn</label>
            <div class="time-row">
              <div class="time-picker">
                <select v-model="timeHour" class="time-select">
                  <option v-for="h in HOURS" :key="h" :value="h">{{ h }}h</option>
                </select>
                <span class="time-colon">:</span>
                <select v-model="timeMinute" class="time-select">
                  <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
                </select>
                <button v-if="form.time" class="clear-time" title="Xoá giờ (cả ngày)" @click="form.time = ''"><v-icon size="14">mdi-close</v-icon></button>
              </div>
              <div class="quick-chips">
                <button
                  v-for="opt in TIME_QUICK"
                  :key="opt.label"
                  class="chip"
                  :class="{ active: form.time === opt.value }"
                  @click="form.time = opt.value"
                >
                  <v-icon size="15">{{ opt.icon }}</v-icon>
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Type -->
          <div class="apt-form-row col">
            <label>Loại lịch hẹn</label>
            <div class="type-chips">
              <button
                v-for="opt in TYPE_OPTIONS"
                :key="opt.value"
                class="type-chip"
                :class="{ active: form.type === opt.value }"
                @click="form.type = opt.value"
              >
                <v-icon class="type-icon" size="16">{{ opt.icon }}</v-icon>
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- Location -->
          <div class="apt-form-row col">
            <label>Địa điểm <span class="optional">(tuỳ chọn)</span></label>
            <input type="text" v-model="form.location" placeholder="VP / Showroom / dự án…" />
          </div>
        </div>

        <div class="apt-dialog-foot">
          <button class="btn-link" @click="$emit('update:modelValue', false)">Huỷ</button>
          <button class="btn-primary" :disabled="!form.date || saving" @click="submit">
            <template v-if="saving">Đang tạo…</template>
            <template v-else><v-icon size="16">mdi-calendar-outline</v-icon> Lên lịch</template>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{
  modelValue: boolean;
  contactId: string | null;
  contactName?: string | null;
  prefill?: {
    date?: string | null;
    time?: string | null;
    type?: string | null;
    location?: string | null;
    summary?: string | null;
  };
  header?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [open: boolean];
  created: [appointmentId: string];
}>();

const toast = useToast();
const saving = ref(false);

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const DATE_QUICK = computed(() => [
  { label: 'Hôm nay', value: isoDate(0) },
  { label: 'Mai', value: isoDate(1) },
  { label: 'Kia', value: isoDate(2) },
  { label: '3 ngày', value: isoDate(3) },
  { label: '1 tuần', value: isoDate(7) },
]);

const HOURS = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

const TIME_QUICK = [
  { icon: 'mdi-weather-sunny', label: 'Sáng', value: '09:00' },
  { icon: 'mdi-weather-partly-cloudy', label: 'Trưa', value: '12:00' },
  { icon: 'mdi-weather-sunset', label: 'Chiều', value: '14:00' },
  { icon: 'mdi-weather-sunset', label: 'Tối', value: '19:00' },
];

const TYPE_OPTIONS = [
  { value: 'call', label: 'Gọi điện', icon: 'mdi-phone-outline' },
  { value: 'message', label: 'Nhắn tin', icon: 'mdi-chat-outline' },
  { value: 'meeting', label: 'Gặp mặt', icon: 'mdi-handshake-outline' },
  { value: 'follow_up', label: 'Theo dõi', icon: 'mdi-repeat' },
];

const form = ref({ summary: '', date: '', time: '09:00', type: 'follow_up', location: '' });

// Reset + prefill khi mở dialog
watch(() => props.modelValue, (open) => {
  if (!open) return;
  const today = isoDate(0);
  const name = (props.contactName || '').trim();
  const base = props.prefill?.summary || '';
  const summary = name && !base.includes(`[${name}]`) ? `${base} [${name}]`.trim() : base;
  form.value = {
    summary,
    date: props.prefill?.date || today,
    time: props.prefill?.time || '09:00',
    type: props.prefill?.type || 'follow_up',
    location: props.prefill?.location || '',
  };
});

const timeHour = computed<string>({
  get: () => {
    const t = form.value.time;
    if (!t) return '09';
    const h = t.slice(0, 2);
    return HOURS.includes(h) ? h : '09';
  },
  set: (h) => {
    const m = form.value.time ? form.value.time.slice(3, 5) : '00';
    const validM = MINUTES.includes(m) ? m : '00';
    form.value.time = `${h}:${validM}`;
  },
});
const timeMinute = computed<string>({
  get: () => {
    const t = form.value.time;
    if (!t) return '00';
    const m = t.slice(3, 5);
    return MINUTES.includes(m) ? m : '00';
  },
  set: (m) => {
    const h = form.value.time ? form.value.time.slice(0, 2) : '09';
    const validH = HOURS.includes(h) ? h : '09';
    form.value.time = `${validH}:${m}`;
  },
});

const headerTitle = computed(() => props.header || 'Tạo nhắc hẹn');

async function submit() {
  if (!form.value.date || !props.contactId) return;
  saving.value = true;
  try {
    const time = form.value.time && /^\d{2}:\d{2}$/.test(form.value.time) ? form.value.time : '09:00';
    const isoDateTime = new Date(`${form.value.date}T${time}:00`).toISOString();
    const loc = (form.value.location || '').trim();
    const notes = loc ? `${form.value.summary} (${loc})` : form.value.summary;
    const { data } = await api.post('/appointments', {
      contactId: props.contactId,
      appointmentDate: isoDateTime,
      appointmentTime: form.value.time || null,
      type: form.value.type || 'follow_up',
      notes,
    });
    const aptId = data.id || data.appointment?.id;
    toast.success('Đã tạo lịch hẹn');
    if (aptId) emit('created', aptId);
    emit('update:modelValue', false);
  } catch (err: any) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.error;
    if (status === 409) {
      toast.error(msg || 'Đã có lịch hẹn trùng giờ với KH này — đổi giờ hoặc xem trong Hoạt động');
    } else {
      toast.error(msg || `Không tạo được lịch hẹn (${status || 'unknown'})`);
    }
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.apt-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.apt-dialog {
  background: #fff;
  border-radius: 14px;
  min-width: 460px;
  max-width: 520px;
  width: 92vw;
  box-shadow: 0 12px 36px rgba(0,0,0,0.22);
  overflow: hidden;
}
.apt-dialog-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--smax-grey-200);
  font-weight: 700;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(90deg, #fff3e0, #fffde7);
  color: #6d4c00;
}
.dialog-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--smax-grey-600);
  line-height: 1;
}
.apt-dialog-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.apt-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.apt-form-row.col {
  flex-direction: column;
  align-items: stretch;
}
.apt-form-row label {
  font-size: 11px;
  font-weight: 700;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 5px;
}
.apt-form-row .optional {
  font-weight: 400;
  text-transform: none;
  font-size: 11px;
  color: var(--smax-grey-400);
  margin-left: 4px;
  letter-spacing: 0;
}
.apt-form-row input[type="text"],
.apt-form-row input[type="date"] {
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.apt-form-row input:focus { border-color: var(--smax-primary); box-shadow: 0 0 0 3px rgba(33,150,243,0.1); }

.date-row, .time-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.date-input { font-weight: 600; color: var(--smax-text); }

.quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  background: var(--smax-grey-100, #f5f6fa);
  border: 1px solid var(--smax-grey-200);
  border-radius: 14px;
  font-size: 11.5px;
  font-weight: 500;
  padding: 4px 11px;
  cursor: pointer;
  color: var(--smax-grey-700);
  transition: all 0.12s;
}
.chip:hover { background: var(--smax-primary-soft); color: var(--smax-primary); border-color: var(--smax-primary); }
.chip.active {
  background: var(--smax-primary);
  color: #fff;
  border-color: var(--smax-primary);
  font-weight: 600;
}

.time-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--smax-grey-50, #f9fafb);
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 8px;
  padding: 4px 6px;
  width: fit-content;
}
.time-select {
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  color: var(--smax-text);
  font-family: inherit;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
}
.time-select:hover { background: #fff; }
.time-colon {
  font-size: 18px;
  font-weight: 700;
  color: var(--smax-grey-500);
  line-height: 1;
}
.clear-time {
  background: transparent;
  border: none;
  color: var(--smax-grey-500);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 4px;
  line-height: 1;
}
.clear-time:hover { background: var(--smax-grey-200); color: #c62828; }

.type-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.type-chip {
  background: #fff;
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 8px;
  padding: 7px 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--smax-grey-700);
  transition: all 0.12s;
}
.type-chip:hover { border-color: var(--smax-primary); color: var(--smax-primary); }
.type-chip.active {
  background: var(--smax-primary-soft);
  border-color: var(--smax-primary);
  color: var(--smax-primary);
  font-weight: 600;
}
.type-icon { font-size: 17px; }

.apt-dialog-foot {
  padding: 10px 16px;
  border-top: 1px solid var(--smax-grey-100);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  background: var(--smax-grey-50);
}
.apt-dialog-foot .btn-primary {
  background: var(--smax-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.apt-dialog-foot .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.apt-dialog-foot .btn-link {
  background: none;
  border: none;
  color: var(--smax-grey-600);
  cursor: pointer;
  padding: 6px 10px;
}
</style>
