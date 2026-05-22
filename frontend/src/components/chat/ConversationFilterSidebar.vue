<template>
  <aside class="filter-sidebar" :class="{ collapsed }">
    <!-- Header: workspace + collapse -->
    <header class="sb-header" :class="{ stacked: collapsed }">
      <div v-if="!collapsed" class="ws">
        <div class="ws-dot">{{ workspaceInitial }}</div>
        <div class="ws-name" :title="workspaceName">{{ workspaceName }}</div>
      </div>
      <div v-else class="ws-dot ws-dot-only">{{ workspaceInitial }}</div>
      <button class="collapse-btn" :title="collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'" :aria-label="collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'" @click="toggleCollapsed">
        <span v-if="collapsed">»</span>
        <span v-else>‹‹</span>
      </button>
    </header>

    <!-- ══════ COLLAPSED MODE ══════ -->
    <div v-if="collapsed" class="c-content">
      <div class="c-icon-strip" role="toolbar" aria-label="Bộ lọc sidebar (thu gọn)">
        <button
          type="button"
          class="c-icon-btn"
          :class="{ active: filters.state.folderId !== null }"
          :title="`Thư mục Nick Zalo${selectedFolder ? ' · ' + selectedFolder.name : ''}`"
          aria-label="Quản lý thư mục Nick Zalo"
          @click="$emit('manage-folders')"
        >
          <span class="ic">📁</span>
          <span v-if="filters.state.folderId !== null" class="dot-only"></span>
        </button>

        <button
          v-if="filters.presets.value.length > 0"
          type="button"
          class="c-icon-btn"
          :class="{ active: filters.activePresetId.value !== null, open: openPopover === 'preset' }"
          :title="`Bộ lọc đã lưu (${filters.presets.value.length})`"
          aria-label="Bộ lọc đã lưu"
          @click.stop="togglePopover('preset')"
        >
          <span class="ic">⭐</span>
          <span class="badge">{{ filters.presets.value.length }}</span>
        </button>

        <div class="c-divider"></div>

        <button
          type="button"
          class="c-icon-btn"
          :class="{ active: tagActiveCount > 0, open: openPopover === 'tag' }"
          :title="`Tag${tagActiveCount > 0 ? ` · ${tagActiveCount} đang áp` : ''}`"
          aria-label="Lọc theo tag"
          @click.stop="togglePopover('tag')"
        >
          <span class="ic">🏷</span>
          <span v-if="tagActiveCount > 0" class="badge">{{ tagActiveCount }}</span>
        </button>

        <button
          type="button"
          class="c-icon-btn"
          :class="{ active: scoreActiveCount > 0, open: openPopover === 'score' }"
          :title="`Score & Stage${scoreActiveCount > 0 ? ` · ${scoreActiveCount} đang áp` : ''}`"
          aria-label="Lọc theo score và stage"
          @click.stop="togglePopover('score')"
        >
          <span class="ic">📊</span>
          <span v-if="scoreActiveCount > 0" class="badge">{{ scoreActiveCount }}</span>
        </button>

        <button
          type="button"
          class="c-icon-btn"
          :class="{ active: timeActiveCount > 0, open: openPopover === 'time' }"
          :title="`Thời gian${timeActiveCount > 0 ? ` · ${timeActiveCount} đang áp` : ''}`"
          aria-label="Lọc theo thời gian"
          @click.stop="togglePopover('time')"
        >
          <span class="ic">🕐</span>
          <span v-if="timeActiveCount > 0" class="badge">{{ timeActiveCount }}</span>
        </button>

        <button
          type="button"
          class="c-icon-btn"
          :class="{ active: eventActiveCount > 0, open: openPopover === 'event' }"
          :title="`Sự kiện sắp tới${eventActiveCount > 0 ? ` · ${eventActiveCount} đang áp` : ''}`"
          aria-label="Lọc theo sự kiện"
          @click.stop="togglePopover('event')"
        >
          <span class="ic">📅</span>
          <span v-if="eventActiveCount > 0" class="badge red">{{ eventActiveCount }}</span>
        </button>

        <button
          type="button"
          class="c-icon-btn"
          :class="{ active: saleActiveCount > 0, open: openPopover === 'sale' }"
          :title="`Sale phụ trách${saleActiveCount > 0 ? ` · 1 đang áp` : ''}`"
          aria-label="Lọc theo sale phụ trách"
          @click.stop="togglePopover('sale')"
        >
          <span class="ic">👨‍💼</span>
          <span v-if="saleActiveCount > 0" class="badge">{{ saleActiveCount }}</span>
        </button>
      </div>

      <div v-if="filters.hasActiveFilter.value" class="c-footer">
        <div class="c-total-badge" :title="`${filters.activeFilterChips.value.length} filter đang áp`">{{ filters.activeFilterChips.value.length }}</div>
        <button class="c-clear-btn" type="button" :title="'Xoá tất cả filter'" aria-label="Xoá tất cả filter" @click="filters.clearAll">⨉</button>
      </div>

      <!-- Popover overlay (anchored beside icon strip) -->
      <div
        v-if="openPopover"
        class="c-popover"
        :style="popoverStyle"
        role="dialog"
        :aria-label="popoverTitle"
        @click.stop
      >
        <div class="po-header">
          <div class="po-title">
            <span>{{ popoverEmoji }} {{ popoverTitle }}</span>
            <span v-if="popoverActiveCount > 0" class="po-badge">{{ popoverActiveCount }}</span>
          </div>
          <button class="po-close" type="button" @click="openPopover = null" aria-label="Đóng">✕</button>
        </div>

        <div class="po-body">
          <!-- TAG -->
          <template v-if="openPopover === 'tag'">
            <div v-if="totalTagDefsCount > 8" class="tag-search">
              <span class="ic">🔍</span>
              <input v-model="tagSearch" type="text" placeholder="Tìm tag..." aria-label="Tìm tag" />
              <button v-if="tagSearch" type="button" class="tag-search-clear" @click="tagSearch = ''">✕</button>
            </div>
            <div v-if="filteredCrmTags.length > 0" class="po-sub-label">
              Tag CRM ({{ crmTagsList.length }})
              <span v-if="filters.state.tagsCrm.length > 0" class="sub-selected">· {{ filters.state.tagsCrm.length }} đã chọn</span>
            </div>
            <div v-if="filteredCrmTags.length > 0" class="tag-pill-row scroll">
              <button
                v-for="tag in filteredCrmTags"
                :key="`crm-${tag.id}`"
                type="button"
                class="tag-pill"
                :class="{ selected: filters.state.tagsCrm.includes(tag.name) }"
                @click="toggleCrmTag(tag.name)"
              >
                <span v-if="tag.emoji">{{ tag.emoji }}</span>
                {{ tag.name }}
              </button>
            </div>
            <div v-if="filteredZaloTags.length > 0" class="po-sub-label">
              Tag Zalo native ({{ zaloTagsList.length }})
              <span v-if="filters.state.tagsZalo.length > 0" class="sub-selected">· {{ filters.state.tagsZalo.length }} đã chọn</span>
            </div>
            <div v-if="filteredZaloTags.length > 0" class="tag-pill-row scroll">
              <button
                v-for="tag in filteredZaloTags"
                :key="`zalo-${tag.id}`"
                type="button"
                class="tag-pill zalo"
                :class="{ selected: filters.state.tagsZalo.includes(displayTagName(tag.name)) }"
                @click="toggleZaloTag(displayTagName(tag.name))"
              >
                <span class="zalo-dot"></span>
                {{ displayTagName(tag.name) }}
              </button>
            </div>
            <div class="po-sub-label">Auto-tag</div>
            <div class="tag-pill-row">
              <button
                v-for="at in AUTO_TAGS"
                :key="at.key"
                type="button"
                class="tag-pill"
                :class="{ selected: filters.state.autoTags.includes(at.key) }"
                @click="toggleAutoTag(at.key)"
              >{{ at.icon }} {{ at.label }}</button>
            </div>
          </template>

          <!-- PRESET -->
          <template v-if="openPopover === 'preset'">
            <button
              v-for="preset in filters.presets.value"
              :key="preset.id"
              type="button"
              class="po-preset-row"
              :class="{ active: filters.activePresetId.value === preset.id }"
              @click="filters.applyPreset(preset); openPopover = null"
            >
              <span class="po-preset-emoji">{{ preset.emoji || '⭐' }}</span>
              <span class="po-preset-name">{{ preset.name }}</span>
            </button>
            <button class="po-create-btn" type="button" @click="onCreatePresetFromPopover">+ Lưu bộ lọc hiện tại</button>
          </template>

          <!-- SCORE & STAGE -->
          <template v-if="openPopover === 'score'">
            <div class="po-sub-label">Lead score: {{ filters.state.scoreMin ?? 0 }} — {{ filters.state.scoreMax ?? 100 }}</div>
            <div class="score-wrap">
              <div class="score-row">
                <input
                  class="score-input"
                  type="number"
                  min="0"
                  max="100"
                  :value="filters.state.scoreMin ?? 0"
                  @change="onScoreMinChange(($event.target as HTMLInputElement).valueAsNumber)"
                />
                <div class="score-track">
                  <div class="score-fill" :style="scoreFillStyle"></div>
                </div>
                <input
                  class="score-input"
                  type="number"
                  min="0"
                  max="100"
                  :value="filters.state.scoreMax ?? 100"
                  @change="onScoreMaxChange(($event.target as HTMLInputElement).valueAsNumber)"
                />
              </div>
              <div class="score-tiers">
                <button
                  v-for="tier in SCORE_TIERS"
                  :key="tier.key"
                  type="button"
                  class="score-tier-btn"
                  :class="{ active: filters.state.scoreTier === tier.key }"
                  @click="onSelectScoreTier(tier.key)"
                >{{ tier.label }}</button>
              </div>
            </div>
            <div class="po-sub-label">Stage pipeline</div>
            <div class="stage-chips">
              <button
                v-for="stage in STAGES"
                :key="stage.key"
                type="button"
                class="stage-chip"
                :class="[stage.key, { selected: filters.state.stages.includes(stage.label) }]"
                @click="toggleStage(stage.label)"
              >{{ stage.icon }} {{ stage.label }}</button>
            </div>
            <div class="po-sub-label">Stuck duration</div>
            <div class="radio-bar">
              <button
                type="button"
                class="radio-pill"
                :class="{ active: filters.state.stuckDuration === null }"
                @click="filters.state.stuckDuration = null"
              >Tất cả</button>
              <button
                v-for="dur in STUCK_DURATIONS"
                :key="dur"
                type="button"
                class="radio-pill"
                :class="{ active: filters.state.stuckDuration === dur }"
                @click="filters.state.stuckDuration = dur"
              >{{ dur }}</button>
            </div>
          </template>

          <!-- TIME -->
          <template v-if="openPopover === 'time'">
            <div class="po-sub-label">Tin nhắn cuối</div>
            <div class="radio-bar">
              <button
                v-for="win in LAST_MESSAGE_OPTIONS"
                :key="win.key"
                type="button"
                class="radio-pill"
                :class="{ active: filters.state.lastMessageWithin === win.key }"
                @click="toggleLastMessage(win.key)"
              >{{ win.label }}</button>
            </div>
            <div class="po-sub-label">Cờ tương tác</div>
            <div class="check-row" :class="{ checked: filters.state.customerWaitingReply }" @click="filters.state.customerWaitingReply = !filters.state.customerWaitingReply">
              <div class="left"><span class="checkbox"></span><span class="label">KH chờ sale reply</span></div>
            </div>
            <div class="check-row" :class="{ checked: filters.state.saleWaitingReply }" @click="filters.state.saleWaitingReply = !filters.state.saleWaitingReply">
              <div class="left"><span class="checkbox"></span><span class="label">Sale chờ KH reply</span></div>
            </div>
          </template>

          <!-- EVENT -->
          <template v-if="openPopover === 'event'">
            <div class="event-row" :class="{ checked: filters.state.birthdayWithin7d }" @click="filters.state.birthdayWithin7d = !filters.state.birthdayWithin7d">
              <div class="left"><span class="icon">🎂</span><span class="lbl">Sinh nhật 7 ngày tới</span></div>
              <span v-if="eventCounts.birthday > 0" class="right-count">{{ eventCounts.birthday }}</span>
            </div>
            <div class="event-row" :class="{ checked: filters.state.appointmentWithin24h }" @click="filters.state.appointmentWithin24h = !filters.state.appointmentWithin24h">
              <div class="left"><span class="icon">📞</span><span class="lbl">Lịch hẹn 24h tới</span></div>
              <span v-if="eventCounts.appointmentSoon > 0" class="right-count amber">{{ eventCounts.appointmentSoon }}</span>
            </div>
            <div class="event-row" :class="{ checked: filters.state.appointmentOverdue }" @click="filters.state.appointmentOverdue = !filters.state.appointmentOverdue">
              <div class="left"><span class="icon">⚠️</span><span class="lbl">Hẹn quá hạn</span></div>
              <span v-if="eventCounts.appointmentOverdue > 0" class="right-count">{{ eventCounts.appointmentOverdue }}</span>
            </div>
          </template>

          <!-- SALE -->
          <template v-if="openPopover === 'sale'">
            <div class="sale-row" :class="{ checked: filters.state.saleAssigneeId === null }" @click="filters.state.saleAssigneeId = null">
              <span class="circle"></span>
              <span class="label">Tôi ({{ currentUserName || 'Tôi' }})</span>
            </div>
            <div class="sale-row" :class="{ checked: filters.state.saleAssigneeId === 'all' }" @click="filters.state.saleAssigneeId = 'all'">
              <span class="circle"></span>
              <span class="label">Tất cả sale</span>
            </div>
            <div class="sale-row" :class="{ checked: filters.state.saleAssigneeId === 'unassigned' }" @click="filters.state.saleAssigneeId = 'unassigned'">
              <span class="circle"></span>
              <span class="label">Chưa giao sale</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ══════ EXPANDED MODE ══════ -->
    <div v-else class="sb-content">

      <!-- ══════ FOLDER PICKER (compact, 3 modes) ══════ -->
      <div class="folder-picker">
        <div class="fp-label">📁 Phạm vi xem</div>
        <button class="fp-current" type="button" @click="$emit('manage-folders')" :title="folderPickerTitle">
          <div class="fp-thumb">
            <!-- Mode 3: Single nick -->
            <template v-if="selectedAccount">
              <div class="single" :style="avatarStyle(selectedAccount, 0)">
                <span v-if="!selectedAccount.avatarUrl">{{ initials(selectedAccount.displayName) }}</span>
              </div>
            </template>
            <!-- Mode 2: Folder selected -->
            <template v-else-if="selectedFolder && selectedFolder.members.length > 0">
              <div
                v-for="(m, idx) in selectedFolder.members.slice(0, 2)"
                :key="m.id"
                class="av"
                :class="`av-${idx}`"
                :style="avatarStyle(m, idx)"
              ><span v-if="!m.avatarUrl">{{ initials(m.displayName) }}</span></div>
            </template>
            <!-- Mode 1: ALL -->
            <template v-else>
              <div class="single all-thumb">🌐</div>
            </template>
          </div>
          <div class="fp-body">
            <div class="fp-name">{{ folderPickerName }}</div>
            <div class="fp-sub">{{ folderSubLabel }}</div>
          </div>
          <div class="fp-arrow" aria-hidden="true">⋯</div>
        </button>
      </div>

      <!-- ══════ SAVED PRESET BAR (horizontal) ══════ -->
      <div class="saved-bar">
        <span class="saved-label">⭐</span>
        <button
          v-for="preset in filters.presets.value"
          :key="preset.id"
          type="button"
          class="saved-chip"
          :class="{ active: filters.activePresetId.value === preset.id }"
          @click="filters.applyPreset(preset)"
          :title="preset.name"
        >{{ preset.emoji || '⭐' }} {{ preset.name }}</button>
        <button class="saved-chip add" type="button" @click="onCreatePreset">+ Lưu</button>
      </div>

      <!-- ══════ BODY SCROLL ══════ -->
      <div class="sb-body">

        <!-- 🏷 TAG -->
        <section class="section" :class="{ collapsed: !sectionsOpen.tag }">
          <header class="section-header" tabindex="0" role="button" :aria-expanded="sectionsOpen.tag" @click="toggleSection('tag')" @keydown.enter.prevent="toggleSection('tag')" @keydown.space.prevent="toggleSection('tag')">
            <div class="left"><span class="emoji">🏷</span>Tag</div>
            <div class="right">
              <span v-if="tagActiveCount > 0" class="count-badge">{{ tagActiveCount }}</span>
              <span v-else class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
          <div class="section-body">
            <!-- Tag search input (shared for both CRM + Zalo) -->
            <div v-if="totalTagDefsCount > 8" class="tag-search">
              <span class="ic">🔍</span>
              <input
                v-model="tagSearch"
                type="text"
                placeholder="Tìm tag..."
                aria-label="Tìm tag"
              />
              <button v-if="tagSearch" type="button" class="tag-search-clear" @click="tagSearch = ''" aria-label="Xoá tìm kiếm">✕</button>
            </div>

            <div v-if="filteredCrmTags.length > 0" class="subsection-label">
              Tag CRM ({{ crmTagsList.length }})
              <span v-if="filters.state.tagsCrm.length > 0" class="sub-selected">· {{ filters.state.tagsCrm.length }} đã chọn</span>
            </div>
            <div v-if="filteredCrmTags.length > 0" class="tag-pill-row scroll">
              <button
                v-for="tag in filteredCrmTags"
                :key="`crm-${tag.id}`"
                type="button"
                class="tag-pill"
                :class="{ selected: filters.state.tagsCrm.includes(tag.name) }"
                @click="toggleCrmTag(tag.name)"
              >
                <span v-if="tag.emoji">{{ tag.emoji }}</span>
                {{ tag.name }}
              </button>
            </div>

            <div v-if="filteredZaloTags.length > 0" class="subsection-label">
              Tag Zalo native ({{ zaloTagsList.length }})
              <span v-if="filters.state.tagsZalo.length > 0" class="sub-selected">· {{ filters.state.tagsZalo.length }} đã chọn</span>
            </div>
            <div v-if="filteredZaloTags.length > 0" class="tag-pill-row scroll">
              <button
                v-for="tag in filteredZaloTags"
                :key="`zalo-${tag.id}`"
                type="button"
                class="tag-pill zalo"
                :class="{ selected: filters.state.tagsZalo.includes(displayTagName(tag.name)) }"
                @click="toggleZaloTag(displayTagName(tag.name))"
              >
                <span class="zalo-dot"></span>
                {{ displayTagName(tag.name) }}
              </button>
            </div>

            <div v-if="tagSearch && filteredCrmTags.length === 0 && filteredZaloTags.length === 0" class="tag-empty">
              Không tìm thấy tag "{{ tagSearch }}"
            </div>

            <div class="subsection-label">Auto-tag</div>
            <div class="tag-pill-row">
              <button
                v-for="at in AUTO_TAGS"
                :key="at.key"
                type="button"
                class="tag-pill"
                :class="{ selected: filters.state.autoTags.includes(at.key) }"
                @click="toggleAutoTag(at.key)"
              >{{ at.icon }} {{ at.label }}</button>
            </div>
          </div>
        </section>

        <!-- 📊 SCORE & STAGE -->
        <section class="section" :class="{ collapsed: !sectionsOpen.score }">
          <header class="section-header" tabindex="0" role="button" :aria-expanded="sectionsOpen.score" @click="toggleSection('score')" @keydown.enter.prevent="toggleSection('score')" @keydown.space.prevent="toggleSection('score')">
            <div class="left"><span class="emoji">📊</span>Score &amp; Stage</div>
            <div class="right">
              <span v-if="scoreActiveCount > 0" class="count-badge">{{ scoreActiveCount }}</span>
              <span v-else class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
          <div class="section-body">
            <div class="subsection-label">Lead score: {{ filters.state.scoreMin ?? 0 }} — {{ filters.state.scoreMax ?? 100 }}</div>
            <div class="score-wrap">
              <div class="score-row">
                <input
                  class="score-input"
                  type="number"
                  min="0"
                  max="100"
                  :value="filters.state.scoreMin ?? 0"
                  @change="onScoreMinChange(($event.target as HTMLInputElement).valueAsNumber)"
                />
                <div class="score-track" :aria-hidden="true">
                  <div class="score-fill" :style="scoreFillStyle"></div>
                </div>
                <input
                  class="score-input"
                  type="number"
                  min="0"
                  max="100"
                  :value="filters.state.scoreMax ?? 100"
                  @change="onScoreMaxChange(($event.target as HTMLInputElement).valueAsNumber)"
                />
              </div>
              <div class="score-tiers">
                <button
                  v-for="tier in SCORE_TIERS"
                  :key="tier.key"
                  type="button"
                  class="score-tier-btn"
                  :class="{ active: filters.state.scoreTier === tier.key }"
                  @click="onSelectScoreTier(tier.key)"
                >{{ tier.label }}</button>
              </div>
            </div>

            <div class="subsection-label">Stage pipeline</div>
            <div class="stage-chips">
              <button
                v-for="stage in STAGES"
                :key="stage.key"
                type="button"
                class="stage-chip"
                :class="[stage.key, { selected: filters.state.stages.includes(stage.label) }]"
                @click="toggleStage(stage.label)"
              >{{ stage.icon }} {{ stage.label }}</button>
            </div>

            <div class="subsection-label">Stuck duration</div>
            <div class="radio-bar">
              <button
                type="button"
                class="radio-pill"
                :class="{ active: filters.state.stuckDuration === null }"
                @click="filters.state.stuckDuration = null"
              >Tất cả</button>
              <button
                v-for="dur in STUCK_DURATIONS"
                :key="dur"
                type="button"
                class="radio-pill"
                :class="{ active: filters.state.stuckDuration === dur }"
                @click="filters.state.stuckDuration = dur"
              >{{ dur }}</button>
            </div>
          </div>
        </section>

        <!-- 🕐 THỜI GIAN -->
        <section class="section" :class="{ collapsed: !sectionsOpen.time }">
          <header class="section-header" tabindex="0" role="button" :aria-expanded="sectionsOpen.time" @click="toggleSection('time')" @keydown.enter.prevent="toggleSection('time')" @keydown.space.prevent="toggleSection('time')">
            <div class="left"><span class="emoji">🕐</span>Thời gian</div>
            <div class="right">
              <span v-if="timeActiveCount > 0" class="count-badge">{{ timeActiveCount }}</span>
              <span v-else class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
          <div class="section-body">
            <div class="subsection-label">Tin nhắn cuối</div>
            <div class="radio-bar">
              <button
                v-for="win in LAST_MESSAGE_OPTIONS"
                :key="win.key"
                type="button"
                class="radio-pill"
                :class="{ active: filters.state.lastMessageWithin === win.key }"
                @click="toggleLastMessage(win.key)"
              >{{ win.label }}</button>
            </div>

            <div class="subsection-label" style="margin-top:10px;">Cờ tương tác</div>
            <div class="check-row" :class="{ checked: filters.state.customerWaitingReply }" @click="filters.state.customerWaitingReply = !filters.state.customerWaitingReply">
              <div class="left">
                <span class="checkbox"></span>
                <span class="label">KH chờ sale reply</span>
              </div>
              <span class="count">—</span>
            </div>
            <div class="check-row" :class="{ checked: filters.state.saleWaitingReply }" @click="filters.state.saleWaitingReply = !filters.state.saleWaitingReply">
              <div class="left">
                <span class="checkbox"></span>
                <span class="label">Sale chờ KH reply</span>
              </div>
              <span class="count">—</span>
            </div>
          </div>
        </section>

        <!-- 📅 SỰ KIỆN -->
        <section class="section" :class="{ collapsed: !sectionsOpen.event }">
          <header class="section-header" tabindex="0" role="button" :aria-expanded="sectionsOpen.event" @click="toggleSection('event')" @keydown.enter.prevent="toggleSection('event')" @keydown.space.prevent="toggleSection('event')">
            <div class="left"><span class="emoji">📅</span>Sự kiện sắp tới</div>
            <div class="right">
              <span v-if="eventActiveCount > 0" class="count-badge">{{ eventActiveCount }}</span>
              <span v-else class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
          <div class="section-body">
            <div class="event-row" :class="{ checked: filters.state.birthdayWithin7d }" @click="filters.state.birthdayWithin7d = !filters.state.birthdayWithin7d">
              <div class="left"><span class="icon">🎂</span><span class="lbl">Sinh nhật 7 ngày tới</span></div>
              <span v-if="eventCounts.birthday > 0" class="right-count">{{ eventCounts.birthday }}</span>
            </div>
            <div class="event-row" :class="{ checked: filters.state.appointmentWithin24h }" @click="filters.state.appointmentWithin24h = !filters.state.appointmentWithin24h">
              <div class="left"><span class="icon">📞</span><span class="lbl">Lịch hẹn 24h tới</span></div>
              <span v-if="eventCounts.appointmentSoon > 0" class="right-count amber">{{ eventCounts.appointmentSoon }}</span>
            </div>
            <div class="event-row" :class="{ checked: filters.state.appointmentOverdue }" @click="filters.state.appointmentOverdue = !filters.state.appointmentOverdue">
              <div class="left"><span class="icon">⚠️</span><span class="lbl">Hẹn quá hạn</span></div>
              <span v-if="eventCounts.appointmentOverdue > 0" class="right-count">{{ eventCounts.appointmentOverdue }}</span>
            </div>
          </div>
        </section>

        <!-- 👨‍💼 SALE -->
        <section class="section" :class="{ collapsed: !sectionsOpen.sale }">
          <header class="section-header" tabindex="0" role="button" :aria-expanded="sectionsOpen.sale" @click="toggleSection('sale')" @keydown.enter.prevent="toggleSection('sale')" @keydown.space.prevent="toggleSection('sale')">
            <div class="left"><span class="emoji">👨‍💼</span>Sale phụ trách</div>
            <div class="right">
              <span v-if="saleActiveCount > 0" class="count-badge">{{ saleActiveCount }}</span>
              <span v-else class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
          <div class="section-body">
            <div class="sale-row" :class="{ checked: filters.state.saleAssigneeId === null }" @click="filters.state.saleAssigneeId = null">
              <span class="circle"></span>
              <span class="label">Tôi ({{ currentUserName || 'Tôi' }})</span>
            </div>
            <div class="sale-row" :class="{ checked: filters.state.saleAssigneeId === 'all' }" @click="filters.state.saleAssigneeId = 'all'">
              <span class="circle"></span>
              <span class="label">Tất cả sale</span>
            </div>
            <div class="sale-row" :class="{ checked: filters.state.saleAssigneeId === 'unassigned' }" @click="filters.state.saleAssigneeId = 'unassigned'">
              <span class="circle"></span>
              <span class="label">Chưa giao sale</span>
            </div>
          </div>
        </section>

        <!-- TIER 2: TƯƠNG TÁC (Phase 8 — Engagement pattern filter) -->
        <section class="section" :class="{ collapsed: !sectionsOpen.engagement }">
          <header class="section-header" tabindex="0" role="button" :aria-expanded="sectionsOpen.engagement" @click="toggleEngagementSection" @keydown.enter.prevent="toggleEngagementSection" @keydown.space.prevent="toggleEngagementSection">
            <div class="left"><span class="emoji">💬</span>Tương tác</div>
            <div class="right">
              <span v-if="engagementActiveCount > 0" class="count-badge">{{ engagementActiveCount }}</span>
              <span v-else class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
          <div class="section-body">
            <div class="subsection-label">Pattern engagement</div>
            <div class="event-row" v-for="p in ENGAGEMENT_PATTERNS" :key="p.key" :class="{ checked: filters.state.engagementPatterns.includes(p.key) }" @click="toggleEngagementPattern(p.key)">
              <div class="left">
                <span class="icon">{{ p.icon }}</span>
                <span class="lbl">{{ p.label }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- TIER 2: HỒ SƠ KH -->
        <section class="section collapsed">
          <header class="section-header" tabindex="0" role="button" aria-expanded="false">
            <div class="left"><span class="emoji">👤</span>Hồ sơ KH</div>
            <div class="right">
              <span class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
        </section>

        <!-- TIER 2: NGUỒN -->
        <section class="section collapsed">
          <header class="section-header" tabindex="0" role="button" aria-expanded="false">
            <div class="left"><span class="emoji">📡</span>Nguồn &amp; Attribution</div>
            <div class="right">
              <span class="count-badge zero">0</span>
              <span class="chevron">▾</span>
            </div>
          </header>
        </section>

        <!-- TIER 3: BUSINESS (defer) -->
        <section class="section collapsed disabled">
          <header class="section-header" :title="'Defer — chờ tích hợp invoice'">
            <div class="left"><span class="emoji">💼</span>Business value</div>
            <div class="right">
              <span class="defer-tag">defer</span>
              <span class="chevron">▾</span>
            </div>
          </header>
        </section>

        <!-- TIER 3: AI SIGNAL (defer) -->
        <section class="section collapsed disabled">
          <header class="section-header" :title="'Defer — chờ AI pipeline'">
            <div class="left"><span class="emoji">🤖</span>AI signal</div>
            <div class="right">
              <span class="defer-tag">defer</span>
              <span class="chevron">▾</span>
            </div>
          </header>
        </section>

      </div>

      <!-- ══════ FOOTER ══════ -->
      <div v-if="filters.hasActiveFilter.value" class="sb-footer">
        <div class="footer-card">
          <div class="footer-title">
            <span class="badge">{{ filters.activeFilterChips.value.length }}</span>
            <span>lọc đang áp · {{ resultCount }} KH</span>
          </div>
          <div class="footer-chips">
            <button
              v-for="chip in filters.activeFilterChips.value"
              :key="chip.key"
              type="button"
              class="f-chip"
              @click="chip.remove()"
            >{{ chip.label }}<span class="x">✕</span></button>
          </div>
          <button class="clear-all" type="button" @click="filters.clearAll">⨉ Xoá tất cả filter</button>
        </div>
      </div>

    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import type { AccountFolder, AutoTagKey, ScoreTier, StuckDuration, LastMessageWithin, EngagementPatternKey } from '@/composables/use-inbox-filters';
import { useCrmTagDefs, cleanTagName, type CrmTagDef } from '@/composables/use-crm-tag-defs';

const props = defineProps<{
  filters: any; // useInboxFilters() return
  workspaceName?: string;
  currentUserName?: string;
  currentUserId?: string;
  allAccountsCount?: number;
  totalUnread?: number;
  resultCount?: number;
  currentAccountId?: string | null;
  currentAccount?: { id: string; displayName: string | null; avatarUrl?: string | null; status: string } | null;
}>();

defineEmits<{
  'manage-folders': [];
  'clear-account-filter': [];
  'change': [];
}>();

// ─── Collapse state ──────────────────────────────────────
const collapsed = ref(localStorage.getItem('filter-sidebar-collapsed') === '1');
function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  localStorage.setItem('filter-sidebar-collapsed', collapsed.value ? '1' : '0');
  // Close any open popover when toggling collapse
  openPopover.value = null;
}

