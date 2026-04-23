<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center text-subtitle-2 pa-3">
      <v-icon size="18" class="mr-2">mdi-link-variant</v-icon>
      Link mời nhóm
    </v-card-title>

    <v-divider />

    <v-card-text class="pa-3">
      <!-- Loading state -->
      <div v-if="fetching" class="d-flex justify-center py-4">
        <v-progress-circular indeterminate color="primary" size="28" />
      </div>

      <!-- Link display -->
      <template v-else>
        <div v-if="linkUrl" class="mb-3">
          <div class="text-caption text-grey mb-1">Link hiện tại</div>
          <div class="d-flex align-center gap-2">
            <v-text-field
              :model-value="linkUrl"
              readonly
              variant="outlined"
              density="compact"
              hide-details
              class="flex-1-1"
            />
            <v-btn
              icon="mdi-content-copy"
              variant="tonal"
              size="small"
              @click="copyLink"
            />
          </div>
          <v-fade-transition>
            <div v-if="copied" class="text-caption text-success mt-1">
              Đã sao chép!
            </div>
          </v-fade-transition>
        </div>

        <div v-else class="text-caption text-grey mb-3">
          Link mời chưa được bật
        </div>

        <!-- Actions -->
        <div class="d-flex gap-2 flex-wrap">
          <v-btn
            size="small"
            color="primary"
            variant="tonal"
            prepend-icon="mdi-refresh"
            :loading="loading"
            @click="refresh"
          >
            Làm mới
          </v-btn>
          <v-btn
            size="small"
            color="success"
            variant="tonal"
            prepend-icon="mdi-link-variant-plus"
            :loading="loading"
            @click="enable"
          >
            Bật link
          </v-btn>
          <v-btn
            size="small"
            color="error"
            variant="tonal"
            prepend-icon="mdi-link-variant-off"
            :loading="loading"
            :disabled="!linkUrl"
            @click="disable"
          >
            Tắt link
          </v-btn>
        </div>
      </template>
    </v-card-text>

    <v-divider />

    <!-- Join by link section -->
    <v-card-text class="pa-3">
      <div class="text-caption text-grey mb-2">Tham gia bằng link</div>
      <div class="d-flex gap-2">
        <v-text-field
          v-model="joinLinkId"
          label="Link ID hoặc URL"
          variant="outlined"
          density="compact"
          hide-details
          placeholder="Dán link hoặc ID vào đây"
          class="flex-1-1"
          @keyup.enter="joinByLink"
        />
        <v-btn
          color="primary"
          variant="elevated"
          size="small"
          :loading="loading"
          :disabled="!joinLinkId.trim()"
          @click="joinByLink"
        >
          Tham gia
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  accountId: string;
  groupId: string;
  getInviteLink: (accountId: string, groupId: string) => Promise<any>;
  enableInviteLink: (accountId: string, groupId: string) => Promise<any>;
  disableInviteLink: (accountId: string, groupId: string) => Promise<any>;
  joinByLinkFn: (accountId: string, linkId: string) => Promise<any>;
}>();

const emit = defineEmits<{
  success: [message: string];
  error: [message: string];
}>();

const fetching = ref(false);
const loading = ref(false);
const linkUrl = ref('');
const copied = ref(false);
const joinLinkId = ref('');

async function refresh() {
  if (!props.accountId || !props.groupId) return;
  fetching.value = true;
  try {
    const detail = await props.getInviteLink(props.accountId, props.groupId);
    // zca-js returns { link, linkId } or similar shape
    linkUrl.value = detail?.link ?? detail?.url ?? '';
  } catch (err) {
    console.error('Failed to get invite link:', err);
    linkUrl.value = '';
  } finally {
    fetching.value = false;
  }
}

async function enable() {
  loading.value = true;
  try {
    const result = await props.enableInviteLink(props.accountId, props.groupId);
    linkUrl.value = result?.link ?? result?.url ?? linkUrl.value;
    emit('success', 'Đã bật link mời');
    await refresh();
  } catch (err) {
    emit('error', 'Bật link thất bại');
  } finally {
    loading.value = false;
  }
}

async function disable() {
  loading.value = true;
  try {
    await props.disableInviteLink(props.accountId, props.groupId);
    linkUrl.value = '';
    emit('success', 'Đã tắt link mời');
  } catch (err) {
    emit('error', 'Tắt link thất bại');
  } finally {
    loading.value = false;
  }
}

async function copyLink() {
  if (!linkUrl.value) return;
  try {
    await navigator.clipboard.writeText(linkUrl.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // Fallback for browsers without clipboard API
    const el = document.createElement('textarea');
    el.value = linkUrl.value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }
}

async function joinByLink() {
  const id = joinLinkId.value.trim();
  if (!id) return;
  // Extract linkId from URL if a full URL was pasted
  const extracted = id.includes('/') ? id.split('/').pop() ?? id : id;
  loading.value = true;
  try {
    await props.joinByLinkFn(props.accountId, extracted);
    joinLinkId.value = '';
    emit('success', 'Đã tham gia nhóm');
  } catch (err) {
    emit('error', 'Tham gia thất bại');
  } finally {
    loading.value = false;
  }
}

// Auto-fetch when groupId changes
watch(() => [props.accountId, props.groupId], ([acct, grp]) => {
  if (acct && grp) refresh();
}, { immediate: true });
</script>
