<template>
  <MobileContactView v-if="isMobile" />
  <div v-else class="smax-contacts-page">
    <!-- ════════ Page header ════════ -->
    <header class="page-header">
      <h1>Khách hàng</h1>
      <div class="subtitle">
        Tổng hợp toàn bộ KH đã kết bạn / đã gửi mời / đang nhắn tin / import vào hệ thống.
        KEY chính = <strong>SĐT</strong>. Click ▸ để xem chi tiết các nick chăm KH này.
      </div>
      <div class="legend">
        <span class="legend-item"><span class="dot" style="background:var(--smax-success)"></span> Đã KB</span>
        <span class="legend-item"><span class="dot" style="background:var(--smax-warning)"></span> Đã gửi mời</span>
        <span class="legend-item"><span class="dot" style="background:var(--smax-info)"></span> Đang nhắn (lạ)</span>
        <span class="legend-item"><span class="dot" style="background:#9e9e9e"></span> Đã ngắt / từ chối</span>
        <span class="legend-item">·</span>
        <span class="legend-item">🏆 = winner-nick (data master row pull từ row này)</span>
      </div>
    </header>

    <!-- ════════ Toolbar ════════ -->
    <!-- ════════ Toolbar Row 1: search + 4 filter chính + actions ════════ -->
    <div class="toolbar toolbar-primary">
      <input
        v-model="filters.search"
        class="toolbar-search"
        placeholder="🔍 Tìm tên / SĐT / UID / @username / globalId…"
        @input="debouncedFetch"
      />
      <select v-model="filters.threadType" @change="fetchContacts" title="Loại hội thoại">
        <option value="">Loại: tất cả</option>
        <option value="user">👤 User 1-1</option>
        <option value="group">👥 Nhóm</option>
      </select>
      <select v-model="filters.source" @change="fetchContacts" title="Nguồn KH">
        <option value="">Tất cả nguồn</option>
        <option v-for="o in SOURCE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
      <select v-model="filters.statusId" @change="fetchContacts" title="Trạng thái KH (dynamic)">
        <option value="">Tất cả trạng thái KH</option>
        <option v-for="s in allMasterStatuses" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <select v-model="filters.assignedUserId" @change="fetchContacts" title="Sale phụ trách KH">
        <option value="">Tất cả sale</option>
        <option v-for="u in allUsers" :key="u.id" :value="u.id">{{ u.fullName }}</option>
      </select>

      <span class="spacer"></span>

      <button class="btn" @click="showDuplicateDialog = true">
        ⊜ Trùng lặp
        <span v-if="duplicateTotal > 0" class="btn-badge">{{ duplicateTotal }}</span>
      </button>
      <button class="btn" @click="showCandidateDialog = true">
        💡 Gợi ý KH Cha
        <span v-if="candidateCount > 0" class="btn-badge">{{ candidateCount }}</span>
      </button>
      <button class="btn">⬇ Xuất</button>
      <v-menu :close-on-content-click="false">
        <template #activator="{ props: act }">
          <button v-bind="act" class="btn" title="Bật/tắt cột tuỳ chọn">⚙ Cột</button>
        </template>
        <v-list density="compact" min-width="320">
          <v-list-subheader>Cột KH Cha — aggregate</v-list-subheader>
          <v-list-item v-for="c in OPTIONAL_COLUMNS" :key="c.key" @click="toggleColumn(c.key)">
            <template #prepend>
              <v-icon size="18" :color="visibleCols[c.key] ? 'primary' : ''">
                {{ visibleCols[c.key] ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
              </v-icon>
            </template>
            <v-list-item-title>{{ c.label }}</v-list-item-title>
            <v-list-item-subtitle v-if="c.hint" class="text-caption">{{ c.hint }}</v-list-item-subtitle>
          </v-list-item>
          <v-divider class="my-1" />
          <v-list-subheader>Cột KH Con — per-Friend (mở ▸ để xem)</v-list-subheader>
          <v-list-item v-for="c in CHILD_OPTIONAL_COLUMNS" :key="c.key" @click="toggleChildColumn(c.key)">
            <template #prepend>
              <v-icon size="18" :color="visibleChildCols[c.key] ? 'primary' : ''">
                {{ visibleChildCols[c.key] ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
              </v-icon>
            </template>
            <v-list-item-title>{{ c.label }}</v-list-item-title>
            <v-list-item-subtitle v-if="c.hint" class="text-caption">{{ c.hint }}</v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </v-menu>
      <button class="btn btn-primary" @click="openCreate">+ Thêm KH</button>
    </div>

    <!-- ════════ Toolbar Row 2: date range + advanced filter toggle ════════ -->
    <div class="toolbar toolbar-secondary">
      <span class="row2-label">📅 Tương tác:</span>
      <input type="date" v-model="filters.dateFrom" class="date-input" @change="fetchContacts" />
      <span class="date-separator">→</span>
      <input type="date" v-model="filters.dateTo" class="date-input" @change="fetchContacts" />
      <button class="btn-advanced" :class="{ on: showAdvanced }" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '▾' : '▸' }} Lọc nâng cao
        <span v-if="advancedActiveCount > 0" class="btn-badge">{{ advancedActiveCount }}</span>
      </button>
      <span class="spacer"></span>
      <button v-if="hasAnyFilter" class="btn-clear" @click="clearAllFilters" title="Xoá tất cả bộ lọc">
        × Xoá lọc
      </button>
    </div>

    <!-- Advanced filter panel (collapsible) -->
    <div v-if="showAdvanced" class="advanced-panel">
      <div class="adv-group">
        <label>Trạng thái Zalo</label>
        <select v-model="filters.hasZalo" @change="fetchContacts">
          <option value="">Tất cả</option>
          <option value="true">✓ Có Zalo</option>
          <option value="false">✗ Không có Zalo</option>
          <option value="unknown">? Chưa tra</option>
        </select>
      </div>
      <div class="adv-group">
        <label>Trạng thái KB Zalo (per-nick)</label>
        <select v-model="filters.relationshipKindAny" @change="fetchContacts">
          <option value="">Tất cả</option>
          <option value="friend">✓ Đã KB</option>
          <option value="pending_friend">… Đang mời</option>
          <option value="chatting_stranger">💬 Chat lạ</option>
          <option value="ghost">🚫 Ngắt</option>
        </select>
      </div>
      <div class="adv-group">
        <label>Đa nick chăm</label>
        <select v-model="filters.multiNick" @change="fetchContacts">
          <option value="">Tất cả</option>
          <option value="true">≥ 2 nick chăm</option>
        </select>
      </div>
      <div class="adv-group">
        <label>Lead score</label>
        <input type="number" v-model.number="filters.scoreMin" min="0" max="100" placeholder="Min" class="score-input-mini" @change="fetchContacts" />
        <span class="dash">—</span>
        <input type="number" v-model.number="filters.scoreMax" min="0" max="100" placeholder="Max" class="score-input-mini" @change="fetchContacts" />
      </div>
    </div>

    <!-- ════════ Stats row ════════ -->
    <div class="stats-row">
      <div class="stat-box">📋 Tổng KH: <span class="stat-num">{{ stats.total ?? total }}</span></div>
      <div class="stat-box">🟢 Có nick chăm: <span class="stat-num">{{ stats.withNick }}</span></div>
      <div class="stat-box">🔥 Tương tác 7d: <span class="stat-num">{{ stats.activeRecently ?? 0 }}</span></div>
      <div class="stat-box">🆕 Mới hôm nay: <span class="stat-num">{{ stats.newToday ?? 0 }}</span></div>
      <div class="stat-box">📅 Lịch hẹn ≤7d: <span class="stat-num">{{ stats.upcomingApt ?? 0 }}</span></div>
      <div class="stat-box">⭐ Score ≥50: <span class="stat-num">{{ stats.highScore ?? 0 }}</span></div>
      <div class="stat-box">⚠ Đa nick (≥3): <span class="stat-num">{{ stats.multiClaim }}</span></div>
      <div class="stat-box">🚫 Revoked: <span class="stat-num">{{ stats.revoked }}</span></div>
      <div class="stat-box">📵 No Zalo: <span class="stat-num">{{ stats.noZalo }}</span></div>
    </div>

    <!-- ════════ Master/child table ════════ -->
    <div class="scroll-wrap">
      <table class="smax-table">
        <thead>
          <tr>
            <th class="w-32"></th>
            <th class="w-40"></th>
            <th class="w-200">Tên CRM / Zalo (KH)</th>
            <th class="w-110">SĐT</th>
            <th class="w-70">Giới tính</th>
            <th class="w-100">Tỉnh/Quận</th>
            <th class="w-80">Nguồn</th>
            <th class="w-100">Trạng thái KH</th>
            <th class="w-60">Score</th>
            <th class="w-180">Nick chăm</th>
            <th class="w-130">Sale chính</th>
            <th class="w-170">KH nhắn cuối</th>
            <th class="w-170">Sale nhắn cuối</th>
            <th class="w-80">Tin in/out</th>
            <th class="w-110">Tags CRM</th>
            <th class="w-70">Có Zalo?</th>
            <th v-if="visibleCols.zaloUid" class="w-120" title="Zalo UID per-account chính (cũ nhất)">Zalo UID</th>
            <th v-if="visibleCols.zaloGlobalId" class="w-130" title="Zalo globalId toàn cục (dedup cross-account)">Global ID</th>
            <th v-if="visibleCols.zaloUsername" class="w-130" title="Zalo username (handle t_xxx)">Username</th>
            <th v-if="visibleCols.lookupState" class="w-100" title="Trạng thái tra Zalo qua SĐT">Lookup</th>
            <th class="w-130">Action</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="contact in contacts" :key="contact.id">
            <tr
              class="master-row"
              :class="{ open: expandedId === contact.id }"
              @click="onRowClick($event, contact.id)"
            >
              <td>
                <button class="expand-btn" @click.stop="toggleExpand(contact.id)">
                  {{ expandedId === contact.id ? '▾' : '▸' }}
                </button>
              </td>
              <td>
                <Avatar
                  :src="contact.avatarUrl"
                  :name="contact.crmName || contact.fullName || '?'"
                  :size="32"
                  :gender="contact.gender"
                  :gradient-seed="contact.id"
                />
              </td>
              <td>
                <div class="name-text">
                  {{ contact.crmName || contact.fullName || '—' }}
                  <span
                    v-if="(contact._count?.conversations || 0) > 1"
                    class="chip chip-multi-nick"
                    :title="`${contact._count?.conversations} nick CRM đang chăm khách này`"
                  >
                    👥 Đa nick ({{ contact._count?.conversations }})
                  </span>
                </div>
                <div v-if="contact.fullName && contact.crmName && contact.fullName !== contact.crmName" class="name-sub">
                  {{ contact.fullName }}
                </div>
              </td>
              <td>{{ contact.phone || '—' }}</td>
              <td>
                <template v-if="contact.gender">
                  {{ genderLabel(contact.gender) }}
                  <template v-if="ageOf(contact)">· {{ ageOf(contact) }}t</template>
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <template v-if="contact.province || contact.district">
                  {{ [contact.province, contact.district].filter(Boolean).join(' / ') }}
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <span v-if="contact.source" class="chip chip-grey">{{ sourceLabel(contact.source) }}</span>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <!-- Status chip dùng displayStatus aggregate (Cha = MAX order của Con). Color từ Status table. -->
                <span
                  v-if="contact.displayStatus"
                  class="chip"
                  :style="{ background: chipBg(contact.displayStatus.color), color: chipFg(contact.displayStatus.color) }"
                  :title="contact.childrenCount && contact.childrenCount > 0 ? `Aggregate từ ${contact.childrenCount} KH con` : ''"
                >
                  {{ contact.displayStatus.name }}
                </span>
                <span v-else-if="contact.status" :class="['chip', statusChipClass(contact.status)]">{{ statusLabel(contact.status) }}</span>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <span :class="['chip', scoreChipClass(contact.displayLeadScore ?? contact.leadScore)]">
                  {{ Math.round(contact.displayLeadScore ?? contact.leadScore ?? 0) }}
                </span>
              </td>
              <td>
                <!-- Nick chăm: 4 chip count theo trạng thái KB -->
                <div class="nick-count-row">
                  <span v-for="b in nickCountChips(contact)" :key="b.kind" :class="['chip', b.cls]" :title="b.title">
                    {{ b.icon }} {{ b.count }}
                  </span>
                </div>
              </td>
              <td>{{ contact.assignedUser?.fullName || '—' }}</td>
              <td>
                <template v-if="contact.lastInboundAt">
                  <div class="cell-strong">{{ formatRecentDateTime(contact.lastInboundAt) }}</div>
                  <div class="cell-preview" :title="contact.lastInboundPreview || ''">
                    {{ messagePreview(contact.lastInboundPreview, contact.lastInboundType ?? null) }}
                  </div>
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <template v-if="contact.lastOutboundAt">
                  <div class="cell-strong">{{ formatRecentDateTime(contact.lastOutboundAt) }}</div>
                  <div class="cell-preview" :title="contact.lastOutboundPreview || ''">
                    {{ messagePreview(contact.lastOutboundPreview, contact.lastOutboundType ?? null) }}
                  </div>
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <strong>{{ contact.totalInbound ?? 0 }}</strong> / {{ contact.totalOutbound ?? 0 }}
              </td>
              <td>
                <div class="tag-cell">
                  <span v-for="tag in (contact.tags || []).slice(0, 2)" :key="tag" class="chip chip-grey">{{ tag }}</span>
                  <span v-if="(contact.tags || []).length > 2" class="chip chip-grey">
                    +{{ contact.tags.length - 2 }}
                  </span>
                </div>
              </td>
              <td>
                <span v-if="contact.hasZalo === true" class="chip chip-success">Có</span>
                <span v-else-if="contact.hasZalo === false" class="chip chip-grey">Không</span>
                <span v-else class="empty">?</span>
              </td>
              <td v-if="visibleCols.zaloUid" :title="'Per-account UID khác nhau theo nick. Mở ▸ xem chi tiết per row con.'">
                <span v-if="(contact.childrenCount ?? 0) > 1" class="chip chip-multi" title="Đa Zalo identity — mỗi nick có UID riêng">đa {{ contact.childrenCount }} con</span>
                <code v-else-if="contact.zaloUid" class="uid-cell">{{ contact.zaloUid }}</code>
                <span v-else class="empty">—</span>
              </td>
              <td v-if="visibleCols.zaloGlobalId">
                <span v-if="(contact.distinctGlobalIdCount ?? 0) > 1" class="chip chip-multi" title="Đa Zalo identity (globalId khác nhau giữa các nick)">đa {{ contact.distinctGlobalIdCount }} identity</span>
                <code v-else-if="contact.aggregateZaloGlobalId" class="uid-cell" :title="contact.aggregateZaloGlobalId">{{ contact.aggregateZaloGlobalId.slice(0, 12) }}…</code>
                <span v-else class="empty">—</span>
              </td>
              <td v-if="visibleCols.zaloUsername">
                <span v-if="(contact.distinctUsernameCount ?? 0) > 1" class="chip chip-multi">đa {{ contact.distinctUsernameCount }} username</span>
                <span v-else-if="contact.aggregateZaloUsername" class="uid-cell">@{{ contact.aggregateZaloUsername }}</span>
                <span v-else class="empty">—</span>
              </td>
              <td v-if="visibleCols.lookupState">
                <div v-if="contact.zaloLookupAt" class="two-line">
                  <span class="line1">{{ formatRecentDateTime(contact.zaloLookupAt) }}</span>
                  <span class="line2">{{ contact.zaloLookupAttempts || 0 }} attempts</span>
                </div>
                <span v-else class="empty">chưa tra</span>
              </td>
              <td>
                <div class="action-cell">
                  <button class="row-action-btn" @click="goChat(contact)" title="Mở chat">💬</button>
                  <button class="row-action-btn" @click="openDetail(contact)" title="Chi tiết">✎</button>
                  <button class="row-action-btn" @click="onAutomation(contact)" title="Automation">⚡</button>
                </div>
              </td>
            </tr>

            <!-- Child row: nick chăm (real data từ /contacts/:id/friendships) -->
            <tr v-if="expandedId === contact.id" class="child-wrap">
              <td :colspan="totalColumnsCount">
                <div class="child-table-wrap">
                  <div v-if="friendshipLoading[contact.id]" class="child-empty">Đang tải…</div>
                  <table v-else-if="childRows(contact).length" class="child-table">
                    <thead>
                      <tr>
                        <th>Nick Zalo (Sale)</th>
                        <th>Tên CRM/Nick KH</th>
                        <th>Ảnh KH</th>
                        <th>Tên Zalo + UID</th>
                        <th v-if="visibleChildCols.zaloGlobalId" title="Zalo globalId per identity (toàn cục)">Global ID</th>
                        <th v-if="visibleChildCols.zaloUsername" title="Zalo username (handle)">Username</th>
                        <th>Trạng thái KB</th>
                        <th>Trạng thái KH</th>
                        <th>Score</th>
                        <th>Nhãn CRM</th>
                        <th>Label Zalo</th>
                        <th>KH nhắn cuối</th>
                        <th>Sale nhắn cuối</th>
                        <th>In/Out</th>
                        <th>Là bạn từ</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, idx) in childRows(contact)" :key="row.id" :class="{ winner: idx === 0 }">
                        <td>
                          <div class="nick-cell">
                            <Avatar :src="row.nickAvatarUrl" :name="row.nickName" :size="26" :gradient-seed="row.id" platform="zalo" />
                            <div class="two-line">
                              <span class="line1">
                                {{ row.nickName }}
                                <span v-if="idx === 0" class="winner-badge">🏆</span>
                              </span>
                              <span class="line2">{{ row.salePhone }} · {{ row.saleName }}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span :class="['line1', { empty: !row.aliasInNick }]">
                            {{ row.aliasInNick || '— chưa đặt —' }}
                          </span>
                        </td>
                        <td>
                          <Avatar :src="row.zaloAvatarUrl || contact.avatarUrl" :name="row.zaloName || contact.fullName || '?'" :size="32" :gradient-seed="row.id" />
                        </td>
                        <td>
                          <div class="two-line">
                            <span class="line1">{{ row.zaloName || '—' }}</span>
                            <span class="uid">{{ row.zaloUid || 'chưa lấy' }}</span>
                          </div>
                        </td>
                        <td v-if="visibleChildCols.zaloGlobalId">
                          <code v-if="row.zaloGlobalId" class="uid-cell" :title="row.zaloGlobalId">{{ row.zaloGlobalId.slice(0, 10) }}…</code>
                          <span v-else class="empty">—</span>
                        </td>
                        <td v-if="visibleChildCols.zaloUsername">
                          <span v-if="row.zaloUsername" class="uid-cell">@{{ row.zaloUsername }}</span>
                          <span v-else class="empty">—</span>
                        </td>
                        <td>
                          <div class="kb-cell">
                            <span :class="['chip', kindChipClass(row.relationshipKind)]">
                              {{ kindLabel(row.relationshipKind) }}
                            </span>
                            <span
                              v-if="row.hasConversation"
                              class="chip-conv chip-conv--on"
                              title="Đã từng nhắn 1-1 với KH qua nick này"
                            >💬 đang chat</span>
                            <span
                              v-else
                              class="chip-conv chip-conv--off"
                              title="Chỉ kết bạn Zalo, chưa có hội thoại 1-1 nào"
                            >ø chỉ KB</span>
                          </div>
                        </td>
                        <td>
                          <span
                            v-if="row.statusRef"
                            class="chip status-edit-chip"
                            :style="{ background: chipBg(row.statusRef.color), color: chipFg(row.statusRef.color) }"
                            :title="'Click đổi status'"
                            @click="openFriendStatusEdit(row)"
                          >{{ row.statusRef.name }}</span>
                          <span v-else class="empty" @click="openFriendStatusEdit(row)" style="cursor:pointer">— đặt —</span>
                        </td>
                        <td>
                          <input
                            type="number"
                            class="score-input"
                            :value="row.leadScore"
                            min="0" max="100"
                            @change="onFriendScoreChange(row, ($event.target as HTMLInputElement).value)"
                            :title="'Score per-nick này. Cha = AVG.'"
                          />
                        </td>
                        <td>
                          <div class="tag-cell">
                            <span v-for="t in row.crmTagsPerNick" :key="t" class="chip chip-info">{{ t }}</span>
                            <span v-if="!row.crmTagsPerNick.length" class="empty">—</span>
                          </div>
                        </td>
                        <td>
                          <div class="tag-cell">
                            <span v-for="lbl in row.zaloLabels" :key="lbl" class="chip chip-orange-soft">{{ lbl }}</span>
                            <span v-if="!row.zaloLabels.length" class="empty">—</span>
                          </div>
                        </td>
                        <td>
                          <span v-if="row.lastInboundAt" class="cell-strong">{{ formatRecentDateTime(row.lastInboundAt) }}</span>
                          <span v-else class="empty">—</span>
                        </td>
                        <td>
                          <span v-if="row.lastOutboundAt" class="cell-strong">{{ formatRecentDateTime(row.lastOutboundAt) }}</span>
                          <span v-else class="empty">—</span>
                        </td>
                        <td><strong>{{ row.totalInbound }}</strong> / {{ row.totalOutbound }}</td>
                        <td>{{ row.becameFriendAt || '—' }}</td>
                        <td>
                          <div class="action-cell">
                            <button class="row-action-btn" @click="onChildAction('chat', row)" title="Mở chat">💬</button>
                            <button class="row-action-btn" @click="onChildAction('auto', row)" title="Automation">⚡</button>
                            <button class="row-action-btn" @click="onPromoteFriend(row)" title="Tách Con này thành KH Cha riêng">✂</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="child-empty">
                    KH này chưa có nick CRM nào chăm.
                  </div>
                </div>
              </td>
            </tr>
          </template>

          <tr v-if="!loading && !contacts.length">
            <td :colspan="totalColumnsCount" class="empty-state">Không tìm thấy KH nào khớp bộ lọc.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination">
      <button class="btn" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">← Trước</button>
      <span class="page-info">Trang {{ pagination.page }} / {{ totalPages }}</span>
      <button class="btn" :disabled="pagination.page >= totalPages" @click="changePage(pagination.page + 1)">Sau →</button>
    </div>

    <!-- Dialogs (giữ nguyên) -->
    <ContactDetailDialog v-model="showDialog" :contact="selectedContact" @saved="onSaved" @deleted="onDeleted" />
    <ParentCandidateDialog v-model="showCandidateDialog" @resolved="onCandidateResolved" />

    <!-- Friend status picker dialog (per-pair status) -->
    <div v-if="statusEditTarget" class="status-picker-overlay" @click.self="statusEditTarget = null">
      <div class="status-picker">
        <h4>Chọn trạng thái cho nick này</h4>
        <div class="status-picker-list">
          <button
            v-for="s in allStatuses"
            :key="s.id"
            class="status-picker-item"
            :class="{ active: statusEditTarget?.statusRef?.id === s.id }"
            :style="{ background: chipBg(s.color), color: chipFg(s.color) }"
            @click="applyFriendStatus(s.id)"
          >
            {{ s.name }}
            <span class="order-num">#{{ s.order }}</span>
          </button>
        </div>
        <button class="btn-close" @click="statusEditTarget = null">Đóng</button>
      </div>
    </div>
    <DuplicateReviewDialog v-model="showDuplicateDialog" @merged="onDuplicateMerged" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import ContactDetailDialog from '@/components/contacts/ContactDetailDialog.vue';
import ParentCandidateDialog from '@/components/contacts/ParentCandidateDialog.vue';
import DuplicateReviewDialog from '@/components/contacts/DuplicateReviewDialog.vue';
import type { CareStatusValue } from '@/constants/care-status';
import Avatar from '@/components/ui/Avatar.vue';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api';
import {
  useContacts, useContactIntelligence,
  SOURCE_OPTIONS, STATUS_OPTIONS, GENDER_OPTIONS,
  formatRecentDateTime, messagePreview,
} from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';
import MobileContactView from '@/views/MobileContactView.vue';
import { useMobile } from '@/composables/use-mobile';

const { isMobile } = useMobile();
const router = useRouter();

const { contacts, total, loading, filters, pagination, fetchContacts } = useContacts();
const { duplicateTotal, fetchDuplicateGroups } = useContactIntelligence();
const toast = useToast();

// ── Column toggle ───────────────────────────────────────────────────────────
// 2 LEVEL:
//  - Master (KH Cha): cột aggregate — chỉ có nghĩa khi tất cả Friend đồng nhất.
//    Show "đa N identity" khi distinctGlobalIdCount > 1.
//  - Child (KH Con / Friend row): cột per-identity — mỗi row 1 giá trị riêng.
// Persist localStorage. Default ẨN.
const OPTIONAL_COLUMNS = [
  { key: 'zaloUid',      label: 'Zalo UID (Cha)',  hint: 'KH Cha: per-account UID chính. Đa nick → mở ▸ xem row con.' },
  { key: 'zaloGlobalId', label: 'Global ID (Cha)', hint: 'KH Cha: globalId chung khi tất cả con trùng, hoặc "đa N".' },
  { key: 'zaloUsername', label: 'Username (Cha)',  hint: 'KH Cha: username chung khi trùng tất cả con.' },
  { key: 'lookupState',  label: 'Lookup',          hint: 'Trạng thái tra Zalo qua SĐT cho KH này.' },
] as const;
type OptColKey = (typeof OPTIONAL_COLUMNS)[number]['key'];
const LS_KEY_COLS = 'contactsview.visibleCols.v2';
function loadVisibleCols(): Record<OptColKey, boolean> {
  const def = { zaloUid: false, zaloGlobalId: false, zaloUsername: false, lookupState: false };
  try {
    const raw = localStorage.getItem(LS_KEY_COLS);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return def;
}
const visibleCols = ref<Record<OptColKey, boolean>>(loadVisibleCols());
function toggleColumn(key: OptColKey) {
  visibleCols.value[key] = !visibleCols.value[key];
  try { localStorage.setItem(LS_KEY_COLS, JSON.stringify(visibleCols.value)); } catch { /* ignore */ }
}
const totalColumnsCount = computed(() =>
  17 + Object.values(visibleCols.value).filter(Boolean).length,
);

// Child (KH Con) optional cols — riêng vì bản chất per-Friend chứ không aggregate.
const CHILD_OPTIONAL_COLUMNS = [
  { key: 'zaloGlobalId', label: 'Global ID (Con)', hint: 'Per-identity — toàn cục, cùng giữa các nick nhìn cùng identity' },
  { key: 'zaloUsername', label: 'Username (Con)',  hint: 'Per-identity username handle' },
] as const;
type ChildColKey = (typeof CHILD_OPTIONAL_COLUMNS)[number]['key'];
const LS_KEY_CHILD_COLS = 'contactsview.visibleChildCols.v1';
function loadVisibleChildCols(): Record<ChildColKey, boolean> {
  const def = { zaloGlobalId: false, zaloUsername: false };
  try {
    const raw = localStorage.getItem(LS_KEY_CHILD_COLS);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return def;
}
const visibleChildCols = ref<Record<ChildColKey, boolean>>(loadVisibleChildCols());
function toggleChildColumn(key: ChildColKey) {
  visibleChildCols.value[key] = !visibleChildCols.value[key];
  try { localStorage.setItem(LS_KEY_CHILD_COLS, JSON.stringify(visibleChildCols.value)); } catch { /* ignore */ }
}

const showDialog = ref(false);
const showDuplicateDialog = ref(false);
const showCandidateDialog = ref(false);
const candidateCount = ref(0);
async function fetchCandidateCount() {
  try {
    const res = await api.get<{ candidates: unknown[] }>('/contacts/parent-candidates');
    candidateCount.value = (res.data.candidates || []).length;
  } catch { candidateCount.value = 0; }
}
function onCandidateResolved() { fetchCandidateCount(); fetchContacts(); }
const selectedContact = ref<Contact | null>(null);
const expandedId = ref<string | null>(null);
// Real friendship data per contact (key: contactId → ChildRow[]). Fetched on first expand.
const friendshipCache = ref<Record<string, ChildRow[]>>({});
const friendshipLoading = ref<Record<string, boolean>>({});

// Advanced filter panel toggle (Lọc nâng cao: hasZalo / relationshipKind / multiNick / score)
const showAdvanced = ref(false);
const advancedActiveCount = computed(() => {
  let n = 0;
  if (filters.hasZalo) n++;
  if (filters.relationshipKindAny) n++;
  if (filters.multiNick) n++;
  if (filters.scoreMin != null || filters.scoreMax != null) n++;
  return n;
});
const hasAnyFilter = computed(() =>
  !!(filters.search || filters.source || filters.statusId || filters.assignedUserId
     || filters.threadType || filters.hasZalo || filters.multiNick
     || filters.relationshipKindAny || filters.scoreMin != null || filters.scoreMax != null
     || filters.dateFrom || filters.dateTo),
);
function clearAllFilters() {
  filters.search = '';
  filters.source = '';
  filters.statusId = '';
  filters.assignedUserId = '';
  filters.threadType = '';
  filters.hasZalo = '';
  filters.multiNick = '';
  filters.relationshipKindAny = '';
  filters.scoreMin = null;
  filters.scoreMax = null;
  filters.dateFrom = '';
  filters.dateTo = '';
  pagination.page = 1;
  fetchContacts();
}

// Dynamic Status list cho dropdown "Trạng thái KH" (cấp Contact = statusId)
interface MasterStatus { id: string; name: string; color: string | null; order: number }
const allMasterStatuses = ref<MasterStatus[]>([]);
async function loadMasterStatuses() {
  if (allMasterStatuses.value.length > 0) return;
  try {
    const res = await api.get<{ statuses: MasterStatus[] }>('/settings/statuses');
    allMasterStatuses.value = res.data.statuses || [];
  } catch { /* non-critical */ }
}

// Sale users (cho dropdown "Sale chăm" = Contact.assignedUserId)
interface UserLite { id: string; fullName: string }
const allUsers = ref<UserLite[]>([]);
async function loadUsers() {
  if (allUsers.value.length > 0) return;
  try {
    const res = await api.get<{ users?: UserLite[] }>('/users');
    allUsers.value = res.data?.users || [];
  } catch {
    // Fallback: extract distinct assignedUser từ contacts đã load
    const seen = new Map<string, UserLite>();
    for (const c of contacts.value) {
      if (c.assignedUser?.id && !seen.has(c.assignedUser.id)) {
        seen.set(c.assignedUser.id, { id: c.assignedUser.id, fullName: c.assignedUser.fullName || '—' });
      }
    }
    allUsers.value = [...seen.values()];
  }
}

// Stats from /contacts/stats endpoint (F5 reload). Fallback computed từ contacts nếu fail.
interface ContactStats {
  total?: number; withNick?: number; multiClaim?: number; revoked?: number;
  noZalo?: number; newToday?: number; activeRecently?: number;
  upcomingApt?: number; highScore?: number;
}
const stats = ref<ContactStats>({});
async function loadStats() {
  try {
    const res = await api.get<ContactStats>('/contacts/stats');
    stats.value = res.data || {};
  } catch (err) {
    console.error('[ContactsView] stats fetch failed:', err);
    stats.value = {};
  }
}

let searchTimeout: ReturnType<typeof setTimeout>;
function debouncedFetch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    pagination.page = 1;
    fetchContacts();
  }, 300);
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pagination.limit)));
function changePage(p: number) {
  pagination.page = p;
  fetchContacts();
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
  if (expandedId.value === id && !friendshipCache.value[id]) {
    const contact = contacts.value.find(c => c.id === id);
    if (contact) void fetchFriendships(contact);
  }
}