// ─── Collapsed mode popover state ────────────────────────
type PopoverKey = 'tag' | 'score' | 'time' | 'event' | 'sale' | 'preset';
const openPopover = ref<PopoverKey | null>(null);
function togglePopover(k: PopoverKey) {
  openPopover.value = openPopover.value === k ? null : k;
}

const POPOVER_META: Record<PopoverKey, { title: string; emoji: string; iconIndex: number }> = {
  preset: { title: 'Bộ lọc đã lưu', emoji: '⭐', iconIndex: 1 },
  tag: { title: 'Tag', emoji: '🏷', iconIndex: 2 },
  score: { title: 'Score & Stage', emoji: '📊', iconIndex: 3 },
  time: { title: 'Thời gian', emoji: '🕐', iconIndex: 4 },
  event: { title: 'Sự kiện sắp tới', emoji: '📅', iconIndex: 5 },
  sale: { title: 'Sale phụ trách', emoji: '👨‍💼', iconIndex: 6 },
};

const popoverTitle = computed(() => openPopover.value ? POPOVER_META[openPopover.value].title : '');
const popoverEmoji = computed(() => openPopover.value ? POPOVER_META[openPopover.value].emoji : '');
const popoverActiveCount = computed(() => {
  switch (openPopover.value) {
    case 'tag': return tagActiveCount.value;
    case 'score': return scoreActiveCount.value;
    case 'time': return timeActiveCount.value;
    case 'event': return eventActiveCount.value;
    case 'sale': return saleActiveCount.value;
    default: return 0;
  }
});

