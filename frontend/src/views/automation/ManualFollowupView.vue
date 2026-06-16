<!--
═══════════════════════════════════════════════════════════════════════
 ManualFollowupView — trang full "Bám đuổi khách hàng thủ công" (2026-06-07)
═══════════════════════════════════════════════════════════════════════
 Mục tiêu hệ thống gom mọi KH sale gắn luồng tay từ chat. Bảng full 12 cột,
 cuộn ngang, ghim cột KH. Theme Atlas v2 / HS Holding (token --brand/--ink…).
 Mockup: ~/.gstack/projects/locphamnguyen-ZaloCRM/designs/manual-followup-page-20260607/

 API: GET /automation/manual-followup/summary + /contacts
 Action: pause/stop dùng endpoint trigger có sẵn; "Mở chat" → router /chat.
-->
<template>
  <div class="mf-page">
    <!-- breadcrumb -->
    <div class="mf-crumb">
      <a @click="goBack">Mục tiêu</a><span class="sep">/</span><span>Bám đuổi khách hàng thủ công</span>
    </div>

    <!-- topbar -->
    <div class="mf-top">
      <div class="mf-tt">
        <span class="mf-tt-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        </span>
        <div class="mf-tt-text">
          <h1>Bám đuổi khách hàng thủ công <span class="mf-tag">Mục tiêu hệ thống</span></h1>
          <p>Khách hàng được sale gắn luồng bám đuổi thủ công ngay từ màn chat</p>
        </div>
      </div>
      <button class="mf-back" @click="goBack"><v-icon size="16">mdi-arrow-left</v-icon> Quay lại Mục tiêu</button>
    </div>

    <!-- stat band -->
    <div class="mf-stats">
      <div class="mf-stat"><div class="l">Tổng lần gắn</div><div class="v num">{{ formatNum(counts.total) }}</div><div class="s">90 ngày · mỗi lần gắn 1 dòng</div></div>
      <div class="mf-stat run"><div class="l"><span class="d run"></span> Đang chạy</div><div class="v num">{{ formatNum(counts.active) }}</div><div class="s">đang trong luồng</div></div>
      <div class="mf-stat done"><div class="l"><span class="d done"></span> Đã hoàn thành</div><div class="v num">{{ formatNum(counts.completed) }}</div><div class="s">đi hết chuỗi</div></div>
      <div class="mf-stat stop"><div class="l"><span class="d stop"></span> Đã dừng</div><div class="v num">{{ formatNum(counts.stopped) }}</div><div class="s">sale dừng / KH chặn</div></div>
      <div class="mf-stat"><div class="l">Tỉ lệ phản hồi</div><div class="v num">{{ replyRate }}%</div><div class="s">KH có trả lời</div></div>
    </div>

    <!-- toolbar -->
    <div class="mf-toolbar">
      <div class="mf-chips">
        <button v-for="f in FILTERS" :key="f.key" class="mf-chip" :class="{ on: statusFilter === f.key }" @click="statusFilter = f.key">
          <span v-if="f.dot" class="d" :class="f.dot"></span>{{ f.label }}<span class="n">{{ counts[f.countKey] ?? 0 }}</span>
        </button>
      </div>
      <div class="mf-spacer"></div>
      <div class="mf-search">
        <span class="si"><v-icon size="15">mdi-magnify</v-icon></span>
        <input v-model="search" type="text" placeholder="Tìm theo tên KH, luồng, sale..." />
      </div>
    </div>

    <!-- table -->
    <div class="mf-table-card">
      <div v-if="loading" class="mf-loading"><div class="mf-spin" /><p>Đang tải...</p></div>
      <div v-else-if="filteredRows.length === 0" class="mf-empty">
        <v-icon size="34" color="grey-lighten-1">mdi-account-off-outline</v-icon>
        <p>{{ search || statusFilter !== 'all' ? 'Không có KH khớp bộ lọc.' : 'Chưa có KH nào được gắn tay.' }}</p>
      </div>
      <table v-else>
        <thead>
          <tr>
            <th class="center sticky s1">#</th>
            <th class="sticky s2">Khách hàng</th>
            <th>Luồng kịch bản <span class="th-sub">/ lần gắn</span></th>
            <th>Tiến trình</th>
            <th>Trạng thái</th>
            <th>Nick chăm</th>
            <th>Sale gắn</th>
            <th>Lý do</th>
            <th>Ngày gắn</th>
            <th>Lần gửi gần nhất</th>
            <th>Lần gửi tiếp</th>
            <th class="right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, idx) in filteredRows" :key="r.enrollmentId" :class="{ 'row-stop': r.state === 'stopped' }">
            <td class="center num muted sticky s1">{{ idx + 1 }}</td>
            <td class="sticky s2">
              <div class="kh">
                <span class="kh-av" :class="{ off: r.state === 'stopped' }">{{ initials(r.contactName) }}</span>
                <div>
                  <div class="kh-name">{{ r.contactName }}</div>
                  <div v-if="r.contactPhone" class="kh-id">{{ r.contactPhone }}</div>
                </div>
              </div>
            </td>
            <td>
              <div class="seq">
                <span class="mi"><v-icon size="14">mdi-message-text-outline</v-icon></span>
                <span class="seq-name">{{ r.sequenceName || 'Luồng bám đuổi' }}</span>
                <span class="seq-times" :title="`Lần gắn thứ ${r.enrollSeq} của luồng này cho khách`">Lần {{ r.enrollSeq }}</span>
              </div>
            </td>
            <td>
              <div v-if="r.totalSteps" class="prog">
                <div class="prog-bar"><div class="prog-fill" :class="r.state" :style="{ width: progPct(r) + '%' }" /></div>
                <span class="prog-txt">{{ Math.min(r.totalSteps, r.currentStep || 0) }}/{{ r.totalSteps }}</span>
              </div>
              <span v-else-if="r.progressUnknown" class="muted unk" title="Lần gắn cũ — hệ thống chưa lưu tiến độ từng bước">không rõ tiến độ</span>
              <span v-else class="muted">—</span>
            </td>
            <td><span class="badge" :class="r.state">{{ stateLabel(r.state) }}</span></td>
            <td>
              <span v-if="r.nickName" class="nick-chip">
                <span class="nick-av" :class="{ off: r.state === 'stopped' }">{{ initials(r.nickName) }}</span>{{ r.nickName }}
              </span>
              <span v-else class="muted">—</span>
            </td>
            <td class="sale">{{ r.enrolledByName || '—' }}</td>
            <td><span class="reason" :title="r.enrollReason || ''">{{ r.enrollReason || '—' }}</span></td>
            <td>
              <div class="dt">{{ fmtDate(r.enrolledAt) }}</div>
              <div class="dt-sub">{{ fmtTime(r.enrolledAt) }}</div>
            </td>
            <td>
              <div v-if="r.lastSentAt" class="dt">{{ fmtDateTime(r.lastSentAt) }}</div>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-if="r.state === 'active' && r.nextRunAt" class="next">⏰ {{ fmtRelative(r.nextRunAt) }}</span>
              <span v-else-if="r.state === 'paused'" class="next off">⏸ KH tương tác</span>
              <span v-else-if="r.state === 'completed'" class="next off">✓ Đã đi hết chuỗi</span>
              <span v-else class="next off">⏹ Đã dừng</span>
            </td>
            <td>
              <div class="acts">
                <template v-if="r.state === 'active'">
                  <button class="ibtn warn" :disabled="r.busy" title="Tạm dừng 24h" @click="onAction(r, 'pause')"><v-icon size="14">mdi-pause</v-icon></button>
                  <button class="ibtn danger" :disabled="r.busy" title="Dừng hẳn" @click="onAction(r, 'stop')"><v-icon size="14">mdi-stop</v-icon></button>
                </template>
                <template v-else-if="r.state === 'paused'">
                  <button class="ibtn" :disabled="r.busy" title="Tiếp tục ngay" @click="onAction(r, 'resume')"><v-icon size="14">mdi-play</v-icon></button>
                  <button class="ibtn danger" :disabled="r.busy" title="Dừng hẳn" @click="onAction(r, 'stop')"><v-icon size="14">mdi-stop</v-icon></button>
                </template>
                <button class="ibtn" title="Mở chat với KH" @click="openChat(r)"><v-icon size="14">mdi-message-text-outline</v-icon></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <v-snackbar v-model="toastOpen" :color="toastColor" timeout="3000" location="bottom right">{{ toastMsg }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useConfirm } from '@/composables/use-confirm';

