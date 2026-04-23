<template>
  <v-card variant="outlined" class="mb-3">
    <v-card-title class="d-flex align-center text-body-2 pb-1 pt-2 px-3">
      <v-icon size="16" class="mr-1">mdi-tag-multiple-outline</v-icon>
      Tags
      <v-progress-circular v-if="loading" indeterminate size="14" width="2" class="ml-2" />
    </v-card-title>

    <v-card-text class="pt-1 pb-2 px-3">
      <!-- Zalo tags -->
      <div class="d-flex align-center flex-wrap gap-1 mb-2">
        <v-icon size="14" color="blue" class="mr-1">mdi-lightning-bolt</v-icon>
        <span class="text-caption text-grey mr-1">Zalo:</span>
        <v-chip
          v-for="ct in zaloContactTags"
          :key="ct.tagId"
          :color="ct.tag.color ?? 'blue'"
          size="x-small"
          variant="tonal"
          closable
          @click:close="confirmRemove(ct)"
        >
          {{ ct.tag.name }}
        </v-chip>
        <span v-if="zaloContactTags.length === 0" class="text-caption text-grey">—</span>
        <v-menu v-model="zaloPickerOpen" :close-on-content-click="false" location="bottom start">
          <template #activator="{ props: mp }">
            <v-btn v-bind="mp" icon size="x-small" variant="text" color="blue">
              <v-icon size="14">mdi-plus</v-icon>
            </v-btn>
          </template>
          <TagPickerMenu
            :tags="availableZaloTags"
            :loading="adding"
            @select="(tag) => addTag(tag)"
            @close="zaloPickerOpen = false"
          />
        </v-menu>
      </div>

      <!-- CRM tags -->
      <div class="d-flex align-center flex-wrap gap-1">
        <v-icon size="14" color="grey" class="mr-1">mdi-tag-outline</v-icon>
        <span class="text-caption text-grey mr-1">CRM:</span>
        <v-chip
          v-for="ct in crmContactTags"
          :key="ct.tagId"
          :color="ct.tag.color ?? 'grey'"
          size="x-small"
          variant="tonal"
          closable
          @click:close="confirmRemove(ct)"
        >
          {{ ct.tag.name }}
        </v-chip>
        <span v-if="crmContactTags.length === 0" class="text-caption text-grey">—</span>
        <v-menu v-model="crmPickerOpen" :close-on-content-click="false" location="bottom start">
          <template #activator="{ props: mp }">
            <v-btn v-bind="mp" icon size="x-small" variant="text" color="grey">
              <v-icon size="14">mdi-plus</v-icon>
            </v-btn>
          </template>
          <TagPickerMenu
            :tags="availableCrmTags"
            :loading="adding"
            @select="(tag) => addTag(tag)"
            @close="crmPickerOpen = false"
          />
        </v-menu>
      </div>
    </v-card-text>

    <!-- Remove confirm dialog -->
    <v-dialog v-model="removeDialog" max-width="340">
      <v-card>
        <v-card-title>Xóa tag?</v-card-title>
        <v-card-text>Gỡ tag "{{ removeTarget?.tag.name }}" khỏi khách hàng này?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="removeDialog = false">Hủy</v-btn>
          <v-btn color="error" :loading="removing" @click="doRemove">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useTagsStore, type ContactTag, type Tag } from '@/stores/tags';
import TagPickerMenu from './TagPickerMenu.vue';

const props = defineProps<{ contactId: string }>();

const store = useTagsStore();
const loading = ref(false);
const adding = ref(false);
const removing = ref(false);
const removeDialog = ref(false);
const removeTarget = ref<ContactTag | null>(null);
const zaloPickerOpen = ref(false);
const crmPickerOpen = ref(false);

const contactTags = computed(() => store.contactTagsMap.get(props.contactId) ?? []);
const zaloContactTags = computed(() => contactTags.value.filter((ct) => ct.tag.source === 'zalo'));
const crmContactTags = computed(() => contactTags.value.filter((ct) => ct.tag.source === 'crm'));

const assignedTagIds = computed(() => new Set(contactTags.value.map((ct) => ct.tagId)));
const availableZaloTags = computed(() => store.zaloTags.filter((t) => !assignedTagIds.value.has(t.id)));
const availableCrmTags = computed(() => store.crmTags.filter((t) => !assignedTagIds.value.has(t.id)));

async function load() {
  loading.value = true;
  try {
    await Promise.all([store.loadAll(), store.loadContactTags(props.contactId)]);
  } finally {
    loading.value = false;
  }
}

async function addTag(tag: Tag) {
  adding.value = true;
  try {
    await store.addContactTag(props.contactId, tag.id);
  } finally {
    adding.value = false;
    zaloPickerOpen.value = false;
    crmPickerOpen.value = false;
  }
}

function confirmRemove(ct: ContactTag) {
  removeTarget.value = ct;
  removeDialog.value = true;
}

async function doRemove() {
  if (!removeTarget.value) return;
  removing.value = true;
  try {
    await store.removeContactTag(props.contactId, removeTarget.value.tagId);
    removeDialog.value = false;
  } finally {
    removing.value = false;
  }
}

onMounted(load);
watch(() => props.contactId, load);
</script>
