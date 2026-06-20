<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="table-wrap">
    <table class="ftable" :class="density">
      <thead>
        <tr>
          <th class="cb-col">
            <input
              type="checkbox"
              :checked="allSelected"
              :indeterminate.prop="someSelected && !allSelected"
              @change="onToggleAll"
            />
          </th>
          <th>Khách hàng</th>
          <th class="nick-care-col" title="Nick CRM đang chăm cặp này">Nick chăm</th>
          <th class="nick-log-col" title="Số nick Zalo đã có log nhật ký với KH này">Nick log</th>
          <th>Tên CRM / Nick</th>
          <th>Trạng thái KB</th>
          <th>Trạng thái KH</th>
          <th title="Auto tag system (active/cold/stuck/ready) + CRM tag manual">🤖 Tag</th>
          <th>Tag CRM</th>
          <th title="Ngày kết bạn Zalo">🕒 KB từ</th>
          <th
            class="stuck-col sortable"
            :class="{ 'sort-active': sortBy === 'stuck' }"
            title="KH bị flag stuck — click để sort theo stuck trước"
            @click="toggleStuckSort"
          >⚠ Stuck<span class="sort-arrow">{{ sortBy === 'stuck' ? ' ↑' : '' }}</span></th>
          <!-- Tier 2 optional cols (conditional v-if) -->
          <th v-if="visibleCols.zaloGlobalId" title="Zalo global identity">🌐 Global ID</th>
          <th v-if="visibleCols.zaloUsername" title="Zalo username handle">@ Username</th>
          <th v-if="visibleCols.lastInboundAt" title="KH nhắn cuối (inbound)">📥 KH cuối</th>
          <th v-if="visibleCols.lastOutboundAt" title="Sale nhắn cuối (outbound)">📤 Sale cuối</th>
          <th v-if="visibleCols.firstMessageAt" title="Lần đầu mở chat 1-1">💬 First msg</th>
          <th v-if="visibleCols.stageEnteredAt" title="Vào stage hiện tại lúc nào">⏱ Stage từ</th>
          <th v-if="visibleCols.silent" class="silent-col" title="Số ngày KH không nhắn">🔇 Silent</th>
          <th v-if="visibleCols.replyRate" class="reply-col" title="Tỷ lệ sale/KH messages">📨 Reply</th>
          <th v-if="visibleCols.healthBars" class="health-col" title="Score 4 chiều (engage/intent/fit/velocity)">🌡 Health</th>
          <th>Tương tác cuối</th>
          <th
            class="sortable"
            :class="{ 'sort-active': sortBy === 'score-desc' || sortBy === 'score-asc' }"
            title="Click để sort theo Score (desc → asc → off)"
            @click="toggleScoreSort"
          >Score<span class="sort-arrow">{{ sortBy === 'score-desc' ? ' ↓' : sortBy === 'score-asc' ? ' ↑' : '' }}</span></th>
          <th>Tin (in/out)</th>
          <th class="action-col">Action</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="f in friends"
          :key="f.id"
          :class="{ selected: selected.has(f.id) }"
          @click="onRowClick(f, $event)"
        >
          <td class="cb-col" @click.stop>
            <input
              type="checkbox"
              :checked="selected.has(f.id)"
              @change="onToggleRow(f.id)"
            />
          </td>
          <td>
            <div class="cell-customer">
              <!-- Avatar KH: ưu tiên zaloAvatarUrl, fallback contact.avatarUrl, cuối cùng initials text -->
              <div class="av" :class="avatarBgClass(f)">
                <img
                  v-if="f.zaloAvatarUrl || f.contact?.avatarUrl"
                  :src="f.zaloAvatarUrl || f.contact?.avatarUrl || ''"
                  :alt="displayName(f)"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="onAvatarError($event)"
                />
                <span v-else>{{ initials(displayName(f)) }}</span>
              </div>
              <div class="info">
                <div class="name">
                  {{ displayName(f) }}
                  <span v-if="f.aliasInNick" class="alias">· {{ f.aliasInNick }}</span>
                </div>
                <!-- Sub row: UID KH per-nick · SĐT · Giới tính · Tuổi (info dày, dòng dưới tên) -->
                <div class="sub">
                  <span v-if="f.zaloUidInNick" class="sub-uid" :title="'UID Zalo của KH (nhìn từ nick ' + (f.zaloAccount?.displayName || '?') + ')'">
                    🆔 {{ f.zaloUidInNick }}
                  </span>
                  <template v-if="f.contact?.phone">· 📱 {{ f.contact.phone }}</template>
                  <template v-if="f.contact?.gender">· {{ genderShort(f.contact.gender) }}</template>
                  <template v-if="f.contact?.birthYear">· {{ age(f.contact.birthYear) }}t</template>
                </div>
              </div>
            </div>
          </td>
          <!-- Cột "Nick chăm" — quan trọng cho "Tất cả nick" mode để sale phân biệt nick nào đang chăm KH này -->
          <td class="nick-care-col">
            <div v-if="f.zaloAccount" class="cell-nick">
              <div class="nick-av" :class="[saleBgClass(f.zaloAccount.id || ''), { offline: false }]">
                <img
                  v-if="f.zaloAccount.avatarUrl"
                  :src="f.zaloAccount.avatarUrl"
                  :alt="f.zaloAccount.displayName || 'Nick'"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="onAvatarError($event)"
                />
                <span v-else>{{ nickInitials(f.zaloAccount.displayName) }}</span>
              </div>
              <div class="nick-info">
                <div class="nick-name">{{ f.zaloAccount.displayName || 'Nick chưa đặt tên' }}</div>
                <div class="nick-sub">{{ f.zaloAccount.phone || '—' }}</div>
              </div>
            </div>
            <span v-else class="dim-cell">—</span>
          </td>
          <td>
            <div class="nick-log" :class="nickLogLevel(f)">
              <b>{{ nickLogCount(f) }}</b>nick
            </div>
          </td>
          <td>
            <span v-if="f.aliasInNick" class="alias-cell">{{ f.aliasInNick }}</span>
            <span v-else class="alias-empty">chưa đặt</span>
          </td>
          <td><span class="badge" :class="kbBadgeClass(f.relationshipKind)">{{ kbBadgeLabel(f.relationshipKind) }}</span></td>
          <td>
            <span v-if="careLabel(f)" class="badge" :class="careClass(f)">{{ careLabel(f) }}</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <!-- 🤖 Auto tag (Tier 1, always visible) -->
          <td>
            <div v-if="getAutoTags(f).length" class="tag-chips">
              <span
                v-for="t in getAutoTags(f)"
                :key="'at-' + t"
                class="auto-tag-chip"
                :class="autoTagColor(t)"
                :title="'Auto tag system: ' + t"
              >🤖 {{ autoTagLabel(t) }}</span>
            </div>
            <span v-else class="dim-cell">—</span>
          </td>
          <td>
            <div v-if="getCrmTags(f).length || getZaloLabels(f).length" class="tag-chips">
              <!-- CRM tag per-pair -->
              <span
                v-for="t in getCrmTags(f)"
                :key="'crm-' + t"
                class="tag-chip"
                :class="tagColor(t)"
                :title="'Tag CRM: ' + t"
              >{{ t }}</span>
              <!-- Zalo label per-pair (đồng bộ từ Zalo native), prefix 🏷 phân biệt -->
              <span
                v-for="l in getZaloLabels(f)"
                :key="'zlb-' + l.name"
                class="tag-chip zalo-label"
                :style="l.color ? { background: hexAlpha(l.color, 0.18), color: l.color, borderColor: hexAlpha(l.color, 0.4) } : {}"
                :title="'Label Zalo: ' + l.name"
              >🏷 {{ l.name }}</span>
            </div>
            <span v-else class="dim-cell">—</span>
          </td>
          <!-- 🕒 KB từ ngày (Tier 1) -->
          <td>
            <span v-if="f.becameFriendAt" class="kb-date" :title="formatExactDate(f.becameFriendAt)">
              {{ relativeDate(f.becameFriendAt) }}
            </span>
            <span v-else class="dim-cell">—</span>
          </td>
          <!-- ⚠ Đình trệ (Tier 1) -->
          <td class="stuck-col">
            <span v-if="f.stuckSince" class="stuck-badge" :title="'Đình trệ từ ' + formatExactDate(f.stuckSince)">
              ⚠ {{ stuckDaysLabel(f.stuckSince) }}
            </span>
            <span v-else class="dim-cell">—</span>
          </td>
          <!-- Tier 2 optional cells -->
          <td v-if="visibleCols.zaloGlobalId">
            <span v-if="f.zaloGlobalId" class="sub-uid" :title="f.zaloGlobalId">{{ truncate(f.zaloGlobalId, 12) }}</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <td v-if="visibleCols.zaloUsername">
            <span v-if="f.zaloUsername" class="sub-uid">@{{ f.zaloUsername }}</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <td v-if="visibleCols.lastInboundAt">
            <span v-if="f.lastInboundAt" class="last-int" :title="formatExactDate(f.lastInboundAt)">📥 {{ relativeDate(f.lastInboundAt) }}</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <td v-if="visibleCols.lastOutboundAt">
            <span v-if="f.lastOutboundAt" class="last-int" :title="formatExactDate(f.lastOutboundAt)">📤 {{ relativeDate(f.lastOutboundAt) }}</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <td v-if="visibleCols.firstMessageAt">
            <span v-if="f.firstMessageAt" class="last-int" :title="formatExactDate(f.firstMessageAt)">{{ relativeDate(f.firstMessageAt) }}</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <td v-if="visibleCols.stageEnteredAt">
            <span v-if="f.stageEnteredAt" class="last-int">{{ relativeDate(f.stageEnteredAt) }}</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <!-- 🔇 Silent (Phase 2 derived) — số ngày KH không nhắn -->
          <td v-if="visibleCols.silent" class="silent-col">
            <span v-if="silentDays(f) >= 7" class="silent-badge" :class="silentSeverity(f)" :title="silentTooltip(f)">
              🔇 {{ silentDays(f) }}d
            </span>
            <span v-else-if="silentDays(f) > 0" class="dim-cell">{{ silentDays(f) }}d</span>
            <span v-else class="dim-cell">—</span>
          </td>
          <!-- 📨 Reply rate (Phase 2 derived) -->
          <td v-if="visibleCols.replyRate" class="reply-col">
            <span class="reply-rate" :class="replyRateClass(f)" :title="replyRateTooltip(f)">
              {{ replyRateLabel(f) }}
            </span>
          </td>
          <!-- 🌡 Health bars 4-dim (Phase 2 derived) -->
          <td v-if="visibleCols.healthBars" class="health-col">
            <div class="health-bars" :title="healthTooltip(f)">
              <div class="hb"><div class="hb-fill engage" :style="{ height: healthDim(f, 'engagement') + '%' }" /></div>
              <div class="hb"><div class="hb-fill intent" :style="{ height: healthDim(f, 'intent') + '%' }" /></div>
              <div class="hb"><div class="hb-fill fit" :style="{ height: healthDim(f, 'fit') + '%' }" /></div>
              <div class="hb"><div class="hb-fill velocity" :style="{ height: healthDim(f, 'velocity') + '%' }" /></div>
            </div>
          </td>
          <td>
            <span v-if="f.lastInteractionAt" class="last-int">📥 {{ relativeDate(f.lastInteractionAt) }}</span>
            <span v-else class="dim-cell">chưa nhắn</span>
          </td>
          <td>
            <div class="score">
              <div class="score-bar"><div class="fill" :style="{ width: (f.leadScore ?? 0) + '%' }" /></div>
              <span class="score-num">{{ f.leadScore ?? 0 }}</span>
            </div>
          </td>
          <td><span class="dim-cell">{{ f.totalInbound }} / {{ f.totalOutbound }}</span></td>
          <td class="action-col" @click.stop>
            <div class="row-actions">
              <button title="Mở chat" @click="$emit('open-chat', f)">💬</button>
              <button title="Hồ sơ" @click="$emit('open-contact', f)">👤</button>
              <button title="Thêm">⋯</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!friends.length && !loading" class="empty">
      <div class="icon">👋</div>
      <h3>Chưa có bạn bè trong tab này</h3>
      <p>Thử bỏ filter hoặc đồng bộ lại Zalo.</p>
    </div>

    <div v-if="loading" class="empty">
      <div class="icon">⏳</div>
      <p>Đang tải...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DbFriend } from '@/composables/use-friends';
