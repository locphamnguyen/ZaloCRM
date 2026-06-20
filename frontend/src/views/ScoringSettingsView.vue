<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="settings-view">
    <header class="settings-header">
      <button class="back-btn" @click="$router.back()">← Quay lại</button>
      <h1>⚙️ Cài đặt chấm điểm khách hàng</h1>
    </header>

    <div v-if="loading" class="loading">⏳ Đang tải…</div>

    <div v-else-if="config" class="settings-cards">
      <!-- Weights -->
      <section class="card">
        <h2>📊 Trọng số 4 chiều — tổng phải = 100%</h2>
        <div class="weight-rows">
          <div class="weight-row">
            <label>🗨️ Tương tác (Engagement)</label>
            <input v-model.number="weights.engagement" type="number" min="0" max="100" />
            <span class="unit">%</span>
          </div>
          <div class="weight-row">
            <label>🎯 Ý định mua (Intent)</label>
            <input v-model.number="weights.intent" type="number" min="0" max="100" />
            <span class="unit">%</span>
          </div>
          <div class="weight-row">
            <label>🎯 Phù hợp (Fit)</label>
            <input v-model.number="weights.fit" type="number" min="0" max="100" />
            <span class="unit">%</span>
          </div>
          <div class="weight-row">
            <label>⚡ Đà tăng nhiệt (Velocity)</label>
            <input v-model.number="weights.velocity" type="number" min="0" max="100" />
            <span class="unit">%</span>
          </div>
        </div>
        <div class="sum-row" :class="{ invalid: weightSum !== 100 }">
          Tổng: {{ weightSum }}%
          <span v-if="weightSum !== 100" class="error-hint">— phải = 100%</span>
        </div>
      </section>

      <!-- Decay rules -->
      <section class="card">
        <h2>📉 Giảm điểm khi KH im lặng</h2>
        <p class="hint">Mỗi ngày silent: trừ điểm từ Engagement</p>
        <div class="weight-rows">
          <div class="weight-row">
            <label>3-7 ngày silent</label>
            <input v-model.number="decay.day3to7" type="number" />
            <span class="unit">/ngày</span>
          </div>
          <div class="weight-row">
            <label>7-14 ngày silent</label>
            <input v-model.number="decay.day7to14" type="number" />
            <span class="unit">/ngày</span>
          </div>
          <div class="weight-row">
            <label>14-30 ngày silent</label>
            <input v-model.number="decay.day14to30" type="number" />
            <span class="unit">/ngày</span>
          </div>
          <div class="weight-row">
            <label>30-60 ngày silent</label>
            <input v-model.number="decay.day30to60" type="number" />
            <span class="unit">/ngày</span>
          </div>
        </div>
      </section>

      <!-- Flags -->
      <section class="card">
        <h2>🎛️ Cờ điều khiển</h2>
        <div class="toggle-row">
          <label>
            <input v-model="flags.autoPromote" type="checkbox" />
            <span>Tự động chuyển giai đoạn (auto-promote)</span>
          </label>
        </div>
        <div class="toggle-row">
          <label>
            <input v-model="flags.stuckDetectionEnabled" type="checkbox" />
            <span>Phát hiện đình trệ (cron daily 6am)</span>
          </label>
        </div>
        <div class="toggle-row">
          <label>
            <input v-model="flags.explainabilityEnabled" type="checkbox" />
            <span>Lưu chi tiết signals (cho UI giải thích "tại sao có điểm này")</span>
          </label>
        </div>
      </section>

      <!-- Actions -->
      <section class="card actions-card">
        <h2>🛠️ Hành động quản trị</h2>
        <div class="action-buttons">
          <button class="btn-primary" :disabled="saving || weightSum !== 100" @click="save">
            {{ saving ? '⏳ Đang lưu…' : '💾 Lưu cấu hình' }}
          </button>
          <button class="btn-secondary" :disabled="seeding" @click="seedDefaults">
            {{ seeding ? '⏳ Đang seed…' : '🌱 Seed defaults (idempotent)' }}
          </button>
          <button class="btn-secondary" :disabled="recomputing" @click="recompute">
            {{ recomputing ? '⏳ Đang tính lại…' : '🔁 Tính lại toàn bộ điểm' }}
          </button>
          <button class="btn-secondary" :disabled="scanning" @click="scanStuck">
            {{ scanning ? '⏳ Đang quét…' : '🔍 Quét stuck ngay' }}
          </button>
        </div>
      </section>

      <!-- Signal rules table (read-only summary, full edit modal in future) -->
      <section class="card">
        <h2>📜 Quy tắc chấm điểm ({{ rules.length }})</h2>
        <table class="rules-table">
          <thead>
            <tr>
              <th>Khoá</th>
              <th>Chiều</th>
              <th>Loại</th>
              <th>Δ</th>
              <th>Cap/ngày</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rules" :key="r.id">
              <td><code>{{ r.signalKey }}</code></td>
              <td>{{ dimensionLabel(r.dimension) }}</td>
              <td>{{ r.ruleType }}</td>
              <td :class="r.delta > 0 ? 'pos' : 'neg'">{{ r.delta > 0 ? '+' : '' }}{{ r.delta }}</td>
              <td>{{ r.capPerDay ?? '—' }}</td>
              <td>
                <span v-if="r.enabled" class="badge-on">Bật</span>
                <span v-else class="badge-off">Tắt</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="hint">
          Sửa từng rule sẽ có ở phiên bản kế tiếp. Hiện tại tune qua API
          <code>PUT /api/v1/scoring/rules/:id</code>.
        </p>
      </section>
    </div>

    <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
