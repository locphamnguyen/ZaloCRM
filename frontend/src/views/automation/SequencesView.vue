<template>
  <div class="seq-page">
    <!-- ================== TOPBAR (HS .mkt-top scaffold) ================== -->
    <div class="mkt-top">
      <div>
        <div class="mtt">Luồng kịch bản</div>
        <div class="mts">Chuỗi các Khối nội dung gửi theo thời gian + luật chạy an toàn</div>
      </div>
      <button class="btn btn-primary btn-sm" @click="openCreateDrawer">
        <v-icon size="16">mdi-plus-circle-outline</v-icon> Tạo luồng
      </button>
    </div>

    <div class="mkt-body">
      <!-- ================== SEARCH ================== -->
      <div class="seq-toolbar">
        <div class="search-wrap">
          <v-icon class="search-icon" size="16">mdi-magnify</v-icon>
          <input
            v-model="search"
            class="search-input"
            type="text"
            placeholder="Tìm luồng kịch bản..."
          />
        </div>
      </div>

      <!-- ================== EMPTY STATE ================== -->
      <div v-if="filteredSequences.length === 0" class="seq-empty">
        <v-icon size="40" class="seq-empty__icon">mdi-format-list-numbered</v-icon>
        <div class="seq-empty__title">
          {{ search ? 'Không có luồng nào khớp tìm kiếm' : 'Chưa có luồng kịch bản' }}
        </div>
        <div class="seq-empty__desc">
          {{ search
            ? 'Thử xoá tìm kiếm.'
            : 'Luồng kịch bản ghép nhiều Khối thành chuỗi có delay. Mỗi KH được "enroll" sẽ trải qua từng bước theo thời gian.' }}
        </div>
        <button v-if="!search" class="btn btn-primary btn-sm" @click="openCreateDrawer">
          <v-icon size="16">mdi-plus-circle-outline</v-icon> Tạo luồng đầu tiên
        </button>
      </div>

      <!-- ================== SEQUENCE GRID (read-only Atlas cards) ============ -->
      <div v-else class="seqs">
        <article
          v-for="seq in filteredSequences"
          :key="seq.id"
          class="seq"
          :class="{ active: drawerOpen && editing?.id === seq.id }"
          @click="openEditDrawer(seq)"
        >
          <!-- header: name + desc + toggle -->
          <div class="sh">
            <div class="sh-info">
              <div class="sn">{{ seq.name }}</div>
              <div v-if="seq.description" class="sd">{{ seq.description }}</div>
              <div v-else class="sd sd-empty">Không có mô tả</div>
            </div>
            <button
              class="toggle"
              :class="{ on: seq.enabled }"
              :title="seq.enabled ? 'Đang chạy — bấm để tắt' : 'Đang tắt — bấm để bật'"
              @click.stop="toggleEnabledOnCard(seq)"
            ></button>
          </div>

          <!-- flow: step chain -->
          <div v-if="seq.steps.length" class="flow">
            <template v-for="(step, idx) in seq.steps" :key="step.stepId">
              <div class="arr" v-if="idx > 0"><v-icon size="15">mdi-chevron-right</v-icon></div>
              <div class="step">
                <div class="si">
                  <v-icon size="14">{{ stepActionIcon(seq, step.blockId) }}</v-icon>
                  {{ stepActionLabel(seq, step.blockId) }}
                </div>
                <div class="sl">{{ stepBlockName(seq, step.blockId) }}</div>
                <div class="sdelay">{{ stepDelayLabel(step.delayMinutes, idx) }}</div>
              </div>
            </template>
          </div>
          <div v-else class="flow-empty">Chưa có bước nào</div>

          <!-- runtime rule chips -->
          <div class="srules">
            <span
              v-for="(rule, i) in ruleLabels(seq.runtimeRules)"
              :key="i"
              class="chip chip-grey"
            >
              <v-icon size="12">mdi-shield-check</v-icon> {{ rule }}
            </span>
          </div>

          <!-- stats footer -->
          <div class="sstats">
            <div class="sstat">
              <div class="v">{{ formatNum(seqEnrolled(seq)) }}</div>
              <div class="l">Đã enroll</div>
            </div>
            <div class="sstat">
              <div class="v" style="color: var(--success)">{{ formatNum(seqCompleted(seq)) }}</div>
              <div class="l">Hoàn thành</div>
            </div>
            <div class="sstat">
              <div class="v" style="color: var(--error)">{{ formatNum(seqFailed(seq)) }}</div>
              <div class="l">Lỗi</div>
            </div>
            <div class="sstat">
              <div class="v">{{ formatNum(inProgressCount(seq)) }}</div>
              <div class="l">Đang chạy</div>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- ================== EDITOR DRAWER (slide-from-right) ================== -->
    <div class="panel-overlay" :class="{ show: drawerOpen }" @click="closeDrawer"></div>
    <aside class="side-panel" :class="{ open: drawerOpen }">
      <template v-if="editing">
        <!-- header -->
        <div class="panel-header">
          <div class="panel-header-row">
            <div class="panel-header-main">
              <div class="field panel-name-field">
                <v-icon size="16" class="panel-name-icon">mdi-format-list-numbered</v-icon>
                <input
                  v-model="editing.name"
                  type="text"
                  placeholder="Tên luồng kịch bản..."
                />
              </div>
            </div>
            <button class="panel-icon-btn" title="Đóng" @click="closeDrawer">
              <v-icon size="18">mdi-close</v-icon>
            </button>
          </div>

          <!-- action row: switch + save + stats + kebab -->
          <div class="panel-actions">
            <button
              v-if="editing.id"
              class="toggle-row"
              :title="editing.enabled ? 'Đang chạy — bấm để tắt' : 'Đang tắt — bấm để bật'"
              @click="toggleEnabled"
            >
              <span class="toggle" :class="{ on: editing.enabled }"></span>
              <span class="toggle-label" :class="{ on: editing.enabled }">
                {{ editing.enabled ? 'Đang chạy' : 'Đang tắt' }}
              </span>
            </button>
            <div class="panel-actions-spacer"></div>
            <button
              v-if="editing.id"
              class="btn btn-ghost btn-sm"
              @click="openStats"
            >
              <v-icon size="15">mdi-chart-bar</v-icon> Thống kê
            </button>
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveSequence">
              <v-icon size="15">{{ saving ? 'mdi-loading' : 'mdi-content-save' }}</v-icon>
              {{ saving ? 'Đang lưu...' : 'Lưu' }}
            </button>
            <div v-if="editing.id" class="menu-wrap">
              <button class="panel-icon-btn" title="Tác vụ khác" @click.stop="menuOpen = !menuOpen">
                <v-icon size="18">mdi-dots-horizontal</v-icon>
              </button>
              <div class="menu" :class="{ show: menuOpen }">
                <div class="menu-item" @click="onDuplicate">
                  <v-icon size="16">mdi-content-copy</v-icon> Nhân bản luồng
                </div>
                <div class="menu-divider"></div>
                <div class="menu-item danger" @click="onDelete">
                  <v-icon size="16">mdi-delete-outline</v-icon> Xoá luồng
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- body -->
        <div class="panel-body">
          <!-- description -->
          <div class="panel-section">
            <div class="panel-section-title">Mô tả</div>
            <textarea
              v-model="editing.description"
              class="panel-textarea"
              rows="2"
              placeholder="Mô tả ngắn (tuỳ chọn)"
            ></textarea>
          </div>

          <!-- 3 rule cards: Khi nào / Bảo vệ KH / Dừng bám đuổi -->
          <div class="panel-section">
            <div class="panel-section-title">Luật chạy an toàn</div>

            <!-- Card 1: Khi nào chạy -->
            <div class="rule-card">
              <div class="rule-card__header">
                <v-icon size="18" color="primary">mdi-clock-outline</v-icon>
                <strong>Khi nào chạy</strong>
              </div>
              <div class="rule-card__body">
                <div class="rule-row">
                  <div class="rule-row__head">
                    <label>Giờ làm việc</label>
                    <span class="rule-pill">{{ timeStart }} – {{ timeEnd }}</span>
                  </div>
                  <div class="rule-input-pair">
                    <input class="rule-time" :value="timeStart" type="time" @input="setTimeStart(($event.target as HTMLInputElement).value)" />
                    <v-icon size="15" class="rule-arrow">mdi-arrow-right</v-icon>
                    <input class="rule-time" :value="timeEnd" type="time" @input="setTimeEnd(($event.target as HTMLInputElement).value)" />
                  </div>
                  <p class="rule-hint">
                    Chỉ gửi từ {{ timeStart }} đến {{ timeEnd }} (giờ Việt Nam). Ngoài khung này sẽ hoãn sang khung kế tiếp.
                  </p>
                </div>
                <div class="rule-row">
                  <div class="rule-row__head">
                    <label>Giãn cách giữa các lần gửi</label>
                  </div>
                  <div class="rule-input-pair rule-input-pair--gap">
                    <span class="rule-mini-label">Từ</span>
                    <TimeAmountInput
                      :model-value="delayMin"
                      base-unit="minute"
                      :units="['second','minute','hour','day']"
                      @update:model-value="(v: number) => setDelayMin(v)"
                    />
                    <span class="rule-mini-label">đến</span>
                    <TimeAmountInput
                      :model-value="delayMax"
                      base-unit="minute"
                      :units="['second','minute','hour','day']"
                      @update:model-value="(v: number) => setDelayMax(v)"
                    />
                  </div>
                  <p class="rule-hint">
                    Mỗi nick chờ ngẫu nhiên {{ delayMin === delayMax ? delayMin : `${delayMin}–${delayMax}` }} phút trước khi gửi tin tiếp theo. Giả lập tự nhiên, tránh Zalo phát hiện bot.
                  </p>
                </div>
              </div>
            </div>

            <!-- Card 2: Bảo vệ KH không spam -->
            <div class="rule-card">
              <div class="rule-card__header">
                <v-icon size="18" color="warning">mdi-shield-account-outline</v-icon>
                <strong>Bảo vệ KH không spam</strong>
              </div>
              <div class="rule-card__body">
                <div class="rule-row">
                  <label>Tránh gửi trùng KH</label>
                  <div class="rule-input-pair">
                    <input class="rule-num" :value="recencyDays" type="number" min="0" @input="setRecencyDays(($event.target as HTMLInputElement).value)" />
                    <span class="suffix">ngày</span>
                  </div>
                  <p class="rule-hint" v-if="recencyDays > 0">
                    Nếu KH đã chạm với nick CRM khác trong <strong>{{ recencyDays }} ngày</strong> qua → bỏ qua, không bám đuổi (tránh nhiều sale spam 1 KH).
                  </p>
                  <p class="rule-hint" v-else>
                    <strong>Đã tắt</strong> — gửi cho mọi KH, kể cả nick khác vừa chăm hôm qua. Phù hợp test, KHÔNG khuyến nghị production.
                  </p>
                </div>
                <div class="rule-row rule-row--switch">
                  <button
                    class="toggle"
                    :class="{ on: editing.runtimeRules.perNickThrottle ?? true }"
                    @click="editing.runtimeRules.perNickThrottle = !(editing.runtimeRules.perNickThrottle ?? true)"
                  ></button>
                  <div>
                    <label>Giãn đều số tin giữa các nick</label>
                    <p class="rule-hint">
                      Nick nào gửi gần đây phải chờ; nick chưa gửi sẽ ưu tiên. Phân bổ tải đều, tránh 1 nick gửi dồn quá nhiều.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Card 3: Khi nào dừng bám đuổi -->
            <div class="rule-card">
              <div class="rule-card__header">
                <v-icon size="18" color="error">mdi-stop-circle-outline</v-icon>
                <strong>Khi nào dừng bám đuổi</strong>
              </div>
              <div class="rule-card__body">
                <!-- 3.1 Dừng khi 1 nick đã kết bạn -->
                <div class="rule-row rule-row--switch">
                  <button
                    class="toggle"
                    :class="{ on: editing.runtimeRules.stopOnAccept ?? true }"
                    @click="editing.runtimeRules.stopOnAccept = !(editing.runtimeRules.stopOnAccept ?? true)"
                  ></button>
                  <div>
                    <label>Dừng nick khác khi 1 nick đã kết bạn</label>
                    <p class="rule-hint">
                      Nếu 1 nick được KH đồng ý kết bạn → các nick còn lại tự dừng gửi tin nhắn (tránh nhiều nick cùng chăm 1 KH).
                    </p>
                  </div>
                </div>

                <div class="rule-divider"></div>

                <!-- 3.2 Tạm dừng khi KH tương tác (pause hours) -->
                <div class="rule-row">
                  <div class="rule-row__head">
                    <label>Tạm dừng khi KH trả lời / thả cảm xúc</label>
                    <span class="rule-pill">KH reply tiếp → reset</span>
                  </div>
                  <div class="rule-input-pair rule-input-pair--gap">
                    <TimeAmountInput
                      :model-value="pauseHoursOnReply"
                      base-unit="hour"
                      :units="['hour','day']"
                      @update:model-value="(v: number) => setPauseHoursOnReply(v)"
                    />
                    <span class="rule-mini-label">(0 = không tạm dừng)</span>
                  </div>
                  <p class="rule-hint">
                    KH nhắn lại hoặc thả cảm xúc giữa chuỗi → hoãn các bước còn lại
                    <strong v-if="pauseHoursOnReply > 0">{{ pauseHoursOnReply }} giờ</strong>
                    <strong v-else>(đang tắt)</strong>, đồng thời báo gấp cho sale vào trả lời.
                  </p>
                </div>

                <div class="rule-divider"></div>

                <!-- 3.3 Dừng sau số lần gửi tối đa -->
                <div class="rule-row">
                  <div class="rule-row__head">
                    <label>Dừng sau số tin tối đa mỗi KH</label>
                  </div>
                  <div class="rule-input-pair rule-input-pair--gap">
                    <input class="rule-num" :value="maxAttempts" type="number" min="0" @input="setMaxAttempts(($event.target as HTMLInputElement).value)" />
                    <span class="suffix">tin</span>
                    <span class="rule-mini-label">(0 = không giới hạn)</span>
                  </div>
                  <p class="rule-hint">
                    <template v-if="maxAttempts > 0">Mỗi KH chỉ nhận tối đa <strong>{{ maxAttempts }} tin</strong> của luồng này rồi dừng — chống bám đuổi quá đà.</template>
                    <template v-else>KH sẽ nhận đủ tất cả các bước trong luồng (không giới hạn số tin).</template>
                  </p>
                </div>

                <div class="rule-divider"></div>

                <!-- 3.4 Phản ứng nâng cao (cố định — như Mục tiêu) -->
                <div class="rule-row">
                  <div class="rule-row__head">
                    <label>Phản ứng nâng cao</label>
                    <span class="rule-pill rule-pill--muted">cố định</span>
                  </div>
                  <div class="rule-fixed-list">
                    <div class="rule-fixed-item">
                      <v-icon size="15" color="success">mdi-heart-outline</v-icon>
                      <span class="rfi-key">Cảm xúc tích cực (tim, like)</span>
                      <span class="rfi-val">Không dừng chuỗi · +5 điểm CRM</span>
                    </div>
                    <div class="rule-fixed-item">
                      <v-icon size="15" color="error">mdi-emoticon-sad-outline</v-icon>
                      <span class="rfi-key">Cảm xúc tiêu cực (giận, tim vỡ)</span>
                      <span class="rfi-val">Tạm dừng 48h · −5 điểm · báo sale</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- vertical step diagram -->
          <div class="panel-section">
            <div class="panel-section-title">Các bước trong luồng</div>
            <SequenceStepEditor
              :steps="editing.steps"
              :available-blocks="availableBlocks"
              @update:steps="editing.steps = $event"
            />
          </div>

          <div v-if="error" class="panel-error-banner">
            <v-icon size="16" color="error">mdi-alert-circle-outline</v-icon>
            <span>{{ error }}</span>
            <button class="panel-error-close" @click="error = ''"><v-icon size="14">mdi-close</v-icon></button>
          </div>
        </div>
      </template>
    </aside>

    <v-snackbar v-model="toastOpen" :color="toastColor" timeout="3000" location="bottom right">
      {{ toastMsg }}
    </v-snackbar>

    <!-- Destructive edit dialog (server rejected mutable-sequence edit) -->
    <v-dialog v-model="destructiveDialogOpen" max-width="520" persistent>
      <v-card>
        <v-card-title class="d-flex align-center destructive-dialog__header">
          <v-icon color="error" class="mr-2">mdi-alert-octagon</v-icon>
          <span>Không thể sửa bước giữa chuỗi</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="destructive-dialog__body">
          <p class="mb-2">{{ destructiveHint }}</p>
          <p class="text-caption text-medium-emphasis mb-0">
            Mẹo: nếu cần restructure, hãy tạo Sequence mới và bật song song — KH hiện tại sẽ chạy hết flow cũ rồi mới được enroll vào flow mới.
          </p>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="destructiveDialogOpen = false">Đã hiểu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { sequencesApi, blocksApi } from '@/api/automation';