// Click anywhere trên row Cha = toggle expand. Skip nếu click vào button / input /
// link bên trong (để giữ behavior gốc của những control đó: edit name, click chat...).
function onRowClick(e: MouseEvent, id: string) {
  const t = e.target as HTMLElement;
  if (t.closest('button, input, select, textarea, a, .v-menu, .action-cell')) return;
  toggleExpand(id);
}

async function fetchFriendships(contact: Contact) {
  friendshipLoading.value[contact.id] = true;
  try {
    // GET /contacts/:id trả friends include statusRef per-pair (model B).
    const res = await api.get<Contact & { friends?: ApiFriendship[] }>(`/contacts/${contact.id}`);
    friendshipCache.value[contact.id] = (res.data.friends || []).map(f => mapFriendshipToChildRow(f, contact));
  } catch (err) {
    console.error('[contact-detail] fetch error:', err);
    friendshipCache.value[contact.id] = [];
  } finally {
    friendshipLoading.value[contact.id] = false;
  }
}

interface ApiFriendship {
  id: string;
  zaloUidInNick: string;
  relationshipKind: string;
  friendshipStatus: string;
  hasConversation: boolean;
  aliasInNick: string | null;
  zaloLabels: unknown;
  zaloDisplayName: string | null;
  zaloAvatarUrl: string | null;
  zaloGlobalId: string | null;
  zaloUsername: string | null;
  becameFriendAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  totalInbound: number;
  totalOutbound: number;
  leadScore: number;
  statusId: string | null;
  statusRef: StatusLite | null;
  zaloAccount: {
    id: string;
    displayName: string | null;
    phone: string | null;
    zaloUid: string | null;
    avatarUrl: string | null;
    owner: { id: string; fullName: string } | null;
  };
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  if (days < 30) return `${days}d trước`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}th trước`;
  return `${Math.floor(months / 12)}y trước`;
}

function mapFriendshipToChildRow(f: ApiFriendship, contact: Contact): ChildRow {
  const validKinds: ChildRow['relationshipKind'][] = ['friend', 'pending_friend', 'chatting_stranger', 'ghost'];
  const kind = (validKinds.includes(f.relationshipKind as ChildRow['relationshipKind'])
    ? f.relationshipKind
    : 'chatting_stranger') as ChildRow['relationshipKind'];
  const labels = Array.isArray(f.zaloLabels)
    ? (f.zaloLabels as Array<{ name?: string }>).map(l => l.name || '').filter(Boolean)
    : [];
  return {
    id: f.id,
    nickName: f.zaloAccount.displayName || 'Nick',
    nickAvatarUrl: f.zaloAccount.avatarUrl ?? null,
    salePhone: f.zaloAccount.phone || '',
    saleName: f.zaloAccount.owner?.fullName || '—',
    aliasInNick: f.aliasInNick,
    // Tên Zalo per-identity (snapshot tại Friend), fallback Contact.fullName chỉ khi NULL
    zaloName: f.zaloDisplayName || contact.fullName,
    zaloUid: f.zaloUidInNick,
    zaloGlobalId: f.zaloGlobalId,
    zaloUsername: f.zaloUsername,
    relationshipKind: kind,
    hasConversation: f.hasConversation,
    careStatus: (contact.status as CareStatusValue) || 'interested',
    statusRef: f.statusRef,
    leadScore: f.leadScore ?? 0,
    zaloAvatarUrl: f.zaloAvatarUrl,
    crmTagsPerNick: contact.tags?.slice(0, 3) || [],
    zaloLabels: labels,
    lastInboundAt: f.lastInboundAt,
    lastOutboundAt: f.lastOutboundAt,
    totalInbound: f.totalInbound ?? 0,
    totalOutbound: f.totalOutbound ?? 0,
    becameFriendAt: relativeTime(f.becameFriendAt),
    autoLabel: null,
  };
}

async function onPromoteFriend(row: ChildRow) {
  const name = prompt(`Tên cho KH Cha mới (gỡ "${row.nickName}" × UID ${row.zaloUid}):`, '');
  if (name === null) return;
  try {
    const res = await api.post<{ newContact: { id: string; fullName: string }; movedConversations: number }>(
      `/friends/${row.id}/promote-to-parent`,
      { fullName: name.trim() || undefined },
    );
    toast.success(`Đã tạo KH Cha "${res.data.newContact.fullName}". ${res.data.movedConversations} conversation chuyển.`);
    Object.keys(friendshipCache.value).forEach(k => delete friendshipCache.value[k]);
    fetchContacts();
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Tách thất bại';
    toast.error(msg);
  }
}

// ── Friend per-pair: edit status + score ─────────────────────────────────
async function onFriendScoreChange(row: ChildRow, value: string) {
  const score = Math.max(0, Math.min(100, parseInt(value) || 0));
  try {
    await api.patch(`/friends/${row.id}`, { leadScore: score });
    row.leadScore = score;
    // Invalidate cache để refetch aggregate Cha
    Object.keys(friendshipCache.value).forEach(k => delete friendshipCache.value[k]);
    fetchContacts();
  } catch (err) {
    toast.error('Cập nhật score thất bại');
  }
}

const statusEditTarget = ref<ChildRow | null>(null);
const allStatuses = ref<StatusLite[]>([]);

async function fetchAllStatuses() {
  if (allStatuses.value.length > 0) return;
  try {
    const res = await api.get<{ statuses: StatusLite[] }>('/settings/statuses');
    allStatuses.value = res.data.statuses || [];
  } catch {}
}

function openFriendStatusEdit(row: ChildRow) {
  fetchAllStatuses();
  statusEditTarget.value = row;
}

async function applyFriendStatus(statusId: string) {
  if (!statusEditTarget.value) return;
  const row = statusEditTarget.value;
  try {
    await api.patch(`/friends/${row.id}`, { statusId });
    const newStatus = allStatuses.value.find(s => s.id === statusId);
    if (newStatus) row.statusRef = newStatus;
    statusEditTarget.value = null;
    Object.keys(friendshipCache.value).forEach(k => delete friendshipCache.value[k]);
    fetchContacts();
  } catch (err) {
    toast.error('Cập nhật status thất bại');
  }
}

function genderLabel(value: string) {
  return GENDER_OPTIONS.find(o => o.value === value)?.text ?? value;
}
function sourceLabel(value: string) {
  return SOURCE_OPTIONS.find(o => o.value === value)?.text ?? value;
}
function statusLabel(value: string) {
  return STATUS_OPTIONS.find(o => o.value === value)?.text ?? value;
}
function statusChipClass(status: string): string {
  const map: Record<string, string> = {
    new: 'chip-grey',
    contacted: 'chip-info',
    interested: 'chip-warning',
    converted: 'chip-success',
    lost: 'chip-error',
  };
  return map[status] || 'chip-grey';
}
function scoreChipClass(score: number): string {
  if (score >= 70) return 'chip-success';
  if (score >= 40) return 'chip-warning';
  return 'chip-error';
}
// Status color helpers — hex từ Status.color → background nhạt + foreground đậm cho readable chip.
function chipBg(hex: string | null | undefined): string {
  if (!hex) return 'rgba(90,100,120,0.10)';
  // hex → rgba 0.15 alpha
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return 'rgba(90,100,120,0.10)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},0.15)`;
}
function chipFg(hex: string | null | undefined): string {
  return hex || 'var(--smax-grey-700)';
}
function ageOf(c: Contact): number | null {
  const cy = new Date().getFullYear();
  if (c.birthDate) {
    const y = new Date(c.birthDate).getFullYear();
    if (Number.isFinite(y)) return cy - y;
  }
  if (c.birthYear) return cy - c.birthYear;
  return null;
}

