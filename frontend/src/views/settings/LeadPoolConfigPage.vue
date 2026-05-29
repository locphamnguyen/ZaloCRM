<!--
  LeadPoolConfigPage — Phase Lead Pool 2026-05-24.
  Admin config tính năng Nhận Lead. Spec: docs/DESIGN-LEAD-POOL.md
-->
<template>
  <div class="lpc-page">
    <header class="lpc-head">
      <h1>🎁 Nhận Lead — Cấu hình</h1>
      <p class="lpc-sub">
        Bật cho sale rảnh tự xin lead bị bỏ rơi từ pool. Hệ thống ưu tiên các KH lâu không tương tác,
        tránh chia KH "Nóng / Tiềm năng / Đã chốt" để giữ relationship sale đang chăm.
      </p>
    </header>

    <div v-if="loading" class="lpc-loading">Đang tải...</div>

    <template v-else>
      <!-- Master toggle -->
      <section class="lpc-card">
        <div class="lpc-toggle-row">
          <div>
            <h3>Tính năng Nhận Lead</h3>
            <p class="lpc-detail">Khi tắt, sale sẽ không thấy FAB "Nhận Lead" trong Chat.</p>
          </div>
          <label class="lpc-switch">
            <input type="checkbox" v-model="form.enabled" @change="onSave" />
            <span class="lpc-slider"></span>
          </label>
        </div>
      </section>

      <!-- Quota + cooldown -->
      <section class="lpc-card">
        <h3>📊 Giới hạn</h3>
        <div class="lpc-grid">
          <label class="lpc-field">
            <span>Giới hạn / sale / ngày</span>
            <input type="number" min="1" max="100" v-model.number="form.maxRequestsPerDay" @blur="onSave" />
          </label>
          <label class="lpc-field">
            <span>Cooldown giữa 2 lần (phút)</span>
            <input type="number" min="0" max="180" v-model.number="form.cooldownMinutes" @blur="onSave" />
          </label>
          <label class="lpc-field">
            <span>"Lãng quên" sau (ngày)</span>
            <input type="number" min="1" max="365" v-model.number="form.forgottenThresholdDays" @blur="onSave" />
            <small>KH có lastActivity > X ngày → vào pool</small>
          </label>
          <label class="lpc-field">
            <span>Auto trả về pool sau (phút)</span>
            <div class="lpc-minutes-row">
              <input type="number" min="30" max="10080" step="30" v-model.number="form.autoReturnAfterMinutes" @blur="onSave" />
              <span class="lpc-minutes-hint">≈ {{ formatMinutes(form.autoReturnAfterMinutes) }}</span>
            </div>
            <small>30 phút (rotate nhanh) → 10080 phút (7 ngày). Sale rảnh chờ lâu = sale bận giữ lead.</small>
            <div class="lpc-preset-row">
              <button v-for="p in PRESET_MINUTES" :key="p.value" type="button" class="lpc-preset" @click="applyMinutesPreset(p.value)">
                {{ p.label }}
              </button>
            </div>
          </label>
        </div>
      </section>

      <!-- Require phone -->
      <section class="lpc-card">
        <div class="lpc-toggle-row">
          <div>
            <h3>Bắt buộc lead có SĐT mới vào pool</h3>
            <p class="lpc-detail">
              Lead chỉ có UID Zalo (không phone) — UID là của sale cũ, sale mới không liên lạc được.
              Bật để chỉ chia lead có phone (sale mới có thể gọi điện hoặc tìm Zalo qua phone).
            </p>
          </div>
          <label class="lpc-switch">
            <input type="checkbox" v-model="form.requirePhoneInPool" @change="onSave" />
            <span class="lpc-slider"></span>
          </label>
        </div>
      </section>

      <!-- Force note -->
      <section class="lpc-card">
        <div class="lpc-toggle-row">
          <div>
            <h3>Bắt buộc ghi note trước khi xin lead mới</h3>
            <p class="lpc-detail">Chống sale lười không chăm KH đã nhận.</p>
          </div>
          <label class="lpc-switch">
            <input type="checkbox" v-model="form.forceNoteBeforeNext" @change="onSave" />
            <span class="lpc-slider"></span>
          </label>
        </div>
        <div v-if="form.forceNoteBeforeNext" class="lpc-grid lpc-grid-narrow">
          <label class="lpc-field">
            <span>Note tối thiểu (ký tự)</span>
            <input type="number" min="5" max="500" v-model.number="form.noteMinLength" @blur="onSave" />
          </label>
        </div>
      </section>

      <!-- Cooldown sau note (Phase v2.B 2026-05-29) -->
      <section class="lpc-card">
        <h3>🔒 Khoá pool sau khi note (ngày)</h3>
        <p class="lpc-detail">
          Sau khi sale ghi note xong, khách hàng này <b>KHÔNG xuất hiện trong pool</b> của bất kỳ
          sale nào trong N ngày. Chống spam chia lại 1 lead cho nhiều sale, hoặc sale gốc tự xin lại
          chính KH mình vừa chăm.
        </p>
        <p class="lpc-detail" style="margin-top:6px;">
          <b>Sale gốc vẫn giữ quyền chăm KH bình thường</b> — chỉ pool ngừng chia lại lead này.
          Ngoại lệ: sale bấm <i>"Trả lại pool"</i> → bypass cooldown, vào pool ngay.
        </p>
        <div class="lpc-grid lpc-grid-narrow">
          <label class="lpc-field">
            <span>Khoá pool (ngày)</span>
            <input type="number" min="0" max="365" v-model.number="form.cooldownAfterNoteDays" @blur="onSave" />
            <small>0 = tắt khoá. Default 30 ngày. Sau N ngày → lead vào lại pool, sale khác có cơ hội chăm.</small>
          </label>
        </div>
      </section>

      <!-- Excluded statuses -->
      <section class="lpc-card">
        <h3>🚫 Trạng thái KHÔNG vào pool (giữ cho sale đang chăm)</h3>
        <p class="lpc-detail">Sale đang chăm KH Nóng/Tiềm năng/Đã chốt được giữ relationship.</p>
        <div class="lpc-chips">
          <label v-for="opt in STATUS_OPTIONS" :key="opt.value" class="lpc-chip">
            <input
              type="checkbox"
              :value="opt.value"
              v-model="form.excludedStatuses"
              @change="onSave"
            />
            <span>{{ opt.icon }} {{ opt.label }}</span>
          </label>
        </div>
      </section>

      <!-- Sources -->
      <section class="lpc-card">
        <h3>📥 Nguồn lead</h3>
        <div class="lpc-chips">
          <label v-for="opt in SOURCE_OPTIONS" :key="opt.value" class="lpc-chip">
            <input
              type="checkbox"
              :value="opt.value"
              v-model="form.enabledSources"
              :disabled="opt.disabled"
              @change="onSave"
            />
            <span>{{ opt.icon }} {{ opt.label }}</span>
            <small v-if="opt.note">{{ opt.note }}</small>
          </label>
        </div>
      </section>

      <!-- Greeting templates -->
      <section class="lpc-card">
        <h3>💬 Câu chào gợi ý khi mở Lead</h3>
        <p class="lpc-detail">
          Sale mở modal Lead sẽ thấy danh sách câu chào — chọn 1 câu để copy vào chat Zalo.
          Tối đa 10 câu, mỗi câu ≤ 500 ký tự. Để trống hết → hệ thống dùng 3 câu mặc định.
        </p>
        <div class="lpc-placeholder-box">
          <div class="lpc-placeholder-title">📌 Placeholder được hỗ trợ:</div>
          <ul class="lpc-placeholder-list">
            <li><code>{anh_chi}</code> → <b>Anh</b> / <b>Chị</b> / <b>Anh/Chị</b> (đầu câu, viết hoa)</li>
            <li><code>{ac}</code> → <b>anh</b> / <b>chị</b> / <b>anh/chị</b> (giữa câu, viết thường)</li>
            <li><code>{ten_kh}</code> → Tên riêng KH (Vd: "Tran" cho "Tram Tran")</li>
            <li><code>{ten_em}</code> → Tên riêng của em sale (Vd: "Thành" cho "Phạm Chí Thành")</li>
          </ul>
        </div>
        <div class="lpc-template-list">
          <div v-for="(_, idx) in form.greetingTemplates" :key="idx" class="lpc-template-row">
            <span class="lpc-template-num">#{{ idx + 1 }}</span>
            <textarea
              v-model="form.greetingTemplates[idx]"
              rows="3"
              maxlength="500"
              class="lpc-template-textarea"
              placeholder="Vd: Chào {anh_chi} {ten_kh}, em {ten_em} đây ạ. {ac} còn quan tâm dự án không?"
              @blur="onSaveTemplates"
            />
            <button type="button" class="lpc-template-del" :title="'Xoá câu ' + (idx + 1)" @click="removeTemplate(idx)">✕</button>
          </div>
          <button
            v-if="form.greetingTemplates.length < 10"
            type="button"
            class="lpc-template-add"
            @click="addTemplate"
          >
            + Thêm câu chào
          </button>
        </div>
        <div v-if="form.greetingTemplates.length === 0" class="lpc-template-empty">
          <small>Đang dùng 3 câu mặc định (hệ thống). Bấm "+ Thêm câu chào" để thay bằng câu riêng.</small>
          <button type="button" class="lpc-template-seed" @click="seedDefaultTemplates">📋 Copy 3 câu mặc định vào để sửa</button>
        </div>
      </section>

      <div v-if="saveStatus === 'saved'" class="lpc-toast lpc-toast-ok">✓ Đã lưu</div>
      <div v-if="saveStatus === 'error'" class="lpc-toast lpc-toast-err">⚠ {{ saveError }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';

const STATUS_OPTIONS = [
  { value: 'hot', label: 'Nóng', icon: '🔥' },
  { value: 'potential', label: 'Tiềm năng', icon: '💎' },
  { value: 'won', label: 'Đã chốt', icon: '✅' },
  { value: 'interested', label: 'Quan tâm', icon: '🟡' },
  { value: 'contacted', label: 'Đã liên hệ', icon: '🔵' },
  { value: 'cold', label: 'Lạnh', icon: '❄️' },
];

const SOURCE_OPTIONS = [
  { value: 'forgotten', label: 'Khách bị lãng quên', icon: '💤', disabled: false, note: '' },
  { value: 'customer_list', label: 'Tệp khách hàng (CustomerList có shareable=true)', icon: '📂', disabled: false, note: '' },
  { value: 'external_sync', label: 'Đồng bộ Getfly', icon: '🔄', disabled: true, note: 'Phase sau' },
];

const PRESET_MINUTES = [
  { label: '30 phút', value: 30 },
  { label: '1 giờ', value: 60 },
  { label: '4 giờ', value: 240 },
  { label: '8 giờ', value: 480 },
  { label: '1 ngày', value: 1440 },
  { label: '3 ngày', value: 4320 },
  { label: '7 ngày', value: 10080 },
];

function formatMinutes(m: number): string {
  if (!m || m < 0) return '';
  if (m < 60) return `${m} phút`;
  if (m < 1440) {
    const h = Math.floor(m / 60); const r = m % 60;
    return r > 0 ? `${h}h ${r}m` : `${h} giờ`;
  }
  const d = Math.floor(m / 1440); const rh = Math.floor((m % 1440) / 60);
  return rh > 0 ? `${d} ngày ${rh}h` : `${d} ngày`;
}

const DEFAULT_GREETING_SEEDS = [
  'Chào {anh_chi} {ten_kh}, em {ten_em} bên CSKH dự án đây ạ. Em vừa nhận tiếp tài khoản của {ac}, em xem lại thấy {ac} từng quan tâm bên em. Hiện {ac} còn đang tìm hiểu không ạ?',
  'Chào {anh_chi} {ten_kh}, em {ten_em} đây ạ. Lâu rồi bên em chưa cập nhật thông tin mới cho {ac} — bên em vừa có update mới, em gửi {ac} tham khảo nhé?',
  'Chào {anh_chi} {ten_kh}, em {ten_em} bên dự án đây ạ. Dạo này {ac} ổn không? Em có ít ưu đãi mới bên em vừa ra, lúc nào {ac} tiện em chia sẻ ngắn ạ.',
];

const loading = ref(true);
const form = ref({
  enabled: true,
  maxRequestsPerDay: 10,
  cooldownMinutes: 15,
  forgottenThresholdDays: 30,
  excludedStatuses: ['hot', 'potential', 'won'] as string[],
  autoReturnAfterMinutes: 1440,
  requirePhoneInPool: true,
  forceNoteBeforeNext: true,
  enabledSources: ['forgotten', 'customer_list'] as string[],
  noteMinLength: 20,
  cooldownAfterNoteDays: 30,
  greetingTemplates: [] as string[],
});

function applyMinutesPreset(value: number) {
  form.value.autoReturnAfterMinutes = value;
  onSave();
}

const saveStatus = ref<'' | 'saved' | 'error'>('');
const saveError = ref('');
let saveTimer: number | null = null;

async function fetchConfig() {
  loading.value = true;
  try {
    const { data } = await api.get('/lead-pool/config');
    form.value = {
      enabled: data.enabled,
      maxRequestsPerDay: data.maxRequestsPerDay,
      cooldownMinutes: data.cooldownMinutes,
      forgottenThresholdDays: data.forgottenThresholdDays,
      excludedStatuses: data.excludedStatuses ?? ['hot', 'potential', 'won'],
      autoReturnAfterMinutes: data.autoReturnAfterMinutes ?? 1440,
      requirePhoneInPool: data.requirePhoneInPool ?? true,
      forceNoteBeforeNext: data.forceNoteBeforeNext,
      enabledSources: data.enabledSources ?? ['forgotten', 'customer_list'],
      noteMinLength: data.noteMinLength,
      cooldownAfterNoteDays: data.cooldownAfterNoteDays ?? 30,
      greetingTemplates: Array.isArray(data.greetingTemplates) ? data.greetingTemplates : [],
    };
  } catch (err: any) {
    saveError.value = err?.response?.data?.error || 'Load config thất bại';
    saveStatus.value = 'error';
  } finally {
    loading.value = false;
  }
}

async function onSave() {
  saveStatus.value = '';
  try {
    await api.patch('/lead-pool/config', { ...form.value });
    saveStatus.value = 'saved';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveStatus.value = ''; }, 2000);
  } catch (err: any) {
    saveError.value = err?.response?.data?.error || 'Lưu thất bại';
    saveStatus.value = 'error';
  }
}