import type { DensityMode } from '@/composables/use-friends-state';

interface VisibleColsMap {
  zaloGlobalId: boolean;
  zaloUsername: boolean;
  lastInboundAt: boolean;
  lastOutboundAt: boolean;
  firstMessageAt: boolean;
  stageEnteredAt: boolean;
  // Phase 2 derived
  silent: boolean;
  replyRate: boolean;
  healthBars: boolean;
}

type SortBy = 'recent' | 'score-desc' | 'score-asc' | 'stuck';

const props = defineProps<{
  friends: DbFriend[];
  loading: boolean;
  density: DensityMode;
  selected: Set<string>;
  /** Tier 2 column toggle state (Tier 1 luôn show, không trong map này) */
  visibleCols: VisibleColsMap;
  /** Phase 6 — sort theo Score / Stuck header click */
  sortBy?: SortBy;
}>();

const emit = defineEmits<{
  (e: 'open-detail', f: DbFriend): void;
  (e: 'open-chat', f: DbFriend): void;
  (e: 'open-contact', f: DbFriend): void;
  (e: 'update:selected', s: Set<string>): void;
  (e: 'sort-by', v: SortBy): void;
}>();

/** Click Score header: cycle recent → score-desc → score-asc → recent */
function toggleScoreSort() {
  const cur = props.sortBy ?? 'recent';
  const next: SortBy = cur === 'score-desc' ? 'score-asc' : cur === 'score-asc' ? 'recent' : 'score-desc';
  emit('sort-by', next);
}
/** Click Stuck header: toggle stuck ↔ recent */
function toggleStuckSort() {
  const cur = props.sortBy ?? 'recent';
  emit('sort-by', cur === 'stuck' ? 'recent' : 'stuck');
}

