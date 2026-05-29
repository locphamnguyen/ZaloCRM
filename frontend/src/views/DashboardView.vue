<template>
  <div class="dh-wrap">
    <!--
      ATTRIBUTION BANNER — Required by Apache License 2.0 NOTICE clause §4(d).
      Source data is obfuscated in src/composables/use-attribution.ts; see that
      file + the NOTICE file at the repository root before modifying.
      Removing this element is a license violation unless you hold a commercial
      license from the maintainer (locnt@locnguyendata.com).
    -->
    <a
      v-if="attribution.enabled.value"
      class="contact-marquee dashboard-marquee"
      :href="attribution.href"
      target="_blank"
      rel="noopener"
      :title="attribution.text"
    >
      <span class="marquee-track">
        {{ attribution.text }}&nbsp;•&nbsp;{{ attribution.text }}&nbsp;•&nbsp;
      </span>
    </a>

    <!-- Sticky scroll-nav theo role -->
    <div class="dh-scrollnav" v-if="hub.hasTeamSection.value || hub.hasSystemSection.value">
      <a href="#dh-sec-me" class="dh-crumb" :class="{ active: activeSection === 'me' }">🎯 Việc của tôi</a>
      <span class="dh-sep" v-if="hub.hasTeamSection.value">›</span>
      <a v-if="hub.hasTeamSection.value" href="#dh-sec-team" class="dh-crumb" :class="{ active: activeSection === 'team' }">👥 Quản lý team</a>
      <span class="dh-sep" v-if="hub.hasSystemSection.value">›</span>
      <a v-if="hub.hasSystemSection.value" href="#dh-sec-system" class="dh-crumb" :class="{ active: activeSection === 'system' }">🛡️ Quản lý hệ thống</a>
      <span class="dh-sn-hint">Cuộn xuống để xem section tiếp →</span>
    </div>

    <!-- ━━━━━━━━━━ SECTION 1 — VIỆC CỦA TÔI ━━━━━━━━━━ -->
    <section id="dh-sec-me" class="dh-section">
      <div class="dh-strip first">
        <div class="dh-strip-icon self">🎯</div>
        <div class="dh-strip-text">
          <div class="dh-strip-title">
            Việc của tôi
            <!-- Picker scope chip -->
            <span
              class="dh-scope self"
              :class="{ locked: !hub.hasTeamSection.value && !hub.hasSystemSection.value }"
              @click="canPickUser && (userPickerOpen = !userPickerOpen)"
            >
              👤 {{ currentViewedUserName }}
              <span v-if="canPickUser" class="dh-caret">▾</span>
              <span v-else class="dh-lock-ico">🔒</span>

              <!-- Picker dropdown -->
              <div v-if="userPickerOpen" class="dh-picker-dd" @click.stop>
                <input
                  v-model="userPickerSearch"
                  class="dh-pdd-search"
                  placeholder="🔍 Tìm nhân viên..."
                  @click.stop
                >
                <div class="dh-pdd-group">CỦA TÔI</div>
                <div
                  class="dh-pdd-item"
                  :class="{ active: hub.viewAsUserId.value === null }"
                  @click="selectUser(null)"
                >
                  👤 {{ auth.user?.fullName }} (tôi)
                </div>
                <template v-if="filteredPickerUsers.length > 0">
                  <div class="dh-pdd-group">CẤP DƯỚI ({{ filteredPickerUsers.length }})</div>
                  <div
                    v-for="u in filteredPickerUsers"
                    :key="u.id"
                    class="dh-pdd-item"
                    :class="{ active: hub.viewAsUserId.value === u.id }"
                    @click="selectUser(u.id)"
                  >
                    👤 {{ u.fullName }}
                    <span class="dh-pdd-meta">{{ u.departmentName ?? '' }}</span>
                  </div>
                </template>
              </div>
            </span>
          </div>
          <div class="dh-strip-sub" v-if="hub.me.value">
            <span v-if="hub.me.value.isViewingSelf">
              Chào sáng <strong>{{ firstName(auth.user?.fullName) }}</strong> — bạn có
              <strong class="dh-danger">{{ totalUrgent }}</strong> việc cần làm
            </span>
            <span v-else>
              Đang xem dashboard của <strong>{{ currentViewedUserName }}</strong> (view-as cấp dưới)
            </span>
          </div>
        </div>
        <div class="dh-strip-actions">
          <button class="dh-btn primary" @click="goToInbox">💬 Vào Tin nhắn</button>
        </div>
      </div>

      <!-- KPI 5 cards (split khi có nick riêng tư) -->
      <div class="dh-kpis" v-if="hub.me.value">
        <KpiCard
          label="📥 Chưa rep"
          :split="hub.me.value.kpi.unreplied"
          :danger="totalUnreplied > 5"
          :warn="totalUnreplied > 0"
          @click="goToInbox"
        />
        <KpiCard
          label="📅 Hẹn hôm nay"
          :split="hub.me.value.kpi.todayAppointments"
          :warn="totalAppts > 0"
          @click="goToAppts"
        />
        <KpiCard
          label="🎯 KH của tôi"
          :value="hub.me.value.kpi.totalContacts"
          @click="goToContacts"
        />
        <KpiCard
          label="💤 KH đình trệ"
          :split="hub.me.value.kpi.dormantContacts"
          :warn="totalDormant > 0"
        />
        <KpiCard
          label="✅ Chốt tháng"
          :value="hub.me.value.kpi.closedThisMonth"
        />
      </div>

      <!-- Grid 2-col -->
      <div class="dh-grid2" v-if="hub.me.value">
        <div class="dh-col">
          <!-- Urgent list -->
          <div class="dh-card">
            <div class="dh-card-head">
              <div class="dh-card-title">🔥 Cần rep gấp <span class="dh-badge danger">{{ hub.me.value.urgent.length }}</span></div>
              <a class="dh-link" @click="goToInbox">Inbox cá nhân →</a>
            </div>
            <div class="dh-card-body" v-if="hub.me.value.urgent.length > 0">
              <div
                v-for="u in hub.me.value.urgent"
                :key="u.conversationId"
                class="dh-item"
                @click="goToConv(u.conversationId)"
              >
                <div class="dh-item-av">{{ initials(u.contactName) }}</div>
                <div class="dh-item-body">
                  <div class="dh-item-name">{{ u.contactName }}</div>
                  <div class="dh-item-meta">{{ u.unreadCount }} tin · {{ u.nickName }}</div>
                </div>
                <div class="dh-item-time">{{ ago(u.lastMessageAt) }}</div>
              </div>
            </div>
            <div v-else class="dh-empty">🎉 Không có tin nào chưa rep</div>
          </div>

          <!-- Today appointments -->
          <div class="dh-card">
            <div class="dh-card-head">
              <div class="dh-card-title">📅 Lịch hẹn hôm nay <span class="dh-badge warn">{{ hub.me.value.appointments.length }}</span></div>
              <a class="dh-link" @click="goToAppts">Xem tuần →</a>
            </div>
            <div class="dh-card-body" v-if="hub.me.value.appointments.length > 0">
              <div
                v-for="a in hub.me.value.appointments"
                :key="a.id"
                class="dh-item"
              >
                <div class="dh-item-av appt">{{ apptTime(a.appointmentDate) }}</div>
                <div class="dh-item-body">
                  <div class="dh-item-name">{{ a.title ?? `Gặp ${a.contactName ?? 'KH'}` }}</div>
                  <div class="dh-item-meta">{{ a.location ?? 'Chưa có địa điểm' }}</div>
                </div>
                <div class="dh-item-time">{{ a.appointmentTime ?? apptTime(a.appointmentDate) }}</div>
              </div>
            </div>
            <div v-else class="dh-empty">Không có hẹn hôm nay</div>
          </div>
        </div>

        <!-- Right col -->
        <div class="dh-col-right">
          <!-- Quota nick -->
          <div class="dh-card">
            <div class="dh-card-head">
              <div class="dh-card-title">🔋 Quota nick hôm nay</div>
            </div>
            <div class="dh-card-body">
              <div
                v-for="n in hub.me.value.quotaNicks"
                :key="n.id"
                class="dh-quota-row"
              >
                <div class="dh-quota-name" :class="{ locked: n.isPrivate }">
                  {{ n.displayName }}
                </div>
                <div class="dh-quota-bar">
                  <div
                    class="dh-quota-fill"
                    :class="{ locked: n.isPrivate, warn: pct(n.messagesToday, 300) > 70, danger: pct(n.messagesToday, 300) > 90 }"
                    :style="{ width: n.isPrivate ? '100%' : pct(n.messagesToday, 300) + '%' }"
                  ></div>
                </div>
                <div class="dh-quota-val">
                  <span v-if="n.isPrivate">—</span>
                  <span v-else>{{ n.messagesToday }}/300</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="hub.loadingMe.value" class="dh-loading">Đang tải…</div>
    </section>

    <!-- ━━━━━━━━━━ SECTION 2 — QUẢN LÝ TEAM ━━━━━━━━━━ -->
    <section
      id="dh-sec-team"
      class="dh-section"
      v-if="hub.hasTeamSection.value && hub.team.value"
    >
      <div class="dh-strip team">
        <div class="dh-strip-icon team">👥</div>
        <div class="dh-strip-text">
          <div class="dh-strip-title">
            Quản lý team
            <span
              class="dh-scope team"
              @click="deptPickerOpen = !deptPickerOpen"
            >
              👥 {{ deptPickerLabel }}
              <span class="dh-caret">▾</span>

              <div v-if="deptPickerOpen" class="dh-picker-dd" @click.stop>
                <input
                  v-model="deptPickerSearch"
                  class="dh-pdd-search"
                  placeholder="🔍 Lọc PKD..."
                  @click.stop
                >
                <div class="dh-pdd-group">CHỌN PKD ({{ multiDept ? 'MULTI' : 'SINGLE' }})</div>
                <div
                  v-for="d in filteredPickerDepts"
                  :key="d.id"
                  class="dh-pdd-item"
                  :class="{ active: tempSelectedDepts.includes(d.id) }"
                  @click="toggleDept(d.id)"
                >
                  <div class="dh-pdd-check" :class="{ on: tempSelectedDepts.includes(d.id) }">
                    {{ tempSelectedDepts.includes(d.id) ? '✓' : '' }}
                  </div>
                  {{ d.name }} ({{ d.memberCount }} NV)
                </div>
                <div class="dh-pdd-actions">
                  <button class="dh-btn" @click="cancelDeptPicker">Huỷ</button>
                  <button class="dh-btn primary" @click="applyDeptPicker">Áp dụng</button>
                </div>
              </div>
            </span>
          </div>
          <div class="dh-strip-sub">
            Tổng cộng <strong class="dh-danger">{{ hub.team.value.teamKpi.unreplied.public + hub.team.value.teamKpi.unreplied.private }} việc tồn đọng</strong>
            · <strong class="dh-success">{{ hub.team.value.teamKpi.closedThisWeek }} chốt tuần</strong>
            · Click NV để xem dashboard cá nhân
          </div>
        </div>
      </div>

      <!-- Privacy banner -->
      <div class="dh-priv-banner">
        <span class="dh-priv-ico">🔒</span>
        <div>
          <strong>Privacy v2:</strong> Cột "Chưa rep / Hẹn" hiển thị <strong>{{ '{public}' }} +🔒{{ '{private}' }}</strong>.
          Nick riêng tư là cam kết với NV — không có cơ chế emergency unlock.
        </div>
      </div>

      <!-- KPI team -->
      <div class="dh-kpis">
        <KpiCard
          label="📥 Tồn đọng team"
          :split="hub.team.value.teamKpi.unreplied"
          :danger="hub.team.value.teamKpi.unreplied.public > 10"
        />
        <KpiCard
          label="📅 Hẹn team"
          :split="hub.team.value.teamKpi.todayAppointments"
        />
        <KpiCard
          label="🎯 Tổng KH"
          :value="hub.team.value.teamKpi.totalContacts"
        />
        <KpiCard
          label="✅ Chốt tuần"
          :value="hub.team.value.teamKpi.closedThisWeek"
        />
        <KpiCard
          v-if="hub.team.value.topUser"
          :label="'⭐ Top: ' + (hub.team.value.topUser.fullName || '')"
          :value="hub.team.value.topUser.closedThisWeek"
        />
      </div>

      <!-- Team table -->
      <div class="dh-card">
        <div class="dh-card-head">
          <div class="dh-card-title">👥 Đội ngũ ({{ hub.team.value.perUser.length }} NV)</div>
        </div>
        <div class="dh-card-body" style="padding: 0;">
          <table class="dh-team-tbl">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th class="num">Chưa rep</th>
                <th class="num">Hẹn</th>
                <th class="num">KH</th>
                <th class="num">Chốt tuần</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in hub.team.value.perUser" :key="u.userId">
                <td>
                  <div class="dh-team-name">
                    <div class="dh-team-av">{{ initials(u.fullName) }}</div>
                    {{ u.fullName }}
                    <span v-if="u.hasPrivateNick" class="dh-tag lock">🔒 {{ u.privateNickCount }} nick</span>
                    <span v-if="u.deptRole === 'leader'" class="dh-tag">TP</span>
                  </div>
                </td>
                <td class="num">
                  <span>{{ u.unreplied.public }}</span>
                  <span v-if="u.unreplied.private > 0" class="dh-locksplit">🔒{{ u.unreplied.private }}</span>
                </td>
                <td class="num">
                  <span>{{ u.todayAppointments.public }}</span>
                  <span v-if="u.todayAppointments.private > 0" class="dh-locksplit">🔒{{ u.todayAppointments.private }}</span>
                </td>
                <td class="num">{{ u.totalContacts }}</td>
                <td class="num">{{ u.closedThisWeek }}</td>
                <td>
                  <button class="dh-btn-mini" @click="selectUser(u.userId)">Xem dashboard →</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ━━━━━━━━━━ SECTION 3 — QUẢN LÝ HỆ THỐNG (ADMIN ONLY) ━━━━━━━━━━ -->
    <section
      id="dh-sec-system"
      class="dh-section"
      v-if="hub.hasSystemSection.value && hub.system.value"
    >
      <div class="dh-strip system">
        <div class="dh-strip-icon system">🛡️</div>
        <div class="dh-strip-text">
          <div class="dh-strip-title">
            Quản lý hệ thống
            <span class="dh-scope system locked">🛡️ Toàn tổ chức 🔒</span>
          </div>
          <div class="dh-strip-sub">
            <strong>CHỈ ADMIN</strong> ·
            {{ hub.system.value.orgKpi.totalNicks }} nick ·
            {{ hub.system.value.orgKpi.totalContacts.toLocaleString('vi') }} KH ·
            <strong class="dh-success">{{ hub.system.value.orgKpi.newLeadsThisMonth }} lead mới T5</strong>
          </div>
        </div>
      </div>

      <!-- Audit bar (impersonate actions) -->
      <div class="dh-audit-bar" v-if="hub.system.value.recentAudit.length > 0">
        <span class="dh-audit-ico">📋</span>
        <span>
          <strong>Audit log gần nhất:</strong>
          {{ ago(hub.system.value.recentAudit[0].createdAt) }}
          <strong>{{ hub.system.value.recentAudit[0].actorName }}</strong>
          {{ hub.system.value.recentAudit[0].action }}
          · <a class="dh-audit-link">Xem {{ hub.system.value.orgKpi.auditCountToday }} hành động hôm nay →</a>
        </span>
      </div>

      <!-- KPI system -->
      <div class="dh-kpis">
        <KpiCard
          label="🆕 Lead mới T5"
          :value="hub.system.value.orgKpi.newLeadsThisMonth"
        />
        <KpiCard
          label="📋 Tổng KH"
          :value="hub.system.value.orgKpi.totalContacts"
        />
        <KpiCard
          label="🟢 Nick khoẻ"
          :value="hub.system.value.orgKpi.nickHealth.healthy"
        />
        <KpiCard
          label="🔴 Nick lỗi"
          :value="hub.system.value.orgKpi.nickHealth.banned + hub.system.value.orgKpi.nickHealth.offline"
          :danger="(hub.system.value.orgKpi.nickHealth.banned + hub.system.value.orgKpi.nickHealth.offline) > 0"
        />
        <KpiCard
          label="🔒 Nick riêng tư"
          :value="hub.system.value.orgKpi.nickHealth.private"
          :warn="true"
        />
      </div>

      <!-- Dept ranking -->
      <div class="dh-card">
        <div class="dh-card-head">
          <div class="dh-card-title">🏆 Hiệu suất PKD (tháng 5)</div>
        </div>
        <div class="dh-card-body" style="padding: 0;">
          <table class="dh-team-tbl">
            <thead>
              <tr>
                <th>PKD</th>
                <th class="num">NV</th>
                <th class="num">Lead mới</th>
                <th class="num">Chốt</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in hub.system.value.deptRanking" :key="d.departmentId">
                <td>
                  <div class="dh-team-name">
                    <div class="dh-team-av dept">{{ initials(d.departmentName) }}</div>
                    {{ d.departmentName }}
                  </div>
                </td>
                <td class="num">{{ d.memberCount }}</td>
                <td class="num">{{ d.newLeadsThisMonth }}</td>
                <td class="num"><strong>{{ d.closedThisMonth }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h, type Component } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { useDashboardActionHub, type PrivacySplit } from '@/composables/use-dashboard-action-hub';
