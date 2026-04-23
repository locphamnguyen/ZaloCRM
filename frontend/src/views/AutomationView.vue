<template>
  <div>
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h5 mr-4">Workflow Automation</h1>
      <v-spacer />
      <v-btn v-if="canManage && tab === 'rules'" color="primary" prepend-icon="mdi-plus" @click="openCreateRule">Thêm rule</v-btn>
      <v-btn v-if="canManage && tab === 'drip'" color="primary" prepend-icon="mdi-plus" @click="openCreateCampaign">Chiến dịch mới</v-btn>
    </div>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="rules">Rules</v-tab>
      <v-tab value="templates">Templates</v-tab>
      <v-tab value="drip">Chiến dịch nhỏ giọt</v-tab>
      <v-tab value="running">Đang chạy</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="rules">
        <v-card>
          <v-data-table :headers="ruleHeaders" :items="rules" :loading="rulesLoading" no-data-text="Chưa có automation rule nào">
            <template #item.trigger="{ item }">
              <v-chip size="small" variant="tonal">{{ triggerLabel(item.trigger) }}</v-chip>
            </template>
            <template #item.enabled="{ item }">
              <v-switch :model-value="item.enabled" color="primary" hide-details :disabled="!canManage" @update:model-value="toggleRule(item, $event)" />
            </template>
            <template #item.lastRunAt="{ item }">
              {{ item.lastRunAt ? formatDateTime(item.lastRunAt) : '—' }}
            </template>
            <template #item.actions="{ item }">
              <div v-if="canManage">
                <v-btn icon size="small" @click="openEditRule(item)"><v-icon>mdi-pencil</v-icon></v-btn>
                <v-btn icon size="small" color="error" @click="deleteRule(item.id)"><v-icon>mdi-delete</v-icon></v-btn>
              </div>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <v-window-item value="templates">
        <TemplateManager
          :templates="templates"
          :loading="templatesLoading"
          :saving="templateSaving"
          :can-manage="canManage"
          @create="createTemplate"
          @update="updateTemplate"
          @delete="deleteTemplate"
        />
      </v-window-item>

      <v-window-item value="drip">
        <DripCampaignList
          :campaigns="campaigns"
          :loading="campaignsLoading"
          :can-manage="canManage"
          @edit="openEditCampaign"
          @delete="handleDeleteCampaign"
          @toggle="handleToggleCampaign"
          @enroll="openEnrollDialog"
        />
      </v-window-item>

      <v-window-item value="running">
        <DripEnrollmentTable
          :campaigns="campaigns"
          @view-logs="openLogsDialog"
        />
      </v-window-item>
    </v-window>

    <RuleBuilder
      v-model="showRuleDialog"
      :rule="selectedRule"
      :templates="templates"
      :saving="ruleSaving"
      @save="saveRule"
    />

    <DripCampaignEditor
      v-model="showCampaignEditor"
      :campaign="selectedCampaign"
      :templates="templates"
      :saving="campaignSaving"
      @save="handleSaveCampaign"
    />

    <!-- Enroll dialog -->
    <v-dialog v-model="showEnrollDialog" max-width="480">
      <v-card>
        <v-card-title>Enroll khách hàng</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="enrollContactIds"
            label="Contact IDs (mỗi dòng một ID)"
            rows="4"
            density="compact"
            variant="outlined"
            hide-details
          />
          <div class="text-caption mt-1 text-grey">Nhập ID khách hàng, mỗi ID trên một dòng</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showEnrollDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="enrolling" @click="handleEnroll">Enroll</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <DripLogDialog v-model="showLogDialog" :enrollment-id="selectedEnrollmentId" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import RuleBuilder from '@/components/automation/RuleBuilder.vue';
import TemplateManager from '@/components/automation/TemplateManager.vue';
import DripCampaignList from '@/components/automation/drip/DripCampaignList.vue';
import DripCampaignEditor from '@/components/automation/drip/DripCampaignEditor.vue';
import DripEnrollmentTable from '@/components/automation/drip/DripEnrollmentTable.vue';
import DripLogDialog from '@/components/automation/drip/DripLogDialog.vue';
import { useAutomationRules, type AutomationRule } from '@/composables/use-automation-rules';
import { useMessageTemplates } from '@/composables/use-message-templates';
import { useDripCampaigns, type DripCampaign, type CreateCampaignPayload } from '@/composables/use-drip-campaigns';
import { useDripEnrollments } from '@/composables/use-drip-enrollments';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const canManage = computed(() => authStore.isAdmin);
const tab = ref('rules');