// (Stats giờ load từ /contacts/stats endpoint — xem `const stats` ở phần advanced filter
// state. Computed fallback cũ đã thay bằng ref reactive update qua loadStats.)

function openCreate() {
  selectedContact.value = null;
  showDialog.value = true;
}
function openDetail(c: Contact) {
  selectedContact.value = c;
  showDialog.value = true;
}
function goChat(c: Contact) {
  router.push({ path: '/chat', query: { contactId: c.id } });
}
function onAutomation(_c: Contact) { toast.warning('Automation dialog: chưa implement'); }

// ════════ Child rows (MOCK — chờ /contacts/:id/friendships) ════════
interface StatusLite { id: string; name: string; order: number; color: string | null }
interface ChildRow {
  id: string;
  nickName: string;
  nickAvatarUrl: string | null;
  statusRef: StatusLite | null;
  leadScore: number;
  zaloAvatarUrl: string | null;
  salePhone: string;
  saleName: string;
  aliasInNick: string | null;
  zaloName: string | null;
  zaloUid: string | null;
  zaloGlobalId: string | null;
  zaloUsername: string | null;
  relationshipKind: 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost';
  hasConversation: boolean;
  careStatus: CareStatusValue;
  crmTagsPerNick: string[];
  zaloLabels: string[];
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  totalInbound: number;
  totalOutbound: number;
  becameFriendAt: string | null;
  autoLabel: string | null;
}