import { useAttribution } from '@/composables/use-attribution';

const attribution = useAttribution();
const auth = useAuthStore();
const router = useRouter();
const hub = useDashboardActionHub();

// Picker state
const userPickerOpen = ref(false);
const userPickerSearch = ref('');
const deptPickerOpen = ref(false);
const deptPickerSearch = ref('');
const tempSelectedDepts = ref<string[]>([]);
const activeSection = ref<'me' | 'team' | 'system'>('me');

const multiDept = computed(() => hub.pickerCanViewAll.value);

const canPickUser = computed(() => hub.hasTeamSection.value || hub.hasSystemSection.value);

const currentViewedUserName = computed(() => {
  if (!hub.viewAsUserId.value) return `Tôi (${auth.user?.fullName ?? ''})`;
  const target = hub.pickerUsers.value.find((u) => u.id === hub.viewAsUserId.value);
  return target?.fullName ?? 'Khác';
});

const filteredPickerUsers = computed(() => {
  const q = userPickerSearch.value.trim().toLowerCase();
  return hub.pickerUsers.value
    .filter((u) => !u.isSelf)
    .filter((u) => !q || u.fullName.toLowerCase().includes(q));
});

const filteredPickerDepts = computed(() => {
  const q = deptPickerSearch.value.trim().toLowerCase();
  return hub.pickerDepts.value.filter((d) => !q || d.name.toLowerCase().includes(q));
});