// ─── Rules ───────────────────────────────────────────────────────────────────
const showRuleDialog = ref(false);
const selectedRule = ref<AutomationRule | null>(null);

const {
  rules,
  loading: rulesLoading,
  saving: ruleSaving,
  fetchRules,
  createRule,
  updateRule,
  deleteRule: removeRule,
} = useAutomationRules();

const {
  templates,
  loading: templatesLoading,
  saving: templateSaving,
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = useMessageTemplates();

const ruleHeaders = [
  { title: 'Tên rule', key: 'name' },
  { title: 'Trigger', key: 'trigger' },
  { title: 'Ưu tiên', key: 'priority' },
  { title: 'Đã chạy', key: 'runCount' },
  { title: 'Lần chạy gần nhất', key: 'lastRunAt' },
  { title: 'Bật', key: 'enabled', sortable: false },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

function triggerLabel(trigger: string) {
  const labels: Record<string, string> = {
    message_received: 'Tin nhắn đến',
    contact_created: 'Contact mới',
    status_changed: 'Đổi trạng thái',
  };
  return labels[trigger] ?? trigger;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN');
}

function openCreateRule() {
  selectedRule.value = null;
  showRuleDialog.value = true;
}

function openEditRule(rule: AutomationRule) {
  selectedRule.value = rule;
  showRuleDialog.value = true;
}

async function saveRule(payload: Partial<AutomationRule>) {
  if (payload.id) {
    await updateRule(payload.id, payload);
  } else {
    await createRule(payload);
  }
  showRuleDialog.value = false;
}

async function toggleRule(rule: AutomationRule, enabled: boolean | null) {
  await updateRule(rule.id, { enabled: !!enabled });
}

async function deleteRule(id: string) {
  await removeRule(id);
}

// ─── Drip Campaigns ──────────────────────────────────────────────────────────
const showCampaignEditor = ref(false);
const selectedCampaign = ref<DripCampaign | null>(null);

const {
  campaigns,
  loading: campaignsLoading,
  saving: campaignSaving,
  fetchCampaigns,
  createNewCampaign,
  updateExistingCampaign,
  removeCampaign,
} = useDripCampaigns();

function openCreateCampaign() {
  selectedCampaign.value = null;
  showCampaignEditor.value = true;
}

async function openEditCampaign(campaign: DripCampaign) {
  // Fetch full campaign with steps
  const { fetchCampaign } = useDripCampaigns();
  const full = await fetchCampaign(campaign.id);
  selectedCampaign.value = full ?? campaign;
  showCampaignEditor.value = true;
}

async function handleSaveCampaign(payload: CreateCampaignPayload & { id?: string }) {
  if (payload.id) {
    await updateExistingCampaign(payload.id, payload);
  } else {
    await createNewCampaign(payload);
  }
  showCampaignEditor.value = false;
}

async function handleDeleteCampaign(id: string) {
  await removeCampaign(id);
}

async function handleToggleCampaign(campaign: DripCampaign, enabled: boolean) {
  await updateExistingCampaign(campaign.id, { enabled });
}

// ─── Enroll ──────────────────────────────────────────────────────────────────
const showEnrollDialog = ref(false);
const enrollTargetCampaign = ref<DripCampaign | null>(null);
const enrollContactIds = ref('');
const enrolling = ref(false);
const { enrollContacts } = useDripEnrollments();

function openEnrollDialog(campaign: DripCampaign) {
  enrollTargetCampaign.value = campaign;
  enrollContactIds.value = '';
  showEnrollDialog.value = true;
}

async function handleEnroll() {
  if (!enrollTargetCampaign.value) return;
  const ids = enrollContactIds.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return;
  enrolling.value = true;
  await enrollContacts(enrollTargetCampaign.value.id, ids);
  enrolling.value = false;
  showEnrollDialog.value = false;
}

// ─── Logs ────────────────────────────────────────────────────────────────────
const showLogDialog = ref(false);
const selectedEnrollmentId = ref<string | null>(null);

function openLogsDialog(enrollmentId: string) {
  selectedEnrollmentId.value = enrollmentId;
  showLogDialog.value = true;
}

onMounted(async () => {
  await Promise.all([fetchRules(), fetchTemplates(), fetchCampaigns()]);
});
</script>
