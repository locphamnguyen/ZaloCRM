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
          <th class="nick-log-col" title="Số nick Zalo đã có log nhật ký với KH này">Nick log</th>
          <th>Tên CRM / Nick</th>
          <th>Trạng thái KB</th>
          <th>Trạng thái KH</th>
          <th>Tag CRM</th>
          <th>Tương tác cuối</th>
          <th>Score</th>
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
              <!-- Avatar: ưu tiên zaloAvatarUrl, fallback contact.avatarUrl, cuối cùng initials text -->
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
                <div class="sub">
                  <!-- Nick chăm (zaloAccount.displayName) — quan trọng nhất khi "Tất cả nick" mode -->
                  <span v-if="f.zaloAccount?.displayName" class="nick-chip" :title="'Nick chăm: ' + f.zaloAccount.displayName">
                    👤 {{ f.zaloAccount.displayName }}
                  </span>
                  <template v-if="f.contact?.phone">· 📱 {{ f.contact.phone }}</template>
                  <template v-else-if="f.zaloAccount?.phone">· 📱 {{ f.zaloAccount.phone }}</template>
                  <template v-if="f.contact?.birthYear">· {{ age(f.contact.birthYear) }}t</template>
                  <template v-if="f.contact?.gender">· {{ genderShort(f.contact.gender) }}</template>
                </div>
              </div>
            </div>
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

const props = defineProps<{
  friends: DbFriend[];
  loading: boolean;
  density: DensityMode;
  selected: Set<string>;
}>();

const emit = defineEmits<{
  (e: 'open-detail', f: DbFriend): void;
  (e: 'open-chat', f: DbFriend): void;
  (e: 'open-contact', f: DbFriend): void;
  (e: 'update:selected', s: Set<string>): void;
}>();

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
    friend: 'success',
    pending_friend: 'warn',
    chatting_stranger: 'info',
    ghost: 'grey',
  };
  return m[kind] ?? 'grey';
}
function kbBadgeLabel(kind: string): string {
  const m: Record<string, string> = {
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
</script>

<style scoped>
.table-wrap {
  flex: 1;
  overflow: auto;
  background: #fff;
}
.ftable {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
}
.ftable thead th {
  position: sticky; top: 0;
  background: #fff; z-index: 2;
  padding: 8px 10px;
  border-bottom: 1px solid #e4e8ef;
  font-weight: 600; font-size: 11px;
  color: #8d96a4;
  text-transform: uppercase; letter-spacing: .04em;
  text-align: left; white-space: nowrap;
}
.ftable thead th.cb-col { width: 32px; padding-right: 4px; }
.ftable thead th.nick-log-col { width: 60px; }
.ftable thead th.action-col { width: 120px; }

.ftable tbody td {
  padding: 8px 10px;
  border-bottom: 1px solid #e4e8ef;
  vertical-align: middle;
}
.ftable tbody td.cb-col { padding-right: 4px; }
.ftable tbody tr { cursor: pointer; }
.ftable tbody tr:hover { background: #f9fafc; }
.ftable tbody tr.selected { background: #e8f0fe; }

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
.cell-customer .info .name .alias { color: #8d96a4; font-weight: 400; font-size: 11px; }
.cell-customer .info .sub { font-size: 11px; color: #8d96a4; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.cell-customer .info .sub .nick-chip {
  background: #eef2ff; color: #4f46e5;
  padding: 1px 6px; border-radius: 10px;
  font-size: 10px; font-weight: 500;
  white-space: nowrap;
}
.zalo-label {
  border: 1px solid; font-size: 10px;
}

.alias-cell { font-size: 12px; color: #1a2433; }
.alias-empty { font-size: 12px; color: #8d96a4; font-style: italic; }
.dim-cell { color: #8d96a4; font-size: 11px; }
.last-int { font-size: 11.5px; color: #5b6573; }

.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 10px;
  font-size: 11px; font-weight: 600;
}
.badge.success { background: #dcfce7; color: #166534; }
.badge.warn { background: #fef3c7; color: #92400e; }
.badge.info { background: #cffafe; color: #155e75; }
.badge.grey { background: #f1f5f9; color: #475569; }
.badge.hot { background: #fee2e2; color: #b91c1c; }
.badge.cold { background: #dbeafe; color: #1e40af; }
.badge.won { background: #dcfce7; color: #15803d; }

.score {
  display: inline-flex; align-items: center; gap: 6px;
  min-width: 70px;
}
.score-bar {
  flex: 1; height: 4px; background: #e4e8ef;
  border-radius: 2px; overflow: hidden; min-width: 40px;
}
.score-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, #ef4444, #f59e0b, #16a34a);
  transition: width .2s;
}
.score-num { font-weight: 700; font-size: 11px; color: #5b6573; }

.tag-chips {
  display: flex; gap: 3px; flex-wrap: wrap;
  max-width: 180px;
}
.tag-chip {
  padding: 1px 6px; border-radius: 8px;
  background: #f9fafc; border: 1px solid #e4e8ef;
  font-size: 10px; color: #5b6573;
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
  width: 26px; height: 26px; border-radius: 5px;
  border: 1px solid #e4e8ef; background: #fff;
  color: #5b6573; font-size: 12px; cursor: pointer;
  font-family: inherit;
}
.row-actions button:hover {
  background: #2f6ee5; color: #fff; border-color: #2f6ee5;
}

.nick-log {
  display: inline-flex; flex-direction: column;
  align-items: center; gap: 1px;
  padding: 2px 6px; border-radius: 6px;
  background: #f9fafc; font-size: 10px; color: #8d96a4;
  min-width: 36px;
}
.nick-log b { font-size: 13px; color: #1a2433; line-height: 1; }
.nick-log.warm { background: #fef3c7; color: #92400e; }
.nick-log.warm b { color: #78350f; }
.nick-log.hot { background: #fee2e2; color: #991b1b; }
.nick-log.hot b { color: #7f1d1d; }

.empty {
  padding: 60px 24px;
  text-align: center; color: #8d96a4;
}
.empty .icon { font-size: 36px; }
.empty h3 { color: #1a2433; margin: 8px 0 4px; }

/* Customer avatar palette — same hash as nick sidebar */
.av-c1 { background: linear-gradient(135deg, #2f6ee5, #1d4ed8); }
.av-c2 { background: linear-gradient(135deg, #16a34a, #15803d); }
.av-c3 { background: linear-gradient(135deg, #d97706, #b45309); }
.av-c4 { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
.av-c5 { background: linear-gradient(135deg, #db2777, #be185d); }
.av-c6 { background: linear-gradient(135deg, #0891b2, #0e7490); }
.av-c7 { background: linear-gradient(135deg, #ea580c, #c2410c); }
</style>
