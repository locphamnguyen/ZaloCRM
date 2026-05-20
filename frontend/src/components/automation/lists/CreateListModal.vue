<template>
  <div v-if="modelValue" class="modal-overlay" @click.self="$emit('update:modelValue', false)">
    <div class="modal">
      <div class="modal-head">
        <h3>📥 Tạo tệp khách hàng mới</h3>
        <button class="x" @click="$emit('update:modelValue', false)">✕</button>
      </div>
      <div class="modal-body">
        <!-- Tên + Icon -->
        <div class="field-row">
          <div class="field" style="flex:1">
            <label>Tên tệp</label>
            <input v-model="name" placeholder="VD: Lead Vinhomes Grand Park — Tháng 5" />
            <div class="hint">Để trống → auto đặt "Tệp {{ defaultName }}"</div>
          </div>
        </div>
        <div class="field">
          <label>Icon</label>
          <div class="icon-picker">
            <button
              v-for="ic in ICON_CHOICES"
              :key="ic"
              type="button"
              class="icon-btn"
              :class="{ active: iconEmoji === ic }"
              @click="iconEmoji = ic"
            >{{ ic }}</button>
          </div>
        </div>

        <!-- Tab nav -->
        <div class="tab-nav">
          <button
            v-for="t in TABS" :key="t.key"
            class="tab-btn"
            :class="{ active: activeTab === t.key }"
            @click="activeTab = t.key"
          >
            <span>{{ t.icon }}</span> {{ t.label }}
          </button>
        </div>

        <!-- ───── TAB PASTE ───── -->
        <div v-if="activeTab === 'paste'">
          <div class="field">
            <label>
              Danh sách SĐT (mỗi dòng 1 SĐT, có thể kèm tên)
              <span class="info-pill" title="Định dạng: SĐT trước, tên sau. KHÔNG có ghi chú riêng — nếu cần lời mời/tin nhắn riêng cho từng KH, dùng tab CSV/Excel.">
                ℹ️ SĐT trước, tên sau
              </span>
            </label>
            <textarea
              v-model="rawText"
              placeholder="0908 123 456&#10;0987-654-321 Nguyễn Văn A&#10;+84.938.111.222&#10;0913 445 566   Chị Lan VinGroup&#10;0976 333 444"
              @input="onRawTextInput"
            ></textarea>
            <div class="hint">
              Hệ thống tự nhận diện SĐT đúng/sai, dedup, lookup Zalo. Prefix <code>p:</code> / <code>tel:</code> sẽ được strip tự động.
            </div>
          </div>
        </div>

        <!-- ───── TAB EXCEL / CSV (cùng UI, khác accept) ───── -->
        <div v-if="activeTab === 'excel' || activeTab === 'csv'">
          <!-- Step 1: chọn file -->
          <div v-if="!fileRows.length" class="field">
            <label>{{ activeTab === 'excel' ? 'Upload Excel (.xlsx, .xls)' : 'Upload CSV (.csv)' }}</label>
            <div
              class="dropzone"
              :class="{ dragover: isDragOver }"
              @click="triggerFilePicker"
              @dragover.prevent="isDragOver = true"
              @dragleave.prevent="isDragOver = false"
              @drop.prevent="onFileDrop"
            >
              <input
                ref="filePickerRef"
                type="file"
                :accept="acceptForTab"
                style="display:none"
                @change="onFilePick"
              />
              <div class="dz-icon">{{ activeTab === 'excel' ? '📊' : '📄' }}</div>
              <div class="dz-title">Kéo thả file vào đây hoặc <u>chọn file</u></div>
              <div class="dz-sub">
                {{ activeTab === 'excel' ? '.xlsx hoặc .xls' : '.csv (UTF-8 khuyến nghị)' }} — tối đa 10MB
              </div>
              <div v-if="fileError" class="dz-error">⚠️ {{ fileError }}</div>
            </div>
          </div>

          <!-- Step 2: column mapping -->
          <div v-if="fileRows.length">
            <div class="file-meta">
              <span>📄 <b>{{ fileName }}</b></span>
              <span class="dot">·</span>
              <span>{{ fileRows.length }} dòng</span>
              <span class="dot">·</span>
              <button class="link-btn" @click="resetFile">Chọn file khác</button>
            </div>

            <div class="field">
              <label>Ghép cột (chỉ cần SĐT là bắt buộc)</label>
              <div class="map-grid">
                <div class="map-cell">
                  <span class="map-label">📞 SĐT <em>*</em></span>
                  <select v-model="mapping.phone">
                    <option :value="null" disabled>— Chọn cột —</option>
                    <option v-for="(h, i) in fileHeaders" :key="'p'+i" :value="i">{{ h || `Cột ${i+1}` }}</option>
                  </select>
                </div>
                <div class="map-cell">
                  <span class="map-label">👤 Tên KH</span>
                  <select v-model="mapping.name">
                    <option :value="null">— Không map —</option>
                    <option v-for="(h, i) in fileHeaders" :key="'n'+i" :value="i">{{ h || `Cột ${i+1}` }}</option>
                  </select>
                </div>
                <div class="map-cell">
                  <span class="map-label">💬 Lời mời / tin nhắn riêng</span>
                  <select v-model="mapping.note">
                    <option :value="null">— Không map —</option>
                    <option v-for="(h, i) in fileHeaders" :key="'g'+i" :value="i">{{ h || `Cột ${i+1}` }}</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Preview 5 row sau khi mapping -->
            <div v-if="mapping.phone != null" class="preview-table-wrap">
              <table class="preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>SĐT</th>
                    <th>Tên</th>
                    <th>Lời mời / tin nhắn</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, i) in previewRows" :key="i">
                    <td>{{ i + 1 }}</td>
                    <td><code>{{ r.phone }}</code></td>
                    <td>{{ r.name || '—' }}</td>
                    <td class="note-cell">{{ r.personalNote || '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="fileRows.length > 5" class="hint" style="margin-top:6px">
                Hiển thị 5/{{ fileRows.length }} dòng đầu. Toàn bộ sẽ được import sau khi bấm "Tạo tệp".
              </div>
            </div>
          </div>
        </div>

        <!-- ───── Dry-run preview chung ───── -->
        <div v-if="dryRunResult" class="parse-preview">
          <div class="pp-row">
            <span class="ico">📋</span> Đã nhận diện <b>{{ dryRunResult.total }} dòng</b>
          </div>
          <div class="pp-row" style="color:#047857">
            <span class="ico">✓</span> <b>{{ dryRunResult.valid }} SĐT</b> hợp lệ
          </div>
          <div v-if="dryRunResult.invalid > 0" class="pp-row" style="color:#B91C1C">
            <span class="ico">✗</span> <b>{{ dryRunResult.invalid }} dòng</b> bỏ qua (sai format / khác VN)
          </div>
          <div v-if="dryRunResult.dupInList > 0" class="pp-row" style="color:#B45309">
            <span class="ico">↺</span> <b>{{ dryRunResult.dupInList }} SĐT</b> trùng trong cùng danh sách
          </div>
          <div v-if="dryRunResult.dupCrossList > 0" class="pp-row" style="color:#B45309">
            <span class="ico">↔</span> <b>{{ dryRunResult.dupCrossList }} SĐT</b> trùng với tệp khác trong tổ chức
          </div>
          <div v-if="dryRunResult.dupWithCrm > 0" class="pp-row" style="color:#B45309">
            <span class="ico">⚷</span> <b>{{ dryRunResult.dupWithCrm }} SĐT</b> trùng với Contact hiện có trong CRM
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <span class="left">Sau khi tạo, hệ thống async lookup UID Zalo qua zalo-pool (không chặn UI).</span>
        <div class="right">
          <button class="btn ghost" @click="$emit('update:modelValue', false)">Huỷ</button>
          <button
            class="btn primary"
            :disabled="!canSubmit || submitting"
            @click="onSubmit"
          >{{ submitting ? 'Đang tạo...' : 'Tạo tệp' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import * as XLSX from 'xlsx';
import { useCustomerLists, type DryRunResult, type MappedRow } from '@/composables/use-customer-lists';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'created', payload: { id: string }): void;
}>();

const { dryRun, createList } = useCustomerLists();

// ───────── Form fields ─────────
const name = ref('');
const iconEmoji = ref<string | null>(null);
const submitting = ref(false);
const dryRunResult = ref<DryRunResult | null>(null);

const ICON_CHOICES = ['🏢', '📣', '❄️', '🌊', '📋', '🎪', '📱', '🎵', '🔥', '⭐'];

const TABS = [
  { key: 'paste' as const, label: 'Paste danh sách', icon: '📋', accept: '' },
  { key: 'excel' as const, label: 'Upload Excel',    icon: '📊', accept: '.xlsx,.xls' },
  { key: 'csv'   as const, label: 'Upload CSV',      icon: '📄', accept: '.csv' },
];
type TabKey = 'paste' | 'excel' | 'csv';
const activeTab = ref<TabKey>('paste');

const acceptForTab = computed(() => {
  const t = TABS.find((x) => x.key === activeTab.value);
  return t?.accept ?? '';
});

const defaultName = computed(() => {
  const d = new Date();
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
});

// ───────── Tab paste ─────────
const rawText = ref('');
let dryRunTimer: ReturnType<typeof setTimeout> | null = null;
function onRawTextInput() {
  if (dryRunTimer) clearTimeout(dryRunTimer);
  if (!rawText.value.trim()) {
    dryRunResult.value = null;
    return;
  }
  dryRunTimer = setTimeout(async () => {
    dryRunResult.value = await dryRun(rawText.value);
  }, 400);
}

// ───────── Tab file ─────────
const filePickerRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const fileError = ref<string | null>(null);
const fileName = ref('');
const fileHeaders = ref<string[]>([]);
const fileRows = ref<string[][]>([]);
const mapping = ref<{ phone: number | null; name: number | null; note: number | null }>({
  phone: null, name: null, note: null,
});

function triggerFilePicker() { filePickerRef.value?.click(); }
function onFilePick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) handleFile(file);
}
function onFileDrop(e: DragEvent) {
  isDragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
}