import {
  ACTION_TYPE_LABELS,
  ACTION_TYPE_ICONS,
  type AutomationSequence,
  type SequenceStep,
  type SequenceRuntimeRules,
  type Block,
  type BlockActionType,
} from '@/api/automation/types';
import SequenceStepEditor from '@/components/automation/phase7/SequenceStepEditor.vue';
import TimeAmountInput from '@/components/automation/TimeAmountInput.vue';

const router = useRouter();
const sequences = ref<AutomationSequence[]>([]);
const availableBlocks = ref<Block[]>([]);
const search = ref('');
const error = ref('');
const saving = ref(false);

// Drawer state
const drawerOpen = ref(false);
const menuOpen = ref(false);

const toastOpen = ref(false);
const toastMsg = ref('');
const toastColor = ref<'success' | 'error' | 'info'>('info');
function showToast(msg: string, color: 'success' | 'error' | 'info' = 'info') {
  toastMsg.value = msg; toastColor.value = color; toastOpen.value = true;
}

// Destructive edit dialog (server rejects xoá/đổi step giữa chuỗi)
const destructiveDialogOpen = ref(false);
const destructiveHint = ref('');

/**
 * Extract user-facing error message from axios error.
 * BE Wave 3 uses { error, code, hint } envelope; older endpoints used { detail }.
 * Prefer `hint` (tiếng Việt, sale-friendly) > detail > error > axios message.
 */
