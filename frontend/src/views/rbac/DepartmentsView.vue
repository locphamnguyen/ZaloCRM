<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="dept-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">Sơ đồ tổ chức</h1>
        <p class="hero-sub">Cây phòng ban Getfly model · Phòng cha quản lý mọi phòng con · Cùng cấp không quản lý nhau</p>
      </div>
      <button class="btn-primary" @click="openCreate(null)">
        <span class="btn-icon">+</span> Thêm phòng ban
      </button>
    </header>

    <section class="stats-row" v-if="!loading && stats.totalDepts > 0">
      <div class="stat-card stat-primary"><div class="stat-label">Tổng phòng ban</div><div class="stat-value">{{ stats.totalDepts }}</div></div>
      <div class="stat-card stat-forest"><div class="stat-label">Cấp tối đa</div><div class="stat-value">{{ stats.maxDepth + 1 }}<span class="stat-unit"> / 5</span></div></div>
      <div class="stat-card stat-mustard"><div class="stat-label">Có trưởng phòng</div><div class="stat-value">{{ stats.deptsWithLeader }}<span class="stat-unit"> / {{ stats.totalDepts }}</span></div></div>
      <div class="stat-card stat-cream"><div class="stat-label">Tổng nhân viên</div><div class="stat-value">{{ stats.totalMembers }}</div></div>
    </section>

    <!-- Toolbar: search + view mode -->
    <div class="toolbar" v-if="!loading && store.departments.length > 0">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input v-model="searchQ" placeholder="Tìm phòng ban..." />
        <button v-if="searchQ" class="search-clear" @click="searchQ = ''">×</button>
      </div>
      <div class="view-toggle">
        <button :class="{ active: viewMode === 'tree' }" @click="viewMode = 'tree'">
          🌳 Cây thư mục
        </button>
        <button :class="{ active: viewMode === 'org' }" @click="viewMode = 'org'">
          📊 Sơ đồ tổ chức
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 3" :key="i"></div>
    </div>

    <div v-else-if="store.departments.length === 0" class="empty-state">
      <div class="empty-icon">🌳</div>
      <h3>Chưa có phòng ban nào</h3>
      <p>Tạo phòng đầu tiên — vd "Ban Giám Đốc" làm root, rồi thêm phòng con bên dưới.</p>
      <button class="btn-primary" @click="openCreate(null)">+ Thêm phòng ban đầu tiên</button>
    </div>

    <!-- TREE VIEW (vertical 3-row cards in indented tree) -->
    <section v-else-if="viewMode === 'tree'" class="tree-view">
      <DeptTreeNode
        v-for="node in filteredTree"
        :key="node.id"
        :node="node"
        :user-name-map="userNameMap"
        :depth="0"
        :expanded-ids="expandedIds"
        :expanded-members="expandedMembers"
        :member-cache="memberCache"
        @toggle="toggleNode"
        @add-child="openCreate"
        @open-panel="openPanel"
        @toggle-members="toggleMembers"
      />
    </section>

    <!-- ORG CHART VIEW (vertical visual chart) -->
    <section v-else class="org-chart">
      <div class="org-canvas">
        <OrgChartNode
          v-for="node in filteredTree"
          :key="node.id"
          :node="node"
          :user-name-map="userNameMap"
          :expanded-members="expandedMembers"
          :member-cache="memberCache"
          @add-child="openCreate"
          @open-panel="openPanel"
          @toggle-members="toggleMembers"
        />
      </div>
    </section>

    <!-- Create modal -->
    <Transition name="modal-fade">
      <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
        <div class="modal-card">
          <header class="modal-head">
            <h3>{{ createParentId ? 'Thêm phòng ban con' : 'Thêm phòng ban gốc' }}</h3>
            <button class="modal-close" @click="showCreate = false">×</button>
          </header>
          <div class="modal-body">
            <p v-if="createParentName" class="parent-hint"><span class="hint-label">Thuộc:</span><strong>{{ createParentName }}</strong></p>
            <label class="form-label">Tên phòng ban</label>
            <input ref="nameInput" v-model="newName" placeholder="VD: Phòng Kinh Doanh 1" class="form-input" @keyup.enter="submitCreate" />
            <p v-if="createError" class="form-error">{{ createError }}</p>
          </div>
          <footer class="modal-foot">
            <button class="btn-ghost" @click="showCreate = false">Hủy</button>
            <button class="btn-primary" :disabled="!newName.trim()" @click="submitCreate">Tạo phòng ban</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Side panel (Smax-style) -->
    <DepartmentEditPanel
      :open="panelOpen"
      :node="selectedNode"
      :parent-name="selectedParentName"
      :all-users="allUsers"
      @close="closePanel"
      @archived="onArchived"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h, type Component, reactive, watch } from 'vue';
