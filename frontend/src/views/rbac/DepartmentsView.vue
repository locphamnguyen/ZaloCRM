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

    <!-- TREE VIEW (compact indented) -->
    <section v-else-if="viewMode === 'tree'" class="tree-view">
      <DeptTreeNode
        v-for="node in filteredTree"
        :key="node.id"
        :node="node"
        :user-name-map="userNameMap"
        :depth="0"
        :expanded-ids="expandedIds"
        @toggle="toggleNode"
        @add-child="openCreate"
        @rename="renameNode"
        @archive="archiveNode"
        @assign-member="openAssign"
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
          @add-child="openCreate"
          @rename="renameNode"
          @archive="archiveNode"
          @assign-member="openAssign"
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

    <!-- Assign member modal -->
    <Transition name="modal-fade">
      <div v-if="showAssign" class="modal-backdrop" @click.self="closeAssign">
        <div class="modal-card modal-card-lg">
          <header class="modal-head">
            <h3>Gán nhân viên · <strong>{{ assignTargetName }}</strong></h3>
            <button class="modal-close" @click="closeAssign">×</button>
          </header>
          <div class="modal-body">
            <label class="form-label">Chọn nhân viên</label>
            <select v-model="assignUserId" class="form-input">
              <option value="">-- Chọn user --</option>
              <option v-for="u in availableUsers" :key="u.id" :value="u.id">{{ u.fullName }} ({{ u.email }})</option>
            </select>
            <label class="form-label form-label-mt">Vai trò trong phòng</label>
            <div class="role-picker">
              <button v-for="r in ROLES" :key="r.value" type="button" class="role-btn" :class="{ active: assignRole === r.value }" @click="assignRole = r.value">
                <span class="role-icon">{{ r.icon }}</span>
                <div class="role-text"><strong>{{ r.label }}</strong><small>{{ r.hint }}</small></div>
              </button>
            </div>
            <p v-if="assignError" class="form-error">{{ assignError }}</p>
          </div>
          <footer class="modal-foot">
            <button class="btn-ghost" @click="closeAssign">Hủy</button>
            <button class="btn-primary" :disabled="!assignUserId" @click="submitAssign">Gán</button>
          </footer>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h, type Component, reactive } from 'vue';
import { useRbacStore, type DepartmentNode } from '@/stores/rbac';
import { api } from '@/api/index';

const store = useRbacStore();
interface UserBrief { id: string; email: string; fullName: string; }
const allUsers = ref<UserBrief[]>([]);
const viewMode = ref<'tree' | 'org'>('tree');
const searchQ = ref('');
const expandedIds = reactive(new Set<string>());

onMounted(async () => {
  await Promise.all([
    store.loadDepartments(),
    api.get('/rbac/users').then((r) => { allUsers.value = r.data.users ?? []; }).catch(() => {}),
  ]);
  // Auto-expand all root nodes
  for (const n of store.departments) expandedIds.add(n.id);
});

const userNameMap = computed(() => {
  const m = new Map<string, string>();
  for (const u of allUsers.value) m.set(u.id, u.fullName || u.email);
  return m;
});

// Filter tree by search query (keep ancestors when child matches)
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
  // Auto-expand all when searching
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

async function renameNode(node: DepartmentNode) {
  const newN = prompt('Đổi tên phòng ban', node.name);
  if (newN && newN.trim() && newN !== node.name) {
    try { await store.renameDepartment(node.id, newN.trim()); }
    catch (e: any) { alert(e?.response?.data?.error || 'Lỗi đổi tên'); }
  }
}
async function archiveNode(node: DepartmentNode) {
  if (!confirm(`Xóa "${node.name}"? Phòng phải rỗng (không còn thành viên, không còn phòng con).`)) return;
  try { await store.archiveDepartment(node.id); }
  catch (e: any) { alert(e?.response?.data?.error || 'Lỗi xóa'); }
}

const showAssign = ref(false);
const assignTargetDeptId = ref<string | null>(null);
const assignTargetName = ref('');
const assignUserId = ref('');
const assignRole = ref<'leader' | 'deputy' | 'member'>('member');
const assignError = ref('');

