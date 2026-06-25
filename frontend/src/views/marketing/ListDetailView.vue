<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="list-detail-view">
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <a @click="$router.push('/marketing/lists')">
        <v-icon size="14">mdi-folder-account-outline</v-icon> Tệp khách hàng
      </a>
      <v-icon size="14" class="sep">mdi-chevron-right</v-icon>
      <span>{{ currentList?.name ?? '...' }}</span>
    </div>

    <!-- Hero: title + actions + stats -->
    <div v-if="currentList" class="detail-hero">
      <div class="hero-head">
        <div style="min-width:0; flex:1;">
          <h2>
            <span class="hero-ico"><v-icon size="20">mdi-folder-account-outline</v-icon></span>
            <template v-if="!editingTitle">
              <span class="title-text" @click="startEditTitle" title="Click để đổi tên">
                {{ currentList.name }}
              </span>
            </template>
            <input
              v-else
              ref="titleInputRef"
              v-model="titleDraft"
              class="title-input"
              :disabled="savingTitle"
              @keydown.enter="commitTitle"
              @keydown.esc="cancelEditTitle"
              @blur="commitTitle"
            />
            <span v-if="currentList.archivedAt" class="chip chip-grey">
              <v-icon size="13">mdi-archive</v-icon> Lưu trữ
            </span>
          </h2>
          <div class="sub">
            Tạo <b>{{ formatDate(currentList.createdAt) }}</b>
            bởi <b>{{ currentList.createdBy?.fullName ?? currentList.createdBy?.email ?? '—' }}</b>
            · Nguồn <b>{{ sourceLabel(currentList.sourceType) }}</b>
          </div>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary btn-sm" @click="onCreateMucTieu">
            <v-icon size="16">mdi-target</v-icon>
            Tạo Mục tiêu từ tệp này
          </button>
          <button
            class="btn btn-sm"
            :class="currentList?.leadNotifyEnabled ? 'btn-running' : 'btn-ghost'"
            :title="currentList?.leadNotifyEnabled ? 'Tự động giao & báo ĐANG CHẠY — bấm để cấu hình' : 'Tự động giao sale + báo lead mới khi vào tệp'"
            @click="showLeadNotify = true"
          >
            <v-icon size="16">{{ currentList?.leadNotifyEnabled ? 'mdi-checkbox-blank-circle' : 'mdi-bell-ring-outline' }}</v-icon>
            {{ currentList?.leadNotifyEnabled ? 'Đang chạy' : 'Tự động giao & báo' }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="onRescan">
            <v-icon size="16">mdi-refresh</v-icon>
            Quét lại Zalo
          </button>
          <button class="btn btn-ghost btn-sm">
            <v-icon size="16">mdi-download</v-icon>
            Export CSV
          </button>
          <v-menu :close-on-content-click="true">
            <template #activator="{ props: act }">
              <button v-bind="act" class="btn btn-ghost btn-icon btn-sm">
                <v-icon size="16">mdi-dots-vertical</v-icon>
              </button>
            </template>
            <v-list density="compact" min-width="200">
              <v-list-item
                v-if="currentList.archivedAt"
                @click="onUnarchive"
                prepend-icon="mdi-archive-arrow-up-outline"
              >
                <v-list-item-title>Đưa khỏi lưu trữ</v-list-item-title>
              </v-list-item>
              <v-list-item
                v-else
                @click="onArchive"
                prepend-icon="mdi-archive-outline"
              >
                <v-list-item-title>Lưu trữ</v-list-item-title>
              </v-list-item>
              <v-divider />
              <v-list-item @click="onDelete" prepend-icon="mdi-delete-outline">
                <v-list-item-title class="del-title">Xoá tệp</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </div>

      <!-- Hero stats — clickable to filter tab -->
      <div class="hero-stats">
        <div
          class="hero-stat"
          :class="{ active: entryTab === 'all' }"
          @click="setTab('all')"
        >
          <div class="l">Tổng SĐT</div>
          <div class="v">{{ currentList.totalEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">100%</div>
        </div>
        <div
          class="hero-stat green"
          :class="{ active: entryTab === 'valid' }"
          @click="setTab('valid')"
        >
          <div class="l">Hợp lệ</div>
          <div class="v">{{ currentList.validEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ pct(currentList.validEntries, currentList.totalEntries) }}%</div>
        </div>
        <div
          class="hero-stat red"
          :class="{ active: entryTab === 'invalid' }"
          @click="setTab('invalid')"
        >
          <div class="l">Số không hợp lệ</div>
          <div class="v">{{ currentList.invalidEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ pct(currentList.invalidEntries, currentList.totalEntries) }}%</div>
        </div>
        <div
          class="hero-stat amber"
          :class="{ active: entryTab === 'dup' }"
          @click="setTab('dup')"
        >
          <div class="l">Trùng</div>
          <div class="v">{{ dupTotal(currentList).toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ currentList.dupInListEntries }} list + {{ currentList.dupWithContactEntries }} CRM</div>
        </div>
        <div
          class="hero-stat blue"
          :class="{ active: entryTab === 'has_zalo' }"
          @click="setTab('has_zalo')"
          title="Đã match Friend table hoặc SDK lookup xác nhận có Zalo"
        >
          <div class="l">Đã có Zalo</div>
          <div class="v">{{ currentList.hasZaloEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ pct(currentList.hasZaloEntries, currentList.validEntries) }}% / hợp lệ</div>
        </div>
        <div
          class="hero-stat"
          :class="{ active: entryTab === 'no_zalo' }"
          @click="setTab('no_zalo')"
          title="Số hợp lệ nhưng chưa rõ có Zalo. Đưa vào Campaign để quét xác minh."
        >
          <div class="l">Đang chờ Quét</div>
          <div class="v">{{ notScannedSdk.toLocaleString('vi-VN') }}</div>
          <div class="pct">cần Campaign quét xác nhận</div>
        </div>
      </div>
    </div>

    <!-- Sub-tabs filter -->
    <div class="subtabs">
      <button class="subtab" :class="{ active: entryTab === 'all' }" @click="setTab('all')">
        Tất cả <span class="count">{{ currentList?.totalEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'valid' }" @click="setTab('valid')">
        <v-icon size="13" class="st-green">mdi-check-circle</v-icon> Hợp lệ <span class="count">{{ currentList?.validEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'invalid' }" @click="setTab('invalid')">
        <v-icon size="13" class="st-ink">mdi-circle</v-icon> Số không hợp lệ <span class="count">{{ currentList?.invalidEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup' }" @click="setTab('dup')">
        <v-icon size="13" class="st-orange">mdi-circle</v-icon> Trùng <span class="count">{{ dupTotal(currentList).toLocaleString('vi-VN') }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_in_list' }" @click="setTab('dup_in_list')">
        <v-icon size="13" class="st-orange">mdi-circle</v-icon> Trùng trong tệp <span class="count">{{ currentList?.dupInListEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_cross_list' }" @click="setTab('dup_cross_list')">
        <v-icon size="13" class="st-orange">mdi-circle</v-icon> Trùng tệp khác <span class="count">{{ currentList?.dupCrossListEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_with_crm' }" @click="setTab('dup_with_crm')">
        <v-icon size="13" class="st-ink2">mdi-lock</v-icon> Đã là khách CRM <span class="count">{{ currentList?.dupWithContactEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'has_zalo' }" @click="setTab('has_zalo')">
        <v-icon size="13" class="st-green">mdi-circle</v-icon> Có Zalo <span class="count">{{ currentList?.hasZaloEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'no_zalo' }" @click="setTab('no_zalo')" title="Đã check Friend, chưa rõ có Zalo — cần Campaign quét xác nhận">
        <v-icon size="13" class="st-blue">mdi-circle</v-icon> Đang chờ Quét <span class="count">{{ notScannedSdk }}</span>
      </button>
    </div>

    <!-- Filter strip -->
    <div class="filter-strip">
      <div class="search">
        <v-icon size="14">mdi-magnify</v-icon>
        <input
          v-model="entrySearch"
          placeholder="Tìm SĐT, tên KH, UID..."
          @input="debouncedFetchEntries"
        />
      </div>
      <!-- Column visibility menu -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props: act }">
          <button v-bind="act" class="btn btn-ghost btn-sm col-toggle-btn" title="Ẩn / hiện cột">
            <v-icon size="14">mdi-view-column-outline</v-icon>
            Cột {{ visibleColCount }}/{{ ALL_COLUMNS.length }}
            <v-icon size="13">mdi-chevron-down</v-icon>
          </button>
        </template>
        <v-list density="compact" min-width="240">
          <v-list-item
            v-for="col in ALL_COLUMNS"
            :key="col.key"
            @click="toggleColumn(col.key)"
          >
            <template #prepend>
              <v-icon size="16" :class="isColVisible(col.key) ? 'col-on' : 'col-off'">
                {{ isColVisible(col.key) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
              </v-icon>
            </template>
            <v-list-item-title class="col-label">{{ col.label }}</v-list-item-title>
          </v-list-item>
          <v-divider />
          <v-list-item @click="resetColumns">
            <template #prepend>
              <v-icon size="16" class="col-reset-ico">mdi-restore</v-icon>
            </template>
            <v-list-item-title class="col-reset">Reset về mặc định</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>

    <!-- Entries table -->
    <LeadNotifyTimeline
      v-if="currentList?.leadNotifyEnabled"
      :list-id="listId"
      @open-entry="onTimelineOpenEntry"
    />

    <div class="entries-wrap">
      <table class="tbl entries-table">
        <thead>
          <tr>
            <th style="width:30px">
              <input
                type="checkbox"
                class="chk"
                :checked="allSelectedVisible"
                :indeterminate.prop="someSelected && !allSelectedVisible"
                @change="onToggleAllVisible"
              />
            </th>
            <th class="sortable" :class="{ sorted: entrySort === 'rowIndex' }" title="Thứ tự thêm — bấm để sắp xếp" @click="toggleSort('rowIndex')">
              # <v-icon size="12" class="th-i">{{ sortIcon('rowIndex') }}</v-icon>
            </th>
            <th v-show="isColVisible('updatedAt')" class="sortable" :class="{ sorted: entrySort === 'updatedAt' }" title="Ngày giờ cập nhật gần nhất của khách — bấm để sắp xếp" @click="toggleSort('updatedAt')">
              Ngày cập nhật <v-icon size="12" class="th-i">{{ sortIcon('updatedAt') }}</v-icon>
            </th>
            <th v-show="isColVisible('source')" title="Nguồn lead: Facebook / TikTok / Zalo / Thủ công">Nguồn</th>
            <th v-show="isColVisible('assignStatus')" title="Lead đã được tự động giao cho sale nào chưa (ô Tự động giao & báo)">Trạng thái giao</th>
            <th v-show="isColVisible('phoneRaw')"       title="Phone gốc anh paste">Phone (paste)</th>
            <th v-show="isColVisible('phoneE164')" class="sortable" :class="{ sorted: entrySort === 'phoneE164' }" title="Phone E.164 chuẩn quốc tế — bấm để sắp xếp" @click="toggleSort('phoneE164')">Phone (+84) <v-icon size="12" class="th-i">{{ sortIcon('phoneE164') }}</v-icon></th>
            <th v-show="isColVisible('phoneLocal')"     title="Phone local VN (0xxx)">Phone (local)</th>
            <th v-show="isColVisible('nameRaw')" class="sortable" :class="{ sorted: entrySort === 'nameRaw' }" title="Tên KH theo file — bấm để sắp xếp A→Z" @click="toggleSort('nameRaw')">Tên KH (file) <v-icon size="12" class="th-i">{{ sortIcon('nameRaw') }}</v-icon></th>
            <th v-show="isColVisible('fbName')" title="Tên thật trên Facebook của khách (lấy từ hội thoại, nếu khách đã nhắn tin)">Tên KH (Facebook)</th>
            <th v-show="isColVisible('nameZalo')" class="sortable" :class="{ sorted: entrySort === 'zaloName' }" title="Tên KH trên Zalo — bấm để sắp xếp A→Z" @click="toggleSort('zaloName')">Tên KH (Zalo) <v-icon size="12" class="th-i">{{ sortIcon('zaloName') }}</v-icon></th>
            <th v-show="isColVisible('personalNote')"   title="Lời mời / tin nhắn riêng cho KH này (chỉ có khi import từ CSV/Excel)">Lời mời riêng</th>
            <th v-show="isColVisible('lifecycle')"      title="Lifecycle 5 ô: Mới / Đang chờ Quét / Có Zalo / Không có Zalo / Lỗi">Trạng thái</th>
            <th v-show="isColVisible('sequenceAttach')" title="Số lần SĐT này đã được gắn sequence (tự động + thủ công). Soi trước khi chạy để loại SĐT gắn quá nhiều.">Đã gắn sequence</th>
            <th v-show="isColVisible('friendInvite')"   title="Số lần SĐT này đã được gửi lời mời kết bạn (cộng dồn mọi chiến dịch). Soi để loại SĐT bị gửi quá nhiều.">Đã gửi kết bạn</th>
            <th v-show="isColVisible('zaloUid')">Zalo UID</th>
            <th v-show="isColVisible('resolvedByNick')">Nick tìm ra</th>
            <th v-show="isColVisible('zaloGlobalId')">Global ID</th>
            <th v-show="isColVisible('systemMessages')" title="Stack thông báo hệ thống — trùng, sale loại, số sai cụ thể... (newest top, hover xem full)">Thông báo hệ thống</th>
            <th v-show="isColVisible('fbCampaign')"     title="Tên chiến dịch quảng cáo Facebook">Chiến dịch</th>
            <th v-show="isColVisible('fbAdset')"        title="Nhóm quảng cáo (ad set)">Nhóm quảng cáo</th>
            <th v-show="isColVisible('fbAd')"           title="Tên quảng cáo (ad creative)">Quảng cáo</th>
            <th v-show="isColVisible('fbSubmittedAt')"  title="Thời điểm khách điền form (đồng bộ từ Facebook, giờ Việt Nam)">Ngày điền form</th>
            <th v-show="isColVisible('fbForm')"         title="Form quảng cáo Facebook">Form</th>
            <th v-show="isColVisible('fbLeadId')"       title="Mã lead duy nhất từ Facebook">Mã lead</th>
            <th class="right">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingEntries">
            <td :colspan="dynamicColspan" class="loading-cell"><v-icon size="15" class="spin">mdi-loading</v-icon> Đang tải...</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td :colspan="dynamicColspan" class="empty-cell">Không có SĐT nào ở tab này</td>
          </tr>
          <tr
            v-for="entry in entries"
            :key="entry.id"
            :class="{ selected: isSelected(entry.id) }"
            @click="onRowClick(entry.id, $event)"
          >
            <td @click.stop>
              <input
                type="checkbox"
                class="chk"
                :checked="isSelected(entry.id)"
                @change="toggleSelect(entry.id)"
              />
            </td>
            <td class="ix">#{{ entry.rowIndex }}</td>
            <td v-show="isColVisible('updatedAt')" class="updated-cell" :title="entry.updatedAt ? formatInOrgTz(entry.updatedAt) : ''">
              <span v-if="entry.updatedAt">{{ formatInOrgTz(entry.updatedAt) }}</span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('source')" class="src-cell">
              <span class="src-badge" :class="'src-' + entrySourceBadge(entry).key">{{ entrySourceBadge(entry).icon }} {{ entrySourceBadge(entry).label }}</span>
            </td>
            <td v-show="isColVisible('assignStatus')" class="assign-status-cell">
              <span class="assign-badge" :class="'assign-' + assignStatus(entry).state" :title="assignStatus(entry).title">
                {{ assignStatus(entry).label }}
              </span>
            </td>
            <!-- Editable phoneRaw — Enter sẽ re-validate + re-dedup -->
            <td v-show="isColVisible('phoneRaw')" class="phone-cell raw editable cell-scroll" @click.stop="startEdit(entry.id, 'phoneRaw', entry.phoneRaw)">
              <input
                v-if="editing && editing.entryId === entry.id && editing.field === 'phoneRaw'"
                v-model="editing.value"
                class="cell-input"
                :class="{ saving: savingEntryId === entry.id }"
                :disabled="savingEntryId === entry.id"
                ref="editInputRef"
                @click.stop
                @keydown.enter="commitEdit"
                @keydown.esc="cancelEdit"
                @blur="commitEdit"
              />
              <span v-else class="cell-content">{{ entry.phoneRaw }}</span>
            </td>
            <!-- Readonly: auto-derive từ phoneRaw -->
            <td v-show="isColVisible('phoneE164')" class="phone-cell e164 readonly cell-scroll" :title="'Tự derive từ Phone (paste). KHÔNG edit ở đây.'">
              <span class="cell-content">{{ entry.phoneE164 || '—' }}</span>
            </td>
            <td v-show="isColVisible('phoneLocal')" class="phone-cell local readonly cell-scroll" :title="'Tự derive từ Phone (paste). KHÔNG edit ở đây.'">
              <span class="cell-content">{{ entry.phoneLocal || '—' }}</span>
            </td>
            <!-- Editable nameRaw -->
            <td v-show="isColVisible('nameRaw')" class="name editable cell-scroll" @click.stop="startEdit(entry.id, 'nameRaw', entry.nameRaw ?? '')">
              <input
                v-if="editing && editing.entryId === entry.id && editing.field === 'nameRaw'"
                v-model="editing.value"
                class="cell-input"
                :disabled="savingEntryId === entry.id"
                ref="editInputRef"
                @click.stop
                @keydown.enter="commitEdit"
                @keydown.esc="cancelEdit"
                @blur="commitEdit"
              />
              <span v-else-if="entry.nameRaw" class="cell-content">{{ entry.nameRaw }}</span>
              <span v-else class="muted-italic">(click để thêm)</span>
            </td>
            <!-- Tên thật trên Facebook (readonly, nhất quán với cột Zalo) -->
            <td v-show="isColVisible('fbName')" class="name-fb readonly cell-scroll" :class="fbMeta(entry).fbProfileName ? 'has' : 'no'" :title="fbMeta(entry).fbProfileName || ''">
              <span class="cell-content">
                <span v-if="fbMeta(entry).fbProfileName" class="fb-ico-inline">f</span>
                <template v-if="fbMeta(entry).fbProfileName">{{ fbMeta(entry).fbProfileName }}</template>
                <template v-else class="muted-italic">(chưa có)</template>
              </span>
            </td>
            <td v-show="isColVisible('nameZalo')" class="name-zalo readonly cell-scroll" :class="entry.zaloName ? 'has' : 'no'">
              <span class="cell-content">
                <template v-if="entry.zaloName">{{ entry.zaloName }}</template>
                <template v-else-if="entry.status === 'invalid'">—</template>
                <template v-else>(chưa có)</template>
              </span>
            </td>
            <!-- Editable personalNote -->
            <td v-show="isColVisible('personalNote')" class="personal-note editable cell-scroll" :title="entry.personalNote || 'Click để thêm lời mời'" @click.stop="startEdit(entry.id, 'personalNote', entry.personalNote ?? '')">
              <input
                v-if="editing && editing.entryId === entry.id && editing.field === 'personalNote'"
                v-model="editing.value"
                class="cell-input"
                :disabled="savingEntryId === entry.id"
                ref="editInputRef"
                @click.stop
                @keydown.enter="commitEdit"
                @keydown.esc="cancelEdit"
                @blur="commitEdit"
              />
              <span v-else-if="entry.personalNote" class="cell-content">{{ entry.personalNote }}</span>
              <span v-else class="muted-italic">(click để thêm)</span>
            </td>
            <!-- Cột 1: Lifecycle (5 ô cố định) -->
            <td v-show="isColVisible('lifecycle')" class="lifecycle-cell">
              <span class="chip" :class="lifecycle(entry).chip">
                <v-icon size="12">{{ lifecycle(entry).icon }}</v-icon>
                {{ lifecycle(entry).label }}
              </span>
            </td>
            <td v-show="isColVisible('sequenceAttach')" class="seq-cell">
              <span
                v-if="(entry.sequenceAttachCount ?? 0) > 0"
                class="chip-seq"
                :title="`Đã gắn ${entry.sequenceAttachCount} sequence (${entry.sequenceActiveCount ?? 0} đang chạy) — tính cả tự động lẫn thủ công`"
              >🔁 {{ entry.sequenceAttachCount }}<template v-if="(entry.sequenceActiveCount ?? 0) > 0"> · {{ entry.sequenceActiveCount }} chạy</template></span>
              <span v-else class="seq-none">—</span>
            </td>
            <td v-show="isColVisible('friendInvite')" class="seq-cell">
              <span
                v-if="(entry.friendInviteSentCount ?? 0) > 0"
                class="chip-fi"
                :title="`Đã gửi lời mời kết bạn ${entry.friendInviteSentCount} lần cho SĐT này (cộng dồn mọi chiến dịch)`"
              >📨 {{ entry.friendInviteSentCount }}</span>
              <span v-else class="seq-none">—</span>
            </td>
            <td v-show="isColVisible('zaloUid')" class="uid-cell cell-scroll" :class="{ empty: !entry.zaloUid }">
              <span class="cell-content">{{ entry.zaloUid || '—' }}</span>
            </td>
            <td v-show="isColVisible('resolvedByNick')" class="cell-scroll">
              <span v-if="entry.resolvedByNick" class="nick-cell cell-content">
                <span class="av" :style="nickAvatarStyle(entry.resolvedByNick.displayName ?? '?')">
                  {{ initials(entry.resolvedByNick.displayName ?? '?') }}
                </span>
                {{ entry.resolvedByNick.displayName ?? '—' }}
                <span v-if="entry.multiNickCount > 0" class="more">+{{ entry.multiNickCount }}</span>
              </span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('zaloGlobalId')" class="cell-scroll">
              <span v-if="entry.zaloGlobalId" class="global-id cell-content">{{ entry.zaloGlobalId }}</span>
              <span v-else class="global-id empty">—</span>
            </td>
            <!-- Cột 2: System Messages (stack, newest top, hover xem full) -->
            <td v-show="isColVisible('systemMessages')" class="system-messages-cell">
              <template v-if="sortedMessages(entry.systemMessages).length === 0">
                <span class="muted-italic">—</span>
              </template>
              <template v-else>
                <div class="msg-stack">
                  <div
                    v-for="(msg, idx) in sortedMessages(entry.systemMessages)"
                    :key="idx"
                    class="msg-item"
                    :class="{ 'msg-newest': idx === 0 }"
                  >
                    <v-icon size="11" class="msg-ico" :class="systemMessageIcon(msg.type).cls">{{ systemMessageIcon(msg.type).icon }}</v-icon>
                    <span class="msg-text">{{ msg.text }}</span>
                  </div>
                </div>
                <div class="msg-tooltip">
                  <div class="msg-tooltip-title">Lịch sử thông báo ({{ sortedMessages(entry.systemMessages).length }})</div>
                  <div
                    v-for="(msg, idx) in sortedMessages(entry.systemMessages)"
                    :key="idx"
                    class="msg-tooltip-item"
                  >
                    <v-icon size="12" class="msg-ico" :class="systemMessageIcon(msg.type).cls">{{ systemMessageIcon(msg.type).icon }}</v-icon>
                    <div class="msg-tooltip-body">
                      <div>{{ msg.text }}</div>
                      <div class="msg-tooltip-ts">{{ formatMsgTs(msg.ts) }}</div>
                    </div>
                  </div>
                </div>
              </template>
            </td>
            <td v-show="isColVisible('fbCampaign')" class="fb-cell cell-scroll" :title="fbMeta(entry).campaignName || '—'">
              <span v-if="fbMeta(entry).campaignName" class="cell-content">{{ fbMeta(entry).campaignName }}</span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('fbAdset')" class="fb-cell cell-scroll" :title="fbMeta(entry).adsetName || '—'">
              <span v-if="fbMeta(entry).adsetName" class="cell-content">{{ fbMeta(entry).adsetName }}</span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('fbAd')" class="fb-cell cell-scroll" :title="fbMeta(entry).adName || '—'">
              <span v-if="fbMeta(entry).adName" class="cell-content">{{ fbMeta(entry).adName }}</span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('fbSubmittedAt')" class="fb-cell">
              <span v-if="fbSubmittedAtVN(entry)">{{ fbSubmittedAtVN(entry) }}</span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('fbForm')" class="fb-cell cell-scroll" :title="fbMeta(entry).formName || fbMeta(entry).formId || '—'">
              <span v-if="fbMeta(entry).formName || fbMeta(entry).formId" class="cell-content">{{ fbMeta(entry).formName || fbMeta(entry).formId }}</span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('fbLeadId')" class="fb-cell mono-cell">
              <span v-if="fbMeta(entry).externalLeadId">{{ fbMeta(entry).externalLeadId }}</span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td class="row-actions" @click.stop>
              <button class="icon-btn" title="Xem chi tiết" @click="openDetailPanel(entry.id)">
                <v-icon size="13">mdi-eye-outline</v-icon>
              </button>
              <a v-if="entry.phoneE164 || entry.phoneLocal" class="icon-btn" title="Gọi" :href="`tel:${entry.phoneE164 || entry.phoneLocal}`">
                <v-icon size="13">mdi-phone-outline</v-icon>
              </a>
              <button v-if="entry.hasZalo !== true" class="icon-btn zalo" title="Tìm Zalo cho KH này" :disabled="rowFinding === entry.id" @click="(e) => openRowFindZalo(entry, e)">
                <v-icon size="13">mdi-magnify</v-icon>
              </button>
              <button v-if="entry.hasZalo === true" class="icon-btn ok" title="Mở chat Zalo" @click="openRowChat(entry)">
                <v-icon size="13">mdi-chat-outline</v-icon>
              </button>
              <button class="icon-btn" title="Mở Contact" v-if="entry.contactId" @click="openContact(entry.contactId)">
                <v-icon size="13">mdi-open-in-new</v-icon>
              </button>
              <button class="icon-btn danger" title="Xoá entry (có thể hoàn tác trong 5s)" @click="onDeleteRow(entry)">
                <v-icon size="13">mdi-delete-outline</v-icon>
              </button>
            </td>
          </tr>
          <!-- Add row footer: cho phép paste 1 hoặc nhiều dòng -->
          <tr class="add-row">
            <td></td>
            <td class="ix add-ix"><v-icon size="14">mdi-plus</v-icon></td>
            <td :colspan="visibleColCount + 1">
              <input
                v-model="addRowText"
                class="add-input"
                :placeholder="addingRows ? 'Đang thêm...' : 'Thêm SĐT thủ công — gõ 1 số hoặc paste nhiều dòng → Enter'"
                :disabled="addingRows"
                @keydown.enter="onAddRow"
                @paste="onAddRowPaste"
              />
              <span class="add-hint">Format: <code>0908123456 Tên KH</code> hoặc nhiều dòng cùng lúc</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Undo delete toast -->
    <Transition name="toast-fade">
      <div v-if="undoToast" class="undo-toast">
        <span><v-icon size="15">mdi-delete-outline</v-icon> Đã xoá <b>{{ undoToast.label }}</b></span>
        <button class="undo-btn" @click="onUndoDelete"><v-icon size="14">mdi-undo</v-icon> Hoàn tác ({{ undoCountdown }}s)</button>
      </div>
    </Transition>

    <!-- Flash info toast (cảnh báo dup / thêm xong / ...) -->
    <Transition name="toast-fade">
      <div v-if="flashMsg" class="flash-toast">{{ flashMsg }}</div>
    </Transition>

    <!-- Pagination -->
    <div v-if="entriesTotal > entryLimit" class="pag">
      <span>
        Hiện <b>{{ ((entryPage - 1) * entryLimit) + 1 }}–{{ Math.min(entryPage * entryLimit, entriesTotal) }}</b>
        / <b>{{ entriesTotal.toLocaleString('vi-VN') }}</b> SĐT
      </span>
      <div class="ctrls">
        <button :disabled="entryPage === 1" @click="goPage(entryPage - 1)"><v-icon size="14">mdi-chevron-left</v-icon> Trước</button>
        <button class="cur">{{ entryPage }}</button>
        <button :disabled="entryPage * entryLimit >= entriesTotal" @click="goPage(entryPage + 1)">Sau <v-icon size="14">mdi-chevron-right</v-icon></button>
      </div>
    </div>

    <!-- Bulk action bar -->
    <div v-if="selectedCount > 0" class="bulk-bar">
      <span class="ct"><em>{{ selectedCount }}</em>SĐT đã chọn</span>
      <span class="div"></span>
      <button @click="onBulk('skip')"><v-icon size="14">mdi-refresh</v-icon> Bỏ qua (skip)</button>
      <button @click="onBulk('keep_both')"><v-icon size="14">mdi-plus-circle-outline</v-icon> Tạo song song</button>
      <button @click="onBulk('delete')" class="danger"><v-icon size="14">mdi-delete-outline</v-icon> Xoá</button>
      <span class="div"></span>
      <button class="x" @click="clearSelection"><v-icon size="16">mdi-close</v-icon></button>
    </div>

    <!-- Phase Multi-Source Lead Ads Phase 2 2026-05-27 — Lead detail panel -->
    <LeadDetailPanel
      v-model="showDetailPanel"
      :entry-id="detailPanelEntryId"
      :list-id="listId"
      :nick-accounts="nickAccounts"
      @entry-updated="onEntryUpdated"
    />

    <!-- Popup chọn nick để tìm Zalo từ nút trên bảng -->
    <NickPickerPopup
      v-model="showRowNickPicker"
      :accounts="nickAccounts"
      :trigger-el="rowFindTriggerEl"
      title="Chọn nick để tìm Zalo cho khách này"
      :busy="!!rowFinding"
      @pick="onRowNickPicked"
    />
    <LeadNotifyConfigDrawer
      v-model="showLeadNotify"
      :list-id="listId"
      @saved="onLeadNotifySaved"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed, watch, ref, nextTick, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCustomerLists, type CustomerListSummary, type CustomerListEntry } from '@/composables/use-customer-lists';
import { formatInOrgTz } from '@/composables/use-org-timezone';
// Phase Multi-Source Lead Ads Phase 2 2026-05-27 — Lead detail panel
import LeadDetailPanel from '@/components/lists/LeadDetailPanel.vue';
import { sourceBadge } from '@/lib/source-badge';
// Phase 2026-05-30 — nút Tìm Zalo: cần danh sách nick theo quyền cho popup
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { useUsers } from '@/composables/use-users';
import NickPickerPopup, { type NickPickerAccount } from '@/components/zalo-accounts/NickPickerPopup.vue';
import LeadNotifyConfigDrawer from '@ee/automation/components/LeadNotifyConfigDrawer.vue';
import LeadNotifyTimeline from '@ee/automation/components/LeadNotifyTimeline.vue';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

const route = useRoute();
const router = useRouter();

const toast = useToast();
const { confirm } = useConfirm();
// Lead-notify Nhịp 1 — drawer cấu hình "Tự động giao & báo lead" per-tệp.
const showLeadNotify = ref(false);
function onLeadNotifySaved() {
  toast.success('Đã lưu cấu hình tự động giao & báo lead');
  fetchEntries(listId.value);
}
// Lead-notify Nhịp 1 — cột "Trạng thái giao": đọc systemMessages + map userId→tên sale.
const { users: orgUsers, fetchUsers: fetchOrgUsers } = useUsers();
fetchOrgUsers().catch(() => {});
const userNameById = computed(() => {
  const m = new Map<string, string>();
  for (const u of orgUsers.value) m.set(u.id, u.fullName || u.id);
  return m;
});
function assignStatus(entry: CustomerListEntry): { state: string; label: string; title: string } {
  const msgs = entry.systemMessages ?? [];
  const assigned = msgs.find((m) => m.type === 'ASSIGNED_TO_SALE');
  if (assigned) {
    const uid = assigned.payload?.userId as string | undefined;
    const name = (uid && userNameById.value.get(uid)) || 'sale';
    return { state: 'done', label: `✅ Đã giao · ${name}`, title: `Đã giao cho ${name} + đã báo nhóm/cá nhân` };
  }
  if (msgs.some((m) => m.type === 'ASSIGN_FAILED')) {
    return { state: 'failed', label: '⚠️ Hết pool', title: 'Chưa giao được — pool sale của tệp đang rỗng' };
  }
  return { state: 'none', label: '—', title: 'Chưa có hoạt động tự-giao (tệp chưa bật hoặc lead chưa xử lý)' };
}
// Timeline chấm → mở hồ sơ lead (giống click hàng).
function onTimelineOpenEntry(entryId: string) {
  detailPanelEntryId.value = entryId;
  showDetailPanel.value = true;
}
const { accounts: zaloAccounts, fetchAccounts } = useZaloAccounts();
const nickAccounts = computed(() => zaloAccounts.value as unknown as NickPickerAccount[]);
// Sau khi tìm ra Zalo / lưu note cho 1 lead → refresh bảng + counter
async function onEntryUpdated() {
  await fetchEntries(listId.value);
  await fetchListById(listId.value);
}

// ───── Action nút trên bảng (row-actions) ─────
function openDetailPanel(entryId: string) {
  detailPanelEntryId.value = entryId;
  showDetailPanel.value = true;
}
function openContact(contactId: string) {
  window.open(`/contacts/${contactId}`, '_blank');
}
function openRowChat(entry: CustomerListEntry) {
  const phone = entry.phoneLocal || entry.phoneE164 || '';
  router.push({ path: '/chat', query: { compose: phone } });
}

// Tìm Zalo từ nút trên bảng (dùng chung popup)
const showRowNickPicker = ref(false);
const rowFindTriggerEl = ref<HTMLElement | null>(null);
const rowFinding = ref<string | null>(null);
const rowFindEntry = ref<CustomerListEntry | null>(null);

function openRowFindZalo(entry: CustomerListEntry, e: MouseEvent) {
  if (!entry.phoneValid) {
    toast.error('SĐT chưa hợp lệ, sửa số trước khi tìm Zalo');
    return;
  }
  rowFindEntry.value = entry;
  rowFindTriggerEl.value = e.currentTarget as HTMLElement;
  showRowNickPicker.value = true;
}
async function onRowNickPicked(nick: NickPickerAccount) {
  const entry = rowFindEntry.value;
  if (!entry) return;
  rowFinding.value = entry.id;
  try {
    const { data: res } = await api.post<{ found: boolean; zaloName?: string; detail?: string }>(
      `/customer-lists/${listId.value}/entries/${entry.id}/find-zalo`,
      { zaloAccountId: nick.id },
    );
    if (res.found) toast.success(`Đã tìm thấy Zalo: ${res.zaloName || 'KH'}`);
    else toast.warning(res.detail || 'SĐT này không có Zalo');
    showRowNickPicker.value = false;
    await onEntryUpdated();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { userFriendly?: string; detail?: string } } };
    toast.warning(e.response?.data?.userFriendly || e.response?.data?.detail || 'Không tìm được Zalo');
  } finally {
    rowFinding.value = null;
  }
}
const {
  currentList,
  entries,
  entriesTotal,
  loadingEntries,
  entryTab,
  entrySearch,
  entryPage,
  entryLimit,
  entrySort,
  entryDir,
  fetchListById,
  fetchEntries,
  archiveList,
  unarchiveList,
  rescanZalo,
  deleteList,
  renameList,
  updateEntry,
  addEntries,
  deleteEntry,
  bulkResolveEntries,
  selectedCount,
  toggleSelect,
  selectAllVisible,
  clearSelection,
  isSelected,
} = useCustomerLists();

const listId = computed(() => route.params.id as string);

/**
 * notScannedSdk = entries valid - hasZalo - dup(3) - skipped
 * = entries đã enriched (worker check Friend xong) nhưng chưa match → chờ Campaign SDK scan.
 * v1: noZaloEntries luôn = 0 (chưa có SDK confirm), nên dùng computed này thay thế.
 */
const notScannedSdk = computed<number>(() => {
  const l = currentList.value;
  if (!l) return 0;
  const dupTotal = l.dupInListEntries + l.dupCrossListEntries + l.dupWithContactEntries;
  return Math.max(0, l.validEntries - l.hasZaloEntries - l.noZaloEntries - dupTotal);
});

onMounted(async () => {
  await fetchListById(listId.value);
  await fetchEntries(listId.value);
  void fetchAccounts(); // nạp danh sách nick theo quyền cho nút Tìm Zalo
});

// Re-fetch khi route id change
watch(listId, async (newId) => {
  if (newId) {
    await fetchListById(newId);
    await fetchEntries(newId);
  }
});

function setTab(tab: typeof entryTab.value) {
  entryTab.value = tab;
  entryPage.value = 1;
  fetchEntries(listId.value);
}

function goPage(p: number) {
  entryPage.value = p;
  fetchEntries(listId.value);
}

// ───────── Sắp xếp cột (click header) — 2026-06-24 ─────────
// Cột date/số → click lần đầu giảm dần (mới nhất trước); cột chữ → tăng dần.
const DESC_FIRST = new Set(['rowIndex', 'updatedAt']);
function toggleSort(field: string) {
  if (entrySort.value === field) {
    entryDir.value = entryDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    entrySort.value = field;
    entryDir.value = DESC_FIRST.has(field) ? 'desc' : 'asc';
  }
  entryPage.value = 1;
  fetchEntries(listId.value);
}
function sortIcon(field: string): string {
  if (entrySort.value !== field) return 'mdi-unfold-more-horizontal';
  return entryDir.value === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down';
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedFetchEntries() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    entryPage.value = 1;
    fetchEntries(listId.value);
  }, 300);
}

const allSelectedVisible = computed(() =>
  entries.value.length > 0 && entries.value.every((e) => isSelected(e.id)),
);
const someSelected = computed(() => entries.value.some((e) => isSelected(e.id)));

function onToggleAllVisible() {
  if (allSelectedVisible.value) clearSelection();
  else selectAllVisible();
}

// Phase Multi-Source Lead Ads Phase 2 2026-05-27 — Lead detail panel state
const showDetailPanel = ref(false);
const detailPanelEntryId = ref<string | null>(null);

function onRowClick(entryId: string, e: MouseEvent) {
  const target = e.target as HTMLElement;
  // Bỏ qua click vào checkbox, button, action area, editable text — vẫn cần toggle selection
  if (target.closest('input, button, .row-actions, [contenteditable]')) return;
  // Phase 2: mở panel chi tiết khi click row. Toggle selection xảy ra qua checkbox riêng.
  detailPanelEntryId.value = entryId;
  showDetailPanel.value = true;
}

async function onBulk(action: 'skip' | 'keep_both' | 'delete') {
  if (action === 'delete' && !(await confirm({
    title: `Xoá ${selectedCount.value} SĐT đã chọn?`,
    tone: 'danger',
    confirmText: 'Xoá',
    cancelText: 'Hủy',
  }))) return;
  const result = await bulkResolveEntries(listId.value, action);
  if (result?.ok) toast.success(`Đã cập nhật ${result.affected} SĐT`);
}

async function onArchive() {
  if (!(await confirm({
    title: 'Lưu trữ tệp này?',
    message: 'Tệp sẽ ẩn khỏi danh sách "Đang dùng" nhưng dữ liệu vẫn còn.',
    tone: 'danger',
    confirmText: 'Lưu trữ',
    cancelText: 'Hủy',
  }))) return;
  await archiveList(listId.value);
  router.push('/marketing/lists');
}

async function onUnarchive() {
  await unarchiveList(listId.value);
  await fetchListById(listId.value);
}

async function onRescan() {
  const result = await rescanZalo(listId.value);
  if (result?.ok) {
    toast.success(`Đã bắt đầu quét lại ${result.pendingLookup} SĐT. Refresh sau vài phút.`);
    setTimeout(async () => {
      await fetchListById(listId.value);
      await fetchEntries(listId.value);
    }, 2000);
  }
}

async function onDelete() {
  if (!(await confirm({
    title: 'Xoá vĩnh viễn tệp này?',
    message: 'Contact đã được tạo sẽ KHÔNG bị xoá.',
    tone: 'danger',
    confirmText: 'Xoá',
    cancelText: 'Hủy',
  }))) return;
  await deleteList(listId.value);
  router.push('/marketing/lists');
}

/**
 * Phase Marketing rename 2026-05-23 — "Mục tiêu" namespace.
 * Click "Tạo Mục tiêu từ tệp này" → navigate sang trang tạo Mục tiêu mới,
 * truyền listId qua query để pre-fill (Ngày 2 sẽ refactor route đích thành MucTieuWizard).
 * Hiện tại route /marketing/triggers/tao-moi alias trỏ FriendInviteCreateView.vue.
 */
function onCreateMucTieu() {
  if (!listId.value) return;
  router.push({
    path: '/marketing/triggers/tao-moi',
    query: { listId: listId.value },
  });
}

// ───────── Inline edit: title ─────────
const editingTitle = ref(false);
const titleDraft = ref('');
const savingTitle = ref(false);
const titleInputRef = ref<HTMLInputElement | null>(null);

function startEditTitle() {
  if (!currentList.value || currentList.value.archivedAt) return;
  editingTitle.value = true;
  titleDraft.value = currentList.value.name;
  nextTick(() => titleInputRef.value?.focus());
}

async function commitTitle() {
  if (!editingTitle.value) return;
  const newName = titleDraft.value.trim();
  if (!newName || newName === currentList.value?.name) {
    editingTitle.value = false;
    return;
  }
  savingTitle.value = true;
  const ok = await renameList(listId.value, newName);
  savingTitle.value = false;
  editingTitle.value = false;
  if (!ok) toast.error('Đổi tên thất bại', 5000);
}

function cancelEditTitle() {
  editingTitle.value = false;
  titleDraft.value = '';
}

// ───────── Inline edit: cells (phoneRaw / nameRaw / personalNote) ─────────
type EditField = 'phoneRaw' | 'nameRaw' | 'personalNote';
const editing = ref<{ entryId: string; field: EditField; value: string; original: string } | null>(null);
const editInputRef = ref<HTMLInputElement | null>(null);
const savingEntryId = ref<string | null>(null);

function startEdit(entryId: string, field: EditField, currentValue: string) {
  if (editing.value) return; // đang edit cell khác
  if (currentList.value?.archivedAt) return; // archived list = readonly
  editing.value = { entryId, field, value: currentValue, original: currentValue };
  nextTick(() => editInputRef.value?.focus());
}

async function commitEdit() {
  if (!editing.value) return;
  const { entryId, field, value, original } = editing.value;
  if (value.trim() === original.trim()) {
    editing.value = null;
    return;
  }
  savingEntryId.value = entryId;
  const result = await updateEntry(listId.value, entryId, { [field]: value });
  savingEntryId.value = null;
  editing.value = null;
  if (!result) {
    toast.error('Lưu thất bại — thử lại', 5000);
    return;
  }
  // Toast cảnh báo dup nếu phoneRaw đổi sang số trùng
  if (field === 'phoneRaw' && result.conflictWarn) {
    if (result.entry.status === 'invalid') {
      flashToast(`Số mới không hợp lệ — đã đánh dấu "Lỗi"`);
    } else if (result.entry.dupInListWithEntryId) {
      flashToast(`Số mới đã có dòng khác trong tệp này`);
    } else if (result.entry.dupWithListId) {
      flashToast(`Số mới đã có ở tệp "${result.dupWithListName ?? 'khác'}"`);
    } else if (result.entry.dupWithContactId) {
      flashToast(`Số mới đã là khách CRM (có Contact)`);
    }
  }
}

function cancelEdit() {
  editing.value = null;
}

// Flash info toast (separate from undo toast)
const flashMsg = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flashToast(msg: string) {
  flashMsg.value = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flashMsg.value = null), 4000);
}

// ───────── Add row (manual / bulk) ─────────
const addRowText = ref('');
const addingRows = ref(false);

async function onAddRow() {
  const text = addRowText.value.trim();
  if (!text || addingRows.value) return;
  addingRows.value = true;
  const result = await addEntries(listId.value, text);
  addingRows.value = false;
  if (result?.ok) {
    addRowText.value = '';
    if (result.invalid > 0) {
      flashToast(`Đã thêm ${result.added} dòng (${result.valid} hợp lệ, ${result.invalid} lỗi format)`);
    } else {
      flashToast(`Đã thêm ${result.added} SĐT`);
    }
  } else {
    toast.error('Thêm thất bại — thử lại', 5000);
  }
}

function onAddRowPaste(e: ClipboardEvent) {
  const pasted = e.clipboardData?.getData('text') ?? '';
  // Nếu paste có \n (multi-line), thay vì insert vào input single-line → submit luôn
  if (pasted.includes('\n')) {
    e.preventDefault();
    addRowText.value = pasted.trim();
    nextTick(() => onAddRow());
  }
}

// ───────── Delete row + undo ─────────
interface UndoToastData {
  label: string;        // hiển thị "SĐT 0908..."
  expiresAt: number;    // timestamp ms khi expire
  rawText: string;      // text để re-create nếu undo
}
const undoToast = ref<UndoToastData | null>(null);
const undoCountdown = ref(5);
let undoTimer: ReturnType<typeof setInterval> | null = null;

async function onDeleteRow(entry: CustomerListEntry) {
  // Tạo rawText để có thể re-add nếu undo
  const rebuildText = [
    entry.phoneRaw,
    entry.nameRaw ? entry.nameRaw : null,
    entry.personalNote ? `, ${entry.personalNote}` : null,
  ].filter(Boolean).join(' ');
  const ok = await deleteEntry(listId.value, entry.id);
  if (!ok) {
    toast.error('Xoá thất bại', 5000);
    return;
  }
  await fetchEntries(listId.value);
  await fetchListById(listId.value);
  // Show undo toast 5s
  undoToast.value = {
    label: entry.phoneE164 ?? entry.phoneRaw,
    expiresAt: Date.now() + 5000,
    rawText: rebuildText,
  };
  undoCountdown.value = 5;
  if (undoTimer) clearInterval(undoTimer);
  undoTimer = setInterval(() => {
    if (!undoToast.value) {
      if (undoTimer) clearInterval(undoTimer);
      return;
    }
    const remaining = Math.ceil((undoToast.value.expiresAt - Date.now()) / 1000);
    if (remaining <= 0) {
      undoToast.value = null;
      if (undoTimer) clearInterval(undoTimer);
    } else {
      undoCountdown.value = remaining;
    }
  }, 250);
}

async function onUndoDelete() {
  if (!undoToast.value) return;
  const { rawText } = undoToast.value;
  undoToast.value = null;
  if (undoTimer) clearInterval(undoTimer);
  const result = await addEntries(listId.value, rawText);
  if (result?.ok) {
    flashToast(`Đã hoàn tác — entry sẽ append ở cuối list`);
  } else {
    toast.error('Hoàn tác thất bại', 5000);
  }
}

onBeforeUnmount(() => {
  if (undoTimer) clearInterval(undoTimer);
  if (flashTimer) clearTimeout(flashTimer);
});

// ───────── Helpers ─────────
function formatDate(iso: string): string {
  return formatInOrgTz(iso);
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'paste': return 'Paste textarea';
    case 'csv': return 'CSV upload';
    case 'excel': return 'Excel upload';
    case 'api': return 'API webhook';
    default: return s;
  }
}

function pct(n: number, total: number): string {
  if (!total) return '0';
  return ((n / total) * 100).toFixed(1);
}

function dupTotal(l: CustomerListSummary | null): number {
  if (!l) return 0;
  return l.dupInListEntries + l.dupCrossListEntries + l.dupWithContactEntries;
}

/**
 * Trạng thái entry — vocabulary chuẩn cho sale (chốt 2026-05-20):
 *   [green]  Đã có Zalo        — match Friend table HOẶC Campaign SDK xác nhận
 *   [amber]  Đang chờ CRM      — số valid, chưa rõ có Zalo, cần Campaign quét
 *   [red]    Không có Zalo     — Campaign SDK trả 404
 *   [wait]   Đang quét         — worker chưa xử lý (mới import)
 *   [grey]   Số không hợp lệ   — parse fail
 *   [orange] Trùng trong tệp   — dup cùng list
 *   [orange] Đã có ở tệp "X"   — dup cross-list, inline tên tệp
 *   [lock]   Đã là khách CRM   — đã có Contact
 *   [skip]   Sale loại         — sale bulk-skip
 */
/**
 * 2-axis status model (chốt 2026-05-20):
 *   - Lifecycle (5 ô): Mới / Đang chờ Quét / Có Zalo / Không có Zalo / Lỗi
 *     → đọc từ `status` + `hasZalo`
 *   - System messages: stack append-only các sự kiện đặc thù (trùng, sale loại,
 *     số sai format cụ thể, ...) → đọc từ `systemMessages` JSON array
 *
 * 2 cột riêng biệt → không còn cartesian explosion + ghi chú có history.
 */
import type { CustomerListEntry as Entry } from '@/composables/use-customer-lists';

function lifecycle(entry: Entry): { code: string; label: string; chip: string; icon: string } {
  if (entry.status === 'invalid') return { code: 'INVALID', label: 'Lỗi', chip: 'chip-grey', icon: 'mdi-circle-off-outline' };
  if (entry.hasZalo === true) return { code: 'HAS_ZALO', label: 'Có Zalo', chip: 'chip-green', icon: 'mdi-check-circle' };
  if (entry.hasZalo === false) return { code: 'NO_ZALO', label: 'Không có Zalo', chip: 'chip-red', icon: 'mdi-close-circle' };
  if (entry.status === 'validated') return { code: 'NEW', label: 'Mới', chip: 'chip-grey', icon: 'mdi-timer-sand' };
  // status === 'enriched' + hasZalo=null → đã check Friend xong, chưa rõ Zalo
  return { code: 'WAITING_SCAN', label: 'Đang chờ Quét', chip: 'chip-blue', icon: 'mdi-magnify-scan' };
}

/**
 * Icon (mdi) + màu theo message type — dùng để render stack message.
 */
function systemMessageIcon(type: string): { icon: string; cls: string } {
  switch (type) {
    case 'DUP_IN_LIST': return { icon: 'mdi-circle', cls: 'mi-orange' };
    case 'DUP_CROSS_LIST': return { icon: 'mdi-circle', cls: 'mi-orange' };
    case 'DUP_WITH_CRM': return { icon: 'mdi-lock', cls: 'mi-ink' };
    case 'INVALID_FORMAT':
    case 'INVALID_PREFIX':
    case 'TOO_SHORT':
    case 'TOO_LONG':
    case 'EMPTY': return { icon: 'mdi-phone-off', cls: 'mi-red' };
    case 'SKIPPED_BY_SALE': return { icon: 'mdi-skip-next', cls: 'mi-ink' };
    case 'PHONE_EDITED': return { icon: 'mdi-pencil', cls: 'mi-blue' };
    case 'ENRICHED_NO_MATCH': return { icon: 'mdi-magnify', cls: 'mi-ink' };
    default: return { icon: 'mdi-circle-small', cls: 'mi-ink' };
  }
}

/** Sort newest top */
function sortedMessages(messages: { ts: string; type: string; text: string }[]): { ts: string; type: string; text: string }[] {
  return [...(messages ?? [])].sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
}

function formatMsgTs(ts: string): string {
  // formatInOrgTz mặc định "dd/MM/yyyy HH:mm" — bỏ year để gọn (chỉ dùng cho stack message timeline)
  const full = formatInOrgTz(ts);
  // "21/05/2026 09:30" → "21/05 09:30"
  return full === '—' ? '—' : full.replace(/^(\d{2}\/\d{2})\/\d{4}/, '$1');
}

// ───────── Column visibility (persist localStorage) ─────────
interface ColumnDef { key: string; label: string; defaultVisible: boolean }
const ALL_COLUMNS: ColumnDef[] = [
  // 2026-06-24: cột "Ngày cập nhật" (updatedAt) lên đầu, ngay sau STT — hiện mặc định, sort được.
  { key: 'updatedAt',       label: 'Ngày cập nhật',           defaultVisible: true  },
  { key: 'source',          label: 'Nguồn',                   defaultVisible: true  },
  // Lead-notify Nhịp 1 — trạng thái tự-giao-sale (đọc systemMessages)
  { key: 'assignStatus',    label: 'Trạng thái giao',         defaultVisible: true  },
  { key: 'phoneRaw',        label: 'Phone (paste)',           defaultVisible: true  },
  { key: 'phoneE164',       label: 'Phone (+84)',             defaultVisible: true  },
  { key: 'phoneLocal',      label: 'Phone (local)',           defaultVisible: true  },
  { key: 'nameRaw',         label: 'Tên KH (file)',           defaultVisible: true  },
  { key: 'fbName',          label: 'Tên KH (Facebook)',       defaultVisible: true  },
  { key: 'nameZalo',        label: 'Tên KH (Zalo)',           defaultVisible: true  },
  { key: 'personalNote',    label: 'Lời mời riêng',           defaultVisible: true  },
  { key: 'lifecycle',       label: 'Trạng thái',              defaultVisible: true  },
  // #4 (2026-06-20): số lần SĐT này đã được gắn sequence (auto+manual) — soi trước khi chạy
  { key: 'sequenceAttach',  label: 'Đã gắn sequence',         defaultVisible: true  },
  // #3 (2026-06-20): số lần SĐT này đã được gửi lời mời kết bạn (cộng dồn mọi chiến dịch)
  { key: 'friendInvite',    label: 'Đã gửi kết bạn',          defaultVisible: true  },
  { key: 'zaloUid',         label: 'Zalo UID',                defaultVisible: true  },
  { key: 'resolvedByNick',  label: 'Nick tìm ra',             defaultVisible: true  },
  { key: 'zaloGlobalId',    label: 'Global ID',               defaultVisible: false },
  { key: 'systemMessages',  label: 'Thông báo hệ thống',      defaultVisible: true  },
  // Phase FB Pull 2026-05-30 — cột nguồn Facebook Lead Ads (mặc định ẩn, sale tự bật)
  { key: 'fbCampaign',      label: 'Chiến dịch',              defaultVisible: false },
  { key: 'fbAdset',         label: 'Nhóm quảng cáo',          defaultVisible: false },
  { key: 'fbAd',            label: 'Quảng cáo',               defaultVisible: false },
  // Ngày giờ khách điền form FB (đồng bộ từ Facebook) — giữ riêng, khác cột "Ngày cập nhật".
  { key: 'fbSubmittedAt',   label: 'Ngày điền form',          defaultVisible: false },
  { key: 'fbForm',          label: 'Form',                    defaultVisible: false },
  { key: 'fbLeadId',        label: 'Mã lead',                 defaultVisible: false },
];

// ───────── FB Lead Ads source meta (Phase FB Pull 2026-05-30) ─────────
// sourceMeta lưu campaignName/formName/externalLeadId/submittedAt từ lead Facebook.
function fbMeta(entry: unknown): Record<string, string | undefined> {
  const sm = (entry as { sourceMeta?: unknown })?.sourceMeta;
  return (sm && typeof sm === 'object' ? sm : {}) as Record<string, string | undefined>;
}
// Badge nguồn của 1 lead (Phase Multi-Source 2026-06-23) — từ sourceMeta.source.
function entrySourceBadge(entry: unknown) {
  return sourceBadge(fbMeta(entry).source);
}
// submittedAt (epoch ms) → giờ VN "25/05/2026 14:31" — thời điểm khách điền form FB (đồng bộ từ Facebook).
function fbSubmittedAtVN(entry: unknown): string {
  const raw = fbMeta(entry).submittedAt;
  if (!raw) return '';
  const ms = typeof raw === 'number' ? raw : Number(raw);
  if (!ms || Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  return `${date} ${time}`;
}
// v3 (2026-06-20): bump để cột "Đã gắn sequence" + "Đã gửi kết bạn" hiện mặc định (reset pref cột 1 lần).
const COL_STORAGE_KEY = 'zalocrm:listDetail:visibleColumns:v5'; // v5 (2026-06-24): thêm cột "Ngày cập nhật" lên đầu (hiện sẵn) + đổi "Ngày giờ phát sinh"→"Ngày điền form" → reset pref 1 lần

function loadVisibleColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch (e) {
    console.warn('[list-detail] visibleColumns parse failed', e);
  }
  return new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
}

const visibleColumns = ref<Set<string>>(loadVisibleColumns());

function isColVisible(key: string): boolean {
  return visibleColumns.value.has(key);
}

function toggleColumn(key: string) {
  const s = new Set(visibleColumns.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  visibleColumns.value = s;
  try {
    localStorage.setItem(COL_STORAGE_KEY, JSON.stringify([...s]));
  } catch (e) {
    console.warn('[list-detail] visibleColumns persist failed', e);
  }
}

function resetColumns() {
  const defaultSet = new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
  visibleColumns.value = defaultSet;
  try {
    localStorage.setItem(COL_STORAGE_KEY, JSON.stringify([...defaultSet]));
  } catch (e) {
    console.warn('[list-detail] visibleColumns reset failed', e);
  }
}

const visibleColCount = computed(() => visibleColumns.value.size);

// Dynamic colspan cho loading/empty row (fixed: checkbox + #, + 1 cho action + visible cols)
const dynamicColspan = computed(() => 3 + visibleColumns.value.size);

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const NICK_GRADIENTS: [string, string][] = [
  ['#10B981', '#059669'],
  ['#EC4899', '#BE185D'],
  ['#3B82F6', '#1D4ED8'],
  ['#F59E0B', '#D97706'],
  ['#5bb8e5', '#1786be'],
  ['#14B8A6', '#0F766E'],
];
function hashIdx(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
function nickAvatarStyle(name: string): Record<string, string> {
  const [c1, c2] = NICK_GRADIENTS[hashIdx(name || '?', NICK_GRADIENTS.length)];
  return { background: `linear-gradient(135deg, ${c1}, ${c2})` };
}
</script>

<style scoped>
.list-detail-view {
  /* 2026-06-06 — HS Holding Atlas theme */
  padding: 22px 24px;
  max-width: 100%;
}

.breadcrumb {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 14px; font-size: 12px; color: var(--ink-3);
}
.breadcrumb a {
  color: var(--brand); text-decoration: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.breadcrumb a:hover { text-decoration: underline; }
.breadcrumb .sep { color: var(--ink-4); }

.detail-hero {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-lg); box-shadow: var(--sh-sm);
  padding: 18px 20px; margin-bottom: 16px;
}
.hero-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 16px; gap: 14px;
}
.hero-head h2 {
  margin: 0 0 4px; font-size: 18px; font-weight: 700; color: var(--ink);
  display: flex; align-items: center; gap: 8px;
}
.hero-ico {
  width: 32px; height: 32px; border-radius: var(--r-sm);
  background: var(--brand-soft); color: var(--brand);
  display: inline-flex; align-items: center; justify-content: center; flex: none;
}
.hero-head .sub { color: var(--ink-3); font-size: 12.5px; }
.hero-head .sub b { color: var(--ink); font-weight: 600; }
.del-title { color: var(--error); }

.hero-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

.hero-stats {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;
}
.hero-stat {
  background: var(--surface-2); border: 1px solid var(--line-2);
  border-radius: var(--r-md); padding: 10px 12px;
  cursor: pointer; transition: border-color .12s, background .12s, box-shadow .12s;
}
.hero-stat:hover { border-color: var(--brand-soft); background: var(--brand-softer); }
.hero-stat.active {
  border-color: var(--brand); background: var(--brand-softer);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.hero-stat .l {
  font-size: 10.5px; color: var(--ink-3);
  text-transform: uppercase; letter-spacing: .05em;
  font-weight: 600; margin-bottom: 4px;
}
.hero-stat .v {
  font-size: 20px; font-weight: 700; color: var(--ink);
  line-height: 1; font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -.02em;
}
.hero-stat .pct {
  font-size: 10.5px; color: var(--ink-3); margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.hero-stat.green .v { color: var(--chip-green); }
.hero-stat.red .v { color: var(--chip-red); }
.hero-stat.amber .v { color: #b45309; }
.hero-stat.blue .v { color: var(--chip-blue); }

.subtabs {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-md); padding: 6px; margin-bottom: 14px;
  display: flex; gap: 2px; flex-wrap: wrap;
}
.subtab {
  padding: 7px 12px; border-radius: var(--r-xs);
  font-size: 12px; color: var(--ink-2); cursor: pointer;
  font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; font-family: inherit;
}
.subtab:hover { background: var(--surface-3); color: var(--ink); }
.subtab.active { background: var(--ink); color: #fff; }
.subtab .count {
  background: var(--surface-3); color: var(--ink-2);
  padding: 0 6px; border-radius: var(--r-pill);
  font-size: 10.5px; font-weight: 700;
  font-family: var(--mono); font-variant-numeric: tabular-nums;
}
.subtab.active .count { background: rgba(255,255,255,.18); color: #fff; }
.subtab .st-green { color: var(--chip-green); }
.subtab .st-orange { color: var(--chip-orange); }
.subtab .st-blue { color: var(--chip-blue); }
.subtab .st-ink { color: var(--ink); }
.subtab .st-ink2 { color: var(--ink-3); }
.subtab.active .st-green,
.subtab.active .st-orange,
.subtab.active .st-blue,
.subtab.active .st-ink,
.subtab.active .st-ink2 { color: #fff; }

.filter-strip {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-md); padding: 8px 10px; margin-bottom: 14px;
}
.search {
  flex: 1; display: inline-flex; align-items: center; gap: 5px;
  background: var(--surface-2); border: 1px solid var(--line-2);
  border-radius: var(--r-xs); padding: 0 9px; height: 32px;
  color: var(--ink-4);
}
.search input {
  flex: 1; border: none; background: transparent; outline: none;
  font-size: 12.5px; color: var(--ink); font-family: inherit;
}
.search input::placeholder { color: var(--ink-4); }

.entries-wrap {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-md); overflow: auto;
  /* 2026-06-24: nới cao để xem nhiều khách hơn; header sticky pin top khi cuộn */
  max-height: calc(100vh - 250px);
}
.entries-table { font-size: 12px; min-width: 1500px; }

/* ───── Badge Nguồn (nền tảng) — Phase Multi-Source 2026-06-23 ───── */
.src-cell { white-space: nowrap; }
.src-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 7px; font-size: 11px; font-weight: 600;
  border-radius: var(--r-pill); background: var(--surface-3); color: var(--ink-2); white-space: nowrap;
}
.src-badge.src-fb     { background: #e7f0fb; color: #1666c9; }
.src-badge.src-tiktok { background: #f1f1f4; color: #111827; }
.src-badge.src-zalo   { background: #e6f2fd; color: #0068ff; }
.src-badge.src-google { background: #fdeceb; color: #c5221f; }
.src-badge.src-manual { background: var(--surface-3); color: var(--ink-3); }
/* Lead-notify Nhịp 1 — cột Trạng thái giao */
.assign-status-cell { white-space: nowrap; }
.assign-badge {
  display: inline-flex; align-items: center;
  padding: 1px 8px; font-size: 11px; font-weight: 700;
  border-radius: var(--r-pill); white-space: nowrap;
}
.assign-badge.assign-done   { background: var(--success-soft, #e7f7ef); color: var(--success, #12b76a); }
.assign-badge.assign-failed { background: var(--warning-soft, #fdf3e2); color: #a05a00; }
.assign-badge.assign-none   { background: transparent; color: var(--ink-4, #97a0b3); font-weight: 500; }
/* Nút "Đang chạy" khi tệp bật tự-báo */
.btn-running {
  background: var(--success-soft, #e7f7ef) !important;
  color: var(--success, #12b76a) !important;
  border: 1px solid var(--success, #12b76a) !important;
  font-weight: 700;
}
.btn-running :deep(.v-icon), .btn-running .v-icon { font-size: 10px !important; animation: lnc-pulse 1.4s ease-in-out infinite; }
@keyframes lnc-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.entries-table thead th {
  /* 2026-06-24: pin header lên đỉnh khi cuộn — nền đặc để không lộ hàng dưới */
  position: sticky; top: 0; z-index: 5;
  background: var(--surface-2);
  padding: 10px 9px;
}
.entries-table thead th.right { text-align: right; }
/* Header sắp xếp được (click tăng/giảm) */
.entries-table thead th.sortable { cursor: pointer; user-select: none; transition: background .12s, color .12s; }
.entries-table thead th.sortable:hover { background: var(--surface-3); color: var(--ink-2); }
.entries-table thead th .th-i { vertical-align: middle; margin-left: 1px; opacity: .35; }
.entries-table thead th.sortable:hover .th-i { opacity: .7; }
.entries-table thead th.sorted { color: var(--brand); }
.entries-table thead th.sorted .th-i { opacity: 1; color: var(--brand); }
.updated-cell { white-space: nowrap; color: var(--ink-2); font-size: 11.5px; }
.entries-table tbody td {
  padding: 8px 9px;
  white-space: nowrap; /* No wrap by default — long text scrolls horizontally */
}

/* Scroll-x cells: content overflow ngang → scrollbar nhỏ ở đáy cell, không wrap */
.cell-scroll {
  max-width: 200px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
}
.cell-scroll::-webkit-scrollbar {
  height: 5px;
  background: transparent;
}
.cell-scroll::-webkit-scrollbar-thumb {
  background: var(--line);
  border-radius: 3px;
}
.cell-scroll::-webkit-scrollbar-thumb:hover { background: var(--ink-4); }
.cell-content {
  display: inline-block;
  white-space: nowrap;
  min-width: 100%; /* để scroll-x ngang được khi content rộng hơn cell */
}
.entries-table tbody tr { cursor: pointer; }
.entries-table tbody tr.selected { background: var(--brand-soft); }
.entries-table tbody tr:last-child td { border-bottom: none; }

.chk { width: 14px; height: 14px; accent-color: var(--brand); cursor: pointer; }

.ix { color: var(--ink-3); font-family: var(--mono); font-size: 11px; width: 40px; }
.phone-cell {
  font-family: var(--mono);
  font-size: 11.5px; white-space: nowrap;
}
.phone-cell.raw { color: var(--ink-3); }
.phone-cell.e164 { color: var(--ink-2); }
.phone-cell.local { color: var(--ink); font-weight: 600; }
/* Width override cho name cells — scroll-x sẽ handle overflow */
.name { font-weight: 500; }
.name.cell-scroll { max-width: 160px; }
.name-zalo.cell-scroll { max-width: 160px; }
.name-zalo.has { color: var(--ink); font-weight: 500; }
.name-zalo.no { color: var(--ink-4); font-style: italic; }

.personal-note { color: var(--ink-2); font-size: 12px; }
.personal-note.cell-scroll { max-width: 220px; }

/* ─── Editable cells ─── */
.editable {
  cursor: text;
  transition: background .1s, box-shadow .1s;
  position: relative;
}
.editable:hover {
  background: var(--warning-soft);
  box-shadow: inset 0 0 0 1px var(--warning);
}
.readonly {
  cursor: not-allowed;
  opacity: 0.85;
}
.cell-input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--brand);
  border-radius: var(--r-xs);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  background: var(--surface);
  box-shadow: 0 0 0 2px var(--brand-soft);
}
.cell-input.saving { opacity: 0.6; }
.phone-cell.editable .cell-input {
  font-family: var(--mono);
  font-size: 11.5px;
}

/* ─── Inline editable title ─── */
.title-text {
  cursor: text;
  padding: 2px 6px;
  border-radius: var(--r-xs);
  border: 1px dashed transparent;
  transition: background .1s, border-color .1s;
}
.title-text:hover {
  background: var(--warning-soft);
  border-color: var(--warning);
}
.title-input {
  font-size: 18px; font-weight: 700;
  padding: 2px 6px;
  border: 1px solid var(--brand); border-radius: var(--r-xs);
  outline: none;
  font-family: inherit;
  background: var(--surface);
  box-shadow: 0 0 0 2px var(--brand-soft);
  min-width: 280px;
}

/* ─── Add-row footer ─── */
.add-row { background: var(--surface-2); }
.add-row td { padding: 8px 9px; border-bottom: none; }
.add-ix { color: var(--ink-4); }
.add-input {
  width: 60%;
  padding: 6px 10px;
  border: 1px dashed var(--line);
  border-radius: var(--r-xs);
  font-size: 12.5px;
  font-family: inherit;
  background: var(--surface);
  outline: none;
  color: var(--ink);
}
.add-input::placeholder { color: var(--ink-4); font-style: italic; }
.add-input:focus { border-color: var(--brand); border-style: solid; box-shadow: 0 0 0 2px var(--brand-soft); }
.add-input:disabled { background: var(--surface-3); cursor: wait; }
.add-hint {
  margin-left: 12px;
  font-size: 11px; color: var(--ink-4);
}
.add-hint code {
  background: var(--surface-3); padding: 1px 4px; border-radius: 3px;
  font-family: var(--mono);
}

/* ─── Undo + flash toast ─── */
.undo-toast {
  position: fixed; bottom: 24px; right: 24px;
  background: var(--ink); color: #fff;
  padding: 12px 16px;
  border-radius: var(--r-md);
  display: flex; align-items: center; gap: 14px;
  box-shadow: var(--sh-pop);
  font-size: 13px; z-index: 1000;
}
.undo-toast b { font-family: var(--mono); }
.undo-btn {
  background: var(--brand); color: #fff;
  border: none; padding: 6px 12px; border-radius: var(--r-xs);
  font-size: 12px; font-weight: 600; cursor: pointer;
  font-family: inherit;
  display: inline-flex; align-items: center; gap: 4px;
}
.undo-btn:hover { background: var(--brand-600); }

.flash-toast {
  position: fixed; bottom: 24px; left: 50%;
  transform: translateX(-50%);
  background: var(--ink); color: #fff;
  padding: 10px 18px; border-radius: var(--r-md);
  font-size: 13px; z-index: 1000;
  box-shadow: var(--sh-lg);
}

.toast-fade-enter-active,
.toast-fade-leave-active { transition: opacity .15s, transform .15s; }
.toast-fade-enter-from,
.toast-fade-leave-to { opacity: 0; transform: translateY(8px); }

.icon-btn.danger:hover { color: var(--error); }

.muted-italic { color: var(--ink-4); font-style: italic; font-size: 11.5px; }
/* Cột Tên KH (Facebook) — nhất quán với cột Zalo */
.name-fb.has .cell-content { color: #1877F2; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.name-fb.no .cell-content { color: var(--ink-4); font-style: italic; font-size: 11.5px; }
.fb-ico-inline {
  width: 13px; height: 13px; border-radius: 3px; background: #1877F2; color: #fff;
  font-weight: 800; font-size: 9px; display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

/* ─── Lifecycle chip (5 ô cố định) — dùng .chip + .chip-* HS ─── */
.lifecycle-cell .chip .v-icon { margin-right: -1px; }

/* ─── #4: cột "Đã gắn sequence" (số lần gắn auto+manual per SĐT) ─── */
.seq-cell { white-space: nowrap; }
.chip-seq {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  background: rgba(124,58,237,0.10);
  color: #6D28D9;
  border: 1px solid #7C3AED55;
}
.seq-none { color: var(--smax-grey-400, #9aa3b2); }
/* #3: chip "Đã gửi kết bạn" — xanh ngọc, tách khỏi chip seq tím */
.chip-fi {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  background: rgba(13,148,136,0.10);
  color: #0F766E;
  border: 1px solid #14B8A655;
}

/* ─── System messages stack cell ─── */
.system-messages-cell {
  position: relative;
  max-width: 240px;
  vertical-align: top;
}
.msg-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 38px; /* ~2 dòng */
  overflow: hidden;
  cursor: help;
}
.msg-item {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--ink-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.msg-item.msg-newest { color: var(--ink); font-weight: 500; }
.msg-ico { flex-shrink: 0; }
.msg-ico.mi-orange { color: var(--chip-orange); }
.msg-ico.mi-red { color: var(--chip-red); }
.msg-ico.mi-blue { color: var(--chip-blue); }
.msg-ico.mi-ink { color: var(--ink-3); }
.msg-text { overflow: hidden; text-overflow: ellipsis; }

/* Tooltip xem full stack — hover-only */
.msg-tooltip {
  display: none;
  position: absolute;
  top: 100%; left: 0;
  z-index: 50;
  background: var(--ink); color: #f5f7fa;
  border-radius: var(--r-sm);
  padding: 8px 10px;
  min-width: 240px; max-width: 360px;
  box-shadow: var(--sh-pop);
  margin-top: 4px;
}
.system-messages-cell:hover .msg-tooltip { display: block; }
.msg-tooltip .msg-ico.mi-ink { color: var(--ink-4); }
.msg-tooltip-title {
  font-size: 10.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
  color: var(--ink-4); margin-bottom: 6px;
}
.msg-tooltip-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,.12);
  font-size: 12px;
}
.msg-tooltip-item:last-child { border-bottom: none; }
.msg-tooltip-body { flex: 1; min-width: 0; }
.msg-tooltip-ts {
  font-size: 10.5px; color: var(--ink-4); margin-top: 1px;
}

.lifecycle-cell { white-space: nowrap; }

.col-toggle-btn { white-space: nowrap; }
.col-on { color: var(--brand); }
.col-off { color: var(--ink-4); }
.col-label { font-size: 13px; }
.col-reset-ico { color: var(--ink-3); }
.col-reset { font-size: 12.5px; color: var(--ink-3); }

.uid-cell {
  font-family: var(--mono);
  font-size: 11px; color: var(--ink-2); white-space: nowrap;
}
.uid-cell.empty { color: var(--ink-4); }

.nick-cell {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px;
}
.nick-cell .av {
  width: 20px; height: 20px; border-radius: 50%;
  font-size: 9px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  color: white; flex-shrink: 0;
}
.nick-cell .more {
  font-size: 10px; color: var(--brand-700); background: var(--brand-soft);
  padding: 0 5px; border-radius: var(--r-pill); font-weight: 700;
}

.global-id {
  font-family: var(--mono);
  font-size: 10.5px; color: var(--chip-purple);
  background: var(--chip-purple-bg); padding: 1px 6px; border-radius: var(--r-xs);
  white-space: nowrap;
}
.global-id.empty { color: var(--ink-4); background: transparent; font-style: italic; }

.dup-note {
  font-size: 10.5px; color: #b45309;
  background: var(--warning-soft); padding: 1px 6px; border-radius: var(--r-xs);
  display: inline-block; white-space: nowrap;
}
.err-note {
  font-size: 10.5px; color: var(--error);
  background: var(--error-soft); padding: 1px 6px; border-radius: var(--r-xs);
  display: inline-block; white-space: nowrap;
}

.row-actions { text-align: right; white-space: nowrap; }
.icon-btn {
  width: 24px; height: 24px; border-radius: var(--r-xs);
  border: none; background: transparent; color: var(--ink-3);
  cursor: pointer; margin-left: 2px;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: var(--surface-3); color: var(--ink); }
.icon-btn.zalo:hover { background: var(--brand-soft); color: var(--brand-700); }
.icon-btn.ok { color: var(--success); }
.icon-btn.ok:hover { background: var(--success-soft); }

.loading-cell, .empty-cell {
  padding: 48px 16px; text-align: center;
  color: var(--ink-3); font-style: italic; font-size: 13px;
}

.pag {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px; background: var(--surface);
  border: 1px solid var(--line); border-top: none;
  border-radius: 0 0 var(--r-md) var(--r-md);
  font-size: 11.5px; color: var(--ink-3);
}
.pag .ctrls { display: flex; gap: 4px; align-items: center; }
.pag button {
  height: 26px; min-width: 26px; padding: 0 9px;
  border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--r-xs); font-size: 11px; cursor: pointer;
  color: var(--ink-2); font-family: inherit;
  display: inline-flex; align-items: center; gap: 2px;
}
.pag button:hover:not(:disabled) { background: var(--surface-3); }
.pag button:disabled { opacity: 0.5; cursor: not-allowed; }
.pag button.cur { background: var(--brand); color: white; border-color: var(--brand); }

.bulk-bar {
  position: fixed; left: 50%; bottom: 24px;
  transform: translateX(-50%);
  background: var(--ink); color: white;
  border-radius: var(--r-lg); padding: 10px 16px;
  display: flex; align-items: center; gap: 12px;
  box-shadow: var(--sh-pop); z-index: 50;
}
.bulk-bar .ct { font-weight: 600; font-size: 13px; }
.bulk-bar .ct em {
  color: var(--warning); font-style: normal; font-weight: 700;
  margin-right: 4px; font-family: var(--mono); font-variant-numeric: tabular-nums;
}
.bulk-bar .div { width: 1px; height: 18px; background: rgba(255,255,255,.16); }
.bulk-bar button {
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.12);
  color: white; font-size: 12px; padding: 6px 11px;
  border-radius: var(--r-xs); cursor: pointer;
  display: inline-flex; gap: 5px; align-items: center;
  font-family: inherit;
}
.bulk-bar button:hover { background: rgba(255,255,255,.18); }
.bulk-bar button.danger {
  background: rgba(240,68,56,.18); border-color: rgba(240,68,56,.35);
  color: #fca5a0;
}
.bulk-bar .x {
  cursor: pointer; opacity: 0.6; margin-left: 4px;
  background: transparent; border: none; color: white;
  display: inline-flex; align-items: center;
}
</style>