import { useRbacStore, type DepartmentNode, type RbacUser } from '@/stores/rbac';
import { api } from '@/api/index';
import DepartmentEditPanel from '@/components/rbac/DepartmentEditPanel.vue';

const store = useRbacStore();
const allUsers = ref<RbacUser[]>([]);
const viewMode = ref<'tree' | 'org'>('org');
const searchQ = ref('');
const expandedIds = reactive(new Set<string>());

// Inline member expand (per-dept member list under "Nhân viên" row)
const expandedMembers = reactive(new Set<string>());
const memberCache = reactive<Record<string, Array<{ userId: string; fullName: string; email: string; deptRole: string }>>>({});

// Side panel state
const panelOpen = ref(false);
const selectedNode = ref<DepartmentNode | null>(null);
const selectedParentName = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([
    store.loadDepartments(),
    api.get('/rbac/users').then((r) => { allUsers.value = r.data.users ?? []; }).catch(() => {}),
  ]);
  for (const n of store.departments) expandedIds.add(n.id);
});

const userNameMap = computed(() => {
  const m = new Map<string, string>();
  for (const u of allUsers.value) m.set(u.id, u.fullName || u.email || u.phone || '(?)');
  return m;
});

// Filter tree by search query
const filteredTree = computed<DepartmentNode[]>(() => {
  if (!searchQ.value.trim()) return store.departments;
  const q = searchQ.value.toLowerCase();
  function matches(n: DepartmentNode): boolean {
    if (n.name.toLowerCase().includes(q)) return true;
    return (n.children ?? []).some(matches);
  }
  function filter(nodes: DepartmentNode[]): DepartmentNode[] {
    return nodes.filter(matches).map((n) => ({ ...n, children: filter(n.children ?? []) }));
  }
  function collectAll(nodes: DepartmentNode[]) {
    for (const n of nodes) { expandedIds.add(n.id); collectAll(n.children ?? []); }
  }
  const result = filter(store.departments);
  collectAll(result);
  return result;
});

function toggleNode(id: string) {
  if (expandedIds.has(id)) expandedIds.delete(id);
  else expandedIds.add(id);
}

async function toggleMembers(deptId: string) {
  if (expandedMembers.has(deptId)) {
    expandedMembers.delete(deptId);
    return;
  }
  expandedMembers.add(deptId);
  if (!memberCache[deptId]) {
    try {
      const { data } = await api.get('/rbac/users', { params: { departmentId: deptId } });
      memberCache[deptId] = (data.users ?? [])
        .filter((u: any) => u.departmentMember?.departmentId === deptId && u.departmentMember?.deptRole === 'member')
        .map((u: any) => ({
          userId: u.id,
          fullName: u.fullName || u.email,
          email: u.email,
          deptRole: u.departmentMember.deptRole,
        }));
    } catch {
      memberCache[deptId] = [];
    }
  }
}

// Refresh cache when store.departments mutate (re-fetch members for expanded depts)
watch(() => store.departments, () => {
  for (const id of Array.from(expandedMembers)) {
    delete memberCache[id];
    // Re-fetch lazily — collapse so next click reloads
    expandedMembers.delete(id);
  }
});

// Find parent name for a given node ID (walk tree)
function findParentName(nodeId: string): string | null {
  function walk(nodes: DepartmentNode[], parentName: string | null): string | null {
    for (const n of nodes) {
      if (n.id === nodeId) return parentName;
      if (n.children?.length) {
        const found = walk(n.children, n.name);
        if (found !== null || n.children.some((c) => c.id === nodeId)) return found ?? n.name;
      }
    }
    return null;
  }
  return walk(store.departments, null);
}

function openPanel(node: DepartmentNode) {
  selectedNode.value = node;
  selectedParentName.value = findParentName(node.id);
  panelOpen.value = true;
}

function closePanel() {
  panelOpen.value = false;
  selectedNode.value = null;
  selectedParentName.value = null;
}