const { confirm, confirmWithReason } = useConfirm();

const router = useRouter();

type State = 'active' | 'paused' | 'completed' | 'stopped';
interface Row {
  enrollmentId: string; enrollSeq: number; // 2026-06-15: mỗi LẦN GẮN 1 dòng (anh chốt)
  contactId: string; contactName: string; contactPhone: string | null;
  sequenceName: string | null; enrolledByName: string | null; enrollReason: string | null;
  nickName: string | null; state: State; currentStep: number | null; totalSteps: number | null;
  enrolledAt: string; lastSentAt: string | null; nextRunAt: string | null;
  progressUnknown?: boolean; busy?: boolean;
}

const FILTERS = [
  { key: 'all', label: 'Tất cả', dot: '', countKey: 'total' as const },
  { key: 'active', label: 'Đang chạy', dot: 'run', countKey: 'active' as const },
  { key: 'completed', label: 'Đã xong', dot: 'done', countKey: 'completed' as const },
  { key: 'stopped', label: 'Đã dừng', dot: 'stop', countKey: 'stopped' as const },
] as const;

const rows = ref<Row[]>([]);
const loading = ref(true);
const statusFilter = ref<string>('all');
const search = ref('');
const triggerId = ref<string | null>(null);
const counts = ref<{ total: number; active: number; completed: number; stopped: number }>({ total: 0, active: 0, completed: 0, stopped: 0 });
const replyRate = ref(0);

