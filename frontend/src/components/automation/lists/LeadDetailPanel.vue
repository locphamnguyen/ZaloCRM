<template>
  <Teleport to="body">
    <div v-if="modelValue" class="ldp-bg" @click.self="close">
      <div class="ldp-panel" :class="{ 'ldp-loading': loading }">
        <!-- Header -->
        <header class="ldp-head">
          <div class="ldp-head-top">
            <div class="ldp-avatar" :style="{ background: avatarGradient }">{{ initials }}</div>
            <div class="ldp-head-info">
              <div class="ldp-name">{{ data?.entry.nameRaw || 'Khách hàng' }}</div>
              <div class="ldp-contact">
                <span v-if="data?.entry.phoneE164">📞 {{ formatPhone(data.entry.phoneE164) }}</span>
                <span v-if="customEmail">· 📧 {{ customEmail }}</span>
              </div>
              <div class="ldp-badges">
                <span v-if="isFresh" class="ldp-badge fresh">Vừa mới · {{ relativeTime(data!.entry.createdAt) }}</span>
                <span v-else class="ldp-badge time">{{ relativeTime(data?.entry.createdAt ?? '') }}</span>
                <span v-if="data?.entry.hasZalo === true" class="ldp-badge zalo">💬 Có Zalo</span>
                <span v-else-if="data?.entry.hasZalo === false" class="ldp-badge no-zalo">🚫 Không Zalo</span>
                <span v-else class="ldp-badge pending">⏳ Đang quét</span>
                <span v-if="sourcePlatform" :class="['ldp-badge', 'source', sourcePlatformClass]">{{ sourcePlatformLabel }}</span>
              </div>
            </div>
            <button class="ldp-x" @click="close">✕</button>
          </div>

          <div class="ldp-actions">
            <button class="ldp-btn-primary" :disabled="data?.entry.hasZalo !== true">💬 Mở chat Zalo</button>
            <button class="ldp-btn-ghost">📞 Gọi</button>
            <button class="ldp-btn-ghost">📝 Note</button>
            <button class="ldp-btn-ghost">↪ Move</button>
          </div>
        </header>

        <!-- Body -->
        <div class="ldp-body">
          <div v-if="loading" class="ldp-loading-msg">⏳ Đang tải chi tiết...</div>
          <div v-else-if="error" class="ldp-err">{{ error }}</div>

          <template v-else-if="data">
            <!-- Section 1: Custom fields -->
            <section v-if="hasCustomFields" class="ldp-section">
              <div class="ldp-section-head">
                <span class="ldp-icon">📝</span>
                <span class="ldp-section-title">Câu hỏi form ({{ customFieldsList.length }} trường)</span>
              </div>
              <div class="ldp-custom-card">
                <div v-for="(item, idx) in customFieldsList" :key="idx" class="ldp-custom-row" :class="{ last: idx === customFieldsList.length - 1 }">
                  <div class="ldp-custom-key">{{ item.key }}</div>
                  <div class="ldp-custom-val">{{ item.value }}</div>
                </div>
              </div>
            </section>

            <!-- Section 2: Source attribution (FB/TikTok/Google/Zalo Ads) -->
            <section v-if="hasSourceMeta" class="ldp-section">
              <div class="ldp-section-head">
                <span class="ldp-icon">{{ sourcePlatformIcon }}</span>
                <span class="ldp-section-title">Nguồn lead ({{ sourcePlatformLabel }} payload)</span>
              </div>
              <div class="ldp-source-card">
                <SourceMetaRow v-if="meta.campaignName || meta.campaignId" icon="🎯" label="Campaign" :name="meta.campaignName" :id="meta.campaignId" :extra-pill="data.list.integrationKey ? '#' + data.list.integrationKey : null" />
                <SourceMetaRow v-if="meta.adSetId" icon="📊" label="Ad Set" :id="meta.adSetId" />
                <SourceMetaRow v-if="meta.adId" icon="🖼" label="Ad Creative" :id="meta.adId" />
                <SourceMetaRow v-if="meta.formName || meta.formId" icon="📝" label="Form" :name="meta.formName" :id="meta.formId" :extra="customFieldsList.length > 0 ? `${customFieldsList.length} câu hỏi custom` : null" />
                <SourceMetaRow v-if="meta.pageId" icon="📄" label="Page FB" :id="meta.pageId" />
                <SourceMetaRow icon="🔑" label="Lead ID" :id="meta.externalLeadId" :extra="'Unique từ ' + sourcePlatformLabel + ' · idempotency key'" />
              </div>

              <!-- Mini stats từ campaign -->
              <div v-if="data.campaignStats" class="ldp-stats-grid">
                <div class="ldp-stat-mini">
                  <div class="ldp-stat-label">Campaign này</div>
                  <div class="ldp-stat-val">{{ data.campaignStats.totalLeads }} lead</div>
                  <div class="ldp-stat-sub" style="color:#16A34A">+{{ data.campaignStats.leadsLast1h }} / 1h</div>
                </div>
                <div class="ldp-stat-mini">
                  <div class="ldp-stat-label">Hôm nay</div>
                  <div class="ldp-stat-val">{{ data.campaignStats.leadsLast24h }} lead</div>
                  <div class="ldp-stat-sub">24h gần nhất</div>
                </div>
                <div class="ldp-stat-mini">
                  <div class="ldp-stat-label">Tệp này</div>
                  <div class="ldp-stat-val">{{ data.list.name.slice(0, 18) }}{{ data.list.name.length > 18 ? '…' : '' }}</div>
                  <div class="ldp-stat-sub">Routed via #KEY</div>
                </div>
              </div>
            </section>

            <!-- Section 3: Timeline & kỹ thuật -->
            <section v-if="hasTimeline" class="ldp-section">
              <div class="ldp-section-head">
                <span class="ldp-icon">⏱</span>
                <span class="ldp-section-title">Timeline & Kỹ thuật</span>
              </div>
              <div class="ldp-timeline">
                <div v-for="step in timelineSteps" :key="step.name" class="ldp-time-row">
                  <span class="ldp-time-check" :class="step.ok ? 'ok' : 'pending'">{{ step.ok ? '✓' : '⏳' }}</span>
                  <span class="ldp-time-label">{{ step.label }}</span>
                  <span class="ldp-time-val">{{ step.value }}</span>
                  <span v-if="step.delta" :class="['ldp-time-delta', step.deltaSlow ? 'slow' : '']">{{ step.delta }}</span>
                </div>
                <div v-if="timelineTotal" class="ldp-time-total">
                  <span>Tổng end-to-end:</span>
                  <span :style="{ color: timelineTotal > 5000 ? '#DC2626' : '#16A34A' }">{{ formatMs(timelineTotal) }}</span>
                </div>
              </div>
            </section>

            <!-- Section 4: Raw payload JSON (collapsible) -->
            <section v-if="data.webhookLog" class="ldp-section">
              <details>
                <summary class="ldp-section-head" style="cursor:pointer;list-style:none">
                  <span class="ldp-icon">🔧</span>
                  <span class="ldp-section-title">Raw payload JSON (debug)</span>
                  <span style="margin-left:auto;font-size:10.5px;color:#9CA3AF">click để xem</span>
                </summary>
                <pre class="ldp-raw">{{ formatJson(data.webhookLog.rawBody) }}</pre>
                <div class="ldp-raw-actions">
                  <button class="ldp-btn-ghost" @click="copyJson">📋 Copy JSON</button>
                  <button class="ldp-btn-ghost" :disabled="!canReplay">🔄 Replay webhook</button>
                </div>
              </details>
            </section>

            <!-- Section 5: CRM internal -->
            <section class="ldp-section">
              <div class="ldp-section-head">
                <span class="ldp-icon">🏢</span>
                <span class="ldp-section-title">CRM nội bộ</span>
              </div>
              <div class="ldp-internal-card">
                <div class="ldp-int-row">
                  <span class="ldp-int-key">Sale gán</span>
                  <span class="ldp-int-val">
                    <span class="ldp-pool-pill">Chưa gán — pool công khai</span>
                  </span>
                </div>
                <div class="ldp-int-row">
                  <span class="ldp-int-key">Trạng thái</span>
                  <span class="ldp-int-val"><span class="ldp-status">{{ statusVN }}</span></span>
                </div>
                <div class="ldp-int-row">
                  <span class="ldp-int-key">Tên Zalo</span>
                  <span class="ldp-int-val">{{ data.entry.zaloName || '—' }}</span>
                </div>
                <div class="ldp-int-row">
                  <span class="ldp-int-key">UID Zalo</span>
                  <span class="ldp-int-val ldp-mono">{{ data.entry.zaloUid || '—' }}</span>
                </div>
                <div v-if="data.entry.enrichedAt" class="ldp-int-row">
                  <span class="ldp-int-key">Đã quét Zalo</span>
                  <span class="ldp-int-val">{{ relativeTime(data.entry.enrichedAt) }}</span>
                </div>
                <div class="ldp-int-row">
                  <span class="ldp-int-key">Contact CRM</span>
                  <span class="ldp-int-val">
                    <a v-if="data.entry.contactId" :href="`/contacts/${data.entry.contactId}`" target="_blank" class="ldp-link">
                      Mở hồ sơ →
                    </a>
                    <span v-else style="color:#9CA3AF;font-style:italic">Chưa tạo Contact</span>
                  </span>
                </div>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';