function onArchived() {
  closePanel();
}

const stats = computed(() => {
  let total = 0, withLeader = 0, totalMembers = 0, maxDepth = 0;
  function walk(nodes: DepartmentNode[]) {
    for (const n of nodes) {
      total++;
      if (n.leaderUserId) withLeader++;
      totalMembers += n.memberCount;
      if (n.depth > maxDepth) maxDepth = n.depth;
      if (n.children?.length) walk(n.children);
    }
  }
  walk(store.departments);
  return { totalDepts: total, deptsWithLeader: withLeader, totalMembers, maxDepth };
});

const loading = computed(() => store.loading);

const showCreate = ref(false);
const createParentId = ref<string | null>(null);
const createParentName = ref('');
const newName = ref('');
const createError = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

function openCreate(parent: DepartmentNode | null) {
  createParentId.value = parent?.id ?? null;
  createParentName.value = parent?.name ?? '';
  newName.value = '';
  createError.value = '';
  showCreate.value = true;
  setTimeout(() => nameInput.value?.focus(), 50);
}
async function submitCreate() {
  if (!newName.value.trim()) return;
  try {
    await store.createDepartment({ name: newName.value.trim(), parentId: createParentId.value });
    showCreate.value = false;
  } catch (e: any) { createError.value = e?.response?.data?.error || 'Lỗi tạo phòng ban'; }
}

// ────────── TREE VIEW NODE (indented + 3-row card body) ──────────
const DeptTreeNode: Component = {
  name: 'DeptTreeNode',
  props: ['node', 'userNameMap', 'depth', 'expandedIds', 'expandedMembers', 'memberCache'],
  emits: ['toggle', 'add-child', 'open-panel', 'toggle-members'],
  setup(props, { emit }) {
    return () => {
      const node: DepartmentNode = props.node;
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isExpanded = props.expandedIds.has(node.id);
      const leaderName = node.leaderUserId ? props.userNameMap.get(node.leaderUserId) : null;
      const deputyName = node.deputyUserId ? props.userNameMap.get(node.deputyUserId) : null;
      const accentColor = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(node.depth, 4)];
      const isMembersOpen = props.expandedMembers.has(node.id);
      const membersList: Array<{ userId: string; fullName: string; email: string; deptRole: string }> = props.memberCache[node.id] ?? [];

      // Header row (toggle + name + open panel + add child)
      const header = h('div', { class: 'dept-row', style: { '--depth': props.depth, '--accent': accentColor } }, [
        h('button', {
          class: ['dept-toggle', { invisible: !hasChildren }],
          onClick: (e: Event) => { e.stopPropagation(); hasChildren && emit('toggle', node.id); },
        }, [hasChildren ? (isExpanded ? '▾' : '▸') : '·']),
        h('div', { class: 'dept-card', onClick: () => emit('open-panel', node) }, [
          h('div', { class: 'dept-card-accent' }),
          h('div', { class: 'dept-card-body' }, [
            // Header: name + actions
            h('div', { class: 'dept-card-head' }, [
              h('div', { class: 'dept-name-wrap' }, [
                h('span', { class: 'dept-name' }, node.name),
                h('span', { class: 'dept-depth-tag' }, `Cấp ${node.depth + 1}`),
              ]),
              h('div', { class: 'dept-quick-actions' }, [
                h('button', {
                  class: 'btn-quick btn-quick-add',
                  title: 'Thêm phòng con',
                  onClick: (e: Event) => { e.stopPropagation(); emit('add-child', node); },
                }, '+ Phòng con'),
                h('button', {
                  class: 'btn-quick btn-quick-edit',
                  title: 'Mở chi tiết',
                  onClick: (e: Event) => { e.stopPropagation(); emit('open-panel', node); },
                }, '✎ Chi tiết'),
              ]),
            ]),
            // 3-row layout: Trưởng phòng / Phó phòng / Nhân viên
            h('div', { class: 'dept-rows' }, [
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-leader' }, '👑'),
                h('span', { class: 'info-label' }, 'Trưởng phòng:'),
                leaderName
                  ? h('span', { class: 'info-name' }, leaderName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-deputy' }, '🎖️'),
                h('span', { class: 'info-label' }, 'Phó phòng:'),
                deputyName
                  ? h('span', { class: 'info-name' }, deputyName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row dept-info-row-members' }, [
                h('span', { class: 'info-ico ico-members' }, '👥'),
                h('span', { class: 'info-label' }, 'Nhân viên:'),
                h('span', { class: 'info-count' }, String(node.memberCount)),
                node.memberCount > 0
                  ? h('button', {
                      class: 'btn-expand-members',
                      title: isMembersOpen ? 'Thu gọn' : 'Mở rộng',
                      onClick: (e: Event) => { e.stopPropagation(); emit('toggle-members', node.id); },
                    }, isMembersOpen ? '−' : '+')
                  : null,
              ].filter(Boolean)),
              // Inline expanded member list
              isMembersOpen
                ? h('ul', { class: 'inline-member-list' },
                    membersList.length > 0
                      ? membersList.map((m) =>
                          h('li', { key: m.userId, class: 'inline-member' }, [
                            h('span', { class: 'inline-avatar', style: { background: avatarColor(m.fullName) } }, initials(m.fullName)),
                            h('div', { class: 'inline-info' }, [
                              h('div', { class: 'inline-name' }, m.fullName),
                              h('div', { class: 'inline-email' }, m.email),
                            ]),
                          ])
                        )
                      : [h('li', { class: 'inline-member-empty' }, 'Đang tải hoặc chỉ có chức vụ Trưởng/Phó, chưa có nhân viên thường.')]
                  )
                : null,
            ].filter(Boolean)),
          ]),
        ]),
      ]);

      const children = isExpanded && hasChildren
        ? node.children!.map((c: DepartmentNode) =>
            h(DeptTreeNode as any, {
              key: c.id,
              node: c,
              userNameMap: props.userNameMap,
              depth: props.depth + 1,
              expandedIds: props.expandedIds,
              expandedMembers: props.expandedMembers,
              memberCache: props.memberCache,
              onToggle: (id: string) => emit('toggle', id),
              onAddChild: (n: DepartmentNode) => emit('add-child', n),
              onOpenPanel: (n: DepartmentNode) => emit('open-panel', n),
              onToggleMembers: (id: string) => emit('toggle-members', id),
            }))
        : null;

      return h('div', { class: 'dept-group' }, [header, children]);
    };
  },
};