/** Child rows: sort "đang chat" lên đầu, "chỉ KB" (chưa nhắn 1-1) xuống dưới.
 *  Tránh nhầm: KB Zalo ≠ đã chăm sóc — sale cần thấy ngay nick nào đã có dialog. */
function childRows(contact: Contact): ChildRow[] {
  const rows = friendshipCache.value[contact.id] || [];
  return [...rows].sort((a, b) => {
    if (a.hasConversation !== b.hasConversation) return a.hasConversation ? -1 : 1;
    const at = a.lastInboundAt || a.lastOutboundAt || '';
    const bt = b.lastInboundAt || b.lastOutboundAt || '';
    return bt.localeCompare(at);
  });
}


function kindLabel(kind: ChildRow['relationshipKind']): string {
  const map: Record<ChildRow['relationshipKind'], string> = {
    friend: 'Đã KB',
    pending_friend: 'Đã gửi mời',
    chatting_stranger: 'Đang nhắn (lạ)',
    ghost: 'Đã ngắt',
  };
  return map[kind];
}
function kindChipClass(kind: ChildRow['relationshipKind']): string {
  const map: Record<ChildRow['relationshipKind'], string> = {
    friend: 'chip-success',
    pending_friend: 'chip-warning',
    chatting_stranger: 'chip-info',
    ghost: 'chip-grey',
  };
  return map[kind];
}