const deptPickerLabel = computed(() => {
  if (hub.selectedDeptIds.value.length === 0) return `Tất cả (${hub.pickerDepts.value.length} PKD)`;
  if (hub.selectedDeptIds.value.length === 1) {
    const d = hub.pickerDepts.value.find((x) => x.id === hub.selectedDeptIds.value[0]);
    return d?.name ?? '1 PKD';
  }
  return `${hub.selectedDeptIds.value.length} PKD`;
});

const totalUrgent = computed(() => {
  if (!hub.me.value) return 0;
  return hub.me.value.urgent.length + hub.me.value.appointments.length;
});
const totalUnreplied = computed(() => {
  if (!hub.me.value) return 0;
  return hub.me.value.kpi.unreplied.public + hub.me.value.kpi.unreplied.private;
});
const totalAppts = computed(() => {
  if (!hub.me.value) return 0;
  return hub.me.value.kpi.todayAppointments.public + hub.me.value.kpi.todayAppointments.private;
});
const totalDormant = computed(() => {
  if (!hub.me.value) return 0;
  return hub.me.value.kpi.dormantContacts.public + hub.me.value.kpi.dormantContacts.private;
});

// ── Picker actions ─────────────────────────────────────────────────────
async function selectUser(userId: string | null) {
  userPickerOpen.value = false;
  await hub.fetchMe(userId);
}