const allSelected = computed(() => props.friends.length > 0 && props.friends.every(f => props.selected.has(f.id)));
const someSelected = computed(() => props.friends.some(f => props.selected.has(f.id)));

function onToggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  const next = new Set(props.selected);
  if (checked) props.friends.forEach(f => next.add(f.id));
  else props.friends.forEach(f => next.delete(f.id));
  emit('update:selected', next);
}

function onToggleRow(id: string) {
  const next = new Set(props.selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  emit('update:selected', next);
}

function onRowClick(f: DbFriend, e: MouseEvent) {
  // Don't open detail if clicking checkbox/button/inside actions
  const target = e.target as HTMLElement;
  if (target.closest('input, button, .cb-col, .action-col')) return;
  emit('open-detail', f);
}

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Color avatar based on contact id (deterministic, matches sidebar palette family but for customers)
const CUSTOMER_PALETTE = ['av-c1', 'av-c2', 'av-c3', 'av-c4', 'av-c5', 'av-c6', 'av-c7'];
function avatarBgClass(f: DbFriend): string {
  const id = f.contactId || f.id;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CUSTOMER_PALETTE[h % CUSTOMER_PALETTE.length];
}

// Sale color palette — đồng nhất với NickSidebar (cùng hash account.id → cùng màu).
const SALE_PALETTE = ['av-s1', 'av-s2', 'av-s3', 'av-s4', 'av-s5', 'av-s6', 'av-s7'];
function saleBgClass(accountId: string): string {
  if (!accountId) return SALE_PALETTE[0];
  let h = 0;
  for (let i = 0; i < accountId.length; i++) h = (h * 31 + accountId.charCodeAt(i)) >>> 0;
  return SALE_PALETTE[h % SALE_PALETTE.length];
}

function nickInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Tên hiển thị — ưu tiên CRM tự đặt > zaloDisplayName per-pair > Contact.fullName > placeholder. */
function displayName(f: DbFriend): string {
  return (
    f.contact?.crmName ||
    f.zaloDisplayName ||
    f.contact?.fullName ||
    '—'
  );
}

/** Fallback initials khi avatar img fail load (vd URL Zalo expired). */
function onAvatarError(e: Event): void {
  const img = e.target as HTMLImageElement;
  // Ẩn img, span initials sibling sẽ thay thế tự nhiên nếu có; nếu không có thì hiện ?
  img.style.display = 'none';
  const parent = img.parentElement;
  if (parent && !parent.querySelector('span')) {
    const span = document.createElement('span');
    span.textContent = '?';
    parent.appendChild(span);
  }
}

interface ZaloLabelLite { name?: string; color?: string; id?: string }

/** Zalo labels per-pair — array of {name,color,id}. Defensive parse. */
function getZaloLabels(f: DbFriend): Array<{ name: string; color: string | null }> {
  const raw = f.zaloLabels;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is ZaloLabelLite => !!l && typeof l === 'object')
    .map((l) => ({ name: l.name || '', color: l.color || null }))
    .filter((l) => l.name.length > 0);
}