import { useScoring, type ScoringConfig, type SignalRule } from '@/composables/use-scoring';

const scoring = useScoring();

const loading = ref(false);
const saving = ref(false);
const seeding = ref(false);
const recomputing = ref(false);
const scanning = ref(false);
const config = ref<ScoringConfig | null>(null);
const rules = ref<SignalRule[]>([]);
const toast = ref<{ type: 'success' | 'error'; message: string } | null>(null);

const weights = reactive({ engagement: 35, intent: 30, fit: 15, velocity: 20 });
const decay = reactive({ day3to7: -1, day7to14: -3, day14to30: -5, day30to60: -8 });
const flags = reactive({
  autoPromote: true,
  stuckDetectionEnabled: true,
  explainabilityEnabled: true,
});

const weightSum = computed(
  () => weights.engagement + weights.intent + weights.fit + weights.velocity
);

function dimensionLabel(d: string): string {
  switch (d) {
    case 'engagement':
      return '🗨️ Tương tác';
    case 'intent':
      return '🎯 Ý định';
    case 'fit':
      return '🎯 Phù hợp';
    case 'velocity':
      return '⚡ Đà nhiệt';
    default:
      return d;
  }
}

function showToast(type: 'success' | 'error', message: string) {
  toast.value = { type, message };
  setTimeout(() => {
    toast.value = null;
  }, 3500);
}

