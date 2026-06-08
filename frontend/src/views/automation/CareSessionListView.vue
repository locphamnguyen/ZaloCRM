<!--
  CareSessionListView — Phiên chăm sóc, BỐ TRÍ LẠI (anh chốt 2026-06-07).
  Mục tiêu: sale nhìn 1 phát biết KH nào VỪA TRẢ LỜI (xử lý gấp), phiên nào TẠM DỪNG
  + pause bao lâu + khi nào chạy lại + đã báo sale chưa.
  Mockup: ~/.gstack/projects/locphamnguyen-ZaloCRM/designs/care-sessions-redesign-20260607/
-->
<template>
  <div class="cs-wrap airtable-scope">
    <div class="cs-hd">
      <div>
        <div class="cs-title"><span class="ic">💙</span> Phiên chăm sóc</div>
        <div class="cs-sub">Theo dõi khách trong các luồng bám đuổi — ai vừa trả lời, phiên nào đang tạm dừng, khi nào chạy lại.</div>
      </div>
      <button v-if="tab === 'sessions'" class="btn-ghost" @click="load">↻ Làm mới</button>
    </div>

    <!-- Tab strip (anh chốt 2026-06-07): gộp "Lắng nghe & Nhắc" thành tab Cài đặt -->
    <div class="tabs">
      <button :class="{ on: tab === 'sessions' }" @click="tab = 'sessions'">💙 Phiên chăm sóc</button>
      <button :class="{ on: tab === 'settings' }" @click="tab = 'settings'">⚙️ Cài đặt lắng nghe</button>
    </div>

    <!-- TAB CÀI ĐẶT: render component cấu hình lắng nghe (dùng lại, không viết lại) -->
    <CareListenConfigView v-if="tab === 'settings'" embedded />

    <!-- TAB PHIÊN -->
    <template v-else>
    <!-- KPI strip -->
    <div class="kpis">
      <div class="kpi" :class="{ alert: counts.reply > 0 }">
        <div class="ic g">🔥</div>
        <div><div class="num">{{ counts.reply }}</div><div class="lbl">KH vừa trả lời — xử lý gấp</div></div>
      </div>
      <div class="kpi"><div class="ic y">⏸</div><div><div class="num">{{ counts.paused }}</div><div class="lbl">Đang tạm dừng</div></div></div>
      <div class="kpi"><div class="ic b">💬</div><div><div class="num">{{ counts.active }}</div><div class="lbl">Đang chăm sóc</div></div></div>
      <div class="kpi"><div class="ic gray">✓</div><div><div class="num">{{ counts.closed }}</div><div class="lbl">Đã đóng</div></div></div>
    </div>

    <!-- filter bar -->
    <div class="fbar">
      <div class="seg">
        <button v-for="f in FILTERS" :key="f.key" :class="{ on: filter === f.key }" @click="filter = f.key">{{ f.label }}</button>
      </div>
      <input class="search" v-model="search" placeholder="🔍 Tìm tên / SĐT khách…">
    </div>

    <div class="cs-grid">
      <div>
        <div v-if="loading" class="empty">Đang tải…</div>
        <div v-else-if="!visibleItems.length" class="empty">Chưa có phiên nào.</div>

        <!-- Group theo uiState -->
        <template v-for="grp in groups" :key="grp.key">
          <div v-if="grp.items.length" class="sec">
            <div class="sec-h">
              <span class="dot" :class="grp.dot"></span><h3>{{ grp.title }}</h3>
              <span class="cnt">{{ grp.items.length }}</span>
              <span class="hint">{{ grp.hint }}</span>
            </div>
            <div v-for="it in grp.items" :key="it.id" class="card" :class="grp.key"
                 @click="select(it)">
              <div class="av" :class="genderCls(it.contactGender)">
                <img v-if="it.contactAvatar" :src="it.contactAvatar" :alt="it.contactName" @error="onAvatarError">
                <span v-else>{{ genderIcon(it.contactGender) || initials(it.contactName) }}</span>
              </div>
              <div class="c-main">
                <div class="c-name">
                  {{ it.contactName }}
                  <span v-if="it.contactPhone" class="phone">{{ displayPhone(it.contactPhone) }}</span>
                  <span v-if="it.uiState === 'reply'" class="pill reply">💬 Vừa trả lời</span>
                </div>
                <div class="c-sub">
                  <span class="src">{{ it.sourceLabel }}</span>
                  <span v-if="it.triggerLabel" class="from">từ "{{ it.triggerLabel }}"</span>
                  <span v-if="it.nickName" class="dotsep">·</span>
                  <span v-if="it.nickName" class="nick">nick {{ it.nickName }}</span>
                  <span v-if="stepText(it)" class="dotsep">·</span>
                  <span v-if="stepText(it)" class="pill run">{{ stepText(it) }}</span>
                  <span v-if="it.notifiedSale && it.uiState === 'reply'" class="pill notified">✓ Đã báo bạn</span>
                </div>
              </div>
              <div class="c-right">
                <div v-if="it.uiState === 'reply'" class="c-time">trả lời <b>{{ ago(it.lastReplyAt) }}</b></div>
                <div v-else-if="it.uiState === 'paused'" class="resume">⏸ Chạy lại sau <span class="cd">{{ remaining(it.pausedUntil) }}</span></div>
                <div v-else-if="it.uiState === 'closed'" class="c-time">{{ closeLabel(it.closedReason) }}</div>
                <template v-else>
                  <div v-if="it.nextRunAt" class="c-time">gửi tiếp <b>{{ hhmm(it.nextRunAt) }}</b></div>
                  <div v-else class="c-time">đã gửi xong chuỗi</div>
                  <div class="c-time muted">mở {{ ago(it.openedAt) }}</div>
                </template>
                <button v-if="it.uiState === 'reply'" class="btn-sm primary" @click.stop="openChat(it)">Trả lời ngay →</button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- detail panel -->
      <div v-if="selected" class="panel">
        <div class="p-head" :class="{ reply: selected.uiState === 'reply' }">
          <div class="pn">
            <div class="av" :class="genderCls(selected.contactGender)">
              <img v-if="selected.contactAvatar" :src="selected.contactAvatar" :alt="selected.contactName" @error="onAvatarError">
              <span v-else>{{ genderIcon(selected.contactGender) || initials(selected.contactName) }}</span>
            </div>
            <div>
              <div class="pn-name">{{ selected.contactName }}</div>
              <div class="pn-meta">{{ selected.contactPhone ? displayPhone(selected.contactPhone) : '—' }} · {{ selected.ownerName }}</div>
            </div>
          </div>
          <div class="p-status">
            <div class="row"><span class="k">Trạng thái</span><span class="v" :class="stateClass(selected.uiState)">{{ stateLabel(selected.uiState) }}</span></div>
            <div v-if="selected.lastReplyAt" class="row"><span class="k">KH trả lời</span><span class="v">{{ ago(selected.lastReplyAt) }} ({{ hhmm(selected.lastReplyAt) }})</span></div>
            <div v-if="selected.notifiedSale" class="row"><span class="k">Báo sale</span><span class="v ok">✓ Đã báo bạn lúc {{ hhmm(selected.lastReplyAt) }}</span></div>
            <div v-if="selected.pausedUntil && selected.uiState !== 'closed'" class="row"><span class="k">Chạy lại</span><span class="v warn">sau {{ remaining(selected.pausedUntil) }}</span></div>
            <div class="row"><span class="k">Luồng</span><span class="v">{{ selected.sourceLabel }}<template v-if="selected.triggerLabel"> · từ "{{ selected.triggerLabel }}"</template></span></div>
          </div>
        </div>
        <div class="p-body">
          <div class="p-sec-t">Dòng thời gian</div>
          <div v-if="detailLoading" class="empty sm">Đang tải…</div>
          <div v-else class="tl">
            <div v-for="(ev, i) in detailEvents" :key="i" class="tl-item" :class="ev.cls">
              <span class="d"></span>
              <div class="t">{{ ev.text }}</div>
              <div class="ts">{{ ev.ts }}</div>
            </div>
            <div v-if="!detailEvents.length" class="empty sm">Chưa có sự kiện.</div>
          </div>
        </div>
        <div class="p-act">
          <button v-if="selected.uiState !== 'closed'" class="btn" @click="closeSession(selected)">Đóng phiên</button>
          <button class="btn primary" @click="openChat(selected)">Mở chat →</button>
        </div>
      </div>
      <div v-else class="panel empty-panel">Chọn 1 phiên để xem chi tiết</div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';