async function handleFile(file: File) {
  fileError.value = null;
  if (file.size > 10 * 1024 * 1024) {
    fileError.value = 'File > 10MB. Vui lòng tách nhỏ và upload lại.';
    return;
  }
  // Validate extension theo tab đang active
  const lo = file.name.toLowerCase();
  if (activeTab.value === 'excel' && !(lo.endsWith('.xlsx') || lo.endsWith('.xls'))) {
    fileError.value = 'Tab này chỉ nhận .xlsx / .xls. Đổi sang tab CSV nếu file là .csv.';
    return;
  }
  if (activeTab.value === 'csv' && !lo.endsWith('.csv')) {
    fileError.value = 'Tab này chỉ nhận .csv. Đổi sang tab Excel nếu file là .xlsx / .xls.';
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' }) as any[][];
    if (!arr.length) {
      fileError.value = 'File rỗng.';
      return;
    }
    // Heuristic: dòng đầu là header nếu KHÔNG có cell nào parse được thành SĐT
    const firstRow = arr[0].map((c) => String(c ?? '').trim());
    const looksHeader = firstRow.some((c) => /^[A-Za-zÀ-ỹĐđ\s]+$/.test(c) && c.length > 0 && c.length < 40);
    let headers: string[];
    let rows: string[][];
    if (looksHeader) {
      headers = firstRow;
      rows = arr.slice(1).map((r) => r.map((c) => String(c ?? '').trim()));
    } else {
      headers = firstRow.map((_, i) => `Cột ${i + 1}`);
      rows = arr.map((r) => r.map((c) => String(c ?? '').trim()));
    }
    // Strip trailing empty rows
    while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
    if (!rows.length) {
      fileError.value = 'Không có dòng dữ liệu sau header.';
      return;
    }

    fileName.value = file.name;
    fileHeaders.value = headers;
    fileRows.value = rows;
    autoGuessMapping(headers);
    // Trigger dry-run khi đã có mapping phone
    if (mapping.value.phone != null) triggerFileDryRun();
  } catch (err) {
    console.error(err);
    fileError.value = 'Không đọc được file. Đảm bảo file CSV/Excel hợp lệ.';
  }
}

