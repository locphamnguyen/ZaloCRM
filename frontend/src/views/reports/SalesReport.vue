<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  SalesReport — Hiệu suất Sale & Team. Endpoint #3 GET /reports/sales-performance.
  Render trong .rpt-scope (ReportsShell) → dùng global classes của report-kit.css.
-->
<template>
  <div class="rpt">
    <!-- HEAD -->
    <div class="rpt-head">
      <div class="rpt-titles">
        <div class="ic"><v-icon icon="mdi-account-tie-outline" /></div>
        <div>
          <div class="rpt-h1">Hiệu suất Sale &amp; Team</div>
          <div class="rpt-sub">
            Ai đang làm tốt, ai đang kẹt — đo công bằng theo nhịp thật của từng người.
            Xếp hạng, rollup theo phòng ban và tốc độ phản hồi thực tế.
          </div>
        </div>
      </div>
      <div class="rpt-actions">
        <button class="rk-btn ghost" :disabled="loading" @click="load">
          <v-icon icon="mdi-refresh" size="16" /> Làm mới
        </button>
        <button class="rk-btn" disabled title="Sắp có">
          <v-icon icon="mdi-file-excel-outline" size="16" /> Xuất Excel
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
        >{{ r.label }}</button>
      </div>
    </div>

    <!-- LOADING -->
    <div v-if="loading" class="rk-loading">
      <v-icon icon="mdi-loading" class="mdi-spin" /> Đang tải dữ liệu…
    </div>

    <template v-else-if="data">
      <!-- KPI ROW -->
      <div class="grid g-4" style="margin-bottom:18px">
        <div class="kpi">
          <div class="top">
            <span class="label">Sale hoạt động</span>
            <span class="kic"><v-icon icon="mdi-account-check-outline" size="18" /></span>
          </div>
          <div class="val">
            {{ fmt(data.kpis.activeSales) }}<span class="u">/ {{ fmt(data.kpis.totalSales) }}</span>
          </div>
        </div>
        <div class="kpi">
          <div class="top">
            <span class="label">Tin / sale (TB)</span>
            <span class="kic"><v-icon icon="mdi-message-text-outline" size="18" /></span>
          </div>
          <div class="val">{{ fmt(data.kpis.avgSentPerSale) }}</div>
        </div>
        <div class="kpi accent-ok">
          <div class="top">
            <span class="label">Tốc độ phản hồi TB</span>
            <span class="kic"><v-icon icon="mdi-timer-sand" size="18" /></span>
          </div>
          <div class="val">{{ fmt(data.kpis.avgResponseMin) }}<span class="u">phút</span></div>
        </div>
        <div class="kpi">
          <div class="top">
            <span class="label">Tỉ lệ chốt TB</span>
            <span class="kic"><v-icon icon="mdi-flag-checkered" size="18" /></span>
          </div>
          <div class="val">{{ fmtPct(data.kpis.avgCloseRate) }}<span class="u">%</span></div>
        </div>
      </div>

      <!-- LEADERBOARD -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-trophy-outline" size="18" /> Bảng xếp hạng Sale</div>
          <div class="meta">{{ rangeLabel }} · điểm hiệu suất tổng hợp 0–100</div>
        </div>
        <div class="card-b" style="padding:0">
          <table v-if="data.sales.length" class="tbl">
            <thead>
              <tr>
                <th style="width:40px">#</th>
                <th>Sale</th>
                <th class="num">KH phụ trách</th>
                <th class="num">Tin gửi</th>
                <th class="num">Phản hồi TB</th>
                <th class="num">Lịch hẹn</th>
                <th class="num">Chốt</th>
                <th class="num">Lead pool dùng</th>
                <th style="width:170px">Điểm hiệu suất</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(s, i) in data.sales"
                :key="s.userId"
                :style="i < 3 ? 'background:var(--rk-brand-softer)' : ''"
              >
                <td
                  class="b"
                  :class="{ muted: i >= 3 }"
                  :style="i < 3 ? 'color:var(--rk-brand-700)' : ''"
                >{{ i + 1 }}</td>
                <td>
                  <div class="cellname">
                    <span class="av" :style="{ background: avColor(s.name) }">{{ initials(s.name) }}</span>
                    <div>
                      {{ s.name }}
                      <div class="sub">{{ s.deptName || '—' }}</div>
                    </div>
                  </div>
                </td>
                <td class="num">{{ fmt(s.contacts) }}</td>
                <td class="num">{{ fmt(s.sent) }}</td>
                <td class="num">
                  <span class="pill" :class="respClass(s.avgResponseMin)">{{ fmt(s.avgResponseMin) }} phút</span>
                </td>
                <td class="num">{{ fmt(s.apptDone) }} / {{ fmt(s.apptNoShow) }}</td>
                <td class="num"><span class="pill ok">{{ fmt(s.closed) }}</span></td>
                <td class="num">{{ fmt(s.leadPoolUsed) }}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="bar" :class="scoreClass(s.score)" style="flex:1">
                      <i :style="{ width: clampPct(s.score) + '%' }"></i>
                    </div>
                    <span class="b" style="font-variant-numeric:tabular-nums">{{ fmt(s.score) }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="rk-empty">Chưa có dữ liệu sale trong kỳ này.</div>
        </div>
      </div>

      <!-- BOTTOM GRID -->
      <div class="grid g-2">
        <!-- Rollup theo phòng ban -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-office-building-outline" size="18" /> Rollup theo phòng ban</div>
            <div class="meta">{{ rangeLabel }}</div>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="data.byDept.length" class="tbl">
              <thead>
                <tr>
                  <th>Phòng ban</th>
                  <th class="num">Tổng KH</th>
                  <th class="num">Tin gửi</th>
                  <th class="num">Chốt</th>
                  <th class="num">Tỉ lệ chốt</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in data.byDept" :key="d.deptName">
                  <td>
                    <div class="cellname">
                      <span class="dot" :class="d.closeRate >= 10 ? 'ok' : 'warn'"></span>
                      <div>{{ d.deptName || '—' }}</div>
                    </div>
                  </td>
                  <td class="num">{{ fmt(d.contacts) }}</td>
                  <td class="num">{{ fmt(d.sent) }}</td>
                  <td class="num">
                    <span class="pill" :class="d.closeRate >= 10 ? 'ok' : 'warn'">{{ fmt(d.closed) }}</span>
                  </td>
                  <td class="num">
                    <span
                      class="b"
                      :style="{ color: d.closeRate >= 10 ? '#157f3c' : '#b45309' }"
                    >{{ fmtPct(d.closeRate) }}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Chưa có dữ liệu phòng ban.</div>
          </div>
        </div>

        <!-- Phân bố tốc độ phản hồi -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-timer-sand" size="18" /> Phân bố tốc độ phản hồi</div>
            <div class="meta">Theo lượt trả lời · {{ rangeLabel }}</div>
          </div>
          <div class="card-b">
            <div v-if="data.responseBuckets.length" class="chart">
              <div v-for="b in data.responseBuckets" :key="b.label" class="col">
                <div class="stack">
                  <i :style="{ height: bucketHeight(b.count) + '%' }"></i>
                </div>
                <div class="x">{{ b.label }}</div>
              </div>
            </div>
            <div v-else class="rk-empty">Chưa có dữ liệu phản hồi.</div>
          </div>
        </div>
      </div>

      <!-- ===== MỨC ĐỘ DÙNG CRM (anh bổ sung 2026-06-17) ===== -->
      <div v-if="usage" class="usage-divider">
        <v-icon icon="mdi-monitor-dashboard" size="18" /> Mức độ dùng CRM
        <span class="usage-divider-note">đo theo nhịp thao tác thực tế</span>
      </div>

      <div v-if="usage" class="grid g-4" style="margin-bottom:14px">
        <div class="kpi">
          <div class="top"><span class="label">Sale dùng hôm nay</span><span class="kic"><v-icon icon="mdi-account-clock-outline" size="18" /></span></div>
          <div class="val">{{ fmt(usage.kpis.activeSalesToday) }}</div>
        </div>
        <div class="kpi accent-ok">
          <div class="top"><span class="label">Thời gian dùng TB / ngày</span><span class="kic"><v-icon icon="mdi-timer-outline" size="18" /></span></div>
          <div class="val">{{ fmtDur(usage.kpis.avgActiveMinPerDay) }}<span class="u">ước tính</span></div>
        </div>
        <div class="kpi">
          <div class="top"><span class="label">Tổng thao tác</span><span class="kic"><v-icon icon="mdi-gesture-tap" size="18" /></span></div>
          <div class="val">{{ fmt(usage.kpis.totalActions) }}</div>
        </div>
        <div class="kpi">
          <div class="top"><span class="label">Module dùng nhiều nhất</span><span class="kic"><v-icon icon="mdi-view-grid-outline" size="18" /></span></div>
          <div class="val" style="font-size:18px;line-height:1.3">{{ usage.kpis.topModule }}</div>
        </div>
      </div>

      <div v-if="usage" class="grid g-2">
        <!-- Xếp hạng dùng CRM hiệu quả -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-medal-outline" size="18" /> Xếp hạng dùng CRM hiệu quả</div>
            <div class="meta">kết quả ÷ giờ dùng · {{ rangeLabel }}</div>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="usage.bySale.length" class="tbl">
              <thead>
                <tr>
                  <th style="width:36px">#</th>
                  <th>Sale</th>
                  <th class="num">Giờ / ngày</th>
                  <th class="num">Thao tác</th>
                  <th>Module chính</th>
                  <th class="num">KQ / giờ</th>
                  <th style="width:150px">Hiệu quả</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in usage.bySale" :key="s.userId" :style="i < 3 ? 'background:var(--rk-brand-softer)' : ''">
                  <td class="b" :class="{ muted: i >= 3 }" :style="i < 3 ? 'color:var(--rk-brand-700)' : ''">{{ i + 1 }}</td>
                  <td>
                    <div class="cellname">
                      <span class="av" :style="{ background: avColor(s.name) }">{{ initials(s.name) }}</span>
                      <div>{{ s.name }}<div class="sub">{{ s.deptName || '—' }}</div></div>
                    </div>
                  </td>
                  <td class="num">{{ fmtDur(s.avgActiveMinPerDay) }}</td>
                  <td class="num">{{ fmt(s.actions) }}</td>
                  <td><span class="pill brand">{{ s.topModule }}</span></td>
                  <td class="num b">{{ fmtPct(s.closesPerHour) }}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:8px">
                      <div class="bar" :class="scoreClass(s.effScore)" style="flex:1"><i :style="{ width: clampPct(s.effScore) + '%' }"></i></div>
                      <span class="b" style="font-variant-numeric:tabular-nums">{{ fmt(s.effScore) }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Chưa có dữ liệu dùng CRM trong kỳ này.</div>
          </div>
        </div>

        <!-- Module dùng nhiều -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-shape-outline" size="18" /> Module dùng nhiều</div>
            <div class="meta">toàn đội · {{ rangeLabel }}</div>
          </div>
          <div class="card-b">
            <div v-if="usage.moduleUsage.length" class="mod-list">
              <div v-for="m in usage.moduleUsage" :key="m.module" class="mod-row">
                <div class="mod-nm">{{ m.label }}</div>
                <div class="bar brand" style="flex:1"><i :style="{ width: Math.max(3, m.pct) + '%' }"></i></div>
                <div class="mod-vv">{{ fmt(m.actions) }} <span class="muted">· {{ fmtPct(m.pct) }}%</span></div>
              </div>
            </div>
            <div v-else class="rk-empty">Chưa có hoạt động được ghi nhận.</div>
          </div>
        </div>
      </div>

      <!-- 1) LINE CHART — Thời gian dùng CRM theo ngày -->
      <div v-if="usage?.dailySeries?.length" class="card" style="margin-top:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-chart-line" size="18" /> Thời gian dùng CRM theo ngày</div>
          <div class="meta">phút hoạt động / ngày · top {{ usage.dailySeries.length }} sale · {{ rangeLabel }}</div>
        </div>
        <div class="card-b">
          <div v-if="usage.days.length" class="lc-wrap">
            <svg class="lc-svg" :viewBox="`0 0 ${LC.w} ${LC.h}`" preserveAspectRatio="none" role="img">
              <!-- gridlines + Y labels -->
              <g class="lc-grid">
                <line
                  v-for="t in lineYTicks" :key="'gl' + t.v"
                  :x1="LC.padL" :x2="LC.w - LC.padR" :y1="t.y" :y2="t.y"
                />
                <text
                  v-for="t in lineYTicks" :key="'yl' + t.v"
                  class="lc-ylab" :x="LC.padL - 6" :y="t.y + 3" text-anchor="end"
                >{{ t.label }}</text>
              </g>
              <!-- X date labels -->
              <text
                v-for="(t, i) in lineXTicks" :key="'xl' + i"
                class="lc-xlab" :x="t.x" :y="LC.h - 10" text-anchor="middle"
              >{{ t.label }}</text>
              <!-- series -->
              <polyline
                v-for="p in linePolys" :key="'ln' + p.name"
                class="lc-line" :points="p.pts" :stroke="p.color"
              />
            </svg>
            <div class="lc-legend">
              <span v-for="p in linePolys" :key="'lg' + p.name" class="lc-li">
                <i class="lc-sw" :style="{ background: p.color }"></i>{{ p.name }}
              </span>
            </div>
          </div>
          <div v-else class="rk-empty">Chưa có dữ liệu theo ngày.</div>
        </div>
      </div>

      <!-- 2) HEATMAP — Giờ vàng -->
      <div v-if="usage?.hourHeat?.cells?.length" class="card" style="margin-top:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-clock-time-four-outline" size="18" /> Giờ vàng (hoạt động theo giờ × thứ)</div>
          <div class="meta">đậm = nhiều thao tác · {{ rangeLabel }}</div>
        </div>
        <div class="card-b">
          <div class="hh">
            <div class="hh-grid">
              <template v-for="(wd, d) in WEEKDAYS" :key="'hr' + d">
                <div class="hh-rl">{{ wd }}</div>
                <div
                  v-for="h in HOURS" :key="'hc' + d + '-' + h"
                  class="hh-c" :class="'hl' + heatLevel(d, h)"
                  :title="`${wd} · ${h}h · ${fmt(heatCount(d, h))} thao tác`"
                ></div>
              </template>
              <!-- hour axis -->
              <div class="hh-rl"></div>
              <div
                v-for="h in HOURS" :key="'hx' + h"
                class="hh-hx"
              >{{ h % 6 === 0 ? h : '' }}</div>
            </div>
          </div>
          <div class="hh-foot">
            <span class="muted">ít</span>
            <i class="hh-c hl0"></i><i class="hh-c hl1"></i><i class="hh-c hl2"></i><i class="hh-c hl3"></i><i class="hh-c hl4"></i>
            <span class="muted">nhiều</span>
          </div>
        </div>
      </div>

      <!-- 3) QUADRANT — Nỗ lực vs Kết quả -->
      <div v-if="usage?.bySale?.length" class="card" style="margin-top:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-chart-scatter-plot" size="18" /> Nỗ lực vs Kết quả</div>
          <div class="meta">giờ dùng CRM × số chốt · {{ rangeLabel }}</div>
        </div>
        <div class="card-b">
          <div class="qd-wrap">
            <svg class="qd-svg" :viewBox="`0 0 ${QC.w} ${QC.h}`" preserveAspectRatio="xMidYMid meet" role="img">
              <!-- frame -->
              <rect
                class="qd-frame"
                :x="QC.padL" :y="QC.padT"
                :width="QC.w - QC.padL - QC.padR" :height="QC.h - QC.padT - QC.padB"
              />
              <!-- median split lines -->
              <line class="qd-med" :x1="quadX(quadMedX)" :x2="quadX(quadMedX)" :y1="QC.padT" :y2="QC.h - QC.padB" />
              <line class="qd-med" :x1="QC.padL" :x2="QC.w - QC.padR" :y1="quadY(quadMedY)" :y2="quadY(quadMedY)" />
              <!-- quadrant labels -->
              <text class="qd-ql" :x="QC.w - QC.padR - 6" :y="QC.padT + 14" text-anchor="end">Chăm &amp; hiệu quả</text>
              <text class="qd-ql" :x="QC.padL + 6" :y="QC.padT + 14" text-anchor="start">Hiệu quả cao</text>
              <text class="qd-ql" :x="QC.w - QC.padR - 6" :y="QC.h - QC.padB - 6" text-anchor="end">Cần kèm</text>
              <text class="qd-ql" :x="QC.padL + 6" :y="QC.h - QC.padB - 6" text-anchor="start">Ít hoạt động</text>
              <!-- dots -->
              <g v-for="(d, i) in quadDots" :key="'qd' + i">
                <title>{{ d.title }}</title>
                <circle class="qd-dot" :cx="d.cx" :cy="d.cy" r="9" :fill="d.color" />
                <text class="qd-dl" :x="d.cx" :y="d.cy + 3" text-anchor="middle">{{ d.label }}</text>
              </g>
              <!-- axis labels -->
              <text class="qd-ax" :x="(QC.w + QC.padL - QC.padR) / 2" :y="QC.h - 4" text-anchor="middle">Giờ dùng CRM →</text>
              <text class="qd-ax" :x="12" :y="(QC.h - QC.padB + QC.padT) / 2" text-anchor="middle"
                :transform="`rotate(-90 12 ${(QC.h - QC.padB + QC.padT) / 2})`">Số chốt →</text>
            </svg>
          </div>
        </div>
      </div>

      <!-- 4) FUNNEL per sale — Phễu hoạt động → chốt -->
      <div v-if="usage?.funnel?.length" class="card" style="margin-top:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-filter-variant" size="18" /> Phễu hoạt động → chốt</div>
          <div class="meta">Tin gửi → KH phản hồi → Lịch hẹn → Chốt · top {{ usage.funnel.length }} · {{ rangeLabel }}</div>
        </div>
        <div class="card-b">
          <div class="fn-legend">
            <span><i class="fn-sw s0"></i>Tin gửi</span>
            <span><i class="fn-sw s1"></i>KH phản hồi</span>
            <span><i class="fn-sw s2"></i>Lịch hẹn</span>
            <span><i class="fn-sw s3"></i>Chốt</span>
          </div>
          <div class="fn-list">
            <div v-for="f in usage.funnel" :key="f.userId" class="fn-row">
              <div class="cellname fn-nm">
                <span class="av" :style="{ background: avColor(f.name) }">{{ initials(f.name) }}</span>
                <div>{{ f.name }}</div>
              </div>
              <div class="fn-bars">
                <div class="fn-seg s0" :style="{ width: funnelPct(f.sent, f.sent) + '%' }" :title="`Tin gửi: ${fmt(f.sent)}`">{{ fmt(f.sent) }}</div>
                <div class="fn-seg s1" :style="{ width: funnelPct(f.replied, f.sent) + '%' }" :title="`KH phản hồi: ${fmt(f.replied)}`">{{ fmt(f.replied) }}</div>
                <div class="fn-seg s2" :style="{ width: funnelPct(f.appts, f.sent) + '%' }" :title="`Lịch hẹn: ${fmt(f.appts)}`">{{ fmt(f.appts) }}</div>
                <div class="fn-seg s3" :style="{ width: funnelPct(f.closed, f.sent) + '%' }" :title="`Chốt: ${fmt(f.closed)}`">{{ fmt(f.closed) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 5) PERIOD COMPARE — So sánh kỳ này vs kỳ trước -->
      <div v-if="usage?.compare?.length" class="card" style="margin-top:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-compare-horizontal" size="18" /> So sánh kỳ này vs kỳ trước</div>
          <div class="meta">top {{ usage.compare.length }} · {{ rangeLabel }} vs kỳ liền trước</div>
        </div>
        <div class="card-b" style="padding:0">
          <table class="tbl">
            <thead>
              <tr>
                <th>Sale</th>
                <th class="num">Thao tác</th>
                <th class="num">Δ thao tác</th>
                <th class="num">Giờ TB / ngày</th>
                <th class="num">Δ giờ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in usage.compare" :key="c.userId">
                <td>
                  <div class="cellname">
                    <span class="av" :style="{ background: avColor(c.name) }">{{ initials(c.name) }}</span>
                    <div>{{ c.name }}</div>
                  </div>
                </td>
                <td class="num">{{ fmt(c.actions) }}</td>
                <td class="num">
                  <span class="pill" :class="deltaClass(c.dActions)">
                    <v-icon :icon="deltaIcon(c.dActions)" size="12" /> {{ fmt(Math.abs(c.dActions)) }}
                  </span>
                </td>
                <td class="num">{{ fmtDur(c.avgMin) }}</td>
                <td class="num">
                  <span class="pill" :class="deltaClass(c.dAvgMin)">
                    <v-icon :icon="deltaIcon(c.dAvgMin)" size="12" /> {{ fmtDur(Math.abs(c.dAvgMin)) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="usage?.note" class="usage-note">
        <v-icon icon="mdi-information-outline" size="14" /> {{ usage.note }}
      </div>
    </template>

    <!-- EMPTY -->
    <div v-else class="rk-empty">Không tải được dữ liệu báo cáo.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { api } from '@/api';

interface SaleRow {
  userId: string;
  name: string;
  deptName: string;
  contacts: number;
  sent: number;
  avgResponseMin: number;
  apptDone: number;
  apptNoShow: number;
  closed: number;
  leadPoolUsed: number;
  score: number;
}
interface DeptRow {
  deptName: string;
  contacts: number;
  sent: number;
  closed: number;
  closeRate: number;
}
interface Bucket { label: string; count: number }
interface SalesData {
  from: string;
  to: string;
  kpis: {
    activeSales: number;
    totalSales: number;
    avgSentPerSale: number;
    avgResponseMin: number;
    avgCloseRate: number;
  };
  sales: SaleRow[];
  byDept: DeptRow[];
  responseBuckets: Bucket[];
}

// Mức độ dùng CRM (endpoint #9 /reports/crm-usage)
interface UsageSale {
  userId: string; name: string; deptName: string;
  activeDays: number; avgActiveMinPerDay: number; actions: number;
  topModule: string; closesPerHour: number; effScore: number;
  activeHours: number; closed: number;
}
interface ModuleUsage { module: string; label: string; actions: number; pct: number }
interface DailyPoint { date: string; min: number }
interface DailySeries { userId: string; name: string; color: string; points: DailyPoint[] }
interface HeatCell { d: number; h: number; count: number }
interface FunnelRow { userId: string; name: string; sent: number; replied: number; appts: number; closed: number }
interface CompareRow {
  userId: string; name: string;
  actions: number; prevActions: number; dActions: number;
  avgMin: number; prevAvgMin: number; dAvgMin: number;
}
interface CrmUsageData {
  from: string; to: string;
  kpis: { activeSalesToday: number; avgActiveMinPerDay: number; totalActions: number; topModule: string };
  bySale: UsageSale[];
  moduleUsage: ModuleUsage[];
  note: string;
  dailySeries: DailySeries[];
  days: string[];
  hourHeat: { max: number; cells: HeatCell[] };
  funnel: FunnelRow[];
  compare: CompareRow[];
}

const ranges = [
  { key: '7d', label: '7 ngày', days: 7 },
  { key: '30d', label: '30 ngày', days: 30 },
  { key: 'quarter', label: 'Quý', days: 90 },
] as const;

const data = ref<SalesData | null>(null);
const usage = ref<CrmUsageData | null>(null);
const loading = ref(true);
const range = ref<string>('30d');

const rangeLabel = computed(() => ranges.find((r) => r.key === range.value)?.label ?? '');

function dateRange(): { from: string; to: string } {
  const days = ranges.find((r) => r.key === range.value)?.days ?? 30;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

async function load() {
  loading.value = true;
  try {
    const { from, to } = dateRange();
    const [perf, use] = await Promise.allSettled([
      api.get('/reports/sales-performance', { params: { from, to } }),
      api.get('/reports/crm-usage', { params: { from, to } }),
    ]);
    data.value = perf.status === 'fulfilled' ? perf.value.data : null;
    usage.value = use.status === 'fulfilled' ? use.value.data : null;
    if (perf.status === 'rejected') console.error('[SalesReport] sales-performance failed', perf.reason);
    if (use.status === 'rejected') console.error('[SalesReport] crm-usage failed', use.reason);
  } catch (e) {
    console.error('[SalesReport] load failed', e);
    data.value = null;
    usage.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(range, load);

// ---- formatting helpers (vi-VN) ----
const nf = new Intl.NumberFormat('vi-VN');
function fmt(n: number | null | undefined): string {
  return n == null ? '0' : nf.format(Math.round(n));
}
function fmtPct(n: number | null | undefined): string {
  return n == null ? '0' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n);
}
// phút → "Xh Ym" (cho thời gian dùng CRM)
function fmtDur(min: number | null | undefined): string {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60), r = m % 60;
  return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

function clampPct(n: number | null | undefined): number {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

// response-time thresholds: <10 ok, <20 warn, else danger
function respClass(min: number): string {
  if (min < 10) return 'ok';
  if (min < 20) return 'warn';
  return 'danger';
}
function scoreClass(score: number): string {
  if (score >= 75) return 'ok';
  if (score >= 50) return '';
  return 'danger';
}

// bar chart heights normalized to max bucket
const maxBucket = computed(() =>
  Math.max(1, ...(data.value?.responseBuckets.map((b) => b.count) ?? [1])),
);
function bucketHeight(count: number): number {
  return Math.max(4, Math.round((count / maxBucket.value) * 100));
}

// ---- avatar helper ----
function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}
const AV_COLORS = [
  '#1786be', '#7a4fb0', '#b0734f', '#4fb09a', '#b04f6e',
  '#5b8def', '#d39237', '#6e7a8a', '#9a6f4f', '#b04f4f',
];
function avColor(name: string): string {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

// ============ Mức độ dùng CRM — biểu đồ bổ sung ============

// ---- 1) LINE CHART: thời gian dùng theo ngày ----
const LC = { w: 900, h: 260, padL: 46, padR: 16, padT: 16, padB: 30 };
// trục Y dùng phút; trục X = index ngày
const lineMaxMin = computed(() => {
  const series = usage.value?.dailySeries ?? [];
  let mx = 1;
  for (const s of series) for (const p of s.points) if (p.min > mx) mx = p.min;
  return mx;
});
function lineX(idx: number): number {
  const n = usage.value?.days.length ?? 0;
  const span = LC.w - LC.padL - LC.padR;
  if (n <= 1) return LC.padL + span / 2;
  return LC.padL + (idx / (n - 1)) * span;
}
function lineY(min: number): number {
  const span = LC.h - LC.padT - LC.padB;
  const r = Math.max(0, Math.min(1, min / lineMaxMin.value));
  return LC.padT + (1 - r) * span;
}
// điểm polyline cho từng series
const linePolys = computed(() =>
  (usage.value?.dailySeries ?? []).map((s) => ({
    name: s.name,
    color: s.color,
    pts: s.points.map((p, i) => `${lineX(i).toFixed(1)},${lineY(p.min).toFixed(1)}`).join(' '),
  })),
);
// 3 mốc trục Y (0 / giữa / max) — label dạng giờ/phút
const lineYTicks = computed(() => {
  const mx = lineMaxMin.value;
  return [0, Math.round(mx / 2), mx].map((v) => ({ v, y: lineY(v), label: fmtDur(v) }));
});
// ~6-7 nhãn ngày rải đều trên trục X
const lineXTicks = computed(() => {
  const days = usage.value?.days ?? [];
  const n = days.length;
  if (!n) return [] as { x: number; label: string }[];
  const want = Math.min(7, n);
  const step = n <= 1 ? 1 : (n - 1) / (want - 1);
  const out: { x: number; label: string }[] = [];
  const seen = new Set<number>();
  for (let k = 0; k < want; k++) {
    const i = Math.round(k * step);
    if (seen.has(i)) continue;
    seen.add(i);
    out.push({ x: lineX(i), label: shortDate(days[i]) });
  }
  return out;
});
function shortDate(iso: string): string {
  // "2026-06-17" → "17/06"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}` : (iso || '');
}

// ---- 2) HEATMAP giờ × thứ ----
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
// lookup d|h → count
const heatLookup = computed(() => {
  const map = new Map<string, number>();
  for (const c of usage.value?.hourHeat?.cells ?? []) map.set(`${c.d}|${c.h}`, c.count);
  return map;
});
function heatLevel(d: number, h: number): number {
  const max = usage.value?.hourHeat?.max ?? 0;
  const v = heatLookup.value.get(`${d}|${h}`) ?? 0;
  if (max <= 0 || v <= 0) return 0;
  const r = v / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}
function heatCount(d: number, h: number): number {
  return heatLookup.value.get(`${d}|${h}`) ?? 0;
}

// ---- 3) QUADRANT: nỗ lực (giờ) vs kết quả (chốt) ----
const QC = { w: 520, h: 360, padL: 44, padR: 20, padT: 18, padB: 36 };
const quadMaxX = computed(() =>
  Math.max(1, ...(usage.value?.bySale ?? []).map((s) => s.activeHours || 0)),
);
const quadMaxY = computed(() =>
  Math.max(1, ...(usage.value?.bySale ?? []).map((s) => s.closed || 0)),
);
function median(vals: number[]): number {
  const a = [...vals].sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const quadMedX = computed(() => median((usage.value?.bySale ?? []).map((s) => s.activeHours || 0)));
const quadMedY = computed(() => median((usage.value?.bySale ?? []).map((s) => s.closed || 0)));
function quadX(v: number): number {
  const span = QC.w - QC.padL - QC.padR;
  return QC.padL + Math.max(0, Math.min(1, v / quadMaxX.value)) * span;
}
function quadY(v: number): number {
  const span = QC.h - QC.padT - QC.padB;
  return QC.padT + (1 - Math.max(0, Math.min(1, v / quadMaxY.value))) * span;
}
const quadDots = computed(() =>
  (usage.value?.bySale ?? []).map((s) => ({
    name: s.name,
    label: initials(s.name),
    color: avColor(s.name),
    cx: quadX(s.activeHours || 0),
    cy: quadY(s.closed || 0),
    title: `${s.name} · ${fmtDur((s.activeHours || 0) * 60)} · ${fmt(s.closed)} chốt`,
  })),
);

// ---- 4) FUNNEL per sale: chuẩn hoá theo sent ----
function funnelPct(value: number, sent: number): number {
  if (!sent || sent <= 0) return 0;
  return Math.max(0, Math.min(100, (value / sent) * 100));
}

// ---- 5) COMPARE Δ helpers ----
function deltaClass(d: number): string {
  if (d > 0) return 'ok';
  if (d < 0) return 'danger';
  return '';
}
function deltaIcon(d: number): string {
  if (d > 0) return 'mdi-arrow-up';
  if (d < 0) return 'mdi-arrow-down';
  return 'mdi-minus';
}
</script>

<style scoped>
.usage-divider { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700;
  color: var(--rk-brand-700, #0b5880); margin: 20px 0 14px; padding-top: 14px; border-top: 1px dashed var(--rk-hairline, #e6e9ef); }
.usage-divider :deep(.v-icon) { color: var(--rk-brand, #1786be); }
.usage-divider-note { font-size: 12px; font-weight: 500; color: var(--rk-faint, #97a0ac); margin-left: 2px; }
.mod-list { display: flex; flex-direction: column; gap: 11px; }
.mod-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.mod-nm { width: 150px; flex: none; font-weight: 600; color: var(--rk-ink, #1f2d3d); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mod-vv { width: 100px; flex: none; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--rk-ink, #1f2d3d); }
.usage-note { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 12px; color: var(--rk-muted, #6b7785); font-style: italic; }

/* 1) LINE CHART */
.lc-wrap { width: 100%; }
.lc-svg { width: 100%; height: auto; display: block; }
.lc-grid line { stroke: var(--rk-hairline, #e6e9ef); stroke-width: 1; }
.lc-ylab, .lc-xlab { font-size: 10.5px; fill: var(--rk-faint, #97a0ac); font-weight: 600; }
.lc-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.lc-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; }
.lc-li { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--rk-ink, #1f2d3d); }
.lc-sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: none; }

/* 2) HEATMAP */
.hh { overflow-x: auto; }
.hh-grid { display: grid; grid-template-columns: 34px repeat(24, 1fr); gap: 3px; align-items: center; min-width: 560px; }
.hh-rl { font-size: 11.5px; font-weight: 600; color: var(--rk-ink, #1f2d3d); }
.hh-c { aspect-ratio: 1; border-radius: 3px; background: #eef1f6; }
.hh-c.hl0 { background: #eef1f6; } .hh-c.hl1 { background: #d7ecf7; } .hh-c.hl2 { background: #9fd3ec; }
.hh-c.hl3 { background: #4fb0e0; } .hh-c.hl4 { background: var(--rk-brand, #1786be); }
.hh-hx { font-size: 10px; color: var(--rk-faint, #97a0ac); font-weight: 600; text-align: center; }
.hh-foot { display: flex; align-items: center; gap: 4px; margin-top: 12px; font-size: 11px; }
.hh-foot .hh-c { width: 14px; height: 14px; aspect-ratio: auto; flex: none; }
.hh-foot .muted { margin: 0 4px; }

/* 3) QUADRANT */
.qd-wrap { width: 100%; max-width: 560px; margin: 0 auto; }
.qd-svg { width: 100%; height: auto; display: block; }
.qd-frame { fill: var(--rk-surface-2, #f8fafc); stroke: var(--rk-hairline, #e6e9ef); stroke-width: 1; }
.qd-med { stroke: var(--rk-faint, #97a0ac); stroke-width: 1; stroke-dasharray: 4 4; }
.qd-ql { font-size: 10px; fill: var(--rk-faint, #97a0ac); font-weight: 600; }
.qd-dot { stroke: #fff; stroke-width: 1.5; opacity: .92; }
.qd-dl { font-size: 9px; fill: #fff; font-weight: 700; pointer-events: none; }
.qd-ax { font-size: 10.5px; fill: var(--rk-muted, #6b7785); font-weight: 700; }

/* 4) FUNNEL per sale */
.fn-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 14px; font-size: 11.5px; color: var(--rk-muted, #6b7785); }
.fn-legend span { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.fn-sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
.fn-sw.s0 { background: var(--rk-brand-700, #0b5880); } .fn-sw.s1 { background: var(--rk-brand, #1786be); }
.fn-sw.s2 { background: #4fb0e0; } .fn-sw.s3 { background: #9fd3ec; }
.fn-list { display: flex; flex-direction: column; gap: 10px; }
.fn-row { display: flex; align-items: center; gap: 12px; }
.fn-nm { width: 170px; flex: none; }
.fn-nm > div { font-size: 12.5px; font-weight: 600; color: var(--rk-ink, #1f2d3d); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fn-bars { flex: 1; display: flex; align-items: stretch; gap: 2px; height: 26px; min-width: 0; }
.fn-seg { height: 100%; min-width: 22px; display: flex; align-items: center; justify-content: center; border-radius: 5px;
  font-size: 11px; font-weight: 700; color: #fff; overflow: hidden; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fn-seg.s0 { background: var(--rk-brand-700, #0b5880); } .fn-seg.s1 { background: var(--rk-brand, #1786be); }
.fn-seg.s2 { background: #4fb0e0; } .fn-seg.s3 { background: #9fd3ec; color: var(--rk-brand-700, #0b5880); }
</style>
