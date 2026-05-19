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
      <div class="delta" v-if="stats?.totalNick">
        {{ pct(stats.active, stats.totalNick) }}% online + có hoạt động
      </div>
    </div>

    <div class="stat-card">
      <div class="lab"><span class="d idle"></span>Idle</div>
      <div class="val">{{ stats?.idle ?? '—' }}</div>
      <div class="delta">online nhưng không gửi 24h</div>
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
      <div class="delta">tỉ lệ ngày có hoạt động</div>
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
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
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

@media (max-width: 1280px) {
  .stats-cards { grid-template-columns: repeat(3, 1fr) }
}
@media (max-width: 640px) {
  .stats-cards { grid-template-columns: repeat(2, 1fr) }
}
</style>
