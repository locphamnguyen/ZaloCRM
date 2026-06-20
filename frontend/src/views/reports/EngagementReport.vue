<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'

interface Kpis {
  hotCount: number
  coolingCount: number
  customerInitiatedPct: number
  avgInteractionsPerDay: number
}
interface HeatRow { contactId: string; name: string; cells: number[] }
interface PatternSlice { pattern: string; count: number }
interface CoolingRow { contactId: string; name: string; saleName: string; silentDays: number; score: number }
interface HotRow { contactId: string; name: string; saleName: string; signal: string; score: number }
interface InteractionTypes { inbound: number; outbound: number; reaction: number; voiceCall: number }
interface EngagementData {
  from?: string
  to?: string
  kpis: Kpis
  heatmap: HeatRow[]
  patternDist: PatternSlice[]
  cooling: CoolingRow[]
  hot: HotRow[]
  interactionTypes: InteractionTypes
}

const data = ref<EngagementData | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const res = await api.get('/reports/engagement')
    data.value = res.data
  } catch (e) {
    data.value = null
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ── helpers ──────────────────────────────────────────────
const nf = new Intl.NumberFormat('vi-VN')
function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0'
  return nf.format(n)
}
function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0'
  return nf.format(Math.round(n))
}

const AV_COLORS = ['#1786be', '#7a4fb0', '#b0734f', '#4fb09a', '#b04f6e', '#4f7ab0', '#b0a14f', '#5b8f4f']
function initials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function avColor(name: string): string {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AV_COLORS[h % AV_COLORS.length]
}

// pattern → label + color for donut/legend
const PATTERN_META: Record<string, { label: string; color: string }> = {
  hot: { label: 'Nóng (ready)', color: '#f04438' },
  champion: { label: 'Champion (bền)', color: '#f79009' },
  stable: { label: 'Ổn định', color: '#1786be' },
  cooling: { label: 'Đang nguội', color: '#5bb8e5' },
  cold: { label: 'Lạnh (im lặng)', color: '#97a0ac' },
}
const PATTERN_ORDER = ['hot', 'champion', 'stable', 'cooling', 'cold']

function patternLabel(p: string): string {
  return PATTERN_META[p]?.label ?? p
}
function patternColor(p: string): string {
  return PATTERN_META[p]?.color ?? '#97a0ac'
}
function sortedPatterns(list: PatternSlice[]): PatternSlice[] {
  return [...list].sort(
    (a, b) => PATTERN_ORDER.indexOf(a.pattern) - PATTERN_ORDER.indexOf(b.pattern),
  )
}
function patternTotal(list: PatternSlice[]): number {
  return list.reduce((s, p) => s + (p.count || 0), 0)
}
function donutGradient(list: PatternSlice[]): string {
  const total = patternTotal(list) || 1
  const ordered = sortedPatterns(list)
  const stops: string[] = []
  let acc = 0
  for (const p of ordered) {
    const start = (acc / total) * 100
    acc += p.count || 0
    const end = (acc / total) * 100
    stops.push(`${patternColor(p.pattern)} ${start}% ${end}%`)
  }
  return `conic-gradient(${stops.join(', ')})`
}

function silentPill(days: number): string {
  return days >= 9 ? 'danger' : 'warn'
}
</script>