function extractErrorMsg(err: any): string {
  return (
    err?.response?.data?.hint ||
    err?.response?.data?.detail ||
    err?.response?.data?.error ||
    err?.message ||
    'Lỗi không xác định'
  );
}

/**
 * If server returned `error: "sequence_edit_destructive"`, surface a Vuetify
 * dialog with the Vietnamese hint instead of a tiny inline alert.
 * Returns true if dialog was shown (caller should skip inline error).
 */
function maybeShowDestructiveDialog(err: any): boolean {
  const code = err?.response?.data?.error;
  if (code === 'sequence_edit_destructive') {
    destructiveHint.value =
      err?.response?.data?.hint ||
      err?.response?.data?.detail ||
      'Không thể xoá hoặc đổi bước ở giữa chuỗi vì đang có KH chạy dở.';
    destructiveDialogOpen.value = true;
    return true;
  }
  return false;
}

interface DraftSequence {
  id: string | null;
  name: string;
  description: string;
  channel: string;
  enabled: boolean;
  steps: SequenceStep[];
  runtimeRules: SequenceRuntimeRules;
}
const editing = ref<DraftSequence | null>(null);

const filteredSequences = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return sequences.value;
  return sequences.value.filter((s) => s.name.toLowerCase().includes(q));
});

// ============ Read-only card helpers ============
// Resolve block name / action label / icon from the seq.blocks[] denormalised list
// (BE ships it on AutomationSequence so cards render without a separate block fetch).
function seqBlock(seq: AutomationSequence, blockId: string) {
  return seq.blocks?.find((b) => b.id === blockId) ?? null;
}
function stepBlockName(seq: AutomationSequence, blockId: string): string {
  const b = seqBlock(seq, blockId);
  if (!b) return availableBlocks.value.find((x) => x.id === blockId)?.name ?? 'Khối đã xoá';
  return b.name;
}
function stepActionType(seq: AutomationSequence, blockId: string): BlockActionType {
  const b = seqBlock(seq, blockId);
  if (b) return b.actionType;
  return availableBlocks.value.find((x) => x.id === blockId)?.actionType ?? 'send_message';
}
function stepActionLabel(seq: AutomationSequence, blockId: string): string {
  return ACTION_TYPE_LABELS[stepActionType(seq, blockId)];
}
function stepActionIcon(seq: AutomationSequence, blockId: string): string {
  return ACTION_TYPE_ICONS[stepActionType(seq, blockId)] ?? 'mdi-help-circle-outline';
}
function stepDelayLabel(delayMinutes: number, idx: number): string {
  if (idx === 0 || !delayMinutes) return 'Ngay';
  if (delayMinutes % (60 * 24) === 0) return `+${delayMinutes / (60 * 24)} ngày`;
  if (delayMinutes % 60 === 0) return `+${delayMinutes / 60} giờ`;
  return `+${delayMinutes} phút`;
}
function formatNum(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString('vi-VN');
}

