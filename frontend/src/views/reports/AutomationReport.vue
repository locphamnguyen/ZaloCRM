<script setup lang="ts">
import { api } from '@/api'
import { ref, onMounted, watch, computed } from 'vue'

interface Kpis {
  activeSequences: number
  enrolled: number
  replyRate: number
  friendAcceptRate: number
}
interface Health {
  workerLagSec: number
  stuckTasks: number
  failedRate24h: number
}
interface Sequence {
  id: string
  name: string
  enrolled: number
  sent: number
  replied: number
  completed: number
  replyRatePct: number
}
interface SkipReason {
  reason: string
  count: number
  category: string
}
interface CareOutcome {
  reason: string
  count: number
}
interface Broadcast {
  id: string
  name: string
  totalRecipients: number
  sentPct: number
  successPct: number
  state: string
}
interface AutomationData {
  from: string
  to: string
  kpis: Kpis
  health: Health
  sequences: Sequence[]
  skipReasons: SkipReason[]
  careOutcomes: CareOutcome[]
  broadcasts: Broadcast[]
}

const data = ref<AutomationData | null>(null)
const loading = ref(true)
const range = ref<'today' | '7d' | '30d' | 'quarter'>('30d')
const selectedSeqId = ref<string | null>(null)

const ranges = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: 'quarter', label: 'Quý' },
] as const

function dateRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (range.value === 'today') {
    // from = today start
  } else if (range.value === '7d') {
    from.setDate(from.getDate() - 7)
  } else if (range.value === 'quarter') {
    from.setMonth(from.getMonth() - 3)
  } else {
    from.setDate(from.getDate() - 30)
  }
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

const nf = new Intl.NumberFormat('vi-VN')
const num = (n: number | null | undefined) => nf.format(Math.round(n ?? 0))
function pct(n: number | null | undefined): string {
  const v = n ?? 0
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(v)
}

