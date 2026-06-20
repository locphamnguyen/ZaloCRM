<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <MobileContactView v-if="isMobile" />
  <div v-else class="smax-contacts-page">
    <!-- ════════ Page header (2026-06-05 Anh chốt: bỏ mô tả + legend) ════════ -->
    <header class="page-header">
      <div class="page-header-row">
        <div class="ph-title">
          <h1>Khách hàng</h1>
          <span class="count-pill"><svg class="lc" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>{{ total }} khách</span>
        </div>
        <!-- Hàng 1: action căn lề phải -->
        <div class="header-actions">
          <button class="btn btn-primary" @click="openCreate">
            <svg class="lc" viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg> Thêm Khách Hàng
          </button>
          <div class="seg-cluster">
          <button class="seg-btn" :class="{ on: showAdvanced }" @click="showAdvanced = !showAdvanced">
            <svg class="lc" viewBox="0 0 24 24"><path d="M3 6h18M7 12h10M11 18h2"/></svg> Lọc nâng cao
            <span v-if="advancedActiveCount > 0" class="btn-badge">{{ advancedActiveCount }}</span>
          </button>
          <!-- Công cụ -->
          <v-menu :close-on-content-click="false" location="bottom end">
            <template #activator="{ props: act }">
              <button v-bind="act" class="seg-btn" title="Công cụ dữ liệu & tùy chọn cột">
                <svg class="lc" viewBox="0 0 24 24"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg> Công cụ
                <span v-if="toolsBadgeTotal > 0" class="btn-badge">{{ toolsBadgeTotal }}</span>
              </button>
            </template>
            <v-list density="compact" min-width="300">
              <v-list-subheader>Công cụ dữ liệu</v-list-subheader>
              <v-list-item @click="showDuplicateDialog = true">
                <template #prepend><span class="tools-emoji">⊜</span></template>
                <v-list-item-title>Quét khách trùng lặp</v-list-item-title>
                <template #append><span v-if="duplicateTotal > 0" class="btn-badge">{{ duplicateTotal }}</span></template>
              </v-list-item>
              <v-list-item @click="showCandidateDialog = true">
                <template #prepend><span class="tools-emoji">💡</span></template>
                <v-list-item-title>Gợi ý gộp KH Cha</v-list-item-title>
                <template #append><span v-if="candidateCount > 0" class="btn-badge">{{ candidateCount }}</span></template>
              </v-list-item>
              <v-list-item :disabled="runningDetector" @click="onRunDetector">
                <template #prepend><span class="tools-emoji">🔄</span></template>
                <v-list-item-title>{{ runningDetector ? 'Đang quét…' : 'Quét lại ngay' }}</v-list-item-title>
              </v-list-item>
              <v-list-item @click="onExport">
                <template #prepend><span class="tools-emoji">⬇</span></template>
                <v-list-item-title>Xuất danh sách</v-list-item-title>
              </v-list-item>
              <v-divider class="my-1" />
              <v-list-subheader>Cột hiển thị — KH Cha</v-list-subheader>
              <v-list-item v-for="c in OPTIONAL_COLUMNS" :key="c.key" @click="toggleColumn(c.key)">
                <template #prepend>
                  <v-icon size="18" :color="visibleCols[c.key] ? 'primary' : ''">
                    {{ visibleCols[c.key] ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                  </v-icon>
                </template>
                <v-list-item-title>{{ c.label }}</v-list-item-title>
              </v-list-item>
              <v-list-subheader>Cột hiển thị — KH Con (mở ▸)</v-list-subheader>
              <v-list-item v-for="c in CHILD_OPTIONAL_COLUMNS" :key="c.key" @click="toggleChildColumn(c.key)">
                <template #prepend>
                  <v-icon size="18" :color="visibleChildCols[c.key] ? 'primary' : ''">
                    {{ visibleChildCols[c.key] ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                  </v-icon>
                </template>
                <v-list-item-title>{{ c.label }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
          <!-- Bảng / Chi tiết -->
          <div class="view-toggle" role="radiogroup" aria-label="View mode">
            <button class="view-btn" :class="{ active: viewMode === 'm1' }" @click="setViewMode('m1')" title="Bảng đầy đủ — click row mở Friend rows inline"><svg class="lc" viewBox="0 0 24 24"><path d="M3 3h18v18H3zM3 9h18M3 15h18"/></svg> Bảng</button>
            <button class="view-btn" :class="{ active: viewMode === 'm2' }" @click="setViewMode('m2')" title="Chi tiết bên — click row mở panel chi tiết bên phải"><svg class="lc" viewBox="0 0 24 24"><path d="M3 3h18v18H3zM15 3v18"/></svg> Chi tiết</button>
          </div>
          </div><!-- /seg-cluster -->
        </div>
      </div>
    </header>

    <!-- ════════ Toolbar Row 2: search + filter + Thêm KH Nhanh ════════ -->
    <div class="toolbar toolbar-primary">
      <div class="tb-search">
        <svg class="lc" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          v-model="filters.search"
          class="toolbar-search"
          name="contacts-search"
          autocomplete="off"
          placeholder="Tìm tên / SĐT / UID / @username / globalId…"
          @input="debouncedFetch"
        />
      </div>
      <select v-model="filters.threadType" @change="fetchContacts" title="Loại khách: cá nhân (người có SĐT) hay nhóm Zalo">
        <option value="">Tất cả</option>
        <option value="user">👤 Cá nhân</option>
        <option value="group">👥 Nhóm</option>
      </select>
      <!-- Filter Zalo (2026-06-05 Anh chốt: label "Zalo", options Có/Không/Tất cả/Chưa tìm) -->
      <select v-model="filters.hasZalo" @change="fetchContacts" title="Zalo">
        <option value="">Zalo: Tất cả</option>
        <option value="true">🟢 Có</option>
        <option value="false">🔴 Không</option>
        <option value="unknown">⚪ Chưa tìm</option>
      </select>
      <select v-model="filters.statusId" @change="fetchContacts" title="Trạng thái KH">
        <option value="">Trạng thái KH</option>
        <option v-for="s in allMasterStatuses" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <select v-model="filters.assignedUserId" @change="fetchContacts" title="Sale phụ trách KH">
        <option value="">Tất cả sale</option>
        <option v-for="u in allUsers" :key="u.id" :value="u.id">{{ u.fullName }}</option>
      </select>

      <!-- Thêm KH Nhanh (2026-06-05 Anh chốt: đưa từ FAB góc phải lên đây) -->
      <button class="btn btn-quick-add" @click="showAddCustomerDialog = true" title="Thêm khách hàng nhanh">
        ⚡ Thêm KH Nhanh
      </button>
      <button v-if="hasAnyFilter" class="btn-clear" @click="clearAllFilters" title="Xoá tất cả bộ lọc">
        × Xoá lọc
      </button>
    </div>

    <!-- Advanced filter panel (collapsible) — 2026-06-03 fix UI gọn -->
    <div v-if="showAdvanced" class="advanced-panel">
      <div class="adv-panel-title">🔎 Bộ lọc nâng cao</div>
      <!-- 2026-06-03: Nguồn khách ẩn vào đây (đổi chỗ với Trạng thái Zalo) -->
      <div class="adv-group">
        <label>Nguồn khách</label>
        <select v-model="filters.source" @change="fetchContacts">
          <option value="">Tất cả nguồn</option>
          <option v-for="o in SOURCE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
        </select>
      </div>
      <div class="adv-group">
        <label>Trạng thái kết bạn (per-nick)</label>
        <select v-model="filters.relationshipKindAny" @change="fetchContacts">
          <option value="">Tất cả</option>
          <option value="friend">🟢 Đã kết bạn</option>
          <option value="pending_friend">🟡 Đang mời</option>
          <option value="chatting_stranger">🔵 Chat lạ</option>
          <option value="ghost">⚪ Đã ngắt</option>
        </select>
      </div>
      <div class="adv-group">
        <label>Đa nick chăm</label>
        <select v-model="filters.multiNick" @change="fetchContacts">
          <option value="">Tất cả</option>
          <option value="true">≥ 2 nick chăm</option>
        </select>
      </div>
      <div class="adv-group adv-inline">
        <label>Lead score</label>
        <div class="adv-row">
          <input type="number" v-model.number="filters.scoreMin" min="0" max="100" placeholder="Min" class="score-input-mini" @change="fetchContacts" />
          <span class="dash">—</span>
          <input type="number" v-model.number="filters.scoreMax" min="0" max="100" placeholder="Max" class="score-input-mini" @change="fetchContacts" />
        </div>
      </div>
      <div class="adv-group adv-inline adv-wide">
        <label>📅 Khoảng tương tác</label>
        <div class="adv-row">
          <input type="date" v-model="filters.dateFrom" class="date-input" @change="fetchContacts" />
          <span class="dash">→</span>
          <input type="date" v-model="filters.dateTo" class="date-input" @change="fetchContacts" />
        </div>
      </div>
    </div>

    <!-- ════════ Stats row (2026-06-03: fix fallback ?? 0 + bấm để lọc) ════════ -->
    <div class="stats-row">
      <div
        v-for="s in statBoxes" :key="s.key"
        class="stat-box"
        :class="{ clickable: !!s.filter, active: s.filter && activeStatKey === s.key }"
        :title="s.filter ? 'Bấm để lọc theo ' + s.label : ''"
        @click="s.filter && toggleStatFilter(s)"
      >
        <span class="sdot" :style="{ background: STAT_DOT[s.key] || 'var(--ink-4)' }"></span>
        {{ s.label }}: <span class="stat-num">{{ s.value ?? 0 }}</span>
      </div>
    </div>

    <!-- ════════ Master/child table + Detail pane (Phase Dual View 2026-05-28) ════════ -->
    <div class="dual-pane" :class="{ 'detail-open': viewMode === 'm2' && selectedContact }">
    <div class="scroll-wrap" :class="{ 'mode-shrunk': viewMode === 'm2' && selectedContact }">
      <table class="smax-table" :class="{ 'mode-shrunk': viewMode === 'm2' && selectedContact }">
        <!-- colgroup: pin width cứng cho mọi cột → hàng con (row-child) có colspan
             vẫn gióng chính xác theo cột cha. (2026-06-04) -->
        <colgroup>
          <col style="width:26px">   <!-- 1 caret -->
          <col style="width:188px">  <!-- 2 Tên (gộp avatar+tên, KHÔNG colspan) -->
          <col style="width:100px">  <!-- 3 SĐT -->
          <col style="width:68px">   <!-- 4 Tỉnh/Quận -->
          <col style="width:54px">   <!-- 5 Nguồn -->
          <col style="width:72px">   <!-- 6 Trạng thái KH -->
          <col style="width:42px">   <!-- 7 Score -->
          <col style="width:112px">  <!-- 8 Nick chăm -->
          <col style="width:92px">   <!-- 9 Sale chính -->
          <!-- 2026-06-05 (Anh chốt) — giảm rộng 2 cột nhắn cuối ~30% + preview xuống 2 dòng.
               Trước: flex auto (~chiếm phần lớn không gian còn lại). Nay width cứng 150px
               (giảm ~30% so với ~210px auto @1366) → text wrap 2 dòng tận dụng dòng dưới. -->
          <col style="width:150px">  <!-- 10 KH nhắn cuối -->
          <col style="width:150px">  <!-- 11 Sale nhắn cuối -->
          <col style="width:54px">   <!-- 12 Tin in/out -->
          <col style="width:78px">   <!-- 13 Tags CRM -->
          <col style="width:60px">   <!-- 14 Có Zalo? -->
          <col v-if="visibleChildCols.zaloUid" style="width:120px">
          <col v-if="visibleCols.zaloGlobalId" style="width:130px">
          <col v-if="visibleCols.zaloUsername" style="width:130px">
          <col v-if="visibleCols.lookupState" style="width:100px">
          <col style="width:78px">   <!-- 15 Action -->
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>Tên CRM / Zalo (KH)</th>
            <th>SĐT</th>
            <th>Tỉnh/Quận</th>
            <th>Nguồn</th>
            <th>Trạng thái KH</th>
            <th>Score</th>
            <th>Nick chăm</th>
            <th>Sale chính / hỗ trợ</th>
            <th>KH nhắn cuối</th>
            <th>Sale nhắn cuối</th>
            <th>Tin in/out</th>
            <th>Tags CRM</th>
            <th>Có Zalo?</th>
            <th v-if="visibleChildCols.zaloUid" class="w-120 c-extra" title="UID per-nick (Cha không có UID) — giá trị ở dòng con">UID (nick)</th>
            <th v-if="visibleCols.zaloGlobalId" class="w-130 c-extra" title="Zalo globalId toàn cục (dedup cross-account)">Global ID</th>
            <th v-if="visibleCols.zaloUsername" class="w-130 c-extra" title="Zalo username (handle t_xxx)">Username</th>
            <th v-if="visibleCols.lookupState" class="w-100 c-extra" title="Trạng thái tra Zalo qua SĐT">Lookup</th>
            <th class="w-80 c-extra">Action</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="contact in contacts" :key="contact.id">
            <tr
              class="master-row"
              :class="{
                open: expandedId === contact.id,
                'detail-active': viewMode === 'm2' && selectedContact?.id === contact.id,
                'row-flash': focusedContactId === contact.id,
                'row-no-zalo': zaloDisplay(contact) !== 'yes',
              }"
              :data-contact-id="contact.id"
              @click="onRowClick($event, contact.id)"
            >
              <!-- col1: caret -->
              <td class="cl-caret-cell">
                <button class="cl-caret" @click.stop="toggleExpand(contact.id)">
                  {{ expandedId === contact.id ? '▾' : '▸' }}
                </button>
              </td>
              <!-- col2 Tên (gộp avatar + tên trong 1 ô flex — avatar luôn thẳng dòng tên đầu,
                   kể cả tên nhiều dòng — fix tận gốc "avatar đè tên" + "tên nhảy lên") -->
              <td class="cl-name">
                <span class="av-slot">
                  <Avatar
                    :src="contact.avatarUrl"
                    :name="contact.crmName || contact.fullName || '?'"
                    :size="26"
                    :gradient-seed="contact.id"
                  />
                </span>
                <!-- 2026-06-05 (Anh chốt) — 3 dòng căn LỀ TRÁI:
                     Dòng 1 = Tên (CRM) + giới tính/tuổi
                     Dòng 2 = Tên Zalo (fullName)
                     Dòng 3 = chip Cùng chăm (nếu có) -->
                <div class="cl-name-stack cl-name-stack--master">
                  <div class="cl-name-line">
                    <span class="cl-nm">{{ contact.crmName || contact.fullName || '—' }}</span>
                    <span v-if="contact.gender === 'male'" class="gtag gtag-male" :title="genderLabel(contact.gender)">♂</span>
                    <span v-else-if="contact.gender === 'female'" class="gtag gtag-female" :title="genderLabel(contact.gender)">♀</span>
                    <span v-if="ageOf(contact)" class="age-inline">{{ ageOf(contact) }}t</span>
                  </div>
                  <div v-if="contact.fullName && contact.crmName && contact.fullName !== contact.crmName" class="cl-name-sub">{{ contact.fullName }}</div>
                  <div v-if="(contact.childrenCount ?? 0) > 1" class="cl-name-sub">
                    <span class="chip chip-cung-cham" :title="`${contact.childrenCount} nick chăm KH này — mở ▸ để xem`">🤝 Cùng chăm ({{ contact.childrenCount }})</span>
                  </div>
                </div>
              </td>
              <td>
                <!-- 2026-06-03: SĐT multi-line — số chính đậm + số phụ nhãn -->
                <div class="phones-cell">
                  <span class="phone-cell phone-main">{{ formatVnPhone(contact.phone) }}</span>
                  <span
                    v-for="(p, pi) in (contact.phonesExtra || [])" :key="pi"
                    class="phone-extra"
                  >{{ formatVnPhone(p.phone) }}<span v-if="p.label" class="phone-lbl">{{ p.label }}</span></span>
                </div>
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
                <!-- M55 2026-05-30: KH no-Zalo (không có Friend) → avatar stack
                     sale cùng chăm. KH có Zalo → giữ 4 chip Friend như cũ. -->
                <div v-if="!hasAnyFriend(contact) && (contact.contactAccess?.length ?? 0) > 0" class="cung-cham-stack" :title="formatCungChamTooltip(contact)">
                  <span
                    v-for="(acc, idx) in (contact.contactAccess ?? []).slice(0, 4)"
                    :key="acc.user?.id || idx"
                    class="ccs-avatar"
                    :class="{ 'ccs-primary': acc.role === 'primary' }"
                    :style="{ background: avatarColor(acc.user?.fullName || acc.user?.email || '') }"
                  >
                    {{ initialOf(acc.user?.fullName || acc.user?.email || '?') }}
                  </span>
                  <span v-if="(contact.contactAccess?.length ?? 0) > 4" class="ccs-more">
                    +{{ (contact.contactAccess?.length ?? 0) - 4 }}
                  </span>
                  <span class="ccs-count">{{ contact.contactAccess?.length ?? 0 }} sale</span>
                </div>
                <div v-else class="nick-count-grid">
                  <span v-for="b in nickCountChips(contact)" :key="b.kind" :class="['chip', 'nick-mini', b.cls]" :title="b.title">
                    {{ b.icon }} {{ b.count }}
                  </span>
                </div>
              </td>
              <td>
                <div class="assigned-cell">
                  <span class="sale-main-name" :title="contact.assignedUser?.fullName || ''">{{ contact.assignedUser?.fullName || '—' }}</span>
                  <!-- Phase Contact Scope Hybrid 2026-05-27 — badge collaborator -->
                  <span
                    v-if="contact.viewerRole === 'primary'"
                    class="role-badge role-primary"
                    title="Bạn là người chịu trách nhiệm chính chăm khách hàng này"
                  >👤 Phụ trách</span>
                  <span
                    v-else-if="contact.viewerRole === 'collaborator'"
                    class="role-badge role-collab"
                    title="Bạn cùng chăm KH này qua nick của bạn (đồng đội với sale khác)"
                  >🤝 Cùng chăm</span>
                  <!-- 2026-06-03: Sale hỗ trợ — avatar stack từ contactAccess role=collaborator -->
                  <div v-if="assistSalesOf(contact).length" class="assist-row" :title="assistTooltip(contact)">
                    <span class="assist-avatars">
                      <span
                        v-for="(a, ai) in assistSalesOf(contact).slice(0, 3)" :key="a.user?.id || ai"
                        class="assist-av"
                        :style="{ background: avatarColor(a.user?.fullName || a.user?.email || '') }"
                      >{{ initialOf(a.user?.fullName || a.user?.email || '?') }}</span>
                    </span>
                    <span class="assist-lbl">+{{ assistSalesOf(contact).length }} hỗ trợ</span>
                  </div>
                </div>
              </td>
              <td>
                <template v-if="contact.lastInboundAt">
                  <div class="cell-strong">{{ formatRecentDateTime(contact.lastInboundAt) }}</div>
                  <div class="cell-preview" :title="(contact as any).redacted ? '' : (contact.lastInboundPreview || '')">
                    <PrivateBlur v-if="(contact as any).redacted" :redacted="true" mode="inline" />
                    <template v-else>{{ cleanPreview(contact.lastInboundPreview, contact.lastInboundType ?? null) }}</template>
                  </div>
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <template v-if="contact.lastOutboundAt">
                  <div class="cell-strong">{{ formatRecentDateTime(contact.lastOutboundAt) }}</div>
                  <div class="cell-preview" :title="(contact as any).redacted ? '' : (contact.lastOutboundPreview || '')">
                    <PrivateBlur v-if="(contact as any).redacted" :redacted="true" mode="inline" />
                    <template v-else>{{ cleanPreview(contact.lastOutboundPreview, contact.lastOutboundType ?? null) }}</template>
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
              <td class="cl-zalo">
                <!-- cl-zalo overflow hidden → pill KHÔNG tràn sang Action. 3 trạng thái mutex. -->
                <span v-if="zaloDisplay(contact) === 'yes'" class="zpill zpill-yes" title="Có Zalo">🟢 Có</span>
                <span v-else-if="zaloDisplay(contact) === 'no'" class="zpill zpill-no" title="Không tìm thấy Zalo">🔴 Ko</span>
                <span v-else class="zpill zpill-wait" title="Chưa tìm Zalo">⚪ Chờ</span>
              </td>
              <td v-if="visibleChildCols.zaloUid" class="c-extra" :title="'UID là per-nick — Cha không có UID. Mở ▸ xem UID từng nick.'">
                <span v-if="(contact.childrenCount ?? 0) >= 1" class="chip chip-multi" title="UID riêng theo từng nick — mở ▸ xem">▸ {{ contact.childrenCount ?? 0 }} nick</span>
                <span v-else class="empty">—</span>
              </td>
              <td v-if="visibleCols.zaloGlobalId" class="c-extra">
                <span v-if="(contact.distinctGlobalIdCount ?? 0) > 1" class="chip chip-multi" title="Đa Zalo identity (globalId khác nhau giữa các nick)">đa {{ contact.distinctGlobalIdCount }} identity</span>
                <code v-else-if="contact.aggregateZaloGlobalId" class="uid-cell" :title="contact.aggregateZaloGlobalId">{{ contact.aggregateZaloGlobalId.slice(0, 12) }}…</code>
                <span v-else class="empty">—</span>
              </td>
              <td v-if="visibleCols.zaloUsername" class="c-extra">
                <span v-if="(contact.distinctUsernameCount ?? 0) > 1" class="chip chip-multi">đa {{ contact.distinctUsernameCount }} username</span>
                <span v-else-if="contact.aggregateZaloUsername" class="uid-cell">@{{ contact.aggregateZaloUsername }}</span>
                <span v-else class="empty">—</span>
              </td>
              <td v-if="visibleCols.lookupState" class="c-extra">
                <div v-if="contact.zaloLookupAt" class="two-line">
                  <span class="line1">{{ formatRecentDateTime(contact.zaloLookupAt) }}</span>
                  <span class="line2">{{ contact.zaloLookupAttempts || 0 }} attempts</span>
                </div>
                <span v-else class="empty">chưa tra</span>
              </td>
              <td class="c-extra">
                <div class="cl-action">
                  <button class="cl-btn cl-btn-profile" @click.stop="openProfile(contact)" title="Xem & sửa hồ sơ khách hàng">👤 Hồ sơ</button>
                  <!-- 💬 bỏ khỏi dòng KH Cha (chốt 2026-06-04): chat mở từ friend row,
                       vì 1 KH Cha có thể nhiều nick → chọn nick cụ thể ở row con. -->
                </div>
              </td>
            </tr>

            <!-- Child rows: nick chăm — GIÓNG CỘT (chốt 2026-06-04, thay strip 3 dòng).
                 Mỗi nick = 1 <tr.row-child> dùng CHUNG cột với hàng KH cha:
                 Trạng thái/Score/KH-Sale nhắn cuối/Tin/Action gióng thẳng dưới header.
                 Tên nhớ mượn 3 cột SĐT+Tỉnh+Nguồn; badge KB ở cột Sale chính. -->
            <template v-if="expandedId === contact.id">
              <tr v-if="friendshipLoading[contact.id]" class="exp-loading">
                <td :colspan="totalColumnsCount" class="child-empty">Đang tải…</td>
              </tr>
              <template v-else-if="childRows(contact).length">
                <!-- 2026-06-05 (Anh chốt) — bỏ dòng header "N NICK ĐANG CHĂM", không cần. -->
                <tr
                  v-for="(row, idx) in childRows(contact)" :key="row.id"
                  class="fr-row" :class="[frKbClass(row.relationshipKind), { 'is-last': idx === childRows(contact).length - 1 }]"
                >
                  <!-- col1: caret-slot trống (giữ thẳng cột với caret cha) -->
                  <td class="cl-caret-cell"></td>
                  <!-- col2 Tên: avatar + nick + 🏆 + chấm chat + alias (cùng pattern .cl-name như cha
                       → avatar con thẳng dọc avatar cha, accent = inset shadow trái) -->
                  <td class="cl-name fr-name">
                    <span class="av-slot">
                      <Avatar :src="row.nickAvatarUrl" :name="row.nickName" :size="22" :gradient-seed="row.id" />
                    </span>
                    <div class="cl-name-stack">
                      <div class="cl-name-line">
                        <span class="cl-nm fr-nm" :title="row.nickName">{{ row.nickName }}</span>
                        <span v-if="idx === 0" class="fr-trophy" title="Nick chính">🏆</span>
                        <span class="fr-chatdot" :class="{ off: !row.hasConversation }" :title="row.hasConversation ? 'đang chat' : 'chưa chat'"></span>
                      </div>
                      <input
                        class="fr-alias"
                        :value="row.aliasInNick || ''"
                        placeholder="✎ tên nhớ"
                        title="Tên nhớ (đồng bộ 2 chiều với Zalo)."
                        @click.stop
                        @change="onFriendAliasChange(row, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </td>
                  <!-- col3 SĐT → trống (2026-06-05 Anh chốt: bỏ icon ⇄ Zalo, anh tự hiểu) -->
                  <td></td>
                  <!-- col5 Tỉnh, col6 Nguồn → trống -->
                  <td></td>
                  <td></td>
                  <!-- col7 Trạng thái KH (per-nick, editable) -->
                  <td>
                    <button
                      v-if="row.statusRef"
                      class="chip fr-status-btn"
                      :style="{ background: chipBg(row.statusRef.color), color: chipFg(row.statusRef.color) }"
                      title="Click đổi trạng thái"
                      @click.stop="openFriendStatusEdit(row)"
                    >{{ row.statusRef.name }}</button>
                    <button v-else class="chip chip-grey fr-status-btn" @click.stop="openFriendStatusEdit(row)">— đặt —</button>
                  </td>
                  <!-- col8 Score (per-nick, editable) -->
                  <td>
                    <input
                      type="number" class="fr-score"
                      :class="scoreChipClass(row.leadScore)"
                      :value="row.leadScore" min="0" max="100"
                      title="Score per-nick. Cha = AVG."
                      @click.stop
                      @change="onFriendScoreChange(row, ($event.target as HTMLInputElement).value)"
                    />
                  </td>
                  <!-- col9 Nick chăm → ngày kết bạn -->
                  <td><span class="fr-became">{{ row.becameFriendAt ? ('KB ' + row.becameFriendAt) : 'chưa KB' }}</span></td>
                  <!-- col10 Sale chính → tên sale chăm nick -->
                  <td><span class="fr-sale" :title="row.saleName">{{ row.saleName }}</span></td>
                  <!-- col11 KH nhắn cuối -->
                  <td>
                    <template v-if="row.lastInboundAt">
                      <div class="cell-strong">{{ formatRecentDateTime(row.lastInboundAt) }}</div>
                      <div class="cell-preview" :title="(row as any).redacted ? '' : (row.lastInboundPreview || '')"><PrivateBlur v-if="(row as any).redacted && row.lastInboundPreview" :redacted="true" mode="inline" /><template v-else>{{ row.lastInboundPreview ? cleanPreview(row.lastInboundPreview, row.lastInboundType) : '(đã nhắn)' }}</template></div>
                    </template>
                    <span v-else class="empty">—</span>
                  </td>
                  <!-- col12 Sale nhắn cuối -->
                  <td>
                    <template v-if="row.lastOutboundAt">
                      <div class="cell-strong">{{ formatRecentDateTime(row.lastOutboundAt) }}</div>
                      <div class="cell-preview" :title="(row as any).redacted ? '' : (row.lastOutboundPreview || '')"><PrivateBlur v-if="(row as any).redacted && row.lastOutboundPreview" :redacted="true" mode="inline" /><template v-else>{{ row.lastOutboundPreview ? cleanPreview(row.lastOutboundPreview, row.lastOutboundType) : '(đã nhắn)' }}</template></div>
                    </template>
                    <span v-else class="empty">—</span>
                  </td>
                  <!-- col13 Tin in/out -->
                  <td class="fr-io"><b>{{ row.totalInbound }}</b> / {{ row.totalOutbound }}</td>
                  <!-- col14 Tags CRM (Friend Tag) -->
                  <td>
                    <div class="tag-cell">
                      <span v-for="t in friendTagsOf(row).slice(0, 2)" :key="t.key" class="ftag" :class="t.cls" :title="t.group">{{ t.label }}</span>
                      <span v-if="friendTagsOf(row).length > 2" class="chip chip-grey">+{{ friendTagsOf(row).length - 2 }}</span>
                      <span v-if="!friendTagsOf(row).length" class="empty">—</span>
                    </div>
                  </td>
                  <!-- col15 Có Zalo? → badge trạng thái kết bạn nick -->
                  <td class="cl-zalo">
                    <span class="zpill" :class="kbCClass(row.relationshipKind)" :title="kindLabel(row.relationshipKind)">{{ kindLabelShort(row.relationshipKind) }}</span>
                  </td>
                  <!-- 2026-06-05 (Anh chốt) — friend row hiện giá trị UID/GlobalId/Username,
                       click vào text → copy. -->
                  <td v-if="visibleChildCols.zaloUid" class="c-extra">
                    <span v-if="row.zaloUid" class="fr-copy mono" :title="'Copy UID: ' + row.zaloUid" @click.stop="copyText(row.zaloUid, 'UID')">{{ row.zaloUid }}</span>
                    <span v-else class="empty">—</span>
                  </td>
                  <td v-if="visibleCols.zaloGlobalId" class="c-extra">
                    <span v-if="row.zaloGlobalId" class="fr-copy mono" :title="'Copy Global ID: ' + row.zaloGlobalId" @click.stop="copyText(row.zaloGlobalId, 'Global ID')">{{ row.zaloGlobalId }}</span>
                    <span v-else class="empty">—</span>
                  </td>
                  <td v-if="visibleCols.zaloUsername" class="c-extra">
                    <span v-if="row.zaloUsername" class="fr-copy mono" :title="'Copy Username: ' + row.zaloUsername" @click.stop="copyText(row.zaloUsername, 'Username')">{{ row.zaloUsername }}</span>
                    <span v-else class="empty">—</span>
                  </td>
                  <td v-if="visibleCols.lookupState" class="c-extra"></td>
                  <!-- col16 Action (💬 / ⚡ / ⬆) -->
                  <td class="c-extra">
                    <div class="cl-action">
                      <button class="cl-btn cl-btn-primary" @click.stop="onChildAction('chat', row)" title="Mở chat">💬</button>
                      <button class="cl-btn" @click.stop="onChildAction('auto', row)" title="Marketing">⚡</button>
                      <button class="cl-btn" @click.stop="onPromoteFriend(row)" title="Tách nick này thành KH Cha riêng">⬆</button>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-else class="exp-empty">
                <td :colspan="totalColumnsCount" class="child-empty">KH này chưa có nick CRM nào chăm.</td>
              </tr>
            </template>
          </template>

          <tr v-if="!loading && !contacts.length">
            <td :colspan="totalColumnsCount" class="empty-state">Không tìm thấy KH nào khớp bộ lọc.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Phase Dual View 2026-05-28: Detail pane bên phải khi mode 2 + selected -->
    <aside v-if="viewMode === 'm2' && selectedContact" class="detail-pane">
      <ContactDetailPanel
        :contact="selectedContact"
        @close="closeDetailPane"
        @go-chat="goChat(selectedContact!)"
        @saved="onSaved"
      />
    </aside>
    </div><!-- /.dual-pane -->

    <!-- Pagination -->
    <div class="pagination">
      <button class="btn" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">← Trước</button>
      <span class="page-info">Trang {{ pagination.page }} / {{ totalPages }}</span>
      <button class="btn" :disabled="pagination.page >= totalPages" @click="changePage(pagination.page + 1)">Sau →</button>
    </div>

    <!-- Dialogs -->
    <!-- 2026-06-03: bỏ ContactDetailDialog Vuetify cũ — sửa KH giờ qua CustomerProfileDialog (UI Hồ sơ) -->
    <ParentCandidateDialog v-model="showCandidateDialog" @resolved="onCandidateResolved" />

    <!-- Hồ sơ KH tổng (modal tái dùng — mở từ nút "👤 Hồ sơ") -->
    <CustomerProfileDialog
      v-model="showProfileDialog"
      :contact-id="profileContactId"
      @saved="onProfileSaved"
      @automation="onAutomation"
    />
    <!-- Thêm KH mới — cùng component, mode create (style Smax đồng nhất) -->
    <CustomerProfileDialog
      v-model="showCreateProfile"
      mode="create"
      @created="onContactCreated"
    />

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

    <!-- 2026-06-05 (Anh chốt) — bỏ FAB góc phải, nút "Thêm KH Nhanh" đã lên toolbar.
         Giữ dialog (mở từ nút toolbar). -->
    <AddCustomerQuickDialog
      v-model="showAddCustomerDialog"
      lead-source="contacts_quick"
      @created="onContactQuickCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import ContactDetailPanel from '@/components/contacts/ContactDetailPanel.vue';
import CustomerProfileDialog from '@/components/contacts/CustomerProfileDialog.vue';
import PrivateBlur from '@/components/privacy/PrivateBlur.vue';
import ParentCandidateDialog from '@/components/contacts/ParentCandidateDialog.vue';
import DuplicateReviewDialog from '@/components/contacts/DuplicateReviewDialog.vue';
import AddCustomerQuickDialog from '@/components/contacts/AddCustomerQuickDialog.vue';
import type { CareStatusValue } from '@/constants/care-status';
import Avatar from '@/components/ui/Avatar.vue';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api';
import {
  useContacts, useContactIntelligence,
  SOURCE_OPTIONS, STATUS_OPTIONS, GENDER_OPTIONS,
  formatRecentDateTime, cleanPreview,
} from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';
import MobileContactView from '@/views/MobileContactView.vue';
import { useMobile } from '@/composables/use-mobile';
import { useFriendSocket, type FriendUpdatedPayload } from '@/composables/use-friend-socket';

const { isMobile } = useMobile();
const router = useRouter();
const route = useRoute();

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
  // 2026-06-17 (anh chốt): KH Cha KHÔNG có UID (UID là per-nick) → chuyển UID xuống cột Con.
  // Cha chỉ định danh bằng Global ID + SĐT.
  { key: 'zaloGlobalId', label: 'Global ID (Cha)', hint: 'KH Cha: globalId chung khi tất cả con trùng, hoặc "đa N".' },
  { key: 'zaloUsername', label: 'Username (Cha)',  hint: 'KH Cha: username chung khi trùng tất cả con.' },
  { key: 'lookupState',  label: 'Lookup',          hint: 'Trạng thái tra Zalo qua SĐT cho KH này.' },
] as const;
type OptColKey = (typeof OPTIONAL_COLUMNS)[number]['key'];
const LS_KEY_COLS = 'contactsview.visibleCols.v2';
function loadVisibleCols(): Record<OptColKey, boolean> {
  const def = { zaloGlobalId: false, zaloUsername: false, lookupState: false };
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
  // 2026-06-04: gộp avatar+tên thành 1 cột (caret riêng) → 15 cột cố định.
  // 2026-06-17: cột UID giờ thuộc child-toggle (per-nick) → cộng riêng.
  15 + Object.values(visibleCols.value).filter(Boolean).length + (visibleChildCols.value.zaloUid ? 1 : 0),
);

// Child (KH Con) optional cols — riêng vì bản chất per-Friend chứ không aggregate.
// 2026-06-17: UID chuyển hẳn về đây (per-nick) — Cha không có UID.
const CHILD_OPTIONAL_COLUMNS = [
  { key: 'zaloUid',      label: 'Zalo UID (Con)',  hint: 'Per-nick: UID của KH nhìn từ nick này. Cha KHÔNG có UID.' },
  { key: 'zaloGlobalId', label: 'Global ID (Con)', hint: 'Per-identity — toàn cục, cùng giữa các nick nhìn cùng identity' },
  { key: 'zaloUsername', label: 'Username (Con)',  hint: 'Per-identity username handle' },
] as const;
type ChildColKey = (typeof CHILD_OPTIONAL_COLUMNS)[number]['key'];
const LS_KEY_CHILD_COLS = 'contactsview.visibleChildCols.v1';
function loadVisibleChildCols(): Record<ChildColKey, boolean> {
  const def = { zaloUid: false, zaloGlobalId: false, zaloUsername: false };
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

const showDuplicateDialog = ref(false);
const showCandidateDialog = ref(false);
const showAddCustomerDialog = ref(false);

// Hồ sơ KH tổng (CustomerProfileDialog 2026-06-03) — modal tái dùng, mở từ nút "Xem hồ sơ".
const showProfileDialog = ref(false);
const profileContactId = ref<string | null>(null);
function openProfile(c: Contact) {
  profileContactId.value = c.id;
  showProfileDialog.value = true;
}
function onProfileSaved() { fetchContacts(); }
// 2026-06-03: form Thêm KH dùng chính CustomerProfileDialog mode='create' (đồng nhất style Smax)
const showCreateProfile = ref(false);
function onContactCreated(_c: { id: string; fullName: string | null; phone: string | null }) {
  fetchContacts();
  loadStats();
}

function onContactQuickCreated(_c: { id: string; fullName: string | null; phone: string | null }) {
  // Reload list ngay để KH mới xuất hiện đầu danh sách
  fetchContacts();
}

// Phase Dual View 2026-05-28: viewMode persist localStorage
const LS_KEY_VIEW = 'contactsview.viewMode.v1';
const viewMode = ref<'m1' | 'm2'>((localStorage.getItem(LS_KEY_VIEW) as 'm1' | 'm2') || 'm1');
function setViewMode(m: 'm1' | 'm2') {
  viewMode.value = m;
  try { localStorage.setItem(LS_KEY_VIEW, m); } catch { /* ignore */ }
  // Đổi mode m1 → đóng detail pane đang mở
  if (m === 'm1') {
    selectedContact.value = null;
  }
}
const candidateCount = ref(0);
// 2026-06-03: badge tổng trên nút ⚙ Công cụ = số cụm trùng + gợi ý KH Cha (việc cần admin xử lý)
const toolsBadgeTotal = computed(() => (duplicateTotal.value || 0) + (candidateCount.value || 0));
function onExport() { toast.warning('Xuất danh sách: chưa implement'); }
async function fetchCandidateCount() {
  try {
    const res = await api.get<{ candidates: unknown[] }>('/contacts/parent-candidates');
    candidateCount.value = (res.data.candidates || []).length;
  } catch { candidateCount.value = 0; }
}
function onCandidateResolved() { fetchCandidateCount(); fetchContacts(); }

// Manual trigger duplicate-detector — admin/owner only. Không đợi cron 02:30 UTC daily.
// Sau khi xong, refetch parent-candidates + duplicate-groups count để hiện badge mới.
const runningDetector = ref(false);
async function onRunDetector() {
  if (runningDetector.value) return;
  runningDetector.value = true;
  try {
    const res = await api.post<{
      ok: boolean; durationMs: number; parentCandidates: number; duplicateGroups: number;
    }>('/admin/run-detector');
    const { parentCandidates, duplicateGroups, durationMs } = res.data;
    toast.success(
      `Quét xong trong ${(durationMs / 1000).toFixed(1)}s — `
      + `${parentCandidates} gợi ý KH Cha, ${duplicateGroups} cụm trùng lặp`,
    );
    await Promise.all([fetchCandidateCount(), fetchDuplicateGroups(), fetchContacts()]);
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: { error?: string } } };
    if (e.response?.status === 403) {
      toast.error('Chỉ admin/owner được phép chạy detector');
    } else {
      toast.error('Quét thất bại: ' + (e.response?.data?.error || String(err)));
    }
  } finally {
    runningDetector.value = false;
  }
}
const selectedContact = ref<Contact | null>(null);
const expandedId = ref<string | null>(null);
// M55.2 2026-05-30 — Focus param từ /contacts?focus=X (AddCustomerQuickDialog
// "Mở chi tiết" khi duplicate) → highlight row + scroll + open detail panel.
const focusedContactId = ref<string | null>(null);
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

// ── Stats bấm-để-lọc (2026-06-03) ──────────────────────────────────────────
// Mỗi ô có value (luôn fallback 0 — fix lỗi "---" khi chưa load) + filter optional.
// Bấm ô có filter → áp bộ lọc tương ứng, bấm lại → bỏ. Ô tổng quan (Tổng KH,
// Tương tác, Mới hôm nay) chỉ hiển thị, không lọc.
interface StatBox { key: string; icon: string; label: string; value: number | undefined; filter?: () => void }
const activeStatKey = ref<string | null>(null);
// Màu chấm KPI (thay emoji — line/dot HS theme).
const STAT_DOT: Record<string, string> = {
  total: 'var(--ink-3, #6b7488)', withNick: 'var(--success, #12b76a)', active7d: 'var(--warning, #f5a524)',
  newToday: 'var(--brand, #1786be)', highScore: '#f5a524', multiClaim: 'var(--purple, #8b5cf6)', noZalo: 'var(--error, #f04438)',
};
const statBoxes = computed<StatBox[]>(() => [
  { key: 'total', icon: '📋', label: 'Tổng KH', value: stats.value.total ?? total.value },
  { key: 'withNick', icon: '🟢', label: 'Có nick chăm', value: stats.value.withNick },
  { key: 'active7d', icon: '🔥', label: 'Tương tác 7d', value: stats.value.activeRecently },
  { key: 'newToday', icon: '🆕', label: 'Mới hôm nay', value: stats.value.newToday },
  { key: 'highScore', icon: '⭐', label: 'Score ≥50', value: stats.value.highScore,
    filter: () => { filters.scoreMin = 50; filters.scoreMax = null; } },
  { key: 'multiClaim', icon: '⚠', label: 'Đa nick (≥3)', value: stats.value.multiClaim,
    filter: () => { filters.multiNick = 'true'; } },
  { key: 'noZalo', icon: '📵', label: 'No Zalo', value: stats.value.noZalo,
    filter: () => { filters.hasZalo = 'false'; } },
]);
function toggleStatFilter(s: StatBox) {
  if (activeStatKey.value === s.key) {
    // Bỏ lọc: reset đúng field ô đó set
    activeStatKey.value = null;
    if (s.key === 'highScore') { filters.scoreMin = null; filters.scoreMax = null; }
    if (s.key === 'multiClaim') filters.multiNick = '';
    if (s.key === 'noZalo') filters.hasZalo = '';
  } else {
    activeStatKey.value = s.key;
    s.filter?.();
  }
  pagination.page = 1;
  fetchContacts();
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

// Click anywhere trên row Cha:
//   - Mode 1: toggle expand inline Friend rows (giữ behavior cũ)
//   - Mode 2: open detail pane bên phải (list shrink)
// Skip nếu click vào button / input / link bên trong.
function onRowClick(e: MouseEvent, id: string) {
  const t = e.target as HTMLElement;
  if (t.closest('button, input, select, textarea, a, .v-menu, .cl-action')) return;
  if (viewMode.value === 'm2') {
    const c = contacts.value.find((x) => x.id === id);
    if (c) selectedContact.value = c;
  } else {
    toggleExpand(id);
  }
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

// ─── Live socket subscribe: friend:updated → mutate row trong friendshipCache
// Chỉ áp dụng khi KH Cha đang được expand (có cache). Row khác → ignore.
// Tránh refetch list, mutate trực tiếp ô đã đổi (alias/status/score/avatar...).
useFriendSocket((payload: FriendUpdatedPayload) => {
  const cached = friendshipCache.value[payload.contactId];
  if (!cached) return; // KH Cha chưa expand, skip
  const row = cached.find((r) => r.id === payload.friendId);
  if (!row) return;
  // Merge fields mà ChildRow shape có. Skip key không match (vd Prisma timestamps
  // dạng Date string — ChildRow đã có relativeTime cache riêng, để parent refetch
  // tự rebuild).
  for (const [k, v] of Object.entries(payload.patch)) {
    if (k in row) {
      (row as unknown as Record<string, unknown>)[k] = v;
    }
  }
});

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
  lastInboundPreview: string | null;
  lastInboundType: string | null;
  lastOutboundPreview: string | null;
  lastOutboundType: string | null;
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
    lastInboundPreview: f.lastInboundPreview ?? null,
    lastInboundType: f.lastInboundType ?? null,
    lastOutboundPreview: f.lastOutboundPreview ?? null,
    lastOutboundType: f.lastOutboundType ?? null,
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

/* Edit "Tên gợi nhớ" — sync 2-chiều với Zalo Real.
 * PATCH /friends/:id sẽ:
 *  1. Update DB (Friend.aliasInNick)
 *  2. Backend fire-and-forget gọi api.changeFriendAlias / removeFriendAlias để push lên Zalo
 *  3. Log activity friend_alias_change với trigger='crm_edit' */
async function onFriendAliasChange(row: ChildRow, value: string) {
  const trimmed = (value || '').trim();
  const newAlias = trimmed.length ? trimmed : null;
  if (newAlias === (row.aliasInNick || null)) return;  // no-op
  try {
    await api.patch(`/friends/${row.id}`, { aliasInNick: newAlias });
    row.aliasInNick = newAlias;
    toast.success(newAlias ? `Đã đổi tên gợi nhớ → "${newAlias}"` : 'Đã xoá tên gợi nhớ');
  } catch (err) {
    toast.error('Cập nhật tên gợi nhớ thất bại');
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

/**
 * Format SĐT chuẩn Việt Nam — anh chốt 2026-05-28.
 * Input có thể là:
 *   - "84936668266"   → "0936 668 266"  (84xxx → 0xxx, group 4-3-3)
 *   - "0936668266"    → "0936 668 266"
 *   - "+84 936 668 266" → "0936 668 266"
 *   - "936668266"     → "0936 668 266"  (thiếu 0/84 → prepend 0)
 *   - null/empty       → "—"
 */
/**
 * Resolve trạng thái cột Zalo (3 trạng thái mutex). Ưu tiên:
 *   1. KH đã có Friend row / zaloUid / zaloGlobalId / zaloUsername → 'yes' (chắc chắn có Zalo)
 *   2. hasZalo === false → 'no' (đã lookup, KH chặn / không có)
 *   3. hasZalo === true → 'yes' (verified qua lookup)
 *   4. Else → 'unknown' (chưa tra)
 * Anh chốt 2026-05-28: aggregate Cha/Con phải đúng — KH có UID tức có Zalo.
 */
function zaloDisplay(c: Contact): 'yes' | 'no' | 'unknown' {
  // Có Friend row hoặc có Zalo identity → CHẮC CHẮN có Zalo
  if ((c.childrenCount ?? 0) > 0) return 'yes';
  if (c.zaloUid || c.zaloGlobalId || c.zaloUsername) return 'yes';
  if (c.displayHasZalo === true) return 'yes';
  if (c.hasZalo === true) return 'yes';
  // Đã lookup → không có Zalo
  if (c.hasZalo === false) return 'no';
  // Chưa lookup
  return 'unknown';
}

function formatVnPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  let s = String(phone).replace(/\D/g, '');
  if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);   // 84936... → 0936...
  else if (s.length === 9 && !s.startsWith('0')) s = '0' + s;        // 936... → 0936... (rare)
  if (s.length === 10) return s.slice(0, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  if (s.length === 11) return s.slice(0, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  return phone; // fallback giữ nguyên nếu không match
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

// 2026-06-03: nút "+ Thêm KH" mở CustomerProfileDialog mode='create' (style Smax đồng nhất)
function openCreate() {
  showCreateProfile.value = true;
}
function closeDetailPane() {
  selectedContact.value = null;
}
// M53 2026-05-30: KH no-Zalo (hasZalo=null/false) → mở virtual chat ngay,
// KHÔNG dùng query.contactId vì conversations list không chắc có virtual conv
// (resolve fail → user thấy /chat trống). Tạo virtual conv proactive rồi push trực tiếp /chat/:convId.
async function goChat(c: Contact) {
  if (!c.hasZalo) {
    try {
      const vcRes = await api.post<{ conversationId: string; created: boolean }>(
        `/contacts/${c.id}/virtual-conversation`, {},
      );
      const convId = vcRes.data?.conversationId;
      if (convId) {
        await router.push({ name: 'Chat', params: { convId } });
        return;
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.error;
      toast.warning(msg || 'Không mở được chat nội bộ — vui lòng thử lại');
      return;
    }
  }
  // KH có Zalo → fallback flow cũ: push query.contactId để ChatView resolve.
  router.push({ path: '/chat', query: { contactId: c.id } });
}
function onAutomation(_c: Contact) { toast.warning('Automation dialog: chưa implement'); }

// 2026-06-05 (Anh chốt) — click text UID/GlobalId/Username friend row → copy clipboard.
async function copyText(value: string | null | undefined, label = 'Đã copy') {
  if (!value) return;
  // Thử Clipboard API trước (secure context: https / localhost).
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}: ${value}`);
      return;
    } catch { /* clipboard bị chặn (http LAN / headless) → rơi xuống fallback */ }
  }
  // Fallback: textarea tạm + execCommand (chạy cả khi clipboard API throw/absent).
  try {
    const ta = document.createElement('textarea');
    ta.value = value; ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) toast.success(`${label}: ${value}`);
    else toast.warning('Bôi đen + Ctrl+C để copy: ' + value);
  } catch {
    toast.warning('Bôi đen + Ctrl+C để copy: ' + value);
  }
}

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
  lastInboundPreview: string | null;
  lastInboundType: string | null;
  lastOutboundPreview: string | null;
  lastOutboundType: string | null;
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
// Nhãn ngắn cho badge KB ở hàng con (cột Nick chăm 118px) — tránh cắt chữ. Full ở title.
function kindLabelShort(kind: ChildRow['relationshipKind']): string {
  const map: Record<ChildRow['relationshipKind'], string> = {
    friend: 'Đã KB',
    pending_friend: 'Đã mời',
    chatting_stranger: 'Nhắn lạ',
    ghost: 'Đã ngắt',
  };
  return map[kind];
}
// ── Friend row helpers ──
// frKbClass: class trên <tr.fr-row> → accent rail trái (inset shadow) đổi màu theo KB.
function frKbClass(kind: ChildRow['relationshipKind']): string {
  return { friend: 'kb-yes', pending_friend: 'kb-pending', chatting_stranger: 'kb-info', ghost: 'kb-off' }[kind] || 'kb-off';
}
// Chip trạng thái KB (nền nhạt).
function kbCClass(kind: ChildRow['relationshipKind']): string {
  return { friend: 'kb-c-yes', pending_friend: 'kb-c-pending', chatting_stranger: 'kb-c-info', ghost: 'kb-c-off' }[kind] || 'kb-c-off';
}
// Friend Tag NHÓM CÓ NHÃN CHỮ (Zalo/Tự gắn/Tự động/Đồng bộ) — thay huy chương 🥇🥈🥉.
// Nguồn: zaloLabels = Zalo Real (nhãn native), crmTagsPerNick = Manual sale gắn.
// (Auto-tag / Score-tag chưa có data riêng ở ChildRow → để dành, sau bổ sung.)
interface FriendTagChip { key: string; label: string; group: string; cls: string }
function friendTagsOf(row: ChildRow): FriendTagChip[] {
  const out: FriendTagChip[] = [];
  for (const lbl of (row.zaloLabels || [])) out.push({ key: 'z:' + lbl, label: lbl, group: 'Nhãn Zalo Real', cls: 'ft-zalo' });
  for (const t of (row.crmTagsPerNick || [])) out.push({ key: 'm:' + t, label: t, group: 'Nhãn sale tự gắn', cls: 'ft-manual' });
  return out.slice(0, 5);
}

async function onChildAction(action: string, row: ChildRow) {
  if (action === 'chat') {
    // Ensure-conversation cho cặp (nick, KH này) — idempotent. Nếu chưa có
    // conv (sale chưa từng nhắn) → backend tạo mới, trả convId. Nav vào /chat/:convId
    // để ChatView select luôn + ConversationList scroll row đó lên top.
    try {
      const res = await api.post<{ conversationId: string }>(
        `/friends/${row.id}/ensure-conversation`, {},
      );
      if (res.data?.conversationId) {
        router.push({ name: 'Chat', params: { convId: res.data.conversationId } });
      }
    } catch (err) {
      console.error('[ContactsView] ensure-conversation failed:', err);
      toast.error(`Không mở được chat qua nick ${row.nickName}`);
    }
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

// ════════ M55 2026-05-30 — "Cùng chăm" avatar stack cho KH no-Zalo ════════
function hasAnyFriend(contact: Contact): boolean {
  return (contact.childrenCount ?? 0) > 0;
}
// 2026-06-03: Sale hỗ trợ = contactAccess role='collaborator' (loại trừ sale chính nếu trùng).
function assistSalesOf(contact: Contact) {
  const mainId = contact.assignedUserId ?? contact.assignedUser?.id ?? null;
  return (contact.contactAccess || []).filter(
    (a) => a.role === 'collaborator' && a.user?.id && a.user.id !== mainId,
  );
}
function assistTooltip(contact: Contact): string {
  const list = assistSalesOf(contact);
  if (!list.length) return '';
  return 'Sale hỗ trợ cùng chăm:\n' + list.map((a) => '· ' + (a.user?.fullName || a.user?.email || 'Sale')).join('\n');
}
function initialOf(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
const AVATAR_COLORS = ['#0ea5e9', '#f97316', '#10b981', '#a855f7', '#ec4899', '#eab308', '#06b6d4', '#ef4444'];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function formatCungChamTooltip(contact: Contact): string {
  const list = contact.contactAccess ?? [];
  if (!list.length) return '';
  const lines = list.map((a) => {
    const name = a.user?.fullName || a.user?.email || 'Sale';
    const roleLabel = a.role === 'primary' ? '⭐ Phụ trách chính' : '🤝 Cùng chăm';
    return `${roleLabel}: ${name}`;
  });
  return `${list.length} sale đang/đã chăm KH này:\n${lines.join('\n')}`;
}
function onSaved() { fetchContacts(); }
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

// M55.2 2026-05-30 — Handle /contacts?focus={id} từ AddCustomerQuickDialog
// "Mở chi tiết" khi duplicate. Auto-fetch contact, open detail panel + scroll + flash row.
async function focusOnContact(id: string) {
  focusedContactId.value = id;

  // Switch sang viewMode m2 (chi tiết bên) để mở panel ngay
  if (viewMode.value !== 'm2') {
    viewMode.value = 'm2';
  }

  // Tìm contact trong list hiện tại, nếu không có → fetch single
  let target = contacts.value.find((c) => c.id === id);
  if (!target) {
    try {
      const res = await api.get<Contact>(`/contacts/${id}`);
      target = res.data;
    } catch {
      toast.warning('Không tìm thấy KH — có thể đã bị xoá hoặc không thuộc quyền chăm');
      return;
    }
  }
  selectedContact.value = target;

  // Scroll row vào view + flash 2.5s
  await nextTick();
  const row = document.querySelector(`tr[data-contact-id="${id}"]`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  setTimeout(() => {
    if (focusedContactId.value === id) focusedContactId.value = null;
  }, 2500);

  // Clean URL để F5 không reopen
  const newQuery = { ...route.query };
  delete newQuery.focus;
  router.replace({ query: newQuery });
}

watch(
  () => route.query.focus,
  (id) => {
    if (typeof id === 'string' && id) {
      void focusOnContact(id);
    }
  },
  { immediate: true },
);
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
/* 2026-06-05 (Anh chốt) — hàng 1: tiêu đề trái + action căn lề phải. */
.page-header-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
}
.header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.page-header h1 {
  margin: 0;
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
/* 2026-06-03 fix: panel lọc nâng cao gọn — grid 4 cột đều, mỗi group 1 ô,
   label thường (không uppercase rời rạc), date không full-width thừa chỗ. */
.advanced-panel {
  background: var(--smax-grey-50);
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 12px 14px;
  margin-bottom: 9px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.adv-group {
  display: flex; flex-direction: column; gap: 5px;
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px;
  padding: 8px 10px;
}
.adv-group label {
  font-size: 11px; font-weight: 600;
  color: var(--smax-grey-700);
  letter-spacing: 0.1px;
}
.adv-group select,
.score-input-mini,
.adv-group .date-input {
  padding: 6px 9px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
  font-size: 12.5px;
  font-family: inherit;
  width: 100%;
}
/* hàng khoảng tương tác + lead score: 2 input cạnh nhau gọn */
.adv-group.adv-inline { flex-direction: column; }
.adv-inline .adv-row { display: flex; align-items: center; gap: 6px; }
/* 2026-06-03: Khoảng tương tác cần rộng hơn (2 ô date không bị che chữ dd/mm/yyyy) */
.adv-group.adv-wide { grid-column: span 2; }
.adv-wide .date-input { min-width: 0; }
.adv-inline .date-input, .score-input-mini { flex: 1; min-width: 0; }
.score-input-mini { text-align: center; }
.adv-group .dash { color: var(--smax-grey-400); font-size: 13px; flex-shrink: 0; }
/* tiêu đề panel */
.adv-panel-title { grid-column: 1 / -1; font-size: 11px; font-weight: 700; color: var(--smax-grey-700); text-transform: uppercase; letter-spacing: .4px; margin-bottom: -2px; }
.toggle-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--smax-grey-700); cursor: pointer; padding: 6px 10px; border-radius: 6px; }
.toggle-inline:hover { background: rgba(0,0,0,0.04); }
.toggle-inline input { cursor: pointer; }
.status-edit-chip { cursor: pointer; }
.status-edit-chip:hover { filter: brightness(1.1); }
.score-input { width: 50px; padding: 2px 4px; font-size: 11.5px; text-align: center; border: 1px solid var(--smax-grey-300); border-radius: 4px; }
.score-input:focus { outline: 2px solid var(--smax-primary, #00f2ff); }
.alias-input { width: 100%; min-width: 140px; padding: 3px 6px; font-size: 12px; border: 1px solid var(--smax-grey-300); border-radius: 4px; background: transparent; }
.alias-input:focus { outline: 1.5px solid var(--smax-primary, #00f2ff); background: var(--surface); }
.alias-input::placeholder { color: var(--smax-grey-400); font-style: italic; }
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
  color: var(--surface);
}
.btn-primary:hover { background: var(--smax-primary-hover); }
/* 2026-06-05 — nút "Thêm KH Nhanh" trên toolbar (thay FAB), viền primary nhẹ. */
.btn-quick-add {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  border-color: var(--smax-primary);
  font-weight: 600;
}
.btn-quick-add:hover { background: var(--smax-primary); color: var(--surface); }
.btn-badge {
  background: var(--smax-error);
  color: var(--surface);
  border-radius: 9px;
  padding: 1px 6px;
  font-size: 10px; font-weight: 600;
  margin-left: 3px;
}

/* ════════ Stats ════════ (2026-06-03 design-review #5: nén gọn + vách ngăn nhẹ) */
.stats-row {
  display: flex; gap: 0; flex-wrap: wrap;
  background: var(--smax-bg);
  padding: 7px 6px;
  border-radius: 7px;
  margin-bottom: 9px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.stat-box {
  display: flex; align-items: center; gap: 4px;
  font-size: 12.5px;
  padding: 3px 12px;
  border-right: 1px solid var(--smax-grey-100);
  border-radius: 5px;
}
.stat-box:last-child { border-right: none; }
.stat-box.clickable { cursor: pointer; transition: background .12s; }
.stat-box.clickable:hover { background: var(--smax-grey-100); }
.stat-box.active { background: var(--smax-primary-soft); }
.stat-box.active .stat-num { color: var(--smax-primary); }
/* 2026-06-03: menu ⚙ Công cụ + lọc tương tác trong advanced */
.tools-emoji { font-size: 16px; width: 22px; display: inline-block; text-align: center; }
.stat-num {
  font-weight: 700;
  color: var(--smax-primary);
  margin-left: 2px;
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
  /* 15 cột: 13 cố định + Action = 1024px, 2 cột tin nhắn flex tự lấy phần dư.
     min-width 1280 = 1024 + 2×128 (msg floor) → khít 1366, không H-scroll. */
  min-width: 1280px;
  /* table-layout: fixed → cột không recalc khi expand row con (no layout shift) */
  table-layout: fixed;
}
.smax-table td, .smax-table th { box-sizing: border-box; }
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
  padding: 9px 8px;
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
  /* 2026-06-03 design-review #2: giảm padding ngang 11→8 cho bảng đỡ chật ở 1366 */
  padding: 9px 8px;
  /* vertical-align: top (giữ như bản gốc) — cụm tên nhiều dòng (tên + giới tính +
     Cùng chăm + sub-name) căn TOP, tên đầu thẳng đỉnh avatar. KHÔNG dùng middle
     (middle đẩy dòng tên đầu lên cao hơn avatar khi cụm tên >1 dòng → "tên nhảy lên"). */
  vertical-align: top;
}
/* 2026-06-04: cột avatar (td thứ 2) padding ngang nhỏ + căn giữa → avatar 26px KHÔNG
   tràn sang cột tên (cột chỉ 30px, padding 8px 2 bên chỉ chừa 14px). Áp cho hàng cha. */
.smax-table tbody tr.master-row > td:nth-child(2) { padding-left: 2px; padding-right: 2px; text-align: center; }
.smax-table tbody tr.master-row > td:nth-child(2) :deep(.v-avatar),
.smax-table tbody tr.master-row > td:nth-child(2) > * { vertical-align: middle; }
/* 14 cột cố định — tổng 1020px (đo thật @1366: usable wrap = 1330) để 2 cột
   tin nhắn .w-msg (width:auto) tự lấy phần còn lại ~155px mỗi cột → không scroll. */
.w-26 { width: 26px; }
.w-30 { width: 30px; }
.w-32 { width: 32px; }
.w-40 { width: 40px; }
.w-42 { width: 42px; }
.w-50 { width: 50px; }
.w-54 { width: 54px; }
.w-56 { width: 56px; }
.w-60 { width: 60px; }
.w-68 { width: 68px; }
.w-70 { width: 70px; }
.w-72 { width: 72px; }
.w-76 { width: 76px; }
.w-78 { width: 78px; }
.w-80 { width: 80px; }
.w-88 { width: 88px; }
.w-90 { width: 90px; }
.w-94 { width: 94px; }
.w-96 { width: 96px; }
.w-100 { width: 100px; }
.w-106 { width: 106px; }
.w-110 { width: 110px; }
.w-114 { width: 114px; }
.w-118 { width: 118px; }
.w-120 { width: 120px; }
.w-130 { width: 130px; }
.w-132 { width: 132px; }
.w-138 { width: 138px; }
.w-140 { width: 140px; }
.w-144 { width: 144px; }
.w-150 { width: 150px; }
.w-170 { width: 170px; }
.w-176 { width: 176px; }
.w-180 { width: 180px; }
.w-200 { width: 200px; }
.w-260 { width: 260px; }
/* 2 cột tin nhắn = "hố thu" phần dư. width:auto → table-layout:fixed cho cột auto
   nuốt toàn bộ chỗ còn lại sau khi trừ 14 cột px (≈155px @1366, nở rộng @FHD/2K).
   KHÔNG dùng min-width (table-layout:fixed bỏ qua) hay % (cư xử lệch). */
.w-msg { width: auto; }

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
  color: var(--surface); font-weight: 600; font-size: 13px;
}
.avatar.avatar-customer.is-female {
  background: linear-gradient(135deg, #f48fb1, #c2185b);
}

.name-text { font-weight: 500; color: var(--smax-text); }
.name-sub { font-size: 11px; color: var(--smax-grey-700); }
.cell-strong { font-weight: 500; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-preview {
  font-size: 11.5px; color: var(--smax-grey-700);
  max-width: 100%;
  /* 2026-06-05 (Anh chốt) — cột nhắn cuối hẹp 30% → cho preview XUỐNG 2 DÒNG
     (tận dụng dòng dưới đang trống) thay vì 1 dòng ellipsis. Quá 2 dòng vẫn ... */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  line-height: 15px;       /* 2026-06-05 (Anh chốt) — preview mỗi dòng 15px (dòng 2+3) */
  word-break: break-word;
}
.empty { color: var(--smax-grey-300); }

.tag-cell { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 9px;
  font-size: 10.5px; font-weight: 500;
  white-space: nowrap;
}
.chip-success { background: rgba(0,200,83,0.12); color: var(--success); }
.chip-warning { background: rgba(255,145,0,0.15); color: var(--warning); }
.chip-info    { background: rgba(33,150,243,0.12); color: var(--info); }
.chip-grey    { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); }
.chip-error   { background: rgba(255,82,82,0.12); color: var(--error); }
.chip-multi-nick {
  background: linear-gradient(135deg, rgba(124,77,255,0.14), rgba(33,150,243,0.10));
  color: #4527a0;
  margin-left: 6px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
/* "Cùng chăm (N)" badge — vàng cam theo Airtable signature (anh chốt 2026-05-28) */
.chip-cung-cham {
  background: var(--warning-soft);
  color: var(--warning);
  border: 1px solid #F59E0B66;
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
/* Nút "Xem hồ sơ" — action chính, nổi bật hơn icon button */
.view-profile-btn {
  background: var(--smax-primary-soft);
  border-color: var(--smax-primary);
  color: var(--smax-primary);
  font-weight: 600;
  white-space: nowrap;
}
.view-profile-btn:hover { background: var(--smax-primary); color: var(--surface); }

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
  color: var(--warning);
  padding: 5px 9px;
  border-radius: 5px;
  margin-bottom: 9px;
}
.child-mock-banner code {
  background: var(--surface);
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
  color: var(--surface); font-weight: 600; font-size: 10px;
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

/* Anh chốt 2026-05-28: Nick chăm fix 2×2 grid để giảm chiều rộng cột */
.nick-count-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  width: fit-content;
}
.nick-mini {
  font-size: 10px;
  padding: 2px 6px;
  white-space: nowrap;
  text-align: center;
}

/* M55 2026-05-30: Cùng chăm avatar stack — cho KH no-Zalo */
.cung-cham-stack {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: help;
}
.ccs-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--ink-4);
  color: var(--surface);
  font-size: 9px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px #e2e8f0;
  margin-left: -6px;
  text-transform: uppercase;
}
.ccs-avatar:first-child { margin-left: 0; }
.ccs-avatar.ccs-primary {
  border: 2px solid var(--warning);
  box-shadow: 0 0 0 1px #fbbf24;
}
.ccs-more {
  font-size: 10px;
  color: var(--ink-3);
  margin-left: 2px;
  background: var(--surface-3);
  padding: 1px 5px;
  border-radius: 8px;
  font-weight: 600;
}
.ccs-count {
  font-size: 10px;
  color: var(--ink-2);
  margin-left: 4px;
  white-space: nowrap;
}

/* Giới tính icon nhỏ + tuổi xuống hàng 2 */
.gender-row {
  font-size: 16px;
  line-height: 1.1;
  color: var(--smax-grey-700);
}
.gender-age {
  font-size: 11px;
  color: var(--smax-grey-700);
  margin-top: 1px;
}

.chip-orange-soft {
  background: rgba(255,167,38,0.18);
  color: var(--warning);
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
.chip-conv--on  { background: rgba(0,200,83,0.12);  color: var(--success); }
.chip-conv--off { background: rgba(0,0,0,0.06);     color: var(--ink-4);    }

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
  color: var(--info);
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

/* Phase Contact Scope Hybrid 2026-05-27 — collaborator badge */
.assigned-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  min-width: 0;
}
/* Fix text đè 2026-06-04: tên sale 1 dòng ellipsis (cột 94px hẹp), badge đã xuống
   dòng riêng (flex-column) nên không inline-wrap. Tên đầy đủ ở title tooltip. */
.assigned-cell .sale-main-name {
  display: block; max-width: 100%;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-size: 12px;
}
.role-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 9999px;
  white-space: nowrap;
  letter-spacing: 0.02em;
}
.role-primary { background: var(--brand-soft); color: var(--brand); }
.role-collab  { background: var(--warning-soft); color: var(--warning); }

/* ═══════════════════════════════════════════════════════════════════════════
 * Phase Dual View 2026-05-28 — Toggle 2 view modes + Master-Detail layout
 * Responsive: HD 1366 / Full HD 1920 / 2K 2560 (KHÔNG mobile)
 * ═══════════════════════════════════════════════════════════════════════════ */

/* View toggle button group */
.view-toggle {
  display: inline-flex;
  background: var(--smax-grey-50, var(--surface-2));
  border: 1px solid var(--smax-grey-200, var(--line));
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
  margin-right: 6px;
}
.view-btn {
  background: transparent;
  border: none;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--smax-grey-600, var(--ink-2));
  cursor: pointer;
  border-radius: 5px;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
/* 2026-06-05 (Anh: active/hover chưa phân biệt) — hover nền trắng+viền, active nền
   primary chữ trắng → nổi bật rõ trạng thái đang chọn. */
.view-btn:hover:not(.active) {
  background: var(--surface);
  color: var(--smax-primary);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.view-btn.active {
  background: var(--smax-primary);
  color: var(--surface);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 104, 255, 0.30);
}
.view-btn.active:hover { background: var(--smax-primary-hover, #0052cc); color: var(--surface); }


.zalo-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 3px 6px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0;
  max-width: 100%;
  overflow: hidden;
}
.zalo-pill.zalo-yes {
  background: var(--success-soft);
  color: var(--success);
  border: 1px solid #86efac;
}
.zalo-pill.zalo-no {
  background: var(--error-soft);
  color: var(--error);
  border: 1px solid #fca5a5;
}
.zalo-pill.zalo-unknown {
  background: var(--surface-3);
  color: var(--ink-2);
  border: 1px dashed #cbd5e1;
}

/* ── Dual-pane layout ── */
.dual-pane {
  display: grid;
  grid-template-columns: 1fr 0;
  flex: 1;
  min-height: 0;
  transition: grid-template-columns 0.25s ease;
}
.dual-pane.detail-open {
  /* HD: list 560px (4 cột Tên 200 + SĐT 110 + TT 110 + Zalo 110 + padding) / detail rest. */
  grid-template-columns: 560px 1fr;
}

.dual-pane > .scroll-wrap {
  min-width: 0;
  overflow: auto;
}

.detail-pane {
  border-left: 1px solid var(--smax-grey-200, var(--line));
  background: var(--surface);
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Mode 2 shrunk: 15 cột — chỉ hiện Tên(2), Trạng thái(6), Có Zalo(14), Action(cuối).
   Ẩn caret(1), SĐT(3), Tỉnh(4), Nguồn(5), Score(7), Nick(8), Sale(9), 2 msg(10,11),
   Tin(12), Tags(13). (Optional Zalo cols giữa 14 và Action: nếu bật sẽ hiện — hiếm dùng.) */
.smax-table.mode-shrunk thead th:nth-child(1),
.smax-table.mode-shrunk thead th:nth-child(3),
.smax-table.mode-shrunk thead th:nth-child(4),
.smax-table.mode-shrunk thead th:nth-child(5),
.smax-table.mode-shrunk thead th:nth-child(7),
.smax-table.mode-shrunk thead th:nth-child(8),
.smax-table.mode-shrunk thead th:nth-child(9),
.smax-table.mode-shrunk thead th:nth-child(10),
.smax-table.mode-shrunk thead th:nth-child(11),
.smax-table.mode-shrunk thead th:nth-child(12),
.smax-table.mode-shrunk thead th:nth-child(13),
.smax-table.mode-shrunk tbody td:nth-child(1),
.smax-table.mode-shrunk tbody td:nth-child(3),
.smax-table.mode-shrunk tbody td:nth-child(4),
.smax-table.mode-shrunk tbody td:nth-child(5),
.smax-table.mode-shrunk tbody td:nth-child(7),
.smax-table.mode-shrunk tbody td:nth-child(8),
.smax-table.mode-shrunk tbody td:nth-child(9),
.smax-table.mode-shrunk tbody td:nth-child(10),
.smax-table.mode-shrunk tbody td:nth-child(11),
.smax-table.mode-shrunk tbody td:nth-child(12),
.smax-table.mode-shrunk tbody td:nth-child(13) {
  display: none;
}
/* 2026-06-05 (Anh: list scale xấu ở mode Chi tiết) — ẩn cột phụ (UID/GlobalId/
   Username/Lookup/Action) khi mở panel chi tiết. Ẩn theo CLASS .c-extra (bền hơn
   nth-child — cột zalo bật/tắt động không làm lệch). Chi tiết đã ở panel phải nên
   list chỉ cần Tên + Trạng thái + Score + Có Zalo. */
.smax-table.mode-shrunk .c-extra { display: none !important; }
/* Shrunk: row hơi cao hơn để chứa name + phone stacked */
.smax-table.mode-shrunk tbody tr.master-row td { height: 56px; }

/* Shrunk: override min-width 1500 của smax-table mặc định → table co lại theo list pane.
   2026-06-05 (Anh: list trống nửa phải) — table-layout AUTO (không fixed) để colgroup
   width cứng KHÔNG ép table rộng 1326px; cột ẩn display:none → table tự co theo cột
   còn lại (Tên/Trạng thái/Có Zalo) lấp đầy pane 100%. */
.smax-table.mode-shrunk {
  table-layout: auto;
  width: 100%;
  min-width: 0 !important;
}
/* Vô hiệu width cứng của colgroup ở mode shrunk (col width ép table rộng dù td ẩn). */
.smax-table.mode-shrunk colgroup col { width: auto !important; }
.smax-table.mode-shrunk thead th:nth-child(3) { width: 220px; }   /* Tên */
.smax-table.mode-shrunk thead th:nth-child(4) { width: 110px; }   /* SĐT */
.smax-table.mode-shrunk thead th:nth-child(8) { width: 110px; }   /* Trạng thái KH */
.smax-table.mode-shrunk thead th:nth-child(16) { width: 110px; }  /* Có Zalo? */
.smax-table.mode-shrunk thead th { white-space: nowrap; }
.smax-table.mode-shrunk tbody td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Highlight active row khi detail-open */
.smax-table.mode-shrunk tbody tr.master-row.detail-active {
  background: #fef9e7;
  border-left: 3px solid var(--smax-coral, #aa2d00);
}

/* M55.2 2026-05-30 — Flash row 2.5s khi focus param trigger (Mở chi tiết từ dialog) */
.smax-table tbody tr.master-row.row-flash {
  animation: row-flash-anim 2.5s ease-out;
}
@keyframes row-flash-anim {
  0%   { background: var(--warning-soft); box-shadow: inset 0 0 0 2px var(--warning); }
  40%  { background: var(--warning-soft); box-shadow: inset 0 0 0 2px var(--warning); }
  100% { background: transparent; box-shadow: inset 0 0 0 2px transparent; }
}

/* Responsive breakpoints — anh chốt 2026-05-28: chỉ HD / FHD / 2K, không mobile */
/* HD (1366×768): default — đã set ở trên (460px detail) */

/* Full HD (1920×1080) */
@media (min-width: 1920px) {
  .dual-pane.detail-open { grid-template-columns: 620px 1fr; }
  /* Cap bảng 1560px → 14 cột px (990) + 2 cột tin nhắn auto = ~285px/cột (anh chốt
     ~280px). Cap để 2 cột không phình quá rộng; phần dư màn rộng thành lề 2 bên. */
  .smax-contacts-page { max-width: 1560px; margin: 0 auto; }
}

/* 2K / QHD (2560×1440) */
@media (min-width: 2560px) {
  .dual-pane.detail-open { grid-template-columns: 720px 1fr; }
  /* Cap 1560 đồng nhất với FHD → cột tin nhắn giữ ~285px (không phình tới 700px),
     bảng center, lề 2 bên rộng là centering bình thường (không phải gap giữa cột). */
  .smax-contacts-page { max-width: 1560px; margin: 0 auto; }
}

/* Wedge A 2026-05-28: FAB "Thêm KH nhanh" — floating bottom-right */
.add-customer-fab {
  position: fixed;
  right: 32px;
  bottom: 32px;
  z-index: 90;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 20px 0 16px;
  border-radius: 9999px;
  border: 1px solid #181d26;
  background: #181d26;
  color: var(--surface);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.22), 0 4px 8px rgba(15, 23, 42, 0.10);
  transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
}
.add-customer-fab:hover {
  background: #0d1218;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.28), 0 6px 12px rgba(15, 23, 42, 0.12);
}
.add-customer-fab:active { transform: translateY(1px); }
.add-customer-fab .fab-plus {
  font-size: 22px;
  line-height: 1;
  font-weight: 400;
}
.add-customer-fab .fab-label {
  font-size: 13.5px;
  letter-spacing: 0.01em;
}
@media (min-width: 1920px) {
  .add-customer-fab { right: 40px; bottom: 40px; height: 52px; padding: 0 22px 0 18px; }
  .add-customer-fab .fab-plus { font-size: 24px; }
  .add-customer-fab .fab-label { font-size: 14px; }
}
@media (min-width: 2560px) {
  .add-customer-fab { right: 56px; bottom: 56px; height: 56px; padding: 0 26px 0 20px; }
  .add-customer-fab .fab-label { font-size: 15px; }
}

/* ════════ 2026-06-03: Hồ sơ KH tổng — GT+tuổi gắn tên, SĐT multi-line, sale hỗ trợ, no-Zalo ════════ */
/* Giới tính + tuổi inline cạnh tên */
.gtag-inline {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  border-radius: 7px;
  padding: 0 5px;
  margin-left: 4px;
  vertical-align: middle;
}
.gtag-inline.gtag-male { background: rgba(30, 136, 229, 0.13); color: var(--info); }
.gtag-inline.gtag-female { background: rgba(233, 30, 99, 0.12); color: #c2185b; }
.age-inline { font-size: 11px; color: var(--smax-grey-700); margin-left: 4px; font-weight: 500; }

/* SĐT multi-line */
.phones-cell { display: flex; flex-direction: column; gap: 1px; }
.phone-cell.phone-main { font-weight: 600; color: var(--smax-text); }
.phone-extra { font-size: 11px; color: var(--smax-grey-700); font-variant-numeric: tabular-nums; }
.phone-extra .phone-lbl {
  font-size: 9px; color: var(--smax-grey-400);
  background: var(--smax-grey-100); border-radius: 4px;
  padding: 0 4px; margin-left: 4px;
}

/* Sale hỗ trợ — avatar stack */
.sale-main-name { font-weight: 600; }
.assist-row { display: flex; align-items: center; gap: 5px; margin-top: 3px; }
.assist-avatars { display: flex; }
.assist-av {
  width: 20px; height: 20px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--surface); font-size: 9px; font-weight: 600;
  border: 1.5px solid var(--surface); margin-left: -6px;
}
.assist-av:first-child { margin-left: 0; }
.assist-lbl { font-size: 10px; color: var(--smax-grey-700); }

/* KH no-Zalo (Chưa tìm / Không tìm thấy) — nền cam rất nhạt phân biệt, vẫn đang chăm sóc */
.smax-table tbody tr.master-row.row-no-zalo { background: rgba(255, 145, 0, 0.035); }
.smax-table tbody tr.master-row.row-no-zalo:hover { background: rgba(255, 145, 0, 0.07); }
.smax-table tbody tr.master-row.row-no-zalo.open { background: var(--smax-primary-soft); }

/* ═══════════ BẢNG KH — LAYOUT SẠCH (rewrite 2026-06-04) ═══════════
   Gốc rễ các bug cũ: avatar (cột riêng) + tên (cột riêng) = 2 <td> với vertical-align
   khác nhau → avatar đè tên / tên nhảy. FIX: gộp caret+avatar+tên vào 1 ô flex .cl-name
   (align-items: flex-start) → avatar luôn thẳng dòng tên đầu, dù tên nhiều dòng.
   Hàng con (fr-row) dùng cùng pattern → avatar con thẳng dọc avatar cha. */

/* ô caret (cột 1) */
.cl-caret-cell { text-align: center; padding-left: 2px; padding-right: 2px; }
.cl-caret { width: 16px; height: 18px; line-height: 18px; padding: 0; background: none; border: 0; cursor: pointer; color: var(--smax-grey-700); font-size: 11px; }
.cl-caret:hover { color: var(--smax-primary); }

/* ô Tên (gộp avatar + tên, colspan 2) — flex 1 hàng, avatar pin top dòng tên */
.cl-name { display: flex; align-items: flex-start; gap: 7px; }
/* 2026-06-05 v3 — ô Tên dòng con căn ĐỈNH (flex-start): avatar + tên (dòng 1)
   thẳng với dòng đầu (ngày giờ) các cột khác. alias rủ xuống dòng 2 tự do. */
.fr-row .cl-name { align-items: flex-start; }
.av-slot { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; }
.fr-row .av-slot { flex-basis: 22px; width: 22px; height: 22px; }
.cl-name-stack { flex: 1 1 auto; min-width: 0; }
/* 2026-06-05 (Anh chốt) — KH cha: 3 dòng (Tên / Tên Zalo / Cùng chăm) căn LỀ TRÁI. */
.cl-name-stack--master { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.cl-name-stack--master .cl-name-line { min-height: 0; }
.cl-name-stack--master .chip-cung-cham { margin: 0; }
.cl-name-line { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 26px; }
.fr-row .cl-name-line { min-height: 22px; }
.cl-nm { font-weight: 500; color: var(--smax-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cl-name-sub { font-size: 11px; color: var(--smax-grey-700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gtag { flex: 0 0 auto; font-size: 11px; font-weight: 600; border-radius: 7px; padding: 0 5px; }
.gtag-male { background: rgba(30,136,229,.13); color: var(--info); }
.gtag-female { background: rgba(233,30,99,.12); color: #c2185b; }
.age-inline { flex: 0 0 auto; font-size: 11px; color: var(--smax-grey-700); font-weight: 500; }

/* Có Zalo? pill — KHÔNG tràn sang Action (box-sizing + max-width + overflow) */
.cl-zalo { overflow: hidden; }
.zpill { display: inline-flex; align-items: center; gap: 2px; box-sizing: border-box; max-width: 100%; font-size: 10px; line-height: 1; font-weight: 600; padding: 3px 5px; border-radius: 9999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zpill-yes { background: var(--success-soft); color: var(--success); border: 1px solid #86efac; }
.zpill-no { background: var(--error-soft); color: var(--error); border: 1px solid #fca5a5; }
.zpill-wait { background: var(--surface-3); color: var(--ink-2); border: 1px dashed #cbd5e1; }
/* badge KB hàng con dùng .zpill + màu .kb-c-* */
.kb-c-yes { background: rgba(0,200,83,.15); color: var(--success); border: 1px solid #86efac; }
.kb-c-pending { background: rgba(255,145,0,.16); color: var(--warning); border: 1px solid #fcd9a5; }
.kb-c-info { background: rgba(33,150,243,.14); color: var(--info); border: 1px solid #90caf9; }
.kb-c-off { background: var(--smax-grey-100); color: var(--ink-4); border: 1px solid var(--smax-grey-300); }

/* Action — nút icon fixed-width, không tràn */
.cl-action { display: flex; gap: 4px; }
.cl-btn { box-sizing: border-box; height: 26px; padding: 0 8px; border: 1px solid var(--smax-grey-300); border-radius: 5px; background: var(--surface); font-size: 12px; line-height: 24px; white-space: nowrap; cursor: pointer; color: var(--smax-grey-700); }
.cl-btn:hover { border-color: var(--smax-primary); color: var(--smax-primary); }
.cl-btn-profile { background: var(--smax-primary-soft); border-color: var(--smax-primary); color: var(--smax-primary); font-weight: 600; }
.cl-btn-profile:hover { background: var(--smax-primary); color: var(--surface); }
.fr-row .cl-btn { width: 22px; height: 22px; padding: 0; text-align: center; line-height: 20px; }
.fr-row .cl-action { gap: 3px; }
.cl-btn-primary { background: var(--smax-primary); color: var(--surface); border-color: var(--smax-primary); }
.cl-btn-primary:hover { background: var(--smax-primary); color: var(--surface); }

/* ───────── HÀNG CON (fr-row) — gióng cột với cha ───────── */
.deck-head-row > td { padding: 5px 8px 5px 28px; background: var(--smax-grey-50); font-size: 10.5px; font-weight: 700; letter-spacing: .03em; color: var(--smax-primary); border-bottom: 1px solid var(--smax-grey-200); }
.exp-loading > td, .exp-empty > td { background: var(--smax-grey-50); }
.fr-row { background: var(--smax-grey-50); font-size: 12px; }
.fr-row:hover { background: var(--brand-softer); }
/* 2026-06-05 v7 (Anh chốt bố trí 3 dòng = 25+15+15) — CHIỀU CAO HÀNG CỐ ĐỊNH.
   Cách đúng: mỗi td bọc nội dung trong khung 55px cố định + overflow ẩn.
   Dùng `td { height: 67px }` (min) + max-height ép trần. ROOT của lệch trước đây:
   span ".empty"/.tag-cell là FLEX ITEM → stretch full hàng → kéo hàng cao. Trị bằng
   align-self:flex-start + KHÔNG cho stretch. */
/* 2026-06-05 v10 (Anh: lệch 0.5-1px line, khác 1 nick vs nhiều nick) — FIX CUỐI.
   ROOT: height:68px < chiều cao nội dung thật của cột cao nhất (69px) → table cào
   hàng lên 69, nhưng td Tên giữ đúng 68 (vì height cứng 68) → đáy td Tên thiếu 1px
   → đường kẻ gãy. (Bỏ height → spread 10px vì td ít nội dung co lại — cũng sai.)
   FIX: set height = 69px (≥ nội dung lớn nhất) → KHÔNG td nào phải giãn thêm →
   mọi td đúng 69 → đáy bằng nhau → đường kẻ thẳng tuyệt đối ở MỌI nick (đầu/giữa/cuối). */
/* 2026-06-05 v11 (Anh: line nhiều-nick vẫn lệch ~0.5px) — số đo spread=0 nhưng
   hàng cha cao LẺ → fr0 bắt đầu Y=.5 → border-bottom rơi ranh giới sub-pixel →
   antialiasing 1 đường nét, đường kia mờ 2px → trông dày mỏng không đều.
   FIX: thay border-bottom (table sub-pixel) bằng box-shadow inset 0 -1px — render
   sắc nét 1px đồng nhất mọi hàng, không bị half-pixel làm mờ. */
.fr-row > td {
  padding: 6px 6px; vertical-align: top; height: 69px; overflow: hidden;
  border-bottom: 0;
  box-shadow: inset 0 -1px 0 0 var(--smax-grey-200);
}
/* ROOT CAUSE (đo browse): span ".empty" (dấu "—" cột KH/Sale nhắn cuối + Tags
   khi rỗng) tự cao 81px → kéo hàng lên 95px. Ép cứng cao 25px (= dòng 1) để cột
   rỗng KHÔNG kéo hàng. !important thắng mọi rule kế thừa flex-stretch. */
.fr-row .empty {
  display: inline-block !important;
  height: 25px !important;
  line-height: 25px !important;
  vertical-align: top !important;
  align-self: flex-start !important;
}
.fr-row .tag-cell { align-items: flex-start; align-content: flex-start; }
/* Dòng 1 cao 25px khớp avatar; ngày giờ tin = dòng 1. */
.fr-row .cl-name-line { min-height: 25px; }
.fr-row .cell-strong { line-height: 25px; }
/* 2026-06-05 (Anh: nick cuối lệch lên 1-2px) — border-bottom 2px của is-last ăn
   vào content-box (height cố định 67px) → đẩy nội dung lên 1px so nick thường 1px.
   FIX: giữ 1px (cùng độ dày → avatar mọi nick cùng top), màu đậm hơn để vẫn phân cách. */
/* is-last: đáy đậm hơn (phân cách block nick cuối ↔ KH cha kế) — dùng box-shadow
   cho nhất quán + sắc nét như các nick khác (không bị half-pixel). */
.fr-row.is-last > td { border-bottom: 0; box-shadow: inset 0 -1px 0 0 var(--line); }
.fr-row.is-last .fr-name { box-shadow: inset 3px 0 0 var(--smax-grey-300), inset 0 -1px 0 0 var(--line); }
.fr-row.is-last.kb-yes .fr-name { box-shadow: inset 3px 0 0 var(--smax-success), inset 0 -1px 0 0 var(--line); }
.fr-row.is-last.kb-pending .fr-name { box-shadow: inset 3px 0 0 var(--smax-warning), inset 0 -1px 0 0 var(--line); }
.fr-row.is-last.kb-info .fr-name { box-shadow: inset 3px 0 0 var(--smax-info), inset 0 -1px 0 0 var(--line); }
.fr-row.is-last.kb-off .fr-name { box-shadow: inset 3px 0 0 var(--ink-4), inset 0 -1px 0 0 var(--line); }

/* accent rail = inset shadow trái trên ô Tên (KHÔNG cột riêng → gióng cột chuẩn) */
/* 2026-06-05 v11 — fr-name cần CẢ rail trái (3px màu KB) VÀ đường đáy (-1px) trong
   1 box-shadow (rule này specificity > .fr-row>td nên phải tự gộp, không kế thừa). */
.fr-name { box-shadow: inset 3px 0 0 var(--smax-grey-300), inset 0 -1px 0 0 var(--smax-grey-200); }
.fr-row.kb-yes .fr-name { box-shadow: inset 3px 0 0 var(--smax-success), inset 0 -1px 0 0 var(--smax-grey-200); }
.fr-row.kb-pending .fr-name { box-shadow: inset 3px 0 0 var(--smax-warning), inset 0 -1px 0 0 var(--smax-grey-200); }
.fr-row.kb-info .fr-name { box-shadow: inset 3px 0 0 var(--smax-info), inset 0 -1px 0 0 var(--smax-grey-200); }
.fr-row.kb-off .fr-name { box-shadow: inset 3px 0 0 var(--ink-4), inset 0 -1px 0 0 var(--smax-grey-200); }

.fr-nm { font-size: 12.5px; font-weight: 600; }
.fr-trophy { flex: 0 0 auto; color: #f9a825; font-size: 11px; }
.fr-chatdot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--smax-success); }
.fr-chatdot.off { background: var(--smax-grey-300); }
/* 2026-06-05 (Anh chốt) — ô "tên nhớ" KHÔNG tràn: giới hạn trong cột Tên,
   max-width gọn, viền hover mảnh không đẩy layout (đã có border 1px sẵn nên
   hover chỉ đổi màu border → không nhảy width). overflow ellipsis 1 dòng. */
.fr-alias {
  width: 100%; max-width: 150px; min-width: 0; box-sizing: border-box;
  border: 1px solid transparent; border-radius: 5px; padding: 1px 5px;
  font: inherit; font-size: 11px; background: transparent; color: var(--smax-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fr-alias::placeholder { color: var(--smax-grey-400); font-style: italic; }
.fr-alias:hover { border-color: var(--smax-grey-300); background: var(--surface); }
.fr-alias:focus { outline: none; border-color: var(--smax-primary); background: var(--surface); }
.fr-sync-hint { font-size: 10px; color: var(--info); white-space: nowrap; cursor: help; }
.fr-status-btn { border: 0; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-score { width: 34px; box-sizing: border-box; text-align: center; padding: 2px; border: 1px solid transparent; border-radius: 5px; font: inherit; font-weight: 700; font-size: 11.5px; -moz-appearance: textfield; }
.fr-score::-webkit-outer-spin-button, .fr-score::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.fr-score:hover, .fr-score:focus { border-color: var(--smax-grey-300); background: var(--surface); outline: none; }
.fr-score.chip-success { background: rgba(0,200,83,.15); color: var(--success); }
.fr-score.chip-warning { background: rgba(255,145,0,.15); color: var(--warning); }
.fr-score.chip-error { background: rgba(255,61,0,.13); color: var(--error); }
.fr-became, .fr-sale { display: block; font-size: 11px; color: var(--smax-grey-700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 2026-06-05 (Anh chốt) — text UID/GlobalId/Username friend row: click để copy. */
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
.fr-copy {
  display: inline-block; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer; color: var(--smax-grey-700);
  border-bottom: 1px dashed var(--smax-grey-300);
}
.fr-copy:hover { color: var(--smax-primary); border-bottom-color: var(--smax-primary); }
.fr-copy:active { color: var(--smax-primary); }
.fr-io { font-size: 12px; white-space: nowrap; }
.fr-io b { font-weight: 700; }
/* Friend Tag chip (cột Tags hàng con) */
.fr-row .ftag { display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; border-radius: 8px; font-size: 9.5px; font-weight: 600; border: 1px solid; white-space: nowrap; }
.fr-row .ft-zalo { background: #fff8f0; border-color: #ff9800; color: var(--warning); }
.fr-row .ft-manual { background: #f0f7ff; border-color: #42a5f5; color: var(--info); }
.fr-row .ft-auto { background: #faf3fc; border-color: #ce93d8; color: #6a1b9a; }
.fr-row .ft-score { background: rgba(0,200,83,.08); border-color: #66bb6a; color: var(--success); }
.fr-row .ft-sync { background: var(--smax-grey-100); border-color: var(--smax-grey-300); color: var(--smax-grey-700); }
.child-empty { padding: 9px 13px; font-size: 12px; color: var(--smax-grey-700); }

/* ═══════════ P3 markup redesign — HS theme header / filter / KPI (2026-06-17) ═══════════ */
/* line-icon (Lucide-style stroke SVG) */
.lc { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none;
      stroke-linecap: round; stroke-linejoin: round; flex: none; vertical-align: -2px; }

/* Header: title + count pill */
.page-header-row { align-items: center; }
.ph-title { display: flex; align-items: center; gap: 11px; }
.ph-title h1 { margin: 0; }
.count-pill { display: inline-flex; align-items: center; gap: 5px; background: var(--brand-soft);
  color: var(--brand-700); padding: 4px 11px; border-radius: var(--r-pill, 999px);
  font-size: 12px; font-weight: 700; line-height: 1; }
.count-pill .lc { width: 13px; height: 13px; }

/* Header actions: 1 primary + segmented utility cluster */
.header-actions { gap: 10px; }
.header-actions .btn-primary { display: inline-flex; align-items: center; gap: 7px; height: 38px;
  padding: 0 16px; border-radius: var(--r-sm, 8px); background: var(--brand); border: 1px solid var(--brand);
  color: #fff; font-weight: 700; font-size: 13px; box-shadow: 0 1px 2px rgba(16,24,40,.06); cursor: pointer; }
.header-actions .btn-primary:hover { background: var(--brand-600); border-color: var(--brand-600); }
.seg-cluster { display: inline-flex; align-items: stretch; border: 1px solid var(--line);
  border-radius: var(--r-sm, 8px); overflow: hidden; background: var(--surface); }
.seg-btn { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 13px;
  border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--ink-2);
  font-weight: 600; font-size: 12.5px; cursor: pointer; font-family: inherit; }
.seg-btn:hover { background: var(--surface-3); color: var(--ink); }
.seg-btn.on { background: var(--brand-soft); color: var(--brand-700); }
.seg-cluster .view-toggle { display: inline-flex; align-items: stretch; background: transparent;
  border: 0; padding: 0; margin: 0; border-radius: 0; }
.seg-cluster .view-btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 13px;
  border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--ink-3);
  font-weight: 600; font-size: 12.5px; cursor: pointer; font-family: inherit; }
.seg-cluster .view-btn:last-child { border-right: 0; }
.seg-cluster .view-btn.active { background: var(--brand); color: #fff; }
.seg-btn .btn-badge, .seg-cluster .btn-badge { background: var(--brand); color: #fff; }

/* Filter toolbar → search box + pill selects */
.toolbar.toolbar-primary { gap: 9px; align-items: center; }
.tb-search { display: flex; align-items: center; gap: 8px; background: var(--surface-2);
  border: 1px solid var(--line); border-radius: var(--r-pill, 999px); padding: 0 14px;
  flex: 1 1 240px; min-width: 200px; max-width: 440px; color: var(--ink-4); height: 38px;
  transition: border-color .12s, box-shadow .12s; }
.tb-search:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); color: var(--brand); }
.tb-search .toolbar-search { border: 0 !important; background: none !important; outline: none;
  flex: 1; min-width: 0; font-size: 13px; color: var(--ink); height: 100%; padding: 0; max-width: none; }
.toolbar.toolbar-primary select { height: 36px; border: 1px solid var(--line); border-radius: var(--r-pill, 999px);
  background: var(--surface); color: var(--ink-2); font-weight: 600; font-size: 12.5px; padding: 0 14px; cursor: pointer; }
.toolbar.toolbar-primary select:hover { border-color: var(--brand); color: var(--ink); }

/* KPI stats — colored dot instead of emoji */
.sdot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }
.stat-box .sdot { margin-right: 1px; }
</style>
