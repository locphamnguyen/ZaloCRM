<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="sp-overlay" @click.self="$emit('close')">
    <div class="sp-box">
      <header class="sp-head">
        <b>Gửi "{{ assetName }}" vào hội thoại</b>
        <button class="sp-x" @click="$emit('close')">✕</button>
      </header>

      <!-- Chip lọc theo nick (chỉ nick của sale — scope owner) -->
      <div v-if="nicks.length > 1" class="sp-nicks">
        <button class="sp-chip" :class="{ on: nickFilter === '' }" @click="setNick('')">Tất cả nick</button>
        <button
          v-for="n in nicks"
          :key="n.id"
          class="sp-chip"
          :class="{ on: nickFilter === n.id, main: n.privacyMode === 'main' }"
          @click="setNick(n.id)"
        >
          {{ n.displayName || 'Nick' }}<span v-if="n.privacyMode === 'main'" class="sp-maintag">chính</span>
        </button>
      </div>

      <div class="sp-search">
        <span class="i">🔍</span>
        <input v-model="q" placeholder="Tìm khách / hội thoại…" @input="debouncedReload" />
      </div>

      <div v-if="loading" class="sp-empty">Đang tải hội thoại…</div>
      <div v-else-if="convs.length === 0" class="sp-empty">Không có hội thoại 1-1 nào.</div>
      <ul v-else class="sp-list">
        <li v-for="c in convs" :key="c.id">
          <button class="sp-row" :disabled="sending === c.id" @click="chooseConv(c)">
            <img v-if="c.contact?.avatar" :src="c.contact.avatar" class="sp-av" alt="" />
            <span v-else class="sp-av ph">{{ initials(c) }}</span>
            <span class="sp-name">{{ c.contact?.displayName || c.title || 'Khách' }}</span>
            <!-- Nhãn nick: rõ khách này thuộc nick nào (chống gửi nhầm khi 1 sale có 5 nick) -->
            <span v-if="c.zaloAccount?.displayName" class="sp-nick" :class="{ main: c.zaloAccount.privacyMode === 'main' }">
              {{ c.zaloAccount.displayName }}
            </span>
            <span v-if="sending === c.id" class="sp-sending">Đang gửi…</span>
          </button>
        </li>
      </ul>

      <!-- ─ Ô XÁC NHẬN "xem lại trước khi gửi" + gắn tag (2026-06-15) ─ -->
      <div v-if="pendingConv" class="sp-confirm">
        <div class="spc-head">
          <span>Gửi cho <b>{{ pendingConv.contact?.displayName || pendingConv.title || 'khách' }}</b>
            <i v-if="pendingConv.zaloAccount?.displayName">· nick {{ pendingConv.zaloAccount.displayName }}</i>
          </span>
        </div>
        <!-- Gắn dự án/tag cho ảnh này — chip 1 chạm (sale lười gắn tag riêng nên gắn ngay lúc gửi). -->
        <div class="spc-tags">
          <div class="spc-tlabel"><TagIcon :size="12" :stroke-width="2" /> Gắn dự án / tag cho ảnh này</div>
          <div class="spc-chips">
            <button
              v-for="tag in suggestTags" :key="tag"
              class="spc-chip" :class="{ on: pickedTags.has(tag) }"
              @click="toggleTag(tag)"
            >#{{ tag }}<span v-if="pickedTags.has(tag)" class="spc-tick">✓</span></button>
            <span v-if="tagsLoading" class="spc-hint">Đang tải gợi ý…</span>
            <span v-else-if="suggestTags.length === 0" class="spc-hint">Chưa có gợi ý — gõ tag mới bên dưới</span>
          </div>
          <input v-model="newTag" class="spc-newtag" placeholder="+ Thêm tag mới rồi Enter" @keyup.enter="addNewTag" />
        </div>
        <div class="spc-foot">
          <button class="spc-cancel" :disabled="!!sending" @click="cancelPending">Hủy</button>
          <button class="spc-send" :disabled="!!sending" @click="confirmSend">
            <SendIcon :size="14" :stroke-width="2" /> {{ sending ? 'Đang gửi…' : 'Gửi ảnh' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { sendMediaToConversation, suggestMedia, listMediaTags } from '@/api/media';
import { useToast } from '@/composables/use-toast';
import { Tag as TagIcon, Send as SendIcon } from 'lucide-vue-next';

const props = defineProps<{ assetId: string; assetName: string; watermarkUrl?: string | null }>();
const emit = defineEmits<{ close: []; sent: [] }>();
const toast = useToast();

interface NickRow { id: string; displayName?: string; privacyMode?: 'main' | 'sub' }
interface ConvRow {
  id: string;
  title?: string;
  threadType?: string;
  contact?: { displayName?: string; avatar?: string };
  zaloAccount?: { id?: string; displayName?: string; privacyMode?: 'main' | 'sub' };
}

const nicks = ref<NickRow[]>([]);
const convs = ref<ConvRow[]>([]);
const loading = ref(false);
const q = ref('');
const nickFilter = ref<string>(''); // '' = tất cả nick của sale
const sending = ref<string | null>(null);

// ── Ô xác nhận "xem lại trước khi gửi" + gắn tag (2026-06-15) ────────────────
// Bấm chọn 1 hội thoại → KHÔNG gửi ngay; mở ô xác nhận có chip tag gợi ý. Bấm "Gửi ảnh"
// mới gửi (kèm tag đã chọn). Chip = tag dự án/tag của KHÁCH đang chat (contactTags), khách
// chưa có tag → fallback "tag hay dùng" của sale (listMediaTags) để không trống trơn.
const pendingConv = ref<ConvRow | null>(null);
const suggestTags = ref<string[]>([]);   // chip gợi ý (contactTags hoặc tag hay dùng)
const pickedTags = ref<Set<string>>(new Set()); // tag sale đã bấm chọn để gắn
const newTag = ref('');
const tagsLoading = ref(false);

let timer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() { if (timer) clearTimeout(timer); timer = setTimeout(reload, 300); }
function setNick(id: string) { nickFilter.value = id; reload(); }

function initials(c: ConvRow): string {
  const n = c.contact?.displayName || c.title || '?';
  return n.trim().charAt(0).toUpperCase();
}

// Sắp nick: nick CHÍNH (main) trước, rồi theo tên. Dùng để default ưu tiên nick chính.
function sortNicks(list: NickRow[]): NickRow[] {
  return [...list].sort((a, b) => {
    const am = a.privacyMode === 'main' ? 0 : 1;
    const bm = b.privacyMode === 'main' ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
}

async function loadNicks() {
  try {
    const res = await api.get('/zalo-accounts');
    const list = (res.data ?? []).map((a: any) => ({
      id: a.id, displayName: a.displayName, privacyMode: a.privacyMode,
    })) as NickRow[];
    nicks.value = sortNicks(list);
  } catch { /* không có nick list cũng không sao — vẫn load hội thoại scope */ }
}

async function reload() {
  loading.value = true;
  try {
    // CHỈ hội thoại 1-1 (threadType='user'). Backend tự scope theo nick sale sở hữu
    // (getZaloScope) → không lẫn nick sale khác. accountId = lọc 1 nick cụ thể.
    const params: Record<string, string | number> = { threadType: 'user', limit: 60 };
    if (q.value) params.q = q.value;
    if (nickFilter.value) params.accountId = nickFilter.value;
    const res = await api.get('/conversations', { params });
    const list = (res.data.conversations ?? []).filter((c: ConvRow) => c.threadType !== 'group') as ConvRow[];
    // Default ưu tiên nick chính: hội thoại của nick main lên đầu (khi xem "Tất cả nick").
    convs.value = nickFilter.value ? list : sortConvByMainNick(list);
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được hội thoại');
  } finally {
    loading.value = false;
  }
}

function sortConvByMainNick(list: ConvRow[]): ConvRow[] {
  return [...list].sort((a, b) => {
    const am = a.zaloAccount?.privacyMode === 'main' ? 0 : 1;
    const bm = b.zaloAccount?.privacyMode === 'main' ? 0 : 1;
    return am - bm; // main trước, giữ nguyên thứ tự còn lại (recent từ backend)
  });
}

// Bước 1: chọn hội thoại → mở ô xác nhận + load chip tag gợi ý (KHÔNG gửi ngay).
async function chooseConv(c: ConvRow) {
  if (sending.value) return;
  pendingConv.value = c;
  pickedTags.value = new Set();
  newTag.value = '';
  await loadSuggestTags(c.id);
}

// Tải chip tag gợi ý: tag của KHÁCH đang chat (contactTags). Khách chưa có tag → fallback
// "tag hay dùng" của sale để sale vẫn gắn được (empty-state — design-review Pass 2).
async function loadSuggestTags(conversationId: string) {
  tagsLoading.value = true;
  try {
    const res = await suggestMedia(conversationId);
    let tags = res.contactTags ?? [];
    if (tags.length === 0) {
      const popular = await listMediaTags(8);
      tags = popular.map((t) => t.tag);
    }
    suggestTags.value = [...new Set(tags)];
  } catch {
    suggestTags.value = [];
  } finally {
    tagsLoading.value = false;
  }
}

function toggleTag(tag: string) {
  const next = new Set(pickedTags.value);
  if (next.has(tag)) next.delete(tag); else next.add(tag);
  pickedTags.value = next;
}
function addNewTag() {
  const t = newTag.value.trim().toLowerCase();
  if (t) {
    const next = new Set(pickedTags.value); next.add(t); pickedTags.value = next;
    if (!suggestTags.value.includes(t)) suggestTags.value = [...suggestTags.value, t];
  }
  newTag.value = '';
}
function cancelPending() { pendingConv.value = null; pickedTags.value = new Set(); }

// Bước 2: bấm "Gửi ảnh" → gửi thật + gắn tag đã chọn (addTags).
async function confirmSend() {
  const c = pendingConv.value;
  if (!c || sending.value) return;
  sending.value = c.id;
  try {
    // Gửi qua đúng conversation → đúng nick (externalThreadId buộc nick).
    const addTags = [...pickedTags.value];
    await sendMediaToConversation(props.assetId, c.id, undefined, addTags.length ? addTags : undefined);
    const nick = c.zaloAccount?.displayName ? ` (nick ${c.zaloAccount.displayName})` : '';
    toast.success(`Đã gửi cho ${c.contact?.displayName || 'khách'}${nick}`);
    emit('sent');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi thất bại');
  } finally {
    sending.value = null;
  }
}

onMounted(async () => { await loadNicks(); await reload(); });
</script>

<style scoped>
.sp-overlay { position:fixed; inset:0; z-index:120; background:rgba(15,23,42,.32); display:flex; align-items:center; justify-content:center; }
.sp-box {
  --ink:#181d26; --muted:#41454d; --hairline:#dddddd; --canvas:#fff; --soft:#f8fafc; --coral:#aa2d00; --forest:#006400;
  --action:#1786be;
  width:440px; max-width:94vw; max-height:74vh; background:var(--canvas); border:1px solid var(--hairline);
  border-radius:12px; box-shadow:0 16px 48px rgba(15,23,42,.22); display:flex; flex-direction:column; overflow:hidden;
  position:relative;
}
.sp-head { padding:14px 18px; border-bottom:1px solid var(--hairline); display:flex; align-items:center; justify-content:space-between; color:var(--ink); font-size:14px; }
.sp-x { border:none; background:none; cursor:pointer; color:var(--muted); font-size:15px; }
.sp-nicks { display:flex; gap:6px; padding:10px 16px 4px; flex-wrap:wrap; }
.sp-chip { border:1px solid var(--hairline); background:var(--canvas); color:var(--muted); border-radius:9999px; padding:4px 12px; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
.sp-chip.on { background:var(--ink); color:#fff; border-color:var(--ink); }
.sp-chip.main:not(.on) { border-color:#bfe0bf; }
.sp-maintag { font-size:9.5px; background:var(--forest); color:#fff; border-radius:9999px; padding:1px 6px; }
.sp-chip.on .sp-maintag { background:rgba(255,255,255,.25); }
.sp-search { display:flex; align-items:center; gap:8px; padding:10px 16px; border-bottom:1px solid var(--hairline); background:var(--soft); }
.sp-search .i { color:var(--muted); }
.sp-search input { flex:1; border:none; background:none; outline:none; font-size:13px; color:var(--ink); }
.sp-list { list-style:none; margin:0; padding:6px 0; overflow:auto; }
.sp-row { display:flex; align-items:center; gap:10px; width:100%; padding:9px 16px; border:none; background:none; cursor:pointer; text-align:left; }
.sp-row:hover { background:var(--soft); }
.sp-row:disabled { opacity:.5; }
.sp-av { width:34px; height:34px; border-radius:9999px; object-fit:cover; flex-shrink:0; }
.sp-av.ph { display:flex; align-items:center; justify-content:center; background:#e0e2e6; color:var(--muted); font-size:14px; font-weight:600; }
.sp-name { flex:1; font-size:13.5px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sp-nick { font-size:11px; color:var(--muted); background:var(--soft); border:1px solid var(--hairline); border-radius:9999px; padding:2px 9px; white-space:nowrap; }
.sp-nick.main { color:var(--forest); border-color:#bfe0bf; background:#f0f7f0; }
.sp-sending { font-size:11px; color:var(--muted); }
.sp-empty { padding:28px 16px; text-align:center; font-size:13px; color:var(--muted); }

/* ── Ô xác nhận "xem lại trước khi gửi" + gắn tag (2026-06-15) — Atlas v2, action #1786be ── */
.sp-confirm { position:absolute; left:0; right:0; bottom:0; background:var(--canvas); border-top:2px solid var(--action);
  box-shadow:0 -8px 24px rgba(15,23,42,.14); padding:14px 18px; border-radius:0 0 12px 12px; }
.spc-head { font-size:13.5px; color:var(--ink); margin-bottom:11px; }
.spc-head i { font-style:normal; color:var(--muted); font-size:12px; }
.spc-tlabel { display:flex; align-items:center; gap:5px; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:600; margin-bottom:7px; }
.spc-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; min-height:28px; align-items:center; }
.spc-chip { display:inline-flex; align-items:center; gap:4px; border:1px solid var(--hairline); background:var(--canvas);
  color:var(--muted); border-radius:9999px; padding:4px 11px; font-size:12px; cursor:pointer; }
.spc-chip.on { background:var(--action); border-color:var(--action); color:#fff; }
.spc-tick { font-weight:800; font-size:11px; }
.spc-hint { font-size:11.5px; color:var(--muted); }
.spc-newtag { width:100%; border:1px solid var(--hairline); border-radius:var(--r-sm,6px); padding:6px 10px; font-size:12.5px; outline:none; color:var(--ink); }
.spc-foot { display:flex; gap:8px; align-items:center; margin-top:12px; }
.spc-cancel { border:1px solid var(--hairline); background:var(--canvas); color:var(--muted); border-radius:8px; padding:8px 14px; font-size:13px; cursor:pointer; min-height:34px; }
.spc-send { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:none; background:var(--ink);
  color:#fff; border-radius:8px; padding:8px; font-size:13.5px; font-weight:500; cursor:pointer; min-height:34px; }
.spc-send:disabled, .spc-cancel:disabled { opacity:.55; cursor:default; }
</style>
