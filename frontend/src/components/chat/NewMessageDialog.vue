<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="680">
    <v-card>
      <v-card-title class="dialog-title">
        <div class="title-row">
          <v-icon class="mr-2" color="primary">mdi-message-plus</v-icon>
          <span>Tin nhắn mới</span>
        </div>
        <button
          class="close-x"
          title="Đóng"
          @click="$emit('update:modelValue', false)"
        >×</button>
      </v-card-title>

      <!-- Section 1: Chọn nick CRM — adaptive (chips khi ít, autocomplete khi nhiều) -->
      <div class="section-nick">
        <div class="section-label">
          <v-icon size="14">mdi-account-arrow-right</v-icon>
          <span>Gửi từ nick</span>
          <span class="nick-count">({{ accounts.length }} nick)</span>
          <span v-if="accounts.length === 0" class="hint-warn">— chưa có nick CRM nào</span>
        </div>

        <!-- Mode 1: ≤ 4 nick → chip group visual -->
        <div v-if="accounts.length && accounts.length <= 4" class="nick-chip-row">
          <button
            v-for="a in accounts"
            :key="a.id"
            class="nick-chip"
            :class="{ active: selectedAccountId === a.id }"
            :title="a.displayName || 'Nick'"
            @click="onPickNick(a.id)"
          >
            <Avatar
              :src="a.avatarUrl"
              :name="a.displayName || 'Nick'"
              :size="22"
              :gradient-seed="a.id"
              platform="zalo"
            />
            <span class="nick-name">{{ a.displayName || 'Nick' }}</span>
            <v-icon v-if="selectedAccountId === a.id" size="14" color="primary">mdi-check-circle</v-icon>
          </button>
        </div>

        <!-- Mode 2: > 4 nick → autocomplete để scale 20-30+ nick -->
        <div v-else-if="accounts.length > 4" class="nick-select-wrap">
          <!-- Chip đang chọn (visual) -->
          <div v-if="selectedAccount" class="nick-selected-chip">
            <Avatar :src="selectedAccount.avatarUrl" :name="selectedAccount.displayName || 'Nick'" :size="22" :gradient-seed="selectedAccount.id" platform="zalo" />
            <span class="nick-name">{{ selectedAccount.displayName || 'Nick' }}</span>
            <button class="nick-clear" title="Đổi nick" @click="selectedAccountId = null; clearResults()">×</button>
          </div>
          <!-- Searchable picker -->
          <v-autocomplete
            v-else
            :items="accounts"
            item-title="displayName"
            item-value="id"
            :model-value="selectedAccountId"
            placeholder="🔎 Tìm nick CRM (gõ tên)…"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            menu-icon="mdi-chevron-down"
            no-data-text="Không tìm thấy nick nào"
            @update:model-value="onPickNick"
          >
            <template #item="slotProps">
              <v-list-item v-bind="slotProps.props" :title="undefined">
                <div class="nick-option">
                  <Avatar :src="rawAcc(slotProps).avatarUrl" :name="rawAcc(slotProps).displayName || 'Nick'" :size="28" :gradient-seed="rawAcc(slotProps).id" platform="zalo" />
                  <div class="nick-option-body">
                    <div class="nick-option-name">{{ rawAcc(slotProps).displayName || 'Nick chưa đặt tên' }}</div>
                  </div>
                </div>
              </v-list-item>
            </template>
          </v-autocomplete>
        </div>
      </div>

      <!-- Section 2: Search -->
      <div class="section-search">
        <v-text-field
          v-model="query"
          :placeholder="selectedAccountId
            ? `Tìm KH: tên / SĐT / UID / @username / globalId`
            : 'Chọn nick trước khi tìm…'"
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="mdi-magnify"
          hide-details="auto"
          :disabled="!selectedAccountId"
          autofocus
          @input="onSearchInput"
        />
      </div>

      <!-- Section 3: Kết quả -->
      <div class="section-results">
        <div class="result-list">
          <div v-if="searching" class="text-center text-grey pa-3">
            <v-progress-circular indeterminate size="20" />
          </div>
          <div v-else-if="!selectedAccountId" class="text-grey text-caption pa-3 text-center">
            Chọn nick CRM để tìm KH
          </div>

          <!-- Tier 1: Friend rows của NICK NÀY (KH nick này đang chăm) -->
          <div v-if="friendRows.length" class="result-section">
            <div class="result-section-title">
              <v-icon size="14" color="success">mdi-account-multiple-check</v-icon>
              {{ accountTitle }} đang chăm ({{ friendRows.length }})
            </div>
            <button
              v-for="f in friendRows"
              :key="f.id"
              class="row-card"
              :class="{ active: pickedKind === 'friend' && pickedId === f.id }"
              @click="pickFriend(f)"
            >
              <Avatar
                :src="f.zaloAvatarUrl"
                :name="f.zaloDisplayName || f.contact?.fullName || 'KH'"
                :size="38"
                :gradient-seed="f.id"
                platform="zalo"
              />
              <div class="row-body">
                <div class="row-name">
                  {{ f.zaloDisplayName || f.contact?.fullName || `KH-${f.zaloUidInNick.slice(-4)}` }}
                  <span v-if="!f.hasConversation" class="badge badge-warn" title="Chỉ kết bạn Zalo, chưa từng nhắn 1-1">chỉ KB</span>
                  <span v-else class="badge badge-ok" title="Đã có chat 1-1">đang chat</span>
                </div>
                <div class="row-meta">
                  <span v-if="f.contact?.phone">📞 {{ f.contact.phone }}</span>
                  <span class="uid">UID: {{ f.zaloUidInNick }}</span>
                </div>
              </div>
              <v-icon v-if="pickedKind === 'friend' && pickedId === f.id" color="primary">mdi-check-circle</v-icon>
            </button>
          </div>

          <!-- Tier 2: Contact đã có trong CRM (org-wide, qua phone/uid/globalId/username) -->
          <div v-if="contactRows.length" class="result-section">
            <div class="result-section-title">
              <v-icon size="14" color="info">mdi-account-search</v-icon>
              Đã có trong CRM ({{ contactRows.length }}) — chưa gắn vào nick này
            </div>
            <div
              v-for="c in contactRows"
              :key="c.id"
              class="row-card row-card--contact"
              :class="{ active: pickedKind === 'contact' && pickedId === c.id }"
              @click="pickContact(c)"
            >
              <Avatar
                :src="c.avatarUrl"
                :name="c.crmName || c.fullName || 'KH'"
                :size="38"
                :gradient-seed="c.id"
              />
              <div class="row-body">
                <div class="row-name">{{ c.crmName || c.fullName || 'KH chưa đặt tên' }}</div>
                <div class="row-meta">
                  <span v-if="c.phone">📞 {{ c.phone }}</span>
                  <span v-if="c.assignedUser" class="meta-sale">👤 {{ c.assignedUser.fullName }}</span>
                  <span v-if="c.statusRef" class="meta-status" :style="{ color: c.statusRef.color || undefined }">⬤ {{ c.statusRef.name }}</span>
                  <span v-if="c.leadScore">⭐ {{ c.leadScore }}</span>
                </div>
                <div class="row-keys">
                  <span v-if="c.zaloGlobalId" class="key" title="Zalo globalId (toàn cục)">G:{{ c.zaloGlobalId.slice(0, 8) }}…</span>
                  <span v-if="c.zaloUsername" class="key" title="Zalo username">@{{ c.zaloUsername }}</span>
                  <span v-if="c.zaloUid" class="key" title="zaloUid (per-nick chính)">UID:{{ c.zaloUid.slice(-6) }}</span>
                  <span v-if="(c.tags as string[])?.length" class="row-tags">
                    <span v-for="t in (c.tags as string[]).slice(0, 3)" :key="t" class="tag-mini">{{ t }}</span>
                  </span>
                </div>
              </div>
              <v-icon v-if="pickedKind === 'contact' && pickedId === c.id" color="primary">mdi-check-circle</v-icon>
            </div>
          </div>

          <!-- Tier 3: Zalo lookup discovered (KH hoàn toàn mới) -->
          <div v-if="lookupResult?.found" class="result-section">
            <div class="result-section-title">
              <v-icon size="14" color="warning">mdi-account-plus</v-icon>
              Discover qua Zalo (chưa có trong CRM)
            </div>
            <button
              class="row-card row-card--lookup"
              :class="{ active: pickedKind === 'lookup' }"
              @click="pickedKind = 'lookup'; pickedId = null"
            >
              <Avatar
                :src="lookupResult.avatar"
                :name="lookupResult.zaloName || `KH-${lookupResult.uid.slice(-4)}`"
                :size="38"
                :gradient-seed="lookupResult.uid"
                platform="zalo"
              />
              <div class="row-body">
                <div class="row-name">
                  {{ lookupResult.zaloName || `KH-${lookupResult.uid.slice(-4)}` }}
                  <span class="badge badge-new">KH mới</span>
                </div>
                <div class="row-meta">
                  <span>📞 {{ lookupResult.phone }}</span>
                  <span class="uid">UID {{ accountTitle }} nhìn: {{ lookupResult.uid }}</span>
                </div>
                <div v-if="lookupResult.globalId || lookupResult.username" class="row-keys">
                  <span v-if="lookupResult.globalId" class="key">G:{{ lookupResult.globalId.slice(0, 8) }}…</span>
                  <span v-if="lookupResult.username" class="key">@{{ lookupResult.username }}</span>
                </div>
              </div>
              <v-icon v-if="pickedKind === 'lookup'" color="primary">mdi-check-circle</v-icon>
            </button>
          </div>

          <!-- Empty / hint / lookup trigger -->
          <div v-if="!searching && !friendRows.length && !contactRows.length && !lookupResult && selectedAccountId" class="pa-3">
            <div v-if="!query" class="text-grey text-caption text-center">
              Gõ tên / SĐT / UID / globalId để tìm
            </div>
            <div v-else-if="lookingUp" class="text-grey text-caption text-center">
              <v-progress-circular indeterminate size="16" class="mr-2" />
              Đang tra SĐT trên Zalo qua nick {{ accountTitle }}…
            </div>
            <div v-else-if="lookupNotFound" class="text-grey text-caption text-center">
              ⚠ {{ lookupNotFound }}
            </div>
            <button
              v-else-if="isPhoneQuery"
              class="lookup-trigger"
              :disabled="lookingUp"
              @click="runZaloLookup"
            >
              🔍 Tra Zalo cho SĐT "{{ query }}" từ nick {{ accountTitle }}
              <div class="trigger-hint">UID Zalo per-nick — cùng KH ra UID khác nhau mỗi nick</div>
            </button>
            <div v-else class="text-grey text-caption text-center">
              Không match KH nào. Nếu là SĐT (≥9 số), gõ đủ để tra Zalo.
            </div>
          </div>
        </div>

        <!-- Pick contact: "Tạo KH mới" vs "Gắn vào KH đã chọn ở trên" — chỉ hiện khi lookup -->
        <div v-if="pickedKind === 'lookup' && lookupResult" class="mt-3 commit-options">
          <div class="commit-title">Sau khi mở chat, KH này sẽ:</div>
          <v-radio-group v-model="lookupCommitMode" hide-details density="compact">
            <v-radio value="create" label="Tạo Contact MỚI trong CRM" />
            <v-radio
              v-for="c in contactRows"
              :key="c.id"
              :value="`attach:${c.id}`"
              :label="`Gắn vào KH có sẵn: ${c.crmName || c.fullName || 'KH'}${c.phone ? ' (' + c.phone + ')' : ''}`"
            />
          </v-radio-group>
        </div>
      </div>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Hủy</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!canOpen || opening"
          :loading="opening"
          @click="onOpenChat"
        >
          {{ openButtonLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Avatar from '@/components/ui/Avatar.vue';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';

interface AccountLite { id: string; displayName: string | null; avatarUrl?: string | null }
interface FriendRow {
  id: string;
  zaloUidInNick: string;
  zaloDisplayName: string | null;
  zaloAvatarUrl: string | null;
  hasConversation: boolean;
  relationshipKind: string;
  contact?: { id: string; fullName: string | null; phone: string | null } | null;
}
interface ContactRow {
  id: string;
  fullName: string | null;
  crmName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  zaloUid: string | null;
  zaloGlobalId: string | null;
  zaloUsername: string | null;
  leadScore: number;
  tags: unknown;
  statusRef?: { id: string; name: string; color: string | null } | null;
  assignedUser?: { id: string; fullName: string | null } | null;
}
interface LookupResult {
  found: boolean;
  uid: string;
  zaloName: string | null;
  username: string | null;
  globalId: string | null;
  avatar: string | null;
  phone: string;
}

const props = defineProps<{
  modelValue: boolean;
  accounts: AccountLite[];
  defaultAccountId?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [v: boolean];
  opened: [conversationId: string];
}>();

const toast = useToast();

const selectedAccount = computed(() =>
  props.accounts.find(a => a.id === selectedAccountId.value) || null,
);

// Vuetify v-autocomplete slot #item: type của item là { raw, value, title }
// nhưng version khác nhau giữa local/docker. Cast 'any' rồi pull raw cho an toàn.
function rawAcc(slotProps: { item: { raw?: AccountLite } | AccountLite }): AccountLite {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item = slotProps.item as any;
  return (item?.raw ?? item) as AccountLite;
}
const accountTitle = computed(() => selectedAccount.value?.displayName || 'nick');

const selectedAccountId = ref<string | null>(props.defaultAccountId ?? null);
const query = ref('');
const friendRows = ref<FriendRow[]>([]);
const contactRows = ref<ContactRow[]>([]);
const searching = ref(false);
const pickedKind = ref<'friend' | 'contact' | 'lookup' | null>(null);
const pickedId = ref<string | null>(null);
const opening = ref(false);

const lookupResult = ref<LookupResult | null>(null);
const lookingUp = ref(false);
const lookupNotFound = ref<string | null>(null);
const lookupCommitMode = ref<string>('create'); // 'create' | 'attach:<contactId>'

const isPhoneQuery = computed(() => {
  const digits = query.value.replace(/[^\d]/g, '');
  return digits.length >= 9 && digits.length <= 12;
});

const canOpen = computed(() => {
  if (pickedKind.value === 'friend') return !!pickedId.value;
  if (pickedKind.value === 'contact') return !!pickedId.value;
  if (pickedKind.value === 'lookup') return !!lookupResult.value?.found;
  return false;
});

const openButtonLabel = computed(() => {
  if (pickedKind.value === 'friend') return 'Mở chat';
  if (pickedKind.value === 'contact') return 'Bắt đầu chat & gắn vào nick này';
  if (pickedKind.value === 'lookup') {
    return lookupCommitMode.value === 'create'
      ? 'Tạo KH + Bắt đầu chat'
      : 'Gắn vào KH có sẵn + Bắt đầu chat';
  }
  return 'Mở chat';
});

function clearResults() {
  friendRows.value = [];
  contactRows.value = [];
  pickedKind.value = null;
  pickedId.value = null;
  lookupResult.value = null;
  lookupNotFound.value = null;
  lookupCommitMode.value = 'create';
}
function resetState() {
  selectedAccountId.value = props.defaultAccountId
    ?? (props.accounts.length === 1 ? props.accounts[0].id : null);
  query.value = '';
  clearResults();
}

watch(() => props.modelValue, (v) => { if (v) resetState(); });

function pickFriend(f: FriendRow) {
  pickedKind.value = 'friend';
  pickedId.value = f.id;
}
function pickContact(c: ContactRow) {
  pickedKind.value = 'contact';
  pickedId.value = c.id;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  lookupResult.value = null;
  lookupNotFound.value = null;
  pickedKind.value = null;
  pickedId.value = null;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(), 250);
}
// User click chip nick — KHÔNG đụng selectedAccountId (đã set ở @click handler).
// Chỉ clear kết quả search cũ + retrigger search nếu có query.
function onPickNick(id: string) {
  if (selectedAccountId.value === id) return;
  selectedAccountId.value = id;
  clearResults();
  if (query.value.trim()) runSearch();
}

async function runSearch() {
  if (!selectedAccountId.value || !query.value.trim()) {
    friendRows.value = [];
    contactRows.value = [];
    return;
  }
  searching.value = true;
  try {
    // Song song: search Friend (per-nick) + Contact (org-wide)
    const [fRes, cRes] = await Promise.all([
      api.get<{ friends?: FriendRow[] }>(
        `/zalo-accounts/${selectedAccountId.value}/friends-db`,
        { params: { kind: 'all', page: 1, limit: 20, search: query.value } },
      ),
      api.get<{ contacts?: ContactRow[] }>(`/contacts`, {
        params: { search: query.value, limit: 10, page: 1 },
      }),
    ]);
    const fs = fRes.data?.friends || [];
    const cs = cRes.data?.contacts || [];
    // De-dup: bỏ Contact đã có Friend với nick này (đã hiện ở Tier 1)
    const friendContactIds = new Set(fs.map(f => f.contact?.id).filter(Boolean));
    friendRows.value = fs;
    contactRows.value = cs.filter(c => !friendContactIds.has(c.id));
  } catch (err) {
    console.error('[NewMessageDialog] search failed:', err);
    friendRows.value = [];
    contactRows.value = [];
  } finally {
    searching.value = false;
  }
}

async function runZaloLookup() {
  if (!selectedAccountId.value || !isPhoneQuery.value) return;
  lookingUp.value = true;
  lookupNotFound.value = null;
  try {
    const res = await api.post<LookupResult & { reason?: string; detail?: string }>(
      `/zalo-accounts/${selectedAccountId.value}/friends/lookup-by-phone`,
      { phone: query.value },
    );
    if (!res.data?.found) {
      lookupNotFound.value = res.data?.detail || 'Không tra được trên Zalo';
      return;
    }
    lookupResult.value = res.data;
    pickedKind.value = 'lookup';

    // Server-side exhaustive resolve: globalId → username → uid → phone (canonical).
    // Trước đây check trong contactRows (top 10) — có thể miss. Giờ check toàn bộ DB.
    try {
      const resolveRes = await api.post<{ matched: boolean; by?: string; contact?: ContactRow }>(
        '/contacts/resolve-by-keys',
        {
          zaloGlobalId: res.data.globalId,
          zaloUsername: res.data.username,
          zaloUid: res.data.uid,
          phone: res.data.phone,
        },
      );
      if (resolveRes.data?.matched && resolveRes.data.contact) {
        const c = resolveRes.data.contact;
        // Inject Contact vào contactRows nếu chưa có (để radio option hiển thị)
        if (!contactRows.value.some(x => x.id === c.id)) contactRows.value = [c, ...contactRows.value];
        lookupCommitMode.value = `attach:${c.id}`;
      } else {
        lookupCommitMode.value = 'create';
      }
    } catch {
      lookupCommitMode.value = 'create';
    }
  } catch (err) {
    const msg = (err as { response?: { data?: { detail?: string } } })
      .response?.data?.detail || 'Lookup thất bại';
    lookupNotFound.value = msg;
  } finally {
    lookingUp.value = false;
  }
}

async function onOpenChat() {
  if (!selectedAccountId.value) return;
  opening.value = true;
  try {
    if (pickedKind.value === 'friend' && pickedId.value) {
      // KH đã có Friend với nick này → mở conv (idempotent ensure)
      const res = await api.post<{ conversationId: string; created: boolean }>(
        `/friends/${pickedId.value}/ensure-conversation`, {},
      );
      if (res.data?.created) toast.success('Đã tạo cuộc trò chuyện mới');
      emit('opened', res.data.conversationId);
    } else if (pickedKind.value === 'contact' && pickedId.value) {
      // Contact đã có trong CRM, nhưng nick này chưa có Friend với KH.
      // Cần lookup Zalo trước để biết UID per-nick — KHÔNG dùng Contact.zaloUid
      // vì đó là UID per-viewer của nick KHÁC (sẽ không gửi tin được từ nick này).
      const c = contactRows.value.find(x => x.id === pickedId.value);
      if (!c?.phone) {
        toast.error('KH này chưa có SĐT → không lookup được UID từ nick này');
        return;
      }
      // Lookup-by-phone để lấy UID per-nick
      const luRes = await api.post<LookupResult & { reason?: string; detail?: string }>(
        `/zalo-accounts/${selectedAccountId.value}/friends/lookup-by-phone`,
        { phone: c.phone },
      );
      if (!luRes.data?.found) {
        toast.error(`Nick ${accountTitle.value} không tra được SĐT này trên Zalo: ${luRes.data?.detail || ''}`);
        return;
      }
      const res = await api.post<{ conversationId: string; created: boolean }>(
        '/conversations/ensure-by-uid',
        {
          zaloAccountId: selectedAccountId.value,
          uid: luRes.data.uid,
          commit: true,
          contactMode: `attach:${c.id}`,
          zaloName: luRes.data.zaloName,
          zaloAvatarUrl: luRes.data.avatar,
          zaloGlobalId: luRes.data.globalId,
          zaloUsername: luRes.data.username,
          phone: luRes.data.phone,
        },
      );
      toast.success('Đã gắn KH vào nick này và mở chat');
      emit('opened', res.data.conversationId);
    } else if (pickedKind.value === 'lookup' && lookupResult.value) {
      const r = lookupResult.value;
      const res = await api.post<{ conversationId: string; created: boolean }>(
        '/conversations/ensure-by-uid',
        {
          zaloAccountId: selectedAccountId.value,
          uid: r.uid,
          commit: true,
          contactMode: lookupCommitMode.value,
          zaloName: r.zaloName,
          zaloAvatarUrl: r.avatar,
          zaloGlobalId: r.globalId,
          zaloUsername: r.username,
          phone: r.phone,
        },
      );
      toast.success(lookupCommitMode.value === 'create' ? 'Đã tạo KH + chat' : 'Đã gắn KH có sẵn + chat');
      emit('opened', res.data.conversationId);
    } else {
      return;
    }
    emit('update:modelValue', false);
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Không mở được chat';
    toast.error(msg);
  } finally {
    opening.value = false;
  }
}
</script>

<style scoped>
.dialog-title {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.title-row { display: flex; align-items: center; font-size: 16px; font-weight: 600; }
.close-x {
  width: 28px; height: 28px;
  border: none; background: transparent;
  font-size: 22px; line-height: 1;
  color: var(--smax-grey-700);
  cursor: pointer; border-radius: 50%;
}
.close-x:hover { background: var(--smax-grey-100); }

/* Section 1: nick selector — chip group cho compact + visual */
.section-nick { padding: 12px 16px 8px; }
.section-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 600;
  color: var(--smax-grey-700);
  text-transform: uppercase; letter-spacing: 0.3px;
  margin-bottom: 6px;
}
.hint-warn { color: var(--smax-warning); text-transform: none; font-weight: 500; }
.nick-chip-row {
  display: flex; gap: 6px;
  flex-wrap: wrap;
}
.nick-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px 4px 5px;
  background: var(--smax-grey-100);
  border: 1.5px solid transparent;
  border-radius: 18px;
  font-size: 12.5px; font-weight: 500;
  color: var(--smax-text);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
}
.nick-chip:hover { background: var(--smax-grey-50); border-color: var(--smax-grey-300); }
.nick-chip.active {
  background: var(--smax-primary-soft);
  border-color: var(--smax-primary);
  color: var(--smax-primary);
  font-weight: 600;
}
.nick-chip .nick-name {
  max-width: 140px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nick-count {
  color: var(--smax-grey-300);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

/* Autocomplete mode (> 4 nicks) */
.nick-select-wrap { max-width: 100%; }
.nick-selected-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 6px 6px 8px;
  background: var(--smax-primary-soft);
  border: 1.5px solid var(--smax-primary);
  border-radius: 20px;
  font-size: 13px; font-weight: 600;
  color: var(--smax-primary);
}
.nick-selected-chip .nick-name {
  max-width: 200px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nick-clear {
  width: 22px; height: 22px;
  border: none; background: rgba(255,255,255,0.6);
  border-radius: 50%; cursor: pointer;
  font-size: 16px; line-height: 1;
  color: var(--smax-grey-700);
}
.nick-clear:hover { background: white; color: var(--smax-error); }

.nick-option {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 0;
  width: 100%;
}
.nick-option-body { flex: 1; min-width: 0; }
.nick-option-name {
  font-weight: 500; font-size: 13.5px;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Section 2: search */
.section-search { padding: 4px 16px 8px; }

/* Section 3: results */
.section-results { padding: 4px 16px 12px; }
.result-list {
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid var(--smax-grey-200);
  border-radius: 8px;
  background: var(--smax-grey-50);
}
.result-section + .result-section { border-top: 1px solid var(--smax-grey-200); }
.result-section-title {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  font-size: 11px; font-weight: 600;
  color: var(--smax-grey-700);
  text-transform: uppercase; letter-spacing: 0.3px;
  background: var(--smax-grey-100);
}
.row-card {
  width: 100%;
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 11px;
  background: var(--smax-bg);
  border: none;
  border-bottom: 1px solid var(--smax-grey-100);
  cursor: pointer; text-align: left;
  font-family: inherit;
}
.row-card:last-child { border-bottom: none; }
.row-card:hover { background: var(--smax-grey-50); }
.row-card.active { background: var(--smax-primary-soft); }
.row-card--contact { background: rgba(33,150,243,0.03); }
.row-card--lookup { background: rgba(255,145,0,0.05); }
.row-body { flex: 1; min-width: 0; }
.row-name {
  font-weight: 600; font-size: 13px;
  color: var(--smax-text);
  display: flex; align-items: center; gap: 6px;
}
.row-meta, .row-keys {
  font-size: 11px; color: var(--smax-grey-700);
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-top: 2px;
}
.row-meta .uid, .key {
  font-family: ui-monospace, monospace;
  background: var(--smax-grey-100);
  padding: 0 4px; border-radius: 3px;
  font-size: 10.5px;
}
.meta-sale { color: #0277bd; }
.meta-status { font-weight: 600; }
.row-tags { display: inline-flex; gap: 3px; }
.tag-mini {
  background: var(--smax-grey-100);
  padding: 0 5px; border-radius: 8px;
  font-size: 10px;
}
.badge {
  display: inline-block;
  font-size: 9.5px; font-weight: 700;
  padding: 1px 6px; border-radius: 4px;
  vertical-align: middle;
  text-transform: uppercase;
}
.badge-warn { background: rgba(255,145,0,0.18); color: #ef6c00; }
.badge-ok   { background: rgba(0,200,83,0.15);  color: #00897b; }
.badge-new  { background: var(--smax-warning, #ff9100); color: white; }

.lookup-trigger {
  display: block; width: 100%;
  padding: 12px;
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  border: 1px dashed var(--smax-primary);
  border-radius: 8px;
  font-size: 12.5px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.lookup-trigger:hover { background: var(--smax-primary); color: white; }
.lookup-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
.trigger-hint {
  font-size: 10px; font-weight: 400;
  opacity: 0.8; margin-top: 3px;
}

.commit-options {
  background: rgba(33,150,243,0.05);
  border-left: 3px solid var(--smax-primary);
  padding: 8px 12px;
  border-radius: 4px;
}
.commit-title {
  font-size: 12px; font-weight: 600;
  color: var(--smax-grey-700);
  margin-bottom: 4px;
}
</style>