// ── Roll-up counters cho thẻ luồng (Anh chốt 2026-06-06) ──
// Ưu tiên số CACHED (đồng bộ từ các Mục tiêu/trigger dùng luồng); nếu luồng chưa
// từng sync (cached null/0) thì fallback về counter live của sequence. Nhờ vậy
// luồng đã sync hiện đúng roll-up, luồng chưa sync vẫn hiện số live nếu có.
function seqEnrolled(seq: AutomationSequence): number {
  return seq.enrolledCountCached || seq.enrolledCount || 0;
}
function seqCompleted(seq: AutomationSequence): number {
  // "Hoàn thành" = KH đi hết bước cuối luồng (completedCountCached do cron tính).
  return seq.completedCountCached || seq.completedCount || 0;
}
function seqFailed(seq: AutomationSequence): number {
  // Chưa có failedCached riêng — dùng live failedCount.
  return seq.failedCount || 0;
}
function inProgressCount(seq: AutomationSequence): number {
  return Math.max(0, seqEnrolled(seq) - seqCompleted(seq) - seqFailed(seq));
}

// Build the short runtime-rule chip labels shown on each card.
function ruleLabels(rules: SequenceRuntimeRules | null | undefined): string[] {
  const r = rules ?? {};
  const out: string[] = [];
  const hr = r.allowedHourRange;
  if (hr && (hr[0] !== 0 || hr[1] !== 23)) out.push(`Giờ chạy ${hr[0]}h–${hr[1]}h`);
  const d = r.randomDelayPerSend;
  if (d) out.push(d.min === d.max ? `Giãn ${d.min}p` : `Giãn ${d.min}–${d.max}p`);
  if ((r.perNickThrottle ?? true)) out.push('Giãn đều giữa nick');
  if (r.crossNickRecencyDays && r.crossNickRecencyDays > 0) out.push(`Tránh trùng ${r.crossNickRecencyDays} ngày`);
  if ((r.stopOnAccept ?? true)) out.push('Dừng khi kết bạn');
  return out;
}