// Anchor popover vertically next to the clicked icon
const ICON_BTN_HEIGHT = 40;
const ICON_GAP = 4;
const ICON_STRIP_PADDING_TOP = 8;
const ICON_DIVIDER_HEIGHT = 9; // 1px line + 4px margin × 2
const popoverStyle = computed(() => {
  if (!openPopover.value) return {};
  const idx = POPOVER_META[openPopover.value].iconIndex;
  // Strip layout: 1 folder + (preset?) + divider + (tag, score, time, event, sale)
  const presetVisible = props.filters.presets.value.length > 0;
  let buttonsBeforeDivider = 1 + (presetVisible ? 1 : 0);
  let y = ICON_STRIP_PADDING_TOP;
  // sum buttons before our index
  for (let i = 0; i < idx; i++) {
    // each icon contributes height + gap
    y += ICON_BTN_HEIGHT + ICON_GAP;
    if (i === buttonsBeforeDivider - 1) y += ICON_DIVIDER_HEIGHT;
  }
  return { top: `${y}px` };
});

// Close popover on outside click / ESC
function onDocClick(e: MouseEvent) {
  if (!openPopover.value) return;
  const target = e.target as HTMLElement;
  if (target.closest('.c-popover') || target.closest('.c-icon-btn')) return;
  openPopover.value = null;
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && openPopover.value) {
    openPopover.value = null;
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeyDown);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeyDown);
});

