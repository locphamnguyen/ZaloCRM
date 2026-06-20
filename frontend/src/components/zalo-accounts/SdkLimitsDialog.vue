<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  SdkLimitsDialog.vue — 2026-06-06 (Anh chốt).
  Cài đặt TRẦN an toàn SDK Zalo: tab "Mặc định hệ thống" (org default, áp mọi nick) +
  tab "Theo nick" (ghi đè riêng, ưu tiên hơn mặc định). Mọi automation/trigger/sequence/
  broadcast load trần từ đây. API: GET/PUT /api/v1/zalo-accounts/sdk-limits...
-->
<template>
  <div :class="embedded ? 'sdk-embed' : 'sdk-overlay'" @click.self="!embedded && $emit('close')">
    <div class="sdk-sheet">
      <div class="sh-head">
        <div class="ic">🛡️</div>
        <div>
          <h2>Cài đặt trần an toàn SDK Zalo</h2>
          <div class="sub">Giới hạn số lượt mỗi loại thao tác / nick / ngày để tránh Zalo khoá nick</div>
        </div>
        <button v-if="!embedded" class="x" @click="$emit('close')">✕</button>
      </div>

      <div class="scope">
        <div class="tab" :class="{ on: tab === 'org' }" @click="tab = 'org'">🌐 Mặc định hệ thống</div>
        <div class="tab" :class="{ on: tab === 'nick' }" @click="tab = 'nick'">
          📱 Theo nick<span v-if="overrideNickCount > 0" class="badge">{{ overrideNickCount }} nick ghi đè</span>
        </div>
      </div>

      <div v-if="loading" class="body"><div class="muted">Đang tải...</div></div>

      <!-- TAB ORG DEFAULT -->
      <div v-else-if="tab === 'org'" class="body">
        <div class="info">ℹ️ <div><b>Trần mặc định</b> áp cho TẤT CẢ nick. Nick nào cần khác thì sang tab "Theo nick" ghi đè riêng — <b>ưu tiên giá trị của nick, không có thì dùng mặc định này</b>. Mọi chiến dịch (Mục tiêu, Luồng kịch bản, Gửi hàng loạt) đều tuân theo trần này.</div></div>
        <div class="colhead"><div></div><div class="h">Trần / ngày</div><div class="h">Burst</div></div>
        <div v-for="g in GROUPS" :key="g.title" class="grp">
          <div class="grp-h">{{ g.title }}</div>
          <div v-for="cat in g.cats" :key="cat" class="lim">
            <div class="meta"><div class="nm">{{ CAT_LABEL[cat].nm }}</div><div class="ds">{{ cat }} · {{ CAT_LABEL[cat].ds }}</div></div>
            <div class="inp"><input type="number" min="0" v-model.number="orgForm[cat].daily"><span class="u">/ngày</span></div>
            <div class="inp"><input type="number" min="0" v-model.number="orgForm[cat].burst"><span class="u">/lần</span></div>
          </div>
        </div>
      </div>

      <!-- TAB NICK OVERRIDE -->
      <div v-else class="body">
        <div class="ovr-bar">⚙️ Chỉnh trần riêng cho nick:
          <select v-model="selectedNickId" @change="loadNickForm">
            <option v-for="n in nicks" :key="n.id" :value="n.id">{{ n.displayName || n.id.slice(0,8) }}</option>
          </select>
        </div>
        <div class="info amber">💡 Ô có giá trị = <b>ghi đè</b> (ưu tiên hơn mặc định). Để trống = theo mặc định hệ thống. Xoá ô để bỏ ghi đè.</div>
        <div class="colhead"><div></div><div class="h">Trần / ngày</div><div class="h">Nguồn</div></div>
        <div v-for="g in GROUPS" :key="g.title" class="grp">
          <div class="grp-h">{{ g.title }}</div>
          <div v-for="cat in g.cats" :key="cat" class="lim">
            <div class="meta"><div class="nm">{{ CAT_LABEL[cat].nm }}</div><div class="ds">{{ cat }}</div></div>
            <div class="inp">
              <input type="number" min="0" v-model.number="nickForm[cat]"
                     :placeholder="`mặc định ${orgForm[cat]?.daily ?? '—'}`"
                     :class="{ ovr: nickForm[cat] != null && nickForm[cat] !== '' }">
              <span class="u">/ngày</span>
            </div>
            <div>
              <span v-if="nickForm[cat] != null && nickForm[cat] !== ''" class="badge-ovr">GHI ĐÈ ✎</span>
              <span v-else class="badge-def">THEO MẶC ĐỊNH</span>
            </div>
          </div>
        </div>
      </div>

      <div class="foot">
        <span v-if="saveStatus === 'saved'" class="toast ok">✓ Đã lưu</span>
        <span v-else-if="saveStatus === 'error'" class="toast err">⚠ {{ saveError }}</span>
        <span v-else class="hint">💾 Lưu xong áp dụng ngay cho mọi chiến dịch đang chạy.</span>
        <span class="spacer"></span>
        <button v-if="tab === 'nick'" class="btn" :disabled="saving" @click="clearNickOverrides">Xoá hết ghi đè nick này</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? 'Đang lưu...' : (tab === 'org' ? 'Lưu trần hệ thống' : 'Lưu trần cho nick') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api/index';