const ROLES = [
  { value: 'leader' as const, label: 'Trưởng phòng', icon: '👑', hint: 'Quản lý toàn dept + dept con' },
  { value: 'deputy' as const, label: 'Phó phòng', icon: '🎖️', hint: 'Cùng quyền trưởng' },
  { value: 'member' as const, label: 'Nhân viên', icon: '👤', hint: 'Member thường' },
];

const availableUsers = computed(() => allUsers.value);

function openAssign(node: DepartmentNode) {
  assignTargetDeptId.value = node.id;
  assignTargetName.value = node.name;
  assignUserId.value = '';
  assignRole.value = 'member';
  assignError.value = '';
  showAssign.value = true;
}
function closeAssign() { showAssign.value = false; }
async function submitAssign() {
  if (!assignUserId.value || !assignTargetDeptId.value) return;
  try {
    await store.assignMember(assignTargetDeptId.value, assignUserId.value, assignRole.value);
    showAssign.value = false;
  } catch (e: any) { assignError.value = e?.response?.data?.error || 'Lỗi gán'; }
}

// ────────── TREE VIEW NODE (indented collapsible) ──────────
const DeptTreeNode: Component = {
  name: 'DeptTreeNode',
  props: ['node', 'userNameMap', 'depth', 'expandedIds'],
  emits: ['toggle', 'add-child', 'rename', 'archive', 'assign-member'],
  setup(props, { emit }) {
    return () => {
      const node: DepartmentNode = props.node;
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isExpanded = props.expandedIds.has(node.id);
      const leaderName = node.leaderUserId ? props.userNameMap.get(node.leaderUserId) : null;
      const deputyName = node.deputyUserId ? props.userNameMap.get(node.deputyUserId) : null;
      const accentColor = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(node.depth, 4)];

      const row = h('div', { class: 'tree-row', style: { '--depth': props.depth, '--accent': accentColor } }, [
        h('div', { class: 'tree-row-left' }, [
          ...Array.from({ length: props.depth }, (_, i) =>
            h('span', { class: 'tree-indent', key: `i-${i}` })
          ),
          h('button', {
            class: ['tree-toggle', { invisible: !hasChildren }],
            onClick: () => hasChildren && emit('toggle', node.id),
          }, [hasChildren ? (isExpanded ? '▾' : '▸') : '·']),
          h('div', { class: 'tree-accent-strip' }),
          h('div', { class: 'tree-node-content' }, [
            h('div', { class: 'tree-node-head' }, [
              h('span', { class: 'tree-name' }, node.name),
              h('div', { class: 'tree-pills' }, [
                h('span', { class: 'pill pill-members' }, [
                  h('span', { class: 'pill-ico' }, '👥'),
                  h('span', String(node.memberCount)),
                ]),
                leaderName
                  ? h('span', { class: 'pill pill-leader' }, [
                      h('span', { class: 'pill-ico' }, '👑'),
                      leaderName,
                    ])
                  : h('span', { class: 'pill pill-empty' }, 'Chưa có trưởng'),
                deputyName
                  ? h('span', { class: 'pill pill-deputy' }, [
                      h('span', { class: 'pill-ico' }, '🎖️'),
                      deputyName,
                    ])
                  : null,
              ].filter(Boolean)),
            ]),
          ]),
        ]),
        h('div', { class: 'tree-row-actions' }, [
          h('button', { class: 'btn-icon-action btn-primary-sm', onClick: () => emit('assign-member', node), title: 'Gán nhân viên' }, '👤+'),
          h('button', { class: 'btn-icon-action', onClick: () => emit('add-child', node), title: 'Thêm phòng con' }, '+ Con'),
          h('button', { class: 'btn-icon-action', onClick: () => emit('rename', node), title: 'Đổi tên' }, '✎'),
          h('button', { class: 'btn-icon-action btn-danger-sm', onClick: () => emit('archive', node), title: 'Xóa' }, '×'),
        ]),
      ]);

      const children = isExpanded && hasChildren
        ? node.children!.map((c: DepartmentNode) =>
            h(DeptTreeNode as any, {
              key: c.id, node: c, userNameMap: props.userNameMap, depth: props.depth + 1, expandedIds: props.expandedIds,
              onToggle: (id: string) => emit('toggle', id),
              onAddChild: (n: DepartmentNode) => emit('add-child', n),
              onRename: (n: DepartmentNode) => emit('rename', n),
              onArchive: (n: DepartmentNode) => emit('archive', n),
              onAssignMember: (n: DepartmentNode) => emit('assign-member', n),
            }))
        : null;

      return h('div', { class: 'tree-group' }, [row, children]);
    };
  },
};

