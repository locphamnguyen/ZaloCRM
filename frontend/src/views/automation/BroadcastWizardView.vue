<!--
  Broadcast Wizard 4-step — Route /marketing/broadcasts/tao-moi
  Đợt 1 2026-06-05.
  Step 1 Đối tượng (4 sub-tabs) → Step 2 Nội dung (chọn block) → Step 3 Lịch gửi → Step 4 Preview & Gửi
  HS Atlas re-skin 2026-06-06: .mkt-top + .mkt-body scaffold, stepper hàng chip,
  nick-picker dùng .av/.status .dot, icon mdi thay emoji. KHÔNG đổi logic.
  Token global (--brand/--ink/--line/--surface…) + classes .btn/.field/.card/.chip
  tái dùng từ hs-crm-theme.css.
-->
<template>
  <div class="bcw-page">
    <!-- ================== TOPBAR (HS .mkt-top scaffold) ================== -->
    <div class="mkt-top">
      <div>
        <div class="mtt">Tạo Broadcast mới</div>
        <div class="mts">Soạn tin gửi hàng loạt qua 4 bước · Bước {{ step }}/4</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" @click="goto('/marketing/broadcasts')">
          <v-icon size="16">mdi-close</v-icon> Huỷ
        </button>
      </div>
    </div>

    <!-- ================== BODY ================== -->
    <div class="mkt-body">
      <!-- Stepper — hàng chip HS -->
      <div class="stepper">
        <span
          v-for="(s, i) in steps"
          :key="i"
          class="chip step-chip"
          :class="step === i + 1 ? 'chip-blue' : step > i + 1 ? 'chip-green done' : 'chip-grey'"
        >
          <v-icon v-if="step > i + 1" size="13">mdi-check</v-icon>
          <span v-else class="step-n num">{{ i + 1 }}</span>
          {{ s }}
        </span>
      </div>

      <div class="wizard-body">
        <div class="card card-pad wizard-main">
          <!-- ── Step 1 Đối tượng ─────────────────────────────────────── -->
          <div v-if="step === 1">
            <h3>Chọn cách lấy danh sách khách hàng</h3>
            <p class="hint">Em chọn 1 trong 4 cách dưới, hệ thống sẽ lấy danh sách KH tương ứng để gửi.</p>

            <div class="sub-tabs">
              <button class="sub-tab" :class="{ active: audKind === 'customer-list' }" @click="setKind('customer-list')">
                <v-icon size="16">mdi-folder-account-outline</v-icon> Tệp KH
              </button>
              <button class="sub-tab" :class="{ active: audKind === 'tag' }" @click="setKind('tag')">
                <v-icon size="16">mdi-tag-outline</v-icon> Nhãn CRM
              </button>
              <button class="sub-tab" :class="{ active: audKind === 'preset-segment' }" @click="setKind('preset-segment')">
                <v-icon size="16">mdi-flash-outline</v-icon> Mẫu có sẵn
              </button>
              <button class="sub-tab" disabled title="Đợt 2">
                <v-icon size="16">mdi-tune-variant</v-icon> Bộ lọc
              </button>
            </div>

            <!-- customer-list -->
            <div v-if="audKind === 'customer-list'">
              <label class="form-label">Chọn tệp khách hàng</label>
              <div class="field sm">
                <v-icon size="16">mdi-folder-account-outline</v-icon>
                <select v-model="customerListId">
                  <option value="">— chọn tệp —</option>
                  <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }} ({{ l.hasZaloEntries }}/{{ l.totalEntries }} có Zalo)</option>
                </select>
              </div>
              <p class="hint">Chỉ hiển thị tệp đang processing/done. Sau khi gửi, KH chưa kết bạn sẽ skip.</p>
            </div>

            <!-- tag -->
            <div v-if="audKind === 'tag'">
              <label class="form-label">Chọn nhãn CRM</label>
              <div class="tag-grid">
                <span v-for="t in tags" :key="t.id" class="tag-pick" :class="{ selected: selectedTagIds.includes(t.id) }" @click="toggleTag(t.id)">
                  <v-icon size="14">mdi-tag-outline</v-icon> {{ t.name }} <small>({{ t.usageCount }})</small>
                </span>
              </div>
              <p v-if="tags.length === 0" class="hint">Chưa có nhãn CRM nào — vào /settings/crm/tags-v2 tạo.</p>
              <div class="match-toggle">
                <label><input type="radio" v-model="tagMatch" value="any"> Bất kỳ nhãn (OR)</label>
                <label><input type="radio" v-model="tagMatch" value="all"> Phải có TẤT CẢ (AND)</label>
              </div>
            </div>

            <!-- preset-segment -->
            <div v-if="audKind === 'preset-segment'">
              <label class="form-label">Chọn mẫu có sẵn</label>
              <div class="preset-grid">
                <div v-for="p in presets" :key="p.key" class="preset-card" :class="{ selected: selectedPreset === p.key }" @click="selectedPreset = p.key">
                  <div class="preset-head">
                    <v-icon size="16">mdi-flash-outline</v-icon> {{ p.label }}
                  </div>
                  <div class="preset-desc">{{ p.description }}</div>
                </div>
              </div>
            </div>

            <div class="preview-result" v-if="previewData">
              <strong class="num">{{ previewData.friendableRecipients }} KH</strong> sẽ nhận tin
              <small>(tổng {{ previewData.totalResolved }} resolved, skip {{ previewData.nonFriendableSkipped + previewData.skipReasons.total }}: {{ previewData.skipReasons.noZalo }} không Zalo, {{ previewData.skipReasons.blocked }} bị chặn)</small>
            </div>
            <button class="btn btn-ghost btn-sm" @click="runPreview" :disabled="previewing">
              <v-icon size="16" :class="{ spin: previewing }">{{ previewing ? 'mdi-loading' : 'mdi-magnify' }}</v-icon>
              {{ previewing ? 'Đang đếm…' : 'Đếm KH' }}
            </button>
          </div>

          <!-- ── Step 2 Nội dung (chọn Block) ─────────────────────────── -->
          <div v-if="step === 2">
            <h3>Chọn Khối nội dung tin nhắn</h3>
            <p class="hint">Broadcast dùng lại Khối <code>send_message</code> đã có. Chưa có Khối → vào /marketing/blocks tạo.</p>
            <label class="form-label">Khối nội dung</label>
            <div class="field sm">
              <v-icon size="16">mdi-cube-outline</v-icon>
              <select v-model="blockId">
                <option value="">— chọn khối —</option>
                <option v-for="b in blocks" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </div>
            <div v-if="selectedBlock" class="sample-card">
              <strong>Preview Variant 1:</strong>
              <pre>{{ (selectedBlock.content as any)?.textVariants?.[0] || '—' }}</pre>
              <small>3 biến hỗ trợ: <code>{gender}</code> <code>{name}</code> <code>{sale}</code></small>
            </div>
          </div>

          <!-- ── Step 3 Lịch gửi (Anh chốt thứ tự: Nick gửi → Phase 2 → Khi nào gửi) ── -->
          <div v-if="step === 3">
            <!-- Section Nick gửi tin -->
            <h3><v-icon size="18">mdi-cellphone</v-icon> Nick gửi tin</h3>
            <p class="hint">Chọn các nick được phép gửi cho broadcast này. Worker sẽ ưu tiên nick có tương tác gần nhất với KH.</p>
            <div class="nick-list">
              <div
                v-for="n in nicks"
                :key="n.id"
                class="nick-row"
                :class="{ selected: selectedNickIds.includes(n.id), disabled: n.status !== 'connected' }"
                @click="toggleNick(n)"
              >
                <span class="nick-check">
                  <v-icon v-if="selectedNickIds.includes(n.id)" size="14">mdi-check</v-icon>
                </span>
                <span class="av av-32" :class="'nv-' + nickAvatarVariant(n.id)">{{ nickInitials(n.displayName || '—') }}</span>
                <div class="nick-info">
                  <div class="nick-name">{{ n.displayName || n.id.slice(0, 8) }}</div>
                  <div class="nick-meta">
                    <span class="status">
                      <span class="dot" :style="{ background: n.status === 'connected' ? 'var(--success)' : 'var(--ink-4)' }"></span>
                      {{ n.status === 'connected' ? 'Online' : 'Offline' }}
                    </span>
                    <span class="sep">·</span>
                    <span>Tin <b class="num">{{ n.sentToday }}/{{ nickDayCap }}</b></span>
                    <span v-if="n.phone" class="sep">·</span>
                    <span v-if="n.phone" class="num">{{ n.phone }}</span>
                  </div>
                </div>
              </div>
              <div v-if="nicks.length === 0" class="empty-hint">
                <v-icon size="16">mdi-cellphone-off</v-icon>
                Chưa có nick nào kết nối. Vào <a href="#" @click.prevent="goto('/settings/channels/zalo')">cài đặt Zalo</a> kết nối trước.
              </div>
            </div>
            <p v-if="selectedNickIds.length === 0 && nicks.length > 0" class="error-msg" style="margin-top:8px;">
              <v-icon size="15">mdi-alert-outline</v-icon> Chọn ít nhất 1 nick để gửi.
            </p>

            <div class="divider" style="margin:24px 0;"></div>

            <!-- Section Phase 2 Stranger Send -->
            <h3><v-icon size="18">mdi-account-search-outline</v-icon> Phase 2 — Tìm SĐT chưa kết bạn</h3>
            <p class="hint">Với KH chưa kết bạn với nick nào, có muốn hệ thống tự lookup SĐT trên Zalo + gửi vào tab Người lạ?</p>
            <div class="radio-grid">
              <div class="radio-card" :class="{ selected: !allowStrangerSend }" @click="allowStrangerSend = false">
                <div class="radio-head"><v-icon size="16">mdi-circle-off-outline</v-icon> Tắt (mặc định)</div>
                <div class="radio-desc">Chỉ gửi cho KH đã là bạn. KH chưa bạn → skip.</div>
              </div>
              <div class="radio-card" :class="{ selected: allowStrangerSend }" @click="allowStrangerSend = true">
                <div class="radio-head"><v-icon size="16">mdi-check-circle-outline</v-icon> Bật</div>
                <div class="radio-desc">Tự lookup SĐT + gửi vào tab Người lạ. Cap 30/nick/ngày.</div>
              </div>
            </div>
            <p class="hint info-line" style="margin-top:8px;">
              <v-icon size="15">mdi-information-outline</v-icon>
              Cap mặc định: 30 lookup/nick/ngày · 100 KH stranger/broadcast · cooldown 20s/lookup.
            </p>

            <div class="divider" style="margin:24px 0;"></div>

            <!-- Section Khi nào gửi -->
            <h3><v-icon size="18">mdi-clock-outline</v-icon> Khi nào gửi?</h3>
            <div class="radio-grid">
              <div class="radio-card" :class="{ selected: scheduleKind === 'now' }" @click="scheduleKind = 'now'">
                <div class="radio-head"><v-icon size="16">mdi-flash-outline</v-icon> Gửi ngay</div>
                <div class="radio-desc">Bắt đầu worker ngay sau khi bấm "Gửi"</div>
              </div>
              <div class="radio-card" :class="{ selected: scheduleKind === 'scheduled' }" @click="scheduleKind = 'scheduled'">
                <div class="radio-head"><v-icon size="16">mdi-calendar-clock-outline</v-icon> Hẹn lịch 1 lần</div>
                <div class="radio-desc">Chọn ngày + giờ cụ thể</div>
              </div>
            </div>
            <div v-if="scheduleKind === 'scheduled'" style="margin-top:14px;">
              <label class="form-label">Giờ gửi</label>
              <div class="field sm">
                <v-icon size="16">mdi-calendar-clock-outline</v-icon>
                <input type="datetime-local" v-model="scheduledAt">
              </div>
            </div>

            <div class="divider" style="margin:20px 0;"></div>

            <label class="form-label">Giờ gửi cho phép (Asia/Ho_Chi_Minh)</label>
            <div class="hour-row">
              <div class="field sm hour-input"><input type="number" v-model.number="hourStart" min="0" max="23"></div>
              <v-icon size="16">mdi-arrow-right</v-icon>
              <div class="field sm hour-input"><input type="number" v-model.number="hourEnd" min="1" max="24"></div>
              <span class="hint" style="margin-left:8px;">Tin ngoài giờ tự hoãn sang sáng hôm sau.</span>
            </div>

            <label class="form-label" style="margin-top:14px;">Cap mỗi nick/ngày</label>
            <div class="hour-row">
              <div class="field sm hour-input"><input type="number" v-model.number="nickDayCap" min="50" max="500"></div>
              <span class="hint" style="margin-left:8px;">Mặc định 300. Nick hết cap → rotate nick khác.</span>
            </div>

            <label class="form-label" style="margin-top:14px;">Delay giữa các tin (giây)</label>
            <div class="hour-row">
              <div class="field sm hour-input"><input type="number" v-model.number="delayMinSec" min="1" max="60"></div>
              <v-icon size="16">mdi-arrow-right</v-icon>
              <div class="field sm hour-input"><input type="number" v-model.number="delayMaxSec" min="2" max="60"></div>
              <span class="hint" style="margin-left:8px;">Random trong khoảng. Càng chậm càng an toàn Zalo flag.</span>
            </div>
          </div>

          <!-- ── Step 4 Preview + Gửi ─────────────────────────────────── -->
          <div v-if="step === 4">
            <h3>Kiểm tra lần cuối</h3>
            <div class="summary-card">
              <label class="form-label">Đặt tên broadcast</label>
              <div class="field sm">
                <v-icon size="16">mdi-rename-outline</v-icon>
                <input v-model="bcName" placeholder="VD: Khuyến mãi cuối tháng 6">
              </div>
              <div class="divider" style="margin:14px 0;"></div>
              <div class="summary-row"><span>Đối tượng</span><strong>{{ audSummary }}</strong></div>
              <div class="summary-row"><span>Sẽ nhận tin</span><strong class="num">{{ previewData?.friendableRecipients || '?' }} KH</strong></div>
              <div class="summary-row"><span>Khối nội dung</span><strong>{{ selectedBlock?.name || '—' }}</strong></div>
              <div class="summary-row"><span>Lịch gửi</span><strong>{{ scheduleKind === 'now' ? 'Gửi ngay' : scheduledAt }}</strong></div>
              <div class="summary-row"><span>Window</span><strong class="num">{{ hourStart }}:00 → {{ hourEnd }}:00 VN</strong></div>
              <div class="summary-row"><span>Throttle</span><strong class="num">{{ delayMinSec }}-{{ delayMaxSec }}s/KH · cap {{ nickDayCap }}/nick</strong></div>
            </div>
            <p v-if="saveError" class="error-msg" style="margin-top:12px;">
              <v-icon size="15">mdi-alert-circle-outline</v-icon> {{ saveError }}
            </p>
          </div>
        </div>

        <div class="wizard-side">
          <div class="preview-pane">
            <div class="preview-label">Bước {{ step }}/4 · Đối tượng</div>
            <div class="preview-count num">{{ previewData?.friendableRecipients || '—' }} KH</div>
            <div class="preview-sub" v-if="previewData">
              Skip {{ previewData.nonFriendableSkipped + previewData.skipReasons.total }} KH
              ({{ previewData.skipReasons.noZalo }} không Zalo, {{ previewData.skipReasons.blocked }} bị chặn, {{ previewData.nonFriendableSkipped }} chưa kết bạn)
            </div>
          </div>
        </div>
      </div>

      <div class="wizard-footer">
        <button class="btn btn-ghost" :disabled="step === 1" @click="step--">
          <v-icon size="16">mdi-arrow-left</v-icon> Quay lại
        </button>
        <div class="step-info">{{ stepInfo }}</div>
        <button v-if="step < 4" class="btn btn-primary" @click="nextStep" :disabled="!canNext">
          Tiếp tục <v-icon size="16">mdi-arrow-right</v-icon>
        </button>
        <button v-if="step === 4" class="btn btn-primary" @click="onSubmit" :disabled="!canSubmit || saving">
          <v-icon size="16" :class="{ spin: saving }">{{ saving ? 'mdi-loading' : 'mdi-rocket-launch-outline' }}</v-icon>
          {{ saving ? 'Đang gửi…' : 'Lưu & ' + (scheduleKind === 'now' ? 'Gửi ngay' : 'Hẹn lịch') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  createBroadcast, startBroadcast, previewUnsaved,
  listPresetSegments, listCustomerListsForBroadcast, listTagsForBroadcast, listNicksForBroadcast,
  type SegmentSpec, type PresetSegmentMeta, type CustomerListSummary, type TagSummary, type PreviewUnsavedResult, type NickSummary,
} from '@/api/automation/broadcasts';
import { listBlocks } from '@/api/automation/blocks';
import type { Block } from '@/api/automation/types';
import { useToast } from '@/composables/use-toast';

const router = useRouter();
const toast = useToast();
const steps = ['Đối tượng', 'Nội dung', 'Lịch gửi', 'Xem trước & Gửi'];
const step = ref(1);

// Audience state
type AudKind = 'customer-list' | 'tag' | 'preset-segment';
const audKind = ref<AudKind>('customer-list');
const customerListId = ref('');
const selectedTagIds = ref<string[]>([]);
const tagMatch = ref<'any' | 'all'>('any');
const selectedPreset = ref('');

// Data lookups
const lists = ref<CustomerListSummary[]>([]);
const tags = ref<TagSummary[]>([]);
const presets = ref<PresetSegmentMeta[]>([]);
const blocks = ref<Block[]>([]);

// Preview
const previewData = ref<PreviewUnsavedResult | null>(null);
const previewing = ref(false);

// Content
const blockId = ref('');
const selectedBlock = computed(() => blocks.value.find((b) => b.id === blockId.value));

// Schedule
const scheduleKind = ref<'now' | 'scheduled'>('now');
const scheduledAt = ref('');
const hourStart = ref(6);
const hourEnd = ref(22);
const nickDayCap = ref(300);
const delayMinSec = ref(3);
const delayMaxSec = ref(10);

// Đợt 1 v2 2026-06-05 — Nick picker + Phase 2 stranger
const nicks = ref<NickSummary[]>([]);
const selectedNickIds = ref<string[]>([]);
const allowStrangerSend = ref(false);

// Save
const bcName = ref('');
const saving = ref(false);
const saveError = ref('');

function setKind(k: AudKind) { audKind.value = k; previewData.value = null; }
function toggleTag(id: string) {
  const i = selectedTagIds.value.indexOf(id);
  if (i >= 0) selectedTagIds.value.splice(i, 1);
  else selectedTagIds.value.push(id);
  previewData.value = null;
}

// Nick picker helpers — clone pattern MucTieuWizard
function toggleNick(n: NickSummary) {
  if (n.status !== 'connected') return; // không cho chọn nick offline
  const i = selectedNickIds.value.indexOf(n.id);
  if (i >= 0) selectedNickIds.value.splice(i, 1);
  else selectedNickIds.value.push(n.id);
}
function nickInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}
function nickAvatarVariant(id: string): string {
  // hash deterministic theo id để mỗi nick có 1 color cố định
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const variants = ['a1', 'a2', 'a3', 'a4', 'a5'];
  return variants[Math.abs(h) % variants.length];
}

