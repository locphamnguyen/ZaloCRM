<template>
  <div class="fi-create">
    <!-- ================== TOPBAR (HS .mkt-top scaffold) ================== -->
    <div class="mkt-top">
      <div>
        <div class="mtt">Tạo Mục tiêu: Tự động kết bạn</div>
        <div class="mts">
          Cấu hình 1 lần — hệ thống tự gửi lời mời từ nhiều nick, kèm bám đuổi vào tin nhắn lạ kể cả khi khách chưa đồng ý.
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" @click="router.back()">
          <v-icon size="16">mdi-arrow-left</v-icon> Quay lại
        </button>
      </div>
    </div>

    <div class="mkt-body">
      <!-- ================== STEP CHIPS ================== -->
      <div class="step-chips">
        <button
          v-for="s in steps"
          :key="s.id"
          type="button"
          class="chip"
          :class="stepChipClass(s.id)"
          @click="goStep(s.id)"
        >
          <span class="step-num num">{{ s.id }}</span>
          {{ s.label }}
          <v-icon v-if="currentStep > s.id" size="13">mdi-check</v-icon>
        </button>
      </div>

      <!-- ============================ BƯỚC 1 ============================ -->
      <div v-if="currentStep === 1" class="step-pane">
        <!-- ① Tên Mục tiêu -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-tag-text-outline</v-icon>
            Tên Mục tiêu <span class="req">*</span>
          </div>
          <div class="field">
            <input v-model="form.name" placeholder="VD: Auto kết bạn 1000 số cho 10 nick 29.05.2026" />
          </div>
        </section>

        <!-- ② Tệp khách hàng -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-folder-account-outline</v-icon>
            Tệp khách hàng <span class="req">*</span>
          </div>
          <div class="field">
            <select v-model="form.listId">
              <option :value="''" disabled>— Chọn tệp khách hàng —</option>
              <option v-for="l in lists" :key="l.id" :value="l.id">
                {{ l.name }} ({{ l.totalEntries }} SĐT)
              </option>
            </select>
          </div>
        </section>

        <!-- ③ Nick gửi lời mời -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-account-multiple-outline</v-icon>
            Nick gửi lời mời <span class="req">*</span>
            <span class="chip chip-grey count-chip">{{ form.nickIds.length }} đã chọn</span>
          </div>
          <div class="nick-list">
            <label
              v-for="n in nicks"
              :key="n.id"
              class="nick-item"
              :class="{ 'is-selected': form.nickIds.includes(n.id) }"
            >
              <input type="checkbox" :value="n.id" v-model="form.nickIds" />
              <div class="av av-28">{{ initials(n.displayName) }}</div>
              <div class="nick-info">
                <div class="nick-name">{{ n.displayName || n.id }}</div>
                <div class="nick-meta">
                  <span class="status">
                    <span class="dot" :style="{ background: n.status === 'connected' ? 'var(--success)' : 'var(--error)' }"></span>
                    {{ n.status === 'connected' ? 'Online' : n.status }}
                  </span>
                  · cap {{ n.dailyFriendAddCap }} lời mời/ngày
                </div>
              </div>
            </label>
            <div v-if="!nicks.length" class="empty-hint">
              Chưa có nick nào kết nối. Hãy kết nối nick Zalo trước.
            </div>
          </div>
        </section>

        <!-- ④ Quy tắc bỏ qua KH (was ⑦) -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-shield-outline</v-icon>
            Quy tắc bỏ qua khách hàng
          </div>
          <div class="rule">
            <span class="rule-ico"><v-icon size="14">mdi-clock-outline</v-icon></span>
            Khách đã có chat với nick khác trong
            <div class="field sm num-field">
              <input v-model.number="form.skipRules.recencyDays" type="number" min="0" />
            </div>
            ngày gần đây
          </div>
          <div class="rule">
            <span class="rule-ico"><v-icon size="14">mdi-account-group-outline</v-icon></span>
            Khách đã friend với hơn
            <div class="field sm num-field">
              <input v-model.number="form.skipRules.friendCap" type="number" min="0" />
            </div>
            nick của tổ chức
          </div>
        </section>
      </div>

      <!-- ============================ BƯỚC 2 ============================ -->
      <div v-if="currentStep === 2" class="step-pane">
        <!-- ④ Lời chào kết bạn -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-hand-wave-outline</v-icon>
            Lời chào kết bạn <span class="req">*</span>
          </div>
          <textarea
            v-model="form.greetingTemplate"
            class="ta"
            rows="4"
            maxlength="200"
            placeholder="VD: Chào {gender} {name}, em là {sale} bên dự án..."
          ></textarea>
          <div class="hint">
            {{ form.greetingTemplate.length }} / 200 ký tự · Click chèn biến:
            <button type="button" class="chip chip-grey var-pill" @click="insertVar('{gender}')">{gender}</button>
            <button type="button" class="chip chip-grey var-pill" @click="insertVar('{name}')">{name}</button>
            <button type="button" class="chip chip-grey var-pill" @click="insertVar('{sale}')">{sale}</button>
          </div>
          <div v-if="greetingPreview" class="preview">
            <div class="preview-label">Preview (KH nữ + sale "Thành"):</div>
            {{ greetingPreview }}
          </div>
        </section>

        <!-- ⑤ Tin chào mừng (welcome probe) -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-email-fast-outline</v-icon>
            Tin chào mừng (sau khi gửi lời mời)
          </div>
          <p class="block-help">
            Gửi NGAY sau khi gửi lời mời kết bạn (không đợi đồng ý). Mục đích: kiểm tra khách có cho phép nhận tin lạ không.
            Chỉ khách gửi thành công mới gắn vào luồng bám đuổi (tiết kiệm hàng đợi, tránh spam).
          </p>
          <textarea
            v-model="form.welcomeMessageTemplate"
            class="ta"
            rows="3"
            maxlength="4000"
            placeholder="Em chào {gender} {name}, em là {sale}, em vừa kết bạn để tiện hỗ trợ Anh/Chị ạ."
          ></textarea>
          <div class="hint">
            {{ form.welcomeMessageTemplate.length }} / 4000 ký tự · Biến:
            <code class="chip chip-grey var-pill">{gender}</code> Anh/Chị
            <code class="chip chip-grey var-pill">{name}</code> tên KH
            <code class="chip chip-grey var-pill">{sale}</code> tên sale
          </div>

          <div class="delay-row">
            <v-icon size="15">mdi-timer-sand</v-icon>
            <span>Chờ sau khi gửi lời mời</span>
            <div class="field sm num-field wide">
              <input v-model.number="form.welcomeDelaySeconds" type="number" min="0" max="3600" />
            </div>
            <span>giây</span>
            <span class="hint inline-hint">(60 phút an toàn chống spam · 0 = gửi ngay)</span>
          </div>

          <div v-if="!form.welcomeMessageTemplate" class="welcome-info">
            <v-icon size="15">mdi-lightbulb-outline</v-icon>
            Bỏ trống = bỏ qua tin chào mừng (khách đồng ý kết bạn xong vào bám đuổi ngay). Mặc định nên có để chặn cửa tin lạ.
          </div>
        </section>

        <!-- ⑥ Luồng bám đuổi -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-sync</v-icon>
            Luồng bám đuổi <span class="req">*</span>
          </div>
          <div class="field">
            <select v-model="form.successorSequenceId">
              <option :value="''" disabled>— Chọn Luồng kịch bản —</option>
              <option v-for="s in sequences" :key="s.id" :value="s.id">
                {{ s.name }} ({{ (s.steps as unknown[])?.length ?? 0 }} bước)
              </option>
            </select>
          </div>
        </section>
      </div>

      <!-- ============================ BƯỚC 3 ============================ -->
      <div v-if="currentStep === 3" class="step-pane">
        <!-- Quy tắc gửi an toàn -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-shield-check-outline</v-icon>
            Quy tắc gửi an toàn
          </div>
          <p class="block-help">
            Giữ nick Zalo không bị cảnh báo spam. Hệ thống điền sẵn mặc định an toàn — chỉnh nếu cần đặc biệt.
          </p>

          <div class="rule">
            <span class="rule-ico"><v-icon size="14">mdi-timer-outline</v-icon></span>
            Cách nhau tối thiểu giữa 2 lần gửi
            <div class="field sm num-field wide">
              <input v-model.number="form.welcomeDelaySeconds" type="number" min="0" max="3600" />
            </div>
            giây
            <span class="hint inline-hint">(dùng chung với khoảng chờ tin chào mừng)</span>
          </div>

          <div class="rule">
            <span class="rule-ico"><v-icon size="14">mdi-clock-time-eight-outline</v-icon></span>
            Khung giờ chạy (giờ Việt Nam)
            <div class="field sm time-field">
              <input v-model="quietHoursStart" type="time" />
            </div>
            <v-icon size="14" class="time-arrow">mdi-arrow-right</v-icon>
            <div class="field sm time-field">
              <input v-model="quietHoursEnd" type="time" />
            </div>
          </div>
        </section>

        <!-- Thời điểm bắt đầu -->
        <section class="card card-pad block">
          <div class="block-title">
            <v-icon size="16">mdi-rocket-launch-outline</v-icon>
            Thời điểm bắt đầu <span class="req">*</span>
          </div>
          <div class="radio-group">
            <label class="radio-row" :class="{ selected: startMode === 'now' }">
              <input type="radio" value="now" v-model="startMode" />
              <div class="radio-content">
                <div class="radio-title">Bắt đầu ngay</div>
                <div class="radio-help">Mục tiêu chạy ngay khi nhấn nút bên dưới.</div>
              </div>
            </label>
            <label class="radio-row" :class="{ selected: startMode === 'scheduled' }">
              <input type="radio" value="scheduled" v-model="startMode" />
              <div class="radio-content">
                <div class="radio-title">Hẹn lịch</div>
                <div class="radio-help">Chọn một thời điểm trong tương lai (trong khung giờ chạy).</div>
                <div v-if="startMode === 'scheduled'" class="field sm schedule-field" @click.prevent>
                  <input v-model="scheduledAt" type="datetime-local" />
                </div>
              </div>
            </label>
          </div>
        </section>

        <!-- Tóm tắt cấu hình -->
        <section class="card card-pad block summary">
          <div class="block-title">
            <v-icon size="16">mdi-clipboard-check-outline</v-icon>
            Xem lại trước khi tạo
          </div>
          <div class="summary-row"><span class="sl">Tên</span><span class="sv">{{ form.name || '—' }}</span></div>
          <div class="summary-row"><span class="sl">Tệp</span><span class="sv">{{ selectedListName }}</span></div>
          <div class="summary-row"><span class="sl">Nick gửi</span><span class="sv">{{ form.nickIds.length }} nick</span></div>
          <div class="summary-row"><span class="sl">Luồng bám đuổi</span><span class="sv">{{ selectedSequenceName }}</span></div>
        </section>
      </div>

      <!-- ================== ACTION BAR ================== -->
      <div class="action-bar">
        <button class="btn btn-ghost" @click="router.back()">Huỷ</button>
        <div class="action-spacer"></div>
        <button v-if="currentStep > 1" class="btn btn-ghost" @click="goStep(currentStep - 1)">
          <v-icon size="16">mdi-arrow-left</v-icon> Quay lại
        </button>
        <button
          v-if="currentStep < 3"
          class="btn btn-primary"
          :disabled="!canNext"
          @click="goStep(currentStep + 1)"
        >
          Tiếp tục <v-icon size="16">mdi-arrow-right</v-icon>
        </button>
        <button
          v-else
          class="btn btn-primary"
          :disabled="!canSubmit || submitting"
          @click="submit"
        >
          <v-icon size="16">mdi-play</v-icon>
          {{ submitting ? 'Đang tạo...' : 'Tạo & Bắt đầu' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';

const router = useRouter();
const toast = useToast();

interface ListSummary { id: string; name: string; totalEntries: number; }
interface NickSummary { id: string; displayName: string | null; status: string; dailyFriendAddCap: number; }
interface SequenceSummary { id: string; name: string; steps: unknown; }

const lists = ref<ListSummary[]>([]);
const nicks = ref<NickSummary[]>([]);
const sequences = ref<SequenceSummary[]>([]);
const submitting = ref(false);

// ── Wizard state ──
const currentStep = ref(1);
const steps = [
  { id: 1, label: 'Tệp & Nick gửi' },
  { id: 2, label: 'Lời chào & Bám đuổi' },
  { id: 3, label: 'An toàn & Bắt đầu' },
] as const;

// ── Step 3: gửi an toàn + thời điểm bắt đầu ──
const quietHoursStart = ref('06:00');
const quietHoursEnd = ref('22:00');
const startMode = ref<'now' | 'scheduled'>('now');
const scheduledAt = ref('');

const form = ref({
  name: '',
  listId: '',
  nickIds: [] as string[],
  successorSequenceId: '',
  greetingTemplate: 'Chào {gender} {name}, em là {sale} bên dự án The Emerald Garden View. Em xin phép gửi {gender} báo giá mới nhất tháng này. Cảm ơn {gender} nhiều!',
  welcomeMessageTemplate: '',
  welcomeDelaySeconds: 60,
  skipRules: {
    recencyDays: 7,
    friendCap: 2,
    entryStatuses: [] as string[],
  },
});

// ── Per-step gating ──
const canNext = computed(() => {
  if (currentStep.value === 1) {
    return form.value.name.trim().length > 0
      && !!form.value.listId
      && form.value.nickIds.length > 0;
  }
  if (currentStep.value === 2) {
    return form.value.greetingTemplate.includes('{name}')
      && !!form.value.successorSequenceId;
  }
  return true;
});

const canSubmit = computed(() => {
  return form.value.name.trim().length > 0
    && !!form.value.listId
    && form.value.nickIds.length > 0
    && !!form.value.successorSequenceId
    && form.value.greetingTemplate.includes('{name}');
});

function goStep(target: number) {
  if (target < 1 || target > 3) return;
  // chỉ chặn khi tiến tới
  if (target > currentStep.value && !canNext.value) return;
  currentStep.value = target;
}

const greetingPreview = computed(() => {
  return form.value.greetingTemplate
    .replaceAll('{gender}', 'Chị')
    .replaceAll('{name}', 'Linh')
    .replaceAll('{sale}', 'Thành');
});

const selectedListName = computed(() => {
  const l = lists.value.find((x) => x.id === form.value.listId);
  return l ? `${l.name} (${l.totalEntries} SĐT)` : '—';
});

const selectedSequenceName = computed(() => {
  const s = sequences.value.find((x) => x.id === form.value.successorSequenceId);
  return s ? s.name : '—';
});

function stepChipClass(id: number): string {
  if (currentStep.value === id) return 'chip-blue';
  if (currentStep.value > id) return 'chip-green';
  return 'chip-grey';
}

function insertVar(v: string) {
  form.value.greetingTemplate += v;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

async function loadData() {
  try {
    const [lr, nr, sr] = await Promise.all([
      api.get('/customer-lists?status=active&limit=100'),
      api.get('/zalo-accounts'),
      api.get('/automation/sequences'),
    ]);
    lists.value = (lr.data.lists ?? []) as ListSummary[];
    nicks.value = (nr.data.accounts ?? nr.data ?? []) as NickSummary[];
    sequences.value = (sr.data.sequences ?? sr.data ?? []) as SequenceSummary[];
  } catch (err) {
    console.error('[fi-create] loadData failed', err);
  }
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const createResp = await api.post('/automation/triggers/friend-invite', {
      name: form.value.name.trim(),
      listId: form.value.listId,
      nickIds: form.value.nickIds,
      successorSequenceId: form.value.successorSequenceId,
      greetingTemplate: form.value.greetingTemplate.trim(),
      welcomeMessageTemplate: form.value.welcomeMessageTemplate.trim() || null,
      welcomeDelaySeconds: form.value.welcomeDelaySeconds,
      skipRules: form.value.skipRules,
      safetyRules: {
        quietHoursStart: quietHoursStart.value,
        quietHoursEnd: quietHoursEnd.value,
        sendIntervalSeconds: form.value.welcomeDelaySeconds,
      },
      startMode: startMode.value,
      scheduledAt: startMode.value === 'scheduled' ? scheduledAt.value || null : null,
    });
    const triggerId = createResp.data.trigger?.id;
    if (!triggerId) throw new Error('trigger id missing');

    if (startMode.value === 'now') {
      const activateResp = await api.post(`/automation/triggers/${triggerId}/activate`);
      console.log('[fi-create] activated:', activateResp.data);
    }

    router.push(`/marketing/triggers/${triggerId}`);
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string };
    toast.error('Tạo Mục tiêu thất bại: ' + (e?.response?.data?.error ?? e?.message ?? 'Có lỗi xảy ra, thử lại sau.'), 5000);
  } finally {
    submitting.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
/* ════════════════════════════════════════════════════════════
   Tạo Mục tiêu — Tự động kết bạn (FriendInviteCreateView)
   Atlas HS Holding re-skin 2026-06-06 · wizard 3 bước.
   Scaffold .mkt-top / .mkt-body từ hs-crm-theme.css. Token hoá hoàn toàn.
   ════════════════════════════════════════════════════════════ */
.fi-create { background: var(--surface-2); min-height: 100%; }
.mkt-top .actions { display: flex; gap: 8px; }
.mkt-body { max-width: 760px; }

/* ───── Thanh chip bước ───── */
.step-chips { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.step-chips .chip {
  height: 30px; padding: 0 13px; font-size: 12.5px; cursor: pointer;
  border: 1px solid transparent;
}
.step-chips .chip.chip-blue { box-shadow: inset 0 0 0 1px var(--brand-soft); }
.step-chips .chip.chip-grey { border-color: var(--line); }
.step-chips .step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 17px; height: 17px; border-radius: 50%;
  background: rgba(255, 255, 255, .6); font-size: 11px; font-weight: 700;
}
.step-chips .chip-grey .step-num { background: var(--surface); }

/* ───── Khối card ───── */
.step-pane { display: flex; flex-direction: column; gap: 12px; }
.block { padding: 16px 18px; }
.block-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; color: var(--ink);
  margin-bottom: 12px;
}
.block-title .v-icon { color: var(--brand); }
.block-title .req { color: var(--error); }
.count-chip { margin-left: auto; height: 20px; }
.block-help {
  font-size: 12px; color: var(--ink-3); line-height: 1.5;
  margin: -4px 0 12px; padding: 8px 11px;
  background: var(--brand-softer); border-left: 3px solid var(--brand-soft);
  border-radius: 0 var(--r-xs) var(--r-xs) 0;
}

/* ───── Textarea ───── */
.ta {
  width: 100%; padding: 10px 12px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-sm); color: var(--ink);
  font-size: 13.5px; font-family: inherit;
  resize: vertical; min-height: 78px;
  transition: border-color .14s, box-shadow .14s;
}
.ta:focus { outline: 0; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.ta::placeholder { color: var(--ink-4); }

/* ───── Hint + biến ───── */
.hint {
  font-size: 11.5px; color: var(--ink-3); margin-top: 9px;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
}
.hint.inline-hint { margin: 0; }
.var-pill {
  height: 21px; cursor: pointer; font-family: var(--mono);
  font-size: 11px; border: 0;
}

/* ───── Preview lời chào ───── */
.preview {
  margin-top: 11px; padding: 10px 12px;
  background: var(--surface-2); border-left: 3px solid var(--brand);
  border-radius: 0 var(--r-xs) var(--r-xs) 0;
  font-size: 13px; font-style: italic; line-height: 1.5; color: var(--ink-2);
}
.preview-label { font-style: normal; font-size: 10.5px; font-weight: 700; color: var(--ink-4); margin-bottom: 4px; }

/* ───── Danh sách nick ───── */
.nick-list {
  max-height: 280px; overflow-y: auto;
  border: 1px solid var(--line); border-radius: var(--r-sm);
}
.nick-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-bottom: 1px solid var(--line-2); cursor: pointer;
}
.nick-item:last-child { border-bottom: 0; }
.nick-item.is-selected { background: var(--brand-softer); }
.nick-item input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--brand); flex: none; }
.nick-info { flex: 1; min-width: 0; }
.nick-name { font-size: 13px; font-weight: 600; color: var(--ink); }
.nick-meta { font-size: 11.5px; color: var(--ink-3); margin-top: 1px; display: flex; align-items: center; gap: 5px; }
.nick-meta .status { font-size: 11.5px; font-weight: 500; }
.empty-hint { padding: 18px; text-align: center; font-size: 12.5px; color: var(--ink-4); }

