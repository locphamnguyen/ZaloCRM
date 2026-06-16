<!--
  Broadcast Detail View — Màn chi tiết broadcast.
  HS Atlas re-skin 2026-06-06: .mkt-top sticky + .mkt-body, stats .mkt-stats/.mstat,
  status .status .dot, ETA .bar i. KHÔNG đổi logic — chỉ markup/CSS.
  Token global (--brand/--ink/--line/--surface…) + classes .btn/.card/.bar tái dùng từ hs-crm-theme.css.
-->
<template>
  <div class="mbd-page">
    <template v-if="bc">
      <!-- ================== TOPBAR (HS .mkt-top scaffold) ================== -->
      <div class="mkt-top">
        <div class="top-left">
          <div class="crumb">
            <a href="#" @click.prevent="goto('/marketing')">Marketing</a>
            <span class="sep">/</span>
            <a href="#" @click.prevent="goto('/marketing/broadcasts')">Broadcasts</a>
            <span class="sep">/</span>
            <span class="current">{{ bc.name }}</span>
          </div>
          <div class="mtt">
            {{ bc.name }}
            <span class="status" :class="`s-${bc.state}`">
              <span class="dot" :style="{ background: stateDot(bc.state) }"></span>
              {{ stateLabel(bc.state) }}
            </span>
          </div>
          <div class="mts">Tạo lúc {{ fmtFull(bc.createdAt) }} bởi <strong>{{ bc.createdBy?.fullName || '—' }}</strong> · {{ bc.totalRecipients }} KH</div>
        </div>
        <div class="actions">
          <button v-if="bc.state === 'draft'" class="btn btn-primary btn-sm" @click="onStart">
            <v-icon size="16">mdi-play</v-icon> Kích hoạt
          </button>
          <button v-if="bc.state === 'draft'" class="btn btn-danger btn-sm" @click="onDelete">
            <v-icon size="16">mdi-trash-can-outline</v-icon> Xoá
          </button>
          <button v-if="bc.state === 'running'" class="btn btn-ghost btn-sm" @click="onPause">
            <v-icon size="16">mdi-pause</v-icon> Tạm dừng
          </button>
          <button v-if="bc.state === 'paused'" class="btn btn-primary btn-sm" @click="onResume">
            <v-icon size="16">mdi-play</v-icon> Tiếp tục
          </button>
          <button v-if="['running','paused','scheduled'].includes(bc.state)" class="btn btn-danger btn-sm" @click="onCancel">
            <v-icon size="16">mdi-stop</v-icon> Kết thúc
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" title="Cập nhật" @click="loadBc">
            <v-icon size="16">mdi-refresh</v-icon>
          </button>
        </div>
      </div>

      <!-- ================== BODY ================== -->
      <div class="mkt-body">
        <!-- Tab strip -->
        <div class="tabs">
          <button class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">
            <v-icon size="15">mdi-chart-box-outline</v-icon> Tổng quan
          </button>
          <button class="tab" :class="{ active: tab === 'recipients' }" @click="tab = 'recipients'">
            <v-icon size="15">mdi-account-multiple-outline</v-icon> Người nhận <span class="tab-count">{{ bc.totalRecipients }}</span>
          </button>
          <button class="tab" :class="{ active: tab === 'history' }" @click="tab = 'history'">
            <v-icon size="15">mdi-history</v-icon> Lịch sử gửi
          </button>
        </div>

        <!-- Tab Tổng quan -->
        <div v-if="tab === 'overview'">
          <div v-if="bc.state === 'running'" class="eta-bar">
            <v-icon size="16" color="#1786be">mdi-timer-sand</v-icon>
            <span>Đang gửi <strong>{{ bc.sentCount }}/{{ bc.totalRecipients }}</strong>
              · ETA <strong>~{{ etaText }}</strong>
              · Lỗi <strong>{{ bc.failedCount }}</strong>
            </span>
            <div class="bar eta-progress"><i :style="{ width: pct(bc.sentCount, bc.totalRecipients) + '%' }"></i></div>
          </div>

          <!-- Đợt 1 v2 2026-06-05 — Anh chốt 3 trục theo dõi tin nhắn:
               Đã gửi (server) - KH đã nhận (1 tick xám) - KH đã xem (2 tick xanh)
               3 trường lấy từ Zalo SDK delivered_messages + seen_messages events.
          -->
          <div class="mkt-stats">
            <div class="mstat accent-blue">
              <div class="ml-top">Tổng KH</div>
              <div class="mv">{{ bc.totalRecipients }}</div>
              <div class="ml">Sau dedup + skip</div>
            </div>
            <div class="mstat accent-teal">
              <div class="ml-top">Đã gửi</div>
              <div class="mv">{{ bc.sentCount }}</div>
              <div class="ml">{{ pct(bc.sentCount, bc.totalRecipients) }}% tiến độ · server gửi</div>
            </div>
            <div class="mstat accent-purple">
              <div class="ml-top">KH đã nhận</div>
              <div class="mv">{{ bc.deliveredCount ?? 0 }}</div>
              <div class="ml">{{ pct(bc.deliveredCount ?? 0, bc.sentCount) }}% · 1 tick xám</div>
            </div>
            <div class="mstat accent-green">
              <div class="ml-top">KH đã xem</div>
              <div class="mv">{{ bc.seenCount ?? 0 }}</div>
              <div class="ml">{{ pct(bc.seenCount ?? 0, bc.sentCount) }}% · 2 tick xanh</div>
            </div>
            <div class="mstat accent-red">
              <div class="ml-top">Lỗi</div>
              <div class="mv">{{ bc.failedCount }}</div>
              <div class="ml">{{ failPct }}% — chặn / lỗi nick</div>
            </div>
            <div class="mstat accent-orange">
              <div class="ml-top">Chờ gửi</div>
              <div class="mv">{{ Math.max(0, bc.totalRecipients - bc.sentCount - bc.failedCount) }}</div>
              <div class="ml">Trong queue</div>
            </div>
          </div>

          <div class="phase-row">
            <div class="card card-pad phase-card">
              <h4><v-icon size="16">mdi-target</v-icon> Đối tượng</h4>
              <div class="phase-sub">{{ audSourceDesc }}</div>
              <pre class="seg-preview">{{ JSON.stringify(bc.segmentSpec, null, 2) }}</pre>
            </div>
            <div class="card card-pad phase-card">
              <h4><v-icon size="16">mdi-text-box-outline</v-icon> Nội dung</h4>
              <div class="phase-sub">Khối: <strong>{{ bc.block?.name || '—' }}</strong></div>
              <div class="sample-card">{{ contentPreview }}</div>
            </div>
          </div>
        </div>

        <!-- Tab Recipients (placeholder Đợt 2) -->
        <div v-if="tab === 'recipients'" class="card section">
          <div class="card-head"><h3>Người nhận</h3></div>
          <div class="empty-state-tab">
            <v-icon size="40" color="#97a0b3">mdi-account-multiple-outline</v-icon>
            <div>Bảng người nhận chi tiết — Đợt 2 ship</div>
          </div>
        </div>

        <!-- Tab History (placeholder Đợt 2) -->
        <div v-if="tab === 'history'" class="card section">
          <div class="card-head"><h3>Lịch sử gửi</h3></div>
          <div class="empty-state-tab">
            <v-icon size="40" color="#97a0b3">mdi-history</v-icon>
            <div>Log sự kiện worker — Đợt 2 ship</div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="loading">
      <div v-if="loadError" class="empty-state-tab">
        <v-icon size="40" color="#f04438">mdi-alert-circle-outline</v-icon>
        <div>{{ loadError }}</div>
      </div>
      <div v-else class="empty-state-tab">
        <v-icon size="34" class="spin" color="#97a0b3">mdi-loading</v-icon>
        <div>Đang tải...</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getBroadcast, startBroadcast, pauseBroadcast, resumeBroadcast, cancelBroadcast, deleteBroadcast, type Broadcast, type BroadcastState } from '@/api/automation/broadcasts';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();