// ── Giờ làm việc tới PHÚT (Anh chốt 2026-06-07) ───────────────────────────
// Hiển thị/nhập "HH:mm" qua <input type="time">. Lưu cả allowedTimeRange (phút,
// cho trigger BullMQ mới của anh) lẫn allowedHourRange (giờ tròn, cho engine cũ).
function hourToHHmm(h: number): string {
  const hh = Math.min(23, Math.max(0, Math.floor(h || 0)));
  return `${String(hh).padStart(2, '0')}:00`;
}
const timeStart = computed(() =>
  editing.value?.runtimeRules.allowedTimeRange?.[0]
  ?? hourToHHmm(editing.value?.runtimeRules.allowedHourRange?.[0] ?? 6),
);
const timeEnd = computed(() =>
  editing.value?.runtimeRules.allowedTimeRange?.[1]
  ?? hourToHHmm(editing.value?.runtimeRules.allowedHourRange?.[1] ?? 22),
);
const delayMin  = computed(() => editing.value?.runtimeRules.randomDelayPerSend?.min ?? 15);
const delayMax  = computed(() => editing.value?.runtimeRules.randomDelayPerSend?.max ?? 45);
const recencyDays = computed(() => editing.value?.runtimeRules.crossNickRecencyDays ?? 30);

// "HH:mm" → giờ tròn (làm tròn XUỐNG) để giữ tương thích engine cũ.
function hhmmToHour(s: string): number {
  const h = parseInt((s || '').split(':')[0] || '0', 10);
  return Math.min(23, Math.max(0, Number.isFinite(h) ? h : 0));
}
function applyTimeRange(start: string, end: string) {
  if (!editing.value) return;
  editing.value.runtimeRules.allowedTimeRange = [start, end];
  // Mirror sang giờ tròn cho engine hiện tại (chưa đọc phút).
  editing.value.runtimeRules.allowedHourRange = [hhmmToHour(start), hhmmToHour(end)];
}
function setTimeStart(v: string) { applyTimeRange(v || '00:00', timeEnd.value); }
function setTimeEnd(v: string)   { applyTimeRange(timeStart.value, v || '23:59'); }

