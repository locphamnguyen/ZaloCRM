<template>
  <v-alert
    v-if="show"
    type="warning"
    variant="tonal"
    density="compact"
    closable
    class="mb-3"
    @click:close="dismiss"
  >
    <div class="text-body-2 font-weight-medium mb-1">
      Khách này kết nối với {{ peers.length }} nick Zalo khác:
    </div>
    <div v-for="peer in peers" :key="peer.contactId + peer.accountId" class="d-flex align-center gap-2 mt-1">
      <v-icon size="14" color="warning">mdi-account-circle-outline</v-icon>
      <span class="text-body-2">{{ peer.accountDisplayName }}</span>
      <v-chip size="x-small" variant="tonal" color="grey">{{ peer.matchType }}</v-chip>
      <v-spacer />
      <v-btn
        v-if="peer.conversationId"
        size="x-small"
        variant="text"
        color="primary"
        :href="`/chat?conversationId=${peer.conversationId}`"
        target="_self"
      >
        Mở hội thoại
      </v-btn>
      <span v-else class="text-caption text-grey">(không có quyền truy cập)</span>
    </div>
  </v-alert>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { api } from '@/api/index';

interface DuplicatePeer {
  contactId: string;
  contactName: string | null;
  accountId: string;
  accountDisplayName: string;
  conversationId: string | null;
  lastMessageAt: string | null;
  matchType: string;
}

const props = defineProps<{ contactId: string }>();

const peers = ref<DuplicatePeer[]>([]);
const dismissed = ref(false);

const dismissKey = computed(() => `dupbanner:dismissed:${props.contactId}`);
const show = computed(() => peers.value.length > 0 && !dismissed.value);

async function fetchPeers() {
  dismissed.value = sessionStorage.getItem(dismissKey.value) === '1';
  if (dismissed.value) return;
  try {
    const res = await api.get(`/contacts/${props.contactId}/duplicate-peers`);
    peers.value = res.data.peers ?? [];
  } catch {
    peers.value = [];
  }
}

function dismiss() {
  dismissed.value = true;
  sessionStorage.setItem(dismissKey.value, '1');
}

onMounted(fetchPeers);

watch(() => props.contactId, () => {
  peers.value = [];
  dismissed.value = false;
  fetchPeers();
});
</script>