/* ───── Rule rows ───── */
.rule {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 0; font-size: 13px; color: var(--ink-2);
}
.rule-ico {
  width: 24px; height: 24px; flex: none;
  background: var(--brand-soft); color: var(--brand);
  border-radius: var(--r-xs);
  display: flex; align-items: center; justify-content: center;
}
.num-field { width: 78px; }
.num-field.wide { width: 92px; }
.time-field { width: 110px; }
.num-field input, .time-field input { text-align: center; }
.time-arrow { color: var(--ink-4); }

/* ───── Delay row (welcome) ───── */
.delay-row {
  margin-top: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px; color: var(--ink-2);
}
.delay-row .v-icon { color: var(--brand); }

/* ───── Welcome info ───── */
.welcome-info {
  margin-top: 11px; padding: 9px 12px;
  display: flex; align-items: flex-start; gap: 7px;
  background: var(--warning-soft); border: 1px solid #f4cf8f;
  border-radius: var(--r-sm); font-size: 12px; color: #b45309; line-height: 1.5;
}
.welcome-info .v-icon { color: var(--warning); margin-top: 1px; flex: none; }

/* ───── Radio group (start mode) ───── */
.radio-group { display: flex; flex-direction: column; gap: 9px; }
.radio-row {
  display: flex; gap: 10px; padding: 12px 14px;
  border: 1px solid var(--line); border-radius: var(--r-md); cursor: pointer;
  transition: border-color .14s, background .14s;
}
.radio-row:hover { border-color: var(--brand-soft); }
.radio-row.selected { border-color: var(--brand); background: var(--brand-softer); }
.radio-row input[type="radio"] { width: 16px; height: 16px; accent-color: var(--brand); flex: none; margin-top: 2px; }
.radio-content { flex: 1; min-width: 0; }
.radio-title { font-size: 13px; font-weight: 600; color: var(--ink); }
.radio-help { font-size: 12px; color: var(--ink-3); margin-top: 3px; }
.schedule-field { width: 220px; margin-top: 8px; }

/* ───── Summary ───── */
.summary .summary-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0; border-bottom: 1px solid var(--line-2); font-size: 13px;
}
.summary .summary-row:last-child { border-bottom: 0; }
.summary .sl { width: 130px; flex: none; color: var(--ink-3); font-size: 12.5px; }
.summary .sv { color: var(--ink); font-weight: 600; }

/* ───── Action bar ───── */
.action-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 18px 0 8px; margin-top: 8px;
}
.action-spacer { flex: 1; }
</style>
