<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <div class="modal-title-row">
          <h3 class="modal-title">{{ data?.contact?.crmName || data?.contact?.fullName || 'Khách hàng' }}</h3>
          <div class="modal-stage" v-if="data?.statusRef">
            <span class="stage-chip" :style="{ background: data.statusRef.color || '#6B7280' }">
              {{ data.statusRef.name }}
            </span>
          </div>
        </div>
        <div class="modal-score-big">
          <div class="score-number">{{ data?.leadScore ?? 0 }}<small> / 100</small></div>
          <div class="score-label">Điểm tổng</div>
        </div>
        <button class="modal-close" @click="$emit('close')">×</button>
      </header>

      <div v-if="loading" class="modal-loading">⏳ Đang tải…</div>

      <div v-else-if="data" class="modal-body">
        <!-- 4 sub-scores -->
        <section class="dim-section">
          <h4>📊 4 chiều chấm điểm</h4>
          <div class="dim-rows">
            <div class="dim-row">
              <div class="dim-label">
                <span>🗨️ Tương tác</span>
                <span class="dim-value">{{ Math.round(breakdown.engagement) }} / 100</span>
              </div>
              <div class="dim-bar">
                <div
                  class="dim-fill dim-engagement"
                  :style="{ width: breakdown.engagement + '%' }"
                ></div>
              </div>
            </div>
            <div class="dim-row">
              <div class="dim-label">
                <span>🎯 Ý định mua</span>
                <span class="dim-value">{{ Math.round(breakdown.intent) }} / 100</span>
              </div>
              <div class="dim-bar">
                <div class="dim-fill dim-intent" :style="{ width: breakdown.intent + '%' }"></div>
              </div>
            </div>
            <div class="dim-row">
              <div class="dim-label">
                <span>🎯 Phù hợp</span>
                <span class="dim-value">{{ Math.round(breakdown.fit) }} / 100</span>
              </div>
              <div class="dim-bar">
                <div class="dim-fill dim-fit" :style="{ width: breakdown.fit + '%' }"></div>
              </div>
            </div>
            <div class="dim-row">
              <div class="dim-label">
                <span>⚡ Đà tăng nhiệt</span>
                <span class="dim-value">{{ Math.round(breakdown.velocity) }} / 100</span>
              </div>
              <div class="dim-bar">
                <div
                  class="dim-fill dim-velocity"
                  :style="{ width: breakdown.velocity + '%' }"
                ></div>
              </div>
            </div>
          </div>
        </section>

        <!-- Auto tags -->
        <section v-if="data.autoTags && data.autoTags.length > 0" class="tags-section">
          <h4>🏷️ Thẻ tự động</h4>
          <div class="tags-list">
            <span v-for="tag in data.autoTags" :key="tag" class="auto-tag" :class="`tag-${tag}`">
              {{ tagIcon(tag) }} {{ tagLabel(tag) }}
            </span>
          </div>
        </section>

        <!-- Recent signals -->
        <section v-if="recentSignals.length > 0" class="signals-section">
          <h4>📜 Tín hiệu gần đây ({{ recentSignals.length }})</h4>
          <div class="signals-list">
            <div v-for="(s, i) in recentSignals" :key="i" class="signal-item">
              <div class="signal-label">
                <span class="dim-mini" :class="`dim-mini-${s.dimension}`">{{ dimensionAbbr(s.dimension) }}</span>
                {{ s.label }}
              </div>
              <div class="signal-delta" :class="s.delta > 0 ? 'pos' : 'neg'">
                {{ s.delta > 0 ? '+' : '' }}{{ s.delta }}
              </div>
            </div>
          </div>
        </section>

        <!-- Stuck info -->
        <section v-if="data.stuckSince" class="stuck-section">
          <div class="stuck-banner-mini">
            ⏰ <strong>Đang đình trệ</strong> từ {{ formatDate(data.stuckSince) }}
            ({{ daysSince(data.stuckSince) }} ngày)
          </div>
        </section>

        <!-- Contact-level info -->
        <section v-if="data.contact" class="contact-section">
          <h4>👤 KH lớn (tổng hợp các nick)</h4>
          <div class="contact-summary">
            <div>Điểm tổng hợp: <strong>{{ data.contact.leadScore }}</strong></div>
          </div>
        </section>

        <!-- Updated time -->
        <p class="updated-at">
          Cập nhật lúc: {{ data.scoreUpdatedAt ? formatDateTime(data.scoreUpdatedAt) : 'chưa từng' }}
        </p>
      </div>

      <div v-else class="modal-error">⚠️ Không tải được dữ liệu</div>

      <footer class="modal-footer">
        <button class="btn-secondary" @click="$emit('close')">Đóng</button>
        <button v-if="data" class="btn-primary" @click="$emit('open-chat', data.id)">
          💬 Mở chat
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useScoring } from '@/composables/use-scoring';
import { formatInOrgTz } from '@/composables/use-org-timezone';

const props = defineProps<{
  open: boolean;
  friendId: string | null;
}>();

defineEmits<{
  close: [];
  'open-chat': [friendId: string];
}>();

const scoring = useScoring();
const data = ref<any>(null);
const loading = ref(false);

const breakdown = computed(() => {
  const b = data.value?.scoreBreakdown;
  return {
    engagement: b?.engagement ?? 0,
    intent: b?.intent ?? 0,
    fit: b?.fit ?? 0,
    velocity: b?.velocity ?? 0,
  };
});

