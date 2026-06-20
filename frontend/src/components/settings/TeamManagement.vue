<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div>
    <div class="d-flex align-center mb-4">
      <span class="text-h6">Danh sách đội nhóm</span>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="openCreate">
        Thêm đội nhóm
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate color="cyan" class="mb-2" />

    <div v-if="teams.length === 0 && !loading" class="text-center py-8 text-medium-emphasis">
      Chưa có đội nhóm nào
    </div>

    <v-expansion-panels v-model="expandedPanel" variant="accordion">
      <v-expansion-panel v-for="team in teams" :key="team.id" @click="onPanelClick(team.id)">
        <v-expansion-panel-title>
          <div class="d-flex align-center w-100">
            <v-icon class="mr-2" color="cyan">mdi-account-group</v-icon>
            <span class="font-weight-medium">{{ team.name }}</span>
            <v-chip size="x-small" class="ml-2" variant="tonal">
              {{ memberMap[team.id]?.length ?? 0 }} thành viên
            </v-chip>
            <v-spacer />
            <template v-if="authStore.isAdmin">
              <v-btn icon size="x-small" variant="text" class="mr-1" @click.stop="openEdit(team)" title="Sửa">
                <v-icon>mdi-pencil</v-icon>
              </v-btn>
              <v-btn icon size="x-small" variant="text" color="error" @click.stop="openDelete(team)" title="Xóa">
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </template>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex flex-wrap gap-2 mb-3">
            <v-chip
              v-for="m in memberMap[team.id] ?? []"
              :key="m.userId"
              closable
              :close-label="'Xóa ' + m.fullName"
              @click:close="authStore.isAdmin && handleRemoveMember(team.id, m.userId)"
            >
              <v-avatar start>
                <v-icon>mdi-account</v-icon>
              </v-avatar>
              {{ m.fullName }}
            </v-chip>
            <span v-if="!memberMap[team.id]?.length" class="text-medium-emphasis text-body-2">
              Chưa có thành viên
            </span>
          </div>
          <v-btn v-if="authStore.isAdmin" size="small" variant="tonal" prepend-icon="mdi-account-plus" @click="openAddMember(team)">
            Thêm thành viên
          </v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Create team dialog -->
    <v-dialog v-model="showCreate" max-width="400">
      <v-card>
        <v-card-title>Thêm đội nhóm</v-card-title>
        <v-card-text>
          <v-text-field v-model="teamName" label="Tên đội nhóm *" autofocus @keyup.enter="handleCreate" />
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showCreate = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleCreate">Tạo</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit team dialog -->
    <v-dialog v-model="showEdit" max-width="400">
      <v-card>
        <v-card-title>Sửa đội nhóm</v-card-title>
        <v-card-text>
          <v-text-field v-model="teamName" label="Tên đội nhóm *" autofocus @keyup.enter="handleUpdate" />
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showEdit = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleUpdate">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="showDelete" max-width="400">
      <v-card>
        <v-card-title>Xác nhận xóa</v-card-title>
        <v-card-text>Bạn có chắc muốn xóa đội nhóm "{{ selectedTeam?.name }}"?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDelete = false">Hủy</v-btn>
          <v-btn color="error" :loading="saving" @click="handleDelete">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Add member dialog -->
    <v-dialog v-model="showAddMember" max-width="420">
      <v-card>
        <v-card-title>Thêm thành viên</v-card-title>
        <v-card-text>
          <v-select
            v-model="selectedUserId"
            :items="availableUsers"
            item-title="fullName"
            item-value="id"
            label="Chọn nhân viên"
            no-data-text="Không có nhân viên để thêm"
          />
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showAddMember = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleAddMember">Thêm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTeams, type Team, type TeamMember } from '@/composables/use-teams';
import { useUsers } from '@/composables/use-users';
import { useAuthStore } from '@/stores/auth';

const { teams, loading, error, fetchTeams, createTeam, updateTeam, deleteTeam, fetchMembers, addMember, removeMember } = useTeams();
const { users, fetchUsers } = useUsers();
const authStore = useAuthStore();

const expandedPanel = ref<number | null>(null);
const memberMap = ref<Record<string, TeamMember[]>>({});

const showCreate = ref(false);
const showEdit = ref(false);
const showDelete = ref(false);
const showAddMember = ref(false);
const saving = ref(false);
const dialogError = ref('');
const teamName = ref('');
const selectedTeam = ref<Team | null>(null);
const selectedUserId = ref<string>('');

// Users not already in the selected team
const availableUsers = computed(() => {
  if (!selectedTeam.value) return users.value;
  const memberIds = new Set((memberMap.value[selectedTeam.value.id] ?? []).map((m) => m.userId));
  return users.value.filter((u) => !memberIds.has(u.id));
});

async function onPanelClick(teamId: string) {
  if (!memberMap.value[teamId]) {
    memberMap.value[teamId] = await fetchMembers(teamId);
  }
}

function openCreate() {
  teamName.value = '';
  dialogError.value = '';
  showCreate.value = true;
}

function openEdit(team: Team) {
  selectedTeam.value = team;
  teamName.value = team.name;
  dialogError.value = '';
  showEdit.value = true;
}

function openDelete(team: Team) {
  selectedTeam.value = team;
  showDelete.value = true;
}

function openAddMember(team: Team) {
  selectedTeam.value = team;
  selectedUserId.value = '';
  dialogError.value = '';
  showAddMember.value = true;
}

async function handleCreate() {
  if (!teamName.value.trim()) return;
  saving.value = true;
  dialogError.value = '';
  const res = await createTeam(teamName.value.trim());
  saving.value = false;
  if (res.ok) { showCreate.value = false; } else { dialogError.value = res.error || ''; }
}

async function handleUpdate() {
  if (!selectedTeam.value || !teamName.value.trim()) return;
  saving.value = true;
  dialogError.value = '';
  const res = await updateTeam(selectedTeam.value.id, teamName.value.trim());
  saving.value = false;
  if (res.ok) { showEdit.value = false; } else { dialogError.value = res.error || ''; }
}

async function handleDelete() {
  if (!selectedTeam.value) return;
  saving.value = true;
  const res = await deleteTeam(selectedTeam.value.id);
  saving.value = false;
  if (res.ok) {
    showDelete.value = false;
    delete memberMap.value[selectedTeam.value.id];
  }
}

async function handleAddMember() {
  if (!selectedTeam.value || !selectedUserId.value) return;
  saving.value = true;
  dialogError.value = '';
  const res = await addMember(selectedTeam.value.id, selectedUserId.value);
  saving.value = false;
  if (res.ok) {
    memberMap.value[selectedTeam.value.id] = await fetchMembers(selectedTeam.value.id);
    showAddMember.value = false;
  } else {
    dialogError.value = res.error || '';
  }
}

async function handleRemoveMember(teamId: string, userId: string) {
  const res = await removeMember(teamId, userId);
  if (res.ok) {
    memberMap.value[teamId] = await fetchMembers(teamId);
  }
}

onMounted(async () => {
  await Promise.all([fetchTeams(), fetchUsers()]);
});
</script>
