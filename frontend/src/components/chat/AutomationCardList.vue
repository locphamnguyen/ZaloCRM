<template>
  <section v-if="cards.length || allowEmpty" class="ip-section automation-section">
    <div class="ip-section-title">
      <span class="accent" />
      ⚡ Automation đang chạy
      <span class="scope-tag">per-nick</span>
      <button class="add-mini-btn" title="Gắn thêm automation" @click="$emit('attach')">+</button>
    </div>

    <div v-if="cards.length" class="auto-cards">
      <div
        v-for="card in cards"
        :key="card.id"
        class="auto-card"
        :class="card.state"
      >
        <div class="auto-card-head">
          <span class="head-title">{{ card.title }}</span>
          <span class="auto-state-badge" :class="`badge-${card.state}`">
            {{ stateLabel(card.state) }}
          </span>
        </div>
        <div class="auto-card-meta">{{ card.meta }}</div>
        <div v-if="card.progressPct != null" class="auto-card-progress">
          <div class="auto-card-progress-bar" :style="{ width: card.progressPct + '%' }" />
        </div>
        <div class="auto-card-actions">
          <button
            v-for="action in card.actions"
            :key="action.kind"
            class="auto-btn"
            :class="action.style || ''"
            @click="$emit('action', card.id, action.kind)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      Chưa có automation nào đang chạy cho cặp nick × KH này.
    </div>
  </section>
</template>

<script setup lang="ts">
export type AutomationState = 'running' | 'scheduled' | 'paused' | 'completed';

export interface AutomationCard {
  id: string;
  title: string;
  state: AutomationState;
  meta: string;
  progressPct?: number | null;
  actions: { kind: string; label: string; style?: 'primary' | 'danger' }[];
}

defineProps<{ cards: AutomationCard[]; allowEmpty?: boolean }>();
defineEmits<{ action: [id: string, kind: string]; attach: [] }>();

function stateLabel(state: AutomationState) {
  const map: Record<AutomationState, string> = {
    running: '▶ Đang chạy',
    scheduled: '🕐 Sắp chạy',
    paused: '⏸ Tạm dừng',
    completed: '✓ Hoàn thành',
  };
  return map[state];
}
</script>

<style scoped>
.automation-section {
  padding: 13px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.ip-section-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600;
  color: var(--smax-text);
  margin-bottom: 9px;
}
.ip-section-title .accent {
  width: 3px; height: 14px;
  background: var(--smax-primary);
  border-radius: 2px;
}
.scope-tag {
  font-size: 10px; padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255,145,0,0.15);
  color: #ef6c00;
  font-weight: 500; letter-spacing: 0.3px;
}
.add-mini-btn {
  margin-left: auto;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: var(--smax-grey-100);
  border: 1px solid var(--smax-grey-300);
  cursor: pointer;
  font-size: 13px; color: var(--smax-grey-700);
  display: flex; align-items: center; justify-content: center;
}
.add-mini-btn:hover { background: var(--smax-primary-soft); color: var(--smax-primary); border-color: var(--smax-primary); }

.auto-cards { display: flex; flex-direction: column; gap: 9px; }
.auto-card {
  border: 1px solid var(--smax-grey-200);
  border-radius: 9px;
  padding: 9px 11px;
  background: var(--smax-bg);
  position: relative;
}
.auto-card.running    { border-left: 3px solid var(--smax-success); }
.auto-card.scheduled  { border-left: 3px solid var(--smax-info); }
.auto-card.paused     { border-left: 3px solid var(--smax-warning); }
.auto-card.completed  { border-left: 3px solid var(--smax-grey-300); opacity: 0.78; }

.auto-card-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 7px; margin-bottom: 4px;
}
.head-title { font-size: 13px; font-weight: 600; color: var(--smax-text); }
.auto-state-badge {
  font-size: 10px; padding: 2px 7px;
  border-radius: 9px; font-weight: 500;
  white-space: nowrap;
}
.badge-running    { background: rgba(0,200,83,0.12); color: #00897b; }
.badge-scheduled  { background: rgba(33,150,243,0.12); color: #1565c0; }
.badge-paused     { background: rgba(255,145,0,0.15); color: #ef6c00; }
.badge-completed  { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); }

.auto-card-meta { font-size: 12px; color: var(--smax-grey-700); margin-bottom: 6px; }

.auto-card-progress {
  height: 4px; background: var(--smax-grey-100);
  border-radius: 2px; margin-bottom: 7px;
  overflow: hidden;
}
.auto-card-progress-bar {
  height: 100%; background: var(--smax-primary);
  transition: width 0.3s;
}

.auto-card-actions {
  display: flex; flex-wrap: wrap; gap: 5px;
}
.auto-btn {
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid var(--smax-grey-300);
  background: var(--smax-bg);
  cursor: pointer;
  font-size: 11px;
  color: var(--smax-grey-700);
}
.auto-btn:hover { background: var(--smax-grey-50); }
.auto-btn.primary {
  background: var(--smax-primary);
  border-color: var(--smax-primary);
  color: white;
}
.auto-btn.primary:hover { background: var(--smax-primary-hover); }
.auto-btn.danger { color: #c62828; border-color: rgba(198,40,40,0.3); }
.auto-btn.danger:hover { background: rgba(255,82,82,0.06); }

.empty-state {
  font-size: 12px; color: var(--smax-grey-700);
  font-style: italic;
}
</style>