import { formatInOrgTz } from '@/composables/use-org-timezone';
import SourceMetaRow from './SourceMetaRow.vue';

const props = defineProps<{
  modelValue: boolean;
  entryId: string | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const toast = useToast();

interface LeadDetailData {
  entry: {
    id: string; rowIndex: number;
    phoneRaw: string; nameRaw: string | null;
    phoneE164: string | null; phoneLocal: string | null; phoneValid: boolean;
    customFields: Record<string, unknown>;
    sourceMeta: Record<string, unknown>;
    status: string;
    hasZalo: boolean | null;
    zaloUid: string | null; zaloName: string | null;
    contactId: string | null;
    createdAt: string;
    enrichedAt: string | null;
  };
  list: { id: string; name: string; iconEmoji: string | null; sourceType: string; integrationKey: string | null; shareableToPool: boolean };
  webhookLog: {
    id: string; source: string; status: string; attempts: number;
    processingSteps: Record<string, number>;
    errorMessage: string | null;
    createdAt: string; processedAt: string | null;
    rawBody: unknown;
  } | null;
  campaignStats: { totalLeads: number; leadsLast1h: number; leadsLast24h: number } | null;
}

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<LeadDetailData | null>(null);

watch(() => [props.modelValue, props.entryId] as const, async ([open, id]) => {
  if (!open || !id) {
    data.value = null;
    error.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<LeadDetailData>(`/customer-list-entries/${id}/lead-detail`);
    data.value = res.data;
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } }; message?: string };
    error.value = err.response?.data?.error || err.message || 'Không tải được chi tiết lead';
  } finally {
    loading.value = false;
  }
}, { immediate: true });