const recentSignals = computed(() => {
  const b = data.value?.scoreBreakdown;
  return (b?.signals ?? []).slice(0, 15);
});

const TAG_LABELS: Record<string, string> = {
  active: 'Hoạt động',
  cooling: 'Đang nguội',
  cold: 'Nguội',
  frozen: 'Đóng băng',
  rewarmed: 'Ấm trở lại',
  stuck: 'Đình trệ',
  ready: 'Sẵn sàng chốt',
  atrisk: 'Có nguy cơ',
};
const TAG_ICONS: Record<string, string> = {
  active: '🔥',
  cooling: '❄️',
  cold: '🧊',
  frozen: '🥶',
  rewarmed: '🔄',
  stuck: '⏰',
  ready: '💯',
  atrisk: '🚧',
};

function tagLabel(t: string): string {
  return TAG_LABELS[t] || t;
}
function tagIcon(t: string): string {
  return TAG_ICONS[t] || '🏷️';
}
function dimensionAbbr(d: string): string {
  switch (d) {
    case 'engagement':
      return 'E';
    case 'intent':
      return 'I';
    case 'fit':
      return 'F';
    case 'velocity':
      return 'V';
  }
  return '?';
}
function formatDate(d: string | Date | null): string {
  if (!d) return '';
  return formatInOrgTz(d, undefined, { dateOnly: true });
}
function formatDateTime(d: string | Date | null): string {
  if (!d) return '';
  return formatInOrgTz(d);
}
function daysSince(d: string | Date): number {
  return Math.floor((Date.now() - new Date(d).getTime()) / (24 * 3600 * 1000));
}

async function load() {
  if (!props.friendId) return;
  loading.value = true;
  try {
    data.value = await scoring.getScoreBreakdown(props.friendId);
  } catch (err) {
    data.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.friendId],
  ([newOpen, newId]) => {
    if (newOpen && newId) load();
    else if (!newOpen) data.value = null;
  }
);
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}
.modal-card {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #F3F4F6;
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
}
.modal-title-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.modal-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.modal-stage {
  display: flex;
  gap: 4px;
}
.stage-chip {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  color: white;
}
.modal-score-big {
  text-align: right;
}
.score-number {
  font-size: 28px;
  font-weight: 700;
  color: #10B981;
  line-height: 1;
}
.score-number small {
  font-size: 12px;
  color: #9CA3AF;
  font-weight: 400;
}
.score-label {
  font-size: 11px;
  color: #6B7280;
  margin-top: 2px;
}
.modal-close {
  background: transparent;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #9CA3AF;
}

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}
.modal-loading,
.modal-error {
  padding: 48px;
  text-align: center;
  color: #6B7280;
}

.modal-body h4 {
  font-size: 12px;
  text-transform: uppercase;
  color: #6B7280;
  margin: 16px 0 8px;
  letter-spacing: 0.5px;
}

.dim-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dim-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 13px;
}
.dim-label span:first-child {
  font-weight: 600;
}
.dim-value {
  color: #6B7280;
  font-family: ui-monospace, monospace;
}
.dim-bar {
  background: #F3F4F6;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}
.dim-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}
.dim-engagement {
  background: linear-gradient(90deg, #6366F1, #8B5CF6);
}
.dim-intent {
  background: linear-gradient(90deg, #10B981, #34D399);
}
.dim-fit {
  background: linear-gradient(90deg, #F59E0B, #FBBF24);
}
.dim-velocity {
  background: linear-gradient(90deg, #EC4899, #F472B6);
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.auto-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}
.tag-active { background: #D1FAE5; color: #047857; }
.tag-stuck { background: #FEE2E2; color: #DC2626; }
.tag-cold { background: #DBEAFE; color: #1E40AF; }
.tag-cooling { background: #E0F2FE; color: #075985; }
.tag-frozen { background: #F3F4F6; color: #6B7280; }
.tag-ready { background: #FEF3C7; color: #B45309; }
.tag-rewarmed { background: #FCE7F3; color: #BE185D; }
.tag-atrisk { background: #FED7AA; color: #9A3412; }

.signals-list {
  background: #F9FAFB;
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  max-height: 200px;
  overflow-y: auto;
}
.signal-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed #E5E7EB;
  align-items: center;
}
.signal-item:last-child {
  border-bottom: none;
}
.signal-label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dim-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 50%;
  color: white;
}
.dim-mini-engagement { background: #6366F1; }
.dim-mini-intent { background: #10B981; }
.dim-mini-fit { background: #F59E0B; }
.dim-mini-velocity { background: #EC4899; }
.signal-delta {
  font-family: ui-monospace, monospace;
  font-weight: 600;
}
.signal-delta.pos {
  color: #047857;
}
.signal-delta.neg {
  color: #DC2626;
}

.stuck-section {
  margin-top: 16px;
}
.stuck-banner-mini {
  background: #FEF3C7;
  border-left: 3px solid #F59E0B;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.stuck-banner-mini strong {
  color: #92400E;
}

.contact-section {
  margin-top: 16px;
}
.contact-summary {
  font-size: 13px;
  color: #4B5563;
}

.updated-at {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed #E5E7EB;
  font-size: 11px;
  color: #9CA3AF;
  text-align: right;
}

.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid #F3F4F6;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn-primary,
.btn-secondary {
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: #6366F1;
  color: white;
}
.btn-secondary {
  background: #F3F4F6;
  color: #374151;
  border: 1px solid #E5E7EB;
}
</style>