function buildSegmentSpec(): SegmentSpec | null {
  if (audKind.value === 'customer-list') {
    if (!customerListId.value) return null;
    return { kind: 'customer-list', listId: customerListId.value };
  }
  if (audKind.value === 'tag') {
    if (selectedTagIds.value.length === 0) return null;
    return { kind: 'tag', tagIds: selectedTagIds.value, match: tagMatch.value };
  }
  if (audKind.value === 'preset-segment') {
    if (!selectedPreset.value) return null;
    return { kind: 'preset-segment', presetKey: selectedPreset.value };
  }
  return null;
}

const audSummary = computed(() => {
  if (audKind.value === 'customer-list') {
    const l = lists.value.find((x) => x.id === customerListId.value);
    return l ? l.name : '—';
  }
  if (audKind.value === 'tag') return `${selectedTagIds.value.length} nhãn (${tagMatch.value})`;
  if (audKind.value === 'preset-segment') {
    const p = presets.value.find((x) => x.key === selectedPreset.value);
    return p ? p.label : '—';
  }
  return '—';
});

const canNext = computed(() => {
  if (step.value === 1) return !!buildSegmentSpec();
  if (step.value === 2) return !!blockId.value;
  if (step.value === 3) {
    return selectedNickIds.value.length >= 1
      && (scheduleKind.value === 'now' || !!scheduledAt.value);
  }
  return true;
});

