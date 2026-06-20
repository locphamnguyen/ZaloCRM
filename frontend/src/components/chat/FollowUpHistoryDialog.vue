<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
═══════════════════════════════════════════════════════════════════════
 FollowUpHistoryDialog — Lịch sử chi tiết 1 luồng bám đuổi (office-hours 2026-06-18)
═══════════════════════════════════════════════════════════════════════
 Ghép tin BƯỚC-GỬI THẬT (content + ảnh/file đính kèm render thật) + sự kiện phiên
 (khách trả lời / thả cảm xúc / tạm dừng / đóng) thành timeline tăng dần.
 Nguồn: GET /contacts/:cid/followup-history?triggerId=&sequenceId= (BE đã merge sẵn).
 Chuẩn HS theme (--brand/--ink/--surface). Render attachments tự xử cả shape cũ (RAW JSON
 trong content) lẫn cột attachments mới (fix a69d62a).
-->
<template>
  <div v-if="open" class="fh-overlay" @click.self="emit('close')">
    <div class="fh-modal" role="dialog" aria-modal="true">
      <!-- header -->
      <div class="fh-head">
        <div class="fh-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>
          <span>Lịch sử bám đuổi</span>
        </div>
        <button class="fh-x" title="Đóng" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
        </button>
      </div>
      <div class="fh-sub">
        <b>{{ flowName }}</b>
        <template v-if="card?.nickName"> · Nick {{ card.nickName }}</template>
        <span v-if="stepsSent != null" class="fh-cnt">{{ stepsSent }} bước đã gửi</span>
      </div>

      <!-- body -->
      <div class="fh-body">
        <div v-if="loading" class="fh-state">Đang tải lịch sử…</div>
        <div v-else-if="error" class="fh-state err">{{ error }}</div>
        <div v-else-if="!timeline.length" class="fh-state">Chưa có bước nào được gửi cho khách này.</div>

        <div v-else class="fh-tl">
          <template v-for="(it, i) in timeline" :key="i">
            <!-- BƯỚC GỬI (bot/sequence) -->
            <div v-if="it.kind === 'step'" class="fh-row sent">
              <div class="fh-bubble sent">
                <div class="fh-brow">
                  <span class="fh-step">Bước{{ it.stepIdx != null ? ' ' + (it.stepIdx + 1) : '' }}</span>
                  <span class="fh-st" :class="it.status">{{ statusLabel(it.status) }}</span>
                </div>
                <div v-if="normText(it)" class="fh-text">{{ normText(it) }}</div>
                <!-- ảnh -->
                <div v-if="normImages(it).length" class="fh-imgs">
                  <a v-for="(u, k) in normImages(it)" :key="k" :href="u" target="_blank" rel="noreferrer">
                    <img :src="u" alt="" referrerpolicy="no-referrer" />
                  </a>
                </div>
                <!-- file -->
                <a v-for="(f, k) in normFiles(it)" :key="'f' + k" class="fh-file" :href="f.url" target="_blank" rel="noreferrer">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                  <span class="fh-fn">{{ f.name || 'Tệp đính kèm' }}</span>
                </a>
              </div>
              <div class="fh-time">{{ fmt(it.at) }}</div>
            </div>

            <!-- KHÁCH TRẢ LỜI -->
            <div v-else-if="it.kind === 'reply'" class="fh-row recv">
              <div class="fh-bubble recv">
                <div class="fh-brow"><span class="fh-who">💬 Khách trả lời</span></div>
                <div v-if="it.text" class="fh-text">{{ it.text }}</div>
              </div>
              <div class="fh-time">{{ fmt(it.at) }}</div>
            </div>

            <!-- CẢM XÚC / SỰ KIỆN HỆ THỐNG -->
            <div v-else class="fh-mark" :class="markClass(it.kind)">
              <span class="fh-dot" />
              {{ markLabel(it) }}
              <span class="fh-mtime">{{ fmt(it.at) }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api } from '@/api/index';

