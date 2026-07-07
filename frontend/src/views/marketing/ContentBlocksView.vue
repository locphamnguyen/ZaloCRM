<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension -->
<!--
  ContentBlocksView — Khối nội dung (Community).
  Kho nội dung tái dùng (text + biến động + ảnh) cho Broadcast tự động — chọn nhiều
  khối cho 1 broadcast để xoay vòng (spin content) chống spam.
  Backend: /api/v1/content-blocks (CRUD, mở cho mọi user đăng nhập trong org).
-->
<template>
  <div class="cb-view">
    <div class="mkt-top">
      <div>
        <div class="mtt">Khối nội dung</div>
        <div class="mts">
          Soạn sẵn các mẫu tin (text + ảnh) để <b>Broadcast tự động</b> chọn nhiều khối
          cùng lúc và <b>xoay vòng</b> gửi cho khách — tránh gửi 1 mẫu giống hệt nhau gây spam.
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <v-icon size="16">mdi-plus-circle-outline</v-icon> Tạo khối nội dung
        </button>
      </div>
    </div>

    <div class="cb-body">
      <div v-if="loading" class="cb-empty">Đang tải…</div>
      <div v-else-if="blocks.length === 0" class="cb-empty">
        <v-icon size="40">mdi-view-grid-plus-outline</v-icon>
        <p>Chưa có khối nội dung nào. Bấm <b>Tạo khối nội dung</b> để bắt đầu.</p>
      </div>

      <div class="cb-grid">
        <div v-for="b in blocks" :key="b.id" class="cb-card">
          <img v-if="b.imageUrl" :src="b.imageUrl" class="cb-thumb" />
          <div class="cb-card-body">
            <div class="cb-name">{{ b.name }}</div>
            <div class="cb-text">{{ b.messageText }}</div>
            <div class="cb-meta">Dùng {{ b.usageCount }} lần</div>
          </div>
          <div class="cb-card-actions">
            <button class="btn btn-ghost btn-sm" title="Sửa" @click="openEdit(b)">
              <v-icon size="16">mdi-pencil-outline</v-icon>
            </button>
            <button class="btn btn-ghost btn-sm danger" title="Xoá" @click="removeBlock(b)">
              <v-icon size="16">mdi-trash-can-outline</v-icon>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ Modal tạo/sửa khối nội dung ============ -->
    <div v-if="showForm" class="cb-overlay" @click.self="showForm = false">
      <div class="cb-modal">
        <div class="cb-modal-head">
          <b>{{ editing ? 'Sửa khối nội dung' : 'Tạo khối nội dung' }}</b>
          <button class="btn-x" @click="showForm = false"><v-icon size="18">mdi-close</v-icon></button>
        </div>

        <label class="f-label">Tên khối</label>
        <input v-model="form.name" class="f-input" placeholder="VD: Ưu đãi tháng 7 - mẫu 1" />

        <label class="f-label">Nội dung tin <span class="f-hint">— biến: <code v-pre>{{ten}}</code> tên khách, <code v-pre>{{sdt}}</code> SĐT</span></label>
        <textarea v-model="form.messageText" class="f-input" rows="4"
          placeholder="Chào {{ten}}, bên em đang có chương trình ưu đãi…"></textarea>

        <label class="f-label">Ảnh kèm (tuỳ chọn)</label>
        <div class="f-image-row">
          <img v-if="form.imageUrl" :src="form.imageUrl" class="f-image-preview" />
          <div class="f-image-actions">
            <button type="button" class="btn btn-ghost btn-sm" @click="openMediaPicker">
              <v-icon size="16">mdi-image-multiple-outline</v-icon> Chọn từ Kho media
            </button>
            <button v-if="form.imageUrl" type="button" class="btn btn-ghost btn-sm danger" @click="form.imageUrl = ''">
              <v-icon size="16">mdi-close</v-icon> Bỏ ảnh
            </button>
          </div>
        </div>

        <div class="cb-modal-foot">
          <button class="btn btn-ghost btn-sm" @click="showForm = false">Huỷ</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            {{ saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo khối' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ============ Modal chọn ảnh từ Kho media ============ -->
    <div v-if="mediaPicker.open" class="cb-overlay" @click.self="mediaPicker.open = false">
      <div class="cb-modal cb-modal-wide">
        <div class="cb-modal-head">
          <b>Chọn ảnh từ Kho media</b>
          <button class="btn-x" @click="mediaPicker.open = false"><v-icon size="18">mdi-close</v-icon></button>
        </div>
        <div v-if="mediaPicker.loading" class="cb-empty">Đang tải…</div>
        <div v-else-if="mediaPicker.items.length === 0" class="cb-empty">Kho media chưa có ảnh nào.</div>
        <div v-else class="f-media-grid">
          <button v-for="m in mediaPicker.items" :key="m.id" type="button" class="f-media-item" @click="selectMedia(m)">
            <img :src="m.thumbnailUrl || m.url || ''" :alt="m.name" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '@/api/index';
import { listMedia, type MediaAssetItem } from '@/api/media';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

const { push: toast } = useToast();
const { confirm } = useConfirm();

interface BlockRow {
  id: string; name: string; messageText: string; imageUrl: string | null; usageCount: number;
}

const blocks = ref<BlockRow[]>([]);
const loading = ref(true);
const showForm = ref(false);
const saving = ref(false);
const editing = ref<BlockRow | null>(null);

const form = reactive({ name: '', messageText: '', imageUrl: '' });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get('/content-blocks');
    blocks.value = res.data.blocks;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { name: '', messageText: '', imageUrl: '' });
  showForm.value = true;
}

