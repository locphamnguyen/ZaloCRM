<template>
  <div class="triggers-view">
    <header class="at-page-header">
      <div>
        <h1 class="at-page-title">Mục tiêu</h1>
        <p class="at-page-subtitle">
          Khi sự kiện xảy ra → engine tự động khởi động Luồng kịch bản / Khối bạn đã cấu hình.
          Mục tiêu là điểm vào — Luồng kịch bản / Khối là việc cần làm.
        </p>
      </div>
      <div class="header-actions">
        <button class="at-btn at-btn--ghost" :class="{ 'is-active': tab === 'configured' }" @click="tab = 'configured'">
          Đã cấu hình
          <span v-if="configured.length > 0" class="at-chip">{{ configured.length }}</span>
        </button>
        <button class="at-btn at-btn--ghost" :class="{ 'is-active': tab === 'catalog' }" @click="tab = 'catalog'">
          Catalog
        </button>
      </div>
    </header>

    <!-- ─── CATALOG TAB ─── -->
    <div v-if="tab === 'catalog'">
      <div class="catalog-toolbar">
        <div class="catalog-search">
          <v-icon size="18" color="rgba(0,0,0,0.4)">mdi-magnify</v-icon>
          <input
            v-model="catalogSearch"
            class="catalog-search__input"
            placeholder="Tìm Mục tiêu theo tên hoặc mô tả..."
          />
        </div>
        <div class="catalog-filter">
          <button
            class="filter-chip"
            :class="{ 'is-active': categoryFilter === 'all' }"
            @click="categoryFilter = 'all'"
          >
            Tất cả
          </button>
          <button
            v-for="cat in availableCategories"
            :key="cat.key"
            class="filter-chip"
            :class="{ 'is-active': categoryFilter === cat.key }"
            @click="categoryFilter = cat.key"
          >
            {{ cat.label }}
          </button>
        </div>
      </div>

      <div v-for="group in groupedCatalog" :key="group.category" class="catalog-group">
        <div class="catalog-group__head">
          <span class="catalog-group__label">{{ CATEGORY_COLOR[group.category].label }}</span>
          <span class="catalog-group__count">{{ group.items.length }}</span>
        </div>

        <div class="catalog-grid">
          <article
            v-for="entry in group.items"
            :key="entry.eventType"
            class="catalog-card"
            :style="{
              '--card-accent': CATEGORY_COLOR[entry.category].bg,
              '--card-tint': CATEGORY_COLOR[entry.category].tint,
              '--card-text': CATEGORY_COLOR[entry.category].text,
            }"
          >
            <div class="catalog-card__head">
              <div class="catalog-card__icon">
                <v-icon size="20">{{ iconForEvent(entry.eventType) }}</v-icon>
              </div>
              <span class="catalog-card__binding">
                {{ bindingLabel(entry.recommendedBinding) }}
              </span>
            </div>
            <h3 class="catalog-card__title">{{ entry.title }}</h3>
            <p class="catalog-card__desc">{{ entry.description }}</p>
            <button class="at-btn at-btn--primary at-btn--sm" @click="openCreateFromCatalog(entry)">
              Khởi tạo
            </button>
          </article>
        </div>
      </div>

      <div v-if="groupedCatalog.length === 0" class="at-empty">
        <v-icon size="40">mdi-magnify-close</v-icon>
        <div class="at-empty__title">Không tìm thấy trigger</div>
        <p class="at-empty__desc">Đổi từ khoá tìm hoặc xoá filter để xem toàn bộ catalog.</p>
      </div>
    </div>

    <!-- ─── CONFIGURED TAB ─── -->
    <div v-else>
      <div v-if="loading" class="at-empty">
        <v-progress-circular indeterminate size="28" color="primary" />
      </div>

      <div v-else-if="configured.length === 0" class="at-empty">
        <v-icon size="48">mdi-lightning-bolt-outline</v-icon>
        <div class="at-empty__title">Chưa có trigger nào</div>
        <p class="at-empty__desc">
          Vào Catalog để chọn 1 trong {{ catalog.length }} trigger mẫu, hoặc tạo manual.
        </p>
        <button class="at-btn at-btn--primary" @click="tab = 'catalog'">Xem catalog</button>
      </div>

      <div v-else class="configured-table">
        <div class="configured-row configured-row--head">
          <div>Mục tiêu</div>
          <div>Sự kiện</div>
          <div>Bind tới</div>
          <div class="cell-center">Bật</div>
          <div class="cell-right">Thao tác</div>
        </div>
        <div
          v-for="trig in configured"
          :key="trig.id"
          class="configured-row"
        >
          <div class="cell-trig">
            <div
              class="trig-avatar"
              :style="{ background: CATEGORY_COLOR[trig.category].tint, color: CATEGORY_COLOR[trig.category].text }"
            >
              <v-icon size="18">{{ iconForEvent(trig.eventType) }}</v-icon>
            </div>
            <div>
              <div class="trig-name">{{ trig.name }}</div>
              <div class="trig-meta">{{ CATEGORY_COLOR[trig.category].label }}</div>
            </div>
          </div>
          <div>
            <span class="at-chip">{{ trig.eventType }}</span>
          </div>
          <div>
            <span v-if="trig.sequence" class="binding-link">→ {{ trig.sequence.name }}</span>
            <span v-else-if="trig.broadcast" class="binding-link">→ {{ trig.broadcast.name }}</span>
            <span v-else-if="trig.blockId" class="binding-link">→ Block</span>
            <span v-else class="binding-link binding-link--error">⚠ Chưa bind</span>
          </div>
          <div class="cell-center">
            <v-switch
              :model-value="trig.enabled"
              hide-details inline density="compact" color="success"
              @update:model-value="toggleTrigger(trig)"
            />
          </div>
          <div class="cell-right cell-actions">
            <button class="at-btn at-btn--ghost at-btn--xs" @click="openEdit(trig)" title="Sửa">
              <v-icon size="16">mdi-pencil-outline</v-icon>
            </button>
            <button
              class="at-btn at-btn--ghost at-btn--xs"
              :disabled="!trig.enabled"
              @click="onManualRun(trig)"
              title="Chạy thủ công"
            >
              <v-icon size="16">mdi-play-circle-outline</v-icon>
            </button>
            <button class="at-btn at-btn--ghost at-btn--xs" @click="onDelete(trig)" title="Xoá" style="color: var(--at-coral);">
              <v-icon size="16">mdi-delete-outline</v-icon>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Editor dialog (Vuetify wrapped, but body uses airtable classes) -->
    <v-dialog v-model="editorOpen" max-width="640" persistent>
      <div v-if="draft" class="airtable-scope editor-card">
        <div class="editor-card__head">
          <div
            class="trig-avatar"
            :style="{ background: CATEGORY_COLOR[draft.category].tint, color: CATEGORY_COLOR[draft.category].text }"
          >
            <v-icon size="22">{{ iconForEvent(draft.eventType) }}</v-icon>
          </div>
          <div>
            <div class="at-title-sm">{{ draft.id ? 'Sửa Trigger' : 'Tạo Trigger' }}</div>
            <div class="at-caption">{{ draft.eventType }}</div>
          </div>
          <button class="editor-card__close" @click="editorOpen = false">
            <v-icon>mdi-close</v-icon>
          </button>
        </div>
        <hr class="at-hairline" />
        <div class="editor-card__body">
          <div class="form-field">
            <label class="form-label">Tên</label>
            <input v-model="draft.name" class="at-input" placeholder="Ví dụ: KH đồng ý kết bạn → gửi welcome" />
          </div>

          <div class="form-field">
            <label class="form-label">Event type</label>
            <select v-model="draft.eventType" class="at-input">
              <option v-for="opt in eventTypeItems" :key="opt.value" :value="opt.value">{{ opt.title }}</option>
            </select>
          </div>

          <div class="form-field">
            <label class="form-label">Bind tới gì khi sự kiện fire</label>
            <select v-model="draft.bindingKind" class="at-input">
              <option value="sequence">Luồng kịch bản (multi-step flow)</option>
              <option value="block">Khối (1 action)</option>
              <option value="broadcast" disabled>Broadcast (Phase F)</option>
            </select>
          </div>

          <div v-if="draft.bindingKind === 'sequence'" class="form-field">
            <label class="form-label">Luồng kịch bản sẽ chạy</label>
            <select v-model="draft.sequenceId" class="at-input">
              <option :value="null">— Chọn Luồng kịch bản —</option>
              <option v-for="s in sequenceOptions" :key="s.value" :value="s.value">{{ s.title }}</option>
            </select>
            <p v-if="sequenceOptions.length === 0" class="at-caption form-hint">
              Chưa có Luồng kịch bản enabled. Tạo ở tab Luồng kịch bản trước.
            </p>
          </div>
          <div v-if="draft.bindingKind === 'block'" class="form-field">
            <label class="form-label">Khối sẽ chạy</label>
            <select v-model="draft.blockId" class="at-input">
              <option :value="null">— Chọn Khối —</option>
              <option v-for="b in blockOptions" :key="b.value" :value="b.value">{{ b.title }}</option>
            </select>
          </div>

          <!-- Cron expression field — only for scheduled_cron event type -->
          <div v-if="draft.eventType === 'scheduled_cron'" class="form-field">
            <label class="form-label">Cron expression (TZ Asia/Ho_Chi_Minh)</label>
            <input v-model="draft.cronExpr" class="at-input" placeholder="0 9 * * 1   (9h sáng thứ 2 hàng tuần)" />
            <p class="at-caption form-hint">
              Format: <code>phút giờ ngày tháng thứ</code>. Ví dụ:
              <code>0 9 * * 1</code> = 9h sáng T2,
              <code>0 8 1 * *</code> = 8h sáng ngày 1 mỗi tháng,
              <code>0 */2 * * *</code> = mỗi 2 tiếng.
            </p>
            <div class="cron-presets">
              <button type="button" class="filter-chip" @click="draft.cronExpr = '0 9 * * 1'">T2 9h</button>
              <button type="button" class="filter-chip" @click="draft.cronExpr = '0 8 1 * *'">Ngày 1 mỗi tháng 8h</button>
              <button type="button" class="filter-chip" @click="draft.cronExpr = '0 9 * * *'">Daily 9h</button>
              <button type="button" class="filter-chip" @click="draft.cronExpr = '0 18 * * 5'">T6 18h</button>
            </div>
          </div>

          <label class="form-toggle">
            <input type="checkbox" v-model="draft.enabled" />
            <span>Bật trigger ngay sau khi lưu</span>
          </label>

          <div v-if="error" class="form-error">{{ error }}</div>
        </div>
        <hr class="at-hairline" />
        <div class="editor-card__foot">
          <button class="at-btn at-btn--secondary" @click="editorOpen = false">Huỷ</button>
          <button class="at-btn at-btn--primary" :disabled="saving" @click="saveTrigger">
            {{ saving ? 'Đang lưu...' : 'Lưu' }}
          </button>
        </div>
      </div>
    </v-dialog>

    <v-snackbar v-model="toastOpen" :color="toastColor" timeout="3000" location="bottom right">
      {{ toastMsg }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { triggersApi, sequencesApi, blocksApi } from '@/api/automation';
import type {
  AutomationTrigger, TriggerCatalogEntry, AutomationSequence, Block,
  TriggerEventType, TriggerBindingKind, TriggerCategory,
} from '@/api/automation/types';
import { CATEGORY_COLOR, iconForEvent } from '@/components/automation/phase7/design-tokens';

const tab = ref<'configured' | 'catalog'>('configured');
const catalog = ref<TriggerCatalogEntry[]>([]);
const configured = ref<AutomationTrigger[]>([]);
const sequences = ref<AutomationSequence[]>([]);
const blocks = ref<Block[]>([]);
const loading = ref(true);

const catalogSearch = ref('');
const categoryFilter = ref<'all' | TriggerCategory>('all');

const editorOpen = ref(false);
const saving = ref(false);
const error = ref('');

const toastOpen = ref(false);
const toastMsg = ref('');
const toastColor = ref<'success' | 'error' | 'info'>('info');

interface Draft {
  id: string | null;
  name: string;
  eventType: TriggerEventType;
  category: TriggerCategory;
  bindingKind: TriggerBindingKind;
  sequenceId: string | null;
  blockId: string | null;
  broadcastId: string | null;
  enabled: boolean;
  cronExpr: string; // packed into eventFilter.cron when eventType=scheduled_cron
}
const draft = ref<Draft | null>(null);

const availableCategories = computed(() => {
  const present = new Set(catalog.value.map((c) => c.category));
  return Array.from(present).map((key) => ({ key, label: CATEGORY_COLOR[key].label }));
});

const filteredCatalog = computed(() => {
  const q = catalogSearch.value?.trim().toLowerCase() ?? '';
  return catalog.value.filter((c) => {
    if (categoryFilter.value !== 'all' && c.category !== categoryFilter.value) return false;
    if (!q) return true;
    return c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
  });
});

const groupedCatalog = computed(() => {
  const map = new Map<TriggerCategory, TriggerCatalogEntry[]>();
  for (const e of filteredCatalog.value) {
    if (!map.has(e.category)) map.set(e.category, []);
    map.get(e.category)!.push(e);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
});

const eventTypeItems = computed(() =>
  catalog.value.map((c) => ({ value: c.eventType, title: `${c.title} (${c.eventType})` })),
);

const sequenceOptions = computed(() =>
  sequences.value.filter((s) => s.enabled).map((s) => ({ value: s.id, title: s.name })),
);
const blockOptions = computed(() =>
  blocks.value.filter((b) => !b.archivedAt).map((b) => ({ value: b.id, title: b.name })),
);

function bindingLabel(b: TriggerBindingKind): string {
  return { sequence: 'Sequence', block: 'Block', broadcast: 'Broadcast' }[b];
}

async function loadAll() {
  loading.value = true;
  try {
    const [cat, conf, seqs, blks] = await Promise.all([
      triggersApi.listTriggerCatalog(),
      triggersApi.listTriggers(),
      sequencesApi.listSequences(),
      blocksApi.listBlocks({ limit: 500 }),
    ]);
    catalog.value = cat;
    configured.value = conf;
    sequences.value = seqs;
    blocks.value = blks;
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);

function openCreateFromCatalog(entry: TriggerCatalogEntry) {
  draft.value = {
    id: null,
    name: entry.title,
    eventType: entry.eventType,
    category: entry.category,
    bindingKind: entry.recommendedBinding === 'broadcast' ? 'sequence' : entry.recommendedBinding,
    sequenceId: null,
    blockId: null,
    broadcastId: null,
    enabled: false,
    cronExpr: entry.eventType === 'scheduled_cron' ? '0 9 * * 1' : '',
  };
  error.value = '';
  editorOpen.value = true;
}

function openEdit(trig: AutomationTrigger) {
  draft.value = {
    id: trig.id,
    name: trig.name,
    eventType: trig.eventType,
    category: trig.category,
    bindingKind: trig.bindingKind,
    sequenceId: trig.sequenceId,
    blockId: trig.blockId,
    broadcastId: trig.broadcastId,
    enabled: trig.enabled,
    cronExpr: extractCronFromFilter(trig.eventFilter),
  };
  error.value = '';
  editorOpen.value = true;
}

function extractCronFromFilter(filter: Record<string, unknown> | null): string {
  if (!filter || typeof filter !== 'object') return '';
  const c = (filter as Record<string, unknown>).cron;
  return typeof c === 'string' ? c : '';
}

function showToast(msg: string, color: 'success' | 'error' | 'info' = 'info') {
  toastMsg.value = msg; toastColor.value = color; toastOpen.value = true;
}

async function saveTrigger() {
  if (!draft.value) return;
  error.value = '';
  if (!draft.value.name.trim()) { error.value = 'Tên không được rỗng'; return; }

  // For scheduled_cron, cron expression is mandatory
  if (draft.value.eventType === 'scheduled_cron' && !draft.value.cronExpr.trim()) {
    error.value = 'Cron expression không được rỗng cho scheduled_cron';
    return;
  }

  saving.value = true;
  try {
    const payload: Record<string, unknown> = {
      name: draft.value.name.trim(),
      eventType: draft.value.eventType,
      bindingKind: draft.value.bindingKind,
      sequenceId: draft.value.bindingKind === 'sequence' ? draft.value.sequenceId : null,
      blockId: draft.value.bindingKind === 'block' ? draft.value.blockId : null,
      broadcastId: draft.value.bindingKind === 'broadcast' ? draft.value.broadcastId : null,
      enabled: draft.value.enabled,
    };
    // Pack cron into eventFilter (backend cron-event-scheduler reads from here)
    if (draft.value.eventType === 'scheduled_cron') {
      payload.eventFilter = { cron: draft.value.cronExpr.trim() };
    }
    if (draft.value.id) await triggersApi.updateTrigger(draft.value.id, payload as any);
    else                await triggersApi.createTrigger(payload as any);
    editorOpen.value = false;
    tab.value = 'configured';
    await loadAll();
    showToast('Đã lưu', 'success');
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Lỗi';
  } finally {
    saving.value = false;
  }
}

async function toggleTrigger(trig: AutomationTrigger) {
  try {
    if (trig.enabled) await triggersApi.disableTrigger(trig.id);
    else              await triggersApi.enableTrigger(trig.id);
    await loadAll();
  } catch (err: any) {
    showToast(err?.response?.data?.error ?? 'Lỗi toggle', 'error');
  }
}

async function onManualRun(trig: AutomationTrigger) {
  const contactId = prompt(`Chạy "${trig.name}" cho contactId nào?`);
  if (contactId === null) return;
  try {
    await triggersApi.runTrigger(trig.id, contactId ? { contactId } : {});
    showToast('Event đã emit. Worker sẽ pick task trong ~10s.', 'success');
  } catch (err: any) {
    showToast(err?.response?.data?.error ?? err?.message, 'error');
  }
}

async function onDelete(trig: AutomationTrigger) {
  if (!confirm(`Xoá trigger "${trig.name}"?`)) return;
  try {
    await triggersApi.deleteTrigger(trig.id);
    await loadAll();
    showToast('Đã xoá', 'success');
  } catch (err: any) {
    showToast(err?.response?.data?.detail || err?.response?.data?.error || 'Không xoá được', 'error');
  }
}
</script>

<style scoped>
.triggers-view { max-width: 1280px; }

.header-actions {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--at-surface-soft);
  border-radius: var(--at-r-md);
}
.header-actions .at-btn.is-active {
  background: var(--at-canvas);
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

/* Toolbar */
.catalog-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--at-s-sm);
  margin-bottom: var(--at-s-lg);
}
.catalog-search {
  display: flex;
  align-items: center;
  gap: var(--at-s-xs);
  padding: 0 var(--at-s-sm);
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-sm);
  height: 44px;
  max-width: 480px;
}
.catalog-search:focus-within { border-color: var(--at-info-border); }
.catalog-search__input {
  border: 0;
  background: transparent;
  flex: 1;
  font-size: 14px;
  color: var(--at-ink);
  outline: none;
  font-family: inherit;
}
.catalog-search__input::placeholder { color: var(--at-muted); }