function close() { emit('update:modelValue', false); }

// ───── Derived ─────
const meta = computed(() => (data.value?.entry.sourceMeta ?? {}) as Record<string, string | undefined>);

const sourcePlatform = computed(() => meta.value.source ?? data.value?.webhookLog?.source ?? null);
const sourcePlatformLabel = computed(() => {
  const s = sourcePlatform.value;
  if (s === 'fb-leadads') return 'Facebook Lead Ads';
  if (s === 'tiktok-leadgen') return 'TikTok Lead Gen';
  if (s === 'google-leadform') return 'Google Lead Form';
  if (s === 'zalo-ads') return 'Zalo Ads';
  if (data.value?.list.sourceType === 'paste') return 'Paste';
  if (data.value?.list.sourceType === 'excel') return 'Excel';
  if (data.value?.list.sourceType === 'csv') return 'CSV';
  return s || 'Manual';
});
const sourcePlatformClass = computed(() => {
  const s = sourcePlatform.value;
  if (s === 'fb-leadads') return 'fb';
  if (s === 'tiktok-leadgen') return 'tiktok';
  if (s === 'google-leadform') return 'google';
  if (s === 'zalo-ads') return 'zalo';
  return 'manual';
});
const sourcePlatformIcon = computed(() => {
  const s = sourcePlatform.value;
  if (s === 'fb-leadads') return '📘';
  if (s === 'tiktok-leadgen') return '🎵';
  if (s === 'google-leadform') return '🔍';
  if (s === 'zalo-ads') return '💙';
  return '📋';
});