import { displayPhone } from '@/composables/use-phone-format';
import CareListenConfigView from './CareListenConfigView.vue';

const router = useRouter();
const toast = useToast();

interface CareItem {
  id: string; contactName: string; contactPhone: string | null; ownerName: string;
  contactAvatar: string | null; contactGender: string | null;
  sourceType: string; sourceLabel: string; triggerLabel: string | null; state: string;
  uiState: 'reply' | 'paused' | 'active' | 'closed';
  closedReason: string | null; lastReplyAt: string | null; pausedUntil: string | null;
  notifiedSale: boolean; openedAt: string; closedAt: string | null;
  nickName: string | null; sentSteps: number; totalSteps: number; nextRunAt: string | null;
}

const tab = ref<'sessions' | 'settings'>('sessions');
const items = ref<CareItem[]>([]);
const loading = ref(false);
const search = ref('');
const filter = ref<'all' | 'reply' | 'paused' | 'active' | 'closed'>('all');
const selected = ref<CareItem | null>(null);
const detailEvents = ref<{ text: string; ts: string; cls: string }[]>([]);
const detailLoading = ref(false);

const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'reply', label: 'Vừa trả lời' },
  { key: 'paused', label: 'Tạm dừng' },
  { key: 'active', label: 'Đang chăm' },
  { key: 'closed', label: 'Đã đóng' },
] as const;