function autoGuessMapping(headers: string[]) {
  mapping.value = { phone: null, name: null, note: null };
  headers.forEach((h, i) => {
    const lo = h.toLowerCase();
    if (mapping.value.phone == null && /sđt|sdt|phone|đt\b|dt\b|số.*đt|số.*điện/.test(lo)) {
      mapping.value.phone = i;
    } else if (mapping.value.name == null && /tên|ten|name|khách|khach|kh\b/.test(lo)) {
      mapping.value.name = i;
    } else if (mapping.value.note == null && /ghi.*chú|ghi.*chu|note|mời|moi|lời.*mời|tin.*nhắn|message/.test(lo)) {
      mapping.value.note = i;
    }
  });
  // Fallback: nếu không đoán được phone, lấy cột đầu tiên
  if (mapping.value.phone == null && headers.length > 0) mapping.value.phone = 0;
}

function resetFile() {
  fileName.value = '';
  fileHeaders.value = [];
  fileRows.value = [];
  fileError.value = null;
  mapping.value = { phone: null, name: null, note: null };
  dryRunResult.value = null;
  if (filePickerRef.value) filePickerRef.value.value = '';
}

const mappedRows = computed<MappedRow[]>(() => {
  if (mapping.value.phone == null) return [];
  const pIdx = mapping.value.phone;
  const nIdx = mapping.value.name;
  const gIdx = mapping.value.note;
  return fileRows.value
    .map((r) => ({
      phone: r[pIdx] ?? '',
      name: nIdx != null ? (r[nIdx] || null) : null,
      personalNote: gIdx != null ? (r[gIdx] || null) : null,
    }))
    .filter((r) => r.phone && r.phone.trim());
});