// Close popover when expanding sidebar
watch(collapsed, (v) => { if (!v) openPopover.value = null; });

async function onCreatePresetFromPopover() {
  openPopover.value = null;
  await onCreatePreset();
}

// ─── Section expand state (persist) ──────────────────────
type SectionKey = 'tag' | 'score' | 'time' | 'event' | 'sale' | 'engagement';
const SECTION_KEYS: SectionKey[] = ['tag', 'score', 'time', 'event', 'sale', 'engagement'];

// Anh chốt 2026-05-22: default chỉ 'event' (Sự kiện sắp tới) + 'sale' (Sale phụ trách)
// expand. Các section khác (tag/score/time/engagement) collapse → user click chevron để mở.
// Spacing compact + tránh dồn UI.
const DEFAULT_OPEN: Record<SectionKey, boolean> = {
  tag: false,
  score: false,
  time: false,
  event: true,
  sale: true,
  engagement: false,
};
const SECTION_DEFAULT_MIGRATION_KEY = 'chat-sidebar.section.v2-default-applied';
function loadSectionState(): Record<SectionKey, boolean> {
  // Migration 1-time: user trước fix có tất cả keys = '1' (legacy default). Reset
  // 4 keys không phải event/sale về null để dùng DEFAULT_OPEN mới. User vẫn có
  // thể override sau bằng click chevron — localStorage sẽ ghi lại.
  if (!localStorage.getItem(SECTION_DEFAULT_MIGRATION_KEY)) {
    for (const k of SECTION_KEYS) {
      if (!DEFAULT_OPEN[k]) localStorage.removeItem(`chat-sidebar.section.${k}`);
    }
    localStorage.setItem(SECTION_DEFAULT_MIGRATION_KEY, '1');
  }
  const result = {} as Record<SectionKey, boolean>;
  for (const k of SECTION_KEYS) {
    const raw = localStorage.getItem(`chat-sidebar.section.${k}`);
    result[k] = raw === null ? DEFAULT_OPEN[k] : raw === '1';
  }
  return result;
}
const sectionsOpen = reactive(loadSectionState());
function toggleSection(k: SectionKey) {
  sectionsOpen[k] = !sectionsOpen[k];
  localStorage.setItem(`chat-sidebar.section.${k}`, sectionsOpen[k] ? '1' : '0');
}