const canSubmit = computed(() => !!bcName.value.trim() && !!previewData.value && previewData.value.friendableRecipients > 0);

const stepInfo = computed(() => {
  if (step.value === 1 && previewData.value) return `${previewData.value.friendableRecipients} KH sẽ nhận tin`;
  if (step.value === 2 && selectedBlock.value) return `Khối: ${selectedBlock.value.name}`;
  if (step.value === 3) return `${scheduleKind.value === 'now' ? 'Gửi ngay' : 'Hẹn ' + scheduledAt.value} · ${delayMinSec.value}-${delayMaxSec.value}s/KH`;
  return '';
});

async function runPreview() {
  const spec = buildSegmentSpec();
  if (!spec) return;
  previewing.value = true;
  try {
    previewData.value = await previewUnsaved({ segmentSpec: spec, sampleSize: 5 });
  } catch (e: any) {
    toast.error(e?.response?.data?.error || 'Có lỗi xảy ra, thử lại sau.', 5000);
  } finally {
    previewing.value = false;
  }
}

async function nextStep() {
  if (step.value === 1 && !previewData.value) {
    await runPreview();
  }
  step.value++;
}

function goto(p: string) { router.push(p); }

async function onSubmit() {
  saveError.value = '';
  saving.value = true;
  try {
    const segmentSpec = buildSegmentSpec();
    if (!segmentSpec) throw new Error('Đối tượng chưa hợp lệ');
    if (selectedNickIds.value.length === 0) throw new Error('Chọn ≥ 1 nick để gửi');
    const pacing = {
      randomDelayBetweenSends: { min: delayMinSec.value * 1000, max: delayMaxSec.value * 1000 },
      hourStart: hourStart.value,
      hourEnd: hourEnd.value,
      nickDayCap: nickDayCap.value,
      excludeBlocked: true,
      // Đợt 1 v2 2026-06-05 — 2-phase pipeline
      selectedNickIds: selectedNickIds.value,
      allowStrangerSend: allowStrangerSend.value,
    };
    const bc = await createBroadcast({
      name: bcName.value.trim(),
      blockId: blockId.value,
      segmentSpec,
      scheduleKind: scheduleKind.value,
      scheduledAt: scheduleKind.value === 'scheduled' ? new Date(scheduledAt.value).toISOString() : undefined,
      pacing,
    });
    // If "now" → also start immediately
    if (scheduleKind.value === 'now') {
      await startBroadcast(bc.id);
    }
    router.push(`/marketing/broadcasts/${bc.id}`);
  } catch (e: any) {
    saveError.value = e?.response?.data?.error || e?.message || 'Lỗi tạo broadcast';
  } finally {
    saving.value = false;
  }
}

