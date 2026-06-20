<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="stats-cards">
    <div class="stat-card">
      <div class="lab">Tổng nick</div>
      <div class="val">{{ stats?.totalNick ?? '—' }}</div>
      <div class="delta" v-if="stats">đăng ký dưới org</div>
    </div>

    <div class="stat-card green">
      <div class="lab"><span class="d ok"></span>Active</div>
      <div class="val">{{ stats?.active ?? '—' }}</div>
      <div class="delta">connected + có gửi/nhận tin 24h</div>
    </div>

    <div class="stat-card yellow">
      <div class="lab"><span class="d idle"></span>Idle</div>
      <div class="val">{{ stats?.idle ?? '—' }}</div>
      <div class="delta">connected nhưng im 24h</div>
    </div>

    <div class="stat-card red">
      <div class="lab"><span class="d err"></span>Error</div>
      <div class="val">{{ stats?.error ?? '—' }}</div>
      <div class="delta" v-if="stats && stats.error > 0">cần re-login</div>
      <div class="delta" v-else>—</div>
    </div>

    <div class="stat-card">
      <div class="lab">Msg today</div>
      <div class="val">
        {{ formatNum(stats?.msgToday ?? 0) }}<span class="small"> / {{ formatNum(stats?.quota ?? 0) }}</span>
      </div>
      <div class="bar-row" v-if="stats">
        <div class="bar"><i :style="{ width: pct(stats.msgToday, stats.quota || 1) + '%' }"></i></div>
        <span class="bar-pct">{{ pct(stats.msgToday, stats.quota || 1) }}%</span>
      </div>
    </div>

    <div class="stat-card green">
      <div class="lab">Uptime team 7d</div>
      <div class="val">{{ stats?.uptimeTeam ?? '—' }}<span class="small" v-if="stats">%</span></div>
      <div class="delta">% thời gian connected trong 7 ngày</div>
    </div>

    <!-- Phase metrics layer 2026-05-22 — 3 cards mới: Bot msg / Friend-add / Phone search -->
    <div class="stat-card purple">
      <div class="lab"><span class="d bot"></span>Bot msg today</div>
      <div class="val">{{ formatNum(stats?.msgSentByBot ?? 0) }}</div>
      <div class="delta">tin do automation engine gửi</div>
    </div>

    <div class="stat-card blue">
      <div class="lab"><span class="d friend"></span>Friend-add today</div>
      <div class="val">{{ formatNum(stats?.friendReqSent ?? 0) }}</div>
      <div class="delta">tổng lời mời kết bạn gửi đi</div>
    </div>

    <div class="stat-card teal">
      <div class="lab"><span class="d phone"></span>Phone search</div>
      <div class="val">{{ formatNum(stats?.phoneSearchTotal ?? 0) }}</div>
      <div class="delta">lượt tìm SĐT trên Zalo hôm nay</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TeamStats } from '@/composables/use-zalo-accounts-dashboard';
defineProps<{ stats: TeamStats | null }>();

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}
function formatNum(n: number): string {
  return n.toLocaleString('vi-VN');
}
</script>

<style scoped>
.stats-cards {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.stat-card {
  background: #FFFFFF;
  border: 1px solid #F3F4F6;
  border-radius: 10px;
  padding: 12px 14px;
  position: relative;
}
.lab {
  font-size: 11px;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: .04em;
  font-weight: 600;
  margin-bottom: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.val {
  font-size: 22px;
  font-weight: 700;
  color: #111827;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.val .small {
  font-size: 12px;
  color: #9CA3AF;
  font-weight: 500;
}
.delta {
  font-size: 11px;
  color: #6B7280;
  margin-top: 4px;
}
.stat-card.green .val { color: #047857 }
.stat-card.red .val { color: #B91C1C }
.stat-card.yellow .val { color: #B45309 }
.stat-card.purple .val { color: #6D28D9 }
.stat-card.blue .val { color: #1D4ED8 }
.stat-card.teal .val { color: #0E7490 }
.d {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 2px;
}
.d.ok { background: #10B981 }
.d.idle { background: #9CA3AF }
.d.err { background: #EF4444 }
.d.bot { background: #8B5CF6 }
.d.friend { background: #3B82F6 }
.d.phone { background: #06B6D4 }
.bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.bar {
  flex: 1;
  height: 5px;
  border-radius: 99px;
  background: #F3F4F6;
  overflow: hidden;
}
.bar > i {
  display: block;
  height: 100%;
  background: #6366F1;
  border-radius: 99px;
}
.bar-pct {
  font-size: 10.5px;
  color: #9CA3AF;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1480px) {
  .stats-cards { grid-template-columns: repeat(5, 1fr) }
}
@media (max-width: 1100px) {
  .stats-cards { grid-template-columns: repeat(3, 1fr) }
}
@media (max-width: 640px) {
  .stats-cards { grid-template-columns: repeat(2, 1fr) }
}
</style>