// embedded = render thành panel trong trang Cài đặt (không overlay/dim, không nút ✕). 2026-06-18.
const props = defineProps<{ nicks: Array<{ id: string; displayName: string | null }>; embedded?: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

type Cat = 'message' | 'reaction' | 'chat_action' | 'group_admin' | 'group_read' | 'friend_action' | 'friend_lookup' | 'contact_sync' | 'friend_read' | 'profile' | 'query';
const CAT_LABEL: Record<string, { nm: string; ds: string }> = {
  friend_action: { nm: 'Gửi lời mời kết bạn', ds: 'gửi/thu hồi lời mời' },
  // 2026-06-06 (Anh chốt) — tách findUser + đồng bộ danh bạ riêng.
  friend_lookup: { nm: 'Tìm SĐT → UID', ds: 'findUser — tìm khách cho chiến dịch' },
  contact_sync: { nm: 'Đồng bộ danh bạ', ds: 'getAllFriends — tải bạn bè từ Zalo (chạy nền)' },
  friend_read: { nm: 'Đọc khác (lời mời/gợi ý)', ds: 'online, recommendations, sent-requests' },
  message: { nm: 'Gửi tin nhắn', ds: 'tin sale + bot gửi đi' },
  reaction: { nm: 'Thả cảm xúc', ds: 'tim, like, hoa...' },
  chat_action: { nm: 'Thao tác hội thoại', ds: 'đọc, gõ, ghim...' },
  query: { nm: 'Xem thông tin', ds: 'getUserInfo — read-only' },
  profile: { nm: 'Cập nhật hồ sơ nick', ds: 'avatar, tên...' },
  group_read: { nm: 'Đọc nhóm', ds: 'thành viên, tin nhóm' },
  group_admin: { nm: 'Quản trị nhóm', ds: 'thêm/xoá thành viên' },
};
const GROUPS = [
  { title: '🤝 Kết bạn & tìm khách', cats: ['friend_action', 'friend_lookup', 'contact_sync', 'friend_read'] as Cat[] },
  { title: '💌 Tin nhắn & tương tác', cats: ['message', 'reaction', 'chat_action'] as Cat[] },
  { title: '🔍 Đọc thông tin', cats: ['query', 'profile'] as Cat[] },
  { title: '👥 Nhóm Zalo', cats: ['group_read', 'group_admin'] as Cat[] },
];

const tab = ref<'org' | 'nick'>('org');
const loading = ref(true);
const saving = ref(false);
const saveStatus = ref<'' | 'saved' | 'error'>('');
const saveError = ref('');

const orgForm = ref<Record<string, { daily: number; burst: number; burstWindowMs: number }>>({});
const nickOverridesRaw = ref<Record<string, Record<string, { daily: number; burst: number; burstWindowMs: number }>>>({});
const selectedNickId = ref<string>('');
const nickForm = ref<Record<string, number | '' | null>>({});

const overrideNickCount = computed(() => Object.keys(nickOverridesRaw.value).length);

async function fetchAll() {
  loading.value = true;
  try {
    const { data } = await api.get('/zalo-accounts/sdk-limits');
    orgForm.value = data.orgDefault ?? {};
    nickOverridesRaw.value = data.nickOverrides ?? {};
    if (props.nicks.length) { selectedNickId.value = props.nicks[0].id; loadNickForm(); }
  } finally { loading.value = false; }
}

function loadNickForm() {
  const ovr = nickOverridesRaw.value[selectedNickId.value] ?? {};
  const f: Record<string, number | '' | null> = {};
  for (const g of GROUPS) for (const cat of g.cats) f[cat] = ovr[cat]?.daily ?? '';
  nickForm.value = f;
}

async function save() {
  saving.value = true; saveStatus.value = '';
  try {
    if (tab.value === 'org') {
      const limits: Record<string, { daily: number; burst: number }> = {};
      for (const g of GROUPS) for (const cat of g.cats) {
        const v = orgForm.value[cat]; if (v) limits[cat] = { daily: v.daily, burst: v.burst };
      }
      await api.put('/zalo-accounts/sdk-limits/org', { limits });
    } else {
      const limits: Record<string, { daily: number; burst: number } | null> = {};
      for (const g of GROUPS) for (const cat of g.cats) {
        const val = nickForm.value[cat];
        if (val === '' || val == null) limits[cat] = null; // xoá override
        else limits[cat] = { daily: Number(val), burst: orgForm.value[cat]?.burst ?? 10 };
      }
      await api.put(`/zalo-accounts/${selectedNickId.value}/sdk-limits`, { limits });
    }
    saveStatus.value = 'saved';
    await fetchAll();
    emit('saved');
    setTimeout(() => (saveStatus.value = ''), 2500);
  } catch (err: unknown) {
    saveStatus.value = 'error';
    const e = err as { response?: { data?: { error?: string; hint?: string } } };
    saveError.value = e.response?.data?.hint || e.response?.data?.error || 'Lưu thất bại';
  } finally { saving.value = false; }
}

async function clearNickOverrides() {
  if (!selectedNickId.value) return;
  saving.value = true;
  try {
    await api.delete(`/zalo-accounts/${selectedNickId.value}/sdk-limits`);
    await fetchAll(); emit('saved');
    saveStatus.value = 'saved'; setTimeout(() => (saveStatus.value = ''), 2500);
  } catch { saveStatus.value = 'error'; saveError.value = 'Xoá thất bại'; }
  finally { saving.value = false; }
}

onMounted(fetchAll);
</script>

<style scoped>
.sdk-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 20px; }
.sdk-sheet { width: 760px; max-width: 100%; max-height: 90vh; background: #fff; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.2); }
/* embedded (trong trang Cài đặt): bỏ overlay/dim, panel theo dòng, không clamp chiều cao modal. */
.sdk-embed { width: 100%; }
.sdk-embed .sdk-sheet { width: 100%; max-width: 880px; max-height: none; box-shadow: none; border: 1px solid #e5e7eb; }
.sh-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; border-bottom: 1px solid #e5e7eb; }
.sh-head .ic { width: 38px; height: 38px; border-radius: 9px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.sh-head h2 { font-size: 16px; font-weight: 700; }
.sh-head .sub { font-size: 12px; color: #4b5563; margin-top: 2px; }
.sh-head .x { margin-left: auto; border: none; background: #f3f4f6; border-radius: 7px; width: 30px; height: 30px; cursor: pointer; font-size: 15px; color: #4b5563; }
.scope { display: flex; padding: 0 18px; border-bottom: 1px solid #e5e7eb; background: #fafbfc; }
.scope .tab { padding: 11px 16px; font-size: 13px; font-weight: 600; color: #9ca3af; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.scope .tab.on { color: #2563eb; border-bottom-color: #2563eb; }
.scope .tab .badge { font-size: 10px; background: #eff6ff; color: #2563eb; border-radius: 10px; padding: 1px 7px; margin-left: 5px; font-weight: 700; }
.body { padding: 16px 18px; overflow-y: auto; }
.muted { color: #9ca3af; padding: 30px; text-align: center; }
.info { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #1e40af; margin-bottom: 14px; display: flex; gap: 8px; }
.info.amber { background: #fffbeb; border-color: #fde68a; color: #92400e; }
.colhead { display: grid; grid-template-columns: 1fr 130px 130px; gap: 10px; margin-bottom: 6px; }
.colhead .h { font-size: 10px; color: #9ca3af; text-transform: uppercase; font-weight: 700; text-align: center; }
.grp { margin-bottom: 16px; }
.grp-h { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 8px; }
.lim { display: grid; grid-template-columns: 1fr 130px 130px; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eef0f3; }
.lim:last-child { border-bottom: none; }
.lim .meta .nm { font-weight: 600; font-size: 13px; }
.lim .meta .ds { font-size: 11px; color: #9ca3af; margin-top: 1px; }
.inp { display: flex; align-items: center; gap: 6px; justify-content: center; }
.inp input { width: 80px; border: 1px solid #d1d5db; border-radius: 7px; padding: 7px 9px; font-size: 13px; font-weight: 600; text-align: right; }
.inp input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
.inp input.ovr { border-color: #d97706; background: #fffbeb; }
.inp .u { font-size: 11px; color: #9ca3af; }
.ovr-bar { display: flex; align-items: center; gap: 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 9px 12px; margin-bottom: 12px; font-size: 12px; color: #92400e; }
.ovr-bar select { margin-left: auto; border: 1px solid #fcd34d; border-radius: 6px; padding: 5px 9px; font-size: 12px; background: #fff; }
.badge-ovr { font-size: 9.5px; font-weight: 700; background: #fffbeb; color: #d97706; border-radius: 4px; padding: 1px 6px; }
.badge-def { font-size: 9.5px; font-weight: 700; background: #f3f4f6; color: #9ca3af; border-radius: 4px; padding: 1px 6px; }
.foot { display: flex; align-items: center; gap: 10px; padding: 13px 18px; border-top: 1px solid #e5e7eb; background: #fafbfc; }
.foot .spacer { flex: 1; }
.foot .hint { font-size: 11px; color: #9ca3af; }
.toast { font-size: 12.5px; font-weight: 600; }
.toast.ok { color: #16a34a; } .toast.err { color: #dc2626; }
.btn { border: 1px solid #d1d5db; background: #fff; border-radius: 8px; padding: 8px 15px; font-size: 13px; font-weight: 600; cursor: pointer; color: #4b5563; }
.btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.btn:disabled { opacity: .6; cursor: default; }
</style>