/** Convert hex #RRGGBB → rgba với alpha cho background chip. */
function hexAlpha(hex: string | null | undefined, alpha = 0.18): string {
  if (!hex) return 'rgba(90,100,120,0.10)';
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return 'rgba(90,100,120,0.10)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function age(year?: number | null): number | null {
  if (!year) return null;
  return new Date().getFullYear() - year;
}
function genderShort(g: string | null): string {
  if (!g) return '';
  return g === 'male' ? 'Nam' : g === 'female' ? 'Nữ' : g;
}

function kbBadgeClass(kind: string): string {
  const m: Record<string, string> = {
    none: 'stranger',
    friend: 'success',
    pending_friend: 'warn',
    chatting_stranger: 'info',
    ghost: 'grey',
  };
  return m[kind] ?? 'grey';
}
function kbBadgeLabel(kind: string): string {
  const m: Record<string, string> = {
    // 'none' = mới tìm ra Zalo qua SDK, chưa gửi mời / chưa nhắn.
    none: '○ Người Lạ',
    friend: '● Đã kết bạn',
    pending_friend: '◐ Đã gửi mời',
    chatting_stranger: '◯ Đang nhắn lạ',
    ghost: '✕ Đã ngắt',
  };
  return m[kind] ?? '—';
}

function careLabel(f: DbFriend): string {
  const name = f.statusRef?.name;
  if (!name) return '';
  // Add emoji prefix dựa trên tên status
  const lower = name.toLowerCase();
  if (lower.includes('nóng')) return '🔥 ' + name;
  if (lower.includes('lạnh')) return '❄ ' + name;
  if (lower.includes('chốt')) return '✅ ' + name;
  if (lower.includes('đàm')) return '⚡ ' + name;
  if (lower.includes('chăm')) return '🤝 ' + name;
  if (lower.includes('quan tâm')) return '💬 ' + name;
  return name;
}
function careClass(f: DbFriend): string {
  const name = f.statusRef?.name?.toLowerCase() || '';
  if (name.includes('nóng')) return 'hot';
  if (name.includes('lạnh')) return 'cold';
  if (name.includes('chốt')) return 'won';
  if (name.includes('đàm')) return 'warn';
  if (name.includes('quan tâm')) return 'info';
  if (name.includes('chăm')) return 'warn';
  return 'grey';
}