function onChildAction(action: string, row: ChildRow) {
  if (action === 'chat') {
    toast.success(`Mở chat qua nick ${row.nickName}`);
  } else if (action === 'auto') {
    toast.warning(`Automation cho cặp ${row.nickName} × KH: chưa implement`);
  }
}

// ════════ Master row "Nick chăm" — 4 chip count ════════
interface NickCountChip { kind: string; icon: string; count: number; cls: string; title: string }
function nickCountChips(contact: Contact): NickCountChip[] {
  // Backend aggregate Friend.relationshipKind per contact (set trong GET /contacts).
  const m = contact.nicksByKind || {};
  return [
    { kind: 'friend', icon: '🟢', count: m.friend || 0, cls: 'chip-success', title: 'Đã KB' },
    { kind: 'pending', icon: '🟡', count: m.pending_friend || 0, cls: 'chip-warning', title: 'Đã gửi mời' },
    { kind: 'stranger', icon: '🔵', count: m.chatting_stranger || 0, cls: 'chip-info', title: 'Đang nhắn lạ' },
    { kind: 'ghost', icon: '⚪', count: m.ghost || 0, cls: 'chip-grey', title: 'Đã ngắt' },
  ];
}
function onSaved() { fetchContacts(); }
function onDeleted() { fetchContacts(); }
function onDuplicateMerged() {
  fetchContacts();
  fetchDuplicateGroups();
}