function setDelayMin(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.randomDelayPerSend = { min: Number(v) || 0, max: delayMax.value };
}
function setDelayMax(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.randomDelayPerSend = { min: delayMin.value, max: Number(v) || 0 };
}
function setRecencyDays(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.crossNickRecencyDays = Number(v) || 0;
}

// ── Dừng bám đuổi (giao diện — logic anh code BullMQ sau) ──────────────────
const pauseHoursOnReply = computed(() => editing.value?.runtimeRules.pauseHoursOnReply ?? 24);
const maxAttempts = computed(() => editing.value?.runtimeRules.maxAttemptsPerContact ?? 0);
function setPauseHoursOnReply(v: number) {
  if (!editing.value) return;
  editing.value.runtimeRules.pauseHoursOnReply = Math.max(0, Number(v) || 0);
}
function setMaxAttempts(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.maxAttemptsPerContact = Math.max(0, Number(v) || 0);
}

async function loadAll() {
  const [seqs, blocks] = await Promise.all([
    sequencesApi.listSequences(),
    blocksApi.listBlocks({ limit: 500 }),
  ]);
  sequences.value = seqs;
  availableBlocks.value = blocks;
}

onMounted(() => {
  void loadAll();
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocClick);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', onDocClick);
});

// ============ Drawer open/close ============
function openEditDrawer(seq: AutomationSequence) {
  editing.value = {
    id: seq.id,
    name: seq.name,
    description: seq.description ?? '',
    channel: seq.channel,
    enabled: seq.enabled,
    steps: JSON.parse(JSON.stringify(seq.steps)),
    runtimeRules: JSON.parse(JSON.stringify(seq.runtimeRules ?? {})),
  };
  error.value = '';
  menuOpen.value = false;
  drawerOpen.value = true;
}

function openCreateDrawer() {
  editing.value = {
    id: null,
    name: '',
    description: '',
    channel: 'zalo_user',
    enabled: false,
    steps: [],
    runtimeRules: {
      allowedHourRange: [6, 22],
      allowedTimeRange: ['06:00', '22:00'],
      randomDelayPerSend: { min: 15, max: 45 },
      perNickThrottle: true,
      crossNickRecencyDays: 30,
      stopOnAccept: true,
      pauseHoursOnReply: 24,
      maxAttemptsPerContact: 0,
    },
  };
  error.value = '';
  menuOpen.value = false;
  drawerOpen.value = true;
}

function closeDrawer() {
  drawerOpen.value = false;
  menuOpen.value = false;
  // Clear editing after slide-out transition so card highlight fades cleanly.
  setTimeout(() => {
    if (!drawerOpen.value) editing.value = null;
  }, 250);
}

async function saveSequence() {
  if (!editing.value) return;
  error.value = '';
  if (!editing.value.name.trim()) { error.value = 'Tên không được rỗng'; return; }
  if (editing.value.steps.length === 0) { error.value = 'Cần ít nhất 1 bước'; return; }
  saving.value = true;
  try {
    const input = {
      name: editing.value.name.trim(),
      description: editing.value.description,
      channel: editing.value.channel,
      steps: editing.value.steps,
      runtimeRules: editing.value.runtimeRules,
      enabled: editing.value.enabled,
    };
    let saved: AutomationSequence;
    if (editing.value.id) {
      saved = await sequencesApi.updateSequence(editing.value.id, input);
    } else {
      saved = await sequencesApi.createSequence(input);
    }
    await loadAll();
    reopenSaved(saved.id);
    showToast('Đã lưu sequence', 'success');
  } catch (err: any) {
    if (!maybeShowDestructiveDialog(err)) {
      error.value = extractErrorMsg(err);
    }
  } finally {
    saving.value = false;
  }
}

// After save/duplicate, re-sync the drawer draft from the freshly-loaded list
// item so the editor (and card highlight) reflects server state without closing.
function reopenSaved(id: string) {
  const seq = sequences.value.find((s) => s.id === id);
  if (!seq) return;
  editing.value = {
    id: seq.id,
    name: seq.name,
    description: seq.description ?? '',
    channel: seq.channel,
    enabled: seq.enabled,
    steps: JSON.parse(JSON.stringify(seq.steps)),
    runtimeRules: JSON.parse(JSON.stringify(seq.runtimeRules ?? {})),
  };
}

async function toggleEnabled() {
  if (!editing.value?.id) return;
  if (editing.value.enabled) {
    await sequencesApi.disableSequence(editing.value.id);
  } else {
    await sequencesApi.enableSequence(editing.value.id);
  }
  editing.value.enabled = !editing.value.enabled;
  await loadAll();
}