// ─── Workspace ───────────────────────────────────────────
const workspaceName = computed(() => props.workspaceName || 'Workspace');
const workspaceInitial = computed(() => {
  const n = workspaceName.value;
  return (n.split(' ').filter(Boolean).pop()?.[0] || n[0] || 'W').toUpperCase();
});

// ─── Selected folder ─────────────────────────────────────
const selectedFolder = computed<AccountFolder | null>(() => {
  const id = props.filters.state.folderId;
  if (!id) return null;
  return (props.filters.folders.value as AccountFolder[]).find((f) => f.id === id) || null;
});

const selectedAccount = computed(() => {
  // Use currentAccount prop if provided (preferred — works without folder context)
  if (props.currentAccount) {
    return {
      id: props.currentAccount.id,
      displayName: props.currentAccount.displayName,
      avatarUrl: props.currentAccount.avatarUrl ?? null,
      status: props.currentAccount.status,
      zaloUid: null,
    };
  }
  // Fallback: derive from folder members (when both folder + nick set)
  if (!props.currentAccountId || !selectedFolder.value) return null;
  return selectedFolder.value.members.find((m) => m.id === props.currentAccountId) || null;
});

const folderSubLabel = computed(() => {
  if (selectedAccount.value) {
    return selectedAccount.value.status === 'connected' ? 'Active · Nick Zalo' : 'Offline · Nick Zalo';
  }
  if (selectedFolder.value) {
    return `${selectedFolder.value.members.length} nick`;
  }
  return `${props.allAccountsCount || 0} nick`;
});

const folderPickerName = computed(() => {
  if (selectedAccount.value) {
    return selectedAccount.value.displayName || 'Nick Zalo';
  }
  return selectedFolder.value?.name || 'ALL — Toàn bộ';
});

const folderPickerTitle = computed(() => {
  if (selectedAccount.value) return `Đang xem chat của nick ${selectedAccount.value.displayName}. Click để đổi.`;
  if (selectedFolder.value) return `Đang xem folder ${selectedFolder.value.name} (${selectedFolder.value.members.length} nick). Click để đổi.`;
  return 'Đang xem toàn bộ. Click để chọn folder hoặc nick cụ thể.';
});

// ─── Tag def fetch + split ───────────────────────────────
const { tagDefs, loadTagDefs } = useCrmTagDefs();

const crmTagsList = computed<CrmTagDef[]>(() =>
  tagDefs.value.filter((t) => t.managedBy !== 'zalo_sync')
);
const zaloTagsList = computed<CrmTagDef[]>(() =>
  tagDefs.value.filter((t) => t.managedBy === 'zalo_sync')
);
const totalTagDefsCount = computed(() => crmTagsList.value.length + zaloTagsList.value.length);

// Strip "🔵 " prefix from Zalo tag display (DB legacy data)
function displayTagName(name: string): string {
  return cleanTagName(name);
}

// ─── Tag search + selected-first ordering ────────────────
const tagSearch = ref('');

function rankTag(tag: CrmTagDef, selectedSet: Set<string>): number {
  const isSelected = selectedSet.has(tag.name) || selectedSet.has(cleanTagName(tag.name));
  return isSelected ? 0 : 1;
}

const filteredCrmTags = computed<CrmTagDef[]>(() => {
  const q = tagSearch.value.trim().toLowerCase();
  const selected = new Set(props.filters.state.tagsCrm as string[]);
  const list = q
    ? crmTagsList.value.filter((t) => t.name.toLowerCase().includes(q))
    : crmTagsList.value;
  return [...list].sort((a, b) => {
    const ra = rankTag(a, selected);
    const rb = rankTag(b, selected);
    if (ra !== rb) return ra - rb;
    return a.order - b.order;
  });
});

