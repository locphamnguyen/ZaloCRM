<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension -->
<!--
  TargetsView — Mục tiêu (Community): auto kết bạn theo Tệp khách hàng.
  Chạy liên tục (không lịch định kỳ) tới khi hết đối tượng hoặc chạm tổng tối đa.
  Backend: /api/v1/target-jobs (+ worker cron 30s gửi lời mời kết bạn chống block).
-->
<template>
  <div class="tg-view">
    <div class="mkt-top">
      <div>
        <div class="mtt">Mục tiêu</div>
        <div class="mts">
          Tự động gửi lời mời kết bạn tới <b>Tệp khách hàng</b> — chạy liên tục tới khi hết
          đối tượng hoặc chạm tổng tối đa. Nên chạy <b>trước</b> Broadcast để tăng tỉ lệ gửi
          thành công (đã là bạn mới gửi tin trực tiếp được).
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <v-icon size="16">mdi-plus-circle-outline</v-icon> Tạo mục tiêu
        </button>
      </div>
    </div>

    <div class="tg-body">
      <div v-if="loading" class="tg-empty">Đang tải…</div>
      <div v-else-if="jobs.length === 0" class="tg-empty">
        <v-icon size="40">mdi-account-multiple-plus-outline</v-icon>
        <p>Chưa có mục tiêu nào. Bấm <b>Tạo mục tiêu</b> để bắt đầu.</p>
      </div>

      <div v-for="job in jobs" :key="job.id" class="tg-card" :class="'st-' + job.status">
        <div class="tg-card-main">
          <div class="tg-card-head">
            <span class="tg-name">{{ job.name }}</span>
            <span class="tg-badge" :class="'b-' + job.status">{{ statusLabel(job.status) }}</span>
          </div>
          <div class="tg-meta">
            <span v-if="job.sourceType === 'group_scan'">
              <v-icon size="14">mdi-account-group-outline</v-icon>
              {{ job.groupScan ? `Nhóm đã quét (${job.groupScan.scannedGroups} nhóm, ${Math.max(0, job.groupScan.memberCount - job.groupScan.friendCount)} chưa kết bạn)` : 'Nhóm đã quét (đã xoá)' }}
            </span>
            <span v-else><v-icon size="14">mdi-format-list-bulleted</v-icon> {{ job.list?.name ?? '—' }}
              <template v-if="job.list"> ({{ job.list.hasZaloEntries }} có Zalo)</template></span>
            <span><v-icon size="14">mdi-account-circle-outline</v-icon> {{ job.nick?.displayName ?? job.nick?.phone ?? '—' }}</span>
            <span><v-icon size="14">mdi-counter</v-icon> Tối đa {{ job.maxTotal }} lời mời</span>
          </div>
          <div class="tg-msg" :title="job.requestMsg">{{ job.requestMsg }}</div>
          <div class="tg-run">
            ✅ {{ job.sentCount }} đã gửi ·
            🚫 {{ job.noZaloCount }} không có Zalo ·
            ❌ {{ job.failedCount }} lỗi
            <template v-if="job.welcomeEnabled">
              · 🤝 {{ job.welcomedCount }} đã chào<template v-if="job.welcomeFailedCount"> ({{ job.welcomeFailedCount }} lỗi)</template>
            </template>
            <button class="btn-link" @click="viewItems(job)">chi tiết</button>
          </div>
        </div>
        <div class="tg-card-actions">
          <button v-if="job.status === 'active'" class="btn btn-ghost btn-sm" title="Tạm dừng" @click="setStatus(job, 'paused')">
            <v-icon size="16">mdi-pause</v-icon>
          </button>
          <button v-if="job.status === 'paused'" class="btn btn-ghost btn-sm" title="Tiếp tục" @click="setStatus(job, 'active')">
            <v-icon size="16">mdi-play</v-icon>
          </button>
          <button class="btn btn-ghost btn-sm danger" title="Xoá" @click="removeJob(job)">
            <v-icon size="16">mdi-trash-can-outline</v-icon>
          </button>
        </div>
      </div>
    </div>

    <!-- ============ Modal tạo mục tiêu ============ -->
    <div v-if="showCreate" class="tg-overlay" @click.self="showCreate = false">
      <div class="tg-modal">
        <div class="tg-modal-head">
          <b>Tạo mục tiêu</b>
          <button class="btn-x" @click="showCreate = false"><v-icon size="18">mdi-close</v-icon></button>
        </div>

        <label class="f-label">Tên mục tiêu</label>
        <input v-model="form.name" class="f-input" placeholder="VD: Kết bạn KH tháng 7" />

        <label class="f-label">Nick Zalo gửi</label>
        <select v-model="form.zaloAccountId" class="f-input" @change="onNickChange">
          <option value="" disabled>— chọn nick —</option>
          <option v-for="n in nicks" :key="n.id" :value="n.id">
            {{ n.displayName || n.phone }} {{ n.status !== 'connected' ? '(mất kết nối)' : '' }}
          </option>
        </select>

        <label class="f-label">Nguồn target</label>
        <div class="f-tabs">
          <button type="button" class="f-tab" :class="{ on: form.sourceType === 'customer_list' }" @click="form.sourceType = 'customer_list'">Tệp khách hàng</button>
          <button type="button" class="f-tab" :class="{ on: form.sourceType === 'group_scan' }" @click="onSelectGroupScanMode">Nhóm đã quét</button>
        </div>

        <template v-if="form.sourceType === 'customer_list'">
          <label class="f-label" style="margin-top:10px">Tệp khách hàng</label>
          <select v-model="form.customerListId" class="f-input">
            <option value="" disabled>— chọn tệp —</option>
            <option v-for="l in lists" :key="l.id" :value="l.id">
              {{ l.name }} ({{ l.hasZaloEntries }} có Zalo)
            </option>
          </select>
        </template>
        <template v-else>
          <label class="f-label" style="margin-top:10px">Scan đã quét <span class="f-hint">— chỉ scan của nick đang chọn</span></label>
          <div v-if="!form.zaloAccountId" class="tg-empty" style="padding:12px 0">Chọn nick trước đã.</div>
          <div v-else-if="groupScansLoading" class="tg-empty" style="padding:12px 0">Đang tải…</div>
          <div v-else-if="groupScans.length === 0" class="tg-empty" style="padding:12px 0">
            Nick này chưa có scan nào (Quét nhóm → chọn nhóm → quét).
          </div>
          <select v-else v-model="form.groupScanId" class="f-input">
            <option value="" disabled>— chọn scan —</option>
            <option v-for="s in groupScans" :key="s.id" :value="s.id">
              {{ s.groupNames.length ? s.groupNames.join(', ') : s.scannedGroups + ' nhóm' }}
              — {{ s.notFriendCount }} chưa kết bạn ({{ fmtDate(s.createdAt) }})
            </option>
          </select>
        </template>

        <label class="f-label">Lời nhắn kèm lời mời kết bạn <span class="f-hint">— biến: <code v-pre>{{ten}}</code> tên khách, <code v-pre>{{sdt}}</code> SĐT</span></label>
        <textarea v-model="form.requestMsg" class="f-input" rows="3"
          placeholder="Xin chào! Tôi đang phân phối dự án..., kết bạn để gửi thông tin tới anh/chị nhé."></textarea>

        <!-- ===== Tin chào khi khách chấp nhận (vòng 6) ===== -->
        <label class="f-check">
          <input v-model="form.welcomeEnabled" type="checkbox" />
          <span><b>Gửi tin chào khi khách chấp nhận kết bạn</b>
            <span class="f-hint">— tự động, gửi rải trong khung 8h–21h</span></span>
        </label>

        <template v-if="form.welcomeEnabled">
          <div class="f-tabs" style="margin-top:6px">
            <button type="button" class="f-tab" :class="{ on: form.welcomeMode === 'text' }" @click="form.welcomeMode = 'text'">Gõ tay</button>
            <button type="button" class="f-tab" :class="{ on: form.welcomeMode === 'blocks' }" @click="onSelectWelcomeBlocksMode">
              <v-icon size="14">mdi-shuffle-variant</v-icon> Khối nội dung (xoay vòng)
            </button>
          </div>

          <template v-if="form.welcomeMode === 'text'">
            <textarea v-model="form.welcomeMsg" class="f-input" rows="3" style="margin-top:8px"
              placeholder="Cảm ơn {{ten}} đã kết bạn! Em gửi anh/chị thông tin dự án ạ…"></textarea>
          </template>
          <template v-else>
            <div v-if="contentBlocks.length === 0" class="tg-empty" style="padding:12px 0">
              Chưa có khối nội dung nào — tạo ở <RouterLink to="/marketing/content-blocks">Khối nội dung</RouterLink>.
            </div>
            <div v-else class="f-block-list">
              <label v-for="b in contentBlocks" :key="b.id" class="f-block-item">
                <input type="checkbox" :checked="form.welcomeBlockIds.includes(b.id)" @change="toggleWelcomeBlock(b.id)" />
                <span class="f-block-name">{{ b.name }}</span>
                <span class="f-hint f-block-preview">{{ b.messageText }}</span>
              </label>
            </div>
          </template>
        </template>

        <details class="f-adv">
          <summary>Chống block (nâng cao)</summary>
          <div class="f-row">
            <div class="f-col">
              <label class="f-label">Tổng tối đa lời mời</label>
              <input v-model.number="form.maxTotal" type="number" min="1" max="2000" class="f-input" />
            </div>
            <div class="f-col">
              <label class="f-label">Giãn cách tối thiểu (giây)</label>
              <input v-model.number="form.delaySecMin" type="number" min="10" class="f-input" />
            </div>
            <div class="f-col">
              <label class="f-label">Giãn cách tối đa (giây)</label>
              <input v-model.number="form.delaySecMax" type="number" min="10" class="f-input" />
            </div>
          </div>
          <div class="f-hint">Còn bị chặn thêm bởi trần <b>friend_action/ngày của nick</b> (Cài đặt → Tài khoản Zalo) — mặc định 30/ngày.</div>
        </details>

        <div class="tg-modal-foot">
          <button class="btn btn-ghost btn-sm" @click="showCreate = false">Huỷ</button>
          <button class="btn btn-primary btn-sm" :disabled="creating" @click="createJob">
            {{ creating ? 'Đang tạo…' : 'Tạo mục tiêu' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ============ Modal log đối tượng ============ -->
    <div v-if="itemsModal.open" class="tg-overlay" @click.self="itemsModal.open = false">
      <div class="tg-modal tg-modal-wide">
        <div class="tg-modal-head">
          <b>Log kết bạn — {{ itemsModal.jobName }}</b>
          <button class="btn-x" @click="itemsModal.open = false"><v-icon size="18">mdi-close</v-icon></button>
        </div>
        <table class="tg-table">
          <thead><tr><th>#</th><th>Tên</th><th>SĐT</th><th>Trạng thái</th><th>Tin chào</th><th>Lỗi</th><th>Lúc</th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in itemsModal.items" :key="it.id">
              <td class="num">{{ i + 1 }}</td>
              <td>{{ it.name ?? '—' }}</td>
              <td class="num">{{ it.phone ?? '—' }}</td>
              <td><span class="run-badge" :class="'r-' + it.status">{{ itemStatusLabel(it.status) }}</span></td>
              <td>
                <span v-if="it.welcomeStatus" class="run-badge" :class="'w-' + it.welcomeStatus">{{ welcomeStatusLabel(it.welcomeStatus) }}</span>
                <span v-else>—</span>
              </td>
              <td class="err">{{ it.welcomeError ?? it.error ?? '' }}</td>
              <td class="num">{{ fmtDate(it.createdAt) }}</td>
            </tr>
            <tr v-if="itemsModal.items.length === 0"><td colspan="7" class="tg-empty">Chưa có lời mời nào được gửi.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

const { push: toast } = useToast();
const { confirm } = useConfirm();

interface JobRow {
  id: string; name: string; status: string; requestMsg: string; sourceType: 'customer_list' | 'group_scan';
  maxTotal: number; sentCount: number; noZaloCount: number; failedCount: number;
  welcomeEnabled: boolean; welcomedCount: number; welcomeFailedCount: number;
  list: { id: string; name: string; hasZaloEntries: number } | null;
  groupScan: { id: string; scannedGroups: number; memberCount: number; friendCount: number } | null;
  nick: { id: string; displayName: string | null; phone: string | null; status: string } | null;
}
interface GroupScanOption {
  id: string; scannedGroups: number; memberCount: number; friendCount: number;
  notFriendCount: number; createdAt: string; groupNames: string[];
}

const jobs = ref<JobRow[]>([]);
const lists = ref<Array<{ id: string; name: string; hasZaloEntries: number }>>([]);
const nicks = ref<Array<{ id: string; displayName: string | null; phone: string | null; status: string }>>([]);
const groupScans = ref<GroupScanOption[]>([]);
const groupScansLoading = ref(false);
const loading = ref(true);
const showCreate = ref(false);
const creating = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const form = reactive({
  name: '', sourceType: 'customer_list' as 'customer_list' | 'group_scan',
  customerListId: '', groupScanId: '', zaloAccountId: '', requestMsg: '',
  maxTotal: 200, delaySecMin: 60, delaySecMax: 180,
  welcomeEnabled: false, welcomeMode: 'text' as 'text' | 'blocks',
  welcomeMsg: '', welcomeBlockIds: [] as string[],
});

const contentBlocks = ref<Array<{ id: string; name: string; messageText: string }>>([]);

const itemsModal = reactive({
  open: false, jobName: '',
  items: [] as Array<{
    id: string; name: string | null; phone: string | null; status: string; error: string | null; createdAt: string;
    welcomeStatus: string | null; welcomeError: string | null;
  }>,
});

async function load(): Promise<void> {
  try {
    const res = await api.get('/target-jobs');
    jobs.value = res.data.jobs;
  } finally {
    loading.value = false;
  }
}

async function openCreate(): Promise<void> {
  showCreate.value = true;
  if (lists.value.length === 0) {
    const [lr, nr] = await Promise.all([
      api.get('/customer-lists', { params: { status: 'active', limit: 100 } }),
      api.get('/zalo-accounts'),
    ]);
    lists.value = (lr.data.lists ?? lr.data ?? []).map((l: any) => ({
      id: l.id, name: l.name, hasZaloEntries: l.hasZaloEntries ?? 0,
    }));
    nicks.value = (nr.data.accounts ?? nr.data ?? []).map((n: any) => ({
      id: n.id, displayName: n.displayName, phone: n.phone, status: n.status,
    }));
  }
}

async function onNickChange(): Promise<void> {
  groupScans.value = [];
  form.groupScanId = '';
  if (form.sourceType === 'group_scan' && form.zaloAccountId) await loadGroupScans();
}

async function onSelectGroupScanMode(): Promise<void> {
  form.sourceType = 'group_scan';
  if (form.zaloAccountId && groupScans.value.length === 0) await loadGroupScans();
}

async function loadGroupScans(): Promise<void> {
  groupScansLoading.value = true;
  try {
    const res = await api.get(`/target-jobs/group-scans/${form.zaloAccountId}`);
    groupScans.value = res.data.scans;
  } finally {
    groupScansLoading.value = false;
  }
}

async function onSelectWelcomeBlocksMode(): Promise<void> {
  form.welcomeMode = 'blocks';
  if (contentBlocks.value.length === 0) {
    const res = await api.get('/content-blocks');
    contentBlocks.value = (res.data.blocks ?? res.data ?? []).map((b: any) => ({
      id: b.id, name: b.name, messageText: b.messageText,
    }));
  }
}

function toggleWelcomeBlock(id: string): void {
  const i = form.welcomeBlockIds.indexOf(id);
  if (i >= 0) form.welcomeBlockIds.splice(i, 1);
  else form.welcomeBlockIds.push(id);
}

async function createJob(): Promise<void> {
  if (!form.name.trim()) return void toast('Nhập tên mục tiêu', 'error');
  if (!form.zaloAccountId) return void toast('Chọn nick Zalo gửi', 'error');
  if (form.sourceType === 'customer_list' && !form.customerListId) return void toast('Chọn tệp khách hàng', 'error');
  if (form.sourceType === 'group_scan' && !form.groupScanId) return void toast('Chọn scan đã quét', 'error');
  if (form.welcomeEnabled) {
    if (form.welcomeMode === 'text' && !form.welcomeMsg.trim()) return void toast('Nhập nội dung tin chào', 'error');
    if (form.welcomeMode === 'blocks' && form.welcomeBlockIds.length === 0) return void toast('Chọn ít nhất 1 khối nội dung cho tin chào', 'error');
  }

  creating.value = true;
  try {
    await api.post('/target-jobs', {
      name: form.name, sourceType: form.sourceType, zaloAccountId: form.zaloAccountId,
      customerListId: form.sourceType === 'customer_list' ? form.customerListId : undefined,
      groupScanId: form.sourceType === 'group_scan' ? form.groupScanId : undefined,
      requestMsg: form.requestMsg || undefined,
      maxTotal: form.maxTotal, delaySecMin: form.delaySecMin, delaySecMax: form.delaySecMax,
      welcomeEnabled: form.welcomeEnabled,
      welcomeMsg: form.welcomeEnabled && form.welcomeMode === 'text' ? form.welcomeMsg : '',
      welcomeBlockIds: form.welcomeEnabled && form.welcomeMode === 'blocks' ? form.welcomeBlockIds : [],
    });
    toast('Đã tạo mục tiêu', 'success');
    showCreate.value = false;
    Object.assign(form, {
      name: '', requestMsg: '', sourceType: 'customer_list', groupScanId: '',
      welcomeEnabled: false, welcomeMode: 'text', welcomeMsg: '', welcomeBlockIds: [],
    });
    await load();
  } catch (err: any) {
    toast(`Lỗi: ${err?.response?.data?.error ?? 'không tạo được'}`, 'error');
  } finally {
    creating.value = false;
  }
}

async function setStatus(job: JobRow, status: 'active' | 'paused'): Promise<void> {
  await api.patch(`/target-jobs/${job.id}`, { status });
  await load();
}

async function removeJob(job: JobRow): Promise<void> {
  if (!(await confirm({
    title: 'Xoá mục tiêu?',
    message: `Xoá "${job.name}" cùng toàn bộ log. Không thể hoàn tác.`,
    confirmText: 'Xoá', tone: 'danger',
  }))) return;
  await api.delete(`/target-jobs/${job.id}`);
  toast('Đã xoá', 'success');
  await load();
}

async function viewItems(job: JobRow): Promise<void> {
  const res = await api.get(`/target-jobs/${job.id}/items`);
  itemsModal.items = res.data.items;
  itemsModal.jobName = job.name;
  itemsModal.open = true;
}

function statusLabel(s: string): string {
  return s === 'active' ? 'Đang hoạt động' : s === 'paused' ? 'Tạm dừng' : 'Đã xong';
}
function itemStatusLabel(s: string): string {
  return s === 'sent' ? 'Đã gửi' : s === 'no_zalo' ? 'Không có Zalo' : s === 'failed' ? 'Lỗi' : 'Bỏ qua';
}
function welcomeStatusLabel(s: string): string {
  return s === 'waiting' ? 'Chờ chấp nhận' : s === 'sent' ? 'Đã chào' : 'Chào lỗi';
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

onMounted(async () => {
  await load();
  pollTimer = setInterval(load, 15_000); // job đang chạy → cập nhật số liệu
});
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<style scoped>
.tg-view { display: flex; flex-direction: column; height: 100%; overflow: auto; }
.mkt-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 16px 20px 12px; border-bottom: 1px solid var(--border, #e5e4e7); }
.mtt { font-size: 18px; font-weight: 700; }
.mts { font-size: 13px; color: var(--text-secondary, #666); margin-top: 2px; max-width: 720px; }
.actions { display: flex; gap: 8px; flex-shrink: 0; }
.tg-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
.tg-empty { text-align: center; color: var(--text-secondary, #888); padding: 32px 0; }
.tg-card { display: flex; justify-content: space-between; gap: 12px; border: 1px solid var(--border, #e5e4e7); border-radius: 10px; padding: 12px 14px; background: var(--surface, #fff); }
.tg-card.st-paused { opacity: 0.75; }
.tg-card-head { display: flex; align-items: center; gap: 8px; }
.tg-name { font-weight: 700; }
.tg-badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 600; }
.b-active { background: #e1f5e9; color: #1b7a3d; }
.b-paused { background: #fdf3d7; color: #8a6d00; }
.b-done { background: #ececf0; color: #555; }
.tg-meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12.5px; color: var(--text-secondary, #666); margin-top: 4px; }
.tg-msg { font-size: 13px; margin-top: 6px; color: var(--text, #333); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 640px; }
.tg-run { margin-top: 6px; font-size: 12.5px; color: var(--text-secondary, #555); }
.run-badge { font-size: 11px; padding: 1px 7px; border-radius: 99px; font-weight: 600; margin-right: 6px; }
.r-sent { background: #e1f5e9; color: #1b7a3d; }
.r-no_zalo { background: #ececf0; color: #555; }
.r-failed { background: #fde3e1; color: #a12318; }
.r-skipped { background: #ececf0; color: #555; }
.w-waiting { background: #dcedff; color: #135ba1; }
.w-sent { background: #e1f5e9; color: #1b7a3d; }
.w-failed { background: #fde3e1; color: #a12318; }
.f-check { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; font-size: 13px; cursor: pointer; }
.f-check input { margin-top: 2px; }
.f-block-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; max-height: 180px; overflow: auto; }
.f-block-item { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border, #e5e4e7); border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; }
.f-block-name { font-weight: 600; flex-shrink: 0; }
.f-block-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tg-card-actions { display: flex; gap: 4px; align-items: flex-start; flex-shrink: 0; }
.btn-link { background: none; border: none; color: #135ba1; cursor: pointer; font-size: 12.5px; text-decoration: underline; padding: 0; }
.danger { color: #a12318; }
.tg-overlay { position: fixed; inset: 0; background: rgba(20, 20, 30, 0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.tg-modal { background: var(--surface, #fff); border-radius: 12px; padding: 18px 20px; width: 560px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); overflow: auto; }
.tg-modal-wide { width: 760px; }
.tg-modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 15px; }
.btn-x { background: none; border: none; cursor: pointer; padding: 2px; }
.tg-modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.f-label { display: block; font-size: 12.5px; font-weight: 600; margin: 10px 0 4px; }
.f-hint { font-weight: 400; color: var(--text-secondary, #888); }
.f-input { width: 100%; border: 1px solid var(--border, #d5d4d8); border-radius: 8px; padding: 7px 10px; font-size: 13.5px; background: var(--surface, #fff); color: inherit; }
.f-row { display: flex; gap: 10px; }
.f-col { flex: 1; min-width: 0; }
.f-tabs { display: flex; gap: 6px; }
.f-tab { border: 1px solid var(--border, #d5d4d8); background: none; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.f-tab.on { background: #0e445a; color: #fff; border-color: #0e445a; }
.f-adv { margin-top: 12px; font-size: 13px; }
.f-adv summary { cursor: pointer; font-weight: 600; }
.tg-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tg-table th, .tg-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border, #eee); }
.err { color: #a12318; font-size: 12px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