const previewRows = computed(() => mappedRows.value.slice(0, 5));

let fileDryRunTimer: ReturnType<typeof setTimeout> | null = null;
function triggerFileDryRun() {
  if (fileDryRunTimer) clearTimeout(fileDryRunTimer);
  if (!mappedRows.value.length) {
    dryRunResult.value = null;
    return;
  }
  fileDryRunTimer = setTimeout(async () => {
    dryRunResult.value = await dryRun(mappedRows.value);
  }, 300);
}
watch(mapping, () => triggerFileDryRun(), { deep: true });

// ───────── Submit ─────────
const canSubmit = computed(() => {
  if (activeTab.value === 'paste') return !!rawText.value.trim();
  return mapping.value.phone != null && mappedRows.value.length > 0;
});

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    let result;
    if (activeTab.value === 'paste') {
      result = await createList({
        name: name.value.trim() || undefined,
        iconEmoji: iconEmoji.value ?? undefined,
        sourceType: 'paste',
        rawText: rawText.value,
      });
    } else {
      result = await createList({
        name: name.value.trim() || undefined,
        iconEmoji: iconEmoji.value ?? undefined,
        sourceType: activeTab.value, // 'excel' | 'csv'
        rows: mappedRows.value,
      });
    }
    if (result?.id) {
      emit('created', { id: result.id });
      emit('update:modelValue', false);
      resetAll();
    } else {
      alert('Tạo tệp thất bại — thử lại');
    }
  } finally {
    submitting.value = false;
  }
}

function resetAll() {
  name.value = '';
  iconEmoji.value = null;
  rawText.value = '';
  dryRunResult.value = null;
  activeTab.value = 'paste';
  resetFile();
}

// Reset trên đóng modal
watch(() => props.modelValue, (v) => {
  if (!v) {
    if (dryRunTimer) clearTimeout(dryRunTimer);
    if (fileDryRunTimer) clearTimeout(fileDryRunTimer);
  }
});