function getCrmTags(f: DbFriend): string[] {
  return Array.isArray(f.crmTagsPerNick) ? f.crmTagsPerNick : [];
}

function tagColor(tag: string): string {
  const lower = tag.toLowerCase();
  if (lower.includes('nóng')) return 'red';
  if (lower.includes('vip')) return 'purple';
  if (lower.includes('lạnh')) return 'blue';
  if (lower.includes('ấm')) return 'yellow';
  if (lower.includes('chốt') || lower.includes('có tương tác')) return 'green';
  if (lower.includes('đàm')) return 'green';
  if (lower.includes('quan tâm')) return 'blue';
  return '';
}

function nickLogCount(f: DbFriend): number {
  // Best available proxy hiện tại — backend chưa expose count multi-nick.
  return f.hasConversation ? 1 : 0;
}
function nickLogLevel(f: DbFriend): string {
  const n = nickLogCount(f);
  if (n === 0) return '';
  if (n === 1) return '';
  if (n <= 3) return 'warm';
  return 'hot';
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins}p trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hôm qua';
  if (days < 30) return `${days}d trước`;
  return `${Math.floor(days / 30)}m trước`;
}

/** Date exact "DD/MM/YYYY HH:mm" cho tooltip. */
function formatExactDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Số ngày stuck dưới dạng chip. */
function stuckDaysLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return '< 1d';
  if (days === 1) return '1 ngày';
  if (days < 30) return `${days} ngày`;
  const months = Math.floor(days / 30);
  return `${months} tháng`;
}

// ─── Auto tag (system-generated) ──────────────────────────────────────────
// Color: theo loại (active=xanh / cold=xám / stuck=đỏ / ready=cam ...) — combo
// với prefix 🤖 phân biệt khỏi CRM tag manual.
function getAutoTags(f: DbFriend): string[] {
  return Array.isArray(f.autoTags) ? f.autoTags : [];
}

const AUTO_TAG_COLOR_MAP: Record<string, string> = {
  active: 'auto-active',     // xanh — đang tương tác tốt
  ready: 'auto-ready',       // cam — sẵn sàng chốt
  rewarmed: 'auto-rewarmed', // tím — vừa hồi sinh
  stuck: 'auto-stuck',       // đỏ — đình trệ
  atrisk: 'auto-atrisk',     // vàng — sắp stuck
  cold: 'auto-cold',         // xám — nguội
  frozen: 'auto-frozen',     // đen — đông cứng
};
function autoTagColor(tag: string): string {
  return AUTO_TAG_COLOR_MAP[tag.toLowerCase()] || 'auto-default';
}

const AUTO_TAG_VN_LABEL: Record<string, string> = {
  active: 'active',
  ready: 'ready',
  rewarmed: 'hồi sinh',
  stuck: 'stuck',
  atrisk: 'rủi ro',
  cold: 'nguội',
  frozen: 'đông cứng',
};
function autoTagLabel(tag: string): string {
  return AUTO_TAG_VN_LABEL[tag.toLowerCase()] || tag;
}

// ─── Phase 2 derived columns helpers ──────────────────────────────────────

/** Số ngày KH không gửi inbound. 0 nếu chưa từng nhắn. */
function silentDays(f: DbFriend): number {
  if (!f.lastInboundAt) return 0;
  return Math.floor((Date.now() - new Date(f.lastInboundAt).getTime()) / 86_400_000);
}
function silentSeverity(f: DbFriend): string {
  const d = silentDays(f);
  if (d >= 30) return 'critical';  // > 1 tháng = nguy hiểm
  if (d >= 14) return 'warn';      // 2 tuần = cảnh báo
  return 'mild';                    // 7-13 ngày = nhẹ
}
function silentTooltip(f: DbFriend): string {
  if (!f.lastInboundAt) return 'KH chưa từng nhắn';
  return `KH nhắn lần cuối: ${formatExactDate(f.lastInboundAt)}`;
}

/** Reply rate = totalOutbound / totalInbound. Ý nghĩa:
 *   > 1.5 → sale chăm quá nhiều (push), KH ít reply
 *   0.8-1.5 → cân bằng tốt
 *   < 0.5 → sale chăm chưa đủ
 *   N/A → chưa có inbound */
