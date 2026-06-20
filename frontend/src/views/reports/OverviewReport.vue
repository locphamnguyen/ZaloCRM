<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<script setup lang="ts">
import { api } from '@/api'
import { ref, onMounted, computed, watch } from 'vue'

type Range = 'today' | '7d' | '30d'

const data = ref<any>(null)
const loading = ref(true)
const range = ref<Range>('30d')

const rangeBtns: { key: Range; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
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
  if (r === 'today') {
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
    data.value = (await api.get('/reports/overview', { params: { from, to } })).data
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
  // show one decimal, vi-VN uses comma
  return num.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
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

const msgSeries = computed<any[]>(() => data.value?.msgSeries ?? [])
const msgMax = computed<number>(() => {
  let m = 0
  for (const r of msgSeries.value) {
    m = Math.max(m, Number(r?.sent) || 0, Number(r?.received) || 0)
  }
  return m || 1
})
function barH(v: any): string {
  const num = Number(v) || 0
  return `${Math.max(0, Math.min(100, (num / msgMax.value) * 100))}%`
}
function shortDate(d?: string): string {
  if (!d) return ''
  // accept YYYY-MM-DD or ISO; output DD/MM
  const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}`
  return String(d)
}

const funnel = computed<any[]>(() => data.value?.funnel ?? [])
const funnelMax = computed<number>(() => {
  let m = 0
  for (const f of funnel.value) m = Math.max(m, Number(f?.count) || 0)
  return m || 1
})
function funnelW(v: any): string {
  const num = Number(v) || 0
  return `${Math.max(0, Math.min(100, (num / funnelMax.value) * 100))}%`
}
function isLastFunnel(i: number): boolean {
  return funnel.value.length > 0 && i === funnel.value.length - 1
}

const topSales = computed<any[]>(() => data.value?.topSales ?? [])
const riskNicks = computed<any[]>(() => data.value?.riskNicks ?? [])

function riskDot(risk?: string): string {
  if (risk === 'disconnect') return 'danger'
  if (risk === 'quota' || risk === 'stranger') return 'warn'
  if (risk === 'ok') return 'ok'
  return 'idle'
}
function statusPill(risk?: string): string {
  if (risk === 'disconnect') return 'danger'
  if (risk === 'quota' || risk === 'stranger') return 'warn'
  if (risk === 'ok') return 'ok'
  return ''
}
function quotaBarClass(risk?: string): string {
  if (risk === 'disconnect') return 'bar danger'
  if (risk === 'quota' || risk === 'stranger') return 'bar warn'
  if (risk === 'ok') return 'bar ok'
  return 'bar'
}
function quotaW(v: any): string {
  const num = Number(v)
  if (!Number.isFinite(num)) return '0%'
  return `${Math.max(0, Math.min(100, num))}%`
}
</script>

<template>
  <div class="rpt">
    <!-- HEAD -->
    <div class="rpt-head">
      <div class="rpt-titles">
        <div class="ic"><v-icon icon="mdi-view-dashboard-outline" size="24" /></div>
        <div>
          <div class="rpt-h1">Tổng quan điều hành</div>
          <div class="rpt-sub">
            Sức khỏe toàn hệ thống trong một màn: đội nick, tăng trưởng khách hàng, phễu chốt, hoạt động automation.
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
    <div v-if="loading && !data" class="rpt-loading rk-loading">
      <v-icon icon="mdi-loading" size="20" /> Đang tải dữ liệu…
    </div>

    <template v-else>
      <!-- KPI ROW 1 -->
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi">
          <div class="top"><span class="label">Tổng khách hàng</span><span class="kic"><v-icon icon="mdi-account-multiple-outline" size="18" /></span></div>
          <div class="val">{{ n(kpis.totalContacts) }}</div>
          <div class="delta up"><v-icon icon="mdi-trending-up" size="13" /> +{{ n(kpis.newContacts) }} trong kỳ</div>
        </div>
        <div class="kpi">
          <div class="top"><span class="label">KH mới</span><span class="kic"><v-icon icon="mdi-account-plus-outline" size="18" /></span></div>
          <div class="val">{{ n(kpis.newContacts) }}</div>
          <div class="delta" :class="(Number(kpis.newContactsDelta) || 0) >= 0 ? 'up' : 'down'">
            <v-icon :icon="(Number(kpis.newContactsDelta) || 0) >= 0 ? 'mdi-trending-up' : 'mdi-trending-down'" size="13" />
            {{ (Number(kpis.newContactsDelta) || 0) >= 0 ? '+' : '' }}{{ n(kpis.newContactsDelta) }} vs kỳ trước
          </div>
        </div>
        <div class="kpi accent-ok">
          <div class="top"><span class="label">Nick online</span><span class="kic"><v-icon icon="mdi-cellphone-check" size="18" /></span></div>
          <div class="val">{{ n(kpis.nicksOnline) }}<span class="u">/ {{ n(kpis.nicksTotal) }}</span></div>
          <div class="delta flat"><v-icon icon="mdi-circle-medium" size="13" /> {{ n(kpis.nicksNeedRelogin) }} cần re-login</div>
        </div>
        <div class="kpi">
          <div class="top"><span class="label">Tin nhắn hôm nay</span><span class="kic"><v-icon icon="mdi-message-text-outline" size="18" /></span></div>
          <div class="val">{{ n(kpis.msgToday) }}</div>
          <div class="delta up"><v-icon icon="mdi-robot-outline" size="13" /> {{ n(kpis.msgByBot) }} do bot gửi</div>
        </div>
      </div>

      <!-- KPI ROW 2 -->
      <div class="grid g-4" style="margin-bottom:18px">
        <div class="kpi">
          <div class="top"><span class="label">Lịch hẹn hôm nay</span><span class="kic"><v-icon icon="mdi-calendar-clock" size="18" /></span></div>
          <div class="val">{{ n(kpis.apptToday) }}</div>
          <div class="delta flat"><v-icon icon="mdi-check" size="13" /> {{ n(kpis.apptDone) }} đã hoàn thành</div>
        </div>
        <div class="kpi accent-warn">
          <div class="top"><span class="label">Lead pool đang chờ</span><span class="kic"><v-icon icon="mdi-gift-outline" size="18" /></span></div>
          <div class="val">{{ n(kpis.leadPoolWaiting) }}</div>
          <div class="delta down"><v-icon icon="mdi-trending-down" size="13" /> {{ n(kpis.leadPoolAutoReturnSoon) }} sắp auto-trả</div>
        </div>
        <div class="kpi accent-ok">
          <div class="top"><span class="label">Tỉ lệ chốt</span><span class="kic"><v-icon icon="mdi-flag-checkered" size="18" /></span></div>
          <div class="val">{{ pct(kpis.closeRate) }}<span class="u">%</span></div>
          <div class="delta" :class="(Number(kpis.closeRateDelta) || 0) >= 0 ? 'up' : 'down'">
            <v-icon :icon="(Number(kpis.closeRateDelta) || 0) >= 0 ? 'mdi-trending-up' : 'mdi-trending-down'" size="13" />
            {{ (Number(kpis.closeRateDelta) || 0) >= 0 ? '+' : '' }}{{ pct(kpis.closeRateDelta) }}đ
          </div>
        </div>
        <div class="kpi">
          <div class="top"><span class="label">Kết bạn thành công</span><span class="kic"><v-icon icon="mdi-account-check-outline" size="18" /></span></div>
          <div class="val">{{ pct(kpis.friendAcceptRate) }}<span class="u">%</span></div>
          <div class="delta flat"><v-icon icon="mdi-circle-medium" size="13" /> {{ n(kpis.friendInviteAccepted) }}/{{ n(kpis.friendInviteSent) }} lời mời</div>
        </div>
      </div>

      <!-- CHARTS ROW -->
      <div class="grid g-3" style="margin-bottom:14px">
        <div class="card col-2">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-chart-bar" size="18" /> Tin nhắn 14 ngày</div>
            <div class="meta">Khách gửi / Mình gửi</div>
          </div>
          <div class="card-b">
            <div v-if="msgSeries.length" class="chart">
              <div v-for="(row, i) in msgSeries" :key="i" class="col">
                <div class="stack">
                  <i :style="{ height: barH(row?.received) }"></i>
                  <i class="b" :style="{ height: barH(row?.sent) }"></i>
                </div>
                <div class="x">{{ shortDate(row?.date) }}</div>
              </div>
            </div>
            <div v-else class="rk-empty">Chưa có dữ liệu tin nhắn</div>
          </div>
        </div>

        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-filter-outline" size="18" /> Phễu chốt</div>
            <div class="meta">{{ range === 'today' ? 'Hôm nay' : range === '7d' ? '7 ngày' : '30 ngày' }}</div>
          </div>
          <div class="card-b">
            <div v-if="funnel.length" class="funnel">
              <div v-for="(f, i) in funnel" :key="i" class="stp">
                <div class="nm" style="width:78px">{{ f?.status }}</div>
                <div class="track">
                  <i
                    :style="isLastFunnel(i)
                      ? { width: funnelW(f?.count), background: 'linear-gradient(90deg,#12b76a,#5fd99a)' }
                      : { width: funnelW(f?.count) }"
                  ></i>
                  <div class="vv">{{ n(f?.count) }}</div>
                </div>
              </div>
            </div>
            <div v-else class="rk-empty">Chưa có dữ liệu phễu</div>
          </div>
        </div>
      </div>

      <!-- TABLES ROW -->
      <div class="grid g-2">
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-trophy-outline" size="18" /> Top sale</div>
            <span class="meta">Top 5</span>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="topSales.length" class="tbl">
              <thead><tr><th>Sale</th><th class="num">KH mới</th><th class="num">Tin gửi</th><th class="num">Chốt</th></tr></thead>
              <tbody>
                <tr v-for="(s, i) in topSales" :key="s?.userId ?? i">
                  <td>
                    <div class="cellname">
                      <span class="av" :style="{ background: avColor(s?.name) }">{{ initials(s?.name) }}</span>
                      <div>{{ s?.name || '—' }}<div class="sub">{{ s?.deptName || '—' }}</div></div>
                    </div>
                  </td>
                  <td class="num">{{ n(s?.newContacts) }}</td>
                  <td class="num">{{ n(s?.sent) }}</td>
                  <td class="num"><span class="pill ok">{{ n(s?.closed) }}</span></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Chưa có dữ liệu sale</div>
          </div>
        </div>

        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-alert-outline" size="18" style="color:var(--rk-warn)" /> Nick cần chú ý</div>
            <span class="meta">Top 5</span>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="riskNicks.length" class="tbl">
              <thead><tr><th>Nick</th><th>Trạng thái</th><th class="num">Quota</th><th class="num">Uptime 7d</th></tr></thead>
              <tbody>
                <tr v-for="(nk, i) in riskNicks" :key="nk?.id ?? i">
                  <td>
                    <div class="cellname">
                      <span class="dot" :class="riskDot(nk?.risk)"></span>
                      <div>{{ nk?.name || '—' }}<div class="sub">Owner: {{ nk?.ownerName || '—' }}</div></div>
                    </div>
                  </td>
                  <td><span class="pill" :class="statusPill(nk?.risk)">{{ nk?.status || '—' }}</span></td>
                  <td class="num">
                    <template v-if="nk?.quotaPct != null">
                      <div :class="quotaBarClass(nk?.risk)" style="width:60px"><i :style="{ width: quotaW(nk?.quotaPct) }"></i></div>
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td class="num">{{ pct(nk?.uptime7d) }}%</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Không có nick cần chú ý</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