.catalog-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.filter-chip {
  background: var(--at-canvas);
  color: var(--at-body);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-pill);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.filter-chip.is-active {
  background: var(--at-ink);
  color: var(--at-on-primary);
  border-color: var(--at-ink);
}

/* Groups */
.catalog-group { margin-bottom: var(--at-s-xl); }
.catalog-group__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--at-s-sm);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--at-muted);
}
.catalog-group__count {
  background: var(--at-surface-soft);
  padding: 2px 8px;
  border-radius: var(--at-r-pill);
  font-size: 11px;
  font-weight: 500;
  color: var(--at-body);
}

/* Cards */
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--at-s-sm);
}
.catalog-card {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-md);
  display: flex;
  flex-direction: column;
  gap: var(--at-s-sm);
  position: relative;
  transition: border-color 0.1s;
}
.catalog-card::before {
  content: '';
  position: absolute;
  left: 0; top: var(--at-s-sm); bottom: var(--at-s-sm);
  width: 3px;
  border-radius: 2px;
  background: var(--card-accent);
  opacity: 0;
  transition: opacity 0.1s;
}
.catalog-card:hover::before { opacity: 1; }
.catalog-card:hover { border-color: var(--card-accent); }

.catalog-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.catalog-card__icon {
  width: 36px;
  height: 36px;
  border-radius: var(--at-r-md);
  background: var(--card-tint);
  color: var(--card-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.catalog-card__binding {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--at-muted);
  padding: 4px 8px;
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-sm);
}
.catalog-card__title {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--at-ink);
  margin: 0;
}
.catalog-card__desc {
  font-size: 13px;
  line-height: 1.45;
  color: var(--at-body);
  margin: 0;
  min-height: 36px;
}