// Toggle directly from a read-only card (no drawer open required).
async function toggleEnabledOnCard(seq: AutomationSequence) {
  try {
    if (seq.enabled) {
      await sequencesApi.disableSequence(seq.id);
    } else {
      await sequencesApi.enableSequence(seq.id);
    }
    await loadAll();
    // Keep an open drawer in sync if it edits this same sequence.
    if (editing.value?.id === seq.id) {
      editing.value.enabled = !seq.enabled;
    }
  } catch (err: any) {
    showToast(extractErrorMsg(err), 'error');
  }
}

async function onDuplicate() {
  if (!editing.value?.id) return;
  menuOpen.value = false;
  const copy = await sequencesApi.duplicateSequence(editing.value.id);
  await loadAll();
  reopenSaved(copy.id);
  showToast('Đã nhân bản luồng', 'success');
}

function openStats() {
  if (!editing.value?.id) return;
  router.push({ name: 'Marketing.SequenceStats', params: { id: editing.value.id } });
}

async function onDelete() {
  if (!editing.value?.id) return;
  menuOpen.value = false;
  if (!confirm(`Xoá sequence "${editing.value.name}"? Chỉ được xoá khi chưa có campaign.`)) return;
  try {
    await sequencesApi.deleteSequence(editing.value.id);
    closeDrawer();
    await loadAll();
  } catch (err: any) {
    if (!maybeShowDestructiveDialog(err)) {
      error.value = extractErrorMsg(err) || 'Không xoá được';
    }
  }
}

// ============ Keyboard ESC + click-outside menu ============
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (menuOpen.value) menuOpen.value = false;
    else if (drawerOpen.value) closeDrawer();
  }
}
function onDocClick() {
  if (menuOpen.value) menuOpen.value = false;
}
</script>

<style scoped>
.seq-page {
  width: 100%;
  background: var(--surface-2);
  min-height: 100%;
}

/* ── Topbar (.mkt-top is global; page-level overrides) ─────────────────── */
.seq-page .mkt-top { gap: 16px; }
.btn-primary[disabled] { opacity: 0.6; cursor: default; }

/* ── Toolbar / search ─────────────────────────────────────────────────── */
.seq-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.search-wrap { position: relative; width: 320px; }
.search-input {
  width: 100%;
  height: 38px;
  padding: 0 12px 0 34px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 13.5px;
  background: var(--surface);
  font-family: inherit;
  color: var(--ink);
  transition: border-color .14s, box-shadow .14s;
}
.search-input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.search-input::placeholder { color: var(--ink-4); }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-4); }

/* ── Sequence list (Anh chốt 2026-06-06: 1 luồng = 1 hàng full-width, cuộn DỌC,
   KHÔNG lưới 2 cột cạnh nhau) ── */
.seqs { grid-template-columns: 1fr; }
.seq { cursor: pointer; transition: border-color .14s, box-shadow .14s; }
.seq:hover { border-color: var(--brand); box-shadow: var(--sh-md); }
.seq.active { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-soft), var(--sh-md); }

.sh-info { min-width: 0; flex: 1; }
.sd-empty { color: var(--ink-4); font-style: italic; }
.flow-empty {
  font-size: 12.5px;
  color: var(--ink-4);
  font-style: italic;
  padding: 8px 0 14px;
}
.srules:empty { display: none; }

/* ── Editor drawer (slide-from-right) ─────────────────────────────────── */
.panel-overlay {
  position: fixed; inset: 0;
  background: rgba(20, 26, 36, 0.30);
  z-index: 90;
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s;
}
.panel-overlay.show { opacity: 1; pointer-events: auto; }

.side-panel {
  position: fixed;
  top: 0; right: 0;
  height: 100vh;
  width: 560px;
  max-width: 92vw;
  background: var(--surface);
  z-index: 100;
  transform: translateX(100%);
  transition: transform .25s cubic-bezier(.4, 0, .2, 1);
  box-shadow: var(--sh-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.side-panel.open { transform: translateX(0); }

.panel-header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  flex-shrink: 0;
}
.panel-header-row { display: flex; align-items: center; gap: 8px; }
.panel-header-main { flex: 1; min-width: 0; }
.panel-name-field { height: 40px; flex: 1; }
.panel-name-field input {
  border: 0; outline: 0; background: transparent; width: 100%;
  font-size: 16px; font-weight: 700; color: var(--ink);
}
.panel-name-field input::placeholder { color: var(--ink-4); font-weight: 600; }
.panel-name-icon { color: var(--ink-4); }

.panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.panel-actions-spacer { flex: 1; }
.panel-icon-btn {
  background: transparent; border: none; cursor: pointer;
  padding: 4px 8px; color: var(--ink-3);
  line-height: 1; border-radius: var(--r-xs); font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
}
.panel-icon-btn:hover { background: var(--surface-3); color: var(--ink); }

.toggle-row {
  display: inline-flex; align-items: center; gap: 8px;
  background: transparent; border: 0; padding: 4px 2px;
  font-family: inherit; cursor: pointer;
}
.toggle-label { font-size: 13px; font-weight: 600; color: var(--ink-3); }
.toggle-label.on { color: var(--success); }

.panel-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.panel-section { margin-bottom: 22px; }
.panel-section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-4);
  text-transform: uppercase;
  letter-spacing: .05em;
  margin: 0 0 10px;
}
.panel-textarea {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-family: inherit;
  font-size: 13.5px;
  color: var(--ink);
  background: var(--surface);
  resize: vertical;
  line-height: 1.5;
}
.panel-textarea:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.panel-textarea::placeholder { color: var(--ink-4); }

