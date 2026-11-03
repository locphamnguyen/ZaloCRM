<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <!-- 2026-11-03 — AI Agent 24/7: tự trả lời khách trên nick Zalo cá nhân. -->
  <div class="ag-page">
    <header class="ag-header">
      <div>
        <h1 class="ag-title">🤖 AI Agent 24/7</h1>
        <p class="ag-sub">Tự trả lời khách nhắn vào nick Zalo cá nhân khi sale vắng mặt. Dùng nhà cung cấp AI & API key ở mục Trợ lý AI.</p>
      </div>
      <div v-if="loading" class="pill">⏳ Đang tải...</div>
    </header>

    <div class="warn">
      ⚠️ Zalo không cho phép tự động hoá tài khoản cá nhân — nick có thể bị hạn chế hoặc khoá. Nên dùng <b>nick phụ</b>,
      giữ giới hạn thấp, và cân nhắc Zalo OA cho lâu dài.
    </div>

    <div v-if="cfg" class="ag-body">
      <div class="card">
        <label class="toggle-row">
          <input type="checkbox" v-model="cfg.enabled" />
          <div>
            <div class="label">Bật AI Agent</div>
            <div class="hint">Đang {{ stats?.inWorkHours ? 'trong' : 'ngoài' }} giờ làm · 24h qua agent gửi {{ stats?.sent24h ?? 0 }} tin, chuyển nhân viên {{ stats?.handoff24h ?? 0 }} lần · đang chờ trả lời {{ stats?.pending ?? 0 }} hội thoại</div>
          </div>
        </label>
      </div>

      <div class="card">
        <div class="label">Nick Zalo dùng agent</div>
        <div v-if="nicks.length === 0" class="hint">Chưa có nick Zalo nào.</div>
        <label v-for="n in nicks" :key="n.id" class="check-row">
          <input type="checkbox" :value="n.id" v-model="cfg.zaloAccountIds" />
          <span>{{ n.displayName || n.phone || n.id }}</span>
          <span class="status" :class="n.status">{{ n.status === 'connected' ? 'đang kết nối' : n.status }}</span>
        </label>
      </div>

      <div class="card">
        <div class="label">Khi nào agent trả lời</div>
        <label class="check-row"><input type="radio" value="off_hours" v-model="cfg.mode" /> Ngoài giờ làm, và trong giờ khi sale chưa trả lời sau
          <input class="num" type="number" min="0" max="240" v-model.number="cfg.staffGraceMinutes" /> phút (khuyến nghị)</label>
        <label class="check-row"><input type="radio" value="always" v-model="cfg.mode" /> Mọi lúc (rủi ro khoá nick cao hơn)</label>
        <div class="grid">
          <label>Giờ làm từ <input type="time" v-model="cfg.workStart" /></label>
          <label>đến <input type="time" v-model="cfg.workEnd" /></label>
          <label>Múi giờ <input type="text" v-model="cfg.timezone" /></label>
          <label>Sale vừa nhắn thì agent nhường trong <input class="num" type="number" min="0" v-model.number="cfg.staffTakeoverMinutes" /> phút</label>
        </div>
      </div>

      <div class="card">
        <div class="label">Giới hạn an toàn</div>
        <div class="grid">
          <label>Trễ ngẫu nhiên từ <input class="num" type="number" min="1" v-model.number="cfg.minDelaySec" /> đến <input class="num" type="number" min="1" v-model.number="cfg.maxDelaySec" /> giây</label>
          <label>Tối đa <input class="num" type="number" min="1" v-model.number="cfg.maxPerNickHour" /> tin/giờ mỗi nick</label>
          <label>Tối đa <input class="num" type="number" min="1" v-model.number="cfg.maxPerNickDay" /> tin/24h mỗi nick</label>
          <label>Tối đa <input class="num" type="number" min="1" v-model.number="cfg.maxPerConversationDay" /> tin/24h mỗi khách</label>
        </div>
      </div>

      <div class="card">
        <div class="label">Chuyển cho nhân viên</div>
        <label class="field">Từ khoá (ngăn bởi dấu |)
          <input type="text" v-model="cfg.handoffKeywords" /></label>
        <label class="field">Câu gửi khách khi chuyển
          <textarea rows="2" v-model="cfg.handoffMessage" /></label>
        <label class="field">Sau khi chuyển, agent im lặng
          <input class="num" type="number" min="1" v-model.number="cfg.handoffPauseHours" /> giờ với khách đó</label>
      </div>

      <div class="card">
        <div class="label">Kiến thức cho agent <span class="meta">(sản phẩm, giá, link Shopee/TikTok Shop, chính sách)</span></div>
        <textarea class="kb" rows="18" v-model="cfg.knowledgeBase" spellcheck="false" />
        <div class="hint">Agent chỉ trả lời dựa trên nội dung này. Thiếu thông tin thì agent sẽ hẹn kiểm tra lại, không tự bịa.</div>
      </div>

      <div class="actions">
        <button class="btn-ghost" :disabled="saving" @click="resetKb">↺ Kiến thức mẫu</button>
        <button class="btn-primary" :disabled="saving" @click="save">{{ saving ? '⏳ Đang lưu...' : '💾 Lưu cài đặt' }}</button>
      </div>
      <div v-if="msg" class="msg" :class="ok ? 'ok' : 'err'">{{ msg }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';

interface AgentConfig {
  enabled: boolean;
  mode: 'off_hours' | 'always';
  zaloAccountIds: string[];
  workStart: string;
  workEnd: string;
  timezone: string;
  staffGraceMinutes: number;
  staffTakeoverMinutes: number;
  minDelaySec: number;
  maxDelaySec: number;
  maxPerNickHour: number;
  maxPerNickDay: number;
  maxPerConversationDay: number;
  knowledgeBase: string | null;
  handoffKeywords: string;
  handoffMessage: string;
  handoffPauseHours: number;
}
interface Nick { id: string; displayName: string | null; phone: string | null; status: string }
interface Stats { sent24h: number; handoff24h: number; pending: number; inWorkHours: boolean }

const loading = ref(true);
const saving = ref(false);
const cfg = ref<AgentConfig | null>(null);
const nicks = ref<Nick[]>([]);
const stats = ref<Stats | null>(null);
const defaultKnowledge = ref('');
const msg = ref('');
const ok = ref(false);

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/ai-agent/config');
    cfg.value = data.config;
    nicks.value = data.nicks;
    stats.value = data.stats;
    defaultKnowledge.value = data.defaultKnowledge;
  } catch (e: any) {
    msg.value = e?.response?.data?.error || e?.message || 'Lỗi tải cài đặt';
    ok.value = false;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!cfg.value || saving.value) return;
  if (cfg.value.enabled && cfg.value.zaloAccountIds.length === 0) {
    msg.value = 'Chọn ít nhất 1 nick Zalo trước khi bật agent';
    ok.value = false;
    return;
  }
  saving.value = true;
  msg.value = '';
  try {
    const { id, orgId, createdAt, updatedAt, ...body } = cfg.value as any;
    await api.put('/ai-agent/config', body);
    msg.value = '✓ Đã lưu cài đặt';
    ok.value = true;
    await load();
  } catch (e: any) {
    msg.value = e?.response?.data?.error || e?.message || 'Lỗi lưu cài đặt';
    ok.value = false;
  } finally {
    saving.value = false;
  }
}

