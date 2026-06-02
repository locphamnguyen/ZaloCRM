<template>
  <div class="fi-create airtable-scope at-container">
    <header class="at-page-header">
      <div>
        <button class="at-btn at-btn--ghost at-btn--sm" @click="router.back()">← Quay lại</button>
        <h1 class="at-page-title" style="margin-top: 12px;">
          <span class="hero-icon">👋</span>
          Tạo Mục tiêu: Tự động kết bạn từ tệp + bám đuổi
        </h1>
        <p class="at-page-subtitle">
          Cấu hình 1 lần — hệ thống tự gửi lời mời từ N nick, kèm bám đuổi vào tin nhắn lạ kể cả khi KH chưa accept.
        </p>
      </div>
    </header>

    <div class="form-grid">
      <!-- ① Tên Mục tiêu -->
      <section class="section">
        <div class="section-title">① Tên Mục tiêu <span class="required">*</span></div>
        <input v-model="form.name" class="at-input" placeholder="VD: Auto kết bạn 1000 số cho 10 nick 29.05.2026" />
      </section>

      <!-- ② Tệp khách hàng -->
      <section class="section">
        <div class="section-title">② Tệp khách hàng <span class="required">*</span></div>
        <select v-model="form.listId" class="at-input">
          <option :value="''" disabled>— Chọn tệp khách hàng —</option>
          <option v-for="l in lists" :key="l.id" :value="l.id">
            {{ l.name }} ({{ l.totalEntries }} SĐT)
          </option>
        </select>
      </section>

      <!-- ③ Nick gửi lời mời -->
      <section class="section">
        <div class="section-title">
          ③ Nick gửi lời mời <span class="required">*</span>
          <span class="count-chip">{{ form.nickIds.length }} đã chọn</span>
        </div>
        <div class="nick-list">
          <label
            v-for="n in nicks"
            :key="n.id"
            class="nick-item"
            :class="{ 'is-selected': form.nickIds.includes(n.id) }"
          >
            <input type="checkbox" :value="n.id" v-model="form.nickIds" />
            <div class="nick-avatar">{{ initials(n.displayName) }}</div>
            <div class="nick-info">
              <div class="nick-name">{{ n.displayName || n.id }}</div>
              <div class="nick-meta">
                <span class="dot" :class="`dot--${n.status === 'connected' ? 'green' : 'red'}`"></span>
                {{ n.status === 'connected' ? 'Online' : n.status }}
                · cap {{ n.dailyFriendAddCap }} lời mời/ngày
              </div>
            </div>
          </label>
        </div>
      </section>

      <!-- ④ Lời chào kết bạn -->
      <section class="section">
        <div class="section-title">④ Lời chào kết bạn <span class="required">*</span></div>
        <textarea
          v-model="form.greetingTemplate"
          class="at-textarea"
          rows="4"
          maxlength="200"
          placeholder="VD: Chào {gender} {name}, em là {sale} bên dự án..."
        ></textarea>
        <div class="hint">
          {{ form.greetingTemplate.length }} / 200 ký tự · Click chèn biến:
          <button class="var-pill" @click="insertVar('{gender}')">{gender}</button>
          <button class="var-pill" @click="insertVar('{name}')">{name}</button>
          <button class="var-pill" @click="insertVar('{sale}')">{sale}</button>
        </div>
        <div v-if="greetingPreview" class="preview">
          <div class="preview-label">Preview (KH ♀ + sale "Thành"):</div>
          {{ greetingPreview }}
        </div>
      </section>

      <!-- ⑤ Tin chào mừng (welcome probe) -->
      <section class="section">
        <div class="section-title">💌 Tin chào mừng (sau khi gửi lời mời)</div>
        <p class="form-section__hint">
          Gửi NGAY sau khi gửi lời mời kết bạn (không đợi đồng ý). Mục đích: kiểm tra KH có cho phép nhận tin lạ không.
          Chỉ KH gửi thành công mới gắn vào luồng bám đuổi (tiết kiệm queue, tránh spam).
        </p>
        <textarea
          v-model="form.welcomeMessageTemplate"
          class="at-textarea"
          rows="3"
          maxlength="4000"
          placeholder="Em chào {gender} {name}, em là {sale}, em vừa kết bạn để tiện hỗ trợ Anh/Chị ạ."
        ></textarea>
        <div class="hint">
          {{ form.welcomeMessageTemplate.length }} / 4000 ký tự · Biến:
          <code class="var-pill">{gender}</code> Anh/Chị
          <code class="var-pill">{name}</code> tên KH
          <code class="var-pill">{sale}</code> tên sale
        </div>

        <div style="margin-top: 12px; display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333840;">
          <span>⏱ Chờ sau khi gửi lời mời</span>
          <input
            v-model.number="form.welcomeDelaySeconds"
            type="number"
            class="at-input num"
            min="0"
            max="3600"
          />
          <span>giây</span>
          <span class="hint" style="margin: 0;">(60 phút an toàn anti-spam · 0 = gửi ngay)</span>
        </div>

        <div v-if="!form.welcomeMessageTemplate" class="welcome-info">
          💡 Bỏ trống = SKIP tin chào mừng (KH friend-request OK → vào bám đuổi ngay). Mặc định nên có để gate stranger inbox.
        </div>
      </section>

      <!-- ⑥ Luồng bám đuổi -->
      <section class="section">
        <div class="section-title">⑥ Luồng bám đuổi <span class="required">*</span></div>
        <select v-model="form.successorSequenceId" class="at-input">
          <option :value="''" disabled>— Chọn Luồng kịch bản —</option>
          <option v-for="s in sequences" :key="s.id" :value="s.id">
            {{ s.name }} ({{ (s.steps as any[])?.length ?? 0 }} bước)
          </option>
        </select>
      </section>

      <!-- ⑦ Quy tắc bỏ qua KH -->
      <section class="section">
        <div class="section-title">⑦ Quy tắc bỏ qua KH</div>
        <div class="rule">
          <span class="rule-icon">⏰</span>
          KH đã có chat với nick khác trong
          <input v-model.number="form.skipRules.recencyDays" type="number" class="at-input num" min="0" />
          ngày gần đây
        </div>
        <div class="rule">
          <span class="rule-icon">👥</span>
          KH đã friend với hơn
          <input v-model.number="form.skipRules.friendCap" type="number" class="at-input num" min="0" />
          nick của tổ chức
        </div>
      </section>

      <!-- Action bar -->
      <div class="action-bar">
        <button class="at-btn at-btn--ghost" @click="router.back()">Huỷ</button>
        <div class="action-spacer"></div>
        <button
          class="at-btn at-btn--primary"
          :disabled="!canSubmit || submitting"
          @click="submit"
        >
          {{ submitting ? 'Đang tạo...' : '▶ Tạo và chạy ngay' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import '@/components/automation/phase7/airtable.css';

const router = useRouter();

interface ListSummary { id: string; name: string; totalEntries: number; }
interface NickSummary { id: string; displayName: string | null; status: string; dailyFriendAddCap: number; }
interface SequenceSummary { id: string; name: string; steps: unknown; }

const lists = ref<ListSummary[]>([]);
const nicks = ref<NickSummary[]>([]);
const sequences = ref<SequenceSummary[]>([]);
const submitting = ref(false);

const form = ref({
  name: '',
  listId: '',
  nickIds: [] as string[],
  successorSequenceId: '',
  greetingTemplate: 'Chào {gender} {name}, em là {sale} bên dự án The Emerald Garden View. Em xin phép gửi {gender} báo giá mới nhất tháng này. Cảm ơn {gender} nhiều!',
  welcomeMessageTemplate: '',
  welcomeDelaySeconds: 60,
  skipRules: {
    recencyDays: 7,
    friendCap: 2,
    entryStatuses: [] as string[],
  },
});

const canSubmit = computed(() => {
  return form.value.name.trim().length > 0
    && form.value.listId
    && form.value.nickIds.length > 0
    && form.value.successorSequenceId
    && form.value.greetingTemplate.includes('{name}');
});

const greetingPreview = computed(() => {
  return form.value.greetingTemplate
    .replaceAll('{gender}', 'Chị')
    .replaceAll('{name}', 'Linh')
    .replaceAll('{sale}', 'Thành');
});

function insertVar(v: string) {
  form.value.greetingTemplate += v;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

async function loadData() {
  try {
    const [lr, nr, sr] = await Promise.all([
      api.get('/customer-lists?status=active&limit=100'),
      api.get('/zalo-accounts'),
      api.get('/automation/sequences'),
    ]);
    lists.value = (lr.data.lists ?? []) as ListSummary[];
    nicks.value = (nr.data.accounts ?? nr.data ?? []) as NickSummary[];
    sequences.value = (sr.data.sequences ?? sr.data ?? []) as SequenceSummary[];
  } catch (err) {
    console.error('[fi-create] loadData failed', err);
  }
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const createResp = await api.post('/automation/triggers/friend-invite', {
      name: form.value.name.trim(),
      listId: form.value.listId,
      nickIds: form.value.nickIds,
      successorSequenceId: form.value.successorSequenceId,
      greetingTemplate: form.value.greetingTemplate.trim(),
      welcomeMessageTemplate: form.value.welcomeMessageTemplate.trim() || null,
      welcomeDelaySeconds: form.value.welcomeDelaySeconds,
      skipRules: form.value.skipRules,
    });
    const triggerId = createResp.data.trigger?.id;
    if (!triggerId) throw new Error('trigger id missing');

    // Activate ngay
    const activateResp = await api.post(`/automation/triggers/${triggerId}/activate`);
    console.log('[fi-create] activated:', activateResp.data);

    router.push(`/marketing/triggers/${triggerId}`);
  } catch (err: any) {
    alert('Tạo Mục tiêu thất bại: ' + (err?.response?.data?.error ?? err?.message ?? 'unknown'));
  } finally {
    submitting.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.fi-create { padding: 24px 28px 80px; }
.hero-icon { font-size: 28px; margin-right: 8px; }
.form-grid { max-width: 720px; }
.section {
  background: #fff;
  border: 1px solid var(--at-hairline, #ddd);
  border-radius: 10px;
  padding: 18px 20px;
  margin-bottom: 12px;
}
.section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  color: #41454d; letter-spacing: 0.5px;
  margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
}
.required { color: #aa2d00; }
.count-chip {
  font-size: 10px; padding: 2px 8px; border-radius: 99px;
  background: #f0f1f3; color: #41454d; font-weight: 500;
}
.at-input {
  width: 100%; padding: 8px 12px; height: 36px;
  border: 1px solid #ddd; border-radius: 6px;
  font-size: 13px; font-family: inherit;
}
.at-input.num { width: 80px; display: inline-block; }
.at-textarea {
  width: 100%; padding: 10px 12px;
  border: 1px solid #ddd; border-radius: 6px;
  font-size: 13px; font-family: inherit;
  resize: vertical; min-height: 80px;
}
.hint { font-size: 11px; color: #6b7280; margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.var-pill {
  background: #f0f1f3; border: 0; padding: 2px 10px; border-radius: 99px;
  font-size: 11px; font-family: 'SF Mono', Menlo, monospace; cursor: pointer;
}
.preview {
  margin-top: 10px; padding: 10px 12px;
  background: #f8fafc; border-left: 3px solid #aa2d00;
  border-radius: 0 6px 6px 0;
  font-size: 13px; font-style: italic; line-height: 1.5;
}
.preview-label { font-style: normal; font-size: 10px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
.nick-list {
  max-height: 280px; overflow-y: auto;
  border: 1px solid #ddd; border-radius: 6px;
}
.nick-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f1f3;
  cursor: pointer;
}
.nick-item.is-selected { background: rgba(0, 100, 0, 0.04); }
.nick-item input[type="checkbox"] { width: 16px; height: 16px; }
.nick-avatar {
  width: 28px; height: 28px; border-radius: 99px;
  background: linear-gradient(135deg, #fcab79, #aa2d00);
  color: #fff; font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.nick-info { flex: 1; }
.nick-name { font-size: 13px; font-weight: 500; color: #181d26; }
.nick-meta { font-size: 11px; color: #6b7280; margin-top: 1px; }
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 99px; margin-right: 3px; }
.dot--green { background: #006400; }
.dot--red { background: #aa2d00; }
.rule {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; font-size: 13px; color: #333840;
}
.rule-icon {
  width: 22px; height: 22px; background: rgba(217, 164, 65, 0.15);
  color: #b07a14; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
}
.action-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 0; margin-top: 12px;
}
.action-spacer { flex: 1; }
.at-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px; border-radius: 6px;
  font-size: 13px; font-weight: 500;
  border: 0; cursor: pointer; font-family: inherit;
}
.at-btn--primary { background: #181d26; color: #fff; }
.at-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.at-btn--ghost { background: transparent; color: #181d26; }
.at-btn--ghost:hover { background: #f0f1f3; }
.at-btn--sm { padding: 6px 12px; font-size: 12px; }
.form-section__hint {
  font-size: 12px; color: #6b7280; line-height: 1.5;
  margin: -4px 0 10px; padding: 8px 10px;
  background: #f8fafc; border-left: 3px solid #d9a441;
  border-radius: 0 4px 4px 0;
}
.welcome-info {
  margin-top: 10px; padding: 8px 12px;
  background: rgba(217, 164, 65, 0.1);
  border: 1px solid rgba(217, 164, 65, 0.3);
  border-radius: 6px;
  font-size: 12px; color: #b07a14; line-height: 1.5;
}
</style>