onMounted(() => {
  fetchContacts();
  fetchDuplicateGroups();
  fetchCandidateCount();
  loadStats();
  loadMasterStatuses();
  loadUsers();
});
</script>

<style scoped>
.smax-contacts-page {
  padding: 13px 18px 13px;
  background: var(--smax-grey-100);
  /* Flex column: page-header + toolbar + stats + scroll-wrap (flex: 1).
     Height fixed = viewport - topnav → scroll-wrap takes remaining vertical
     space + own scroll (V + H) → toolbar/stats stay above khi scroll bảng. */
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--smax-topnav-h, 52px));
  overflow: hidden;
}
.smax-contacts-page > .page-header,
.smax-contacts-page > .toolbar,
.smax-contacts-page > .toolbar-secondary,
.smax-contacts-page > .advanced-panel,
.smax-contacts-page > .stats-row,
.smax-contacts-page > .pagination {
  flex-shrink: 0;
}

/* ════════ Page header ════════ */
.page-header h1 {
  margin: 0 0 5px;
  font-size: 20px; font-weight: 600;
}
.subtitle {
  color: var(--smax-grey-700);
  margin-bottom: 11px;
  font-size: 13px;
}
.legend {
  display: flex; flex-wrap: wrap; gap: 11px;
  font-size: 12px; color: var(--smax-grey-700);
  margin-bottom: 11px;
}
.legend-item { display: inline-flex; align-items: center; gap: 4px; }
.legend-item .dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%;
}