const counts = computed(() => ({
  reply: items.value.filter((i) => i.uiState === 'reply').length,
  paused: items.value.filter((i) => i.uiState === 'paused').length,
  active: items.value.filter((i) => i.uiState === 'active').length,
  closed: items.value.filter((i) => i.uiState === 'closed').length,
}));

const visibleItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter((i) => {
    if (filter.value !== 'all' && i.uiState !== filter.value) return false;
    if (q) {
      // Tìm theo tên HOẶC SĐT — so phần chỉ-chữ-số để nhập 0909/84909/909 đều match.
      const qDigits = q.replace(/\D/g, '');
      const phoneDigits = (i.contactPhone ?? '').replace(/\D/g, '');
      const nameMatch = i.contactName.toLowerCase().includes(q);
      const phoneMatch = qDigits.length > 0 && phoneDigits.includes(qDigits.replace(/^0/, ''));
      if (!nameMatch && !phoneMatch) return false;
    }
    return true;
  });
});

const groups = computed(() => [
  { key: 'reply',  title: 'Cần xử lý ngay', dot: 'reply', hint: 'KH vừa trả lời, luồng đã tạm dừng — vào nhắn lại', items: visibleItems.value.filter((i) => i.uiState === 'reply') },
  { key: 'paused', title: 'Đang tạm dừng', dot: 'paused', hint: 'KH đã tương tác — luồng dừng tạm, tự chạy lại sau', items: visibleItems.value.filter((i) => i.uiState === 'paused') },
  { key: 'active', title: 'Đang chăm sóc', dot: 'run', hint: 'Luồng đang chạy bình thường', items: visibleItems.value.filter((i) => i.uiState === 'active') },
  { key: 'closed', title: 'Đã đóng', dot: 'done', hint: '', items: visibleItems.value.filter((i) => i.uiState === 'closed') },
]);

// "đã gửi X/N" cho card đang chăm (chỉ hiện khi có tổng bước).
function stepText(it: CareItem): string {
  if (!it.totalSteps) return '';
  const sent = Math.min(it.sentSteps, it.totalSteps);
  return `đã gửi ${sent}/${it.totalSteps}`;
}
// Avatar giới tính: fallback icon khi không có ảnh Zalo.
function genderIcon(g: string | null): string {
  if (g === 'male') return '👨';
  if (g === 'female') return '👩';
  return '';
}
function genderCls(g: string | null): string {
  return g === 'male' ? 'g-male' : g === 'female' ? 'g-female' : '';
}
function onAvatarError(e: Event) {
  // Ảnh Zalo lỗi/hết hạn → ẩn img, để fallback span hiện (cần re-render: ẩn src).
  (e.target as HTMLImageElement).style.display = 'none';
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase() || '?';
}
function hhmm(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
function ago(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}
function remaining(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'sắp chạy';
  const h = Math.floor(diff / 3600_000);
  const m = Math.floor((diff % 3600_000) / 60000);
  return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
}
function closeLabel(reason: string | null): string {
  const map: Record<string, string> = {
    janitor_silence: 'đóng do im lặng', customer_blocked: 'KH chặn', source_done: 'Mục tiêu kết thúc',
    sale_resolved: 'sale đóng', status_match: 'đạt trạng thái',
  };
  return reason ? (map[reason] ?? 'đã đóng') : 'đã đóng';
}
function stateLabel(s: string): string {
  return ({ reply: '💬 Vừa trả lời — luồng đã tạm dừng', paused: '⏸ Đang tạm dừng', active: '💬 Đang chăm sóc', closed: '✓ Đã đóng' } as Record<string, string>)[s] ?? s;
}
function stateClass(s: string): string {
  return ({ reply: 'reply', paused: 'warn', active: '', closed: '' } as Record<string, string>)[s] ?? '';
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: CareItem[] }>('/automation/care-sessions?state=all');
    items.value = res.data.items ?? [];
  } catch {
    toast.error('Không tải được phiên chăm sóc');
  } finally {
    loading.value = false;
  }
}