/* Configured table — desktop grid, mobile card list */
.configured-table {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  overflow: hidden;
}
.configured-row {
  display: grid;
  grid-template-columns: 2fr 1.2fr 1.5fr 80px 180px;
  align-items: center;
  padding: var(--at-s-sm) var(--at-s-md);
  border-bottom: 1px solid var(--at-hairline);
  gap: var(--at-s-sm);
  font-size: 14px;
}
.configured-row:last-child { border-bottom: 0; }
.configured-row--head {
  background: var(--at-surface-soft);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--at-muted);
}
.cell-trig { display: flex; align-items: center; gap: var(--at-s-sm); min-width: 0; }
.trig-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--at-r-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.trig-name {
  font-weight: 500;
  color: var(--at-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trig-meta { font-size: 12px; color: var(--at-muted); margin-top: 2px; }
.binding-link {
  color: var(--at-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}
.binding-link--error { color: var(--at-coral); font-size: 13px; }
.cell-center { text-align: center; }
.cell-right { text-align: right; }
.cell-actions { display: flex; justify-content: flex-end; gap: 2px; }

/* Tablet: tighten table */
@media (min-width: 768px) and (max-width: 1023px) {
  .configured-row {
    grid-template-columns: 1.8fr 1fr 1.2fr 64px 140px;
    padding: var(--at-s-sm);
    font-size: 13px;
  }
  .trig-avatar { width: 32px; height: 32px; }
}

/* Mobile: convert table to vertical card list */
@media (max-width: 767px) {
  .configured-row--head { display: none; }
  .configured-row {
    grid-template-columns: 1fr;
    gap: var(--at-s-xs);
    padding: var(--at-s-md);
    grid-template-areas:
      "trig"
      "event"
      "binding"
      "footer";
  }
  .configured-row > div:nth-child(1) { grid-area: trig; }
  .configured-row > div:nth-child(2) { grid-area: event; }
  .configured-row > div:nth-child(3) { grid-area: binding; }
  .configured-row > div:nth-child(4) {
    /* Switch cell: move into footer row */
    grid-area: footer;
    justify-self: flex-start;
    text-align: left;
    display: flex;
    align-items: center;
    gap: var(--at-s-xs);
  }
  .configured-row > div:nth-child(4)::before {
    content: 'Bật';
    font-size: 12px;
    color: var(--at-muted);
    font-weight: 500;
  }
  .configured-row > div:nth-child(5) {
    /* Actions: same footer row, right-aligned */
    grid-area: footer;
    justify-self: flex-end;
    margin-left: auto;
  }
  .cell-trig { padding-bottom: 4px; border-bottom: 1px dashed var(--at-hairline); }
  .trig-avatar { width: 40px; height: 40px; }
  .binding-link { white-space: normal; }
}

/* Editor dialog */
.editor-card {
  background: var(--at-canvas);
  border-radius: var(--at-r-md);
  overflow: hidden;
}
.editor-card__head {
  display: flex;
  align-items: center;
  gap: var(--at-s-sm);
  padding: var(--at-s-md);
}
.editor-card__close {
  margin-left: auto;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--at-muted);
  padding: 6px;
  border-radius: var(--at-r-sm);
}
.editor-card__close:hover { background: var(--at-surface-soft); }
.editor-card__body {
  padding: var(--at-s-md);
  display: flex;
  flex-direction: column;
  gap: var(--at-s-sm);
}
.editor-card__foot {
  padding: var(--at-s-md);
  display: flex;
  justify-content: flex-end;
  gap: var(--at-s-xs);
}

.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--at-ink);
}
.form-hint { margin-top: 2px; color: var(--at-muted); }

.form-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
  margin-top: var(--at-s-xs);
}
.form-toggle input { width: 16px; height: 16px; }

.form-hint code {
  background: var(--at-surface-soft);
  padding: 1px 6px;
  border-radius: var(--at-r-xs);
  font-size: 12px;
  border: 1px solid var(--at-hairline);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.cron-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.cron-presets .filter-chip { padding: 4px 10px; font-size: 12px; }

.form-error {
  padding: 10px 12px;
  background: rgba(170, 45, 0, 0.08);
  border: 1px solid rgba(170, 45, 0, 0.3);
  border-radius: var(--at-r-sm);
  font-size: 13px;
  color: var(--at-coral);
}
</style>