const customFieldsList = computed(() => {
  const cf = data.value?.entry.customFields ?? {};
  return Object.entries(cf).map(([key, value]) => ({ key, value: String(value ?? '—') }));
});
const hasCustomFields = computed(() => customFieldsList.value.length > 0);
const customEmail = computed(() => {
  const cf = (data.value?.entry.customFields ?? {}) as Record<string, unknown>;
  return cf.email ? String(cf.email) : '';
});

const hasSourceMeta = computed(() => Object.keys(meta.value).length > 0);

const initials = computed(() => {
  const name = data.value?.entry.nameRaw || '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
});

const avatarGradient = computed(() => {
  const name = data.value?.entry.nameRaw ?? '?';
  const hash = name.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const palettes = [
    ['#4f46e5', '#8b5cf6'], ['#f59e0b', '#dc2626'], ['#10b981', '#0ea5e9'],
    ['#ec4899', '#a855f7'], ['#0ea5e9', '#22d3ee'], ['#84cc16', '#22c55e'],
  ];
  const p = palettes[hash % palettes.length];
  return `linear-gradient(135deg, ${p[0]}, ${p[1]})`;
});

const isFresh = computed(() => {
  if (!data.value?.entry.createdAt) return false;
  return Date.now() - new Date(data.value.entry.createdAt).getTime() < 60_000;
});

const statusVN = computed(() => {
  const s = data.value?.entry.status;
  if (s === 'validated') return '✓ Hợp lệ — đang chờ Zalo lookup';
  if (s === 'enriched') return '✓ Đã quét Zalo';
  if (s === 'invalid') return '⚠ Sai format';
  if (s === 'pending') return '⏳ Đang xử lý';
  if (s === 'dup_in_list') return '↺ Trùng trong tệp';
  if (s === 'dup_cross_list') return '↔ Trùng tệp khác';
  if (s === 'dup_with_crm') return '⚷ Trùng Contact CRM';
  return s || '—';
});

// ───── Timeline ─────
const hasTimeline = computed(() => {
  if (!data.value?.webhookLog) return false;
  return Object.keys(data.value.webhookLog.processingSteps ?? {}).length > 0;
});

interface TimelineStep { name: string; label: string; ok: boolean; value: string; delta: string; deltaSlow: boolean; }

const timelineSteps = computed<TimelineStep[]>(() => {
  if (!data.value?.webhookLog) return [];
  const log = data.value.webhookLog;
  const steps: Array<{ key: keyof typeof log.processingSteps; label: string }> = [
    { key: 'parseMs', label: 'Parse webhook payload' },
    { key: 'graphApiMs', label: 'Graph API ad + lead fetch' },
    { key: 'routeMs', label: 'Route → list theo #KEY' },
    { key: 'dbInsertMs', label: 'Insert entry CRM' },
  ];
  const ps = log.processingSteps as Record<string, number>;
  const result: TimelineStep[] = [];
  result.push({
    name: 'received',
    label: 'Webhook nhận',
    ok: true,
    value: formatHm(log.createdAt),
    delta: 't=0',
    deltaSlow: false,
  });
  for (const s of steps) {
    const ms = ps[s.key as string];
    if (ms === undefined) continue;
    result.push({
      name: String(s.key),
      label: s.label,
      ok: true,
      value: `+${ms}ms`,
      delta: ms > 500 ? `+${ms}ms ⚠` : '',
      deltaSlow: ms > 500,
    });
  }
  if (log.processedAt) {
    result.push({
      name: 'processed',
      label: 'Entry đã insert',
      ok: true,
      value: formatHm(log.processedAt),
      delta: '',
      deltaSlow: false,
    });
  }
  return result;
});

const timelineTotal = computed(() => {
  if (!data.value?.webhookLog) return null;
  const ps = data.value.webhookLog.processingSteps as Record<string, number>;
  return ps.totalMs ?? null;
});