interface FlowRef {
  triggerId: string;
  sequenceId?: string | null;
  sequenceName?: string | null;
  triggerName?: string | null;
  nickName?: string | null;
}
interface TimelineItem {
  kind: string;
  at: string;
  stepIdx?: number | null;
  content?: string | null;
  contentType?: string | null;
  attachments?: unknown;
  status?: string;
  text?: string | null;
  emoji?: string | null;
}

const props = defineProps<{ open: boolean; contactId: string; card: FlowRef | null }>();
const emit = defineEmits<{ close: [] }>();

const loading = ref(false);
const error = ref('');
const timeline = ref<TimelineItem[]>([]);
const stepsSent = ref<number | null>(null);

const flowName = computed(() => props.card?.sequenceName || props.card?.triggerName || 'Luồng bám đuổi');

watch(() => props.open, (o) => { if (o) load(); });

async function load(): Promise<void> {
  if (!props.card?.triggerId || !props.contactId) return;
  loading.value = true;
  error.value = '';
  timeline.value = [];
  stepsSent.value = null;
  try {
    const res = await api.get<{ flow: { stepsSent: number }; timeline: TimelineItem[] }>(
      `/contacts/${props.contactId}/followup-history`,
      { params: { triggerId: props.card.triggerId, sequenceId: props.card.sequenceId ?? undefined } },
    );
    timeline.value = res.data.timeline ?? [];
    stepsSent.value = res.data.flow?.stepsSent ?? null;
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      ?? 'Không tải được lịch sử bám đuổi.';
  } finally {
    loading.value = false;
  }
}

// ── Chuẩn hoá nội dung: parse cả shape cũ (RAW JSON trong content) lẫn cột attachments mới ──
function parsed(it: TimelineItem): { text: string; atts: Array<Record<string, unknown>> } {
  let text = (it.content ?? '').trim();
  let atts: Array<Record<string, unknown>> = Array.isArray(it.attachments)
    ? (it.attachments as Array<Record<string, unknown>>)
    : [];
  // Tin cũ: content = '{"text":"","attachments":[...]}' → parse khôi phục.
  if (text.startsWith('{') && (text.includes('"attachments"') || text.includes('"text"'))) {
    try {
      const o = JSON.parse(text) as { text?: string; attachments?: Array<Record<string, unknown>> };
      text = (o.text ?? '').trim();
      if (Array.isArray(o.attachments) && o.attachments.length) atts = o.attachments;
    } catch { /* giữ nguyên */ }
  }
  return { text, atts };
}
function attUrl(a: Record<string, unknown>): string {
  return String(a.url ?? a.href ?? a.link ?? a.thumb ?? '');
}
function isImage(a: Record<string, unknown>): boolean {
  const kind = String(a.kind ?? a.type ?? '').toLowerCase();
  if (kind.includes('image') || kind === 'photo' || kind === 'gif') return true;
  const u = attUrl(a).toLowerCase().split('?')[0];
  return /\.(png|jpe?g|gif|webp|heic|bmp)$/.test(u);
}
function normText(it: TimelineItem): string { return parsed(it).text; }
function normImages(it: TimelineItem): string[] {
  return parsed(it).atts.filter(isImage).map(attUrl).filter(Boolean);
}
function normFiles(it: TimelineItem): Array<{ url: string; name: string }> {
  return parsed(it).atts
    .filter((a) => !isImage(a))
    .map((a) => ({ url: attUrl(a), name: String(a.filename ?? a.name ?? a.title ?? '') }))
    .filter((f) => f.url);
}