function toggleDept(id: string) {
  if (multiDept.value) {
    const idx = tempSelectedDepts.value.indexOf(id);
    if (idx >= 0) tempSelectedDepts.value.splice(idx, 1);
    else tempSelectedDepts.value.push(id);
  } else {
    tempSelectedDepts.value = [id];
  }
}
function cancelDeptPicker() {
  deptPickerOpen.value = false;
  tempSelectedDepts.value = [...hub.selectedDeptIds.value];
}
async function applyDeptPicker() {
  deptPickerOpen.value = false;
  await hub.fetchTeam(tempSelectedDepts.value);
}

// ── Navigation ─────────────────────────────────────────────────────────
function goToInbox() { router.push('/chat'); }
function goToAppts() { router.push('/appointments'); }
function goToContacts() { router.push('/contacts'); }
function goToConv(id: string) { router.push(`/chat?conv=${id}`); }

// ── Format helpers ─────────────────────────────────────────────────────
function firstName(full?: string | null): string {
  if (!full) return 'bạn';
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1];
}
function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'vừa xong';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'p';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'g';
  return Math.floor(ms / 86400000) + 'ngày';
}
function apptTime(iso: string): string {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0');
}
function pct(num: number | null, max: number): number {
  if (num === null || max === 0) return 0;
  return Math.min(100, Math.round((num / max) * 100));
}

