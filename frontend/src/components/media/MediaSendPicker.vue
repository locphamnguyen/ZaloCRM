<template>
  <div class="sp-overlay" @click.self="$emit('close')">
    <div class="sp-box">
      <header class="sp-head">
        <b>Gửi "{{ assetName }}" vào hội thoại</b>
        <button class="sp-x" @click="$emit('close')">✕</button>
      </header>
      <div class="sp-search">
        <span class="i">🔍</span>
        <input v-model="q" placeholder="Tìm khách / hội thoại…" @input="debouncedReload" />
      </div>
      <div v-if="loading" class="sp-empty">Đang tải hội thoại…</div>
      <div v-else-if="convs.length === 0" class="sp-empty">Không có hội thoại 1-1 nào.</div>
      <ul v-else class="sp-list">
        <li v-for="c in convs" :key="c.id">
          <button class="sp-row" :disabled="sending === c.id" @click="send(c)">
            <img v-if="c.contact?.avatar" :src="c.contact.avatar" class="sp-av" alt="" />
            <span v-else class="sp-av ph">{{ initials(c) }}</span>
            <span class="sp-name">{{ c.contact?.displayName || c.title || 'Khách' }}</span>
            <span v-if="c.zaloAccount?.displayName" class="sp-nick">{{ c.zaloAccount.displayName }}</span>
            <span v-if="sending === c.id" class="sp-sending">Đang gửi…</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { sendMediaToConversation } from '@/api/media';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{ assetId: string; assetName: string; watermarkUrl?: string | null }>();
const emit = defineEmits<{ close: []; sent: [] }>();
const toast = useToast();

interface ConvRow {
  id: string;
  title?: string;
  threadType?: string;
  contact?: { displayName?: string; avatar?: string };
  zaloAccount?: { displayName?: string };
}

const convs = ref<ConvRow[]>([]);
const loading = ref(false);
const q = ref('');
const sending = ref<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() { if (timer) clearTimeout(timer); timer = setTimeout(reload, 300); }

function initials(c: ConvRow): string {
  const n = c.contact?.displayName || c.title || '?';
  return n.trim().charAt(0).toUpperCase();
}

async function reload() {
  loading.value = true;
  try {
    // CHỈ hội thoại 1-1 (threadType='user') — không gửi vào nhóm Zalo
    // (memory: feedback_crm_filter_1to1_not_group).
    const res = await api.get('/conversations', {
      params: { threadType: 'user', q: q.value || undefined, limit: 40 },
    });
    const list = (res.data.conversations ?? []) as ConvRow[];
    convs.value = list.filter((c) => c.threadType !== 'group');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được hội thoại');
  } finally {
    loading.value = false;
  }
}

async function send(c: ConvRow) {
  if (sending.value) return;
  sending.value = c.id;
  try {
    // Watermark BẬT → gửi bản watermark (backend tự chọn variant khi watermarkEnabled).
    await sendMediaToConversation(props.assetId, c.id);
    toast.success(`Đã gửi cho ${c.contact?.displayName || 'khách'}`);
    emit('sent');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi thất bại');
  } finally {
    sending.value = null;
  }
}

onMounted(reload);
</script>

<style scoped>
.sp-overlay { position:fixed; inset:0; z-index:120; background:rgba(15,23,42,.32); display:flex; align-items:center; justify-content:center; }
.sp-box {
  --ink:#181d26; --muted:#41454d; --hairline:#dddddd; --canvas:#fff; --soft:#f8fafc;
  width:420px; max-width:94vw; max-height:72vh; background:var(--canvas); border:1px solid var(--hairline);
  border-radius:12px; box-shadow:0 16px 48px rgba(15,23,42,.22); display:flex; flex-direction:column; overflow:hidden;
}
.sp-head { padding:14px 18px; border-bottom:1px solid var(--hairline); display:flex; align-items:center; justify-content:space-between; color:var(--ink); font-size:14px; }
.sp-x { border:none; background:none; cursor:pointer; color:var(--muted); font-size:15px; }
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
.sp-nick { font-size:11px; color:var(--muted); background:var(--soft); border:1px solid var(--hairline); border-radius:9999px; padding:2px 8px; }
.sp-sending { font-size:11px; color:var(--muted); }
.sp-empty { padding:28px 16px; text-align:center; font-size:13px; color:var(--muted); }
</style>
