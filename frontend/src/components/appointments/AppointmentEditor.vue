<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  AppointmentEditor.vue — 1 modal duy nhất cho create + edit "Nhắc hẹn".

  Replace AppointmentQuickCreate.vue cũ (sẽ delete sau khi shipping).
  Memory reference: reference_zalocrm_nhac_hen_terminology.md
  Design mockup:    ~/.gstack/projects/zalocrm/designs/nhac-hen-editor-20260521/

  9 sections theo mockup:
    1. Header
    2. Tiêu đề (font 500, default = tên KH)
    3. KH autocomplete (nếu không có context KH)
    4. Ngày + Giờ (2 cols, custom pickers)
    5. Quick time chips (Sáng/Trưa/Chiều/Tối — random + re-roll)
    6. Duration grid (5p → 3 ngày, default 15p, compute endAt)
    7. Loại (4 icon chips: Gọi điện/Nhắn tin/Gặp mặt/Theo dõi)
    8. Địa điểm (input + 5 preset chips + smart suggest từ tiêu đề)
    9. Ghi chú (textarea optional)
-->
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="editor-backdrop" @click.self="close">
      <div class="editor airtable-scope" @keydown.escape="close" @keydown.ctrl.enter="submit" tabindex="-1">
        <!-- ─── Header ─── -->
        <div class="editor-head">
          <h2><v-icon size="19" class="head-ic">mdi-calendar-clock</v-icon> {{ isEdit ? 'Sửa nhắc hẹn' : 'Tạo nhắc hẹn' }}</h2>
          <button class="close" @click="close" title="Đóng (Esc)"><v-icon size="18">mdi-close</v-icon></button>
        </div>

        <!-- ─── Body ─── -->
        <div class="editor-body">
          <!-- 1. Loại nhắc hẹn (LÊN ĐẦU — click 1 loại sẽ auto-fill template tiêu đề) -->
          <div class="field">
            <span class="field-label">Loại nhắc hẹn</span>
            <div class="type-row">
              <button
                v-for="t in APPOINTMENT_TYPE_OPTIONS"
                :key="t.value"
                type="button"
                class="type-chip"
                :class="{ active: form.type === t.value }"
                :data-t="t.value"
                @click="selectType(t.value)"
              >
                <span class="type-ico"><v-icon size="16">{{ typeMdiIcon(t.value) }}</v-icon></span>
                {{ t.text }}
              </button>
            </div>
          </div>

          <!-- 2. Tiêu đề — icon prefix động theo loại (📞📩🤝👁), template tự fill -->
          <div class="field">
            <div class="title-input-wrap">
              <span class="ic"><v-icon size="16">{{ titleIcon }}</v-icon></span>
              <input
                ref="titleInputRef"
                v-model="form.title"
                class="title-input"
                type="text"
                :placeholder="titlePlaceholder"
              />
            </div>
          </div>

          <!-- 1.5. Liên kết KH + Sale phụ trách (2 cols) -->
          <div class="row-2">
            <!-- KH -->
            <div class="field">
              <span class="field-label">Liên kết khách hàng</span>
              <!-- Linked KH — 2 dòng: tên (lớn) + SĐT (phụ nhỏ), avatar load img thật nếu có -->
              <div v-if="selectedContact" class="linked-kh-row">
                <span
                  class="av"
                  :style="!selectedContact.avatarUrl ? { background: contactColor(selectedContact.id) } : {}"
                >
                  <img v-if="selectedContact.avatarUrl" :src="selectedContact.avatarUrl" alt="" @error="onAvatarError" />
                  <template v-else>{{ initials(selectedContact.fullName) }}</template>
                </span>
                <div class="linked-info">
                  <span class="name">{{ selectedContact.fullName || 'Khách hàng' }}</span>
                  <span v-if="selectedContact.phone" class="phone-row">{{ formatPhoneVN(selectedContact.phone) }}</span>
                  <span v-else-if="selectedContact.zaloUsername" class="phone-row muted">{{ selectedContact.zaloUsername }}</span>
                </div>
                <button type="button" class="remove" @click="clearContact" title="Bỏ link KH"><v-icon size="13">mdi-close</v-icon></button>
              </div>
              <!-- KH autocomplete dropdown — autofocus search ngay khi mở -->
              <div v-else-if="custSuggestOpen" class="cust-suggest">
                <input
                  ref="custSearchInputRef"
                  v-model="custQuery"
                  class="cust-suggest-search"
                  type="text"
                  placeholder="Tìm tên / SĐT / tên gợi nhớ..."
                  autocomplete="off"
                  @input="onCustSearch"
                />
                <div v-if="custSearching" class="cust-loading">Đang tìm...</div>
                <div
                  v-for="c in custSuggestions"
                  :key="c.id"
                  class="cust-item"
                  @mousedown.prevent="pickContact(c)"
                >
                  <span class="av" :style="!c.avatarUrl ? { background: contactColor(c.id) } : {}">
                    <img v-if="c.avatarUrl" :src="c.avatarUrl" alt="" @error="(e) => { (e.target as HTMLImageElement).style.display = 'none' }" />
                    <template v-else>{{ initials(c.fullName) }}</template>
                  </span>
                  <div class="cust-info-1line">
                    <span class="name">{{ c.fullName || 'Khách hàng' }}</span>
                    <span v-if="c.phone" class="sep">·</span>
                    <span v-if="c.phone" class="phone">{{ formatPhoneVN(c.phone) }}</span>
                    <span v-if="c.zaloUsername" class="nick">({{ c.zaloUsername }})</span>
                  </div>
                </div>
                <div v-if="!custSearching && custQuery && custSuggestions.length === 0" class="cust-empty">
                  Không tìm thấy KH "{{ custQuery }}"
                </div>
                <div class="cust-item skip" @mousedown.prevent="dismissCustSuggest">
                  → Không gắn khách
                </div>
              </div>
              <button v-else type="button" class="link-kh-btn" @click="openCustSuggest">
                + Liên kết khách hàng
              </button>
            </div>
            <!-- Sale phụ trách -->
            <div class="field">
              <span class="field-label">Sale phụ trách</span>
              <select v-model="form.assignedUserId" class="sale-select">
                <option :value="null">— Chưa gán —</option>
                <option v-for="u in users" :key="u.id" :value="u.id">
                  {{ u.fullName || u.email }}{{ u.id === currentUserId ? ' (tôi)' : '' }}
                </option>
              </select>
            </div>
          </div>

          <!-- 2. Ngày + Giờ (2 cols) -->
          <div class="row-2">
            <div class="field">
              <span class="field-label">Ngày</span>
              <button ref="dateBtnRef" class="picker-display" :class="{ open: openDatePicker }" @click="toggleDatePicker">
                <span class="ic"><v-icon size="16">mdi-calendar-outline</v-icon></span>
                <span class="val">{{ dateLabel }}</span>
                <span class="caret"><v-icon size="16">{{ openDatePicker ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon></span>
              </button>
            </div>
            <div class="field">
              <span class="field-label">Giờ bắt đầu</span>
              <button ref="timeBtnRef" class="picker-display" :class="{ open: openTimePicker }" @click="toggleTimePicker">
                <span class="ic"><v-icon size="16">mdi-clock-outline</v-icon></span>
                <span class="val">{{ form.time || '--:--' }}</span>
                <span class="caret"><v-icon size="16">{{ openTimePicker ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon></span>
              </button>
            </div>
          </div>

          <!-- 3. Duration — small tag chips, 1 row scroll-x nếu cần -->
          <div class="field">
            <div class="duration-header">
              <span class="field-label">Dự kiến dành thời gian</span>
              <span class="duration-end"><v-icon size="13">mdi-flag-checkered</v-icon> Dự kiến kết thúc: <b class="end-bold">{{ computedEndLabel }}</b> <em>(Tự tính toán)</em></span>
            </div>
            <div class="duration-row">
              <button
                v-for="d in DURATIONS"
                :key="d.value"
                type="button"
                class="tag-chip"
                :class="{ active: form.durationMin === d.value }"
                @click="form.durationMin = d.value"
              >{{ d.label }}</button>
            </div>
          </div>

          <!-- 5. Địa điểm — icon prefix + 6 chips 1 dòng (5 preset + smart auto) -->
          <div class="field">
            <div class="location-input-wrap">
              <span class="ic"><v-icon size="16">mdi-map-marker-outline</v-icon></span>
              <input
                v-model="form.location"
                class="location-input"
                type="text"
                placeholder="Nhập địa điểm..."
              />
            </div>
            <div class="location-tip-row">
              <button
                v-for="p in LOCATION_PRESETS"
                :key="p.value"
                type="button"
                class="loc-chip"
                @click="form.location = p.value"
              ><v-icon size="14">{{ p.icon }}</v-icon> {{ p.value }}</button>
              <button
                type="button"
                class="loc-chip smart"
                :class="{ disabled: !smartLocation }"
                :disabled="!smartLocation"
                @click="smartLocation && (form.location = smartLocation)"
                :title="smartLocation ? `Gợi ý: ${smartLocation}` : 'Tự nhận diện từ tiêu đề (chưa có)'"
              ><v-icon size="14">mdi-robot-outline</v-icon> {{ smartLocation ? smartLocation : 'Auto' }}</button>
            </div>
          </div>

          <!-- 6. Ghi chú -->
          <div class="field">
            <span class="field-label">Ghi chú</span>
            <textarea
              v-model="form.notes"
              class="notes-area"
              placeholder="Sale ghi note nội bộ về cuộc hẹn..."
              rows="2"
            ></textarea>
          </div>

          <!-- Error -->
          <div v-if="error" class="error-banner"><v-icon size="15">mdi-alert-outline</v-icon> {{ error }}</div>
        </div>

        <!-- ─── Footer ─── -->
        <div class="editor-foot">
          <span class="tip"><v-icon size="13">mdi-lightbulb-on-outline</v-icon> <kbd>Ctrl</kbd>+<kbd>Enter</kbd> tạo nhanh · <kbd>Esc</kbd> huỷ</span>
          <div class="actions">
            <button type="button" class="at-btn at-btn--secondary" @click="close">Huỷ</button>
            <button
              type="button"
              class="at-btn at-btn--primary"
              :disabled="!canSubmit || saving"
              @click="submit"
            >
              <v-icon v-if="!saving" size="16">mdi-check</v-icon>
              {{ saving ? 'Đang lưu...' : (isEdit ? 'Cập nhật' : 'Tạo nhắc hẹn') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Date picker popup — position fixed bên ngoài modal (không push modal expand) -->
      <div
        v-if="openDatePicker"
        class="picker-popup date-popup airtable-scope"
        :style="datePopupStyle"
        v-click-outside="closeDatePicker"
      >
        <div class="dp-head">
          <button type="button" @click="shiftCalMonth(-1)"><v-icon size="18">mdi-chevron-left</v-icon></button>
          <span class="month">Tháng {{ calMonth.getMonth() + 1 }}, {{ calMonth.getFullYear() }}</span>
          <button type="button" @click="shiftCalMonth(1)"><v-icon size="18">mdi-chevron-right</v-icon></button>
        </div>
        <div class="dp-grid">
          <div v-for="w in ['CN','T2','T3','T4','T5','T6','T7']" :key="w" class="dp-wd">{{ w }}</div>
          <div
            v-for="cell in calCells"
            :key="cell.iso"
            class="dp-day"
            :class="{ muted: cell.muted, today: cell.isToday, selected: cell.iso === form.date }"
            @click="pickDate(cell.date)"
          >{{ cell.day }}</div>
        </div>
        <div class="dp-tip-divider"></div>
        <div class="dp-tips">
          <button
            v-for="t in dateTips"
            :key="t.label"
            type="button"
            class="tip-chip dp-tip"
            :class="{ active: isDateTipActive(t.offset) }"
            @click="pickDateOffset(t.offset)"
          >{{ t.label }}</button>
        </div>
        <div class="popup-foot">
          <button type="button" class="at-btn at-btn--primary popup-confirm" @click="closeDatePicker"><v-icon size="15">mdi-check</v-icon> Xác nhận</button>
        </div>
      </div>

      <!-- Time picker popup -->
      <div
        v-if="openTimePicker"
        class="picker-popup time-popup airtable-scope"
        :style="timePopupStyle"
        v-click-outside="closeTimePicker"
      >
        <div class="tp-wheels">
          <div class="tp-fade tp-fade--top"></div>
          <div class="tp-fade tp-fade--bot"></div>
          <div class="tp-wheel" @wheel.prevent="onHourWheel">
            <div class="tp-wheel-items" :style="{ transform: `translateY(${-hourWheelOffset}px)` }">
              <div
                v-for="h in HOURS"
                :key="h"
                class="tp-wheel-item"
                :class="{ selected: h === hourValue }"
                @click="setHour(h)"
              >{{ String(h).padStart(2, '0') }}</div>
            </div>
          </div>
          <div class="tp-separator">:</div>
          <div class="tp-wheel" @wheel.prevent="onMinuteWheel">
            <div class="tp-wheel-items" :style="{ transform: `translateY(${-minuteWheelOffset}px)` }">
              <div
                v-for="m in MINUTES"
                :key="m"
                class="tp-wheel-item"
                :class="{ selected: m === minuteValue }"
                @click="setMinute(m)"
              >{{ String(m).padStart(2, '0') }}</div>
            </div>
          </div>
        </div>
        <div class="tp-quick-grid">
          <button type="button" class="tip-chip" @click="randomTime('morning')"><v-icon size="14">mdi-weather-sunny</v-icon> Sáng</button>
          <button type="button" class="tip-chip" @click="randomTime('noon')"><v-icon size="14">mdi-weather-partly-cloudy</v-icon> Trưa</button>
          <button type="button" class="tip-chip" @click="randomTime('afternoon')"><v-icon size="14">mdi-weather-sunset</v-icon> Chiều</button>
          <button type="button" class="tip-chip" @click="randomTime('evening')"><v-icon size="14">mdi-weather-night</v-icon> Tối</button>
        </div>
        <div class="tp-helper">Bấm lại 1 khung để random giờ khác</div>
        <div class="popup-foot">
          <button type="button" class="at-btn at-btn--primary popup-confirm" @click="closeTimePicker"><v-icon size="15">mdi-check</v-icon> Xác nhận</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import { useUsers } from '@/composables/use-users';
import {
  APPOINTMENT_TYPE_OPTIONS,
  initials,
  type AppointmentEx as Appointment,
  type AiPrefill,
} from '@/composables/appointment-helpers';

/** SĐT chuẩn VN để hiển thị: 84xxx / +84xxx → 0xxx (bỏ khoảng trắng, dấu). */
function formatPhoneVN(p?: string | null): string {
  if (!p) return '';
  let s = String(p).replace(/[\s.()-]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('0084')) s = '0' + s.slice(4);
  else if (s.startsWith('84') && s.length >= 10 && s.length <= 12) s = '0' + s.slice(2);
  return s;
}

/** Icon MDI theo loại nhắc hẹn (chuẩn HS — KHÔNG emoji, anh chốt 2026-06-16). */
const TYPE_MDI: Record<string, string> = {
  call: 'mdi-phone-outline',
  message: 'mdi-message-text-outline',
  meeting: 'mdi-account-multiple-outline',
  follow_up: 'mdi-eye-outline',
};
function typeMdiIcon(t: string): string {
  return TYPE_MDI[t] || 'mdi-bell-outline';
}

interface ContactLite {
  id: string;
  fullName: string | null;
  phone: string | null;
  zaloUid?: string | null;
  /** Tên gợi nhớ (Contact.zaloUsername hoặc displayName từ Friend). Search được. */
  zaloUsername?: string | null;
  avatarUrl?: string | null;
}

interface UserLite {
  id: string;
  fullName: string | null;
  email: string;
}

const props = defineProps<{
  modelValue: boolean;
  /** Mở ở mode edit khi truyền appointment, ngược lại = create */
  appointment?: Appointment | null;
  /** Default date khi tạo mới (vd click slot week-view) */
  defaultDate?: Date | null;
  /** Prefill contact (vd mở từ contact page) */
  prefillContact?: ContactLite | null;
  /** Danh sách user trong org cho dropdown Sale */
  users?: UserLite[];
  /** ID của user đang đăng nhập — default Sale phụ trách */
  currentUserId?: string | null;
  /** AI parse result từ ghi chú → fill các trường tạo lịch hẹn */
  aiPrefill?: AiPrefill | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'created', a: Appointment): void;
  (e: 'updated', a: Appointment): void;
}>();

const titleInputRef = ref<HTMLInputElement | null>(null);
const dateBtnRef = ref<HTMLButtonElement | null>(null);
const timeBtnRef = ref<HTMLButtonElement | null>(null);
const custSearchInputRef = ref<HTMLInputElement | null>(null);

// Computed popup position từ button bounding rect (vì popup TELEPORT ngoài modal,
// không thể dùng absolute relative đến field nữa — modal sẽ KHÔNG bị popup
// push expand vì popup overlay riêng).
const datePopupStyle = ref<Record<string, string>>({});
const timePopupStyle = ref<Record<string, string>>({});

function computePopupPosition(
  btnRef: HTMLButtonElement | null,
  popupWidth = 280,
  popupHeight = 400,
): Record<string, string> {
  if (!btnRef) return {};
  const rect = btnRef.getBoundingClientRect();
  // Horizontal: prefer left-align với button, clamp khi tràn phải viewport
  const left = Math.min(rect.left, window.innerWidth - popupWidth - 16);
  // Vertical: ưu tiên dưới button; nếu tràn dưới → place above button
  let top = rect.bottom + 6;
  if (top + popupHeight > window.innerHeight - 16) {
    const above = rect.top - popupHeight - 6;
    top = above >= 16 ? above : Math.max(16, window.innerHeight - popupHeight - 16);
  }
  return {
    position: 'fixed',
    top: `${top}px`,
    left: `${Math.max(8, left)}px`,
    width: `${popupWidth}px`,
  };
}

const isEdit = computed(() => !!props.appointment);

// ───────── Contact state ─────────
const selectedContact = ref<ContactLite | null>(null);
const custSuggestOpen = ref(false);
const custQuery = ref('');
const custSuggestions = ref<ContactLite[]>([]);
const custSearching = ref(false);

function openCustSuggest() {
  custSuggestOpen.value = true;
  // Auto-focus search input ngay khi mở (1-click flow, không cần click thêm)
  nextTick(() => {
    custSearchInputRef.value?.focus();
  });
}

function dismissCustSuggest() {
  custSuggestOpen.value = false;
  custQuery.value = '';
  custSuggestions.value = [];
}

/**
 * Resolve avatar real:
 *   1. Contact.avatarUrl (manual upload, hiếm)
 *   2. Friend.zaloAvatarUrl đầu tiên (per-nick Zalo profile pic, common)
 *   3. null → fallback initials
 */
function resolveAvatarUrl(c: any): string | null {
  if (c?.avatarUrl) return c.avatarUrl;
  const friends = c?.friends || [];
  for (const f of friends) {
    if (f?.zaloAvatarUrl) return f.zaloAvatarUrl;
  }
  return null;
}

function toContactLite(c: any): ContactLite {
  return {
    id: c.id,
    fullName: c.fullName ?? null,
    phone: c.phone ?? null,
    zaloUid: c.zaloUid ?? null,
    zaloUsername: c.zaloUsername || c.aggregateZaloUsername || null,
    avatarUrl: resolveAvatarUrl(c),
  };
}

/** Fetch contact detail (includes friends) khi prefillContact / edit-mode chưa có
 *  avatar info đầy đủ. Async — patch selectedContact in-place khi xong (chỉ nếu user
 *  chưa pick contact khác trong thời gian fetch). */
async function enrichContactAvatar(contactId: string) {
  try {
    const res = await api.get(`/contacts/${contactId}`);
    const enriched = toContactLite(res.data);
    if (selectedContact.value?.id === contactId && enriched.avatarUrl) {
      selectedContact.value = { ...selectedContact.value, avatarUrl: enriched.avatarUrl };
    }
  } catch (err) {
    console.warn('[editor] avatar enrich fetch failed', err);
  }
}

/** Edit mode khi object lịch thiếu `contact` (chat/list rút gọn) → fetch đầy đủ theo id. */
async function loadContactById(contactId: string) {
  try {
    const res = await api.get(`/contacts/${contactId}`);
    selectedContact.value = toContactLite(res.data);
  } catch (err) {
    console.warn('[editor] load contact for edit failed', err);
  }
}

let custSearchHandle: number | null = null;
function onCustSearch() {
  if (custSearchHandle) window.clearTimeout(custSearchHandle);
  const q = custQuery.value.trim();
  if (!q) { custSuggestions.value = []; return; }
  custSearching.value = true;
  custSearchHandle = window.setTimeout(async () => {
    try {
      const res = await api.get('/contacts', { params: { search: q, limit: 8 } });
      const raw = (res.data.contacts ?? res.data ?? []).slice(0, 8);
      custSuggestions.value = raw.map(toContactLite);
    } catch (err) {
      console.error('[editor] contact search failed', err);
      custSuggestions.value = [];
    } finally {
      custSearching.value = false;
    }
  }, 220);
}

function pickContact(c: ContactLite) {
  selectedContact.value = c;
  custSuggestOpen.value = false;
  custQuery.value = '';
  // Rebuild title theo template hiện tại (loại + tên KH mới)
  form.title = buildTitleFromType(form.type);
  nextTick(() => focusTitleAtEnd());
}

function clearContact() {
  selectedContact.value = null;
}

/** Avatar img load fail → fallback initials (set avatarUrl=null trên copy) */
function onAvatarError() {
  if (selectedContact.value && selectedContact.value.avatarUrl) {
    selectedContact.value = { ...selectedContact.value, avatarUrl: null };
  }
}

// ───────── Form state ─────────
const form = reactive({
  title: '',
  date: '',
  time: '',
  durationMin: 15,
  type: 'call',
  location: '',
  notes: '',
  assignedUserId: null as string | null,
});

// Computed users list + currentUserId — ROBUST: editor tự lo nguồn để mở từ đâu (chat,
// contact, /appointments) cũng có đủ Sale. props.users ưu tiên; thiếu thì tự fetch; luôn
// đảm bảo có "tôi" (owner đang tạo) trong list để default + hiển thị đúng.
const auth = useAuthStore();
const { users: fetchedUsers, fetchUsers } = useUsers();
const currentUserId = computed<string | null>(() => props.currentUserId ?? auth.user?.id ?? null);
const users = computed<UserLite[]>(() => {
  const base = (props.users && props.users.length) ? props.users : (fetchedUsers.value as unknown as UserLite[]);
  const list: UserLite[] = base ? [...base] : [];
  const meId = currentUserId.value;
  if (meId && !list.some((u) => u.id === meId)) {
    list.unshift({ id: meId, fullName: auth.user?.fullName ?? auth.user?.email ?? 'Tôi', email: auth.user?.email ?? '' });
  }
  return list;
});

const saving = ref(false);
const error = ref('');

const titlePlaceholder = computed(() =>
  selectedContact.value?.fullName
    ? `Tiêu đề nhắc hẹn — vd Gọi nhắc ${selectedContact.value.fullName}`
    : 'Tiêu đề nhắc hẹn — vd Gọi nhắc khách hàng',
);

/**
 * Title template per type — sale click loại sẽ auto-fill, trailing space để sale gõ tiếp.
 *   call      → "Gọi điện cho {name} "
 *   message   → "Nhắn tin cho {name} "
 *   meeting   → "Hẹn gặp {name} "
 *   follow_up → "Theo dõi {name} "
 */
const TYPE_TITLE_TEMPLATE: Record<string, string> = {
  call:      'Gọi điện cho',
  message:   'Nhắn tin cho',
  meeting:   'Hẹn gặp',
  follow_up: 'Theo dõi',
};

function buildTitleFromType(type: string): string {
  const prefix = TYPE_TITLE_TEMPLATE[type] || 'Nhắc';
  const name = selectedContact.value?.fullName?.trim() || '';
  return name ? `${prefix} ${name} ` : `${prefix} `;
}

function focusTitleAtEnd() {
  const el = titleInputRef.value;
  if (!el) return;
  el.focus();
  const len = el.value.length;
  try { el.setSelectionRange(len, len); } catch { /* IE fallback no-op */ }
}

function selectType(type: string) {
  form.type = type;
  // Overwrite tiêu đề bằng template loại mới — sale gõ tiếp sau dấu cách cuối
  form.title = buildTitleFromType(type);
  nextTick(() => focusTitleAtEnd());
}

/** Icon prefix trong ô tiêu đề thay đổi theo loại đang chọn */
const titleIcon = computed(() => typeMdiIcon(form.type));

const canSubmit = computed(() =>
  !!form.title.trim() && !!form.date && !!form.time && !!form.type,
);

// ───────── Init / reset state khi mở ─────────
watch(() => props.modelValue, (open) => {
  if (!open) return;
  error.value = '';
  saving.value = false;
  openDatePicker.value = false;
  openTimePicker.value = false;
  custSuggestOpen.value = false;
  custQuery.value = '';
  // Mở từ chat/contact (không truyền users) → tự fetch để dropdown Sale đủ người.
  if (!props.users?.length && !fetchedUsers.value.length) fetchUsers().catch(() => {});

  if (props.appointment) {
    // Edit mode
    const a = props.appointment;
    form.title = (a as any).title || (a.contact?.fullName ? `Nhắc hẹn KH ${a.contact.fullName}` : '');
    form.date = a.appointmentDate;
    form.time = a.appointmentTime;
    form.durationMin = (a as any).durationMin || 15;
    form.type = a.type || 'call';
    form.location = (a as any).location || '';
    form.notes = a.notes || '';
    form.assignedUserId = (a as any).assignedUserId ?? (a as any).assignedTo?.id ?? null;
    // FIX 2026-06-16 (Anh báo "sửa lịch mất link KH"): vài nguồn list/chat truyền object
    // lịch KHÔNG kèm `contact` → trước đây set null → mất link. Giờ: có contact thì dùng,
    // thiếu mà còn contactId thì FETCH lại để giữ link KH.
    const cObj = (a as any).contact;
    if (cObj) {
      selectedContact.value = toContactLite(cObj);
      if (!selectedContact.value.avatarUrl) enrichContactAvatar(selectedContact.value.id);
    } else if ((a as any).contactId) {
      selectedContact.value = null;
      loadContactById((a as any).contactId);
    } else {
      selectedContact.value = null;
    }
    calMonth.value = a.appointmentDate ? new Date(a.appointmentDate) : new Date();
  } else {
    // Create mode
    const base = props.defaultDate || roundToNextSlot(new Date());
    form.date = isoDate(base);
    form.time = isoTime(base);
    form.durationMin = 15;
    form.type = 'call';
    form.location = '';
    form.notes = '';
    form.assignedUserId = currentUserId.value; // default sale = người tạo
    // Prefill: nếu parent truyền object có sẵn friends → resolve avatar fallback,
    // không thì giữ nguyên (parent có thể đã set avatarUrl chuẩn).
    selectedContact.value = props.prefillContact
      ? toContactLite(props.prefillContact)
      : null;
    // Parent (ChatAppointments, CustomerTimelineSection) thường chỉ truyền {id, fullName}
    // → fetch detail để enrich avatar (Contact.avatarUrl + Friend.zaloAvatarUrl fallback).
    if (selectedContact.value?.id && !selectedContact.value.avatarUrl) {
      enrichContactAvatar(selectedContact.value.id);
    }
    // Tiêu đề default = template theo loại hiện tại (call), kèm tên KH nếu prefill
    form.title = buildTitleFromType(form.type);
    calMonth.value = new Date(base);

    // AI prefill (sau khi default đã set) — override field nào AI có giá trị.
    // Đến từ NotesSection sau khi ai-parse cascade (rule-based + Gemini).
    if (props.aiPrefill) {
      const p = props.aiPrefill;
      if (p.type) form.type = p.type;
      if (p.date) {
        form.date = p.date;
        calMonth.value = new Date(p.date + 'T00:00:00');
      }
      if (p.time) form.time = p.time;
      if (p.location) form.location = p.location;
      // Title: ưu tiên AI summary, fallback template theo type mới
      if (p.title && p.title.trim()) {
        form.title = p.title.trim();
      } else {
        form.title = buildTitleFromType(form.type);
      }
      if (p.notes) form.notes = p.notes;
    }
  }

  nextTick(() => titleInputRef.value?.focus());
});

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function roundToNextSlot(d: Date): Date {
  // Round lên slot phút gần nhất trong [0, 10, 15, 30, 45, 50]
  const out = new Date(d);
  out.setSeconds(0, 0);
  const slots = [0, 10, 15, 30, 45, 50];
  const m = out.getMinutes();
  const next = slots.find((s) => s > m);
  if (next != null) {
    out.setMinutes(next);
  } else {
    out.setHours(out.getHours() + 1);
    out.setMinutes(0);
  }
  return out;
}

// ───────── Date label ─────────
const VN_DOWS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const dateLabel = computed(() => {
  if (!form.date) return 'Chọn ngày...';
  const d = new Date(form.date);
  return `${VN_DOWS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
});

// ───────── Date picker ─────────
const openDatePicker = ref(false);
const calMonth = ref(new Date());

function shiftCalMonth(delta: number) {
  const d = new Date(calMonth.value);
  d.setMonth(d.getMonth() + delta);
  calMonth.value = d;
}

interface CalCell { date: Date; iso: string; day: number; muted: boolean; isToday: boolean }
const calCells = computed<CalCell[]>(() => {
  const year = calMonth.value.getFullYear();
  const month = calMonth.value.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // VN week starts Sunday (CN=0)? Anh dùng CN-T2-...-T7. JS getDay=0 (CN).
  const offset = firstOfMonth.getDay();
  const start = new Date(year, month, 1 - offset);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cells: CalCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      iso: isoDate(d),
      day: d.getDate(),
      muted: d.getMonth() !== month,
      isToday: d.getTime() === today.getTime(),
    });
  }
  return cells;
});

function pickDate(d: Date) {
  form.date = isoDate(d);
  calMonth.value = new Date(d); // sync month nếu user click ngày tháng khác
  // KHÔNG auto close — user phải bấm "Xác nhận" hoặc click outside
}

function pickDateOffset(offsetDays: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  form.date = isoDate(d);
  calMonth.value = new Date(d); // jump calendar tới tháng đúng
  // KHÔNG auto close
}

/** Active state cho tip chip: chip "Hôm nay" sáng nếu form.date === today, v.v. */
function isDateTipActive(offsetDays: number): boolean {
  if (!form.date) return false;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return isoDate(d) === form.date;
}

// Mutually exclusive popups + click-outside helpers
function toggleDatePicker() {
  if (openDatePicker.value) {
    openDatePicker.value = false;
  } else {
    openTimePicker.value = false;
    datePopupStyle.value = computePopupPosition(dateBtnRef.value, 300, 470);
    openDatePicker.value = true;
  }
}
function closeDatePicker() { openDatePicker.value = false; }
function toggleTimePicker() {
  if (openTimePicker.value) {
    openTimePicker.value = false;
  } else {
    openDatePicker.value = false;
    timePopupStyle.value = computePopupPosition(timeBtnRef.value, 240, 360);
    openTimePicker.value = true;
  }
}
function closeTimePicker() { openTimePicker.value = false; }

// v-click-outside directive — đóng popup khi click ngoài.
// Skip trigger (button mở chính popup đó) để tránh toggle-then-close cùng frame.
const vClickOutside = {
  beforeMount(el: HTMLElement, binding: { value: () => void }) {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (el.contains(target)) return;
      // Skip nếu click vào picker-display button (đã handle bằng toggle)
      if (target.closest('.picker-display')) return;
      binding.value();
    };
    (el as any).__clickOutsideHandler = handler;
    setTimeout(() => document.addEventListener('click', handler), 0);
  },
  unmounted(el: HTMLElement) {
    document.removeEventListener('click', (el as any).__clickOutsideHandler);
  },
};

// 8 tip chips — bỏ "Hôm nay" (default form.date đã là hôm nay nên không cần)
// Layout: 4-col × 2 dòng, gọn trong popup 300px.
const dateTips = [
  { label: 'Ngày mai',   offset: 1 },
  { label: 'Ngày mốt',   offset: 2 },
  { label: '+3 ngày',    offset: 3 },
  { label: '+5 ngày',    offset: 5 },
  { label: '+7 ngày',    offset: 7 },
  { label: '+10 ngày',   offset: 10 },
  { label: '+15 ngày',   offset: 15 },
  { label: '+1 tháng',   offset: 30 },
];

// ───────── Time picker (iOS wheel) ─────────
const openTimePicker = ref(false);
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6..23
const MINUTES = [0, 10, 15, 30, 45, 50];
const WHEEL_ITEM_H = 32; // match CSS .tp-wheel-item height (160px wheels = 5 items visible)

const hourValue = computed<number>(() => {
  if (!form.time) return 9;
  return parseInt(form.time.split(':')[0], 10);
});
const minuteValue = computed<number>(() => {
  if (!form.time) return 30;
  return parseInt(form.time.split(':')[1], 10);
});

// Wheel translation: center selected at row index 2 (5 visible rows, center = row idx 2)
const hourWheelOffset = computed(() => {
  const idx = HOURS.indexOf(hourValue.value);
  return idx >= 0 ? idx * WHEEL_ITEM_H - 2 * WHEEL_ITEM_H : 0;
});
const minuteWheelOffset = computed(() => {
  const idx = MINUTES.indexOf(minuteValue.value);
  return idx >= 0 ? idx * WHEEL_ITEM_H - 2 * WHEEL_ITEM_H : 0;
});

function setHour(h: number) {
  const m = minuteValue.value;
  form.time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function setMinute(m: number) {
  const h = hourValue.value;
  form.time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function onHourWheel(e: WheelEvent) {
  const dir = e.deltaY > 0 ? 1 : -1;
  const idx = HOURS.indexOf(hourValue.value);
  const next = Math.max(0, Math.min(HOURS.length - 1, idx + dir));
  setHour(HOURS[next]);
}
function onMinuteWheel(e: WheelEvent) {
  const dir = e.deltaY > 0 ? 1 : -1;
  const idx = MINUTES.indexOf(minuteValue.value);
  const next = Math.max(0, Math.min(MINUTES.length - 1, idx + dir));
  setMinute(MINUTES[next]);
}

// Random time trong khung Sáng/Trưa/Chiều/Tối — re-roll khi click lại
const TIME_RANGES: Record<string, [number, number]> = {
  morning:   [6, 11],
  noon:      [12, 12],
  afternoon: [13, 15],
  evening:   [16, 23],
};
function randomTime(period: 'morning' | 'noon' | 'afternoon' | 'evening') {
  const [lo, hi] = TIME_RANGES[period];
  const h = lo + Math.floor(Math.random() * (hi - lo + 1));
  const m = MINUTES[Math.floor(Math.random() * MINUTES.length)];
  form.time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ───────── Duration ─────────
// 2026-05-21 chốt: bỏ "3 ngày" — chỉ tới "1 ngày" là đủ cho domain BĐS sale.
const DURATIONS = [
  { label: '5p',     value: 5 },
  { label: '10p',    value: 10 },
  { label: '15p',    value: 15 },
  { label: '30p',    value: 30 },
  { label: '1 giờ',  value: 60 },
  { label: '2 giờ',  value: 120 },
  { label: '5 giờ',  value: 300 },
  { label: '8 giờ',  value: 480 },
  { label: '12 giờ', value: 720 },
  { label: '1 ngày', value: 1440 },
];

/**
 * Compute end label support multi-day.
 *   Trong ngày      → "HH:mm"
 *   Qua ngày khác   → "HH:mm DD/MM"
 *
 * Parse form.date (ISO "YYYY-MM-DD") theo LOCAL timezone (split + new Date(y, m-1, d))
 * thay vì new Date("YYYY-MM-DD") (UTC midnight → off by tz hours khi compute).
 */
const computedEndLabel = computed(() => {
  if (!form.time || !form.durationMin || !form.date) return '--:--';
  const [y, mo, d] = form.date.split('-').map((s) => parseInt(s, 10));
  const [h, m] = form.time.split(':').map((s) => parseInt(s, 10));
  const startDate = new Date(y, mo - 1, d, h, m, 0, 0);
  const endDate = new Date(startDate.getTime() + form.durationMin * 60 * 1000);
  const endH = String(endDate.getHours()).padStart(2, '0');
  const endM = String(endDate.getMinutes()).padStart(2, '0');
  const timeOnly = `${endH}:${endM}`;
  if (
    endDate.getFullYear() === startDate.getFullYear() &&
    endDate.getMonth() === startDate.getMonth() &&
    endDate.getDate() === startDate.getDate()
  ) {
    return timeOnly;
  }
  const dd = String(endDate.getDate()).padStart(2, '0');
  const mm = String(endDate.getMonth() + 1).padStart(2, '0');
  return `${timeOnly} ${dd}/${mm}`;
});

// ───────── Smart location detection (regex từ title) ─────────
const SMART_LOCATION_REGEX = [
  // Tên dự án BĐS phổ biến
  /(Vinhomes [A-Za-zÀ-ỹ ]+)/i,
  /(Masteri [A-Za-zÀ-ỹ ]+)/i,
  /(Sunshine [A-Za-zÀ-ỹ ]+)/i,
  /(Eco [A-Za-zÀ-ỹ ]+(?:City|Park|Smart))/i,
  /(Saigon [A-Za-zÀ-ỹ ]+)/i,
  /(The [A-Za-zÀ-ỹ ]+(?:Origin|Heights|Manor|Garden))/i,
  /(Glory [A-Za-zÀ-ỹ ]+)/i,
  // Generic địa danh sau "tại" / "ở"
  /(?:tại|ở)\s+([A-ZÀ-Ỹ][A-Za-zÀ-ỹ0-9 ,]{3,40}?)(?:\s+(?:vào|lúc|cho|với|—|-)|$)/u,
];

const smartLocation = computed<string | null>(() => {
  const title = form.title.trim();
  if (!title) return null;
  for (const r of SMART_LOCATION_REGEX) {
    const m = title.match(r);
    if (m && m[1]) {
      const v = m[1].trim();
      // Bỏ qua nếu trùng với input location hiện tại
      if (v.toLowerCase() === form.location.toLowerCase()) return null;
      return v;
    }
  }
  return null;
});

const LOCATION_PRESETS = [
  { icon: 'mdi-office-building-outline', value: 'Văn phòng' },
  { icon: 'mdi-home-outline', value: 'Nhà khách' },
  { icon: 'mdi-crane', value: 'Dự án' },
  { icon: 'mdi-home-city-outline', value: 'Nhà mẫu' },
  { icon: 'mdi-coffee-outline', value: 'Quán cafe' },
];

// ───────── Contact color (consistent hash) ─────────
const PALETTE = ['#aa2d00', '#0a2e0e', '#d9a441', '#fcab79', '#a8d8c4', '#1b61c9'];
function contactColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ───────── Submit / close ─────────
async function submit() {
  if (!canSubmit.value) {
    error.value = 'Điền tiêu đề, ngày và giờ trước khi tạo nhắc hẹn';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    // Khi save: nếu có location, append "📍 {location}" vào sau tiêu đề.
    // Idempotent — không double-append nếu sale đã gõ tay vào tiêu đề rồi.
    const rawTitle = form.title.trim();
    const locTrim = form.location.trim();
    const finalTitle = locTrim && !rawTitle.includes('📍')
      ? `${rawTitle} 📍 ${locTrim}`
      : rawTitle;
    const payload = {
      title: finalTitle,
      contactId: selectedContact.value?.id ?? null,
      assignedUserId: form.assignedUserId,
      appointmentDate: form.date,
      appointmentTime: form.time,
      durationMin: form.durationMin,
      type: form.type,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (isEdit.value && props.appointment) {
      // FIX 2026-06-09 (Anh báo "lưu sửa lịch báo not_found"): BE chỉ có PUT /appointments/:id
      // (PATCH /:id chưa định nghĩa → 404 not_found). Đổi patch→put, khớp use-appointments.ts.
      const res = await api.put(`/appointments/${props.appointment.id}`, payload);
      emit('updated', res.data);
    } else {
      const res = await api.post('/appointments', payload);
      emit('created', res.data);
    }
    close();
  } catch (err: any) {
    // BE trả `message` (vd lịch trùng giờ — câu chữ cụ thể) → ưu tiên; fallback `error`.
    error.value = err?.response?.data?.message || err?.response?.data?.error || 'Không lưu được nhắc hẹn';
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('update:modelValue', false);
}

// Re-compute popup position khi window resize
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (openDatePicker.value) datePopupStyle.value = computePopupPosition(dateBtnRef.value, 300, 470);
    if (openTimePicker.value) timePopupStyle.value = computePopupPosition(timeBtnRef.value, 240, 360);
  });
}
</script>

<style scoped>
@import '@/assets/airtable.css';

/* FIX 2026-06-09 (Anh báo bể UI): 2 token --at-coral-tint / --at-coral-text KHÔNG
   được định nghĩa trong airtable.css → render rỗng → hàng KH liên kết (.linked-kh-row)
   + banner lỗi (.error-banner) mất nền/màu chữ. Bổ sung scoped tại đây (không đụng
   airtable.css dùng chung). Tint = nền đỏ nhạt, text = chữ đỏ đậm — khớp --at-coral. */
.airtable-scope {
  --at-coral-tint: var(--at-atlas-danger-soft, #fdeceb);
  --at-coral-text: var(--at-coral, #f04438);
}

/* ─── Backdrop + modal ─── */
.editor-backdrop {
  position: fixed; inset: 0;
  background: rgba(24, 29, 38, 0.55);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex; align-items: center; justify-content: center;
  padding: var(--at-s-md);
}
.editor {
  width: 560px; max-width: 100%;
  /* FIX 2026-06-09 (Anh báo bể): bỏ height cứng 780px (gây dồn cục section + dư khoảng
     trống đáy). Modal tự co theo nội dung, cap 94vh — body flex:1 overflow-y:auto tự cuộn
     nếu thiếu chỗ. Popup ngày/giờ TELEPORT ra ngoài (position fixed) nên không push modal. */
  height: auto;
  max-height: 94vh;
  background: var(--at-canvas);
  border-radius: var(--at-r-lg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32), 0 2px 8px rgba(0, 0, 0, 0.12);
  display: flex; flex-direction: column;
  overflow: hidden;
  outline: none;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--at-body);
}

.editor-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--at-s-md) var(--at-s-lg);
  border-bottom: 1px solid var(--at-hairline);
}
.editor-head h2 { font-size: 18px; font-weight: 500; color: var(--at-ink); margin: 0; }
.editor-head .close {
  width: 32px; height: 32px; border-radius: var(--at-r-md);
  background: transparent; border: none; color: var(--at-muted);
  font-size: 18px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.editor-head .close:active { background: var(--at-surface-soft); }

.editor-body {
  flex: 1; overflow-y: auto;
  padding: var(--at-s-md) var(--at-s-lg);
  display: flex; flex-direction: column; gap: var(--at-s-md);
}

.editor-foot {
  display: flex; align-items: center; justify-content: space-between; gap: var(--at-s-xs);
  padding: var(--at-s-sm) var(--at-s-lg);
  background: var(--at-surface-soft);
  border-top: 1px solid var(--at-hairline);
}
.editor-foot .tip {
  font-size: 11.5px; color: var(--at-muted);
  display: inline-flex; align-items: center; gap: 4px;
}
.editor-foot kbd {
  display: inline-block; padding: 1px 5px;
  background: var(--at-canvas); border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-xs);
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  font-size: 10.5px; margin: 0 1px;
}
.editor-foot .actions { display: flex; gap: 6px; }

/* ─── Field common ─── */
/* FIX 2026-06-09 (Anh báo "bể tè le"): global hs-crm-theme.css định nghĩa `.field` là
   1 Ô INPUT (height:40px, flex row, border, bg, padding) — leak vào đây làm MỖI section
   thành 1 khung viền đè chồng lên field dưới. Trong editor, `.field` là 1 KHỐI DỌC
   (label trên + control dưới). Phải RESET đè lại toàn bộ box-prop global + ép cao tự động.
   Scope dưới .editor để KHÔNG đụng .field nơi khác. */
.editor .field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--at-s-xs);
  position: relative;
  height: auto;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
}
.editor .field:focus-within { box-shadow: none; } /* huỷ glow global của .field:focus-within */
/* Khôi phục viền cho input/select THẬT bên trong editor (global .field input{border:0} đã xoá) */
.editor .field .title-input-wrap,
.editor .field .location-input-wrap,
.editor .field .picker-display,
.editor .field .sale-select,
.editor .field .notes-area,
.editor .field .cust-suggest-search { border: 1px solid var(--at-hairline); }
.field-label {
  font-size: 11.5px; font-weight: 500; color: var(--at-muted);
  text-transform: uppercase; letter-spacing: 0.08em;
}
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--at-s-sm); }

/* Title input wrap — icon prefix + placeholder bold inline */
.title-input-wrap {
  display: flex; align-items: center;
  width: 100%; height: 48px; padding: 0 var(--at-s-md);
  border: 1px solid var(--at-hairline); border-radius: var(--at-r-sm);
  background: var(--at-canvas); gap: 10px;
}
.title-input-wrap:focus-within { border-color: var(--at-ink); }
.title-input-wrap .ic { font-size: 18px; flex-shrink: 0; }
.title-input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 16px; font-weight: 500;
  color: var(--at-ink);
}
.title-input::placeholder { font-weight: 500; color: var(--at-muted); }

/* Linked KH row — 2 dòng: tên (chính) + SĐT (phụ). Avatar img thật fallback initials. */
.linked-kh-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  background: var(--at-coral-tint);
  border-radius: var(--at-r-sm);
  min-height: 52px;
}
.linked-kh-row .av {
  width: 40px; height: 40px; border-radius: 50%;
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 500; flex-shrink: 0;
  overflow: hidden;
}
.linked-kh-row .av img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
  display: block;
}
.linked-kh-row .linked-info {
  display: flex; flex-direction: column; gap: 1px;
  flex: 1; min-width: 0;
  color: var(--at-coral-text);
}
.linked-kh-row .name {
  font-weight: 500; font-size: 14px; color: var(--at-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.25;
}
.linked-kh-row .phone-row {
  font-size: 12px; color: var(--at-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.25;
}
.linked-kh-row .phone-row.muted { font-style: italic; }
.linked-kh-row .remove {
  width: 24px; height: 24px; border-radius: 50%;
  background: rgba(0, 0, 0, 0.08); border: none; cursor: pointer;
  font-size: 11px; color: inherit; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}

/* Sale dropdown */
.sale-select {
  width: 100%; height: 40px; padding: 0 var(--at-s-md);
  border: 1px solid var(--at-hairline); border-radius: var(--at-r-sm);
  font-family: inherit; font-size: 13.5px; color: var(--at-ink);
  background: var(--at-canvas); outline: none;
  cursor: pointer;
}
.sale-select:focus { border-color: var(--at-ink); }

.link-kh-btn {
  align-self: flex-start;
  font-size: 12px; color: var(--at-link); cursor: pointer;
  background: transparent; border: 1px dashed var(--at-hairline);
  border-radius: var(--at-r-sm); padding: 5px 10px;
  font-family: inherit;
}
.link-kh-btn:active { background: var(--at-surface-soft); }

/* KH autocomplete */
.cust-suggest {
  background: var(--at-canvas); border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md); padding: var(--at-s-xs);
  max-height: 260px; overflow-y: auto;
}
.cust-suggest-head {
  font-size: 11.5px; color: var(--at-muted);
  padding: var(--at-s-xs); margin-bottom: 4px;
}
.cust-suggest-head .opt { color: var(--at-ink); font-weight: 500; margin-left: 4px; }
.cust-suggest-search {
  width: 100%; padding: 8px 12px;
  background: var(--at-surface-soft); border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-sm); font-size: 13px; font-family: inherit;
  outline: none; margin-bottom: var(--at-s-xs);
}
.cust-suggest-search:focus { border-color: var(--at-ink); }
.cust-loading, .cust-empty {
  padding: 10px; font-size: 12.5px; color: var(--at-muted);
  text-align: center;
}
.cust-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: var(--at-r-sm); cursor: pointer;
  font-size: 13px;
}
.cust-item:active { background: var(--at-surface-soft); }
.cust-item .av {
  width: 28px; height: 28px; border-radius: 50%;
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 500; flex-shrink: 0;
  overflow: hidden;
}
.cust-item .av img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
  display: block;
}
.cust-item .name { font-weight: 500; color: var(--at-ink); }
.cust-item .meta { font-size: 11.5px; color: var(--at-muted); }
.cust-info-1line {
  display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;
  font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cust-info-1line .name { font-weight: 500; color: var(--at-ink); }
.cust-info-1line .sep { color: var(--at-muted); }
.cust-info-1line .phone { color: var(--at-body); font-variant-numeric: tabular-nums; }
.cust-info-1line .nick { color: var(--at-muted); font-style: italic; font-size: 12px; }
.cust-item.skip {
  margin-top: 4px; padding-top: 8px;
  border-top: 1px solid var(--at-hairline);
  color: var(--at-muted); font-style: italic;
}

/* Picker display button */
.picker-display {
  width: 100%; height: 44px; padding: 0 var(--at-s-md);
  border: 1px solid var(--at-hairline); border-radius: var(--at-r-sm);
  background: var(--at-canvas);
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 14px; color: var(--at-ink); cursor: pointer;
  font-family: inherit;
}
.picker-display:active { background: var(--at-surface-soft); }
.picker-display .ic { color: var(--at-muted); }
.picker-display .val { font-weight: 500; flex: 1; text-align: left; }
.picker-display .caret { color: var(--at-muted); font-size: 10px; }

/* Picker popups — TELEPORTED ra ngoài modal, position fixed.
   Modal KHÔNG bị expand khi popup mở. Popup overlay đè modal. */
.picker-popup {
  z-index: 110; /* > modal z-index (100) */
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline); border-radius: var(--at-r-lg);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22);
  padding: var(--at-s-sm);
}

/* Date picker grid — shrinked (300px container) */
.dp-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 4px;
}
.dp-head .month { font-size: 13px; font-weight: 500; color: var(--at-ink); }
.dp-head button {
  width: 26px; height: 26px; border-radius: var(--at-r-sm);
  background: transparent; border: none; cursor: pointer;
  color: var(--at-body); font-size: 13px;
  display: inline-flex; align-items: center; justify-content: center;
}
.dp-head button:active { background: var(--at-surface-soft); }
.dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
.dp-wd {
  font-size: 10px; color: var(--at-muted); text-align: center;
  padding: 4px 0; font-weight: 500;
}
.dp-day {
  height: 32px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--at-body); border-radius: var(--at-r-sm);
  cursor: pointer;
}
.dp-day:active { background: var(--at-surface-soft); }
.dp-day.muted { color: var(--at-muted); opacity: 0.4; }
.dp-day.today { background: var(--at-ink); color: var(--at-on-primary); font-weight: 500; }
/* Selected nhưng KHÔNG phải today: bg coral đậm để dễ thấy */
.dp-day.selected:not(.today) {
  background: var(--at-coral); color: var(--at-on-primary); font-weight: 500;
}
.dp-tip-divider {
  height: 1px; background: var(--at-hairline);
  margin: var(--at-s-sm) calc(-1 * var(--at-s-sm));
}
/* Tip chips: 2-col × 4-row (8 chips). 4-col bị tràn label "+10 ngày"/"+1 tháng"
   → đổi 2-col cho mỗi chip rộng ~135px, đọc thoải mái. */
.dp-tips {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.dp-tip {
  font-size: 11.5px;
  padding: 5px 10px;
  height: 28px;
  justify-content: center;
}

/* Time picker wheels — compact để fit trong field 240-260px */
.tp-wheels {
  display: flex; align-items: center; justify-content: center; gap: var(--at-s-sm);
  height: 160px; position: relative;
  background: var(--at-surface-soft);
  border-radius: var(--at-r-md);
  overflow: hidden;
}
.tp-wheels::before, .tp-wheels::after {
  content: ''; position: absolute; left: 8%; right: 8%;
  height: 1px; background: var(--at-border-strong);
  pointer-events: none; z-index: 2;
}
.tp-wheels::before { top: 64px; }
.tp-wheels::after { top: 96px; }
.tp-fade { position: absolute; left: 0; right: 0; pointer-events: none; z-index: 3; }
.tp-fade--top { top: 0; height: 64px; background: linear-gradient(to bottom, var(--at-surface-soft) 0%, rgba(248, 250, 252, 0) 100%); }
.tp-fade--bot { bottom: 0; height: 64px; background: linear-gradient(to top, var(--at-surface-soft) 0%, rgba(248, 250, 252, 0) 100%); }
.tp-wheel {
  width: 60px; height: 160px; overflow: hidden;
  display: flex; flex-direction: column;
  position: relative; z-index: 1;
}
.tp-wheel-items {
  display: flex; flex-direction: column; align-items: center;
  transition: transform 0.25s ease;
}
.tp-wheel-item {
  height: 32px; display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 400; color: var(--at-muted);
  font-variant-numeric: tabular-nums;
  width: 100%; cursor: pointer;
  flex-shrink: 0;
}
.tp-wheel-item.selected {
  color: var(--at-ink); font-weight: 500; font-size: 20px;
}
.tp-separator { font-size: 20px; font-weight: 500; color: var(--at-ink); z-index: 4; }
/* 4 chips 2x2 grid */
.tp-quick-grid {
  margin-top: var(--at-s-md);
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
}
.tp-quick-grid .tip-chip { justify-content: center; }
.tp-helper {
  margin-top: 8px; text-align: center;
  font-size: 11px; color: var(--at-muted);
}

/* Popup footer (Xác nhận button) */
.popup-foot {
  display: flex; justify-content: flex-end;
  margin-top: var(--at-s-sm);
  padding-top: var(--at-s-sm);
  border-top: 1px solid var(--at-hairline);
}
.popup-confirm { padding: 6px 14px; font-size: 12.5px; }

/* picker-display active state khi popup open */
.picker-display.open { border-color: var(--at-ink); }

/* Chips */
.tip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.tip-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; background: var(--at-canvas);
  border: 1px solid var(--at-hairline); border-radius: var(--at-r-pill);
  font-size: 12.5px; font-weight: 500; color: var(--at-body);
  cursor: pointer; font-family: inherit; white-space: nowrap;
}
.tip-chip:active { background: var(--at-surface-soft); }
.tip-chip.active {
  background: var(--at-ink); color: var(--at-on-primary); border-color: var(--at-ink);
}
.tip-chip.smart {
  background: var(--at-cream); border-color: var(--at-mustard); color: var(--at-ink);
}

/* Duration — small tag chips trên 1 dòng (scroll-x nếu overflow) */
.duration-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--at-s-xs);
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.duration-end {
  font-size: 11.5px; color: var(--at-muted);
}
.duration-end b { color: var(--at-ink); font-weight: 500; }
.duration-end em { color: var(--at-muted); font-style: italic; font-size: 11px; }
.duration-row {
  display: flex; gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
  padding-bottom: 2px; /* room cho scrollbar */
}
.duration-row::-webkit-scrollbar { height: 4px; }
.duration-row::-webkit-scrollbar-thumb { background: var(--at-hairline); border-radius: 2px; }

/* Duration tag — border-radius mềm md (10) thay pill, nhìn ít tròn hơn */
.tag-chip {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 4px 10px;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  font-size: 11.5px; font-weight: 500; color: var(--at-body);
  cursor: pointer; font-family: inherit;
  white-space: nowrap; flex-shrink: 0;
  height: 26px;
}
.tag-chip:active { background: var(--at-surface-soft); }
.tag-chip.active {
  background: var(--at-ink); color: var(--at-on-primary); border-color: var(--at-ink);
}

/* End label bôi đậm số giờ + ngày */
.end-bold {
  color: var(--at-ink);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Type chips — 4 chips 1 dòng grid 4-col, narrower 10% */
.type-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}
.type-chip {
  min-width: 0;
  padding: 8px 8px; border-radius: var(--at-r-md);
  border: 1px solid var(--at-hairline);
  display: flex; align-items: center; gap: 6px;
  background: var(--at-canvas); cursor: pointer;
  font-size: 12.5px; font-weight: 500; color: var(--at-body);
  font-family: inherit;
  white-space: nowrap; overflow: hidden;
}
.type-chip:active { background: var(--at-surface-soft); }
.type-chip.active {
  border-color: var(--at-ink); background: var(--at-ink); color: var(--at-on-primary);
}
.type-chip .type-ico {
  width: 24px; height: 24px; border-radius: var(--at-r-sm);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; flex-shrink: 0;
}
.type-chip[data-t="call"]      .type-ico { background: #fdf0e3; color: #7a4115; }
.type-chip[data-t="message"]   .type-ico { background: #e8f4ee; color: #1f4d39; }
.type-chip[data-t="meeting"]   .type-ico { background: #fbe6dc; color: #7a2000; }
.type-chip[data-t="follow_up"] .type-ico { background: #fdf3df; color: #7a5818; }

/* Location input wrap — icon prefix giống title */
.location-input-wrap {
  display: flex; align-items: center;
  width: 100%; height: 44px; padding: 0 var(--at-s-md);
  border: 1px solid var(--at-hairline); border-radius: var(--at-r-sm);
  background: var(--at-canvas); gap: 8px;
}
.location-input-wrap:focus-within { border-color: var(--at-ink); }
.location-input-wrap .ic { font-size: 16px; flex-shrink: 0; }
.location-input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 14px; color: var(--at-ink);
}
.location-input::placeholder { color: var(--at-muted); font-weight: 500; }

/* Location chips 6 cols 1 dòng — border-radius nhỏ 10px (md) */
.location-tip-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  margin-top: 4px;
}
.loc-chip {
  display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  padding: 5px 6px;
  height: 28px;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  font-size: 11px; font-weight: 500; color: var(--at-body);
  cursor: pointer; font-family: inherit;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0;
}
.loc-chip:active:not(:disabled) { background: var(--at-surface-soft); }
.loc-chip.smart {
  background: var(--at-cream); border-color: var(--at-mustard); color: var(--at-ink);
}
.loc-chip.disabled {
  opacity: 0.5; cursor: not-allowed; background: var(--at-surface-soft);
}

/* Notes textarea */
.notes-area {
  width: 100%; min-height: 56px; max-height: 120px;
  padding: 10px var(--at-s-md);
  border: 1px solid var(--at-hairline); border-radius: var(--at-r-sm);
  font-family: inherit; font-size: 13.5px; color: var(--at-ink);
  background: var(--at-canvas); outline: none; resize: vertical;
}
.notes-area:focus { border-color: var(--at-ink); }
.notes-area::placeholder { color: var(--at-muted); font-style: italic; }

/* Buttons */
.at-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 18px; border-radius: var(--at-r-lg);
  font-size: 13.5px; font-weight: 500; cursor: pointer;
  font-family: inherit; white-space: nowrap; border: none;
}
.at-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.at-btn--primary { background: var(--at-ink); color: var(--at-on-primary); }
.at-btn--primary:active:not(:disabled) { background: var(--at-primary-active); }
.at-btn--secondary {
  background: var(--at-canvas); color: var(--at-ink);
  border: 1px solid var(--at-hairline);
}
.at-btn--secondary:active { background: var(--at-surface-soft); }

/* Error banner */
.error-banner {
  padding: 8px 12px;
  background: var(--at-coral-tint); color: var(--at-coral-text);
  border-radius: var(--at-r-sm);
  font-size: 12.5px;
}

/* ─── Mobile ─── */
@media (max-width: 600px) {
  .editor-backdrop { padding: 0; }
  .editor {
    width: 100%; max-width: 100%; max-height: 100vh;
    height: 100vh; border-radius: 0;
  }
  .editor-body { padding: var(--at-s-sm) var(--at-s-md); }
  .editor-foot { padding: var(--at-s-sm) var(--at-s-md); flex-direction: column-reverse; gap: var(--at-s-xs); }
  .editor-foot .tip { display: none; }
  .editor-foot .actions { width: 100%; }
  .editor-foot .actions .at-btn { flex: 1; }
  .row-2 { grid-template-columns: 1fr 1fr; gap: 8px; }
  .type-row { display: grid; grid-template-columns: repeat(2, 1fr); }
  .type-chip { min-width: 0; }
  .duration-grid { grid-template-columns: repeat(3, 1fr); }
  .picker-popup { width: 100%; }
}

/* ═══ HS Holding theme polish (anh chốt 2026-06-16) ═══════════════════════════
   Đổi accent từ --at-ink (đen trung tính) → brand teal-blue HS; hàng KH liên kết
   từ coral (đỏ) → brand-soft. --brand* là token global (hs-crm-theme.css). Đặt
   CUỐI block để thắng cascade (cùng specificity → rule sau thắng). */
.editor { border-top: 3px solid var(--brand, #1786be); }
.editor-head { background: linear-gradient(180deg, var(--brand-softer, #f2f8fc), var(--at-canvas, #fff)); }
.editor-head h2 { color: var(--brand-700, #0b5880); font-weight: 700; display: flex; align-items: center; gap: 7px; }
.editor-head h2 .head-ic { color: var(--brand, #1786be); }

/* Icon MDI inline (thay emoji) — căn giữa theo dòng chữ, kế thừa màu chữ */
.editor :deep(.v-icon),
.picker-popup :deep(.v-icon) { vertical-align: middle; }

/* Hàng KH liên kết: coral → brand-soft, chữ về ink bình thường */
.linked-kh-row { background: var(--brand-soft, #e4f1f8); }
.linked-kh-row .linked-info { color: var(--at-ink, #1f2d3d); }
.link-kh-btn { color: var(--brand-700, #0b5880); }
.link-kh-btn:hover { background: var(--brand-softer, #f2f8fc); border-color: var(--brand, #1786be); }

/* Focus → viền + glow brand */
.title-input-wrap:focus-within,
.location-input-wrap:focus-within,
.sale-select:focus,
.cust-suggest-search:focus,
.notes-area:focus,
.picker-display.open { border-color: var(--brand, #1786be); box-shadow: 0 0 0 3px var(--brand-soft, #e4f1f8); }

/* Chips đang chọn → brand */
.type-chip.active,
.tag-chip.active,
.tip-chip.active,
.loc-chip.active { background: var(--brand-soft, #e4f1f8); border-color: var(--brand, #1786be); color: var(--brand-700, #0b5880); }

/* Ngày/giờ đang chọn → brand */
.dp-day.today { background: var(--brand, #1786be); color: #fff; }
.dp-day.selected:not(.today) { background: var(--brand-soft, #e4f1f8); color: var(--brand-700, #0b5880); border-color: var(--brand, #1786be); }
.tp-wheel-item.selected { color: var(--brand-700, #0b5880); }

/* Nút primary (Tạo/Cập nhật + Xác nhận popup) → brand */
.at-btn--primary { background: var(--brand, #1786be); color: #fff; }
.at-btn--primary:hover:not(:disabled) { background: var(--brand-600, #0f6fa0); }
.at-btn--primary:active:not(:disabled) { background: var(--brand-700, #0b5880); }
</style>