// ────────── ORG CHART NODE (vertical chart visual) ──────────
const OrgChartNode: Component = {
  name: 'OrgChartNode',
  props: ['node', 'userNameMap'],
  emits: ['add-child', 'rename', 'archive', 'assign-member'],
  setup(props, { emit }) {
    return () => {
      const node: DepartmentNode = props.node;
      const leaderName = node.leaderUserId ? props.userNameMap.get(node.leaderUserId) : null;
      const deputyName = node.deputyUserId ? props.userNameMap.get(node.deputyUserId) : null;
      const accentColor = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(node.depth, 4)];
      const hasChildren = (node.children?.length ?? 0) > 0;

      return h('div', { class: 'org-node' }, [
        h('div', { class: 'org-card', style: { '--accent': accentColor } }, [
          h('div', { class: 'org-card-accent' }),
          h('div', { class: 'org-card-body' }, [
            h('div', { class: 'org-card-name' }, node.name),
            h('div', { class: 'org-card-meta' }, [
              h('span', { class: 'org-meta-item' }, [`👥 ${node.memberCount}`]),
              leaderName ? h('span', { class: 'org-meta-item' }, [`👑 ${leaderName}`]) : null,
              deputyName ? h('span', { class: 'org-meta-item' }, [`🎖️ ${deputyName}`]) : null,
            ].filter(Boolean)),
            h('div', { class: 'org-card-actions' }, [
              h('button', { class: 'btn-icon-action btn-primary-sm', onClick: () => emit('assign-member', node) }, '👤+'),
              h('button', { class: 'btn-icon-action', onClick: () => emit('add-child', node) }, '+'),
              h('button', { class: 'btn-icon-action', onClick: () => emit('rename', node) }, '✎'),
              h('button', { class: 'btn-icon-action btn-danger-sm', onClick: () => emit('archive', node) }, '×'),
            ]),
          ]),
        ]),
        hasChildren
          ? h('div', { class: 'org-children' }, [
              h('div', { class: 'org-connector-down' }),
              h('div', { class: 'org-children-row' }, node.children!.map((c: DepartmentNode) =>
                h('div', { class: 'org-child-wrap', key: c.id }, [
                  h('div', { class: 'org-connector-up' }),
                  h(OrgChartNode as any, {
                    node: c, userNameMap: props.userNameMap,
                    onAddChild: (n: DepartmentNode) => emit('add-child', n),
                    onRename: (n: DepartmentNode) => emit('rename', n),
                    onArchive: (n: DepartmentNode) => emit('archive', n),
                    onAssignMember: (n: DepartmentNode) => emit('assign-member', n),
                  }),
                ]),
              )),
            ])
          : null,
      ].filter(Boolean));
    };
  },
};
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