async function select(it: CareItem) {
  selected.value = it;
  detailLoading.value = true;
  detailEvents.value = [];
  try {
    const res = await api.get<{ events: { eventType: string; createdAt: string; payload?: { contentPreview?: string } }[] }>(
      `/automation/care-sessions/${it.id}`,
    );
    const EV: Record<string, { text: string; cls: string }> = {
      reply: { text: '💬 KH trả lời', cls: 'reply' },
      reaction_positive: { text: '❤️ KH thả cảm xúc tích cực', cls: 'reply' },
      reaction_negative: { text: '💔 KH thả cảm xúc tiêu cực', cls: 'pause' },
      block: { text: '🚫 KH chặn nick', cls: 'pause' },
      lead: { text: '⭐ KH thành Lead', cls: 'notify' },
    };
    detailEvents.value = (res.data.events ?? []).map((e) => {
      const def = EV[e.eventType] ?? { text: e.eventType, cls: '' };
      const preview = e.payload?.contentPreview ? `: "${e.payload.contentPreview.slice(0, 40)}…"` : '';
      return { text: def.text + preview, ts: `${hhmm(e.createdAt)} · ${ago(e.createdAt)}`, cls: def.cls };
    });
  } catch {
    /* best-effort */
  } finally {
    detailLoading.value = false;
  }
}

async function closeSession(it: CareItem) {
  try {
    await api.post(`/automation/care-sessions/${it.id}/close`, { reason: 'sale_resolved' });
    toast.success('Đã đóng phiên');
    load();
    selected.value = null;
  } catch {
    toast.error('Đóng phiên thất bại');
  }
}

function openChat(it: CareItem) {
  // Điều hướng tới chat của KH (resolve conversation theo contact ở trang chat).
  router.push({ path: '/chat', query: { contactId: it.id } });
}

onMounted(load);
</script>