function addTemplate() {
  if (form.value.greetingTemplates.length >= 10) return;
  form.value.greetingTemplates.push('');
}
function removeTemplate(idx: number) {
  form.value.greetingTemplates.splice(idx, 1);
  onSaveTemplates();
}
function seedDefaultTemplates() {
  form.value.greetingTemplates = [...DEFAULT_GREETING_SEEDS];
  onSaveTemplates();
}
async function onSaveTemplates() {
  // Trim + bỏ rỗng trước khi gửi BE (BE validate y vậy)
  const cleaned = form.value.greetingTemplates.map((s) => s.trim()).filter((s) => s.length > 0);
  saveStatus.value = '';
  try {
    await api.patch('/lead-pool/config', { greetingTemplates: cleaned });
    saveStatus.value = 'saved';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveStatus.value = ''; }, 2000);
  } catch (err: any) {
    saveError.value = err?.response?.data?.error || 'Lưu câu chào thất bại';
    saveStatus.value = 'error';
  }
}

onMounted(fetchConfig);
</script>

<style scoped>
.lpc-page { max-width: 800px; padding: 24px 4px; display: flex; flex-direction: column; gap: 16px; }

.lpc-head { padding-bottom: 8px; border-bottom: 1px solid #E5E7EB; }
.lpc-head h1 { margin: 0; font-size: 22px; font-weight: 700; color: #0F172A; }
.lpc-sub { margin: 6px 0 0; font-size: 13.5px; color: #475569; line-height: 1.6; max-width: 720px; }

.lpc-loading { padding: 40px; text-align: center; color: #94A3B8; }

.lpc-card {
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 14px;
  padding: 18px 22px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.lpc-card h3 { margin: 0; font-size: 15px; font-weight: 700; color: #0F172A; }
.lpc-detail { margin: 4px 0 0; font-size: 12.5px; color: #64748B; }

.lpc-toggle-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }

.lpc-switch { position: relative; display: inline-block; width: 48px; height: 26px; flex-shrink: 0; }
.lpc-switch input { opacity: 0; width: 0; height: 0; }
.lpc-slider {
  position: absolute; inset: 0;
  background: #D1D5DB;
  border-radius: 9999px;
  cursor: pointer;
  transition: background 0.2s;
}
.lpc-slider::before {
  content: ''; position: absolute;
  width: 20px; height: 20px;
  top: 3px; left: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.lpc-switch input:checked + .lpc-slider { background: #5E6AD2; }
.lpc-switch input:checked + .lpc-slider::before { transform: translateX(22px); }

.lpc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.lpc-grid-narrow { grid-template-columns: 1fr; max-width: 280px; }
.lpc-field {
  display: flex; flex-direction: column; gap: 4px;
}
.lpc-field span {
  font-size: 12.5px; font-weight: 600; color: #374151;
}
.lpc-field input {
  padding: 9px 12px;
  border: 1.5px solid #E5E7EB;
  border-radius: 8px;
  font-size: 14px; font-family: inherit;
  outline: none;
}
.lpc-field input:focus { border-color: #5E6AD2; }
.lpc-field small { font-size: 11.5px; color: #94A3B8; }

.lpc-minutes-row { display: flex; align-items: center; gap: 10px; }
.lpc-minutes-row input { flex: 0 0 130px; }
.lpc-minutes-hint { font-size: 12.5px; color: #5E6AD2; font-weight: 600; }

.lpc-preset-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.lpc-preset {
  background: #F1F5F9; color: #475569;
  border: 1px solid #E5E7EB; border-radius: 6px;
  padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; font-family: inherit;
  transition: background 0.15s;
}
.lpc-preset:hover { background: #EEF0FF; color: #5E6AD2; border-color: #C7D2FE; }

.lpc-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.lpc-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  background: #F8FAFC;
  border: 1.5px solid #E5E7EB;
  border-radius: 9999px;
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s, background 0.15s;
}
.lpc-chip:hover { border-color: #C7D2FE; background: #EEF0FF; }
.lpc-chip input { margin: 0; }
.lpc-chip input:checked ~ span { font-weight: 700; }
.lpc-chip:has(input:checked) { border-color: #5E6AD2; background: #EEF0FF; }
.lpc-chip small { color: #94A3B8; font-style: italic; margin-left: 4px; }

.lpc-toast {
  position: fixed; bottom: 24px; right: 24px;
  padding: 10px 18px; border-radius: 9px;
  font-size: 13px; font-weight: 600;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 90;
}
.lpc-toast-ok { background: #DCFCE7; color: #166534; border: 1px solid #86EFAC; }
.lpc-toast-err { background: #FEF2F2; color: #B91C1C; border: 1px solid #FCA5A5; }

/* Greeting templates */
.lpc-placeholder-box { background: #F0F9FF; border: 1px solid #BAE6FD; border-radius: 8px; padding: 10px 12px; margin: 10px 0 14px; }
.lpc-placeholder-title { font-size: 12px; font-weight: 700; color: #0369A1; margin-bottom: 6px; }
.lpc-placeholder-list { margin: 0; padding-left: 18px; font-size: 12px; color: #075985; line-height: 1.7; }
.lpc-placeholder-list code { background: #E0F2FE; color: #0C4A6E; padding: 1px 5px; border-radius: 3px; font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.lpc-placeholder-list b { color: #0F172A; }
.lpc-template-list { display: flex; flex-direction: column; gap: 8px; }
.lpc-template-row { display: grid; grid-template-columns: 32px 1fr 32px; gap: 8px; align-items: start; }
.lpc-template-num { color: #64748B; font-weight: 700; font-size: 12px; padding-top: 8px; text-align: center; }
.lpc-template-textarea { width: 100%; padding: 8px 10px; border: 1px solid #CBD5E1; border-radius: 6px; font-family: inherit; font-size: 13px; resize: vertical; min-height: 60px; box-sizing: border-box; }
.lpc-template-textarea:focus { outline: 2px solid #3B82F6; outline-offset: -1px; border-color: transparent; }
.lpc-template-del { background: #FEF2F2; color: #B91C1C; border: 1px solid #FCA5A5; border-radius: 6px; cursor: pointer; font-size: 12px; height: 32px; transition: background 0.15s; }
.lpc-template-del:hover { background: #FECACA; }
.lpc-template-add { margin-top: 4px; padding: 8px 14px; background: #EEF2FF; color: #4338CA; border: 1px dashed #C7D2FE; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: background 0.15s; }
.lpc-template-add:hover { background: #E0E7FF; }
.lpc-template-empty { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; padding: 10px 0; color: #64748B; }
.lpc-template-seed { padding: 6px 12px; background: white; color: #4338CA; border: 1px solid #C7D2FE; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; }
.lpc-template-seed:hover { background: #EEF2FF; }
</style>