/* ── TREE VIEW (indented) ────────────────────────────────── */
.tree-view {
  background: white;
  border: 1px solid #dddddd;
  border-radius: 12px;
  overflow: hidden;
}
.tree-group { display: block; }
.tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 10px calc(12px + var(--depth, 0) * 28px);
  gap: 12px;
  position: relative;
  border-bottom: 1px solid #f0f1f3;
  background: white;
  transition: background 0.1s;
}
.tree-row:hover { background: #f8fafc; }
.tree-row:last-child { border-bottom: 0; }
.tree-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.tree-indent {
  width: 2px;
  height: 24px;
  background: #dddddd;
  margin-right: 26px;
  flex-shrink: 0;
}
.tree-toggle {
  background: none; border: 0; font-size: 12px;
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #9297a0;
  border-radius: 4px;
  flex-shrink: 0;
}
.tree-toggle:hover:not(.invisible) { background: #f0f1f3; color: #181d26; }
.tree-toggle.invisible { cursor: default; color: #cccccc; }
.tree-accent-strip {
  width: 4px;
  height: 28px;
  background: var(--accent);
  border-radius: 2px;
  flex-shrink: 0;
}
.tree-node-content { flex: 1; min-width: 0; }
.tree-node-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tree-name { font-size: 14px; font-weight: 500; color: #181d26; }
.tree-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.pill {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 500;
  padding: 3px 8px; border-radius: 9999px;
  background: #f0f1f3; color: #41454d;
}
.pill-ico { font-size: 11px; }
.pill-members { background: #e0e2e6; color: #181d26; }
.pill-leader { background: #fdf3df; color: #7a5818; }
.pill-deputy { background: #e3ede4; color: #0a2e0e; }
.pill-empty { background: transparent; color: #9297a0; font-style: italic; }
.tree-row-actions {
  display: flex; gap: 4px;
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity 0.15s;
}
.tree-row:hover .tree-row-actions { opacity: 1; }
.btn-icon-action {
  background: white; border: 1px solid #dddddd;
  padding: 4px 8px; border-radius: 6px;
  font-size: 12px; font-weight: 500;
  cursor: pointer; color: #41454d;
  min-width: 28px;
}
.btn-icon-action:hover { background: #f8fafc; border-color: #9297a0; }
.btn-primary-sm { background: #181d26; color: white; border-color: #181d26; }
.btn-primary-sm:hover { background: #0d1218; }
.btn-danger-sm { color: #aa2d00; border-color: #fbe6dc; }
.btn-danger-sm:hover { background: #fbe6dc; }

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
.org-card {
  background: white;
  border-radius: 10px;
  border: 1px solid #dddddd;
  min-width: 220px;
  max-width: 280px;
  display: flex;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(24,29,38,0.06);
  transition: all 0.15s;
}
.org-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(24,29,38,0.1); }
.org-card-accent { width: 4px; flex: 0 0 4px; background: var(--accent); }
.org-card-body { flex: 1; padding: 12px 14px; min-width: 0; }
.org-card-name { font-size: 14px; font-weight: 500; color: #181d26; margin-bottom: 6px; }
.org-card-meta {
  display: flex; gap: 8px; flex-wrap: wrap;
  font-size: 11px; color: #41454d;
  margin-bottom: 8px;
}
.org-meta-item {
  background: #f0f1f3;
  padding: 2px 8px;
  border-radius: 9999px;
  white-space: nowrap;
}
.org-card-actions {
  display: flex; gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.org-card:hover .org-card-actions { opacity: 1; }

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
  gap: 24px;
  position: relative;
  padding-top: 0;
}
.org-children-row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  width: 100%;
  max-width: calc(100% - 220px);
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
.skel-card { height: 60px; background: linear-gradient(90deg, #f0f1f3 0%, #e0e2e6 50%, #f0f1f3 100%); background-size: 200% 100%; border-radius: 8px; animation: skel 1.4s ease-in-out infinite; }
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
.modal-card-lg { width: 520px; }
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
.form-label-mt { margin-top: 14px; }
.form-input {
  width: 100%; padding: 9px 12px;
  border: 1px solid #dddddd; border-radius: 6px;
  font-size: 13px; font-family: inherit;
  color: #181d26; background: white;
}
.form-input:focus { outline: none; border-color: #181d26; box-shadow: 0 0 0 3px rgba(24,29,38,0.08); }
.form-error { color: #aa2d00; font-size: 12px; margin: 12px 0 0; padding: 8px 10px; background: #fbe6dc; border-radius: 6px; }

/* Role picker */
.role-picker { display: flex; flex-direction: column; gap: 6px; }
.role-btn {
  background: white; border: 1px solid #dddddd;
  border-radius: 8px; padding: 10px 14px;
  display: flex; align-items: center; gap: 12px;
  cursor: pointer; text-align: left;
  transition: all 0.1s;
}
.role-btn:hover { background: #f8fafc; }
.role-btn.active { border-color: #181d26; background: #181d26; color: white; }
.role-btn.active .role-icon { background: white; color: #181d26; }
.role-icon {
  font-size: 16px; width: 32px; height: 32px;
  border-radius: 8px; background: #f0f1f3;
  display: flex; align-items: center; justify-content: center;
}
.role-text { display: flex; flex-direction: column; gap: 1px; }
.role-text strong { font-size: 13px; font-weight: 500; }
.role-text small { font-size: 10px; opacity: 0.7; }

.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.15s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>