/* ════════ Toolbar ════════ */
.toolbar {
  background: var(--smax-bg);
  border-radius: 7px;
  padding: 9px 11px;
  margin-bottom: 9px;
  display: flex; align-items: center; gap: 7px;
  flex-wrap: wrap;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.toolbar > * {
  font-family: inherit; font-size: 13px;
}
.toolbar-search {
  flex: 1; min-width: 240px;
  padding: 7px 11px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
}
.toolbar-search:focus { outline: none; border-color: var(--smax-primary); }
.toolbar select,
.toolbar .date-input {
  padding: 7px 11px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
}
.toolbar .date-input { max-width: 140px; }
.date-separator { color: var(--smax-grey-700); font-size: 12px; }
.spacer { flex: 1 0 auto; }

/* Toolbar Row 2: date + advanced toggle — compact, secondary visual weight */
.toolbar-secondary {
  padding: 6px 11px;
  margin-top: -6px;  /* dính vào row 1 */
  margin-bottom: 9px;
  background: var(--smax-grey-50);
  font-size: 12px;
}
.row2-label {
  color: var(--smax-grey-700);
  font-weight: 600;
  font-size: 11.5px;
}
.btn-advanced {
  padding: 5px 10px;
  border: 1px dashed var(--smax-primary);
  background: transparent;
  color: var(--smax-primary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  display: inline-flex; align-items: center; gap: 4px;
}
.btn-advanced.on { background: var(--smax-primary-soft); border-style: solid; }
.btn-advanced:hover { background: var(--smax-primary-soft); }
.btn-clear {
  padding: 4px 10px;
  border: 1px solid var(--smax-grey-300);
  background: transparent;
  color: var(--smax-grey-700);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.btn-clear:hover { color: var(--smax-error); border-color: var(--smax-error); }

/* Advanced panel: collapse mở dưới row 2, grid 4 cột group filter */
.advanced-panel {
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 11px 13px;
  margin-bottom: 9px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 11px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.adv-group {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
}
.adv-group label {
  display: block; width: 100%;
  font-size: 11px; font-weight: 600;
  color: var(--smax-grey-700);
  text-transform: uppercase; letter-spacing: 0.3px;
  margin-bottom: 4px;
}
.adv-group select,
.score-input-mini {
  padding: 6px 9px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
  font-size: 12.5px;
  font-family: inherit;
  flex: 1; min-width: 0;
}
.score-input-mini { max-width: 80px; text-align: center; }
.adv-group .dash { color: var(--smax-grey-700); font-size: 13px; }
.toggle-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--smax-grey-700); cursor: pointer; padding: 6px 10px; border-radius: 6px; }
.toggle-inline:hover { background: rgba(0,0,0,0.04); }
.toggle-inline input { cursor: pointer; }
.status-edit-chip { cursor: pointer; }
.status-edit-chip:hover { filter: brightness(1.1); }
.score-input { width: 50px; padding: 2px 4px; font-size: 11.5px; text-align: center; border: 1px solid var(--smax-grey-300); border-radius: 4px; }
.score-input:focus { outline: 2px solid var(--smax-primary, #00f2ff); }
.status-picker-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1100; display: flex; align-items: center; justify-content: center; }
.status-picker { background: var(--smax-bg); border-radius: 10px; padding: 16px 20px; min-width: 320px; max-width: 480px; }
.status-picker h4 { margin: 0 0 12px; font-size: 14px; }
.status-picker-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.status-picker-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; font-weight: 500; text-align: left; }
.status-picker-item.active { border-color: var(--smax-primary, #00f2ff); }
.status-picker-item:hover { filter: brightness(1.05); }
.order-num { font-size: 10px; opacity: 0.5; font-family: monospace; }
.btn-close { width: 100%; padding: 8px; background: var(--smax-grey-100); border: 1px solid var(--smax-grey-200); border-radius: 6px; cursor: pointer; }
.btn {
  padding: 7px 13px;
  border: 1px solid var(--smax-primary);
  background: var(--smax-bg);
  color: var(--smax-primary);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
}
.btn:hover { background: var(--smax-primary-soft); }
.btn-primary {
  background: var(--smax-primary);
  color: white;
}
.btn-primary:hover { background: var(--smax-primary-hover); }
.btn-badge {
  background: var(--smax-error);
  color: white;
  border-radius: 9px;
  padding: 1px 6px;
  font-size: 10px; font-weight: 600;
  margin-left: 3px;
}

/* ════════ Stats ════════ */
.stats-row {
  display: flex; gap: 11px; flex-wrap: wrap;
  background: var(--smax-bg);
  padding: 9px 13px;
  border-radius: 7px;
  margin-bottom: 9px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.stat-box {
  display: flex; align-items: center; gap: 5px;
  font-size: 13px;
}
.stat-num {
  font-weight: 600;
  color: var(--smax-primary);
  margin-left: 3px;
}

/* ════════ Table — responsive contained scroll ════════
   PATTERN: scroll-wrap takes remaining viewport height + own scroll both axes.
   Sticky thead binds to scroll-wrap, pins at top (top: 0). Page tự nó KHÔNG
   scroll — toolbar/stats stay above scroll-wrap, table cuộn trong wrap.

   Lợi ích responsive:
   - HD 1366: table > viewport → H scroll trong wrap (toolbar/stats không bị scroll)
   - FHD 1920+: table fit, không H scroll. Sticky thead pin top wrap.
   - 2K 2560+: table fit thừa space.
   Sticky vertical bind nên work ổn ở mọi viewport. */
.scroll-wrap {
  background: var(--smax-bg);
  border-radius: 7px;
  overflow: auto; /* both axes scroll inside wrap */
  flex: 1; min-height: 0; /* fill remaining vertical space của page flex column */
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.smax-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  /* min-width: 1500 cho HD 1366 — < viewport hẹp 1500 sẽ H scroll trong wrap.
     Cột explicit width đủ cho content phổ biến nhưng không quá rộng. */
  min-width: 1500px;
  /* table-layout: fixed → cột không recalc khi expand row con (no layout shift) */
  table-layout: fixed;
}
.smax-table > thead > tr > th {
  overflow: hidden;
  text-overflow: ellipsis;
}
.child-table { table-layout: auto; }
/* Sticky thead Cha pin trong scroll-wrap (top: 0 vì wrap có own scroll, không
   phải page scroll). CHỈ direct descendant > > > tránh leak xuống child-table. */
.smax-table > thead > tr > th {
  background: var(--smax-grey-50);
  border-bottom: 1px solid var(--smax-grey-200);
  padding: 9px 11px;
  text-align: left;
  font-weight: 600;
  color: var(--smax-grey-700);
  white-space: nowrap;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  position: sticky;
  top: 0;
  z-index: 5;
}
/* Child table thead = static (chỉ scroll cùng row, không pin) */
.child-table thead th {
  position: static;
}
.smax-table tbody tr.master-row {
  border-bottom: 1px solid var(--smax-grey-100);
  cursor: pointer; /* click anywhere toggle expand */
}
.smax-table tbody tr.master-row:hover { background: var(--smax-grey-50); }
.smax-table tbody tr.master-row.open {
  background: var(--smax-primary-soft);
}
/* Border-left accent qua box-shadow inset trên CELL ĐẦU (avoid position:relative
   trên <tr> — gây Chrome recalc table cell widths khi row open). */
.smax-table tbody tr.master-row.open > td:first-child {
  box-shadow: inset 3px 0 0 var(--smax-primary);
}
.smax-table td {
  padding: 9px 11px;
  vertical-align: top;
}
.w-32 { width: 32px; }
.w-40 { width: 40px; }
.w-78 { width: 78px; }
.w-80 { width: 80px; }
.w-90 { width: 90px; }
.w-100 { width: 100px; }
.w-110 { width: 110px; }
.w-120 { width: 120px; }
.w-130 { width: 130px; }
.w-140 { width: 140px; }
.w-150 { width: 150px; }
.w-170 { width: 170px; }
.w-180 { width: 180px; }
.w-200 { width: 200px; }
.w-260 { width: 260px; }

.expand-btn {
  background: transparent; border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--smax-grey-700);
  padding: 0; width: 22px; height: 22px;
}
.expand-btn:hover { color: var(--smax-primary); }

.avatar.avatar-customer {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #90caf9, #1976d2);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 13px;
}
.avatar.avatar-customer.is-female {
  background: linear-gradient(135deg, #f48fb1, #c2185b);
}

.name-text { font-weight: 500; color: var(--smax-text); }
.name-sub { font-size: 11px; color: var(--smax-grey-700); }
.cell-strong { font-weight: 500; font-size: 12px; }
.cell-preview {
  font-size: 11.5px; color: var(--smax-grey-700);
  max-width: 220px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.empty { color: var(--smax-grey-300); }

.tag-cell { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 9px;
  font-size: 10.5px; font-weight: 500;
  white-space: nowrap;
}
.chip-success { background: rgba(0,200,83,0.12); color: #00897b; }
.chip-warning { background: rgba(255,145,0,0.15); color: #ef6c00; }
.chip-info    { background: rgba(33,150,243,0.12); color: #1565c0; }
.chip-grey    { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); }
.chip-error   { background: rgba(255,82,82,0.12); color: #c62828; }
.chip-multi-nick {
  background: linear-gradient(135deg, rgba(124,77,255,0.14), rgba(33,150,243,0.10));
  color: #4527a0;
  margin-left: 6px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.action-cell { display: flex; gap: 4px; }
.row-action-btn {
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-300);
  border-radius: 5px;
  padding: 3px 7px;
  cursor: pointer;
  font-size: 12px;
}
.row-action-btn:hover { background: var(--smax-primary-soft); border-color: var(--smax-primary); color: var(--smax-primary); }

.child-wrap td {
  background: var(--smax-grey-50);
  padding: 9px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.child-empty {
  font-size: 12px;
  color: var(--smax-grey-700);
  font-style: italic;
  padding: 9px;
}
.child-mock-banner {
  font-size: 11px;
  background: rgba(255,145,0,0.10);
  color: #ef6c00;
  padding: 5px 9px;
  border-radius: 5px;
  margin-bottom: 9px;
}
.child-mock-banner code {
  background: white;
  padding: 1px 5px; border-radius: 4px;
  font-size: 10.5px;
}
.child-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--smax-bg);
  border-radius: 7px;
  overflow: hidden;
}
.child-table thead th {
  background: rgba(33,150,243,0.06);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 7px 9px;
  color: var(--smax-grey-700);
  font-weight: 600;
  text-align: left;
  border-bottom: 1px solid var(--smax-grey-200);
}
.child-table tbody td {
  padding: 7px 9px;
  font-size: 12px;
  border-bottom: 1px solid var(--smax-grey-100);
  vertical-align: top;
}
.child-table tbody tr.winner {
  background: rgba(76,175,80,0.06);
}
.child-table tbody tr.more-row td {
  text-align: center;
  font-size: 11px;
  color: var(--smax-grey-700);
  font-style: italic;
  background: var(--smax-grey-50);
}

.winner-badge {
  display: inline-block;
  margin-left: 4px;
  font-size: 11px;
}

.nick-cell {
  display: flex; align-items: center; gap: 6px;
}
.avatar-nick {
  width: 26px; height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffb74d, #f57c00);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 10px;
  flex-shrink: 0;
}
.two-line {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0;
}
.line1 { font-weight: 500; color: var(--smax-text); font-size: 12px; }
.line2 { font-size: 10.5px; color: var(--smax-grey-700); }
.line1.empty { color: var(--smax-grey-300); font-style: italic; font-weight: 400; }
.uid {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 10px;
  color: var(--smax-grey-700);
  word-break: break-all;
}

.nick-count-row {
  display: flex; gap: 3px; flex-wrap: wrap;
}
.nick-count-row .chip {
  font-size: 10px;
  padding: 2px 6px;
}

.chip-orange-soft {
  background: rgba(255,167,38,0.18);
  color: #ef6c00;
}

.w-220 { width: 220px; }

/* KB cell: chip relationship + badge "đang chat / chỉ KB" để phân biệt
   Friend đã từng có conv 1-1 với Friend chỉ kết bạn Zalo (sync từ getAllFriends). */
.kb-cell { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.chip-conv {
  font-size: 9.5px; font-weight: 700;
  padding: 1px 5px; border-radius: 4px;
  text-transform: uppercase;
  white-space: nowrap;
}
.chip-conv--on  { background: rgba(0,200,83,0.12);  color: #00897b; }
.chip-conv--off { background: rgba(0,0,0,0.06);     color: #888;    }

/* Zalo identity columns (optional, toggle via ⚙ Cột) */
.uid-cell {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 11px;
  background: var(--smax-grey-100);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--smax-grey-700);
  word-break: break-all;
}
.chip-multi {
  background: rgba(13, 71, 161, 0.10);
  color: #0d47a1;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 9px;
  font-weight: 600;
  white-space: nowrap;
}

.empty-state {
  text-align: center;
  padding: 38px;
  color: var(--smax-grey-700);
  font-style: italic;
}

.pagination {
  display: flex; align-items: center; justify-content: center; gap: 11px;
  margin-top: 13px;
  font-size: 13px; color: var(--smax-grey-700);
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
