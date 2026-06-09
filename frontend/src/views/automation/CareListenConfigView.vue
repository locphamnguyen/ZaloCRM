<!--
  CareListenConfigView — "Lắng nghe & Nhắc chăm sóc" CẤU HÌNH CHUNG cấp tổ chức.
  Anh chốt 2026-06-07: lắng nghe là lớp DÙNG CHUNG cho mọi Mục tiêu, KHÔNG per-trigger.
  Tách khỏi wizard. 1 bộ quy tắc: event nào báo đích nào + điều kiện đóng phiên.
  Mockup verify: ~/.gstack/projects/locphamnguyen-ZaloCRM/designs/care-listen-config-20260607/
-->
<template>
  <div class="clc-wrap airtable-scope">
    <div class="clc-hd" :class="{ embedded }">
      <div v-if="!embedded">
        <div class="clc-title"><span class="ic">🔔</span> Lắng nghe & Nhắc chăm sóc</div>
        <div class="clc-sub">Một bộ quy tắc dùng chung cho toàn tổ chức. Khi khách phản hồi trong bất kỳ Mục tiêu nào, hệ thống lắng nghe và nhắc đúng người theo cấu hình ở đây.</div>
      </div>
      <div class="clc-actions" :class="{ row: embedded }">
        <span class="org-badge">🏢 Áp dụng cho cả tổ chức</span>
        <button class="btn btn--primary" :disabled="saving || !isAdmin" @click="save">
          {{ saving ? 'Đang lưu…' : '💾 Lưu cấu hình' }}
        </button>
      </div>
    </div>

    <div class="scope-note">
      <span>ℹ️</span>
      <span>Đây là cấu hình CHUNG. Khác với "Quy tắc gửi an toàn" trong từng Mục tiêu (chỉ kiểm soát nhịp gửi tin của riêng chiến dịch đó), phần này quyết định việc LẮNG NGHE phản hồi khách và NHẮC sale cho mọi Mục tiêu.</span>
    </div>
    <div v-if="!isAdmin" class="readonly-note">👁 Bạn đang xem ở chế độ chỉ đọc. Chỉ admin được sửa cấu hình lắng nghe chung.</div>

    <div class="clc-grid">
      <!-- LEFT: event × 3 đích -->
      <div class="card">
        <div class="card-h">
          <h3>Sự kiện lắng nghe & nơi nhận thông báo</h3>
          <span class="hint">Bật/tắt từng đích cho mỗi sự kiện</span>
        </div>
        <table class="et">
          <thead>
            <tr>
              <th class="l">Sự kiện của khách</th>
              <th>Owner<small>Sale phụ trách</small></th>
              <th>Quản lý<small>Theo phòng ban</small></th>
              <th>Nhóm Zalo<small>Báo cáo chung</small></th>
              <th>Tác động luồng<small>Chuỗi bám đuổi</small></th>
              <th>Tác động phiên<small>Lắng nghe</small></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ev in EVENTS" :key="ev.key">
              <td class="evn">
                <span class="nm"><span class="ic" :class="ev.ic">{{ ev.emo }}</span>{{ ev.nm }}<span v-if="ev.urg" class="urg">KHẨN</span></span>
                <div class="desc">{{ ev.desc }}</div>
              </td>
              <td><Sw :model-value="cfg[ev.key].owner" :disabled="!isAdmin" @update:model-value="cfg[ev.key].owner = $event" /></td>
              <td><Sw :model-value="cfg[ev.key].manager" :disabled="!isAdmin" @update:model-value="cfg[ev.key].manager = $event" /></td>
              <td><Sw :model-value="cfg[ev.key].zaloGroup" :disabled="!isAdmin" @update:model-value="cfg[ev.key].zaloGroup = $event" /></td>
              <td><span class="flow" :class="ev.flowClass">{{ ev.flow }}</span></td>
              <td><span class="flow" :class="ev.sessClass">{{ ev.sess }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- RIGHT -->
      <div>
        <div class="mini">
          <h4>👥 Cách báo tới 3 đích</h4>
          <div class="tl-item"><span class="tl-dot" style="background:var(--brand,#1786be)"></span><div><b>Owner</b> <span class="muted">— sale phụ trách nick, tự nhận. Thấy đầy đủ tên + SĐT + nội dung.</span></div></div>
          <div class="tl-item"><span class="tl-dot" style="background:var(--warning,#d9a441)"></span><div><b>Quản lý</b> <span class="muted">— tự load theo phòng ban (cha của sale). Tin "để biết", ẩn SĐT + nội dung.</span></div></div>
          <div class="tl-item"><span class="tl-dot" style="background:var(--ink-3,#6b7488)"></span><div><b>Nhóm Zalo</b> <span class="muted">— gửi vào nhóm báo cáo chung. Chỉ tên viết tắt + loại sự kiện.</span></div></div>
          <div class="privacy-note">🔒 <b>Bảo mật theo đích:</b> cùng một sự kiện, mỗi nơi nhận thấy mức thông tin khác nhau. Nhóm thấy ít nhất.</div>
        </div>

        <!-- Nhóm Zalo nhận báo cáo — mini-card riêng, thoáng (không chen panel hẹp) -->
        <div class="mini">
          <h4>📢 Nhóm Zalo nhận báo cáo</h4>
          <select class="grp-input" v-model="groupThreadId" :disabled="!isAdmin || loadingGroups">
            <option value="">— Không gửi nhóm —</option>
            <option v-for="g in groups" :key="g.threadId" :value="g.threadId">
              {{ g.name }}{{ g.members ? ` · ${g.members} thành viên` : '' }}
            </option>
            <option v-if="groupThreadId && !groups.find(g => g.threadId === groupThreadId)" :value="groupThreadId">
              Nhóm đã chọn (UID {{ groupThreadId.slice(0, 10) }}…)
            </option>
          </select>
          <div class="help" v-if="loadingGroups">Đang tải danh sách nhóm…</div>
          <div class="help" v-else-if="groupWarning">⚠️ {{ groupWarning }}</div>
          <div class="help" v-else>Chọn từ {{ groups.length }} nhóm mà nick gửi thông báo hệ thống đang tham gia. Mọi Mục tiêu dùng chung.</div>
        </div>

        <div class="mini">
          <h4>⏹ Điều kiện đóng phiên</h4>
          <p class="cc-intro">Phiên ngừng lắng nghe khi đạt 1 trong các điều kiện:</p>
          <div class="cc-col">
            <label class="cc-lbl">🏷️ Gắn Friend tag (chọn nhiều)</label>
            <TagPicker :options="friendTags" v-model="closeConditions.onFriendTagIds" :disabled="!isAdmin" placeholder="Chọn friend tag…" />
          </div>
          <div class="cc-col">
            <label class="cc-lbl">🏷️ Gắn CRM tag (chọn nhiều)</label>
            <TagPicker :options="crmTags" v-model="closeConditions.onCrmTagIds" :disabled="!isAdmin" placeholder="Chọn CRM tag…" />
          </div>
          <div class="cc-row">
            <span class="lbl">Khách im lặng</span>
            <div class="field" style="margin-top:0"><div class="row"><input class="sm" type="number" min="1" max="90" v-model.number="closeConditions.silenceDays" :disabled="!isAdmin"><span class="unit">ngày</span></div></div>
          </div>
          <p class="cc-foot">Phiên cũng tự đóng khi: Mục tiêu kết thúc · khách chặn · đạt trạng thái (cấu hình ở Mục tiêu).</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, defineComponent, h } from 'vue';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';