const bc = ref<Broadcast | null>(null);
const tab = ref<'overview' | 'recipients' | 'history'>('overview');
const loadError = ref('');

async function loadBc() {
  loadError.value = '';
  try {
    const id = route.params.id as string;
    bc.value = await getBroadcast(id);
  } catch (err: any) {
    loadError.value = err?.response?.data?.error || 'Không tải được broadcast';
  }
}

function goto(p: string) { router.push(p); }
function stateLabel(s: BroadcastState): string { return ({ draft: 'Nháp', scheduled: 'Hẹn lịch', running: 'Đang chạy', paused: 'Tạm dừng', completed: 'Hoàn tất', cancelled: 'Đã huỷ' } as Record<string, string>)[s] || s; }
// Màu dot trạng thái (HS .status .dot) theo state.
function stateDot(s: BroadcastState): string { return ({ running: 'var(--success)', scheduled: 'var(--warning)', paused: 'var(--ink-4)', completed: 'var(--info)', draft: 'var(--chip-purple)', cancelled: 'var(--error)' } as Record<string, string>)[s] || 'var(--ink-4)'; }
function fmtFull(s: string): string { const d = new Date(s); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
function pct(a: number, b: number): number { return b === 0 ? 0 : Math.round((a / b) * 100); }

const failPct = computed(() => bc.value && bc.value.sentCount > 0 ? Math.round((bc.value.failedCount / bc.value.sentCount) * 100) : 0);

const etaText = computed(() => {
  if (!bc.value || bc.value.sentCount === 0 || !bc.value.startedAt) return '—';
  const remaining = bc.value.totalRecipients - bc.value.sentCount;
  if (remaining <= 0) return 'Hoàn tất';
  const elapsedMs = Date.now() - new Date(bc.value.startedAt).getTime();
  const msPerKH = elapsedMs / bc.value.sentCount;
  const remainingMs = remaining * msPerKH;
  const min = Math.round(remainingMs / 60000);
  return min < 60 ? `${min} phút` : `${Math.floor(min/60)}h${min%60}m`;
});

const audSourceDesc = computed(() => {
  if (!bc.value) return '';
  const s = bc.value.segmentSpec as any;
  const lookup: Record<string, string> = {
    manual: `Thủ công · ${(s.contactIds || []).length} KH`,
    'customer-list': `Tệp KH (#${(s.listId || '').slice(0, 8)}…)`,
    tag: `Tag CRM (${(s.tagIds || []).length} tag, match=${s.match || 'any'})`,
    'preset-segment': `Pre-set: ${s.presetKey}`,
    filter: 'Filter tuỳ chỉnh',
  };
  return lookup[s.kind] || s.kind;
});

const contentPreview = computed(() => {
  if (!bc.value?.block) return '—';
  const c = bc.value.block.content as any;
  const tv = c?.textVariants;
  if (Array.isArray(tv) && tv.length > 0) return tv[0].slice(0, 200);
  return '—';
});

async function onStart() {
  if (!(await confirm({ title: 'Bắt đầu gửi broadcast?', tone: 'primary', confirmText: 'Bắt đầu gửi', cancelText: 'Hủy' }))) return;
  try { await startBroadcast(bc.value!.id); await loadBc(); } catch (e: any) { toast.error(e?.response?.data?.error || 'Có lỗi xảy ra, thử lại sau.', 5000); }
}
async function onPause() { if (!(await confirm({ title: 'Tạm dừng broadcast?', tone: 'danger', confirmText: 'Tạm dừng', cancelText: 'Hủy' }))) return; await pauseBroadcast(bc.value!.id); await loadBc(); }
async function onResume() { if (!(await confirm({ title: 'Tiếp tục gửi broadcast?', tone: 'primary', confirmText: 'Tiếp tục', cancelText: 'Hủy' }))) return; await resumeBroadcast(bc.value!.id); await loadBc(); }
async function onCancel() { if (!(await confirm({ title: 'Huỷ broadcast?', message: 'KHÔNG thể hoàn tác.', tone: 'danger', confirmText: 'Huỷ broadcast', cancelText: 'Hủy' }))) return; await cancelBroadcast(bc.value!.id); await loadBc(); }
async function onDelete() { if (!(await confirm({ title: 'Xoá draft?', tone: 'danger', confirmText: 'Xoá', cancelText: 'Hủy' }))) return; await deleteBroadcast(bc.value!.id); router.push('/marketing/broadcasts'); }

onMounted(() => { loadBc(); });
</script>

<style scoped>
.mbd-page { width: 100%; font-size: 13px; color: var(--ink); }

/* ----- Topbar (.mkt-top dùng class global; chỉ thêm layout cục bộ) ----- */
.mkt-top { align-items: flex-start; }
.top-left { flex: 1; min-width: 0; }
.mkt-top .mtt { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.actions { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

/* Breadcrumb */
.crumb { font-size: 12px; color: var(--ink-3); }
.crumb a { color: var(--ink-3); text-decoration: none; }
.crumb a:hover { color: var(--brand); }
.crumb .sep { margin: 0 6px; color: var(--ink-4); }
.crumb .current { color: var(--ink-2); font-weight: 500; }

/* Status pill màu nền theo state (dùng .status .dot global cho chấm) */
.status { padding: 3px 10px; border-radius: var(--r-xs); white-space: nowrap; }
.s-running   { background: var(--success-soft);   color: #157f3c; }
.s-scheduled { background: var(--warning-soft);   color: #b45309; }
.s-paused    { background: var(--surface-3);      color: var(--ink-2); }
.s-completed { background: var(--info-soft);      color: var(--brand-700); }
.s-draft     { background: var(--chip-purple-bg); color: #6d28d9; }
.s-cancelled { background: var(--error-soft);     color: #c0392b; }

/* Tab strip */
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 18px; padding: 0 2px; }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; font-size: 13px; font-weight: 600; color: var(--ink-3); cursor: pointer; }
.tab:hover { color: var(--ink-2); }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); }
.tab-count { margin-left: 4px; font-size: 11px; color: var(--ink-3); font-weight: 400; font-family: var(--mono); }

/* ETA bar — banner khi đang gửi (.bar i dùng class global cho thanh tiến độ) */
.eta-bar { background: var(--brand-softer); border: 1px solid var(--brand-soft); border-radius: var(--r-sm); padding: 10px 14px; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--ink-2); }
.eta-bar strong { color: var(--brand); font-family: var(--mono); }
.eta-progress { width: 160px; flex: none; margin-left: auto; }
.eta-progress i { background: var(--brand); }

/* Stats (.mkt-stats/.mstat/.mv/.ml dùng class global; chỉ thêm 6 cột + border-top accent) */
.mkt-stats { grid-template-columns: repeat(6, 1fr); }
.mstat { border-top: 3px solid var(--brand); }
.mstat.accent-blue   { border-top-color: var(--brand); }
.mstat.accent-teal   { border-top-color: var(--info); }
.mstat.accent-purple { border-top-color: var(--chip-purple); }
.mstat.accent-green  { border-top-color: var(--success); }
.mstat.accent-red    { border-top-color: var(--error); }
.mstat.accent-orange { border-top-color: var(--warning); }
.mstat .ml-top { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-3); margin-bottom: 4px; }
.mstat .mv { line-height: 1.1; }

/* Phase cards (.card/.card-pad global) */
.phase-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.phase-card h4 { margin: 0 0 10px 0; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.phase-sub { font-size: 12px; color: var(--ink-3); margin-bottom: 12px; }
.seg-preview { background: var(--surface-3); padding: 10px; border-radius: var(--r-xs); font-size: 11px; font-family: var(--mono); overflow-x: auto; margin: 0; color: var(--ink-2); }
.sample-card { background: var(--surface-3); padding: 10px 12px; border-radius: var(--r-xs); font-size: 12px; line-height: 1.5; color: var(--ink-2); }

/* Section card (placeholder tabs) */
.section .card-head h3 { margin: 0; font-size: 14px; font-weight: 700; }
.empty-state-tab { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 20px; text-align: center; color: var(--ink-3); font-size: 14px; }
.loading { padding: 80px; text-align: center; color: var(--ink-3); }
</style>