// ────────── ORG CHART NODE (vertical visual chart, same 3-row card) ──────────
const OrgChartNode: Component = {
  name: 'OrgChartNode',
  props: ['node', 'userNameMap', 'expandedMembers', 'memberCache'],
  emits: ['add-child', 'open-panel', 'toggle-members'],
  setup(props, { emit }) {
    return () => {
      const node: DepartmentNode = props.node;
      const leaderName = node.leaderUserId ? props.userNameMap.get(node.leaderUserId) : null;
      const deputyName = node.deputyUserId ? props.userNameMap.get(node.deputyUserId) : null;
      const accentColor = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(node.depth, 4)];
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isMembersOpen = props.expandedMembers.has(node.id);
      const membersList: Array<{ userId: string; fullName: string; email: string; deptRole: string }> = props.memberCache[node.id] ?? [];

      return h('div', { class: 'org-node' }, [
        h('div', {
          class: 'org-card-wrap dept-card',
          style: { '--accent': accentColor },
          onClick: () => emit('open-panel', node),
        }, [
          h('div', { class: 'dept-card-accent' }),
          h('div', { class: 'dept-card-body' }, [
            h('div', { class: 'dept-card-head' }, [
              h('div', { class: 'dept-name-wrap' }, [
                h('span', { class: 'dept-name' }, node.name),
                h('span', { class: 'dept-depth-tag' }, `Cấp ${node.depth + 1}`),
              ]),
              h('div', { class: 'dept-quick-actions' }, [
                h('button', {
                  class: 'btn-quick btn-quick-add',
                  onClick: (e: Event) => { e.stopPropagation(); emit('add-child', node); },
                }, '+'),
                h('button', {
                  class: 'btn-quick btn-quick-edit',
                  onClick: (e: Event) => { e.stopPropagation(); emit('open-panel', node); },
                }, '✎'),
              ]),
            ]),
            h('div', { class: 'dept-rows' }, [
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-leader' }, '👑'),
                h('span', { class: 'info-label' }, 'Trưởng phòng:'),
                leaderName
                  ? h('span', { class: 'info-name' }, leaderName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-deputy' }, '🎖️'),
                h('span', { class: 'info-label' }, 'Phó phòng:'),
                deputyName
                  ? h('span', { class: 'info-name' }, deputyName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row dept-info-row-members' }, [
                h('span', { class: 'info-ico ico-members' }, '👥'),
                h('span', { class: 'info-label' }, 'Nhân viên:'),
                h('span', { class: 'info-count' }, String(node.memberCount)),
                node.memberCount > 0
                  ? h('button', {
                      class: 'btn-expand-members',
                      onClick: (e: Event) => { e.stopPropagation(); emit('toggle-members', node.id); },
                    }, isMembersOpen ? '−' : '+')
                  : null,
              ].filter(Boolean)),
              isMembersOpen
                ? h('ul', { class: 'inline-member-list' },
                    membersList.length > 0
                      ? membersList.map((m) =>
                          h('li', { key: m.userId, class: 'inline-member' }, [
                            h('span', { class: 'inline-avatar', style: { background: avatarColor(m.fullName) } }, initials(m.fullName)),
                            h('div', { class: 'inline-info' }, [
                              h('div', { class: 'inline-name' }, m.fullName),
                              h('div', { class: 'inline-email' }, m.email),
                            ]),
                          ])
                        )
                      : [h('li', { class: 'inline-member-empty' }, 'Chưa có nhân viên thường (chỉ có chức vụ).')]
                  )
                : null,
            ].filter(Boolean)),
          ]),
        ]),
        hasChildren
          ? h('div', { class: 'org-children' }, [
              h('div', { class: 'org-connector-down' }),
              h('div', { class: 'org-children-row' }, node.children!.map((c: DepartmentNode) =>
                h('div', { class: 'org-child-wrap', key: c.id }, [
                  h('div', { class: 'org-connector-up' }),
                  h(OrgChartNode as any, {
                    node: c,
                    userNameMap: props.userNameMap,
                    expandedMembers: props.expandedMembers,
                    memberCache: props.memberCache,
                    onAddChild: (n: DepartmentNode) => emit('add-child', n),
                    onOpenPanel: (n: DepartmentNode) => emit('open-panel', n),
                    onToggleMembers: (id: string) => emit('toggle-members', id),
                  }),
                ]),
              )),
            ])
          : null,
      ].filter(Boolean));
    };
  },
};