import { useAuthStore } from '@/stores/auth';

// embedded = true khi nhúng trong tab "Cài đặt" của trang Phiên chăm sóc (ẩn tiêu đề riêng).
defineProps<{ embedded?: boolean }>();

const toast = useToast();
const auth = useAuthStore();
// RBAC 2026-06-08 — sửa cấu hình lắng nghe CHUNG của org theo grants 'settings.edit'
// (owner/admin tự bypass). Giữ tên isAdmin cho gọn (nhiều :disabled tham chiếu).
const isAdmin = computed(() => auth.canAccess('settings', 'edit'));

// Switch component nhỏ (Atlas v2).
const Sw = defineComponent({
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('label', { class: ['sw', props.disabled ? 'dis' : ''] }, [
      h('input', { type: 'checkbox', checked: props.modelValue, disabled: props.disabled,
        onChange: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).checked) }),
      h('span', { class: 'tr' }), h('span', { class: 'th' }),
    ]);
  },
});

// TagPicker: multi-select chip (chọn nhiều tag để đóng phiên).
interface TagOpt { id: string; name: string; color?: string | null }
const TagPicker = defineComponent({
  props: {
    options: { type: Array as () => TagOpt[], default: () => [] },
    modelValue: { type: Array as () => string[], default: () => [] },
    disabled: Boolean,
    placeholder: { type: String, default: 'Chọn…' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const toggle = (id: string) => {
      if (props.disabled) return;
      const cur = props.modelValue.slice();
      const i = cur.indexOf(id);
      if (i >= 0) cur.splice(i, 1); else cur.push(id);
      emit('update:modelValue', cur);
    };
    return () => h('div', { class: 'tagpick' }, [
      props.options.length === 0
        ? h('span', { class: 'tagpick-empty' }, 'Chưa có tag nào')
        : h('div', { class: 'tagpick-chips' }, props.options.map((o) =>
            h('span', {
              key: o.id,
              class: ['tp-chip', props.modelValue.includes(o.id) ? 'on' : '', props.disabled ? 'dis' : ''],
              onClick: () => toggle(o.id),
            }, [
              props.modelValue.includes(o.id) ? '✓ ' : '',
              o.name,
            ]),
          )),
    ]);
  },
});

const friendTags = ref<TagOpt[]>([]);
const crmTags = ref<TagOpt[]>([]);
async function loadTags() {
  try {
    const [fr, cr] = await Promise.all([
      api.get<{ tags: TagOpt[] }>('/tags?scope=friend'),
      api.get<{ tags: TagOpt[] }>('/tags?scope=crm'),
    ]);
    friendTags.value = fr.data.tags ?? [];
    crmTags.value = cr.data.tags ?? [];
  } catch {
    /* best-effort — không có tag thì picker hiện "chưa có tag" */
  }
}

interface CareEventDef {
  key: string; ic: string; emo: string; nm: string; desc: string; urg?: boolean;
  flow: string; flowClass: string;   // tác động LUỒNG (chuỗi bám đuổi / sequence)
  sess: string; sessClass: string;   // tác động PHIÊN (CareSession lắng nghe)
}
// Khớp 100% hành vi code (verify event-hooks.ts):
//   reply/reaction-neg → PAUSE luồng (setContactPauseFlag), phiên VẪN MỞ.
//   block → HỦY luồng (cancelPendingSteps) + ĐÓNG phiên (closeCareSessions).
const EVENTS: CareEventDef[] = [
  { key: 'friendAccept',     ic: 'green', emo: '🤝', nm: 'Khách đồng ý kết bạn', desc: 'Khách bấm đồng ý lời mời',     flow: '—',            flowClass: 'dash', sess: 'Giữ mở',  sessClass: 'dash' },
  { key: 'friendReject',     ic: 'amber', emo: '🙅', nm: 'Khách từ chối kết bạn', desc: 'Vẫn nhắn tiếp qua hộp lạ',   flow: '—',            flowClass: 'dash', sess: 'Giữ mở',  sessClass: 'dash' },
  { key: 'reply',            ic: 'blue',  emo: '💬', nm: 'Khách trả lời',         desc: 'Khách phản hồi tin nhắn',     urg: true, flow: '⏸ Dừng 24h',   flowClass: 'pg', sess: 'Giữ mở',  sessClass: 'dash' },
  { key: 'reactionPositive', ic: 'green', emo: '❤️', nm: 'Cảm xúc tích cực',      desc: 'Thả tim / like / 🌹',         flow: 'Không dừng',   flowClass: 'dash', sess: 'Giữ mở',  sessClass: 'dash' },
  { key: 'reactionNegative', ic: 'red',   emo: '💔', nm: 'Cảm xúc tiêu cực',      desc: 'Thả 😡 / 👎 / 💔',            urg: true, flow: '⏸ Dừng 48h',   flowClass: 'pr', sess: 'Giữ mở',  sessClass: 'dash' },
  { key: 'block',            ic: 'red',   emo: '🚫', nm: 'Khách chặn nick',       desc: 'Khách chặn — dừng vĩnh viễn', urg: true, flow: '⏹ Hủy luồng',  flowClass: 'pr', sess: '⏹ Đóng phiên', sessClass: 'pr' },
  { key: 'lead',             ic: 'gray',  emo: '⭐', nm: 'Trở thành Lead',        desc: 'Khách vào diện tiềm năng',    flow: '—',            flowClass: 'dash', sess: 'Giữ mở',  sessClass: 'dash' },
];

type Cfg = Record<string, { owner: boolean; manager: boolean; zaloGroup: boolean }>;
const cfg = reactive<Cfg>(Object.fromEntries(
  EVENTS.map((e) => [e.key, { owner: true, manager: false, zaloGroup: false }]),
));
const closeConditions = reactive({ onStatusIds: [] as string[], onFriendTagIds: [] as string[], onCrmTagIds: [] as string[], silenceDays: 7 });
const groupThreadId = ref('');
const saving = ref(false);

// Danh sách nhóm của nick hệ thống (cho dropdown chọn — thay nhập UID thủ công).
interface GroupOpt { threadId: string; name: string; avatar: string | null; members: number | null }
const groups = ref<GroupOpt[]>([]);
const loadingGroups = ref(false);
const groupWarning = ref('');

async function loadGroups() {
  loadingGroups.value = true;
  try {
    const res = await api.get<{ groups: GroupOpt[]; warning?: string }>(
      '/automation/care-listen-config/sender-groups',
    );
    groups.value = res.data.groups ?? [];
    groupWarning.value = res.data.warning ?? '';
  } catch {
    groupWarning.value = 'Không tải được danh sách nhóm';
  } finally {
    loadingGroups.value = false;
  }
}

async function load() {
  try {
    const res = await api.get('/automation/care-listen-config');
    const nc = res.data.notifyChannels as Cfg | null;
    if (nc) {
      for (const e of EVENTS) {
        if (nc[e.key]) cfg[e.key] = {
          owner: nc[e.key].owner !== false,
          manager: nc[e.key].manager === true,
          zaloGroup: nc[e.key].zaloGroup === true,
        };
      }
    }
    const cc = res.data.closeConditions as typeof closeConditions | null;
    if (cc) {
      if (typeof cc.silenceDays === 'number') closeConditions.silenceDays = cc.silenceDays;
      if (Array.isArray(cc.onStatusIds)) closeConditions.onStatusIds = cc.onStatusIds;
    }
    if (res.data.groupThreadId) groupThreadId.value = res.data.groupThreadId;
  } catch {
    toast.error('Không tải được cấu hình lắng nghe');
  }
}

async function save() {
  if (!isAdmin.value) return;
  saving.value = true;
  try {
    await api.put('/automation/care-listen-config', {
      notifyChannels: { ...cfg },
      closeConditions: { ...closeConditions },
      groupThreadId: groupThreadId.value.trim() || null,
    });
    toast.success('Đã lưu cấu hình lắng nghe chung');
  } catch {
    toast.error('Lưu thất bại');
  } finally {
    saving.value = false;
  }
}

onMounted(() => { load(); loadGroups(); loadTags(); });
</script>

<style scoped>
.clc-wrap { padding: 18px 22px 70px; }
.clc-hd { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; }
.clc-hd.embedded { justify-content: flex-end; margin-bottom: 12px; }
.clc-actions.row { flex-direction: row; align-items: center; }
.clc-title { font-size: 21px; font-weight: 600; color: var(--ink, #141a24); display: flex; align-items: center; gap: 9px; }
.clc-title .ic { color: var(--brand, #1786be); }
.clc-sub { font-size: 12.5px; color: var(--ink-3, #6b7488); margin-top: 3px; max-width: 740px; line-height: 1.5; }
.clc-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.org-badge { display: inline-flex; align-items: center; gap: 6px; background: var(--brand-softer, #f2f8fc); color: var(--brand-700, #0b5880); font-size: 11.5px; font-weight: 600; padding: 5px 12px; border-radius: 9999px; border: 1px solid var(--brand-bright, #5bb8e5); }
.btn { font-size: 13px; font-weight: 500; border-radius: 10px; padding: 9px 16px; cursor: pointer; border: 1px solid transparent; font-family: inherit; height: 36px; }
.btn--primary { background: var(--ink, #141a24); color: #fff; }
.btn--primary:disabled { opacity: .5; cursor: default; }
.scope-note { background: var(--brand-softer, #f2f8fc); border: 1px solid var(--brand-bright, #5bb8e5); border-radius: 10px; padding: 10px 14px; font-size: 12px; color: var(--brand-700, #0b5880); line-height: 1.5; margin: 14px 0 12px; display: flex; gap: 8px; align-items: flex-start; }
.readonly-note { font-size: 12px; color: var(--ink-3, #6b7488); margin-bottom: 14px; }
.clc-grid { display: grid; grid-template-columns: 1fr 330px; gap: 18px; align-items: start; }
.card { background: #fff; border: 1px solid var(--line, #e7eaf0); border-radius: 12px; overflow: hidden; }
.card-h { padding: 14px 18px; border-bottom: 1px solid var(--line, #e7eaf0); display: flex; align-items: center; justify-content: space-between; }
.card-h h3 { font-size: 14px; font-weight: 600; color: var(--ink, #141a24); }
.card-h .hint { font-size: 11.5px; color: var(--ink-3, #6b7488); }
.et { width: 100%; border-collapse: collapse; }
.et thead th { font-size: 11px; font-weight: 600; color: var(--ink-3, #6b7488); text-transform: uppercase; letter-spacing: .4px; text-align: center; padding: 10px 8px; background: var(--surface-2, #f7f9fc); border-bottom: 1px solid var(--line, #e7eaf0); }
.et thead th.l { text-align: left; padding-left: 18px; }
.et thead th small { display: block; font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 10px; color: var(--ink-3, #6b7488); margin-top: 1px; }
.et tbody td { padding: 11px 8px; border-bottom: 1px solid var(--line, #e7eaf0); text-align: center; vertical-align: middle; }
.et tbody tr:last-child td { border-bottom: 0; }
.et tbody tr:hover { background: var(--surface-2, #f7f9fc); }
.evn { text-align: left; padding-left: 18px !important; }
.evn .nm { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 500; color: var(--ink, #141a24); }
.evn .ic { width: 27px; height: 27px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.evn .desc { font-size: 11px; color: var(--ink-3, #6b7488); margin-top: 2px; margin-left: 36px; }
.ic.green { background: var(--success-soft, #e6f7ef); } .ic.red { background: var(--error-soft, #fdeceb); }
.ic.amber { background: var(--warning-soft, #fdf6e3); } .ic.blue { background: var(--brand-softer, #f2f8fc); } .ic.gray { background: var(--surface-3, #f1f4f9); }
.urg { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-left: 6px; background: var(--error-soft, #fdeceb); color: var(--error, #f04438); }
.flow.dash { color: var(--ink-3, #6b7488); font-size: 12px; }
.flow.pg { background: var(--success-soft, #e6f7ef); color: #0a7a47; font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 9999px; }
.flow.pr { background: var(--error-soft, #fdeceb); color: #c0392b; font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 9999px; }
.mini { background: #fff; border: 1px solid var(--line, #e7eaf0); border-radius: 12px; padding: 15px 16px; margin-bottom: 14px; }
.mini h4 { font-size: 13px; font-weight: 600; color: var(--ink, #141a24); margin-bottom: 8px; }
.tl-item { display: flex; gap: 9px; font-size: 12px; margin-bottom: 9px; }
.tl-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
.tl-item b { color: var(--ink, #141a24); font-weight: 600; } .tl-item .muted { color: var(--ink-3, #6b7488); }
.field { margin-top: 13px; }
.field label { display: block; font-size: 11.5px; font-weight: 500; color: var(--ink-2, #475066); margin-bottom: 5px; }
.field .row { display: flex; align-items: center; gap: 8px; }
.field input { flex: 1; height: 34px; border: 1px solid var(--line, #e7eaf0); border-radius: 10px; padding: 0 11px; font-size: 13px; font-family: inherit; color: var(--ink, #141a24); }
.field input.sm { width: 60px; flex: none; text-align: center; }
.grp-input { width: 100%; height: 36px; border: 1px solid var(--line, #e7eaf0); border-radius: 10px; padding: 0 11px; font-size: 13px; font-family: inherit; color: var(--ink, #141a24); background: #fff; cursor: pointer; }
.grp-input:disabled { background: var(--surface-2, #f7f9fc); cursor: default; }
.field .unit { font-size: 12px; color: var(--ink-3, #6b7488); }
.field .help { font-size: 11px; color: var(--ink-3, #6b7488); margin-top: 5px; line-height: 1.5; }
.privacy-note { background: var(--surface-3, #f1f4f9); border-radius: 10px; padding: 11px 13px; font-size: 11.5px; color: var(--ink-2, #475066); line-height: 1.5; margin-top: 6px; }
.privacy-note b { color: var(--ink, #141a24); }
.cc-intro { font-size: 12px; color: var(--ink-3, #6b7488); margin-bottom: 4px; }
.cc-foot { font-size: 11px; color: var(--ink-3, #6b7488); margin-top: 8px; }
.cc-col { padding: 9px 0; border-bottom: 1px solid var(--line, #e7eaf0); }
.cc-lbl { display: block; font-size: 12px; font-weight: 500; color: var(--ink-2, #475066); margin-bottom: 6px; }
/* TagPicker chips */
:deep(.tagpick-chips) { display: flex; flex-wrap: wrap; gap: 5px; }
:deep(.tagpick-empty) { font-size: 11.5px; color: var(--ink-3, #6b7488); font-style: italic; }
:deep(.tp-chip) { font-size: 11.5px; font-weight: 500; padding: 3px 10px; border-radius: 9999px; background: var(--surface-3, #f1f4f9); color: var(--ink-2, #475066); border: 1px solid var(--line, #e7eaf0); cursor: pointer; user-select: none; }
:deep(.tp-chip:hover:not(.dis)) { border-color: var(--brand-bright, #5bb8e5); }
:deep(.tp-chip.on) { background: var(--brand-softer, #f2f8fc); color: var(--brand-700, #0b5880); border-color: var(--brand, #1786be); font-weight: 600; }
:deep(.tp-chip.dis) { cursor: default; opacity: .6; }
.cc-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--line, #e7eaf0); }
.cc-row:last-of-type { border-bottom: 0; }
.cc-row .lbl { font-size: 12.5px; color: var(--ink-2, #475066); }
.chips { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 500; padding: 3px 9px; border-radius: 9999px; background: var(--surface-3, #f1f4f9); color: var(--ink-2, #475066); border: 1px solid var(--line, #e7eaf0); }
.chip-add { background: #fff; border: 1px dashed var(--line-strong, #cdd4e0); color: var(--ink-3, #6b7488); cursor: pointer; }
/* switch */
:deep(.sw) { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; }
:deep(.sw.dis) { cursor: default; opacity: .5; }
:deep(.sw input) { display: none; }
:deep(.sw .tr) { position: absolute; inset: 0; background: var(--line-strong, #cdd4e0); border-radius: 9999px; transition: .15s; }
:deep(.sw .th) { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: .15s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
:deep(.sw input:checked + .tr) { background: var(--brand, #1786be); }
:deep(.sw input:checked + .tr + .th) { transform: translateX(16px); }
</style>