<style scoped>
.cs-wrap { padding: 18px 22px 70px; }
.cs-hd { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 4px; }
.cs-title { font-size: 21px; font-weight: 600; color: var(--ink, #141a24); display: flex; align-items: center; gap: 9px; }
.cs-title .ic { color: var(--brand, #1786be); }
.cs-sub { font-size: 12.5px; color: var(--ink-3, #6b7488); margin-top: 3px; }
.btn-ghost { font-size: 12.5px; border: 1px solid var(--line, #e7eaf0); background: #fff; border-radius: 8px; padding: 7px 13px; cursor: pointer; font-family: inherit; color: var(--ink-2, #475066); }

/* Tab strip Phiên | Cài đặt */
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line, #e7eaf0); margin: 12px 0 16px; }
.tabs button { border: 0; background: transparent; font-family: inherit; font-size: 14px; font-weight: 600; color: var(--ink-3, #6b7488); padding: 9px 16px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs button.on { color: var(--brand, #1786be); border-bottom-color: var(--brand, #1786be); }
.tabs button:hover:not(.on) { color: var(--ink-2, #475066); }
/* Config nhúng trong tab → bỏ padding ngoài (đã có .cs-wrap) + bỏ tiêu đề riêng. */
:deep(.clc-wrap) { padding: 0 !important; }

.kpis { display: flex; gap: 12px; margin: 14px 0 18px; }
.kpi { flex: 1; background: #fff; border: 1px solid var(--line, #e7eaf0); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
.kpi.alert { border-color: #f97316; background: #fff2e8; }
.kpi .ic { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
.kpi.alert .ic { background: #fff; }
.kpi .ic.g { background: #fff2e8; } .kpi .ic.b { background: var(--brand-softer, #f2f8fc); } .kpi .ic.y { background: #fdf6e3; } .kpi .ic.gray { background: var(--surface-3, #f1f4f9); }
.kpi .num { font-size: 22px; font-weight: 700; color: var(--ink, #141a24); line-height: 1; }
.kpi.alert .num { color: #f97316; }
.kpi .lbl { font-size: 11.5px; color: var(--ink-3, #6b7488); margin-top: 3px; }

.fbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.seg { display: inline-flex; background: #fff; border: 1px solid var(--line, #e7eaf0); border-radius: 10px; padding: 2px; gap: 2px; }
.seg button { border: 0; background: transparent; font-family: inherit; font-size: 12.5px; font-weight: 500; color: var(--ink-2, #475066); padding: 6px 14px; border-radius: 7px; cursor: pointer; }
.seg button.on { background: var(--ink, #141a24); color: #fff; }
.search { flex: 1; max-width: 280px; height: 34px; border: 1px solid var(--line, #e7eaf0); border-radius: 10px; padding: 0 12px; font-size: 13px; font-family: inherit; }

.cs-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
/* Cả 2 cột min-width:0 để nội dung dài KHÔNG đẩy panel rộng quá 380px (tràn mép phải). */
.cs-grid > * { min-width: 0; }
.empty { color: var(--ink-3, #6b7488); font-size: 13px; padding: 30px; text-align: center; background: #fff; border: 1px solid var(--line, #e7eaf0); border-radius: 12px; }
.empty.sm { padding: 14px; border: 0; }
.empty-panel { background: #fff; border: 1px dashed var(--line-strong, #cdd4e0); border-radius: 12px; padding: 40px 20px; text-align: center; color: var(--ink-3, #6b7488); font-size: 13px; }

.sec { margin-bottom: 18px; }
.sec-h { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; padding: 0 2px; }
.sec-h .dot { width: 9px; height: 9px; border-radius: 50%; }
.sec-h .dot.reply { background: #f97316; } .sec-h .dot.run { background: var(--success, #12b76a); } .sec-h .dot.done { background: var(--ink-3, #6b7488); } .sec-h .dot.paused { background: var(--warning, #d9a441); }
.sec-h h3 { font-size: 13.5px; font-weight: 600; color: var(--ink, #141a24); }
.sec-h .cnt { font-size: 11.5px; font-weight: 600; color: var(--ink-3, #6b7488); background: var(--surface-3, #f1f4f9); padding: 2px 8px; border-radius: 9999px; }
.sec-h .hint { font-size: 11px; color: var(--ink-3, #6b7488); margin-left: 4px; }

.card { background: #fff; border: 1px solid var(--line, #e7eaf0); border-radius: 12px; padding: 13px 15px; margin-bottom: 8px; cursor: pointer; display: flex; align-items: center; gap: 13px; transition: border-color .12s; }
.card:hover { border-color: var(--brand-bright, #5bb8e5); }
.card.reply { border-left: 3px solid #f97316; background: linear-gradient(90deg, #fff2e8 0%, #fff 40%); }
.card.paused { border-left: 3px solid var(--warning, #d9a441); }
.av { width: 40px; height: 40px; border-radius: 50%; background: var(--brand-softer, #f2f8fc); color: var(--brand-700, #0b5880); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 600; flex-shrink: 0; overflow: hidden; }
.av img { width: 100%; height: 100%; object-fit: cover; }
.av.g-male { background: #e8f1fd; color: #1d6fd6; }
.av.g-female { background: #fdeef5; color: #d6469a; }
.c-name .phone { font-size: 11.5px; font-weight: 500; color: var(--ink-3, #6b7488); margin-left: 2px; }
.card.reply .av { background: #fff; color: #f97316; }
.c-main { flex: 1; min-width: 0; }
.c-name { font-size: 14px; font-weight: 600; color: var(--ink, #141a24); display: flex; align-items: center; gap: 8px; }
.c-sub { font-size: 11.5px; color: var(--ink-3, #6b7488); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.c-sub .src { color: var(--ink-2, #475066); font-weight: 500; }
.c-sub .from { color: var(--ink-3, #6b7488); font-size: 11px; }
.c-sub .nick { color: var(--ink-3, #6b7488); }
.c-sub .dotsep { color: var(--line-strong, #cdd4e0); }
.c-time.muted { color: var(--line-strong, #cdd4e0); font-size: 10.5px; }
.pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; }
.pill.reply { background: #fff2e8; color: #f97316; }
.pill.run { background: var(--success-soft, #e6f7ef); color: #0a7a47; }
.pill.notified { background: var(--brand-softer, #f2f8fc); color: var(--brand-700, #0b5880); }
.c-right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; text-align: right; }
.c-time { font-size: 11px; color: var(--ink-3, #6b7488); }
.c-time b { color: var(--ink-2, #475066); font-weight: 600; }
.resume { font-size: 11.5px; font-weight: 600; color: var(--warning, #d9a441); display: flex; align-items: center; gap: 4px; }
.resume .cd { background: #fdf6e3; padding: 1px 7px; border-radius: 9999px; }
.btn-sm { font-size: 12px; font-weight: 600; border: 1px solid var(--line, #e7eaf0); background: #fff; border-radius: 7px; padding: 6px 12px; cursor: pointer; font-family: inherit; color: var(--ink, #141a24); }
.btn-sm.primary { background: #f97316; border-color: #f97316; color: #fff; }

.panel { width: 100%; background: #fff; border: 1px solid var(--line, #e7eaf0); border-radius: 12px; position: sticky; top: 18px; overflow: hidden; }
.p-head { padding: 16px 18px; border-bottom: 1px solid var(--line, #e7eaf0); }
.p-head.reply { background: linear-gradient(180deg, #fff2e8, #fff); }
.p-head .pn { display: flex; align-items: center; gap: 11px; }
.p-head .av { width: 44px; height: 44px; font-size: 17px; }
.p-head.reply .av { background: #fff; color: #f97316; }
.p-head .pn-name { font-size: 16px; font-weight: 600; color: var(--ink, #141a24); }
.p-head .pn-meta { font-size: 11.5px; color: var(--ink-3, #6b7488); margin-top: 2px; }
.p-status { margin-top: 12px; display: flex; flex-direction: column; gap: 7px; }
.p-status .row { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; }
.p-status .row .k { color: var(--ink-3, #6b7488); width: 78px; flex-shrink: 0; }
.p-status .row .v { color: var(--ink, #141a24); font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
.p-status .row .v.warn { color: var(--warning, #d9a441); } .p-status .row .v.reply { color: #f97316; } .p-status .row .v.ok { color: var(--success, #12b76a); }
.p-body { padding: 15px 18px; }
.p-sec-t { font-size: 11px; font-weight: 600; color: var(--ink-3, #6b7488); text-transform: uppercase; letter-spacing: .4px; margin-bottom: 10px; }
.tl { position: relative; padding-left: 20px; }
.tl::before { content: ''; position: absolute; left: 6px; top: 4px; bottom: 4px; width: 2px; background: var(--line, #e7eaf0); }
.tl-item { position: relative; padding-bottom: 13px; }
.tl-item:last-child { padding-bottom: 0; }
.tl-item .d { position: absolute; left: -17px; top: 2px; width: 11px; height: 11px; border-radius: 50%; background: #fff; border: 2px solid var(--line-strong, #cdd4e0); }
.tl-item.reply .d { border-color: #f97316; background: #f97316; }
.tl-item.notify .d { border-color: var(--brand, #1786be); background: var(--brand, #1786be); }
.tl-item.pause .d { border-color: var(--warning, #d9a441); background: var(--warning, #d9a441); }
.tl-item .t { font-size: 12.5px; color: var(--ink, #141a24); font-weight: 500; }
.tl-item .ts { font-size: 10.5px; color: var(--ink-3, #6b7488); margin-top: 1px; }
.p-act { padding: 13px 18px; border-top: 1px solid var(--line, #e7eaf0); display: flex; gap: 8px; }
.p-act .btn { flex: 1; font-size: 13px; font-weight: 600; border-radius: 10px; padding: 9px; cursor: pointer; font-family: inherit; border: 1px solid var(--line, #e7eaf0); background: #fff; color: var(--ink, #141a24); }
.p-act .btn.primary { background: var(--brand, #1786be); border-color: var(--brand, #1786be); color: #fff; }
</style>