// ── KpiCard inline component ───────────────────────────────────────────
const KpiCard: Component = {
  props: {
    label: { type: String, required: true },
    value: { type: Number, default: null },
    split: { type: Object as () => PrivacySplit | null, default: null },
    danger: { type: Boolean, default: false },
    warn: { type: Boolean, default: false },
  },
  emits: ['click'],
  setup(props, { emit }) {
    return () => h(
      'div',
      {
        class: ['dh-kpi', { danger: props.danger, warn: props.warn && !props.danger }],
        onClick: () => emit('click'),
      },
      [
        h('div', { class: 'dh-kpi-label' }, props.label),
        h('div', { class: 'dh-kpi-val' }, [
          props.split !== null
            ? [
                h('span', String(props.split.public)),
                props.split.private > 0
                  ? h('span', { class: 'dh-kpi-split' }, `+🔒${props.split.private}`)
                  : null,
              ]
            : h('span', String(props.value)),
        ]),
      ],
    );
  },
};

// ── Mount ──────────────────────────────────────────────────────────────
onMounted(async () => {
  await hub.fetchAll();
  tempSelectedDepts.value = [...hub.selectedDeptIds.value];

  // Close picker on outside click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.dh-scope')) {
      userPickerOpen.value = false;
      deptPickerOpen.value = false;
    }
  });
});
</script>