const toastOpen = ref(false); const toastMsg = ref(''); const toastColor = ref<'success' | 'error'>('success');
function toast(m: string, c: 'success' | 'error' = 'success') { toastMsg.value = m; toastColor.value = c; toastOpen.value = true; }

const STATE_LABEL: Record<State, string> = { active: 'Đang chạy', paused: 'Tạm dừng', completed: 'Đã xong', stopped: 'Đã dừng' };
function stateLabel(s: State): string { return STATE_LABEL[s] ?? ''; }

const filteredRows = computed(() => {
  let list = rows.value;
  const f = statusFilter.value;
  if (f !== 'all') list = list.filter((r) => (f === 'active' ? (r.state === 'active' || r.state === 'paused') : r.state === f));
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((r) =>
    r.contactName.toLowerCase().includes(q) ||
    (r.sequenceName ?? '').toLowerCase().includes(q) ||
    (r.enrolledByName ?? '').toLowerCase().includes(q),
  );
  return list;
});

// ── helpers ──
function formatNum(n: number): string { return (n ?? 0).toLocaleString('vi-VN'); }
function initials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/);
  return ((parts[parts.length - 1]?.[0] ?? '') + (parts.length > 1 ? parts[0][0] : '')).toUpperCase() || '?';
}
function progPct(r: Row): number {
  if (!r.totalSteps) return 0;
  if (r.state === 'completed') return 100;
  return Math.min(100, Math.round(((r.currentStep || 0) / r.totalSteps) * 100));
}
const TZ = { timeZone: 'Asia/Ho_Chi_Minh' } as const;
function fmtDate(iso: string): string { return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', ...TZ }); }
function fmtTime(iso: string): string { return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', ...TZ }); }
function fmtDateTime(iso: string): string { return `${fmtDate(iso)} ${fmtTime(iso)}`; }
function fmtRelative(iso: string): string {
  const d = new Date(iso); const diffH = (d.getTime() - Date.now()) / 3600_000;
  const hhmm = fmtTime(iso);
  if (diffH >= 0 && diffH < 24) return `${hhmm} hôm nay`;
  if (diffH >= 24 && diffH < 48) return `${hhmm} mai`;
  return fmtDateTime(iso);
}

// ── load ──
async function load() {
  loading.value = true;
  try {
    const [sumRes, listRes] = await Promise.all([
      api.get<{ triggerId: string | null; counts: typeof counts.value }>('/automation/manual-followup/summary'),
      api.get<{ triggerId: string | null; contacts: Row[] }>('/automation/manual-followup/contacts'),
    ]);
    counts.value = sumRes.data.counts ?? { total: 0, active: 0, completed: 0, stopped: 0 };
    triggerId.value = listRes.data.triggerId;
    rows.value = (listRes.data.contacts ?? []).map((r) => ({ ...r, busy: false }));
    // Tỉ lệ phản hồi tạm tính = (active+completed có lastSent) — placeholder tới khi BE trả replyRate thật.
    replyRate.value = counts.value.total > 0 ? Math.round((counts.value.completed / counts.value.total) * 100) : 0;
  } catch (err) {
    console.error('[manual-followup] load failed', err);
    toast('Không tải được danh sách', 'error');
  } finally {
    loading.value = false;
  }
}

// ── actions ──
async function onAction(r: Row, kind: 'pause' | 'stop' | 'resume') {
  if (r.busy || !triggerId.value) return;
  const tid = triggerId.value;
  if (kind === 'pause') {
    if (!(await confirm({
      title: `Tạm dừng 24h bám đuổi cho "${r.contactName}"?`,
      message: 'Hết 24h luồng tự chạy lại.',
      confirmText: 'Tạm dừng 24h',
      cancelText: 'Hủy',
    }))) return;
    r.busy = true;
    try { await api.post(`/automation/triggers/${tid}/contacts/${r.contactId}/pause`, { hours: 24 }); await load(); toast('Đã tạm dừng 24h'); }
    catch { toast('Lỗi tạm dừng', 'error'); } finally { r.busy = false; }
  } else if (kind === 'stop') {
    const res = await confirmWithReason({
      title: `Dừng hẳn bám đuổi cho "${r.contactName}"?`,
      message: 'Luồng sẽ không gửi tin nữa cho khách này.',
      tone: 'danger',
      confirmText: 'Dừng hẳn',
      reasonLabel: 'Lý do dừng',
      reasonPlaceholder: 'VD: khách đã chốt / không quan tâm / sai đối tượng...',
    });
    if (!res.ok || !res.reason.trim()) return;
    r.busy = true;
    try { await api.post(`/automation/triggers/${tid}/contacts/${r.contactId}/stop`, { reason: res.reason.trim() }); await load(); toast('Đã dừng hẳn'); }
    catch { toast('Lỗi dừng', 'error'); } finally { r.busy = false; }
  } else {
    r.busy = true;
    try { await api.post(`/automation/triggers/${tid}/contacts/${r.contactId}/resume`); await load(); toast('Đã tiếp tục'); }
    catch { toast('Lỗi tiếp tục', 'error'); } finally { r.busy = false; }
  }
}

function openChat(r: Row) {
  // Điều hướng tới chat — ChatView tự resolve conversation theo contactId qua query.
  router.push({ name: 'Chat', query: { contactId: r.contactId } });
}
function goBack() { router.push({ name: 'Marketing.MucTieuList' }); }

onMounted(() => { void load(); });
</script>

<style scoped>
.mf-page { padding: 22px 26px; background: var(--surface-2); min-height: 100%; }

.mf-crumb { font-size: 12.5px; color: var(--ink-3); margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
.mf-crumb a { color: var(--brand); text-decoration: none; cursor: pointer; }
.mf-crumb .sep { color: var(--ink-4); }

.mf-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.mf-tt { display: flex; align-items: center; gap: 11px; }
.mf-tt-ic { width: 42px; height: 42px; border-radius: var(--r-md); background: var(--brand-soft); color: var(--brand); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mf-tt-text h1 { font-size: 22px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 9px; }
.mf-tag { font-size: 11px; font-weight: 600; color: var(--ink-3); background: var(--surface-3); border-radius: var(--r-pill); padding: 2px 9px; }
.mf-tt-text p { font-size: 13px; color: var(--ink-3); margin-top: 3px; }
.mf-back { display: inline-flex; align-items: center; gap: 5px; height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); color: var(--ink-2); font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; flex-shrink: 0; }
.mf-back:hover { background: var(--surface-3); }

.mf-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px; }
.mf-stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 13px 16px; }
.mf-stat .l { font-size: 11px; font-weight: 500; color: var(--ink-3); text-transform: uppercase; letter-spacing: .4px; display: flex; align-items: center; gap: 5px; }
.mf-stat .v { font-size: 25px; font-weight: 600; margin-top: 5px; line-height: 1; color: var(--ink); }
.mf-stat.run .v { color: var(--brand); }
.mf-stat.done .v { color: var(--success); }
.mf-stat.stop .v { color: var(--ink-3); }
.mf-stat .s { font-size: 11.5px; color: var(--ink-4); margin-top: 4px; }
.d { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.d.run { background: var(--brand); } .d.done { background: var(--success); } .d.stop { background: var(--ink-4); }

.mf-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.mf-chips { display: flex; gap: 7px; }
.mf-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 13px; border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--surface); font-family: inherit; font-size: 12.5px; font-weight: 500; color: var(--ink-3); cursor: pointer; }
.mf-chip:hover { background: var(--surface-3); }
.mf-chip.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-700); font-weight: 600; }
.mf-chip .n { font-family: var(--mono); font-size: 11px; opacity: .85; }
.mf-spacer { flex: 1; }
.mf-search { position: relative; width: 280px; }
.mf-search input { width: 100%; height: 36px; padding: 0 12px 0 34px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 13px; font-family: inherit; background: var(--surface); color: var(--ink); }
.mf-search input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.mf-search .si { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-4); display: inline-flex; }

