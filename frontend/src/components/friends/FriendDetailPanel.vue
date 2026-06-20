<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <Teleport to="body">
    <div v-if="friend" class="panel-overlay" @click="$emit('close')" />
    <aside class="side-panel" :class="{ open: !!friend }">
      <template v-if="friend">
        <div class="panel-head">
          <div class="av" :class="avatarClass(friend)">
            <!-- B7 fix — avatar Zalo img khi có, fallback initials từ displayName chain -->
            <img
              v-if="friend.zaloAvatarUrl"
              :src="friend.zaloAvatarUrl"
              :alt="displayCustomerName(friend)"
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <span v-else>{{ customerInitials(friend) }}</span>
          </div>
          <h3>{{ displayCustomerName(friend) }}</h3>
          <button class="close" @click="$emit('close')">✕</button>
        </div>

        <div class="panel-body">
          <div class="panel-section">
            <h5>Thông tin KH</h5>
            <div class="kv"><span class="k">📱 SĐT</span><span class="v"><b>{{ friend.contact?.phone || '—' }}</b></span></div>
            <div class="kv"><span class="k">🔵 Zalo UID</span><span class="v">{{ friend.zaloUidInNick || '—' }}</span></div>
            <div class="kv">
              <span class="k">📅 Là bạn từ</span>
              <span class="v">
                <template v-if="friend.becameFriendAt">
                  {{ formatDate(friend.becameFriendAt) }} ({{ daysSince(friend.becameFriendAt) }} ngày)
                </template>
                <template v-else>—</template>
              </span>
            </div>
            <div v-if="friend.contact?.birthYear" class="kv">
              <span class="k">🎂 Năm sinh</span>
              <span class="v">{{ friend.contact.birthYear }} ({{ age(friend.contact.birthYear) }} tuổi)<template v-if="friend.contact.gender"> · {{ genderShort(friend.contact.gender) }}</template></span>
            </div>
            <div v-if="friend.contact?.province" class="kv">
              <span class="k">📍 Khu vực</span>
              <span class="v">{{ [friend.contact.district, friend.contact.province].filter(Boolean).join(', ') }}</span>
            </div>
          </div>

          <div class="panel-section">
            <h5>Per-pair với <b>{{ activeNickName }}</b></h5>
            <div class="kv">
              <span class="k">Trạng thái KB</span>
              <span class="v"><span class="badge" :class="kbClass(friend.relationshipKind)">{{ kbLabel(friend.relationshipKind) }}</span></span>
            </div>
            <div v-if="friend.statusRef" class="kv">
              <span class="k">Trạng thái KH</span>
              <span class="v"><span class="badge" :class="careClass(friend)">{{ careLabel(friend) }}</span></span>
            </div>
            <div class="kv">
              <span class="k">Score</span>
              <span class="v"><b>{{ friend.leadScore ?? 0 }}/100</b></span>
            </div>
            <div class="kv">
              <span class="k">Alias (Tên nick)</span>
              <span class="v">{{ friend.aliasInNick || '— chưa đặt —' }}</span>
            </div>
            <div class="kv">
              <span class="k">Tin (in/out)</span>
              <span class="v">{{ friend.totalInbound }} / {{ friend.totalOutbound }}</span>
            </div>
            <div v-if="friend.lastInboundAt" class="kv">
              <span class="k">KH nhắn cuối</span>
              <span class="v">{{ formatRelative(friend.lastInboundAt) }}</span>
            </div>
            <div v-if="friend.lastOutboundAt" class="kv">
              <span class="k">Sale nhắn cuối</span>
              <span class="v">{{ formatRelative(friend.lastOutboundAt) }}</span>
            </div>
          </div>

          <div v-if="crmTags.length" class="panel-section">
            <h5>Tag CRM</h5>
            <div class="tag-chips">
              <span
                v-for="t in crmTags"
                :key="t"
                class="tag-chip"
                :class="tagColor(t)"
              >{{ t }}</span>
            </div>
          </div>

          <div v-if="zaloLabels.length" class="panel-section">
            <h5>Label Zalo (per-pair)</h5>
            <div class="tag-chips">
              <span
                v-for="l in zaloLabels"
                :key="l.name"
                class="tag-chip"
                :style="l.color ? { background: l.color + '22', color: l.color, borderColor: 'transparent' } : undefined"
              >🔵 {{ l.name }}</span>
            </div>
          </div>
        </div>

        <div class="panel-foot">
          <button class="btn" @click="$emit('open-chat', friend)">💬 Mở chat</button>
          <button class="btn" @click="$emit('call', friend)">📞 Gọi</button>
          <button class="btn primary" @click="$emit('open-contact', friend)">👤 Hồ sơ</button>
        </div>
      </template>
    </aside>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DbFriend } from '@/composables/use-friends';
import { displayCustomerName, customerInitials } from '@/composables/use-friend-display';
import { formatInOrgTz } from '@/composables/use-org-timezone';

const props = defineProps<{
  friend: DbFriend | null;
  activeNickName: string;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'open-chat', f: DbFriend): void;
  (e: 'call', f: DbFriend): void;
  (e: 'open-contact', f: DbFriend): void;
}>();

const crmTags = computed(() =>
  Array.isArray(props.friend?.crmTagsPerNick) ? props.friend!.crmTagsPerNick : [],
);
const zaloLabels = computed(() => {
  const list = props.friend?.zaloLabels;
  if (!Array.isArray(list)) return [] as { name: string; color?: string }[];
  return list.filter((l): l is { name: string; color?: string } => !!l && typeof l.name === 'string');
});