const filteredZaloTags = computed<CrmTagDef[]>(() => {
  const q = tagSearch.value.trim().toLowerCase();
  const selected = new Set(props.filters.state.tagsZalo as string[]);
  const list = q
    ? zaloTagsList.value.filter((t) => cleanTagName(t.name).toLowerCase().includes(q))
    : zaloTagsList.value;
  return [...list].sort((a, b) => {
    const ra = rankTag(a, selected);
    const rb = rankTag(b, selected);
    if (ra !== rb) return ra - rb;
    return a.order - b.order;
  });
});

// ─── Constants ───────────────────────────────────────────
const AUTO_TAGS: Array<{ key: AutoTagKey; icon: string; label: string }> = [
  { key: 'hot', icon: '🔥', label: 'Hot' },
  { key: 'active', icon: '✅', label: 'Active' },
  { key: 'stuck', icon: '⏸', label: 'Stuck' },
  { key: 'cold', icon: '❄️', label: 'Cold' },
];

const SCORE_TIERS: Array<{ key: NonNullable<ScoreTier>; label: string; min: number; max: number }> = [
  { key: 'cold', label: 'Cold', min: 0, max: 30 },
  { key: 'warm', label: 'Warm', min: 31, max: 60 },
  { key: 'hot', label: 'Hot', min: 61, max: 85 },
  { key: 'champion', label: 'Champion', min: 86, max: 100 },
];

const STAGES: Array<{ key: string; icon: string; label: string }> = [
  { key: 'hot', icon: '🔥', label: 'Nóng' },
  { key: 'warm', icon: '🌡', label: 'Ấm' },
  { key: 'cold', icon: '❄️', label: 'Lạnh' },
  { key: 'closed', icon: '✅', label: 'Đã chốt' },
];

const STUCK_DURATIONS: NonNullable<StuckDuration>[] = ['>3d', '>7d', '>14d', '>30d'];

const LAST_MESSAGE_OPTIONS: Array<{ key: NonNullable<LastMessageWithin>; label: string }> = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '>30d', label: '>30d' },
  { key: 'custom', label: 'Tuỳ chỉnh' },
];

// Phase 8 — Engagement pattern filter buttons
const ENGAGEMENT_PATTERNS: Array<{ key: EngagementPatternKey; icon: string; label: string }> = [
  { key: 'hot', icon: '🔥', label: 'Đang nóng lên' },
  { key: 'champion', icon: '💎', label: 'Champion (đều cao)' },
  { key: 'stable', icon: '📈', label: 'Ổn định' },
  { key: 'cooling', icon: '⚠', label: 'Đang nguội' },
  { key: 'cold', icon: '😴', label: 'Lạnh' },
];

// ─── Active count per section ────────────────────────────
const tagActiveCount = computed(() =>
  props.filters.state.tagsCrm.length +
  props.filters.state.tagsZalo.length +
  props.filters.state.autoTags.length
);
const scoreActiveCount = computed(() => {
  let n = 0;
  if (props.filters.state.scoreTier !== null) n++;
  if (props.filters.state.scoreMin !== null || props.filters.state.scoreMax !== null) n++;
  n += props.filters.state.stages.length;
  if (props.filters.state.stuckDuration !== null) n++;
  return n;
});
const timeActiveCount = computed(() => {
  let n = 0;
  if (props.filters.state.lastMessageWithin !== null) n++;
  if (props.filters.state.customerWaitingReply) n++;
  if (props.filters.state.saleWaitingReply) n++;
  return n;
});
const eventActiveCount = computed(() => {
  let n = 0;
  if (props.filters.state.birthdayWithin7d) n++;
  if (props.filters.state.appointmentWithin24h) n++;
  if (props.filters.state.appointmentOverdue) n++;
  return n;
});
const saleActiveCount = computed(() =>
  props.filters.state.saleAssigneeId !== null ? 1 : 0
);
const engagementActiveCount = computed(() =>
  props.filters.state.engagementPatterns.length
);

function toggleEngagementPattern(key: EngagementPatternKey) {
  const arr = props.filters.state.engagementPatterns as EngagementPatternKey[];
  const idx = arr.indexOf(key);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(key);
  props.filters.activePresetId.value = null;
}

function toggleEngagementSection() {
  toggleSection('engagement');
}

// ─── Score slider ────────────────────────────────────────
const scoreFillStyle = computed(() => {
  const min = props.filters.state.scoreMin ?? 0;
  const max = props.filters.state.scoreMax ?? 100;
  return {
    left: `${min}%`,
    right: `${100 - max}%`,
  };
});

function onScoreMinChange(v: number) {
  if (Number.isNaN(v)) return;
  const clamped = Math.max(0, Math.min(100, v));
  props.filters.state.scoreMin = clamped;
  if (props.filters.state.scoreMax !== null && clamped > props.filters.state.scoreMax) {
    props.filters.state.scoreMax = clamped;
  }
  props.filters.state.scoreTier = null;
  props.filters.activePresetId.value = null;
}
function onScoreMaxChange(v: number) {
  if (Number.isNaN(v)) return;
  const clamped = Math.max(0, Math.min(100, v));
  props.filters.state.scoreMax = clamped;
  if (props.filters.state.scoreMin !== null && clamped < props.filters.state.scoreMin) {
    props.filters.state.scoreMin = clamped;
  }
  props.filters.state.scoreTier = null;
  props.filters.activePresetId.value = null;
}

function onSelectScoreTier(tier: NonNullable<ScoreTier>) {
  if (props.filters.state.scoreTier === tier) {
    props.filters.state.scoreTier = null;
    props.filters.state.scoreMin = null;
    props.filters.state.scoreMax = null;
  } else {
    const def = SCORE_TIERS.find((t) => t.key === tier)!;
    props.filters.state.scoreTier = tier;
    props.filters.state.scoreMin = def.min;
    props.filters.state.scoreMax = def.max;
  }
  props.filters.activePresetId.value = null;
}

// ─── Tag toggles ─────────────────────────────────────────
function toggleCrmTag(name: string) {
  const arr = props.filters.state.tagsCrm as string[];
  const idx = arr.indexOf(name);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(name);
  props.filters.activePresetId.value = null;
}
function toggleZaloTag(name: string) {
  const arr = props.filters.state.tagsZalo as string[];
  const idx = arr.indexOf(name);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(name);
  props.filters.activePresetId.value = null;
}
function toggleAutoTag(key: AutoTagKey) {
  const arr = props.filters.state.autoTags as AutoTagKey[];
  const idx = arr.indexOf(key);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(key);
  props.filters.activePresetId.value = null;
}
function toggleStage(label: string) {
  const arr = props.filters.state.stages as string[];
  const idx = arr.indexOf(label);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(label);
  props.filters.activePresetId.value = null;
}
function toggleLastMessage(key: NonNullable<LastMessageWithin>) {
  props.filters.state.lastMessageWithin =
    props.filters.state.lastMessageWithin === key ? null : key;
  props.filters.activePresetId.value = null;
}

// ─── Avatar helpers ──────────────────────────────────────
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #93C5FD, #6366F1)',
  'linear-gradient(135deg, #FBBF24, #EF4444)',
  'linear-gradient(135deg, #34D399, #10B981)',
  'linear-gradient(135deg, #F472B6, #EC4899)',
  'linear-gradient(135deg, #A78BFA, #8B5CF6)',
];
function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}
function avatarStyle(member: AccountFolder['members'][number], idx: number) {
  if (member.avatarUrl) {
    return { backgroundImage: `url(${member.avatarUrl})`, backgroundSize: 'cover' };
  }
  return { background: AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length] };
}

// ─── Preset create prompt ────────────────────────────────
async function onCreatePreset() {
  const name = window.prompt('Tên bộ lọc:');
  if (!name?.trim()) return;
  const emoji = window.prompt('Emoji (tuỳ chọn, vd ⭐ 🔥 🥶):') || '⭐';
  await props.filters.createPreset({ name: name.trim(), emoji });
}

// ─── Event counts (placeholder, backend stats endpoint chưa có) ──
const eventCounts = ref({ birthday: 0, appointmentSoon: 0, appointmentOverdue: 0 });

