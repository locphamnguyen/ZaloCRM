<template>
  <div class="fb-channel-view">
    <!-- Page header -->
    <div class="page-head">
      <div>
        <h2 class="page-title">
          <v-icon color="#1877F2" class="mr-1" aria-hidden="true">mdi-facebook</v-icon>
          Kênh Facebook
        </h2>
        <p class="page-desc">Kết nối Facebook Page để nhận lead tự động vào Tệp khách hàng.</p>
      </div>
      <v-btn
        color="primary"
        prepend-icon="mdi-facebook"
        :loading="loading"
        @click="onConnectPage"
      >
        Kết nối Facebook Page
      </v-btn>
    </div>

    <!-- OAuth callback status banner -->
    <v-alert
      v-if="oauthStatus"
      :type="oauthStatus === 'success' ? 'success' : 'error'"
      variant="tonal"
      density="compact"
      closable
      class="mb-4"
      @click:close="clearOauthStatus"
    >
      <template v-if="oauthStatus === 'success'">
        Kết nối thành công {{ oauthPages }} trang Facebook! Hệ thống đang đồng bộ form tự động...
      </template>
      <template v-else>
        Kết nối thất bại: {{ oauthReason }}
      </template>
    </v-alert>

    <!-- General error -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="error = ''"
    >
      {{ error }}
    </v-alert>

    <!-- Loading skeleton -->
    <div v-if="loading && pages.length === 0" class="d-flex flex-column gap-3">
      <v-skeleton-loader v-for="n in 2" :key="n" type="card" />
    </div>

    <!-- Empty state -->
    <v-card
      v-else-if="!loading && pages.length === 0"
      variant="outlined"
      class="text-center pa-8"
    >
      <v-icon size="56" color="blue" aria-hidden="true">mdi-facebook</v-icon>
      <h3 class="mt-3 mb-2">Chưa kết nối Page nào</h3>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Click "Kết nối Facebook Page" để bắt đầu nhận lead từ Facebook.
      </p>
      <v-btn color="primary" prepend-icon="mdi-facebook" @click="onConnectPage">
        Kết nối Facebook Page
      </v-btn>
    </v-card>

    <!-- Page rows -->
    <template v-else>
      <FacebookPageRow
        v-for="page in pages"
        :key="page.id"
        :page="page"
        :mappings="mappingsByPageConnection[page.id] ?? []"
        :rediscovering="!!rediscoveringPages[page.pageId]"
        @disconnect="onDisconnectIntent"
        @rediscover="onRediscover"
      />
    </template>

    <!-- Disconnect confirm dialog -->
    <FacebookDisconnectDialog
      v-model="showDisconnect"
      :page-name="disconnectTarget?.pageName ?? ''"
      :active-mapping-count="activeMappingCountForTarget"
      :loading="disconnecting"
      :error="disconnectError"
      @confirm="onDisconnectConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFacebookChannel } from '@/composables/use-facebook-channel';
import FacebookPageRow from '@/components/settings/facebook/FacebookPageRow.vue';
import FacebookDisconnectDialog from '@/components/settings/facebook/FacebookDisconnectDialog.vue';
import type { FacebookPageConnectionDto } from '@/api/facebook-api';

const route = useRoute();
const router = useRouter();

// ── Facebook channel composable ───────────────────────────────────────────────
const {
  pages, loading, error,
  mappingsByPageConnection, rediscoveringPages,
  connectPage, refreshPages, rediscoverPage, disconnectPage,
} = useFacebookChannel();

// ── Disconnect flow ───────────────────────────────────────────────────────────
const showDisconnect = ref(false);
const disconnectTarget = ref<FacebookPageConnectionDto | null>(null);
const disconnecting = ref(false);
const disconnectError = ref('');

const activeMappingCountForTarget = computed(() => {
  if (!disconnectTarget.value) return 0;
  return (mappingsByPageConnection.value[disconnectTarget.value.id] ?? []).filter(
    (m) => m.enabled,
  ).length;
});

function onDisconnectIntent(page: FacebookPageConnectionDto): void {
  disconnectTarget.value = page;
  disconnectError.value = '';
  showDisconnect.value = true;
}

async function onDisconnectConfirm(): Promise<void> {
  if (!disconnectTarget.value) return;
  disconnecting.value = true;
  disconnectError.value = '';
  try {
    await disconnectPage(disconnectTarget.value.pageId);
    showDisconnect.value = false;
    disconnectTarget.value = null;
  } catch (err) {
    disconnectError.value = (err as Error).message ?? 'Không thể ngắt kết nối';
  } finally {
    disconnecting.value = false;
  }
}

// ── Rediscover ────────────────────────────────────────────────────────────────
async function onRediscover(pageId: string): Promise<void> {
  await rediscoverPage(pageId);
}

// ── OAuth status from URL query params ───────────────────────────────────────
const oauthStatus = ref<'success' | 'error' | null>(null);
const oauthPages = ref(0);
const oauthReason = ref('');

function readOauthStatus(): void {
  const status = route.query.status as string | undefined;
  if (!status) return;
  if (status === 'success') {
    oauthStatus.value = 'success';
    oauthPages.value = parseInt(String(route.query.pages ?? '0'), 10);
  } else if (status === 'error') {
    oauthStatus.value = 'error';
    oauthReason.value = decodeURIComponent(String(route.query.reason ?? ''));
  }
  // Clean URL params
  router.replace({ path: route.path, query: {} });
}

function clearOauthStatus(): void {
  oauthStatus.value = null;
}

function onConnectPage(): void {
  connectPage();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  readOauthStatus();
  await refreshPages();
});
</script>

<style scoped>
.fb-channel-view {
  max-width: 900px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.page-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
}
.page-desc {
  font-size: 0.875rem;
  color: rgba(0, 0, 0, 0.6);
  margin: 0;
}
</style>