watch([audKind, customerListId, selectedTagIds, selectedPreset, tagMatch], () => { previewData.value = null; }, { deep: true });

onMounted(async () => {
  const [l, t, p, b, n] = await Promise.all([
    listCustomerListsForBroadcast(),
    listTagsForBroadcast(),
    listPresetSegments(),
    listBlocks({ limit: 200 }),
    listNicksForBroadcast(),
  ]);
  lists.value = l;
  tags.value = t;
  presets.value = p;
  blocks.value = b.filter((bk) => bk.actionType === 'send_message' && !bk.archivedAt);
  nicks.value = n;
  // Đợt 1 v2 — auto-tick TẤT CẢ nick connected (recommended)
  selectedNickIds.value = n.filter((x) => x.status === 'connected').map((x) => x.id);
});
</script>

<style scoped>
.bcw-page {
  width: 100%;
  font-size: 13px;
  color: var(--ink);
}
.mkt-top .actions { display: flex; gap: 8px; flex-shrink: 0; }

/* ----- Stepper (hàng chip HS) ----- */
.stepper {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.step-chip {
  height: 28px;
  padding: 0 12px;
  font-size: 12.5px;
  gap: 7px;
}
.step-chip .step-n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .55);
  font-size: 11px;
  font-weight: 700;
}
.step-chip.chip-blue .step-n { background: var(--surface); color: var(--brand-700); }
.step-chip.done { background: var(--success-soft); }