async function load() {
  loading.value = true
  try {
    const { from, to } = dateRange()
    const res = await api.get('/reports/automation', { params: { from, to } })
    data.value = res.data
    if (data.value?.sequences?.length) {
      const exists = data.value.sequences.some((s) => s.id === selectedSeqId.value)
      if (!exists) selectedSeqId.value = data.value.sequences[0].id
    } else {
      selectedSeqId.value = null
    }
  } catch (e) {
    data.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(range, load)

// ---- Health banner ----
const showHealth = computed(() => {
  const h = data.value?.health
  if (!h) return false
  return (h.stuckTasks ?? 0) > 0 || (h.workerLagSec ?? 0) > 300
})

// ---- Funnel ----
const selectedSequence = computed<Sequence | null>(() => {
  const seqs = data.value?.sequences
  if (!seqs?.length) return null
  return seqs.find((s) => s.id === selectedSeqId.value) ?? seqs[0]
})

interface FunnelStep {
  name: string
  value: number
  widthPct: number
  drop: string
  highlight: boolean
}
const funnelSteps = computed<FunnelStep[]>(() => {
  const s = selectedSequence.value
  if (!s) return []
  const raw = [
    { name: 'Enrolled', value: s.enrolled ?? 0, highlight: false },
    { name: 'Đã gửi', value: s.sent ?? 0, highlight: false },
    { name: 'Phản hồi', value: s.replied ?? 0, highlight: false },
    { name: 'Hoàn thành', value: s.completed ?? 0, highlight: true },
  ]
  const base = raw[0].value || 0
  return raw.map((step, i) => {
    const widthPct = base > 0 ? Math.max(2, Math.round((step.value / base) * 100)) : 0
    let drop = '—'
    if (i > 0) {
      const prev = raw[i - 1].value || 0
      if (prev > 0) {
        const d = ((step.value - prev) / prev) * 100
        drop = (d > 0 ? '+' : '') + pct(d) + '%'
      }
    }
    return { name: step.name, value: step.value, widthPct, drop, highlight: step.highlight }
  })
})

// ---- Skip reasons category → pill class ----
function skipPill(category: string): { cls: string; label: string } {
  switch (category) {
    case 'capacity':
      return { cls: 'danger', label: 'Cạn quota' }
    case 'config_error':
      return { cls: 'danger', label: 'Lỗi' }
    case 'throttle':
      return { cls: 'warn', label: 'Throttle' }
    case 'benign':
      return { cls: 'ok', label: 'Hợp lệ' }
    default:
      return { cls: '', label: category || '—' }
  }
}

// ---- Care outcomes donut ----
const CARE_COLORS: Record<string, string> = {
  deal_won: '#12b76a',
  completed: '#12b76a',
  source_done: '#1786be',
  janitor_silence: '#97a0ac',
  customer_blocked: '#f04438',
  stranger_blocked: '#f04438',
  sale_resolved: '#5bb8e5',
}
const CARE_LABELS: Record<string, string> = {
  deal_won: 'Chốt deal (deal_won)',
  completed: 'Hoàn thành (completed)',
  source_done: 'Xong nguồn (source_done)',
  janitor_silence: 'KH im lặng (janitor_silence)',
  customer_blocked: 'KH chặn (customer_blocked)',
  stranger_blocked: 'Người lạ chặn (stranger_blocked)',
  sale_resolved: 'Sale xử lý (sale_resolved)',
}
function careColor(reason: string): string {
  return CARE_COLORS[reason] ?? '#97a0ac'
}
function careLabel(reason: string): string {
  return CARE_LABELS[reason] ?? reason
}

const careTotal = computed<number>(() =>
  (data.value?.careOutcomes ?? []).reduce((a, c) => a + (c.count ?? 0), 0),
)

interface CareSlice {
  reason: string
  count: number
  color: string
  pctNum: number
}
const careSlices = computed<CareSlice[]>(() => {
  const total = careTotal.value
  if (!total) return []
  return (data.value?.careOutcomes ?? [])
    .filter((c) => (c.count ?? 0) > 0)
    .map((c) => ({
      reason: c.reason,
      count: c.count,
      color: careColor(c.reason),
      pctNum: (c.count / total) * 100,
    }))
})

const careDonutStyle = computed<string>(() => {
  const slices = careSlices.value
  if (!slices.length) return '#eef1f6'
  let acc = 0
  const stops: string[] = []
  slices.forEach((s) => {
    const start = acc
    acc += s.pctNum
    stops.push(`${s.color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`)
  })
  return `conic-gradient(${stops.join(',')})`
})

// ---- Broadcast state → pill ----
function broadcastPill(state: string): { cls: string; label: string } {
  const s = (state || '').toLowerCase()
  if (s === 'completed' || s === 'done' || s === 'finished')
    return { cls: 'ok', label: 'Hoàn tất' }
  if (s === 'running' || s === 'active' || s === 'sending')
    return { cls: 'brand', label: 'Đang chạy' }
  if (s === 'throttled' || s === 'throttle') return { cls: 'warn', label: 'Throttle' }
  if (s === 'failed' || s === 'error') return { cls: 'danger', label: 'Lỗi' }
  if (s === 'paused') return { cls: 'warn', label: 'Tạm dừng' }
  if (s === 'scheduled' || s === 'pending') return { cls: '', label: 'Chờ' }
  return { cls: '', label: state || '—' }
}

function successPillCls(p: number): string {
  if (p >= 90) return 'ok'
  if (p >= 70) return 'warn'
  return 'danger'
}
</script>

<template>
  <div class="rpt-scope">
    <div class="rpt">
      <!-- HEAD -->
      <div class="rpt-head">
        <div class="rpt-titles">
          <div class="ic"><v-icon icon="mdi-cog-sync-outline" /></div>
          <div>
            <div class="rpt-h1">Automation &amp; Chăm sóc</div>
            <div class="rpt-sub">
              Kịch bản &amp; Mục tiêu nào đang hiệu quả, ai bị bỏ qua và vì sao — soi phễu
              sequence, lý do skip/throttle và kết quả từng care-session để tối ưu chăm sóc tự
              động.
            </div>
          </div>
        </div>
        <div class="rpt-actions">
          <button class="rk-btn ghost" :disabled="loading" @click="load">
            <v-icon icon="mdi-refresh" /> Làm mới
          </button>
          <button class="rk-btn" disabled title="Sắp có">
            <v-icon icon="mdi-file-excel-outline" /> Xuất Excel
          </button>
        </div>
      </div>

      <!-- FILTERS -->
      <div class="rpt-filters">
        <div class="seg">
          <button
            v-for="r in ranges"
            :key="r.key"
            :class="{ on: range === r.key }"
            @click="range = r.key"
          >
            {{ r.label }}
          </button>
        </div>
        <div class="fl-spacer"></div>
        <div v-if="data && data.sequences && data.sequences.length > 1" class="fl-sel">
          <v-icon icon="mdi-script-text-outline" />
          <select
            v-model="selectedSeqId"
            style="border:0;background:transparent;font:inherit;font-weight:600;color:inherit;cursor:pointer;outline:none"
          >
            <option v-for="s in data.sequences" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>

      <!-- LOADING -->
      <div v-if="loading" class="rk-loading">
        <v-icon icon="mdi-loading" class="mdi-spin" /> Đang tải báo cáo…
      </div>

      <!-- EMPTY -->
      <div v-else-if="!data" class="rk-empty">Không có dữ liệu báo cáo.</div>

      <template v-else>
        <!-- KPI ROW -->
        <div class="grid g-4" style="margin-bottom:18px">
          <div class="kpi">
            <div class="top">
              <span class="label">Sequence đang chạy</span>
              <span class="kic"><v-icon icon="mdi-script-text-play-outline" /></span>
            </div>
            <div class="val">{{ num(data.kpis.activeSequences) }}</div>
          </div>
          <div class="kpi">
            <div class="top">
              <span class="label">Đã enroll</span>
              <span class="kic"><v-icon icon="mdi-account-arrow-right-outline" /></span>
            </div>
            <div class="val">{{ num(data.kpis.enrolled) }}</div>
          </div>
          <div class="kpi accent-ok">
            <div class="top">
              <span class="label">Tỉ lệ phản hồi</span>
              <span class="kic"><v-icon icon="mdi-message-reply-text-outline" /></span>
            </div>
            <div class="val">{{ pct(data.kpis.replyRate) }}<span class="u">%</span></div>
          </div>
          <div class="kpi">
            <div class="top">
              <span class="label">Mời kết bạn nhận</span>
              <span class="kic"><v-icon icon="mdi-account-check-outline" /></span>
            </div>
            <div class="val">{{ pct(data.kpis.friendAcceptRate) }}<span class="u">%</span></div>
          </div>
        </div>

        <!-- HEALTH BANNER -->
        <div v-if="showHealth" class="alert warn" style="margin-bottom:18px">
          <v-icon icon="mdi-heart-pulse" />
          <div>
            <b>{{ num(data.health.stuckTasks) }} task kẹt</b> · worker chậm
            {{ num(data.health.workerLagSec) }}s · lỗi 24h {{ pct(data.health.failedRate24h) }}%
          </div>
        </div>

        <!-- FUNNEL + SKIP ROW -->
        <div class="grid g-3" style="margin-bottom:14px">
          <div class="card col-2">
            <div class="card-h">
              <div class="t">
                <v-icon icon="mdi-filter-outline" /> Phễu sequence:
                {{ selectedSequence ? selectedSequence.name : '—' }}
              </div>
              <div class="meta" v-if="selectedSequence">
                {{ num(selectedSequence.enrolled) }} enrolled
              </div>
            </div>
            <div class="card-b">
              <div v-if="funnelSteps.length" class="funnel">
                <div v-for="(st, i) in funnelSteps" :key="st.name" class="stp">
                  <div class="nm">{{ st.name }}</div>
                  <div class="track">
                    <i
                      :style="{
                        width: st.widthPct + '%',
                        ...(st.highlight
                          ? { background: 'linear-gradient(90deg,#12b76a,#5fd99a)' }
                          : {}),
                      }"
                    ></i>
                    <div class="vv">{{ num(st.value) }}</div>
                  </div>
                  <div class="drop" :class="{ muted: i === 0 }">{{ st.drop }}</div>
                </div>
              </div>
              <div v-else class="rk-empty">Chưa có sequence nào.</div>
            </div>
          </div>

          <div class="card">
            <div class="card-h">
              <div class="t"><v-icon icon="mdi-debug-step-over" /> Lý do bỏ qua (skip)</div>
            </div>
            <div class="card-b" style="padding:0">
              <table v-if="data.skipReasons && data.skipReasons.length" class="tbl">
                <thead>
                  <tr>
                    <th>Lý do</th>
                    <th class="num">Số lần</th>
                    <th>Nhóm</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="sr in data.skipReasons" :key="sr.reason">
                    <td>{{ sr.reason }}</td>
                    <td class="num">{{ num(sr.count) }}</td>
                    <td>
                      <span class="pill" :class="skipPill(sr.category).cls">{{
                        skipPill(sr.category).label
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="rk-empty">Không có lý do bỏ qua.</div>
            </div>
          </div>
        </div>

        <!-- CARE-SESSION + BROADCAST ROW -->
        <div class="grid g-2">
          <div class="card">
            <div class="card-h">
              <div class="t"><v-icon icon="mdi-account-heart-outline" /> Kết quả Care-session</div>
              <div class="meta">{{ num(careTotal) }} phiên</div>
            </div>
            <div class="card-b">
              <div
                v-if="careSlices.length"
                style="display:flex;align-items:center;gap:26px;flex-wrap:wrap"
              >
                <div class="donut" :style="{ background: careDonutStyle }">
                  <div class="hole"><b>{{ num(careTotal) }}</b><span>phiên</span></div>
                </div>
                <div class="legend" style="flex:1;min-width:200px">
                  <div v-for="s in careSlices" :key="s.reason" class="li">
                    <span class="sw" :style="{ background: s.color }"></span>
                    <span class="b">{{ careLabel(s.reason) }}</span>
                    <span class="fl-spacer" style="flex:1"></span>
                    <span class="b">{{ num(s.count) }}</span>
                    <span class="muted" style="margin-left:6px">{{ pct(s.pctNum) }}%</span>
                  </div>
                </div>
              </div>
              <div v-else class="rk-empty">Chưa có care-session nào.</div>
            </div>
          </div>

          <div class="card">
            <div class="card-h">
              <div class="t"><v-icon icon="mdi-bullhorn-outline" /> Broadcast gần đây</div>
            </div>
            <div class="card-b" style="padding:0">
              <table v-if="data.broadcasts && data.broadcasts.length" class="tbl">
                <thead>
                  <tr>
                    <th>Broadcast</th>
                    <th class="num">Đối tượng</th>
                    <th class="num">Đã gửi</th>
                    <th class="num">Thành công</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="b in data.broadcasts" :key="b.id">
                    <td>
                      <div class="cellname">
                        <v-icon icon="mdi-bullhorn-outline" style="color:var(--rk-brand)" />
                        {{ b.name }}
                      </div>
                    </td>
                    <td class="num">{{ num(b.totalRecipients) }}</td>
                    <td class="num">{{ pct(b.sentPct) }}%</td>
                    <td class="num">
                      <span class="pill" :class="successPillCls(b.successPct)"
                        >{{ pct(b.successPct) }}%</span
                      >
                    </td>
                    <td>
                      <span class="pill" :class="broadcastPill(b.state).cls">{{
                        broadcastPill(b.state).label
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="rk-empty">Chưa có broadcast nào.</div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
