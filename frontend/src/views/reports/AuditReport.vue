<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<script setup lang="ts">
import { api } from '@/api'
import { ref, onMounted, computed, watch } from 'vue'

type Range = 'today' | '24h' | '7d' | '30d'

const data = ref<any>(null)
const loading = ref(true)
const range = ref<Range>('30d')

const rangeBtns: { key: Range; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: '24h', label: '24 giờ' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
]

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function rangeDates(r: Range): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (r === 'today' || r === '24h') {
    // from = today
  } else if (r === '7d') {
    from.setDate(from.getDate() - 6)
  } else {
    from.setDate(from.getDate() - 29)
  }
  return { from: ymd(from), to: ymd(to) }
}

async function load() {
  loading.value = true
  try {
    const { from, to } = rangeDates(range.value)
    data.value = (await api.get('/reports/audit', { params: { from, to } })).data
  } catch {
    // keep last data / null on failure
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(range, load)

// ---- helpers --------------------------------------------------------------
function n(v: any): string {
  const num = Number(v)
  return Number.isFinite(num) ? num.toLocaleString('vi-VN') : '0'
}

function pct(v: any): string {
  const num = Number(v)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

// ISO ts → "HH:mm DD/MM" in Asia/Ho_Chi_Minh
function fmtTs(ts?: string): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    const parts = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const p: Record<string, string> = {}
    for (const x of parts) p[x.type] = x.value
    return `${p.hour}:${p.minute} ${p.day}/${p.month}`
  } catch {
    return '—'
  }
}

function initials(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AV_COLORS = ['#1786be', '#7a4fb0', '#b0734f', '#4fb09a', '#b04f6e', '#0b5880', '#5bb8e5', '#157f3c']
function avColor(name?: string): string {
  const s = name || ''
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AV_COLORS[h % AV_COLORS.length]
}

// ---- derived data ---------------------------------------------------------
const kpis = computed<any>(() => data.value?.kpis ?? {})
const health = computed<any>(() => data.value?.systemHealth ?? {})

const cronJobs = computed<any[]>(() => health.value?.cronJobs ?? [])
const cronOkCount = computed<number>(() => cronJobs.value.filter((c: any) => c?.ok).length)

const queues = computed<any[]>(() => health.value?.queues ?? [])
const queueMax = computed<number>(() => {
  let m = 0
  for (const q of queues.value) m = Math.max(m, Number(q?.depth) || 0)
  return m || 1
})
function queueW(depth: any): string {
  const num = Number(depth) || 0
  return `${Math.max(2, Math.min(100, (num / queueMax.value) * 100))}%`
}
function queueBarClass(depth: any): string {
  const num = Number(depth) || 0
  const ratio = num / queueMax.value
  if (ratio >= 0.7) return 'bar warn'
  if (ratio <= 0.2) return 'bar ok'
  return 'bar'
}

const errorBreakdown = computed<any[]>(() => health.value?.errorBreakdown ?? [])
function errBarClass(category?: string): string {
  const c = String(category || '').toLowerCase()
  if (c === 'throttle') return 'bar danger'
  if (c === 'capacity') return 'bar warn'
  return 'bar'
}
function errW(p: any): string {
  const num = Number(p)
  if (!Number.isFinite(num)) return '0%'
  return `${Math.max(0, Math.min(100, num))}%`
}

const activity = computed<any[]>(() => data.value?.activity ?? [])
function categoryPill(category?: string): string {
  const c = String(category || '').toLowerCase()
  if (c.includes('trạng') || c.includes('status')) return 'brand'
  return ''
}

const disconnects = computed<any[]>(() => data.value?.disconnects ?? [])
function reasonPill(reason?: string): string {
  const r = String(reason || '').toLowerCase()
  if (r.includes('auth') || r.includes('fail')) return 'danger'
  if (r.includes('passive')) return 'warn'
  return ''
}
function disconnectDot(reason?: string): string {
  const r = String(reason || '').toLowerCase()
  if (r.includes('auth') || r.includes('fail')) return 'danger'
  if (r.includes('passive')) return 'warn'
  return 'idle'
}
</script>

<template>
  <div class="rpt">
    <!-- HEAD -->
    <div class="rpt-head">
      <div class="rpt-titles">
        <div class="ic"><v-icon icon="mdi-shield-check-outline" size="24" /></div>
        <div>
          <div class="rpt-h1">Audit &amp; Sức khỏe hệ thống</div>
          <div class="rpt-sub">
            Ai đổi gì (nhật ký thay đổi) và hệ thống có sự cố không: cron, hàng đợi, nick mất kết nối, lỗi automation.
          </div>
        </div>
      </div>
      <div class="rpt-actions">
        <button class="rk-btn ghost" @click="load">
          <v-icon icon="mdi-refresh" size="16" /> Làm mới
        </button>
        <button class="rk-btn" disabled>
          <v-icon icon="mdi-file-excel-outline" size="16" /> Xuất Excel
        </button>
      </div>
    </div>

    <!-- FILTERS -->
    <div class="rpt-filters">
      <div class="seg">
        <button
          v-for="b in rangeBtns"
          :key="b.key"
          :class="{ on: range === b.key }"
          @click="range = b.key"
        >{{ b.label }}</button>
      </div>
    </div>

    <!-- LOADING -->
    <div v-if="loading && !data" class="rk-loading">
      <v-icon icon="mdi-loading" size="20" /> Đang tải dữ liệu…
    </div>

    <template v-else>
      <!-- KPI ROW -->
      <div class="grid g-4" style="margin-bottom:18px">
        <div class="kpi">
          <div class="top"><span class="label">Thay đổi hôm nay</span><span class="kic"><v-icon icon="mdi-history" size="18" /></span></div>
          <div class="val">{{ n(kpis.changesToday) }}</div>
          <div class="delta flat"><v-icon icon="mdi-format-list-checks" size="13" /> Nhật ký hoạt động</div>
        </div>
        <div class="kpi accent-ok">
          <div class="top"><span class="label">Cron OK</span><span class="kic"><v-icon icon="mdi-clock-check-outline" size="18" /></span></div>
          <div class="val">{{ n(kpis.cronOk) }}<span class="u">/ {{ n(kpis.cronTotal) }}</span></div>
          <div class="delta flat">
            <v-icon icon="mdi-circle-medium" size="13" />
            {{ Math.max(0, (Number(kpis.cronTotal) || 0) - (Number(kpis.cronOk) || 0)) }} job trễ lịch
          </div>
        </div>
        <div class="kpi accent-warn">
          <div class="top"><span class="label">Queue đang chờ</span><span class="kic"><v-icon icon="mdi-tray-full" size="18" /></span></div>
          <div class="val">{{ n(kpis.queueWaiting) }}</div>
          <div class="delta flat"><v-icon icon="mdi-circle-medium" size="13" /> Đang xử lý nền</div>
        </div>
        <div class="kpi accent-danger">
          <div class="top"><span class="label">Nick rớt 24h</span><span class="kic"><v-icon icon="mdi-cellphone-off" size="18" /></span></div>
          <div class="val">{{ n(kpis.nickDisconnect24h) }}</div>
          <div class="delta down"><v-icon icon="mdi-alert-circle-outline" size="13" /> Sự kiện mất kết nối</div>
        </div>
      </div>

      <!-- SYSTEM HEALTH -->
      <div class="card" style="margin-bottom:18px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-heart-pulse" size="18" /> Sức khỏe hệ thống</div>
          <div class="meta">Realtime</div>
        </div>
        <div class="card-b">
          <div class="grid g-3">

            <!-- (a) Cron jobs -->
            <div class="card" style="box-shadow:none">
              <div class="card-h" style="padding:11px 14px">
                <div class="t" style="font-size:13px"><v-icon icon="mdi-clock-outline" size="16" /> Cron jobs</div>
                <div class="meta">{{ cronOkCount }}/{{ cronJobs.length }} OK</div>
              </div>
              <div class="card-b" style="padding:6px 14px 12px">
                <template v-if="cronJobs.length">
                  <div
                    v-for="(c, i) in cronJobs"
                    :key="i"
                    style="display:flex;align-items:center;gap:9px;padding:8px 0"
                    :style="i < cronJobs.length - 1 ? 'border-bottom:1px solid var(--rk-hairline)' : ''"
                  >
                    <span class="dot" :class="c?.ok ? 'ok' : 'warn'"></span>
                    <div style="flex:1">
                      <div class="b" style="font-size:12.5px;color:var(--rk-ink)">{{ c?.name || '—' }}</div>
                      <div class="sub" style="font-size:11px;color:var(--rk-faint)">
                        {{ c?.lastRunMinAgo != null ? `chạy ${n(c.lastRunMinAgo)} phút trước` : '—' }}
                      </div>
                    </div>
                    <span class="pill" :class="c?.ok ? 'ok' : 'warn'">{{ c?.ok ? 'OK' : 'Trễ' }}</span>
                  </div>
                </template>
                <div v-else class="rk-empty">Chưa có dữ liệu cron</div>
              </div>
            </div>

            <!-- (b) Queues -->
            <div class="card" style="box-shadow:none">
              <div class="card-h" style="padding:11px 14px">
                <div class="t" style="font-size:13px"><v-icon icon="mdi-tray-full" size="16" /> Hàng đợi</div>
                <div class="meta">{{ n(kpis.queueWaiting) }} chờ</div>
              </div>
              <div class="card-b" style="padding:10px 14px 12px">
                <template v-if="queues.length">
                  <div
                    v-for="(q, i) in queues"
                    :key="i"
                    style="padding:9px 0"
                    :style="i < queues.length - 1 ? 'border-bottom:1px solid var(--rk-hairline)' : ''"
                  >
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                      <span class="b" style="font-size:12.5px;color:var(--rk-ink)">{{ q?.name || '—' }}</span>
                      <span class="b" style="font-size:12.5px;color:var(--rk-ink);font-variant-numeric:tabular-nums">{{ n(q?.depth) }}</span>
                    </div>
                    <div :class="queueBarClass(q?.depth)"><i :style="{ width: queueW(q?.depth) }"></i></div>
                  </div>
                </template>
                <div v-else class="rk-empty">Hàng đợi trống</div>
              </div>
            </div>

            <!-- (c) Automation error rate -->
            <div class="card" style="box-shadow:none">
              <div class="card-h" style="padding:11px 14px">
                <div class="t" style="font-size:13px"><v-icon icon="mdi-robot-outline" size="16" /> Tỉ lệ lỗi automation 24h</div>
              </div>
              <div class="card-b" style="padding:14px">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">
                  <div style="font-size:38px;font-weight:800;color:#b42318;line-height:1;font-variant-numeric:tabular-nums">
                    {{ pct(health.errorRate24h) }}<span style="font-size:18px;color:var(--rk-muted)">%</span>
                  </div>
                </div>
                <template v-if="errorBreakdown.length">
                  <div
                    v-for="(e, i) in errorBreakdown"
                    :key="i"
                    style="padding:9px 0"
                    :style="i < errorBreakdown.length - 1 ? 'border-bottom:1px solid var(--rk-hairline)' : ''"
                  >
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                      <span style="font-size:12px;color:var(--rk-body)">{{ e?.category || '—' }}</span>
                      <span class="b" style="font-size:12px;color:var(--rk-ink)">{{ pct(e?.pct) }}%</span>
                    </div>
                    <div :class="errBarClass(e?.category)"><i :style="{ width: errW(e?.pct) }"></i></div>
                  </div>
                </template>
                <div v-else class="rk-empty">Không có lỗi automation</div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- AUDIT LOG -->
      <div class="card" style="margin-bottom:18px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-format-list-checks" size="18" /> Nhật ký hoạt động</div>
          <span class="meta">Audit log</span>
        </div>
        <div class="card-b" style="padding:0">
          <table v-if="activity.length" class="tbl">
            <thead>
              <tr><th>Thời gian</th><th>Người / Bot</th><th>Nhóm</th><th>Hành động</th><th>Đối tượng</th></tr>
            </thead>
            <tbody>
              <tr v-for="(a, i) in activity" :key="a?.id ?? i">
                <td class="muted">{{ fmtTs(a?.ts) }}</td>
                <td>
                  <div class="cellname">
                    <span class="av" :style="{ background: a?.isBot ? '#0f6fa0' : avColor(a?.actorName) }">
                      <v-icon v-if="a?.isBot" icon="mdi-robot" size="14" />
                      <template v-else>{{ initials(a?.actorName) }}</template>
                    </span>
                    <div>
                      {{ a?.actorName || '—' }}
                      <span v-if="a?.isBot" class="pill" style="margin-left:4px">
                        {{ String(a?.actorType || '').toLowerCase() === 'system' ? 'Hệ thống' : 'Bot' }}
                      </span>
                    </div>
                  </div>
                </td>
                <td><span class="pill" :class="categoryPill(a?.category)">{{ a?.category || '—' }}</span></td>
                <td>{{ a?.action || '—' }}</td>
                <td><span class="muted">{{ a?.entityType || '—' }}</span></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="rk-empty">Chưa có nhật ký hoạt động</div>
        </div>
      </div>

      <!-- DISCONNECT EVENTS -->
      <div class="card">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-cellphone-off" size="18" style="color:var(--rk-danger)" /> Sự kiện nick mất kết nối 24h</div>
          <span class="meta">24 giờ</span>
        </div>
        <div class="card-b" style="padding:0">
          <table v-if="disconnects.length" class="tbl">
            <thead>
              <tr><th>Thời gian</th><th>Nick</th><th>Lý do</th><th class="num">Thời gian rớt</th></tr>
            </thead>
            <tbody>
              <tr v-for="(d, i) in disconnects" :key="i">
                <td class="muted">{{ fmtTs(d?.ts) }}</td>
                <td>
                  <div class="cellname">
                    <span class="dot" :class="disconnectDot(d?.reason)"></span>
                    <div>{{ d?.nickName || '—' }}</div>
                  </div>
                </td>
                <td><span class="pill" :class="reasonPill(d?.reason)">{{ d?.reason || '—' }}</span></td>
                <td class="num">{{ n(d?.downMinutes) }} phút</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="rk-empty">Không có nick mất kết nối trong 24h</div>
        </div>
      </div>
    </template>
  </div>
</template>