/* ----- Layout ----- */
.wizard-body { display: grid; grid-template-columns: 1fr 320px; gap: 20px; margin-bottom: 18px; }
.wizard-main h3 { margin: 0 0 4px 0; font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 7px; }
.wizard-main h3 + .hint { margin-top: 2px; }
.hint { margin: 0 0 16px 0; font-size: 12px; color: var(--ink-3); }
.hint.info-line { display: flex; align-items: center; gap: 6px; }
.error-msg {
  display: flex; align-items: center; gap: 6px;
  color: var(--error); font-size: 13px; font-weight: 600;
  padding: 8px 12px; background: var(--error-soft); border-radius: var(--r-xs);
}

/* ----- Sub tabs ----- */
.sub-tabs { display: flex; gap: 3px; background: var(--surface-3); padding: 4px; border-radius: var(--r-sm); margin-bottom: 16px; }
.sub-tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 34px; padding: 0 12px; border: none; background: transparent;
  border-radius: var(--r-xs); font-size: 12.5px; font-weight: 600; color: var(--ink-3);
  transition: background .14s, color .14s;
}
.sub-tab.active { background: var(--surface); color: var(--brand); box-shadow: var(--sh-xs); }
.sub-tab:disabled { opacity: .5; cursor: not-allowed; }