function replyRateNumeric(f: DbFriend): number | null {
  const inb = f.totalInbound ?? 0;
  const out = f.totalOutbound ?? 0;
  if (inb === 0) return null;
  return out / inb;
}
function replyRateLabel(f: DbFriend): string {
  const r = replyRateNumeric(f);
  if (r === null) return '—';
  return `${(r * 100).toFixed(0)}%`;
}
function replyRateClass(f: DbFriend): string {
  const r = replyRateNumeric(f);
  if (r === null) return 'rr-none';
  if (r < 0.5) return 'rr-low';      // đỏ — sale chăm thiếu
  if (r <= 1.5) return 'rr-ok';      // xanh — cân bằng
  return 'rr-high';                  // cam — push quá
}
function replyRateTooltip(f: DbFriend): string {
  const r = replyRateNumeric(f);
  if (r === null) return 'Chưa có tin inbound từ KH';
  const tone = r < 0.5 ? 'Sale chăm chưa đủ' : r <= 1.5 ? 'Cân bằng tốt' : 'Sale push nhiều, KH ít reply';
  return `Tỷ lệ outbound/inbound: ${(r * 100).toFixed(0)}% — ${tone}`;
}

/** Health bars: 4 mini bars dọc từ scoreBreakdown. Mỗi chiều 0-100. */
function healthDim(f: DbFriend, key: 'engagement' | 'intent' | 'fit' | 'velocity'): number {
  const v = f.scoreBreakdown?.[key];
  if (typeof v !== 'number') return 0;
  return Math.max(0, Math.min(100, v));
}
function healthTooltip(f: DbFriend): string {
  const b = f.scoreBreakdown;
  if (!b) return 'Chưa có score breakdown';
  return `Engage ${b.engagement ?? 0} · Intent ${b.intent ?? 0} · Fit ${b.fit ?? 0} · Velocity ${b.velocity ?? 0}`;
}
</script>

<style scoped>
.table-wrap {
  flex: 1;
  overflow: auto;
  background: var(--surface);
  /* Phase 3 — smooth horizontal scroll khi nhiều cột toggle bật */
  scroll-behavior: smooth;
  scrollbar-width: thin;
}
.table-wrap::-webkit-scrollbar { height: 10px; width: 10px; }
.table-wrap::-webkit-scrollbar-track { background: var(--surface-2); }
.table-wrap::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 5px; }
.table-wrap::-webkit-scrollbar-thumb:hover { background: var(--ink-4); }

.ftable {
  /* min-width đảm bảo cột không bị squash khi nhiều cột bật; horizontal scroll active */
  min-width: 100%;
  width: max-content;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
}

/* Phase 6 polish — sortable header với hover + active state */
.ftable thead th.sortable {
  cursor: pointer;
  user-select: none;
  transition: background 0.12s, color 0.12s;
}
.ftable thead th.sortable:hover {
  background: var(--brand-soft);
  color: var(--brand-700);
}
.ftable thead th.sort-active {
  background: var(--brand-soft);
  color: var(--brand-700);
}
.ftable thead th .sort-arrow {
  font-size: 11px;
  color: var(--brand);
  margin-left: 2px;
  font-weight: 700;
}

/* Phase 3 — Freeze 2 cột đầu (checkbox + Khách hàng) khi scroll ngang */
.ftable thead th.cb-col,
.ftable tbody td.cb-col {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--surface);
}
.ftable thead th.cb-col { z-index: 4; background: var(--surface-2); }
.ftable thead th:nth-child(2),
.ftable tbody td:nth-child(2) {
  position: sticky;
  left: 32px;  /* sau cb-col 32px */
  z-index: 3;
  background: var(--surface);
  box-shadow: 1px 0 0 var(--line);  /* viền chia tách rõ */
}
.ftable thead th:nth-child(2) { z-index: 4; background: var(--surface-2); }
.ftable tbody tr:hover td:nth-child(1),
.ftable tbody tr:hover td:nth-child(2) { background: var(--brand-softer); }
.ftable tbody tr.selected td:nth-child(1),
.ftable tbody tr.selected td:nth-child(2) { background: var(--brand-soft); }
.ftable thead th {
  position: sticky; top: 0;
  background: var(--surface-2); z-index: 2;
  padding: 9px 10px;
  border-bottom: 1px solid var(--line);
  font-weight: 700; font-size: 10.5px;
  color: var(--ink-4);
  text-transform: uppercase; letter-spacing: .04em;
  text-align: left; white-space: nowrap;
}
.ftable thead th.cb-col { width: 32px; padding-right: 4px; }
.ftable thead th.nick-log-col { width: 60px; }
.ftable thead th.nick-care-col { width: 180px; }
.ftable thead th.action-col { width: 120px; }