function resetKb() {
  if (!cfg.value) return;
  if (!confirm('Thay nội dung kiến thức bằng mẫu? Nội dung hiện tại sẽ bị thay thế.')) return;
  cfg.value.knowledgeBase = defaultKnowledge.value;
}

onMounted(load);
</script>

<style scoped>
.ag-page { max-width: 960px; padding: 20px; }
.ag-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
.ag-title { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
.ag-sub { margin: 0; color: #64748b; font-size: 13px; }
.pill { padding: 4px 10px; background: #f1f5f9; border-radius: 8px; font-size: 12px; color: #64748b; }
.warn { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 8px; padding: 10px 14px; font-size: 12px; margin-bottom: 16px; }
.ag-body { display: flex; flex-direction: column; gap: 16px; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.label { font-weight: 600; font-size: 13px; color: #1f2937; }
.meta { color: #64748b; font-weight: 400; font-size: 11px; }
.hint { font-size: 11px; color: #64748b; }
.toggle-row, .check-row { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; flex-wrap: wrap; }
.toggle-row { align-items: flex-start; }
.status { font-size: 11px; color: #64748b; }
.status.connected { color: #15803d; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #374151; }
input[type='text'], input[type='time'], input[type='number'], textarea { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; font-size: 13px; }
.num { width: 70px; }
.kb { width: 100%; font-family: 'JetBrains Mono', Consolas, monospace; font-size: 12px; line-height: 1.6; background: #fafbfc; resize: vertical; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
.btn-ghost { background: transparent; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 14px; cursor: pointer; }
.msg { font-size: 12px; }
.msg.ok { color: #15803d; }
.msg.err { color: #b91c1c; }
</style>