function openEdit(b: BlockRow): void {
  editing.value = b;
  Object.assign(form, { name: b.name, messageText: b.messageText, imageUrl: b.imageUrl ?? '' });
  showForm.value = true;
}

async function save(): Promise<void> {
  if (!form.name.trim()) return void toast('Nhập tên khối', 'error');
  if (!form.messageText.trim()) return void toast('Nhập nội dung tin', 'error');

  saving.value = true;
  try {
    const payload = { name: form.name, messageText: form.messageText, imageUrl: form.imageUrl || null };
    if (editing.value) {
      await api.patch(`/content-blocks/${editing.value.id}`, payload);
    } else {
      await api.post('/content-blocks', payload);
    }
    toast(editing.value ? 'Đã lưu thay đổi' : 'Đã tạo khối nội dung', 'success');
    showForm.value = false;
    await load();
  } catch (err: any) {
    toast(`Lỗi: ${err?.response?.data?.error ?? 'không lưu được'}`, 'error');
  } finally {
    saving.value = false;
  }
}

async function removeBlock(b: BlockRow): Promise<void> {
  if (!(await confirm({
    title: 'Xoá khối nội dung?',
    message: `Xoá "${b.name}". Broadcast đang dùng khối này sẽ tự bỏ qua nó khi xoay vòng. Không thể hoàn tác.`,
    confirmText: 'Xoá', tone: 'danger',
  }))) return;
  await api.delete(`/content-blocks/${b.id}`);
  toast('Đã xoá', 'success');
  await load();
}

const mediaPicker = reactive({ open: false, loading: false, items: [] as MediaAssetItem[] });

async function openMediaPicker(): Promise<void> {
  mediaPicker.open = true;
  mediaPicker.loading = true;
  try {
    mediaPicker.items = await listMedia({ kind: 'image', limit: 60, sort: 'recent' });
  } finally {
    mediaPicker.loading = false;
  }
}

function selectMedia(m: MediaAssetItem): void {
  form.imageUrl = m.url ?? '';
  mediaPicker.open = false;
}

onMounted(load);
</script>

<style scoped>
.cb-view { display: flex; flex-direction: column; height: 100%; overflow: auto; }
.mkt-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 16px 20px 12px; border-bottom: 1px solid var(--border, #e5e4e7); }
.mtt { font-size: 18px; font-weight: 700; }
.mts { font-size: 13px; color: var(--text-secondary, #666); margin-top: 2px; max-width: 720px; }
.actions { display: flex; gap: 8px; flex-shrink: 0; }
.cb-body { padding: 16px 20px; }
.cb-empty { text-align: center; color: var(--text-secondary, #888); padding: 32px 0; }
.cb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.cb-card { border: 1px solid var(--border, #e5e4e7); border-radius: 10px; overflow: hidden; background: var(--surface, #fff); display: flex; flex-direction: column; }
.cb-thumb { width: 100%; height: 120px; object-fit: cover; }
.cb-card-body { padding: 10px 12px; flex: 1; }
.cb-name { font-weight: 700; font-size: 14px; }
.cb-text { font-size: 12.5px; color: var(--text-secondary, #666); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cb-meta { font-size: 11.5px; color: var(--text-secondary, #999); margin-top: 6px; }
.cb-card-actions { display: flex; justify-content: flex-end; gap: 4px; padding: 6px 10px; border-top: 1px solid var(--border, #eee); }
.danger { color: #a12318; }

.cb-overlay { position: fixed; inset: 0; background: rgba(20, 20, 30, 0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.cb-modal { background: var(--surface, #fff); border-radius: 12px; padding: 18px 20px; width: 560px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); overflow: auto; }
.cb-modal-wide { width: 760px; }
.cb-modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 15px; }
.btn-x { background: none; border: none; cursor: pointer; padding: 2px; }
.cb-modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.f-label { display: block; font-size: 12.5px; font-weight: 600; margin: 10px 0 4px; }
.f-hint { font-weight: 400; color: var(--text-secondary, #888); }
.f-input { width: 100%; border: 1px solid var(--border, #d5d4d8); border-radius: 8px; padding: 7px 10px; font-size: 13.5px; background: var(--surface, #fff); color: inherit; }
.f-image-row { display: flex; align-items: center; gap: 10px; }
.f-image-preview { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border, #d5d4d8); flex-shrink: 0; }
.f-image-actions { display: flex; gap: 6px; }
.f-media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; max-height: 60vh; overflow: auto; }
.f-media-item { border: 1px solid var(--border, #d5d4d8); border-radius: 8px; padding: 0; cursor: pointer; overflow: hidden; aspect-ratio: 1; background: none; }
.f-media-item:hover { border-color: #0e445a; }
.f-media-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