function statusLabel(s?: string): string {
  return s === 'seen' ? 'Đã đọc' : s === 'delivered' ? 'Đã nhận' : 'Đã gửi';
}
const MARK: Record<string, string> = {
  reaction_pos: '❤️ Khách thả cảm xúc tích cực',
  reaction_neg: '😕 Khách thả cảm xúc tiêu cực',
  paused: '⏸️ Tạm dừng (khách trả lời / sale tạm dừng)',
  closed: '✅ Đóng luồng',
  notified: '🔔 Đã báo sale',
  opened: '▶️ Mở luồng',
  blocked: '🚫 Khách chặn',
  friend_accept: '🤝 Khách đồng ý kết bạn',
  friend_reject: '✋ Khách từ chối kết bạn',
};
function markLabel(it: TimelineItem): string {
  if ((it.kind === 'reaction_pos' || it.kind === 'reaction_neg') && it.emoji) {
    return `${it.emoji} Khách thả cảm xúc`;
  }
  return MARK[it.kind] ?? it.kind;
}
function markClass(kind: string): string {
  if (kind === 'closed' || kind === 'reaction_pos' || kind === 'friend_accept') return 'ok';
  if (kind === 'blocked' || kind === 'reaction_neg' || kind === 'friend_reject') return 'bad';
  return '';
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
</script>

<style scoped>
.fh-overlay {
  position: fixed; inset: 0; z-index: 2400; background: rgba(15, 30, 45, .42);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.fh-modal {
  width: 100%; max-width: 560px; max-height: 84vh; display: flex; flex-direction: column;
  background: var(--surface); border-radius: var(--r-lg, 14px); box-shadow: var(--sh-lg, 0 18px 50px rgba(0,0,0,.28));
  overflow: hidden;
}
.fh-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 16px; border-bottom: 1px solid var(--line);
}
.fh-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: var(--ink); }
.fh-title svg { color: var(--brand); }
.fh-x {
  width: 28px; height: 28px; border: 0; background: transparent; color: var(--ink-3);
  border-radius: var(--r-sm, 8px); cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.fh-x:hover { background: var(--surface-3); color: var(--ink); }
.fh-sub {
  padding: 8px 16px; font-size: 12px; color: var(--ink-3); border-bottom: 1px solid var(--line-2, var(--line));
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.fh-sub b { color: var(--ink-2); font-weight: 600; }
.fh-cnt {
  margin-left: auto; font-size: 11px; font-weight: 600; color: var(--brand-700);
  background: var(--brand-soft); border-radius: var(--r-pill, 999px); padding: 2px 9px;
}
.fh-body { padding: 14px 16px; overflow-y: auto; }
.fh-state { text-align: center; color: var(--ink-3); font-size: 13px; padding: 28px 0; }
.fh-state.err { color: var(--error, #c0392b); }

.fh-tl { display: flex; flex-direction: column; gap: 12px; }
.fh-row { display: flex; flex-direction: column; gap: 3px; }
.fh-row.sent { align-items: flex-end; }
.fh-row.recv { align-items: flex-start; }
.fh-bubble {
  max-width: 86%; border-radius: 12px; padding: 8px 11px; font-size: 13px; line-height: 1.45;
}
.fh-bubble.sent { background: var(--brand-soft); color: var(--ink); border-bottom-right-radius: 4px; }
.fh-bubble.recv { background: var(--surface-3); color: var(--ink); border-bottom-left-radius: 4px; }
.fh-brow { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; }
.fh-step { font-size: 10.5px; font-weight: 700; color: var(--brand-700); }
.fh-who { font-size: 10.5px; font-weight: 700; color: var(--ink-2); }
.fh-st { font-size: 10px; font-weight: 600; color: var(--ink-3); }
.fh-st.seen { color: #1786be; }
.fh-st.delivered { color: var(--ink-2); }
.fh-text { white-space: pre-wrap; word-break: break-word; }
.fh-imgs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.fh-imgs img {
  width: 92px; height: 92px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line);
  cursor: zoom-in; display: block;
}
.fh-file {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; max-width: 100%;
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px;
  font-size: 12px; color: var(--brand-700); text-decoration: none;
}
.fh-file:hover { background: var(--surface-3); }
.fh-file svg { flex-shrink: 0; color: var(--ink-3); }
.fh-fn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fh-time { font-size: 10px; color: var(--ink-4); padding: 0 3px; }

.fh-mark {
  display: flex; align-items: center; gap: 7px; align-self: center;
  font-size: 11.5px; color: var(--ink-3); background: var(--surface-2, var(--surface-3));
  border-radius: var(--r-pill, 999px); padding: 4px 12px;
}
.fh-mark.ok { color: #1b6b46; }
.fh-mark.bad { color: var(--error, #c0392b); }
.fh-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; opacity: .6; }
.fh-mtime { font-size: 10px; color: var(--ink-4); margin-left: 2px; }
</style>