// Note: `initials` cũ đã thay bởi customerInitials từ use-friend-display.ts — B7 fix

const CUSTOMER_PALETTE = ['av-c1', 'av-c2', 'av-c3', 'av-c4', 'av-c5', 'av-c6', 'av-c7'];
function avatarClass(f: DbFriend): string {
  const id = f.contactId || f.id;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CUSTOMER_PALETTE[h % CUSTOMER_PALETTE.length];
}

function age(year?: number | null): number | null {
  if (!year) return null;
  return new Date().getFullYear() - year;
}
function genderShort(g: string | null): string {
  if (!g) return '';
  return g === 'male' ? 'Nam' : g === 'female' ? 'Nữ' : g;
}

function kbClass(kind: string): string {
  const m: Record<string, string> = { friend: 'success', pending_friend: 'warn', chatting_stranger: 'info', ghost: 'grey' };
  return m[kind] ?? 'grey';
}
function kbLabel(kind: string): string {
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

function formatDate(iso: string): string {
  return formatInOrgTz(iso, undefined, { dateOnly: true });
}
function daysSince(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hôm qua';
  return `${days} ngày trước`;
}
</script>

<style scoped>
.panel-overlay {
  position: fixed; inset: 0;
  background: rgba(15,20,25,.18);
  z-index: 49;
}
.side-panel {
  position: fixed;
  top: var(--smax-topnav-h, 52px);
  right: 0; bottom: 0;
  width: 380px; max-width: 100vw;
  background: var(--surface);
  border-left: 1px solid var(--line);
  box-shadow: -8px 0 30px rgba(0,0,0,.08);
  transform: translateX(100%);
  transition: transform .25s;
  display: flex; flex-direction: column;
  z-index: 50;
}
.side-panel.open { transform: translateX(0); }

@media (max-width: 768px) {
  .side-panel { width: 100vw; top: 0; }
}

.panel-head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  display: flex; align-items: center; gap: 10px;
}
.panel-head .av {
  width: 40px; height: 40px; border-radius: 50%;
  color: #fff; display: grid; place-items: center;
  font-weight: 700;
  overflow: hidden; /* clip img tròn */
}
.panel-head .av img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.panel-head h3 { margin: 0; font-size: 14px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel-head .close {
  background: transparent; border: none;
  font-size: 18px; color: var(--ink-4); cursor: pointer;
  width: 28px; height: 28px; border-radius: 5px;
  font-family: inherit;
}
.panel-head .close:hover { background: var(--surface-2); }

.panel-body { flex: 1; overflow-y: auto; padding: 14px 16px; font-size: 13px; }
.panel-section { margin-bottom: 16px; }
.panel-section h5 {
  font-size: 11px; color: var(--ink-4);
  text-transform: uppercase; letter-spacing: .04em;
  margin: 0 0 6px; font-weight: 700;
}

.kv { display: flex; padding: 4px 0; border-bottom: 1px dashed var(--line); }
.kv:last-child { border-bottom: none; }
.kv .k { color: var(--ink-4); width: 110px; font-size: 12px; flex-shrink: 0; }
.kv .v { flex: 1; }

.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: var(--r-pill);
  font-size: 11px; font-weight: 600;
}
.badge.success { background: var(--success-soft); color: #166534; }
.badge.warn { background: var(--warning-soft); color: #92400e; }
.badge.info { background: #cffafe; color: #155e75; }
.badge.grey { background: var(--surface-3); color: #475569; }
.badge.hot { background: var(--error-soft); color: var(--error); }
.badge.cold { background: #dbeafe; color: #1e40af; }
.badge.won { background: var(--success-soft); color: var(--success); }

.tag-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.tag-chip {
  padding: 2px 8px; border-radius: var(--r-sm);
  background: var(--surface-2); border: 1px solid var(--line);
  font-size: 11px; color: var(--ink-2);
}
.tag-chip.red { background: var(--error-soft); color: #991b1b; border-color: transparent; }
.tag-chip.green { background: var(--success-soft); color: #166534; border-color: transparent; }
.tag-chip.blue { background: #dbeafe; color: #1e40af; border-color: transparent; }
.tag-chip.yellow { background: #fef9c3; color: #854d0e; border-color: transparent; }
.tag-chip.purple { background: #ede9fe; color: #5b21b6; border-color: transparent; }

.panel-foot {
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  background: var(--surface-2);
  display: flex; gap: 6px;
}
.panel-foot .btn {
  flex: 1;
  padding: 7px 10px; border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--surface); color: var(--ink);
  font-weight: 600; font-size: 12px;
  cursor: pointer; font-family: inherit;
}
.panel-foot .btn:hover { background: var(--surface-2); }
.panel-foot .btn.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.panel-foot .btn.primary:hover { background: var(--brand-600); }

.av-c1 { background: linear-gradient(135deg, #2f6ee5, #1d4ed8); }
.av-c2 { background: linear-gradient(135deg, #16a34a, #15803d); }
.av-c3 { background: linear-gradient(135deg, #d97706, #b45309); }
.av-c4 { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
.av-c5 { background: linear-gradient(135deg, #db2777, #be185d); }
.av-c6 { background: linear-gradient(135deg, #0891b2, #0e7490); }
.av-c7 { background: linear-gradient(135deg, #ea580c, #c2410c); }
</style>