async function load() {
  loading.value = true;
  try {
    config.value = await scoring.getScoringConfig();
    rules.value = await scoring.getSignalRules();
    if (config.value) {
      weights.engagement = config.value.weights.engagement;
      weights.intent = config.value.weights.intent;
      weights.fit = config.value.weights.fit;
      weights.velocity = config.value.weights.velocity;
      decay.day3to7 = config.value.decay.day3to7;
      decay.day7to14 = config.value.decay.day7to14;
      decay.day14to30 = config.value.decay.day14to30;
      decay.day30to60 = config.value.decay.day30to60;
      flags.autoPromote = config.value.autoPromote;
      flags.stuckDetectionEnabled = config.value.stuckDetectionEnabled;
      flags.explainabilityEnabled = config.value.explainabilityEnabled;
    }
  } catch (err: any) {
    showToast('error', err?.message || 'Không tải được cấu hình');
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (weightSum.value !== 100) {
    showToast('error', 'Tổng trọng số phải = 100');
    return;
  }
  saving.value = true;
  try {
    await scoring.updateScoringConfig({
      weightEngagement: weights.engagement,
      weightIntent: weights.intent,
      weightFit: weights.fit,
      weightVelocity: weights.velocity,
      decayDay3to7: decay.day3to7,
      decayDay7to14: decay.day7to14,
      decayDay14to30: decay.day14to30,
      decayDay30to60: decay.day30to60,
      autoPromote: flags.autoPromote,
      stuckDetectionEnabled: flags.stuckDetectionEnabled,
      explainabilityEnabled: flags.explainabilityEnabled,
    });
    showToast('success', '✓ Đã lưu cấu hình');
  } catch (err: any) {
    showToast('error', 'Lưu thất bại: ' + (err?.response?.data?.error || err?.message));
  } finally {
    saving.value = false;
  }
}

async function seedDefaults() {
  seeding.value = true;
  try {
    const result = await scoring.seedDefaults();
    showToast(
      'success',
      `Đã seed: ${result.signalRulesCreated} rules, ${result.stuckThresholdsCreated} thresholds, ${result.nbaTemplatesCreated} templates`
    );
    await load();
  } catch (err: any) {
    showToast('error', 'Seed thất bại');
  } finally {
    seeding.value = false;
  }
}

async function recompute() {
  recomputing.value = true;
  try {
    const result = await scoring.recomputeAll();
    showToast(
      'success',
      `Đã tính lại ${result.total} friend, ${result.updated} bị thay đổi`
    );
  } catch (err: any) {
    showToast('error', 'Tính lại thất bại');
  } finally {
    recomputing.value = false;
  }
}

async function scanStuck() {
  scanning.value = true;
  try {
    const result = await scoring.scanStuckNow();
    showToast(
      'success',
      `Đã quét ${result.scanned} friend, ${result.newlyStuck} mới đình trệ`
    );
  } catch (err: any) {
    showToast('error', 'Scan thất bại');
  } finally {
    scanning.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settings-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}
.settings-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.settings-header h1 {
  font-size: 24px;
  margin: 0;
}
.back-btn {
  background: #fff;
  border: 1px solid #E5E7EB;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.loading {
  text-align: center;
  padding: 48px;
  color: #6B7280;
}

.settings-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  background: white;
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.card h2 {
  margin: 0 0 12px;
  font-size: 16px;
}
.hint {
  font-size: 12px;
  color: #6B7280;
  margin: -8px 0 12px;
}

.weight-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.weight-row {
  display: grid;
  grid-template-columns: 240px 100px auto;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.weight-row label {
  font-size: 13px;
}
.weight-row input {
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  padding: 6px 10px;
  text-align: center;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.weight-row .unit {
  font-size: 13px;
  color: #6B7280;
}

.sum-row {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #F3F4F6;
  font-size: 14px;
  font-weight: 600;
  text-align: right;
}
.sum-row.invalid {
  color: #DC2626;
}
.error-hint {
  font-weight: 400;
  font-size: 12px;
  margin-left: 8px;
}

.toggle-row {
  padding: 6px 0;
}
.toggle-row label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.actions-card .action-buttons {
  display: flex;
  flex-wrap: wrap;
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
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  background: #F3F4F6;
  color: #374151;
  border: 1px solid #E5E7EB;
}

.rules-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.rules-table th,
.rules-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #F3F4F6;
}
.rules-table th {
  background: #FAFBFC;
  color: #6B7280;
  text-transform: uppercase;
  font-size: 10px;
}
.rules-table code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  background: #F3F4F6;
  padding: 1px 6px;
  border-radius: 4px;
}
.rules-table .pos { color: #047857; font-weight: 600; }
.rules-table .neg { color: #DC2626; font-weight: 600; }

.badge-on {
  background: #D1FAE5;
  color: #047857;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
}
.badge-off {
  background: #F3F4F6;
  color: #9CA3AF;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
}

.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  background: #111827;
  color: white;
  padding: 12px 20px;
  border-radius: 10px;
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 9999;
}
.toast.success { background: #10B981; }
.toast.error { background: #EF4444; }
</style>
