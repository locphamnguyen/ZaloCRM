<template>
  <div v-if="modelValue" class="clm-overlay" @click.self="$emit('update:modelValue', false)">
    <div class="clm-modal">
      <div class="clm-head">
        <h3 class="clm-title">📥 Tạo tệp khách hàng mới</h3>
        <button class="clm-x" aria-label="Đóng" @click="$emit('update:modelValue', false)">✕</button>
      </div>
      <div class="clm-body">
        <!-- Tên + Icon -->
        <div class="clm-field">
          <label class="clm-label">Tên tệp</label>
          <input class="clm-input" v-model="name" placeholder="VD: Lead Vinhomes Grand Park — Tháng 5" />
          <div class="clm-hint">Để trống → auto đặt "Tệp {{ defaultName }}"</div>
        </div>
        <div class="clm-field">
          <label class="clm-label">Icon</label>
          <div class="clm-icon-picker">
            <button
              v-for="ic in ICON_CHOICES"
              :key="ic"
              type="button"
              class="clm-icon-btn"
              :class="{ 'is-active': iconEmoji === ic }"
              @click="iconEmoji = ic"
            >{{ ic }}</button>
          </div>
        </div>

        <!-- Tab nav -->
        <div class="clm-tabnav">
          <button
            v-for="t in TABS" :key="t.key"
            class="clm-tab"
            :class="{ 'is-active': activeTab === t.key }"
            @click="activeTab = t.key"
          >
            <span class="clm-tab-ico">{{ t.icon }}</span> {{ t.label }}
          </button>
        </div>

        <!-- ───── TAB PASTE ───── -->
        <div v-if="activeTab === 'paste'">
          <div class="clm-field">
            <label class="clm-label">
              Danh sách SĐT (mỗi dòng 1 SĐT, có thể kèm tên)
              <span class="clm-pill" title="Định dạng: SĐT trước, tên sau. KHÔNG có ghi chú riêng — nếu cần lời mời/tin nhắn riêng cho từng KH, dùng tab CSV/Excel.">
                ℹ️ SĐT trước, tên sau
              </span>
            </label>
            <textarea
              class="clm-textarea"
              v-model="rawText"
              placeholder="0908 123 456&#10;0987-654-321 Nguyễn Văn A&#10;+84.938.111.222&#10;0913 445 566   Chị Lan VinGroup&#10;0976 333 444"
              @input="onRawTextInput"
            ></textarea>
            <div class="clm-hint">
              Hệ thống tự nhận diện SĐT đúng/sai, dedup, lookup Zalo. Prefix <code>p:</code> / <code>tel:</code> sẽ được strip tự động.
            </div>
          </div>
        </div>

        <!-- ───── TAB EXCEL / CSV (cùng UI, khác accept) ───── -->
        <div v-if="activeTab === 'excel' || activeTab === 'csv'">
          <!-- Step 1: chọn file -->
          <div v-if="!fileRows.length" class="clm-field">
            <label class="clm-label">{{ activeTab === 'excel' ? 'Upload Excel (.xlsx, .xls)' : 'Upload CSV (.csv)' }}</label>
            <div
              class="clm-dropzone"
              :class="{ 'is-dragover': isDragOver }"
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
              <div class="clm-dz-icon">{{ activeTab === 'excel' ? '📊' : '📄' }}</div>
              <div class="clm-dz-title">Kéo thả file vào đây hoặc <u>chọn file</u></div>
              <div class="clm-dz-sub">
                {{ activeTab === 'excel' ? '.xlsx hoặc .xls' : '.csv (UTF-8 khuyến nghị)' }} — tối đa 10MB
              </div>
              <div v-if="fileError" class="clm-dz-error">⚠️ {{ fileError }}</div>
            </div>
          </div>

          <!-- Step 2: column mapping -->
          <div v-if="fileRows.length">
            <div class="clm-file-meta">
              <span>📄 <b>{{ fileName }}</b></span>
              <span class="clm-dot">·</span>
              <span>{{ fileRows.length }} dòng</span>
              <span class="clm-dot">·</span>
              <button class="clm-link" @click="resetFile">Chọn file khác</button>
            </div>

            <div class="clm-field">
              <label class="clm-label">Ghép cột (chỉ cần SĐT là bắt buộc)</label>
              <div class="clm-map-grid">
                <div class="clm-map-cell">
                  <span class="clm-map-label">📞 SĐT <em>*</em></span>
                  <select class="clm-select" v-model="mapping.phone">
                    <option :value="null" disabled>— Chọn cột —</option>
                    <option v-for="(h, i) in fileHeaders" :key="'p'+i" :value="i">{{ h || `Cột ${i+1}` }}</option>
                  </select>
                </div>
                <div class="clm-map-cell">
                  <span class="clm-map-label">👤 Tên KH</span>
                  <select class="clm-select" v-model="mapping.name">
                    <option :value="null">— Không map —</option>
                    <option v-for="(h, i) in fileHeaders" :key="'n'+i" :value="i">{{ h || `Cột ${i+1}` }}</option>
                  </select>
                </div>
                <div class="clm-map-cell">
                  <span class="clm-map-label">💬 Lời mời / tin nhắn riêng</span>
                  <select class="clm-select" v-model="mapping.note">
                    <option :value="null">— Không map —</option>
                    <option v-for="(h, i) in fileHeaders" :key="'g'+i" :value="i">{{ h || `Cột ${i+1}` }}</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Preview 5 row sau khi mapping -->
            <div v-if="mapping.phone != null" class="clm-preview-wrap">
              <table class="clm-preview">
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
                    <td class="clm-note-cell">{{ r.personalNote || '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="fileRows.length > 5" class="clm-hint" style="margin-top:6px">
                Hiển thị 5/{{ fileRows.length }} dòng đầu. Toàn bộ sẽ được import sau khi bấm "Tạo tệp".
              </div>
            </div>
          </div>
        </div>

        <!-- ───── TAB LEAD ADS ───── -->
        <div v-if="activeTab === 'leadads'" class="clm-leadads">
          <div class="clm-field">
            <label class="clm-label">Nền tảng quảng cáo</label>
            <div class="clm-platform-grid">
              <button
                v-for="p in LEAD_PLATFORMS"
                :key="p.key"
                type="button"
                class="clm-platform-btn"
                :class="{ 'is-active': leadPlatform === p.key }"
                @click="leadPlatform = p.key"
              >
                <span class="clm-platform-icon">{{ p.icon }}</span>
                <span class="clm-platform-label">{{ p.label }}</span>
              </button>
            </div>
          </div>

          <div class="clm-field">
            <label class="clm-label">
              Mã đồng bộ (key trong tên chiến dịch)
              <span class="clm-pill" title="Mỗi tệp 1 mã. Anh đặt tên chiến dịch trên FB/TikTok kèm #MÃ — lead chảy về đúng tệp này. VD chiến dịch 'Sunshine Q7 #A-001' → tệp có mã A-001.">
                ℹ️ Cách dùng
              </span>
            </label>
            <input
              class="clm-input clm-key-input"
              :value="integrationKey"
              placeholder="A-001"
              maxlength="32"
              @input="onIntegrationKeyInput"
            />
            <div v-if="integrationKeyError" class="clm-err">⚠️ {{ integrationKeyError }}</div>
            <div class="clm-hint">
              Đặt tên chiến dịch trên FB là <code>Sunshine Q7 #{{ integrationKey || 'A-001' }}</code> để lead chảy về tệp này.
              Mỗi tệp 1 mã, không trùng trong tổ chức.
            </div>
          </div>

          <label class="clm-switch">
            <input type="checkbox" v-model="shareableToPool" />
            <span class="clm-switch-label">
              Chia sẻ vào Lead Pool — sale có thể nhận
              <span class="clm-pill" title="Khi bật, các lead validated trong tệp này sẽ vào pool /lead-pool/request, bất kỳ sale nào trong org có quyền nhận đều có thể click 'Nhận lead' để được assign.">
                ℹ️
              </span>
            </span>
          </label>

          <div class="clm-callout">
            <span class="clm-callout-ico">💡</span>
            <span>Tạo xong, anh vào <b>Cài đặt → Kênh & Tích hợp → {{ leadPlatform === 'fb-leadads' ? 'Facebook Lead Ads' : 'tích hợp tương ứng' }}</b> để kết nối page/app.</span>
          </div>
        </div>

        <!-- ───── Dry-run preview chung ───── -->
        <div v-if="dryRunResult" class="clm-parse">
          <div class="clm-pp-row">
            <span class="clm-pp-ico">📋</span> Đã nhận diện <b>{{ dryRunResult.total }} dòng</b>
          </div>
          <div class="clm-pp-row clm-pp--ok">
            <span class="clm-pp-ico">✓</span> <b>{{ dryRunResult.valid }} SĐT</b> hợp lệ
          </div>
          <div v-if="dryRunResult.invalid > 0" class="clm-pp-row clm-pp--err">
            <span class="clm-pp-ico">✗</span> <b>{{ dryRunResult.invalid }} dòng</b> bỏ qua (sai format / khác VN)
          </div>
          <div v-if="dryRunResult.dupInList > 0" class="clm-pp-row clm-pp--warn">
            <span class="clm-pp-ico">↺</span> <b>{{ dryRunResult.dupInList }} SĐT</b> trùng trong cùng danh sách
          </div>
          <div v-if="dryRunResult.dupCrossList > 0" class="clm-pp-row clm-pp--warn">
            <span class="clm-pp-ico">↔</span> <b>{{ dryRunResult.dupCrossList }} SĐT</b> trùng với tệp khác trong tổ chức
          </div>
          <div v-if="dryRunResult.dupWithCrm > 0" class="clm-pp-row clm-pp--warn">
            <span class="clm-pp-ico">⚷</span> <b>{{ dryRunResult.dupWithCrm }} SĐT</b> trùng với Contact hiện có trong CRM
          </div>
        </div>
      </div>
      <div class="clm-foot">
        <span class="clm-foot-note">Sau khi tạo, hệ thống async lookup UID Zalo qua zalo-pool (không chặn UI).</span>
        <div class="clm-foot-actions">
          <button class="clm-btn clm-btn--ghost" @click="$emit('update:modelValue', false)">Huỷ</button>
          <button
            class="clm-btn clm-btn--primary"
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
  { key: 'paste'   as const, label: 'Paste danh sách', icon: '📋', accept: '' },
  { key: 'excel'   as const, label: 'Upload Excel',    icon: '📊', accept: '.xlsx,.xls' },
  { key: 'csv'     as const, label: 'Upload CSV',      icon: '📄', accept: '.csv' },
  // Phase Multi-Source Lead Ads 2026-05-27
  { key: 'leadads' as const, label: 'Lead Ads',        icon: '📣', accept: '' },
];
type TabKey = 'paste' | 'excel' | 'csv' | 'leadads';
const activeTab = ref<TabKey>('paste');

// ───────── Tab leadads ─────────
const LEAD_PLATFORMS = [
  { key: 'fb-leadads',     label: 'Facebook Lead Ads', icon: '📘' },
  { key: 'tiktok-leadgen', label: 'TikTok Lead Gen',   icon: '🎵' },
  { key: 'google-leadform',label: 'Google Lead Form',  icon: '🔍' },
  { key: 'zalo-ads',       label: 'Zalo Ads',          icon: '💬' },
  { key: 'custom',         label: 'Khác / Tuỳ chỉnh',  icon: '🔧' },
];
const leadPlatform = ref<string>('fb-leadads');
const integrationKey = ref<string>('');
const shareableToPool = ref<boolean>(false);
const integrationKeyError = ref<string>('');

function onIntegrationKeyInput(e: Event) {
  const target = e.target as HTMLInputElement;
  // Auto-uppercase + strip space, allow A-Z 0-9 dash
  const cleaned = target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  integrationKey.value = cleaned.slice(0, 32);
  target.value = integrationKey.value;
  // Validate
  if (!integrationKey.value) integrationKeyError.value = '';
  else if (!/^[A-Z0-9-]{1,32}$/.test(integrationKey.value)) {
    integrationKeyError.value = 'Chỉ A-Z, 0-9, dấu gạch ngang (1-32 ký tự)';
  } else integrationKeyError.value = '';
}

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
  if (activeTab.value === 'leadads') {
    return !!name.value.trim()
      && !!integrationKey.value
      && !integrationKeyError.value;
  }
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
    } else if (activeTab.value === 'leadads') {
      result = await createList({
        name: name.value.trim(),
        iconEmoji: iconEmoji.value ?? '📣',
        sourceType: 'leadads',
        platform: leadPlatform.value,
        integrationKey: integrationKey.value,
        shareableToPool: shareableToPool.value,
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
  // Phase Multi-Source Lead Ads 2026-05-27
  leadPlatform.value = 'fb-leadads';
  integrationKey.value = '';
  integrationKeyError.value = '';
  shareableToPool.value = false;
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
/* ════════════════════════════════════════════════════════════════════════
 * Atlas v2 reskin (2026-06-08) — CreateListModal.
 * Mọi class dùng prefix `clm-` để KHÔNG đụng global theme (.field/.btn/.modal
 * trong hs-crm-theme.css đè display:flex → vỡ layout). Token đọc từ brand HS
 * (--brand/--ink/--surface/--line…) với fallback hardcode để an toàn khi scope
 * không inherit. Màu chủ đạo = brand HS metallic blue, KHÔNG indigo cũ.
 * ════════════════════════════════════════════════════════════════════════ */
.clm-overlay {
  position: fixed; inset: 0;
  background: rgba(20, 26, 36, .48);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
  padding: 20px;
}
.clm-modal {
  background: var(--surface, #ffffff);
  border-radius: 12px;
  width: 680px;
  max-width: 94vw;
  max-height: 88vh;
  box-shadow: 0 24px 60px rgba(20, 26, 36, .24);
  display: flex; flex-direction: column;
  overflow: hidden;
  color: var(--ink-2, #475066);
}

/* ── Head ── */
.clm-head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--line, #e7eaf0);
  display: flex; justify-content: space-between; align-items: center;
  flex-shrink: 0;
}
.clm-title {
  margin: 0; font-size: 16px; font-weight: 500;
  color: var(--ink, #141a24);
  display: flex; align-items: center; gap: 8px;
}
.clm-x {
  background: transparent; border: none;
  color: var(--ink-3, #6b7488); font-size: 16px; cursor: pointer;
  width: 30px; height: 30px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s;
}
.clm-x:hover { background: var(--surface-3, #f1f4f9); color: var(--ink, #141a24); }

/* ── Body / Foot ── */
.clm-body { padding: 18px 20px; overflow-y: auto; flex: 1; }
.clm-foot {
  padding: 12px 20px;
  background: var(--surface-2, #f7f9fc);
  border-top: 1px solid var(--line, #e7eaf0);
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  flex-shrink: 0;
}
.clm-foot-note { font-size: 12px; color: var(--ink-3, #6b7488); line-height: 1.4; }
.clm-foot-actions { display: flex; gap: 8px; flex-shrink: 0; }

/* ── Field ── */
.clm-field { margin-bottom: 16px; }
.clm-field:last-child { margin-bottom: 0; }
.clm-label {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 11px; font-weight: 500;
  color: var(--ink-3, #6b7488); text-transform: uppercase; letter-spacing: .04em;
  margin-bottom: 6px;
}
.clm-input, .clm-textarea, .clm-select {
  width: 100%; padding: 9px 12px;
  border: 1px solid var(--line, #e7eaf0); border-radius: 6px;
  font-size: 13.5px; outline: none;
  font-family: inherit; background: var(--surface, #fff); color: var(--ink, #141a24);
  transition: border-color .12s, box-shadow .12s;
  box-sizing: border-box;
}
.clm-input:focus, .clm-textarea:focus, .clm-select:focus {
  border-color: var(--brand, #1786be);
  box-shadow: 0 0 0 3px var(--brand-soft, #e4f1f8);
}
.clm-input::placeholder, .clm-textarea::placeholder { color: var(--ink-4, #97a0b3); }
.clm-textarea {
  font-family: var(--mono, "Roboto Mono", Menlo, Consolas, monospace);
  font-size: 12.5px; min-height: 150px; resize: vertical; line-height: 1.6;
}
.clm-hint { font-size: 11.5px; color: var(--ink-3, #6b7488); margin-top: 5px; line-height: 1.45; }
.clm-hint code, .clm-input code {
  background: var(--surface-3, #f1f4f9); padding: 1px 5px; border-radius: 4px;
  font-size: 11px; font-family: var(--mono, "Roboto Mono", monospace);
}
.clm-err { color: var(--error, #f04438); font-size: 12px; margin-top: 5px; }

/* ── Info pill ── */
.clm-pill {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 500;
  background: var(--brand-soft, #e4f1f8); color: var(--brand-700, #0b5880);
  padding: 2px 8px; border-radius: 999px;
  text-transform: none; letter-spacing: 0;
  cursor: help;
}

/* ── Icon picker ── */
.clm-icon-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.clm-icon-btn {
  width: 38px; height: 38px;
  border: 1px solid var(--line, #e7eaf0); border-radius: 8px;
  background: var(--surface, #fff); font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, border-color .12s;
}
.clm-icon-btn:hover { background: var(--surface-3, #f1f4f9); }
.clm-icon-btn.is-active {
  background: var(--brand-soft, #e4f1f8); border-color: var(--brand, #1786be);
}

/* ── Tab nav ── */
.clm-tabnav {
  display: flex; gap: 2px;
  border-bottom: 1px solid var(--line, #e7eaf0);
  margin-bottom: 16px;
}
.clm-tab {
  background: transparent; border: none;
  border-bottom: 2px solid transparent;
  padding: 9px 14px; margin-bottom: -1px;
  font-size: 13px; font-weight: 500;
  color: var(--ink-3, #6b7488); cursor: pointer;
  font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px;
  transition: color .12s, border-color .12s;
}
.clm-tab:hover { color: var(--ink, #141a24); }
.clm-tab.is-active {
  color: var(--brand, #1786be);
  border-bottom-color: var(--brand, #1786be);
}
.clm-tab-ico { font-size: 14px; }

/* ── Dropzone ── */
.clm-dropzone {
  border: 2px dashed var(--line, #cdd4e0);
  border-radius: 10px;
  padding: 30px 16px;
  text-align: center;
  cursor: pointer;
  background: var(--surface-2, #f7f9fc);
  transition: background .14s, border-color .14s;
}
.clm-dropzone:hover, .clm-dropzone.is-dragover {
  background: var(--brand-soft, #e4f1f8); border-color: var(--brand, #1786be);
}
.clm-dz-icon { font-size: 36px; margin-bottom: 8px; }
.clm-dz-title { font-size: 14px; color: var(--ink, #141a24); margin-bottom: 4px; }
.clm-dz-sub { font-size: 12px; color: var(--ink-3, #6b7488); }
.clm-dz-error { margin-top: 10px; color: var(--error, #f04438); font-size: 12px; }

/* ── File meta ── */
.clm-file-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px; color: var(--ink-2, #475066);
  background: var(--surface-3, #f1f4f9); border: 1px solid var(--line, #e7eaf0);
  padding: 9px 12px; border-radius: 7px;
  margin-bottom: 16px;
}
.clm-dot { color: var(--ink-4, #97a0b3); }
.clm-link {
  background: transparent; border: none;
  color: var(--brand, #1786be); cursor: pointer;
  font-size: 13px; padding: 0; font-family: inherit;
  text-decoration: underline;
}

/* ── Column mapping ── */
.clm-map-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.clm-map-cell { display: flex; flex-direction: column; gap: 5px; }
.clm-map-label {
  font-size: 11.5px; font-weight: 500; color: var(--ink-2, #475066);
  display: inline-flex; align-items: center; gap: 4px;
}
.clm-map-label em { font-style: normal; color: var(--error, #f04438); }

/* ── Preview table ── */
.clm-preview-wrap {
  margin-top: 12px;
  border: 1px solid var(--line, #e7eaf0);
  border-radius: 8px;
  overflow: hidden;
}
.clm-preview { width: 100%; border-collapse: collapse; font-size: 12px; }
.clm-preview th {
  background: var(--surface-3, #f1f4f9);
  padding: 8px 10px; text-align: left; font-weight: 500;
  color: var(--ink-2, #475066); border-bottom: 1px solid var(--line, #e7eaf0);
  font-size: 11px; text-transform: uppercase; letter-spacing: .03em;
}
.clm-preview td {
  padding: 7px 10px; border-bottom: 1px solid var(--line-2, #eef1f6);
  color: var(--ink-2, #475066);
}
.clm-preview tr:last-child td { border-bottom: none; }
.clm-preview code {
  background: transparent;
  font-family: var(--mono, "Roboto Mono", Menlo, Consolas, monospace);
  color: var(--ink, #141a24);
}
.clm-note-cell {
  max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Dry-run parse preview ── */
.clm-parse {
  background: var(--surface-3, #f1f4f9);
  border: 1px solid var(--line, #e7eaf0);
  border-radius: 8px;
  padding: 12px 14px;
  margin-top: 12px;
  font-size: 12.5px; color: var(--ink-2, #475066);
}
.clm-pp-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.clm-pp-ico { font-size: 13px; width: 18px; text-align: center; }
.clm-pp-row b { color: var(--ink, #141a24); font-variant-numeric: tabular-nums; }
.clm-pp--ok { color: var(--success, #12b76a); }
.clm-pp--err { color: var(--error, #f04438); }
.clm-pp--warn { color: var(--warning, #b45309); }

/* ── Buttons ── */
.clm-btn {
  padding: 9px 18px;
  border: 1px solid var(--line, #e7eaf0); border-radius: 8px;
  background: var(--surface, #fff);
  color: var(--ink, #141a24); cursor: pointer;
  font-size: 13px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: inherit;
  transition: background .1s, border-color .1s;
}
.clm-btn--primary {
  background: var(--brand, #1786be); border-color: var(--brand, #1786be); color: #fff;
}
.clm-btn--primary:active:not(:disabled) {
  background: var(--brand-700, #0b5880); border-color: var(--brand-700, #0b5880);
}
.clm-btn--primary:disabled { opacity: .5; cursor: not-allowed; }
.clm-btn--ghost {
  background: transparent; border-color: transparent; color: var(--ink-2, #475066);
}
.clm-btn--ghost:hover { background: var(--surface-3, #f1f4f9); }

/* ── Lead Ads tab ── */
.clm-leadads { display: flex; flex-direction: column; gap: 18px; }
.clm-platform-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;
}
.clm-platform-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 14px 8px; border: 1px solid var(--line, #e7eaf0); border-radius: 10px;
  background: var(--surface, #fff); cursor: pointer; transition: border-color .12s, background .12s;
}
.clm-platform-btn:hover { border-color: var(--brand-bright, #5bb8e5); background: var(--brand-softer, #f2f8fc); }
.clm-platform-btn.is-active { border-color: var(--brand, #1786be); background: var(--brand-soft, #e4f1f8); }
.clm-platform-icon { font-size: 22px; }
.clm-platform-label { font-size: 12px; font-weight: 500; color: var(--ink-2, #475066); text-align: center; }
.clm-key-input {
  font-family: var(--mono, "Roboto Mono", monospace); font-weight: 600; letter-spacing: 1px;
  text-transform: uppercase;
}
.clm-switch { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.clm-switch input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--brand, #1786be); flex-shrink: 0; }
.clm-switch-label { font-size: 13.5px; color: var(--ink-2, #475066); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.clm-callout {
  background: var(--warning-soft, #fdf3e2); border-left: 3px solid var(--warning, #f5a524);
  padding: 11px 13px; border-radius: 8px; font-size: 13px; color: #92400e;
  display: flex; gap: 8px; line-height: 1.45;
}
.clm-callout-ico { font-size: 16px; flex-shrink: 0; }
</style>