<template>
  <div class="rpt-scope">
    <div class="rpt">
      <!-- HEAD -->
      <div class="rpt-head">
        <div class="rpt-titles">
          <div class="ic"><v-icon>mdi-fire</v-icon></div>
          <div>
            <div class="rpt-h1">Engagement &amp; Tương tác KH</div>
            <div class="rpt-sub">
              Đọc nhịp tương tác 28 ngày để bắt khách đang nóng (nên đẩy chốt ngay)
              và khách đang nguội (cần cứu trước khi rơi). Theo dõi từng khách qua heatmap.
            </div>
          </div>
        </div>
        <div class="rpt-actions">
          <button class="rk-btn ghost" @click="load" :disabled="loading">
            <v-icon size="16">mdi-refresh</v-icon> Làm mới
          </button>
        </div>
      </div>

      <!-- FILTERS -->
      <div class="rpt-filters">
        <div class="seg"><button class="on">28 ngày</button></div>
        <span class="faint" style="font-size: 11.5px; font-weight: 600">
          Cửa sổ cố định cho heatmap nhịp tương tác
        </span>
      </div>

      <!-- LOADING -->
      <div v-if="loading" class="rk-loading">
        <v-icon size="18">mdi-loading</v-icon> Đang tải báo cáo tương tác…
      </div>

      <!-- EMPTY -->
      <div v-else-if="!data" class="rk-empty">Không có dữ liệu tương tác cho kỳ này.</div>

      <!-- CONTENT -->
      <template v-else>
        <!-- KPI ROW -->
        <div class="grid g-4" style="margin-bottom: 18px">
          <div class="kpi accent-ok">
            <div class="top">
              <span class="label">KH đang nóng (ready)</span>
              <span class="kic"><v-icon size="18">mdi-fire</v-icon></span>
            </div>
            <div class="val">{{ fmt(data.kpis.hotCount) }}</div>
            <div class="delta flat"><v-icon size="14">mdi-fire</v-icon> Sẵn sàng đẩy chốt</div>
          </div>
          <div class="kpi accent-warn">
            <div class="top">
              <span class="label">KH đang nguội (cooling)</span>
              <span class="kic"><v-icon size="18">mdi-snowflake</v-icon></span>
            </div>
            <div class="val">{{ fmt(data.kpis.coolingCount) }}</div>
            <div class="delta flat"><v-icon size="14">mdi-snowflake-alert</v-icon> Cần cứu trước khi rơi</div>
          </div>
          <div class="kpi">
            <div class="top">
              <span class="label">KH khởi tạo chat</span>
              <span class="kic"><v-icon size="18">mdi-message-arrow-left-outline</v-icon></span>
            </div>
            <div class="val">{{ pct(data.kpis.customerInitiatedPct) }}<span class="u">%</span></div>
            <div class="delta flat"><v-icon size="14">mdi-circle-medium</v-icon> Inbound chủ động</div>
          </div>
          <div class="kpi">
            <div class="top">
              <span class="label">Tương tác/ngày TB</span>
              <span class="kic"><v-icon size="18">mdi-chart-timeline-variant</v-icon></span>
            </div>
            <div class="val">{{ fmt(data.kpis.avgInteractionsPerDay) }}</div>
            <div class="delta flat"><v-icon size="14">mdi-circle-medium</v-icon> inbound + outbound + reaction</div>
          </div>
        </div>

        <!-- HEATMAP -->
        <div class="card" style="margin-bottom: 18px">
          <div class="card-h">
            <div class="t"><v-icon size="18">mdi-fire</v-icon> Heatmap tương tác 28 ngày</div>
            <div class="meta">Mỗi ô = mức tương tác trong 1 ngày · Mới nhất bên phải</div>
          </div>
          <div class="card-b">
            <div v-if="!data.heatmap || !data.heatmap.length" class="rk-empty">
              Chưa có dữ liệu nhịp tương tác.
            </div>
            <template v-else>
              <div class="heat" style="margin-bottom: 10px">
                <template v-for="row in data.heatmap" :key="row.contactId">
                  <div class="rl">{{ row.name }}</div>
                  <div
                    v-for="(cell, ci) in row.cells"
                    :key="ci"
                    class="c"
                    :class="cell > 0 ? 'l' + cell : ''"
                  ></div>
                </template>
              </div>
              <!-- legend -->
              <div
                style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--rk-muted); font-weight: 600"
              >
                <span>Ít</span>
                <span class="c l1" style="width: 14px; height: 14px; border-radius: 3px; display: inline-block"></span>
                <span class="c l2" style="width: 14px; height: 14px; border-radius: 3px; display: inline-block"></span>
                <span class="c l3" style="width: 14px; height: 14px; border-radius: 3px; display: inline-block"></span>
                <span class="c l4" style="width: 14px; height: 14px; border-radius: 3px; display: inline-block"></span>
                <span class="c l5" style="width: 14px; height: 14px; border-radius: 3px; display: inline-block"></span>
                <span>Nhiều</span>
              </div>
            </template>
          </div>
        </div>

        <!-- DONUT + LISTS -->
        <div class="grid g-3">
          <!-- Phân bố nhịp -->
          <div class="card">
            <div class="card-h">
              <div class="t"><v-icon size="18">mdi-chart-donut</v-icon> Phân bố nhịp</div>
              <div class="meta">{{ fmt(patternTotal(data.patternDist)) }} KH có tương tác</div>
            </div>
            <div class="card-b">
              <div
                v-if="!data.patternDist || !data.patternDist.length"
                class="rk-empty"
              >
                Chưa có dữ liệu phân bố.
              </div>
              <template v-else>
                <div style="display: flex; justify-content: center; margin-bottom: 16px">
                  <div class="donut" :style="{ background: donutGradient(data.patternDist) }">
                    <div class="hole">
                      <b>{{ fmt(patternTotal(data.patternDist)) }}</b>
                      <span>khách</span>
                    </div>
                  </div>
                </div>
                <div class="legend">
                  <div class="li" v-for="p in sortedPatterns(data.patternDist)" :key="p.pattern">
                    <span class="sw" :style="{ background: patternColor(p.pattern) }"></span>
                    {{ patternLabel(p.pattern) }}
                    <span class="b" style="margin-left: auto">{{ fmt(p.count) }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Lists col-2 -->
          <div class="col-2 grid g-2">
            <!-- Cần cứu -->
            <div class="card">
              <div class="card-h">
                <div class="t">
                  <v-icon size="18" style="color: var(--rk-warn)">mdi-snowflake-alert</v-icon>
                  KH đang nguội cần cứu
                </div>
              </div>
              <div class="card-b" style="padding: 0">
                <div v-if="!data.cooling || !data.cooling.length" class="rk-empty">
                  Không có khách đang nguội.
                </div>
                <table v-else class="tbl">
                  <thead>
                    <tr>
                      <th>Khách hàng</th>
                      <th>Sale</th>
                      <th>Im lặng</th>
                      <th class="num">Điểm</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in data.cooling" :key="c.contactId">
                      <td>
                        <div class="cellname">
                          <span class="av" :style="{ background: avColor(c.name) }">{{ initials(c.name) }}</span>
                          <div>{{ c.name }}</div>
                        </div>
                      </td>
                      <td>{{ c.saleName || '—' }}</td>
                      <td><span class="pill" :class="silentPill(c.silentDays)">{{ fmt(c.silentDays) }} ngày</span></td>
                      <td class="num">{{ fmt(c.score) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Nên đẩy -->
            <div class="card">
              <div class="card-h">
                <div class="t">
                  <v-icon size="18" style="color: var(--rk-danger)">mdi-fire</v-icon>
                  KH đang nóng nên đẩy
                </div>
              </div>
              <div class="card-b" style="padding: 0">
                <div v-if="!data.hot || !data.hot.length" class="rk-empty">
                  Không có khách đang nóng.
                </div>
                <table v-else class="tbl">
                  <thead>
                    <tr>
                      <th>Khách hàng</th>
                      <th>Sale</th>
                      <th>Tín hiệu mua</th>
                      <th class="num">Điểm</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="h in data.hot" :key="h.contactId">
                      <td>
                        <div class="cellname">
                          <span class="av" :style="{ background: avColor(h.name) }">{{ initials(h.name) }}</span>
                          <div>{{ h.name }}</div>
                        </div>
                      </td>
                      <td>{{ h.saleName || '—' }}</td>
                      <td><span class="pill ok">{{ h.signal || 'Tín hiệu mua' }}</span></td>
                      <td class="num">{{ fmt(h.score) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- INTERACTION TYPE BREAKDOWN -->
        <div class="grid g-4" style="margin-top: 14px">
          <div class="kpi">
            <div class="top">
              <span class="label">Inbound (KH gửi)</span>
              <span class="kic"><v-icon size="18">mdi-message-arrow-left-outline</v-icon></span>
            </div>
            <div class="val">{{ fmt(data.interactionTypes.inbound) }}</div>
            <div class="delta flat"><v-icon size="14">mdi-circle-medium</v-icon> KH chủ động nhắn</div>
          </div>
          <div class="kpi">
            <div class="top">
              <span class="label">Outbound (mình gửi)</span>
              <span class="kic"><v-icon size="18">mdi-message-arrow-right-outline</v-icon></span>
            </div>
            <div class="val">{{ fmt(data.interactionTypes.outbound) }}</div>
            <div class="delta flat"><v-icon size="14">mdi-robot-outline</v-icon> Gồm tin bot gửi</div>
          </div>
          <div class="kpi">
            <div class="top">
              <span class="label">Reaction / Thả tim</span>
              <span class="kic"><v-icon size="18">mdi-heart-outline</v-icon></span>
            </div>
            <div class="val">{{ fmt(data.interactionTypes.reaction) }}</div>
            <div class="delta flat"><v-icon size="14">mdi-circle-medium</v-icon> Tương tác nhẹ</div>
          </div>
          <div class="kpi">
            <div class="top">
              <span class="label">Voice / Gọi điện</span>
              <span class="kic"><v-icon size="18">mdi-phone-outline</v-icon></span>
            </div>
            <div class="val">{{ fmt(data.interactionTypes.voiceCall) }}</div>
            <div class="delta flat"><v-icon size="14">mdi-circle-medium</v-icon> Cuộc gọi thoại</div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