<style scoped>
.dh-wrap {
  padding: 8px 4px;
  max-width: 1366px;
  margin: 0 auto;
}
.contact-marquee {
  display: block;
  width: 25%;
  margin: 0 0 10px auto;
  padding: 6px 10px;
  background: rgba(0,242,255,0.08);
  border: 1px solid rgba(0,242,255,0.25);
  border-radius: 6px;
  color: #00d4e0;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  overflow: hidden;
  white-space: nowrap;
}
.marquee-track {
  display: inline-block;
  animation: marquee 30s linear infinite;
  padding-left: 100%;
}
@keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-100%); } }

/* Sticky scroll-nav */
.dh-scrollnav {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(241,245,249,0.95);
  backdrop-filter: blur(8px);
  padding: 8px 12px;
  margin: 0 -4px 12px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.dh-crumb {
  padding: 5px 12px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  color: #475569;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
}
.dh-crumb.active { background: #2962ff; color: #fff; border-color: #2962ff; }
.dh-sep { color: #94a3b8; }
.dh-sn-hint { margin-left: auto; color: #94a3b8; font-size: 11px; }

/* Section */
.dh-section { margin-bottom: 20px; }

/* Section header strip */
.dh-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  margin-bottom: 10px;
  border-top: 2px dashed #cbd5e1;
}
.dh-strip.first { border-top: none; padding-top: 0; }
.dh-strip-icon {
  width: 36px; height: 36px;
  border-radius: 8px;
  background: #e3edff;
  color: #2962ff;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
}
.dh-strip-icon.team { background: #dcfce7; color: #16a34a; }
.dh-strip-icon.system { background: #fee2e2; color: #dc2626; }
.dh-strip-text { flex: 1; }
.dh-strip-title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 10px;
}
.dh-strip-sub {
  font-size: 12px;
  color: #475569;
  margin-top: 2px;
}
.dh-strip-actions { display: flex; gap: 6px; }
.dh-danger { color: #dc2626; }
.dh-success { color: #16a34a; }

/* Scope chip + picker */
.dh-scope {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 14px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid;
  position: relative;
  user-select: none;
}
.dh-scope.self { background: #cffafe; color: #0891b2; border-color: rgba(8,145,178,0.3); }
.dh-scope.team { background: #dcfce7; color: #16a34a; border-color: rgba(22,163,74,0.3); }
.dh-scope.system { background: #fee2e2; color: #dc2626; border-color: rgba(220,38,38,0.3); }
.dh-scope.locked { cursor: not-allowed; opacity: 0.95; }
.dh-caret { font-size: 9px; }
.dh-lock-ico { font-size: 10px; }

.dh-picker-dd {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15,23,42,0.15);
  min-width: 280px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  z-index: 50;
  font-weight: 500;
  color: #0f172a;
}
.dh-pdd-search {
  width: 100%; height: 28px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 0 8px;
  font-size: 12px;
  margin-bottom: 4px;
}
.dh-pdd-group {
  font-size: 10px; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.4px;
  padding: 5px 8px 2px;
  font-weight: 700;
}
.dh-pdd-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.dh-pdd-item:hover { background: #f1f5f9; }
.dh-pdd-item.active { background: #e3edff; color: #2962ff; font-weight: 600; }
.dh-pdd-meta { margin-left: auto; color: #94a3b8; font-size: 10px; }
.dh-pdd-check {
  width: 14px; height: 14px;
  border: 1.5px solid #cbd5e1;
  border-radius: 3px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; color: #2962ff;
  flex-shrink: 0;
}
.dh-pdd-check.on { background: #2962ff; color: #fff; border-color: #2962ff; }
.dh-pdd-actions {
  display: flex; gap: 6px;
  padding: 6px 4px 2px;
  border-top: 1px solid #e2e8f0;
  margin-top: 6px;
  justify-content: flex-end;
}

/* Buttons */
.dh-btn {
  height: 30px; padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #fff;
  font-size: 12px; font-weight: 500;
  color: #0f172a;
  cursor: pointer;
}
.dh-btn:hover { background: #f8fafc; }
.dh-btn.primary { background: #2962ff; color: #fff; border-color: #2962ff; }
.dh-btn.primary:hover { background: #1e4eda; }
.dh-btn-mini {
  height: 24px; padding: 0 8px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: #fff;
  font-size: 11px;
  cursor: pointer;
  color: #2962ff;
}
.dh-btn-mini:hover { background: #e3edff; }

/* KPI strip */
.dh-kpis {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}
.dh-kpi {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dh-kpi:hover { border-color: #2962ff; box-shadow: 0 2px 6px rgba(41,98,255,0.10); }
.dh-kpi.warn { border-left: 3px solid #d97706; background: linear-gradient(135deg,#fffbeb 0%,#fff 60%); }
.dh-kpi.danger { border-left: 3px solid #dc2626; background: linear-gradient(135deg,#fef2f2 0%,#fff 60%); }
.dh-kpi-label {
  font-size: 10.5px;
  color: #475569;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.dh-kpi-val {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.1;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.dh-kpi-split {
  font-size: 11px;
  color: #92400e;
  font-weight: 600;
  background: #fef3c7;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: 4px;
}

/* Grid 2-col */
.dh-grid2 {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 10px;
}
.dh-col, .dh-col-right {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dh-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}
.dh-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 11px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
.dh-card-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.dh-badge {
  background: #dc2626; color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 700;
}
.dh-badge.warn { background: #d97706; }
.dh-link {
  font-size: 11px;
  color: #2962ff;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.dh-link:hover { text-decoration: underline; }
.dh-card-body { padding: 4px 0; max-height: 260px; overflow-y: auto; }
.dh-empty {
  padding: 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 12px;
}

/* Item row */
.dh-item {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  cursor: pointer;
  border-bottom: 1px solid #f1f5f9;
}
.dh-item:last-child { border-bottom: none; }
.dh-item:hover { background: #f8fafc; }
.dh-item-av {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #2962ff);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600;
  flex-shrink: 0;
}
.dh-item-av.appt {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  font-size: 13px;
}
.dh-item-body { min-width: 0; }
.dh-item-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dh-item-meta {
  font-size: 11px;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
.dh-item-time {
  font-size: 10.5px;
  color: #94a3b8;
  white-space: nowrap;
  text-align: right;
}

/* Quota */
.dh-quota-row {
  display: grid;
  grid-template-columns: 90px 1fr 60px;
  gap: 8px;
  align-items: center;
  padding: 4px 11px;
  font-size: 11.5px;
}
.dh-quota-name { color: #0f172a; font-weight: 500; }
.dh-quota-name.locked { color: #d97706; }
.dh-quota-bar { height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
.dh-quota-fill { height: 100%; background: linear-gradient(90deg, #16a34a, #22c55e); }
.dh-quota-fill.warn { background: linear-gradient(90deg, #d97706, #f59e0b); }
.dh-quota-fill.danger { background: linear-gradient(90deg, #dc2626, #ef4444); }
.dh-quota-fill.locked {
  background: repeating-linear-gradient(45deg, #fef3c7, #fef3c7 4px, #fde68a 4px, #fde68a 8px);
}
.dh-quota-val { font-size: 10.5px; color: #475569; text-align: right; font-weight: 600; }

/* Privacy banner */
.dh-priv-banner {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border: 1px solid #f59e0b;
  border-left: 3px solid #d97706;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  color: #78350f;
}
.dh-priv-banner strong { color: #92400e; }
.dh-priv-ico { font-size: 18px; }

/* Audit bar */
.dh-audit-bar {
  background: linear-gradient(90deg, #e0e7ff 0%, #ede9fe 100%);
  border: 1px solid #c7d2fe;
  border-radius: 6px;
  padding: 6px 12px;
  margin-bottom: 8px;
  font-size: 11.5px;
  color: #4338ca;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dh-audit-ico { font-size: 14px; }
.dh-audit-link { color: #4338ca; font-weight: 600; text-decoration: none; cursor: pointer; }
.dh-audit-link:hover { text-decoration: underline; }

/* Team table */
.dh-team-tbl {
  width: 100%;
  font-size: 11.5px;
  border-collapse: collapse;
}
.dh-team-tbl th {
  text-align: left;
  padding: 6px 10px;
  color: #475569;
  font-weight: 600;
  font-size: 10.5px;
  text-transform: uppercase;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.dh-team-tbl td {
  padding: 6px 10px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
}
.dh-team-tbl tr:hover td { background: #f8fafc; }
.dh-team-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.dh-team-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dh-team-av {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #2962ff);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600;
}
.dh-team-av.dept {
  background: linear-gradient(135deg, #34d399, #16a34a);
  border-radius: 4px;
}
.dh-tag {
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
  background: #e3edff;
  color: #2962ff;
}
.dh-tag.lock { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.dh-locksplit {
  font-size: 9.5px;
  padding: 1px 5px;
  background: #fef3c7;
  color: #92400e;
  border-radius: 6px;
  font-weight: 700;
  margin-left: 4px;
  border: 1px solid #fcd34d;
}

.dh-loading {
  text-align: center;
  padding: 24px;
  color: #94a3b8;
  font-size: 12px;
}
</style>