.mf-table-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); overflow-x: auto; }
.mf-loading, .mf-empty { text-align: center; padding: 48px 20px; color: var(--ink-3); font-size: 13px; }
.mf-spin { width: 26px; height: 26px; border: 2px solid var(--surface-3); border-top-color: var(--brand); border-radius: 50%; margin: 0 auto 12px; animation: mf-spin .8s linear infinite; }
@keyframes mf-spin { to { transform: rotate(360deg); } }

.num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
table { width: 100%; min-width: 1280px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
thead { background: var(--surface-2); }
th { padding: 11px 14px; text-align: left; font-size: 11px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: .4px; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--surface-2); }
th.center { text-align: center; } th.right { text-align: right; }
td { padding: 12px 14px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); vertical-align: middle; background: var(--surface); }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--surface-2); }
.row-stop td { background: var(--surface-2); }
.row-stop:hover td { background: var(--surface-3); }
th.sticky, td.sticky { position: sticky; z-index: 2; }
th.s1, td.s1 { left: 0; width: 44px; }
th.s2, td.s2 { left: 44px; min-width: 180px; box-shadow: 1px 0 0 var(--line); }
thead th.sticky { z-index: 3; }

.kh { display: flex; align-items: center; gap: 9px; }
.kh-av { width: 30px; height: 30px; border-radius: 50%; background: var(--brand-soft); color: var(--brand-700); font-weight: 600; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.kh-av.off { background: var(--surface-3); color: var(--ink-3); }
.kh-name { font-weight: 600; color: var(--ink); }
.kh-id { font-size: 11px; color: var(--ink-4); }

.seq { display: flex; align-items: center; gap: 6px; min-width: 0; }
.seq .mi { color: var(--brand); display: inline-flex; flex-shrink: 0; }
.seq-name { color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.seq-times { flex-shrink: 0; font-size: 10.5px; font-weight: 600; color: var(--brand); background: var(--brand-soft); border-radius: var(--r-pill); padding: 1px 7px; }
.th-sub { font-weight: 400; color: var(--ink-4); font-size: 11px; }
.muted.unk { font-style: italic; font-size: 11px; }

.prog { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.prog-bar { flex: 1; height: 5px; background: var(--surface-3); border-radius: var(--r-pill); overflow: hidden; }
.prog-fill { height: 100%; border-radius: var(--r-pill); }
.prog-fill.active { background: var(--brand); } .prog-fill.paused { background: var(--warning); }
.prog-fill.completed { background: var(--success); } .prog-fill.stopped { background: var(--ink-4); }
.prog-txt { font-family: var(--mono); font-size: 11.5px; font-weight: 500; color: var(--ink-2); white-space: nowrap; }

.badge { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: var(--r-pill); white-space: nowrap; }
.badge.active { color: var(--brand-700); background: var(--brand-soft); }
.badge.paused { color: #92400e; background: var(--warning-soft); }
.badge.completed { color: #1b6b46; background: var(--success-soft); }
.badge.stopped { color: var(--ink-3); background: var(--surface-3); }

.sale { color: var(--ink-2); }
.reason { color: var(--ink-3); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.dt { font-family: var(--mono); font-size: 12px; color: var(--ink-2); }
.dt-sub { font-size: 10.5px; color: var(--ink-4); }
.muted { color: var(--ink-4); }
.next { color: var(--brand-700); font-weight: 500; font-size: 12px; white-space: nowrap; }
.next.off { color: var(--ink-4); font-weight: 400; }

.nick-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--ink-2); background: var(--surface-3); border-radius: var(--r-pill); padding: 2px 9px; white-space: nowrap; }
.nick-av { width: 18px; height: 18px; border-radius: 50%; background: var(--brand); color: #fff; font-size: 9px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
.nick-av.off { background: var(--ink-4); }

.acts { display: flex; gap: 5px; justify-content: flex-end; }
.ibtn { width: 28px; height: 28px; border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--surface); color: var(--ink-3); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.ibtn:hover:not(:disabled) { background: var(--surface-3); color: var(--ink); }
.ibtn.warn:hover:not(:disabled) { background: var(--warning-soft); color: #92400e; border-color: #f7d9a3; }
.ibtn.danger:hover:not(:disabled) { background: var(--error-soft); color: var(--error); border-color: #f6c5c1; }
.ibtn:disabled { opacity: .4; cursor: not-allowed; }

@media (max-width: 1100px) {
  .mf-stats { grid-template-columns: repeat(3, 1fr); }
}
</style>