const canReplay = computed(() => data.value?.webhookLog?.status === 'failed');

// ───── Helpers ─────
function formatPhone(p: string): string {
  // +84908123456 → +84 908 123 456
  if (!p) return '';
  return p.replace(/^(\+\d{2})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4');
}
function relativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} giây trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return formatInOrgTz(iso);
}
function formatHm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s (${ms.toLocaleString('vi-VN')}ms)`;
}
function formatJson(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

async function copyJson() {
  if (!data.value?.webhookLog) return;
  try {
    await navigator.clipboard.writeText(formatJson(data.value.webhookLog.rawBody));
    toast.success('Đã copy JSON');
  } catch {
    toast.error('Không copy được');
  }
}
</script>

<style scoped>
.ldp-bg {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.4);
  z-index: 9999;
  display: flex; justify-content: flex-end;
  animation: ldp-fade 200ms ease;
}
@keyframes ldp-fade { from { opacity: 0; } to { opacity: 1; } }
.ldp-panel {
  width: 580px; max-width: 100vw;
  background: white;
  display: flex; flex-direction: column;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
  animation: ldp-slide 250ms ease;
  height: 100vh; overflow: hidden;
}
@keyframes ldp-slide {
  from { transform: translateX(40px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* Header */
.ldp-head {
  padding: 18px 22px;
  border-bottom: 1px solid #E5E7EB;
  background: linear-gradient(180deg, #FAFBFD, white);
  flex-shrink: 0;
}
.ldp-head-top { display: flex; gap: 12px; align-items: flex-start; }
.ldp-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 16px;
  flex-shrink: 0;
}
.ldp-head-info { flex: 1; min-width: 0; }
.ldp-name { font-size: 17px; font-weight: 700; color: #0F172A; }
.ldp-contact {
  font-size: 12.5px; color: #6B7280; margin-top: 3px;
  font-family: monospace;
}
.ldp-badges {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-top: 8px;
}
.ldp-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 999px;
  font-weight: 700; text-transform: uppercase;
}
.ldp-badge.fresh { background: #DCFCE7; color: #166534; }
.ldp-badge.time { background: #F3F4F6; color: #6B7280; }
.ldp-badge.zalo { background: #DCFCE7; color: #166534; }
.ldp-badge.no-zalo { background: #FEE2E2; color: #991B1B; }
.ldp-badge.pending { background: #FEF3C7; color: #92400E; }
.ldp-badge.source.fb { background: #DBEAFE; color: #1E40AF; }
.ldp-badge.source.tiktok { background: #F3F4F6; color: #111827; }
.ldp-badge.source.google { background: #FEF3C7; color: #92400E; }
.ldp-badge.source.zalo { background: #DBEAFE; color: #0066CC; }
.ldp-badge.source.manual { background: #E0E7FF; color: #3730A3; }

.ldp-x {
  background: transparent; border: none;
  font-size: 22px; cursor: pointer; color: #9CA3AF;
  padding: 4px 10px; border-radius: 7px;
  align-self: flex-start;
}
.ldp-x:hover { background: #F3F4F6; color: #374151; }

.ldp-actions {
  display: flex; gap: 8px; margin-top: 14px;
}
.ldp-btn-primary {
  flex: 1; background: #4F46E5; color: white; border: none;
  border-radius: 7px; padding: 8px 12px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.ldp-btn-primary:hover:not(:disabled) { background: #4338CA; }
.ldp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.ldp-btn-ghost {
  background: white; color: #374151;
  border: 1px solid #D1D5DB; border-radius: 7px;
  padding: 6px 10px; font-size: 12px; cursor: pointer;
}
.ldp-btn-ghost:hover:not(:disabled) { background: #F3F4F6; }
.ldp-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

/* Body scroll area */
.ldp-body {
  flex: 1; overflow-y: auto;
  padding: 0;
}
.ldp-loading-msg { padding: 60px; text-align: center; color: #6B7280; }
.ldp-err {
  padding: 20px;
  background: #FEF2F2; color: #991B1B;
  border-radius: 8px; margin: 16px;
  font-size: 13px;
}

/* Sections */
.ldp-section {
  padding: 16px 22px;
  border-bottom: 1px solid #F3F4F6;
}
.ldp-section:last-child { border-bottom: none; }
.ldp-section-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 10px;
}
.ldp-icon { font-size: 14px; }
.ldp-section-title {
  font-size: 12px; font-weight: 700; color: #0F172A;
  text-transform: uppercase; letter-spacing: 0.4px;
}

/* Custom fields */
.ldp-custom-card {
  background: #FEF9C3;
  border: 1px solid #FDE68A;
  border-radius: 8px;
  padding: 12px 14px;
}
.ldp-custom-row {
  display: flex; padding: 5px 0;
  border-bottom: 1px dashed #FDE68A;
}
.ldp-custom-row.last { border-bottom: none; }
.ldp-custom-key {
  width: 160px; font-size: 12px; color: #713F12;
}
.ldp-custom-val {
  flex: 1; font-size: 13px; font-weight: 700; color: #451A03;
}

/* Source meta */
.ldp-source-card {
  background: #F0F9FF;
  border: 1px solid #BAE6FD;
  border-radius: 8px;
  padding: 12px 14px;
}

.ldp-stats-grid {
  margin-top: 10px;
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;
}
.ldp-stat-mini {
  background: #FAFBFD; border: 1px solid #E5E7EB;
  border-radius: 6px; padding: 8px 10px;
}
.ldp-stat-label {
  font-size: 10px; color: #6B7280; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.ldp-stat-val {
  font-size: 14px; font-weight: 700; color: #0F172A;
  margin-top: 3px;
}
.ldp-stat-sub { font-size: 10.5px; color: #6B7280; margin-top: 1px; }

/* Timeline */
.ldp-timeline {
  background: #FAFBFD; border: 1px solid #E5E7EB;
  border-radius: 8px; padding: 12px 14px;
  font-size: 11.5px;
}
.ldp-time-row {
  display: flex; gap: 10px; padding: 4px 0;
  align-items: center;
}
.ldp-time-check {
  width: 16px; text-align: center;
}
.ldp-time-check.ok { color: #16A34A; }
.ldp-time-check.pending { color: #9CA3AF; }
.ldp-time-label { flex: 1; color: #6B7280; }
.ldp-time-val {
  color: #0F172A; font-weight: 600;
  font-family: monospace; min-width: 90px; text-align: right;
}
.ldp-time-delta {
  font-family: monospace; color: #9CA3AF;
  min-width: 70px; text-align: right;
}
.ldp-time-delta.slow { color: #EA580C; }
.ldp-time-total {
  border-top: 1px solid #E5E7EB;
  margin-top: 6px; padding-top: 8px;
  display: flex; justify-content: space-between;
  font-weight: 700;
}

/* Raw payload */
.ldp-raw {
  background: #0F172A; color: #CBD5E1;
  padding: 12px 14px; border-radius: 7px;
  font-size: 10.5px; line-height: 1.5;
  margin-top: 10px; overflow-x: auto;
  max-height: 240px;
  font-family: monospace;
}
.ldp-raw-actions { display: flex; gap: 6px; margin-top: 8px; }

/* CRM internal */
.ldp-internal-card {
  background: #FAFBFD; border: 1px solid #E5E7EB;
  border-radius: 8px; padding: 12px 14px;
  font-size: 12px;
}
.ldp-int-row {
  display: flex; padding: 4px 0;
  border-bottom: 1px dashed #E5E7EB;
}
.ldp-int-row:last-child { border-bottom: none; }
.ldp-int-key { width: 140px; color: #6B7280; }
.ldp-int-val { flex: 1; color: #0F172A; }
.ldp-mono { font-family: monospace; font-size: 11.5px; }
.ldp-pool-pill {
  background: #DCFCE7; color: #166534;
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  font-weight: 600;
}
.ldp-status { font-weight: 600; color: #0F172A; }
.ldp-link {
  color: #4F46E5; text-decoration: none; font-weight: 600;
}
.ldp-link:hover { text-decoration: underline; }
</style>