.ftable tbody td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--line-2);
  vertical-align: middle;
  color: var(--ink-2);
}
.ftable tbody td.cb-col { padding-right: 4px; }
.ftable tbody tr { cursor: pointer; transition: background .12s; }
.ftable tbody tr:hover { background: var(--brand-softer); }
.ftable tbody tr.selected { background: var(--brand-soft); }

.ftable.compact tbody td { padding: 5px 10px; }
.ftable.detailed tbody td { padding: 12px 10px; }

.cell-customer {
  display: flex; align-items: center; gap: 10px;
  min-width: 220px;
}
.cell-customer .av {
  width: 36px; height: 36px; border-radius: 50%;
  color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: 12px; flex-shrink: 0;
  position: relative; overflow: hidden;
}
.cell-customer .av img {
  width: 100%; height: 100%; object-fit: cover;
  display: block;
}
.cell-customer .av::after {
  content: "🔵"; position: absolute; bottom: -3px; right: -3px;
  font-size: 10px; line-height: 1;
  z-index: 1;
}
.cell-customer .info { min-width: 0; }
.cell-customer .info .name { font-weight: 600; }
.cell-customer .info .name { color: var(--ink); }
.cell-customer .info .name .alias { color: var(--ink-4); font-weight: 400; font-size: 11px; }
.cell-customer .info .sub { font-size: 11px; color: var(--ink-4); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.cell-customer .info .sub .sub-uid {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10.5px;
  color: var(--ink-3);
  background: var(--surface-3);
  padding: 1px 6px;
  border-radius: 5px;
  white-space: nowrap;
}
.zalo-label {
  border: 1px solid; font-size: 10px;
}

/* ── Cột "Nick chăm" ───────────────────────────────────────────────────── */
.cell-nick {
  display: flex; align-items: center; gap: 8px;
  min-width: 0;
}
.cell-nick .nick-av {
  width: 28px; height: 28px; border-radius: 50%;
  color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: 11px; flex-shrink: 0;
  position: relative; overflow: hidden;
}
.cell-nick .nick-av img {
  width: 100%; height: 100%; object-fit: cover;
  display: block;
}
.cell-nick .nick-av.offline { opacity: 0.5; }
.cell-nick .nick-info { min-width: 0; }
.cell-nick .nick-name {
  font-weight: 600; font-size: 12px; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 130px;
}
.cell-nick .nick-sub {
  font-size: 10.5px; color: var(--ink-4);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Sale color palette — đồng nhất với NickSidebar */
.av-s1 { background: #4f46e5; }
.av-s2 { background: #0891b2; }
.av-s3 { background: #059669; }
.av-s4 { background: #d97706; }
.av-s5 { background: #db2777; }
.av-s6 { background: #7c3aed; }
.av-s7 { background: #dc2626; }

/* ── Auto tag chip (system-generated) ────────────────────────────────────
   Khác với CRM tag manual ở chỗ có prefix 🤖 + màu theo loại. */
.auto-tag-chip {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid;
  margin-right: 3px;
  white-space: nowrap;
}
.auto-active   { background: #d1fae5; color: #047857; border-color: #6ee7b7; }
.auto-ready    { background: #fed7aa; color: #c2410c; border-color: #fdba74; }
.auto-rewarmed { background: #e9d5ff; color: #7e22ce; border-color: #d8b4fe; }
.auto-stuck    { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
.auto-atrisk   { background: #fef3c7; color: #b45309; border-color: #fde68a; }
.auto-cold     { background: #e5e7eb; color: #4b5563; border-color: #d1d5db; }
.auto-frozen   { background: #1f2937; color: #f3f4f6; border-color: #374151; }
.auto-default  { background: #f3f4f6; color: #6b7280; border-color: #e5e7eb; }

/* ── Stuck badge ────────────────────────────────────────────────────────── */
.stuck-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  background: #fee2e2;
  color: #b91c1c;
  border: 1px solid #fca5a5;
  white-space: nowrap;
}
.stuck-col { width: 80px; }

/* ── KB date ────────────────────────────────────────────────────────────── */
.kb-date {
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}

/* ── Phase 2 derived columns ───────────────────────────────────────────── */
.silent-col, .reply-col, .health-col { width: 70px; }

.silent-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.silent-badge.mild     { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
.silent-badge.warn     { background: #fed7aa; color: #c2410c; border: 1px solid #fdba74; }
.silent-badge.critical { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }

.reply-rate {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
}
.rr-none { color: #8d96a4; }
.rr-low  { background: #fee2e2; color: #b91c1c; }
.rr-ok   { background: #d1fae5; color: #047857; }
.rr-high { background: #fed7aa; color: #c2410c; }

/* Health bars — 4 mini vertical bars, mỗi chiều 1 màu */
.health-bars {
  display: flex; gap: 2px; align-items: flex-end;
  height: 24px; width: 40px;
}
.health-bars .hb {
  width: 7px; height: 100%;
  background: #e5e7eb; border-radius: 2px;
  position: relative; overflow: hidden;
}
.health-bars .hb-fill {
  position: absolute; bottom: 0; left: 0; right: 0;
  border-radius: 2px;
  transition: height 0.2s;
}
.hb-fill.engage   { background: #4f46e5; }   /* Engagement xanh-tím */
.hb-fill.intent   { background: #db2777; }   /* Intent đỏ-hồng (mua) */
.hb-fill.fit      { background: #059669; }   /* Fit xanh lá (phù hợp) */
.hb-fill.velocity { background: #d97706; }   /* Velocity cam (tốc độ) */

.alias-cell { font-size: 12px; color: var(--ink); }
.alias-empty { font-size: 12px; color: var(--ink-4); font-style: italic; }
.dim-cell { color: var(--ink-4); font-size: 11px; }
.last-int { font-size: 11.5px; color: var(--ink-3); }

.badge {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 10px; border-radius: var(--r-pill);
  font-size: 11.5px; font-weight: 700; white-space: nowrap; line-height: 1;
}
.badge.success { background: #dcfce7; color: #166534; }
.badge.warn { background: #fef3c7; color: #92400e; }
.badge.info { background: #cffafe; color: #155e75; }
.badge.grey { background: #f1f5f9; color: #475569; }
.badge.stranger { background: #ede9fe; color: #6d28d9; }
.badge.hot { background: #fee2e2; color: #b91c1c; }
.badge.cold { background: #dbeafe; color: #1e40af; }
.badge.won { background: #dcfce7; color: #15803d; }

.score {
  display: inline-flex; align-items: center; gap: 6px;
  min-width: 70px;
}
.score-bar {
  flex: 1; height: 4px; background: var(--line);
  border-radius: 2px; overflow: hidden; min-width: 40px;
}
.score-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, var(--score-low), var(--score-mid), var(--score-high));
  transition: width .2s;
}
.score-num { font-weight: 700; font-size: 11px; color: var(--ink-2); font-family: var(--mono, ui-monospace, monospace); }

.tag-chips {
  display: flex; gap: 3px; flex-wrap: wrap;
  max-width: 180px;
}
.tag-chip {
  padding: 1px 7px; border-radius: var(--r-pill);
  background: var(--surface-3); border: 1px solid var(--line);
  font-size: 10px; color: var(--ink-2);
}
.tag-chip.red { background: #fee2e2; color: #991b1b; border-color: transparent; }
.tag-chip.green { background: #dcfce7; color: #166534; border-color: transparent; }
.tag-chip.blue { background: #dbeafe; color: #1e40af; border-color: transparent; }
.tag-chip.yellow { background: #fef9c3; color: #854d0e; border-color: transparent; }
.tag-chip.purple { background: #ede9fe; color: #5b21b6; border-color: transparent; }

.row-actions {
  display: inline-flex; gap: 2px; opacity: 0;
  transition: opacity .12s;
}
.ftable tbody tr:hover .row-actions { opacity: 1; }
.row-actions button {
  width: 26px; height: 26px; border-radius: var(--r-xs);
  border: 1px solid var(--line); background: var(--surface);
  color: var(--ink-2); font-size: 12px; cursor: pointer;
  font-family: inherit;
  transition: all .12s;
}
.row-actions button:hover {
  background: var(--brand); color: #fff; border-color: var(--brand);
}

.nick-log {
  display: inline-flex; flex-direction: column;
  align-items: center; gap: 1px;
  padding: 2px 6px; border-radius: var(--r-xs);
  background: var(--surface-3); font-size: 10px; color: var(--ink-4);
  min-width: 36px;
}
.nick-log b { font-size: 13px; color: var(--ink); line-height: 1; }
.nick-log.warm { background: #fef3c7; color: #92400e; }
.nick-log.warm b { color: #78350f; }
.nick-log.hot { background: #fee2e2; color: #991b1b; }
.nick-log.hot b { color: #7f1d1d; }

.empty {
  padding: 60px 24px;
  text-align: center; color: var(--ink-4);
}
.empty .icon { font-size: 36px; }
.empty h3 { color: var(--ink); margin: 8px 0 4px; }

/* Customer avatar palette — same hash as nick sidebar */
.av-c1 { background: linear-gradient(135deg, #2f6ee5, #1d4ed8); }
.av-c2 { background: linear-gradient(135deg, #16a34a, #15803d); }
.av-c3 { background: linear-gradient(135deg, #d97706, #b45309); }
.av-c4 { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
.av-c5 { background: linear-gradient(135deg, #db2777, #be185d); }
.av-c6 { background: linear-gradient(135deg, #0891b2, #0e7490); }
.av-c7 { background: linear-gradient(135deg, #ea580c, #c2410c); }
</style>