// ────────── Helpers ──────────
function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const hh = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[hh % colors.length];
}
</script>

<style>
/* RBAC DepartmentsView — non-scoped vì recursive h() components không nhận data-v-* attribute */
.dept-page {
  background: white;
  min-height: 100%;
  padding: 28px 32px 96px;
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
  color: #181d26;
  letter-spacing: -0.005em;
}

/* Hero */
.page-hero { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; gap: 24px; }
.hero-title { font-size: 30px; font-weight: 400; line-height: 1.2; margin: 0 0 6px; }
.hero-sub { font-size: 13px; color: #41454d; margin: 0; max-width: 600px; }

/* Stats */
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.stat-card { border-radius: 12px; padding: 14px 18px; position: relative; overflow: hidden; }
.stat-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.stat-primary { background: #f8fafc; }
.stat-primary::before { background: #181d26; }
.stat-forest { background: #e3ede4; }
.stat-forest::before { background: #0a2e0e; }
.stat-mustard { background: #fdf3df; }
.stat-mustard::before { background: #d9a441; }
.stat-cream { background: #f5e9d4; }
.stat-cream::before { background: #aa2d00; }
.stat-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #41454d; margin-bottom: 4px; }
.stat-value { font-size: 24px; font-weight: 400; color: #181d26; letter-spacing: -0.3px; }
.stat-unit { font-size: 13px; color: #9297a0; }

/* Toolbar */
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; }
.search-box { display: flex; align-items: center; gap: 8px; background: #f8fafc; border: 1px solid #dddddd; border-radius: 8px; padding: 0 12px; flex: 1; max-width: 400px; }
.search-box:focus-within { border-color: #181d26; background: white; box-shadow: 0 0 0 3px rgba(24,29,38,0.06); }
.search-icon { color: #9297a0; }
.search-box input { flex: 1; border: 0; background: transparent; padding: 10px 0; font-size: 13px; outline: none; color: #181d26; font-family: inherit; }
.search-clear { background: none; border: 0; color: #9297a0; cursor: pointer; font-size: 18px; padding: 0 4px; line-height: 1; }
.view-toggle { display: flex; gap: 4px; background: #f0f1f3; padding: 3px; border-radius: 8px; }
.view-toggle button {
  background: transparent; border: 0; padding: 6px 14px; font-size: 12px; font-weight: 500;
  border-radius: 6px; cursor: pointer; color: #41454d; transition: all 0.1s;
}
.view-toggle button.active { background: white; color: #181d26; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }

/* ── TREE VIEW (indented vertical cards) ────────────────────── */
.tree-view {
  background: #f8fafc;
  border: 1px solid #dddddd;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dept-group { display: flex; flex-direction: column; gap: 12px; }
.dept-group .dept-group { padding-left: calc(28px + var(--depth, 0) * 4px); }

.dept-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding-left: calc(var(--depth, 0) * 28px);
  position: relative;
}
.dept-toggle {
  background: white; border: 1px solid #e0e2e6; font-size: 13px;
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #41454d;
  border-radius: 6px;
  flex-shrink: 0;
  margin-top: 10px;
}
.dept-toggle:hover:not(.invisible) { background: #181d26; color: white; border-color: #181d26; }
.dept-toggle.invisible { visibility: hidden; }

/* ── Department CARD (the visual cell) ───────────────────── */
.dept-card {
  flex: 1;
  background: white;
  border: 1px solid #e0e2e6;
  border-radius: 10px;
  display: flex;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.15s;
  box-shadow: 0 1px 2px rgba(24,29,38,0.04);
}
.dept-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 14px rgba(24,29,38,0.1);
  transform: translateY(-1px);
}
.dept-card-accent { width: 4px; flex: 0 0 4px; background: var(--accent); }
.dept-card-body { flex: 1; padding: 12px 16px 14px; min-width: 0; }

.dept-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f1f3;
}
.dept-name-wrap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dept-name {
  font-size: 15px;
  font-weight: 600;
  color: #181d26;
  line-height: 1.3;
}
.dept-depth-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 2px 7px;
  background: #f0f1f3;
  color: #6b7280;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.dept-quick-actions {
  display: flex; gap: 4px;
  opacity: 0.6;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.dept-card:hover .dept-quick-actions { opacity: 1; }
.btn-quick {
  background: white; border: 1px solid #dddddd;
  padding: 4px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 500;
  cursor: pointer; color: #41454d;
  white-space: nowrap;
  transition: all 0.1s;
}
.btn-quick:hover { background: #181d26; color: white; border-color: #181d26; }
.btn-quick-add { color: #0a2e0e; border-color: #c8d8c9; }
.btn-quick-add:hover { background: #0a2e0e; color: white; border-color: #0a2e0e; }

/* ── 3-row layout inside card ────────────────────────────── */
.dept-rows { display: flex; flex-direction: column; gap: 6px; }
.dept-info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
  min-height: 24px;
}
.info-ico { font-size: 14px; flex-shrink: 0; width: 22px; text-align: center; }
.info-label {
  font-weight: 500;
  color: #41454d;
  font-size: 12px;
  min-width: 96px;
  flex-shrink: 0;
}
.info-name {
  font-weight: 500;
  color: #181d26;
  font-size: 13px;
}
.info-empty {
  color: #9297a0;
  font-style: italic;
  font-size: 12px;
}
.info-count {
  font-weight: 600;
  color: #181d26;
  font-size: 13px;
  background: #f0f1f3;
  padding: 2px 10px;
  border-radius: 9999px;
  min-width: 28px;
  text-align: center;
}
.dept-info-row-members { gap: 8px; }
.btn-expand-members {
  background: white;
  border: 1px solid #dddddd;
  color: #41454d;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  margin-left: 4px;
}
.btn-expand-members:hover { background: #181d26; color: white; border-color: #181d26; }

/* Inline member list (expanded under +/- button) */
.inline-member-list {
  list-style: none;
  padding: 6px 0 0 30px;
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px dashed #e0e2e6;
  margin-top: 6px;
}
.inline-member {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: #f8fafc;
  border-radius: 6px;
}
.inline-member-empty {
  font-size: 11px;
  color: #9297a0;
  font-style: italic;
  padding: 6px 8px;
}
.inline-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.inline-info { min-width: 0; flex: 1; }
.inline-name { font-size: 12px; font-weight: 500; color: #181d26; line-height: 1.2; }
.inline-email { font-size: 10px; color: #9297a0; line-height: 1.2; }

/* ── ORG CHART VIEW (vertical visual) ──────────────────── */
.org-chart {
  background: #f8fafc;
  border: 1px solid #dddddd;
  border-radius: 12px;
  padding: 32px 16px;
  overflow-x: auto;
}
.org-canvas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  min-width: 100%;
}
.org-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}
.org-card-wrap {
  min-width: 280px;
  max-width: 320px;
}
.org-connector-down {
  width: 2px;
  height: 24px;
  background: #9297a0;
}
.org-children {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.org-children-row {
  display: flex;
  gap: 28px;
  position: relative;
  padding-top: 0;
}
.org-children-row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  width: calc(100% - 280px);
  height: 2px;
  background: #9297a0;
  transform: translateX(-50%);
}
.org-children-row:has(> :only-child)::before { display: none; }
.org-child-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}
.org-connector-up {
  width: 2px;
  height: 24px;
  background: #9297a0;
}

/* Loading & empty */
.loading-state { display: flex; flex-direction: column; gap: 8px; }
.skel-card { height: 110px; background: linear-gradient(90deg, #f0f1f3 0%, #e0e2e6 50%, #f0f1f3 100%); background-size: 200% 100%; border-radius: 10px; animation: skel 1.4s ease-in-out infinite; }
@keyframes skel { 0%, 100% { background-position: 0% 0%; } 50% { background-position: -200% 0%; } }
.empty-state {
  background: #f8fafc; border: 2px dashed #dddddd; border-radius: 12px;
  padding: 64px 24px; text-align: center;
}
.empty-icon { font-size: 48px; margin-bottom: 16px; }
.empty-state h3 { font-size: 20px; font-weight: 500; margin: 0 0 8px; color: #181d26; }
.empty-state p { font-size: 13px; color: #41454d; margin: 0 0 24px; }

/* Buttons */
.btn-primary {
  background: #181d26; color: white; border: 0;
  padding: 9px 16px; border-radius: 10px;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: background 0.1s;
}
.btn-primary:hover { background: #0d1218; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-icon { font-size: 16px; }
.btn-ghost {
  background: white; border: 1px solid #dddddd;
  padding: 9px 16px; border-radius: 10px;
  font-size: 13px; font-weight: 500;
  cursor: pointer; color: #41454d;
}
.btn-ghost:hover { background: #f8fafc; }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(24, 29, 38, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}
.modal-card {
  background: white; border-radius: 14px;
  width: 440px; max-width: 92vw; overflow: hidden;
  box-shadow: 0 24px 60px rgba(24,29,38,0.25);
}
.modal-head {
  padding: 18px 22px 14px;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid #f0f1f3;
}
.modal-head h3 { margin: 0; font-size: 16px; font-weight: 500; color: #181d26; }
.modal-close {
  background: none; border: 0; font-size: 22px; color: #9297a0;
  cursor: pointer; width: 30px; height: 30px;
  border-radius: 6px; line-height: 1;
}
.modal-close:hover { background: #f0f1f3; color: #181d26; }
.modal-body { padding: 18px 22px; }
.modal-foot {
  padding: 14px 22px 18px;
  display: flex; justify-content: flex-end; gap: 8px;
  border-top: 1px solid #f0f1f3;
  background: #f8fafc;
}
.parent-hint {
  font-size: 12px; color: #41454d; margin: 0 0 14px;
  padding: 8px 12px; background: #fdf3df;
  border-radius: 6px; border-left: 3px solid #d9a441;
}
.hint-label { font-weight: 500; margin-right: 6px; }
.form-label {
  display: block; font-size: 11px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.5px;
  color: #41454d; margin-bottom: 6px;
}
.form-input {
  width: 100%; padding: 9px 12px;
  border: 1px solid #dddddd; border-radius: 6px;
  font-size: 13px; font-family: inherit;
  color: #181d26; background: white;
}
.form-input:focus { outline: none; border-color: #181d26; box-shadow: 0 0 0 3px rgba(24,29,38,0.08); }
.form-error { color: #aa2d00; font-size: 12px; margin: 12px 0 0; padding: 8px 10px; background: #fbe6dc; border-radius: 6px; }

.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.15s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>