/* ----- Form ----- */
.form-label { display: block; font-size: 11px; font-weight: 700; color: var(--ink-4); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .04em; }
.field select, .field input { width: 100%; }
.hour-input { width: 92px; flex: none; }
.hour-input input { text-align: left; }
.hour-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ----- Tag pick ----- */
.tag-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; background: var(--surface-3); border-radius: var(--r-sm); min-height: 80px; }
.tag-pick {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px; background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-pill); font-size: 12px; font-weight: 600; color: var(--ink-2); cursor: pointer;
  transition: background .12s, border-color .12s, color .12s;
}
.tag-pick small { color: var(--ink-4); font-weight: 500; }
.tag-pick:hover { border-color: var(--brand); }
.tag-pick.selected { background: var(--brand); color: #fff; border-color: var(--brand); }
.tag-pick.selected small { color: rgba(255, 255, 255, .8); }
.match-toggle { margin-top: 12px; display: flex; gap: 16px; font-size: 13px; color: var(--ink-2); }
.match-toggle label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

/* ----- Preset cards ----- */
.preset-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.preset-card { padding: 12px 14px; border: 1.6px solid var(--line); border-radius: var(--r-sm); background: var(--surface); cursor: pointer; transition: border-color .12s, background .12s; }
.preset-card:hover { border-color: var(--brand); }
.preset-card.selected { border-color: var(--brand); background: var(--brand-soft); }
.preset-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
.preset-desc { font-size: 11.5px; color: var(--ink-3); line-height: 1.45; }

/* ----- Radio cards ----- */
.radio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.radio-card { padding: 13px 15px; border: 1.6px solid var(--line); border-radius: var(--r-sm); background: var(--surface); cursor: pointer; transition: border-color .12s, background .12s; }
.radio-card:hover { border-color: var(--brand); }
.radio-card.selected { border-color: var(--brand); background: var(--brand-soft); }
.radio-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
.radio-desc { font-size: 11.5px; color: var(--ink-3); line-height: 1.45; }

/* ----- Nick picker (HS — .av + .status .dot) ----- */
.nick-list { display: flex; flex-direction: column; gap: 8px; }
.nick-row {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 13px; border: 1.6px solid var(--line); border-radius: var(--r-sm);
  background: var(--surface); cursor: pointer; transition: border-color .12s, background .12s;
}
.nick-row:hover { border-color: var(--brand); }
.nick-row.selected { border-color: var(--brand); background: var(--brand-soft); }
.nick-row.disabled { opacity: .55; cursor: not-allowed; }
.nick-row.disabled:hover { border-color: var(--line); }
.nick-check {
  flex: none; width: 20px; height: 20px; border-radius: var(--r-xs);
  border: 1.6px solid var(--line-2); background: var(--surface);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.nick-row.selected .nick-check { background: var(--brand); border-color: var(--brand); }
.av.nv-a1 { background: linear-gradient(135deg, #4fb0e0, #1786be); }
.av.nv-a2 { background: linear-gradient(135deg, #f7a072, #f4511e); }
.av.nv-a3 { background: linear-gradient(135deg, #6fcf97, #16a34a); }
.av.nv-a4 { background: linear-gradient(135deg, #b794f6, #8b5cf6); }
.av.nv-a5 { background: linear-gradient(135deg, #f6a5c0, #ec4899); }
.nick-info { flex: 1; min-width: 0; }
.nick-name { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.nick-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 2px; font-size: 11.5px; color: var(--ink-3); }
.nick-meta .status { font-size: 11.5px; font-weight: 600; color: var(--ink-2); }
.nick-meta b { color: var(--ink); font-weight: 600; }
.nick-meta .sep { color: var(--ink-4); }
.empty-hint {
  display: flex; align-items: center; gap: 7px;
  padding: 14px; font-size: 12.5px; color: var(--ink-3);
  border: 1px dashed var(--line-2); border-radius: var(--r-sm); background: var(--surface-2);
}
.empty-hint a { color: var(--brand); font-weight: 600; }

/* ----- Result banners ----- */
.preview-result {
  background: var(--brand-soft); border: 1px solid var(--brand-soft);
  border-radius: var(--r-sm); padding: 10px 14px; margin: 14px 0 12px; font-size: 13px; color: var(--brand-700);
}
.preview-result .num { color: var(--brand-700); font-size: 15px; }
.preview-result small { color: var(--ink-3); font-weight: 500; }

.sample-card { background: var(--surface-3); border-radius: var(--r-sm); padding: 12px 14px; margin-top: 14px; font-size: 12px; color: var(--ink-2); }
.sample-card pre { margin: 6px 0; white-space: pre-wrap; font-family: inherit; font-size: 12px; color: var(--ink); }
.sample-card code { font-family: var(--mono); font-size: 11.5px; background: var(--surface); padding: 1px 5px; border-radius: 4px; }

.summary-card { background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 16px; }
.summary-row { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; font-size: 13px; border-bottom: 1px solid var(--line-2); }
.summary-row:last-child { border-bottom: none; }
.summary-row span { color: var(--ink-3); }
.summary-row strong { color: var(--ink); font-weight: 600; }

/* ----- Side preview pane ----- */
.wizard-side { display: flex; flex-direction: column; gap: 14px; }
.preview-pane { background: var(--brand-soft); border: 1px solid var(--brand-soft); border-radius: var(--r-md); padding: 14px 16px; position: sticky; top: 86px; }
.preview-label { font-size: 11px; color: var(--ink-3); margin-bottom: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.preview-count { font-size: 28px; font-weight: 700; color: var(--brand-700); margin-bottom: 6px; line-height: 1; }
.preview-sub { font-size: 11.5px; color: var(--ink-2); line-height: 1.5; }

/* ----- Footer ----- */
.wizard-footer {
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  padding: 16px 0; border-top: 1px solid var(--line);
  position: sticky; bottom: 0; background: var(--surface-2);
}
.step-info { font-size: 12px; color: var(--ink-3); flex: 1; text-align: center; }

code { font-family: var(--mono); font-size: 11.5px; background: var(--surface-3); padding: 1px 5px; border-radius: 4px; color: var(--ink-2); }
</style>