// ─── Result count (parent có thể truyền qua prop) ────────
const resultCount = computed(() => props.resultCount ?? '—');

onMounted(async () => {
  await Promise.all([
    props.filters.fetchFolders(),
    props.filters.fetchPresets(),
    loadTagDefs(),
  ]);
});
</script>

<style scoped>
.filter-sidebar {
  width: 100%;
  height: 100%;
  background: #FAFAFC;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: #1F2D3D;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
}
.filter-sidebar.collapsed { width: 56px; }

/* ════════════════ COLLAPSED MODE ════════════════ */
.sb-header.stacked {
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.ws-dot-only {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #5E6AD2 0%, #8B5CF6 100%);
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.c-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
.c-icon-strip {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.c-icon-strip::-webkit-scrollbar { width: 0; }
.c-icon-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  position: relative;
  font-size: 18px;
  transition: all 0.12s;
  font-family: inherit;
  flex-shrink: 0;
}
.c-icon-btn:hover { background: #F4F4F7; }
.c-icon-btn.active {
  background: #EEF0FF;
  box-shadow: inset 3px 0 0 #5E6AD2;
}
.c-icon-btn.open {
  background: #5E6AD2;
  color: white;
}
.c-icon-btn.open .ic { filter: brightness(2); }
.c-icon-btn:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }
.c-icon-btn .ic { line-height: 1; }
.c-icon-btn .badge {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 14px;
  height: 14px;
  background: #5E6AD2;
  color: white;
  font-size: 9px;
  font-weight: 700;
  border-radius: 999px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #FAFAFC;
}
.c-icon-btn .badge.red { background: #EF4444; }
.c-icon-btn.open .badge { background: white; color: #5E6AD2; border-color: #5E6AD2; }
.c-icon-btn .dot-only {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 7px;
  height: 7px;
  background: #5E6AD2;
  border-radius: 50%;
  border: 2px solid #FAFAFC;
}
.c-divider {
  width: 24px;
  height: 1px;
  background: #E4E5E9;
  margin: 4px 0;
  flex-shrink: 0;
}
.c-footer {
  flex-shrink: 0;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: linear-gradient(180deg, transparent 0%, white 60%);
  border-top: 1px solid #E4E5E9;
}
.c-total-badge {
  background: #5E6AD2;
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  min-width: 18px;
  text-align: center;
}
.c-clear-btn {
  width: 36px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #E4E5E9;
  background: white;
  color: #EF4444;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.c-clear-btn:hover { background: #FEF2F2; border-color: #EF4444; }

/* Popover */
.c-popover {
  position: absolute;
  left: 56px;
  width: 320px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(15, 23, 42, 0.04);
  z-index: 200;
  overflow: hidden;
  max-height: 480px;
  display: flex;
  flex-direction: column;
}
.c-popover::before {
  content: '';
  position: absolute;
  left: -7px;
  top: 14px;
  width: 0;
  height: 0;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-right: 7px solid white;
  filter: drop-shadow(-1px 0 0 rgba(15, 23, 42, 0.04));
}
.po-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #E4E5E9;
  background: #FAFAFC;
  flex-shrink: 0;
}
.po-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #1F2D3D;
}
.po-title .po-badge {
  background: #5E6AD2;
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
}
.po-close {
  background: transparent;
  border: none;
  color: #97A0AC;
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
}
.po-close:hover { background: #F4F4F7; color: #1F2D3D; }
.po-body {
  padding: 12px 14px;
  overflow-y: auto;
  flex: 1;
}
.po-body::-webkit-scrollbar { width: 4px; }
.po-body::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 2px; }
.po-sub-label {
  font-size: 10.5px;
  font-weight: 600;
  color: #97A0AC;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 8px 0 5px;
}
.po-sub-label:first-child { margin-top: 0; }
.po-preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  color: #1F2D3D;
  text-align: left;
  margin-bottom: 3px;
}
.po-preset-row:hover { background: #F4F4F7; }
.po-preset-row.active {
  background: #EEF0FF;
  border-color: rgba(94, 106, 210, 0.3);
  color: #5E6AD2;
  font-weight: 600;
}
.po-preset-emoji { font-size: 14px; }
.po-preset-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-create-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  margin-top: 8px;
  background: transparent;
  border: 1px dashed #D4D6DB;
  border-radius: 6px;
  color: #5E6AD2;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.po-create-btn:hover { border-color: #5E6AD2; background: #EEF0FF; }

/* ── Header ── */
.sb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #FFFFFF;
  border-bottom: 1px solid #E4E5E9;
  flex-shrink: 0;
}
.ws { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; min-width: 0; flex: 1; }
.ws-dot {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #5E6AD2 0%, #8B5CF6 100%);
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ws-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collapse-btn {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: #6B7785;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.collapse-btn:hover { background: #F4F4F7; }
.collapse-btn:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }

/* ── Content stack ── */
.sb-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ── Folder picker ── */
.folder-picker {
  background: #FFFFFF;
  padding: 10px 12px;
  border-bottom: 1px solid #E4E5E9;
  flex-shrink: 0;
}
.fp-label {
  font-size: 11px;
  font-weight: 600;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.fp-current {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  background: linear-gradient(135deg, #EEF0FF 0%, #F4F4FE 100%);
  border: 1px solid rgba(94, 106, 210, 0.25);
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.fp-current:hover { border-color: #5E6AD2; }
.fp-current:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }
.fp-thumb { width: 26px; height: 26px; position: relative; flex-shrink: 0; }
.fp-thumb .av {
  position: absolute;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: 2px solid #FFFFFF;
  color: white;
  font-size: 7.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
}
.fp-thumb .av-0 { top: 0; left: 0; }
.fp-thumb .av-1 { bottom: 0; right: 0; }
.fp-body { flex: 1; min-width: 0; }
.fp-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #5E6AD2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-sub { font-size: 10.5px; color: #6B7785; }
.fp-arrow { font-size: 13px; color: #5E6AD2; font-weight: 700; }
.fp-thumb .single {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  color: white;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
}
.fp-thumb .single.all-thumb {
  background: linear-gradient(135deg, #5E6AD2, #8B5CF6);
  font-size: 13px;
}
.fp-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 6px;
  padding: 5px 8px;
  background: transparent;
  border: 1px solid #E4E5E9;
  border-radius: 6px;
  color: #5E6AD2;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.fp-back:hover { background: #EEF0FF; border-color: #5E6AD2; }

/* ── Saved preset bar ── */
.saved-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #FFFFFF;
  border-bottom: 1px solid #E4E5E9;
  overflow-x: auto;
  flex-shrink: 0;
}
.saved-bar::-webkit-scrollbar { height: 0; }
.saved-label {
  font-size: 10.5px;
  font-weight: 600;
  color: #97A0AC;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}
.saved-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  background: #F4F4F7;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  color: #1F2D3D;
  font-family: inherit;
}
.saved-chip.active { background: #5E6AD2; color: white; }
.saved-chip:hover:not(.active) { border-color: #D4D6DB; }
.saved-chip.add { background: transparent; color: #5E6AD2; border: 1px dashed #D4D6DB; }
.saved-chip:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }

/* ── Body scroll ── */
.sb-body { flex: 1; overflow-y: auto; padding: 4px 0; min-height: 0; }
.sb-body::-webkit-scrollbar { width: 6px; }
.sb-body::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 3px; }

/* ── Section ── */
.section {
  background: #FFFFFF;
  border-top: 1px solid #E4E5E9;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  font-family: inherit;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
}
.section-header:hover { background: #F4F4F7; }
.section-header:focus-visible { outline: 2px solid #5E6AD2; outline-offset: -2px; }
.section-header .left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #1F2D3D;
}
.section-header .left .emoji { font-size: 14px; }
.section-header .right { display: flex; align-items: center; gap: 6px; }
.count-badge {
  background: #5E6AD2;
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  min-width: 16px;
  text-align: center;
  line-height: 1.4;
}
.count-badge.zero { background: #F4F4F7; color: #97A0AC; }
.chevron { color: #97A0AC; font-size: 11px; transition: transform 0.15s; }
.section.collapsed .chevron { transform: rotate(-90deg); }
.section.disabled .section-header { cursor: not-allowed; }
.section.disabled .section-header .left { color: #B0B5BD; }
.section.disabled .section-header .emoji { opacity: 0.5; }
.defer-tag {
  font-size: 9.5px;
  font-weight: 600;
  color: #B0B5BD;
  background: #F4F4F7;
  padding: 1px 5px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.section-body { padding: 0 14px 12px; }
.section.collapsed .section-body { display: none; }

.subsection-label {
  font-size: 10.5px;
  font-weight: 600;
  color: #97A0AC;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 6px 0 4px;
}

/* ── Tag search ── */
.tag-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: #F4F4F7;
  border: 1px solid transparent;
  border-radius: 6px;
  margin: 2px 0 6px;
}
.tag-search:focus-within {
  background: white;
  border-color: #5E6AD2;
  box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.12);
}
.tag-search .ic { color: #97A0AC; font-size: 11px; flex-shrink: 0; }
.tag-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 11.5px;
  color: #1F2D3D;
  font-family: inherit;
  min-width: 0;
}
.tag-search input::placeholder { color: #97A0AC; }
.tag-search-clear {
  background: transparent;
  border: none;
  cursor: pointer;
  color: #97A0AC;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: inherit;
}
.tag-search-clear:hover { color: #EF4444; background: #FEF2F2; }

.sub-selected {
  font-size: 10px;
  font-weight: 600;
  color: #5E6AD2;
  text-transform: none;
  letter-spacing: 0;
}

.tag-empty {
  padding: 12px 4px;
  text-align: center;
  font-size: 11.5px;
  color: #97A0AC;
  font-style: italic;
}

/* ── Tag pills ── */
.tag-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 0;
}
.tag-pill-row.scroll {
  max-height: 132px;
  overflow-y: auto;
  align-content: flex-start;
  padding: 4px 2px 4px 0;
}
.tag-pill-row.scroll::-webkit-scrollbar { width: 4px; }
.tag-pill-row.scroll::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 2px; }
.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 999px;
  cursor: pointer;
  color: #1F2D3D;
  font-family: inherit;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-pill:hover { border-color: #D4D6DB; }
.tag-pill.selected { background: #5E6AD2; border-color: #5E6AD2; color: white; }
.tag-pill:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }
.tag-pill .zalo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0068FF;
  flex-shrink: 0;
}
.tag-pill.selected .zalo-dot { background: white; }

/* ── Score slider ── */
.score-wrap { padding: 8px 4px 4px; }
.score-row { display: flex; align-items: center; gap: 8px; }
.score-input {
  width: 44px;
  padding: 3px 5px;
  font-size: 11px;
  text-align: center;
  border: 1px solid #E4E5E9;
  border-radius: 4px;
  font-family: inherit;
  color: #1F2D3D;
}
.score-input:focus { outline: none; border-color: #5E6AD2; }
.score-track {
  flex: 1;
  height: 4px;
  background: #F4F4F7;
  border-radius: 2px;
  position: relative;
}
.score-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, #6366F1, #8B5CF6);
  border-radius: 2px;
}
.score-tiers { display: flex; gap: 4px; margin-top: 8px; }
.score-tier-btn {
  flex: 1;
  padding: 4px;
  font-size: 10.5px;
  font-family: inherit;
  border: 1px solid #E4E5E9;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  color: #6B7785;
  font-weight: 500;
}
.score-tier-btn.active { background: #5E6AD2; border-color: #5E6AD2; color: white; }
.score-tier-btn:hover:not(.active) { border-color: #D4D6DB; }
.score-tier-btn:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }

/* ── Stage chips ── */
.stage-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0 2px; }
.stage-chip {
  padding: 4px 9px;
  font-size: 11px;
  font-weight: 500;
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 999px;
  cursor: pointer;
  color: #1F2D3D;
  font-family: inherit;
}
.stage-chip:hover { border-color: #D4D6DB; }
.stage-chip.hot.selected { background: #FEF2F2; border-color: #EF4444; color: #EF4444; }
.stage-chip.warm.selected { background: #FFFBEB; border-color: #F59E0B; color: #F59E0B; }
.stage-chip.cold.selected { background: #EFF6FF; border-color: #3B82F6; color: #3B82F6; }
.stage-chip.closed.selected { background: #F0FDF4; border-color: #10B981; color: #10B981; }
.stage-chip:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }

/* ── Radio pills ── */
.radio-bar { display: flex; gap: 3px; padding: 4px 0; flex-wrap: wrap; }
.radio-pill {
  padding: 4px 9px;
  font-size: 11px;
  font-family: inherit;
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 999px;
  cursor: pointer;
  color: #6B7785;
  font-weight: 500;
}
.radio-pill.active { background: #5E6AD2; border-color: #5E6AD2; color: white; }
.radio-pill:hover:not(.active) { border-color: #D4D6DB; }
.radio-pill:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }

/* ── Check row ── */
.check-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 4px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12.5px;
}
.check-row:hover { background: #F4F4F7; }
.check-row .left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.check-row .checkbox {
  width: 14px;
  height: 14px;
  border: 1.5px solid #D4D6DB;
  border-radius: 3px;
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
}
.check-row.checked .checkbox { background: #5E6AD2; border-color: #5E6AD2; }
.check-row.checked .checkbox::after {
  content: '✓';
  color: white;
  font-size: 10px;
  font-weight: 700;
}
.check-row .label {
  color: #1F2D3D;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.check-row.checked .label { color: #5E6AD2; font-weight: 600; }
.check-row .count {
  font-size: 10.5px;
  color: #97A0AC;
  flex-shrink: 0;
  padding-left: 6px;
}

/* ── Event row ── */
.event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 6px;
  font-size: 12.5px;
  background: #F4F4F7;
  margin-top: 4px;
  border: 1px solid transparent;
}
.event-row:hover { border-color: #D4D6DB; }
.event-row.checked { background: #EEF0FF; border-color: rgba(94, 106, 210, 0.3); }
.event-row .left { display: flex; align-items: center; gap: 8px; }
.event-row .left .icon { font-size: 14px; }
.event-row .left .lbl { color: #1F2D3D; font-weight: 500; }
.event-row.checked .left .lbl { color: #5E6AD2; font-weight: 600; }
.event-row .right-count {
  font-size: 11px;
  font-weight: 700;
  color: white;
  background: #EF4444;
  padding: 1px 7px;
  border-radius: 999px;
  min-width: 18px;
  text-align: center;
}
.event-row .right-count.amber { background: #F59E0B; }
.event-row .right-count.gray { background: #B0B5BD; }

/* ── Sale row ── */
.sale-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12.5px;
}
.sale-row:hover { background: #F4F4F7; }
.sale-row .circle {
  width: 13px;
  height: 13px;
  border: 1.5px solid #D4D6DB;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}
.sale-row.checked .circle { border-color: #5E6AD2; }
.sale-row.checked .circle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5E6AD2;
}
.sale-row.checked .label { color: #5E6AD2; font-weight: 600; }

/* ── Footer ── */
.sb-footer {
  flex-shrink: 0;
  border-top: 1px solid #E4E5E9;
  background: #FFFFFF;
  padding: 10px 12px;
}
.footer-card {
  background: linear-gradient(135deg, #F8F8FB 0%, #EEF0FF 100%);
  border: 1px solid rgba(94, 106, 210, 0.18);
  border-radius: 8px;
  padding: 9px 10px;
}
.footer-title {
  font-size: 11px;
  font-weight: 600;
  color: #6B7785;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.footer-title .badge {
  background: #5E6AD2;
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  min-width: 18px;
  text-align: center;
}
.footer-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 6px; }
.f-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px 2px 7px;
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  color: #1F2D3D;
  font-family: inherit;
}
.f-chip:hover { border-color: #5E6AD2; color: #5E6AD2; }
.f-chip .x { font-size: 9px; color: #97A0AC; }
.f-chip:hover .x { color: #5E6AD2; }
.f-chip:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }
.clear-all {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  padding: 4px;
  background: transparent;
  border: none;
  color: #5E6AD2;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  border-radius: 4px;
}
.clear-all:hover { background: #5E6AD2; color: white; }
</style>