// Khi switch tab: clear preview của tab cũ để không lẫn
watch(activeTab, (newTab, oldTab) => {
  if (oldTab === 'paste' && newTab !== 'paste') {
    // Paste → File: giữ rawText nhưng clear preview, sẽ re-compute khi user upload file
    dryRunResult.value = null;
  } else if (oldTab !== 'paste' && newTab === 'paste') {
    // File → Paste: clear file state để không gửi nhầm
    resetFile();
  } else if (oldTab !== newTab && oldTab !== 'paste' && newTab !== 'paste') {
    // Excel ↔ CSV: clear file để pick lại đúng loại
    resetFile();
  }
});
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(17,24,39,.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}
.modal {
  background: #fff;
  border-radius: 14px;
  width: 680px;
  max-width: 94vw;
  max-height: 90vh;
  box-shadow: 0 24px 60px rgba(17,24,39,.22);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.modal-head {
  padding: 16px 20px;
  border-bottom: 1px solid #E5E7EB;
  display: flex; justify-content: space-between; align-items: center;
}
.modal-head h3 { margin: 0; font-size: 15px; font-weight: 600; }
.modal-head .x {
  background: transparent; border: none;
  color: #6B7280; font-size: 18px; cursor: pointer;
  padding: 4px 8px; border-radius: 5px;
}
.modal-head .x:hover { background: #F4F5F8; color: #111827; }
.modal-body { padding: 18px 20px; overflow-y: auto; flex: 1; }
.modal-foot {
  padding: 12px 20px;
  background: #F4F5F8;
  border-top: 1px solid #E5E7EB;
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
}
.modal-foot .left { font-size: 12px; color: #6B7280; }
.modal-foot .right { display: flex; gap: 8px; }

.field-row { display: flex; gap: 12px; }
.field { margin-bottom: 14px; }
.field label {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; font-weight: 600;
  color: #4B5563; text-transform: uppercase; letter-spacing: .04em;
  margin-bottom: 5px;
}
.field input, .field textarea, .field select {
  width: 100%; padding: 8px 10px;
  border: 1px solid #E5E7EB; border-radius: 7px;
  font-size: 13px; outline: none;
  font-family: inherit; background: #fff; color: #111827;
}
.field input:focus, .field textarea:focus, .field select:focus { border-color: #6366F1; }
.field textarea {
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 12px; min-height: 140px; resize: vertical;
}
.field .hint { font-size: 11px; color: #6B7280; margin-top: 4px; }
.field .hint code {
  background: #F4F5F8; padding: 1px 4px; border-radius: 3px;
  font-size: 11px;
}

.info-pill {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 500;
  background: #EFF6FF; color: #1D4ED8;
  padding: 2px 7px; border-radius: 999px;
  text-transform: none; letter-spacing: 0;
  cursor: help;
}

.icon-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.icon-btn {
  width: 36px; height: 36px;
  border: 1px solid #E5E7EB; border-radius: 8px;
  background: #fff; font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: #F4F5F8; }
.icon-btn.active { background: #EEF2FF; border-color: #6366F1; }

/* Tab nav */
.tab-nav {
  display: flex; gap: 4px;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 14px;
}
.tab-btn {
  background: transparent; border: none;
  border-bottom: 2px solid transparent;
  padding: 9px 14px;
  font-size: 13px; font-weight: 500;
  color: #6B7280; cursor: pointer;
  font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px;
}
.tab-btn:hover { color: #111827; }
.tab-btn.active {
  color: #6366F1;
  border-bottom-color: #6366F1;
}

/* Dropzone */
.dropzone {
  border: 2px dashed #D1D5DB;
  border-radius: 10px;
  padding: 28px 16px;
  text-align: center;
  cursor: pointer;
  background: #FAFBFC;
  transition: background .15s, border-color .15s;
}
.dropzone:hover, .dropzone.dragover {
  background: #EEF2FF; border-color: #6366F1;
}
.dz-icon { font-size: 36px; margin-bottom: 8px; }
.dz-title { font-size: 14px; color: #111827; margin-bottom: 4px; }
.dz-sub { font-size: 12px; color: #6B7280; }
.dz-error {
  margin-top: 10px; color: #B91C1C; font-size: 12px;
}

.file-meta {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #4B5563;
  background: #F4F5F8; border: 1px solid #EFF1F4;
  padding: 8px 12px; border-radius: 7px;
  margin-bottom: 14px;
}
.file-meta .dot { color: #9CA3AF; }
.link-btn {
  background: transparent; border: none;
  color: #6366F1; cursor: pointer;
  font-size: 13px; padding: 0;
  font-family: inherit;
  text-decoration: underline;
}

.map-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.map-cell { display: flex; flex-direction: column; gap: 4px; }
.map-label {
  font-size: 11.5px; font-weight: 600; color: #4B5563;
  text-transform: none; letter-spacing: 0;
  display: inline-flex; align-items: center; gap: 4px;
}
.map-label em {
  font-style: normal; color: #DC2626;
}
.map-cell select {
  padding: 7px 9px;
  border: 1px solid #E5E7EB; border-radius: 6px;
  font-size: 13px;
}

.preview-table-wrap {
  margin-top: 12px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  overflow: hidden;
}
.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.preview-table th {
  background: #F4F5F8;
  padding: 7px 10px;
  text-align: left;
  font-weight: 600;
  color: #374151;
  border-bottom: 1px solid #E5E7EB;
}
.preview-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #F4F5F8;
  color: #4B5563;
}
.preview-table tr:last-child td { border-bottom: none; }
.preview-table code {
  background: transparent;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  color: #111827;
}
.note-cell {
  max-width: 240px;
  overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}

.parse-preview {
  background: #F4F5F8;
  border: 1px solid #EFF1F4;
  border-radius: 8px;
  padding: 11px 13px;
  margin-top: 10px;
  font-size: 12px; color: #4B5563;
}
.parse-preview .pp-row {
  display: flex; align-items: center; gap: 8px; padding: 2px 0;
}
.parse-preview .pp-row .ico { font-size: 13px; width: 18px; }
.parse-preview .pp-row b {
  color: #111827; font-variant-numeric: tabular-nums;
}

.btn {
  padding: 7px 13px;
  background: #fff; border: 1px solid #E5E7EB; border-radius: 7px;
  color: #111827; cursor: pointer; font-size: 12.5px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: inherit;
}
.btn:hover { background: #F4F5F8; border-color: #D1D5DB; }
.btn.primary {
  background: #6366F1; border-color: #6366F1; color: white;
}
.btn.primary:hover:not(:disabled) {
  background: #4F46E5; border-color: #4F46E5;
}
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.ghost {
  background: transparent; border-color: transparent; color: #4B5563;
}
.btn.ghost:hover { background: #F4F5F8; }
</style>
