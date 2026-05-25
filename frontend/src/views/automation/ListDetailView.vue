<template>
  <div class="list-detail-view">
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <a @click="$router.push('/automation/bot/lists')">
        <v-icon size="14">mdi-folder-account-outline</v-icon> Tệp khách hàng
      </a>
      <span class="sep">›</span>
      <span>{{ currentList?.name ?? '...' }}</span>
    </div>

    <!-- Hero: title + actions + stats -->
    <div v-if="currentList" class="detail-hero">
      <div class="hero-head">
        <div style="min-width:0; flex:1;">
          <h2>
            <!-- Auto-managed FB list: show FB icon instead of emoji -->
            <template v-if="['api', 'webhook'].includes(currentList.sourceType)">
              <v-icon size="22" color="#1877F2" class="me-1" aria-hidden="true">mdi-facebook</v-icon>
            </template>
            <span v-else>{{ currentList.iconEmoji || '📂' }}</span>
            <template v-if="!editingTitle">
              <span
                class="title-text"
                :class="{ 'title-locked': ['api', 'webhook'].includes(currentList.sourceType) }"
                :title="['api', 'webhook'].includes(currentList.sourceType)
                  ? '📘 Tệp được liên kết tự động từ Facebook. Không thể đổi tên.'
                  : 'Click để đổi tên'"
                @click="startEditTitle"
              >
                {{ currentList.name }}
              </span>
              <v-icon
                v-if="['api', 'webhook'].includes(currentList.sourceType)"
                size="14"
                color="blue-grey"
                class="ms-1"
                aria-hidden="true"
              >
                mdi-lock-outline
              </v-icon>
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
            <span v-if="currentList.archivedAt" class="archived-tag">
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
          <button class="at-btn at-btn--primary">
            <v-icon size="16">mdi-send</v-icon>
            Tạo campaign từ tệp này
          </button>
          <button class="at-btn" @click="onRescan">
            <v-icon size="16">mdi-refresh</v-icon>
            Quét lại Zalo
          </button>
          <button class="at-btn">
            <v-icon size="16">mdi-download</v-icon>
            Export CSV
          </button>
          <v-menu :close-on-content-click="true">
            <template #activator="{ props: act }">
              <button v-bind="act" class="at-btn at-btn--ghost">
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
                <v-list-item-title style="color:#B91C1C">Xoá tệp</v-list-item-title>
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
        ✓ Hợp lệ <span class="count">{{ currentList?.validEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'invalid' }" @click="setTab('invalid')">
        ⚫ Số không hợp lệ <span class="count">{{ currentList?.invalidEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup' }" @click="setTab('dup')">
        🟠 Trùng <span class="count">{{ dupTotal(currentList).toLocaleString('vi-VN') }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_in_list' }" @click="setTab('dup_in_list')">
        🟠 Trùng trong tệp <span class="count">{{ currentList?.dupInListEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_cross_list' }" @click="setTab('dup_cross_list')">
        🟠 Trùng tệp khác <span class="count">{{ currentList?.dupCrossListEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_with_crm' }" @click="setTab('dup_with_crm')">
        🔒 Đã là khách CRM <span class="count">{{ currentList?.dupWithContactEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'has_zalo' }" @click="setTab('has_zalo')">
        🟢 Có Zalo <span class="count">{{ currentList?.hasZaloEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'no_zalo' }" @click="setTab('no_zalo')" title="Đã check Friend, chưa rõ có Zalo — cần Campaign quét xác nhận">
        🔵 Đang chờ Quét <span class="count">{{ notScannedSdk }}</span>
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
          <button v-bind="act" class="at-btn col-toggle-btn" title="Ẩn / hiện cột">
            <v-icon size="14">mdi-view-column-outline</v-icon>
            Cột {{ visibleColCount }}/{{ ALL_COLUMNS.length }}
            <v-icon size="13">mdi-chevron-down</v-icon>
          </button>
        </template>
        <v-list density="compact" min-width="240">
          <template v-for="(col, idx) in ALL_COLUMNS" :key="col.key">
            <!-- Group header: show when first col in a group -->
            <v-list-subheader
              v-if="col.group && (idx === 0 || ALL_COLUMNS[idx - 1].group !== col.group)"
              style="font-size:10.5px;font-weight:700;color:#6366F1;letter-spacing:.04em;padding:6px 16px 2px"
            >
              {{ col.group }}
            </v-list-subheader>
            <v-list-item @click="toggleColumn(col.key)">
              <template #prepend>
                <v-icon size="16" :color="isColVisible(col.key) ? '#6366F1' : '#9CA3AF'">
                  {{ isColVisible(col.key) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                </v-icon>
              </template>
              <v-list-item-title style="font-size:13px">{{ col.label }}</v-list-item-title>
            </v-list-item>
          </template>
          <v-divider />
          <v-list-item @click="resetColumns">
            <template #prepend>
              <v-icon size="16" color="#6B7280">mdi-restore</v-icon>
            </template>
            <v-list-item-title style="font-size:12.5px;color:#6B7280">Reset về mặc định</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>

    <!-- Entries table -->
    <div class="entries-wrap">
      <table class="entries-table">
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
            <th>#</th>
            <th v-show="isColVisible('phoneRaw')"       title="Phone gốc anh paste">📋 Phone (paste)</th>
            <th v-show="isColVisible('phoneE164')"      title="Phone E.164 chuẩn quốc tế">🌐 Phone (+84)</th>
            <th v-show="isColVisible('phoneLocal')"     title="Phone local VN (0xxx)">🇻🇳 Phone (local)</th>
            <th v-show="isColVisible('nameRaw')">Tên KH (file)</th>
            <th v-show="isColVisible('nameZalo')">Tên KH (Zalo)</th>
            <th v-show="isColVisible('personalNote')"   title="Lời mời / tin nhắn riêng cho KH này (chỉ có khi import từ CSV/Excel)">💬 Lời mời riêng</th>
            <th v-show="isColVisible('lifecycle')"      title="Lifecycle 5 ô: Mới / Đang chờ Quét / Có Zalo / Không có Zalo / Lỗi">🔄 Trạng thái</th>
            <th v-show="isColVisible('zaloUid')">Zalo UID</th>
            <th v-show="isColVisible('resolvedByNick')">Nick tìm ra</th>
            <th v-show="isColVisible('zaloGlobalId')">Global ID</th>
            <th v-show="isColVisible('systemMessages')" title="Stack thông báo hệ thống — trùng, sale loại, số sai cụ thể... (newest top, hover xem full)">📨 Thông báo hệ thống</th>
            <!-- Facebook Lead columns -->
            <th v-show="isColVisible('fbCampaignName')" style="min-width:160px">Chiến dịch FB</th>
            <th v-show="isColVisible('fbFormName')"     style="min-width:160px">Form FB</th>
            <th v-show="isColVisible('fbAdName')"       style="min-width:160px">Quảng cáo</th>
            <th v-show="isColVisible('fbAdsetName')"    style="min-width:140px">Nhóm QC</th>
            <th v-show="isColVisible('fbPlatform')"     style="min-width:80px" title="fb / ig">Nền tảng</th>
            <th v-show="isColVisible('fbIsOrganic')"    style="min-width:80px">Organic</th>
            <th v-show="isColVisible('fbCustomAnswers')" style="min-width:240px">Trả lời form</th>
            <th class="right">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingEntries">
            <td :colspan="dynamicColspan" class="loading-cell">⏳ Đang tải...</td>
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
              <span class="status-pill" :class="lifecycle(entry).cls">
                {{ lifecycle(entry).label }}
              </span>
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
                    <span class="msg-ico">{{ systemMessageIcon(msg.type) }}</span>
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
                    <span class="msg-ico">{{ systemMessageIcon(msg.type) }}</span>
                    <div class="msg-tooltip-body">
                      <div>{{ msg.text }}</div>
                      <div class="msg-tooltip-ts">{{ formatMsgTs(msg.ts) }}</div>
                    </div>
                  </div>
                </div>
              </template>
            </td>
            <!-- Facebook Lead cells -->
            <td v-show="isColVisible('fbCampaignName')" class="fb-text-cell cell-scroll">
              <span class="cell-content">{{ entry.fbCampaignName || '—' }}</span>
            </td>
            <td v-show="isColVisible('fbFormName')" class="fb-text-cell cell-scroll">
              <span class="cell-content">{{ entry.fbFormName || '—' }}</span>
            </td>
            <td v-show="isColVisible('fbAdName')" class="fb-text-cell cell-scroll">
              <span class="cell-content">{{ entry.fbAdName || '—' }}</span>
            </td>
            <td v-show="isColVisible('fbAdsetName')" class="fb-text-cell cell-scroll">
              <span class="cell-content">{{ entry.fbAdsetName || '—' }}</span>
            </td>
            <td v-show="isColVisible('fbPlatform')">
              <span v-if="entry.fbPlatform" class="fb-platform-chip" :class="entry.fbPlatform">
                {{ entry.fbPlatform }}
              </span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('fbIsOrganic')">
              <span v-if="entry.fbIsOrganic != null" class="fb-organic-badge" :class="entry.fbIsOrganic ? 'yes' : 'no'">
                {{ entry.fbIsOrganic ? 'Organic' : 'Paid' }}
              </span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td v-show="isColVisible('fbCustomAnswers')" class="fb-custom-answers-cell">
              <template v-if="entry.fbCustomAnswers && entry.fbCustomAnswers.length > 0">
                <div class="fb-qa-preview">
                  <div
                    v-for="(qa, qi) in entry.fbCustomAnswers.slice(0, 2)"
                    :key="qi"
                    class="fb-qa-item"
                  >
                    <span class="fb-qa-q">{{ qa.question }}:</span>
                    <span class="fb-qa-a">{{ qa.answer }}</span>
                  </div>
                  <span v-if="entry.fbCustomAnswers.length > 2" class="fb-qa-more">
                    +{{ entry.fbCustomAnswers.length - 2 }} nữa
                  </span>
                </div>
                <div class="fb-qa-tooltip">
                  <div class="fb-qa-tooltip-title">Câu trả lời form ({{ entry.fbCustomAnswers.length }})</div>
                  <div
                    v-for="(qa, qi) in entry.fbCustomAnswers"
                    :key="qi"
                    class="fb-qa-tooltip-item"
                  >
                    <div class="fb-qa-tooltip-q">{{ qa.question }}</div>
                    <div class="fb-qa-tooltip-a">{{ qa.answer }}</div>
                  </div>
                </div>
              </template>
              <span v-else class="muted-italic">—</span>
            </td>
            <td class="row-actions" @click.stop>
              <button class="icon-btn" title="Mở Contact" v-if="entry.contactId">
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
            <td class="ix" style="color:#9CA3AF">➕</td>
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
        <span>🗑 Đã xoá <b>{{ undoToast.label }}</b></span>
        <button class="undo-btn" @click="onUndoDelete">↶ Hoàn tác ({{ undoCountdown }}s)</button>
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
        <button :disabled="entryPage === 1" @click="goPage(entryPage - 1)">‹ Trước</button>
        <button class="cur">{{ entryPage }}</button>
        <button :disabled="entryPage * entryLimit >= entriesTotal" @click="goPage(entryPage + 1)">Sau ›</button>
      </div>
    </div>

    <!-- Bulk action bar -->
    <div v-if="selectedCount > 0" class="bulk-bar">
      <span class="ct"><em>{{ selectedCount }}</em>SĐT đã chọn</span>
      <span class="div"></span>
      <button @click="onBulk('skip')">↻ Bỏ qua (skip)</button>
      <button @click="onBulk('keep_both')">⊕ Tạo song song</button>
      <button @click="onBulk('delete')" class="danger">🗑 Xoá</button>
      <span class="div"></span>
      <button class="x" @click="clearSelection">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed, watch, ref, nextTick, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCustomerLists, type CustomerListSummary, type CustomerListEntry } from '@/composables/use-customer-lists';
import { formatInOrgTz } from '@/composables/use-org-timezone';
import '@/components/automation/phase7/airtable.css';

const route = useRoute();
const router = useRouter();
const {
  currentList,
  entries,
  entriesTotal,
  loadingEntries,
  entryTab,
  entrySearch,
  entryPage,
  entryLimit,
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

function onRowClick(entryId: string, e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('input, button, .row-actions')) return;
  toggleSelect(entryId);
}

async function onBulk(action: 'skip' | 'keep_both' | 'delete') {
  if (action === 'delete' && !confirm(`Xoá ${selectedCount.value} entry đã chọn?`)) return;
  const result = await bulkResolveEntries(listId.value, action);
  if (result?.ok) alert(`Đã cập nhật ${result.affected} entries`);
}

async function onArchive() {
  if (!confirm('Lưu trữ tệp này?')) return;
  await archiveList(listId.value);
  router.push('/automation/bot/lists');
}

async function onUnarchive() {
  await unarchiveList(listId.value);
  await fetchListById(listId.value);
}

async function onRescan() {
  const result = await rescanZalo(listId.value);
  if (result?.ok) {
    alert(`Đã bắt đầu quét lại ${result.pendingLookup} SĐT. Refresh sau vài phút.`);
    setTimeout(async () => {
      await fetchListById(listId.value);
      await fetchEntries(listId.value);
    }, 2000);
  }
}

async function onDelete() {
  if (!confirm('Xoá vĩnh viễn tệp này? Contact đã được tạo sẽ KHÔNG bị xoá.')) return;
  await deleteList(listId.value);
  router.push('/automation/bot/lists');
}

// ───────── Inline edit: title ─────────
const editingTitle = ref(false);
const titleDraft = ref('');
const savingTitle = ref(false);
const titleInputRef = ref<HTMLInputElement | null>(null);

function startEditTitle() {
  if (!currentList.value || currentList.value.archivedAt) return;
  // Block rename for auto-managed lists (api/webhook source type)
  if (['api', 'webhook'].includes(currentList.value.sourceType)) return;
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
  if (!ok) alert('Đổi tên thất bại');
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
    alert('Lưu thất bại — thử lại');
    return;
  }
  // Toast cảnh báo dup nếu phoneRaw đổi sang số trùng
  if (field === 'phoneRaw' && result.conflictWarn) {
    if (result.entry.status === 'invalid') {
      flashToast(`⚠️ Số mới không hợp lệ — đã đánh dấu "Lỗi"`);
    } else if (result.entry.dupInListWithEntryId) {
      flashToast(`⚠️ Số mới đã có dòng khác trong tệp này`);
    } else if (result.entry.dupWithListId) {
      flashToast(`⚠️ Số mới đã có ở tệp "${result.dupWithListName ?? 'khác'}"`);
    } else if (result.entry.dupWithContactId) {
      flashToast(`⚠️ Số mới đã là khách CRM (có Contact)`);
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
      flashToast(`✓ Đã thêm ${result.added} dòng (${result.valid} hợp lệ, ${result.invalid} lỗi format)`);
    } else {
      flashToast(`✓ Đã thêm ${result.added} SĐT`);
    }
  } else {
    alert('Thêm thất bại — thử lại');
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
    alert('Xoá thất bại');
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
    flashToast(`↶ Đã hoàn tác — entry sẽ append ở cuối list`);
  } else {
    alert('Hoàn tác thất bại');
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
 *   🟢 Đã có Zalo        — match Friend table HOẶC Campaign SDK xác nhận
 *   🟡 Đang chờ CRM      — số valid, chưa rõ có Zalo, cần Campaign quét
 *   🔴 Không có Zalo     — Campaign SDK trả 404
 *   ⏳ Đang quét         — worker chưa xử lý (mới import)
 *   ⚫ Số không hợp lệ   — parse fail
 *   🟠 Trùng trong tệp   — dup cùng list
 *   🟠 Đã có ở tệp "X"   — dup cross-list, inline tên tệp
 *   🔒 Đã là khách CRM   — đã có Contact
 *   ⏭ Sale loại         — sale bulk-skip
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

function lifecycle(entry: Entry): { code: string; label: string; cls: string } {
  if (entry.status === 'invalid') return { code: 'INVALID', label: '⚫ Lỗi', cls: 'invalid' };
  if (entry.hasZalo === true) return { code: 'HAS_ZALO', label: '🟢 Có Zalo', cls: 'has-zalo' };
  if (entry.hasZalo === false) return { code: 'NO_ZALO', label: '🔴 Không có Zalo', cls: 'no-zalo' };
  if (entry.status === 'validated') return { code: 'NEW', label: '⏳ Mới', cls: 'new' };
  // status === 'enriched' + hasZalo=null → đã check Friend xong, chưa rõ Zalo
  return { code: 'WAITING_SCAN', label: '🔵 Đang chờ Quét', cls: 'waiting' };
}

/**
 * Icon emoji theo message type — dùng để render stack message.
 */
function systemMessageIcon(type: string): string {
  switch (type) {
    case 'DUP_IN_LIST': return '🟠';
    case 'DUP_CROSS_LIST': return '🟠';
    case 'DUP_WITH_CRM': return '🔒';
    case 'INVALID_FORMAT':
    case 'INVALID_PREFIX':
    case 'TOO_SHORT':
    case 'TOO_LONG':
    case 'EMPTY': return '📵';
    case 'SKIPPED_BY_SALE': return '⏭';
    case 'PHONE_EDITED': return '📝';
    case 'ENRICHED_NO_MATCH': return '🔍';
    default: return '•';
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
interface ColumnDef { key: string; label: string; defaultVisible: boolean; group?: string }
const ALL_COLUMNS: ColumnDef[] = [
  { key: 'phoneRaw',        label: '📋 Phone (paste)',        defaultVisible: true  },
  { key: 'phoneE164',       label: '🌐 Phone (+84)',          defaultVisible: true  },
  { key: 'phoneLocal',      label: '🇻🇳 Phone (local)',         defaultVisible: true  },
  { key: 'nameRaw',         label: 'Tên KH (file)',           defaultVisible: true  },
  { key: 'nameZalo',        label: 'Tên KH (Zalo)',           defaultVisible: true  },
  { key: 'personalNote',    label: '💬 Lời mời riêng',         defaultVisible: true  },
  { key: 'lifecycle',       label: '🔄 Trạng thái',            defaultVisible: true  },
  { key: 'zaloUid',         label: 'Zalo UID',                defaultVisible: true  },
  { key: 'resolvedByNick',  label: 'Nick tìm ra',             defaultVisible: true  },
  { key: 'zaloGlobalId',    label: 'Global ID',               defaultVisible: false },
  { key: 'systemMessages',  label: '📨 Thông báo hệ thống',     defaultVisible: true  },
  // Facebook Lead group
  { key: 'fbCampaignName',  label: 'Chiến dịch FB',           defaultVisible: true,  group: 'Facebook Lead' },
  { key: 'fbFormName',      label: 'Form FB',                 defaultVisible: true,  group: 'Facebook Lead' },
  { key: 'fbAdName',        label: 'Quảng cáo',               defaultVisible: false, group: 'Facebook Lead' },
  { key: 'fbAdsetName',     label: 'Nhóm QC',                 defaultVisible: false, group: 'Facebook Lead' },
  { key: 'fbPlatform',      label: 'Nền tảng',                defaultVisible: false, group: 'Facebook Lead' },
  { key: 'fbIsOrganic',     label: 'Organic',                 defaultVisible: false, group: 'Facebook Lead' },
  { key: 'fbCustomAnswers', label: 'Trả lời form',            defaultVisible: false, group: 'Facebook Lead' },
];
// v2: bumped to re-initialize user prefs with new FB column defaults
const COL_STORAGE_KEY = 'zalocrm:listDetail:visibleColumns:v2';

function loadVisibleColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as string[];
      if (Array.isArray(stored)) {
        // Merge: add any new columns not in stored set using their default visibility
        const storedSet = new Set(stored);
        const knownKeys = new Set(ALL_COLUMNS.map((c) => c.key));
        // Add new columns that aren't in stored set yet
        for (const col of ALL_COLUMNS) {
          if (!knownKeys.has(col.key)) continue; // paranoia
          if (!storedSet.has(col.key) && col.defaultVisible) {
            storedSet.add(col.key);
          }
        }
        return storedSet;
      }
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
  ['#6366F1', '#A855F7'],
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
  padding: 24px 28px 100px;
  max-width: 100%;
}

.breadcrumb {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 14px; font-size: 12px; color: #6B7280;
}
.breadcrumb a {
  color: #6366F1; text-decoration: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.breadcrumb a:hover { text-decoration: underline; }
.breadcrumb .sep { color: #D1D5DB; }

.detail-hero {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 12px; padding: 18px 20px; margin-bottom: 16px;
}
.hero-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 16px; gap: 14px;
}
.hero-head h2 {
  margin: 0 0 4px; font-size: 18px; font-weight: 700;
  display: flex; align-items: center; gap: 8px;
}
.hero-head .sub { color: #6B7280; font-size: 12.5px; }
.hero-head .sub b { color: #111827; font-weight: 600; }
.hero-head .archived-tag {
  font-size: 11px; background: #E5E7EB; color: #4B5563;
  padding: 2px 8px; border-radius: 99px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 3px;
}

.hero-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

.hero-stats {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;
}
.hero-stat {
  background: #F4F5F8; border: 1px solid #EFF1F4;
  border-radius: 9px; padding: 10px 12px;
  cursor: pointer; transition: all .12s;
}
.hero-stat:hover { border-color: #E0E7FF; background: #EEF2FF; }
.hero-stat.active {
  border-color: #6366F1; background: #EEF2FF;
  box-shadow: 0 0 0 3px rgba(99,102,241,.1);
}
.hero-stat .l {
  font-size: 10.5px; color: #6B7280;
  text-transform: uppercase; letter-spacing: .05em;
  font-weight: 600; margin-bottom: 4px;
}
.hero-stat .v {
  font-size: 20px; font-weight: 700; color: #111827;
  line-height: 1; font-variant-numeric: tabular-nums;
}
.hero-stat .pct {
  font-size: 10.5px; color: #6B7280; margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.hero-stat.green .v { color: #047857; }
.hero-stat.red .v { color: #B91C1C; }
.hero-stat.amber .v { color: #B45309; }
.hero-stat.blue .v { color: #1D4ED8; }

.subtabs {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 10px; padding: 6px; margin-bottom: 14px;
  display: flex; gap: 2px; flex-wrap: wrap;
}
.subtab {
  padding: 7px 12px; border-radius: 6px;
  font-size: 12px; color: #4B5563; cursor: pointer;
  font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; font-family: inherit;
}
.subtab:hover { background: #F4F5F8; color: #111827; }
.subtab.active { background: #111827; color: #fff; }
.subtab .count {
  background: rgba(0,0,0,.06); color: #4B5563;
  padding: 0 6px; border-radius: 99px;
  font-size: 10.5px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.subtab.active .count { background: rgba(255,255,255,.18); color: #fff; }

.filter-strip {
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 10px; padding: 8px 10px; margin-bottom: 14px;
}
.search {
  flex: 1; display: inline-flex; align-items: center; gap: 5px;
  background: #F4F5F8; border: 1px solid #EFF1F4;
  border-radius: 7px; padding: 0 9px; height: 32px;
}
.search input {
  flex: 1; border: none; background: transparent; outline: none;
  font-size: 12.5px; color: #111827; font-family: inherit;
}
.search input::placeholder { color: #9CA3AF; }

.entries-wrap {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 10px; overflow: auto;
  max-height: calc(100vh - 380px);
}
.entries-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1500px; }
.entries-table thead th {
  background: #F4F5F8; position: sticky; top: 0; z-index: 2;
  font-size: 10.5px; font-weight: 600; color: #6B7280;
  text-transform: uppercase; letter-spacing: .04em;
  padding: 10px 9px; text-align: left;
  border-bottom: 1px solid #E5E7EB; white-space: nowrap;
}
.entries-table thead th.right { text-align: right; }
.entries-table tbody td {
  padding: 8px 9px; border-bottom: 1px solid #EFF1F4;
  vertical-align: middle; color: #111827;
  white-space: nowrap; /* No wrap by default — long text scrolls horizontally */
}

/* Scroll-x cells: content overflow ngang → scrollbar nhỏ ở đáy cell, không wrap */
.cell-scroll {
  max-width: 200px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: #D1D5DB transparent;
}
.cell-scroll::-webkit-scrollbar {
  height: 5px;
  background: transparent;
}
.cell-scroll::-webkit-scrollbar-thumb {
  background: #D1D5DB;
  border-radius: 3px;
}
.cell-scroll::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }
.cell-content {
  display: inline-block;
  white-space: nowrap;
  min-width: 100%; /* để scroll-x ngang được khi content rộng hơn cell */
}
.entries-table tbody tr { transition: background .1s; cursor: pointer; }
.entries-table tbody tr:hover { background: #FAFBFC; }
.entries-table tbody tr.selected { background: #EEF2FF; }
.entries-table tbody tr:last-child td { border-bottom: none; }

.chk { width: 14px; height: 14px; accent-color: #6366F1; cursor: pointer; }

.ix { color: #6B7280; font-family: "JetBrains Mono", monospace; font-size: 11px; width: 40px; }
.phone-cell {
  font-family: "JetBrains Mono", monospace;
  font-size: 11.5px; white-space: nowrap;
}
.phone-cell.raw { color: #6B7280; }
.phone-cell.e164 { color: #4B5563; }
.phone-cell.local { color: #111827; font-weight: 600; }
/* Width override cho name cells — scroll-x sẽ handle overflow */
.name { font-weight: 500; }
.name.cell-scroll { max-width: 160px; }
.name-zalo.cell-scroll { max-width: 160px; }
.name-zalo.has { color: #111827; font-weight: 500; }
.name-zalo.no { color: #9CA3AF; font-style: italic; }

.personal-note { color: #4B5563; font-size: 12px; }
.personal-note.cell-scroll { max-width: 220px; }

/* ─── Editable cells ─── */
.editable {
  cursor: text;
  transition: background .1s, box-shadow .1s;
  position: relative;
}
.editable:hover {
  background: #FFFBEB;
  box-shadow: inset 0 0 0 1px #FBBF24;
}
.readonly {
  cursor: not-allowed;
  opacity: 0.85;
}
.cell-input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #6366F1;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  background: #fff;
  box-shadow: 0 0 0 2px rgba(99,102,241,.15);
}
.cell-input.saving { opacity: 0.6; }
.phone-cell.editable .cell-input {
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 11.5px;
}

/* ─── Inline editable title ─── */
.title-text {
  cursor: text;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px dashed transparent;
  transition: background .1s, border-color .1s;
}
.title-text:hover {
  background: #FFFBEB;
  border-color: #FBBF24;
}
.title-locked {
  cursor: default;
}
.title-locked:hover {
  background: transparent;
  border-color: transparent;
}
.title-input {
  font-size: 18px; font-weight: 700;
  padding: 2px 6px;
  border: 1px solid #6366F1; border-radius: 5px;
  outline: none;
  font-family: inherit;
  background: #fff;
  box-shadow: 0 0 0 2px rgba(99,102,241,.15);
  min-width: 280px;
}

/* ─── Add-row footer ─── */
.add-row { background: #FAFBFC; }
.add-row td { padding: 8px 9px; border-bottom: none; }
.add-input {
  width: 60%;
  padding: 6px 10px;
  border: 1px dashed #D1D5DB;
  border-radius: 6px;
  font-size: 12.5px;
  font-family: inherit;
  background: #fff;
  outline: none;
  color: #111827;
}
.add-input::placeholder { color: #9CA3AF; font-style: italic; }
.add-input:focus { border-color: #6366F1; border-style: solid; box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
.add-input:disabled { background: #F4F5F8; cursor: wait; }
.add-hint {
  margin-left: 12px;
  font-size: 11px; color: #9CA3AF;
}
.add-hint code {
  background: #F4F5F8; padding: 1px 4px; border-radius: 3px;
  font-family: "JetBrains Mono", monospace;
}

/* ─── Undo + flash toast ─── */
.undo-toast {
  position: fixed; bottom: 24px; right: 24px;
  background: #111827; color: #fff;
  padding: 12px 16px;
  border-radius: 10px;
  display: flex; align-items: center; gap: 14px;
  box-shadow: 0 12px 32px rgba(17,24,39,.32);
  font-size: 13px; z-index: 1000;
}
.undo-toast b { font-family: "JetBrains Mono", monospace; }
.undo-btn {
  background: #6366F1; color: #fff;
  border: none; padding: 6px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  font-family: inherit;
}
.undo-btn:hover { background: #4F46E5; }

.flash-toast {
  position: fixed; bottom: 24px; left: 50%;
  transform: translateX(-50%);
  background: #1F2937; color: #fff;
  padding: 10px 18px; border-radius: 10px;
  font-size: 13px; z-index: 1000;
  box-shadow: 0 10px 28px rgba(17,24,39,.28);
}

.toast-fade-enter-active,
.toast-fade-leave-active { transition: opacity .15s, transform .15s; }
.toast-fade-enter-from,
.toast-fade-leave-to { opacity: 0; transform: translateY(8px); }

.icon-btn.danger:hover { color: #B91C1C; }

.muted-italic { color: #9CA3AF; font-style: italic; font-size: 11.5px; }

.status-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px; border-radius: 99px;
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
}
/* ─── Lifecycle pills (5 ô cố định) ─── */
.status-pill.new { background: #F4F5F8; color: #6B7280; }                    /* ⏳ Mới */
.status-pill.waiting { background: #DBEAFE; color: #1D4ED8; }                /* 🔵 Đang chờ Quét */
.status-pill.has-zalo { background: #D1FAE5; color: #047857; }               /* 🟢 Có Zalo */
.status-pill.no-zalo { background: #FEE2E2; color: #B91C1C; }                /* 🔴 Không có Zalo */
.status-pill.invalid { background: #1F2937; color: #fff; }                   /* ⚫ Lỗi */

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
  font-size: 11px; color: #6B7280;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.msg-item.msg-newest { color: #111827; font-weight: 500; }
.msg-ico { font-size: 11px; flex-shrink: 0; }
.msg-text { overflow: hidden; text-overflow: ellipsis; }

/* Tooltip xem full stack — hover-only */
.msg-tooltip {
  display: none;
  position: absolute;
  top: 100%; left: 0;
  z-index: 50;
  background: #1F2937; color: #F9FAFB;
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 240px; max-width: 360px;
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
  margin-top: 4px;
}
.system-messages-cell:hover .msg-tooltip { display: block; }
.msg-tooltip-title {
  font-size: 10.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
  color: #9CA3AF; margin-bottom: 6px;
}
.msg-tooltip-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid #374151;
  font-size: 12px;
}
.msg-tooltip-item:last-child { border-bottom: none; }
.msg-tooltip-body { flex: 1; min-width: 0; }
.msg-tooltip-ts {
  font-size: 10.5px; color: #9CA3AF; margin-top: 1px;
}

.lifecycle-cell { white-space: nowrap; }

.col-toggle-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 10px;
  background: #fff; border: 1px solid #E5E7EB; border-radius: 7px;
  font-size: 12px; font-weight: 500; color: #4B5563;
  cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.col-toggle-btn:hover { background: #F4F5F8; border-color: #D1D5DB; }

.uid-cell {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px; color: #4B5563; white-space: nowrap;
}
.uid-cell.empty { color: #9CA3AF; }

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
  font-size: 10px; color: #6366F1; background: #EEF2FF;
  padding: 0 5px; border-radius: 99px; font-weight: 700;
}

.global-id {
  font-family: "JetBrains Mono", monospace;
  font-size: 10.5px; color: #A855F7;
  background: #FAF5FF; padding: 1px 6px; border-radius: 4px;
  white-space: nowrap;
}
.global-id.empty { color: #9CA3AF; background: transparent; font-style: italic; }

/* ─── Facebook Lead cells ─── */
.fb-text-cell { color: #374151; font-size: 12px; max-width: 160px; }

.fb-platform-chip {
  display: inline-block;
  padding: 1px 7px; border-radius: 99px;
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
  background: #DBEAFE; color: #1D4ED8;
}
.fb-platform-chip.instagram { background: #FCE7F3; color: #9D174D; }

.fb-organic-badge {
  display: inline-block;
  padding: 1px 7px; border-radius: 99px;
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
}
.fb-organic-badge.yes { background: #D1FAE5; color: #047857; }
.fb-organic-badge.no  { background: #FEE2E2; color: #B91C1C; }

.fb-custom-answers-cell {
  position: relative;
  max-width: 240px;
  vertical-align: top;
}
.fb-qa-preview {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 38px;
  overflow: hidden;
  cursor: help;
}
.fb-qa-item {
  font-size: 11px; color: #6B7280;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  display: flex; gap: 3px;
}
.fb-qa-q { font-weight: 600; color: #4B5563; flex-shrink: 0; max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
.fb-qa-a { color: #111827; overflow: hidden; text-overflow: ellipsis; }
.fb-qa-more { font-size: 10.5px; color: #6366F1; font-style: italic; }

.fb-qa-tooltip {
  display: none;
  position: absolute;
  top: 100%; left: 0;
  z-index: 50;
  background: #1F2937; color: #F9FAFB;
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 280px; max-width: 400px;
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
  margin-top: 4px;
}
.fb-custom-answers-cell:hover .fb-qa-tooltip { display: block; }
.fb-qa-tooltip-title {
  font-size: 10.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
  color: #9CA3AF; margin-bottom: 6px;
}
.fb-qa-tooltip-item {
  padding: 5px 0;
  border-bottom: 1px solid #374151;
  font-size: 12px;
}
.fb-qa-tooltip-item:last-child { border-bottom: none; }
.fb-qa-tooltip-q { color: #9CA3AF; font-size: 10.5px; margin-bottom: 2px; }
.fb-qa-tooltip-a { color: #F9FAFB; }

.dup-note {
  font-size: 10.5px; color: #B45309;
  background: #FFFBEB; padding: 1px 6px; border-radius: 4px;
  display: inline-block; white-space: nowrap;
}
.err-note {
  font-size: 10.5px; color: #B91C1C;
  background: #FEF2F2; padding: 1px 6px; border-radius: 4px;
  display: inline-block; white-space: nowrap;
}

.row-actions { text-align: right; white-space: nowrap; }
.icon-btn {
  width: 24px; height: 24px; border-radius: 5px;
  border: none; background: transparent; color: #6B7280;
  cursor: pointer; margin-left: 2px;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: #F4F5F8; color: #111827; }

.loading-cell, .empty-cell {
  padding: 48px 16px; text-align: center;
  color: #6B7280; font-style: italic; font-size: 13px;
}

.pag {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px; background: #fff;
  border: 1px solid #E5E7EB; border-top: none;
  border-radius: 0 0 10px 10px;
  font-size: 11.5px; color: #6B7280;
}
.pag .ctrls { display: flex; gap: 4px; align-items: center; }
.pag button {
  height: 26px; min-width: 26px; padding: 0 9px;
  border: 1px solid #E5E7EB; background: #fff;
  border-radius: 5px; font-size: 11px; cursor: pointer;
  color: #4B5563; font-family: inherit;
}
.pag button:hover:not(:disabled) { background: #F4F5F8; }
.pag button:disabled { opacity: 0.5; cursor: not-allowed; }
.pag button.cur { background: #6366F1; color: white; border-color: #6366F1; }

.bulk-bar {
  position: fixed; left: 50%; bottom: 24px;
  transform: translateX(-50%);
  background: #111827; color: white;
  border-radius: 12px; padding: 10px 16px;
  display: flex; align-items: center; gap: 12px;
  box-shadow: 0 16px 36px rgba(17,24,39,.28); z-index: 50;
}
.bulk-bar .ct { font-weight: 600; font-size: 13px; }
.bulk-bar .ct em {
  color: #FBBF24; font-style: normal; font-weight: 700;
  margin-right: 4px; font-variant-numeric: tabular-nums;
}
.bulk-bar .div { width: 1px; height: 18px; background: rgba(255,255,255,.16); }
.bulk-bar button {
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.12);
  color: white; font-size: 12px; padding: 6px 11px;
  border-radius: 7px; cursor: pointer;
  display: inline-flex; gap: 5px; align-items: center;
  font-family: inherit;
}
.bulk-bar button:hover { background: rgba(255,255,255,.18); }
.bulk-bar button.danger {
  background: rgba(239,68,68,.18); border-color: rgba(239,68,68,.35);
  color: #FCA5A5;
}
.bulk-bar .x {
  cursor: pointer; opacity: 0.6; margin-left: 4px;
  background: transparent; border: none; color: white;
}
</style>