/* ── Rule cards (inside drawer) ───────────────────────────────────────── */
.rule-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  margin-bottom: 12px;
}
.rule-card:last-child { margin-bottom: 0; }
.rule-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  font-size: 13.5px;
}
.rule-card__header strong { color: var(--ink); }
.rule-card__body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.rule-row { display: flex; flex-direction: column; gap: 6px; }
.rule-row > label { font-size: 13px; font-weight: 600; color: var(--ink); }
.rule-row__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rule-row__head > label { font-size: 13px; font-weight: 600; color: var(--ink); }
.rule-row--switch { flex-direction: row; align-items: flex-start; gap: 12px; }
.rule-row--switch > div { flex: 1; }
.rule-row--switch .toggle { margin-top: 2px; }
.rule-input-pair { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rule-input-pair--gap { gap: 8px; }
.rule-num {
  width: 64px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  font-family: inherit;
  font-size: 13.5px;
  color: var(--ink);
  background: var(--surface);
}
.rule-num:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
/* type=time picker — đẹp, gọn, đồng bộ với rule-num */
.rule-time {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  font-family: inherit;
  font-size: 13.5px;
  color: var(--ink);
  background: var(--surface);
}
.rule-time:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.rule-input-pair .suffix { font-size: 12.5px; color: var(--ink-3); }
.rule-mini-label { font-size: 12px; color: var(--ink-3); }
.rule-arrow { color: var(--ink-4); margin: 0 2px; }
.rule-hint { font-size: 12px; color: var(--ink-3); line-height: 1.45; margin: 0; }
.rule-hint strong { color: var(--ink); font-weight: 600; }

/* pill nhỏ hiển thị tóm tắt giá trị bên phải nhãn */
.rule-pill {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-soft);
  padding: 1px 8px;
  border-radius: var(--r-pill, 999px);
  white-space: nowrap;
}
.rule-pill--muted { color: var(--ink-3); background: var(--surface-3); }

.rule-divider { height: 1px; background: var(--line); margin: 2px 0; }

/* Phản ứng nâng cao — danh sách cố định read-only */
.rule-fixed-list { display: flex; flex-direction: column; gap: 6px; }
.rule-fixed-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 12.5px;
}
.rfi-key { color: var(--ink-2); flex-shrink: 0; }
.rfi-val { color: var(--ink-3); margin-left: auto; text-align: right; }

/* ── TimeAmountInput nhúng trong rule-card (đồng bộ size 34px) ──────────── */
.rule-card :deep(.time-amount) { gap: 4px; }
.rule-card :deep(.ta-num) {
  width: 58px; height: 34px; padding: 0 8px;
  border: 1px solid var(--line); border-radius: var(--r-xs);
  font-size: 13.5px; text-align: right; color: var(--ink);
  background: var(--surface); font-family: inherit;
}
.rule-card :deep(.ta-unit) {
  height: 34px; padding: 0 6px;
  border: 1px solid var(--line); border-radius: var(--r-xs);
  font-size: 13px; background: var(--surface); color: var(--ink); cursor: pointer;
}
.rule-card :deep(.ta-num:focus),
.rule-card :deep(.ta-unit:focus) { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }

/* ── Inline error banner ──────────────────────────────────────────────── */
.panel-error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--error-soft);
  border: 1px solid var(--error);
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--error);
  margin-bottom: 8px;
}
.panel-error-banner span { flex: 1; }
.panel-error-close {
  background: transparent; border: 0; cursor: pointer;
  color: var(--error); padding: 2px; display: inline-flex;
}

/* ── Kebab menu ───────────────────────────────────────────────────────── */
.menu-wrap { position: relative; }
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  box-shadow: var(--sh-md);
  min-width: 170px;
  padding: 4px;
  display: none;
  z-index: 110;
}
.menu.show { display: block; }
.menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-xs);
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  user-select: none;
}
.menu-item:hover { background: var(--surface-3); color: var(--ink); }
.menu-item.danger { color: var(--error); }
.menu-item.danger:hover { background: var(--error-soft); }
.menu-divider { height: 1px; background: var(--line); margin: 4px 0; }

/* ── Empty state ──────────────────────────────────────────────────────── */
.seq-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 24px;
  text-align: center;
}
.seq-empty__icon { color: var(--ink-4); }
.seq-empty__title { font-size: 15px; font-weight: 700; color: var(--ink); margin-top: 4px; }
.seq-empty__desc { font-size: 13px; color: var(--ink-3); max-width: 460px; margin-bottom: 8px; }

/* ── Destructive edit dialog (xoá/đổi step giữa chuỗi) ────────────────── */
.destructive-dialog__header {
  background: var(--error-soft);
  color: var(--error);
  font-size: 15px;
  font-weight: 600;
}
.destructive-dialog__body {
  padding-top: 16px !important;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink);
}
</style>
