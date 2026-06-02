<template>
  <div class="mtd-page">
    <div v-if="!data" class="mtd-loading">Đang tải...</div>
    <template v-else>
      <!-- ============ HEADER ============ -->
      <div class="crumb">
        <a href="#" @click.prevent="router.push('/automation/muc-tieu')">Marketing</a>
        <span class="sep">/</span>
        <a href="#" @click.prevent="router.push('/automation/muc-tieu')">Mục tiêu</a>
        <span class="sep">/</span>
        <span class="current">{{ data.trigger.name }}</span>
      </div>

      <a href="#" class="back-link" @click.prevent="router.push('/automation/muc-tieu')">← Mục tiêu</a>

      <div class="topbar">
        <div class="left">
          <h1>
            {{ data.trigger.name }}
            <span class="status" :class="`s-${data.trigger.state}`">
              {{ stateLabel(data.trigger.state) }}
            </span>
          </h1>
          <p class="sub">
            Tạo <strong>{{ formatDate(data.trigger.createdAt) }}</strong>
            bởi <strong>{{ creatorName }}</strong>
            <template v-if="data.trigger.successorSequence">
              · Chuỗi: <strong>{{ data.trigger.successorSequence.name }}</strong>
              ({{ data.trigger.successorSequence.stepsCount }} bước)
            </template>
          </p>
        </div>
        <div class="actions">
          <!-- M13 2026-06-02 — State-machine buttons. BE state enum:
               draft | active | paused | cancelling | cancelled | completed.
               (UI gộp cancelled/completed → 'stopped' nhóm hiển thị.) -->
          <template v-if="data.trigger.state === 'active'">
            <!-- 2026-06-03 Anh chốt re-label:
                 - "Dừng vĩnh viễn" (paused indefinite) → "⏯️ Tạm dừng" (nhẹ, reversible)
                 - "Dừng hẳn" (cancel terminal) → "🛑 Kết thúc"
                 - "Tạm dừng 24h" giữ nguyên text khi active. State paused 24h sẽ hiện
                   "⏸ Đang dừng (countdown)" và hover→ "▶️ Tiếp tục" (xem branch paused). -->
            <button class="btn" @click="pause24h">⏸ Tạm dừng 24h</button>
            <button class="btn" @click="pauseForever">⏯️ Tạm dừng</button>
            <button class="btn btn-danger" @click="onCancel">🛑 Kết thúc</button>
          </template>
          <template v-else-if="data.trigger.state === 'paused'">
            <!-- 2026-06-03 — Pause card mới: text mặc định "Đang dừng (Xh Ym)" với countdown
                 nếu paused_until set; hover → "▶️ Tiếp tục". Pause vô hạn (không TTL) thì
                 text mặc định "⏸ Đang dừng" (không countdown), hover same. -->
            <button class="btn btn-pause-hover" @click="resume" :title="pauseTooltip">
              <span class="pause-label-default">{{ pauseLabel }}</span>
              <span class="pause-label-hover">▶️ Tiếp tục</span>
            </button>
            <button class="btn btn-danger" @click="onCancel">🛑 Kết thúc</button>
          </template>
          <template v-else-if="data.trigger.state === 'draft'">
            <button class="btn btn-primary" @click="onActivate">▶ Kích hoạt</button>
            <button class="btn btn-danger" @click="onCancel">🗑 Xoá</button>
          </template>
          <template v-else-if="data.trigger.state === 'cancelling'">
            <button class="btn" disabled>⏳ Đang huỷ…</button>
          </template>
          <template v-else>
            <!-- cancelled | completed → chỉ xem lịch sử + sao chép -->
            <button class="btn" @click="setTab('log')">📊 Xem lịch sử</button>
          </template>
          <button class="btn" @click="onEdit">✏ Sửa</button>
          <div class="menu-wrap" ref="menuWrapRef">
            <button class="btn btn-icon" title="Tác vụ khác" @click.stop="menuOpen = !menuOpen">⋯</button>
            <div v-show="menuOpen" class="menu">
              <div class="menu-item" @click="onDuplicate">📋 Sao chép</div>
              <div class="menu-item" @click="exportExcel">📤 Xuất Excel</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ TAB NAV ============ -->
      <div class="tabs" role="tablist">
        <button
          class="tab"
          :class="{ active: currentTab === 'dashboard' }"
          role="tab"
          @click="setTab('dashboard')"
        >
          📊 Dashboard
        </button>
        <button
          class="tab"
          :class="{ active: currentTab === 'log' }"
          role="tab"
          @click="setTab('log')"
        >
          📋 Log sự kiện
        </button>
      </div>

      <!-- =========================================================== -->
      <!-- ============ TAB 1: DASHBOARD ============================ -->
      <!-- =========================================================== -->
      <div v-show="currentTab === 'dashboard'" class="tab-panel">
        <!-- ============ MONITOR LIVE FEED ============ -->
        <div class="monitor">
          <div class="monitor-head">
            <h3>
              📺 Monitor sự kiện trực tiếp
              <span class="head-hint-inline">(20 mới nhất)</span>
            </h3>
            <div class="monitor-head-actions">
              <span class="live-chip" :class="{ paused: monitorPaused }">
                <span class="live-dot"></span>
                {{ monitorPaused ? '⏸ TẠM DỪNG' : '🟢 LIVE' }}
              </span>
              <button class="btn btn-sm" @click="toggleMonitor">
                {{ monitorPaused ? '▶ Tiếp tục' : '⏸ Tạm dừng' }}
              </button>
            </div>
          </div>
          <div ref="monitorBodyRef" class="monitor-body" @scroll="onMonitorScroll">
            <div
              v-for="ev in monitorEvents"
              :key="ev.id"
              class="mon-row"
              :class="[ev.tone ? `t-${ev.tone}` : '', { 'is-new': ev.isNew }]"
            >
              <span class="mon-icon">{{ ev.icon }}</span>
              <span class="mon-time">{{ ev.timeLabel }}</span>
              <span class="mon-text">
                <!-- Fix #3b (2026-06-02) — Anh yêu cầu show rõ KH nào + nick nào làm gì -->
                <strong v-if="ev.rowIndex != null" class="mon-row-idx">#{{ ev.rowIndex }}</strong>
                {{ ev.text }}
                <span v-if="ev.customerName || ev.nickName" class="mon-meta">
                  — {{ ev.customerName || 'KH' }}
                  <span v-if="ev.nickName" class="mon-nick">↔ nick {{ ev.nickName }}</span>
                </span>
              </span>
            </div>
            <div v-if="monitorEvents.length === 0" class="mon-empty">
              Chưa có sự kiện nào — feed sẽ xuất hiện ở đây khi worker chạy.
            </div>
          </div>
        </div>

        <!-- ============ NICK HEALTH BANNER (Task B Nick offline 2026-05-30) ============ -->
        <!-- allOffline=danger (đỏ): Mục tiêu không chạy. >50% offline=warn (vàng).  -->
        <div
          v-if="nickHealthBanner && nickHealthBanner.show"
          class="nick-health-banner"
          :class="`level-${nickHealthBanner.level}`"
          role="alert"
        >
          <span class="nhb-icon">
            {{ nickHealthBanner.level === 'danger' ? '🔴' : '🟡' }}
          </span>
          <div class="nhb-msg">
            <strong>{{ nickHealthBanner.text }}</strong>
          </div>
          <a href="#" class="nhb-link" @click.prevent="router.push('/settings/channels/zalo')">
            Mở Zalo Accounts →
          </a>
        </div>

        <!-- ============ ETA BAR ============ -->
        <div class="eta-bar">
          <span class="eta-icon">⏱</span>
          <span>
            Còn <strong>{{ formatNum(etaInfo.remaining) }} KH</strong>
            ~ <strong>{{ etaInfo.daysText }}</strong>
          </span>
          <span class="eta-sep">·</span>
          <span>
            Dự kiến xong <strong>{{ etaInfo.finishLabel }}</strong>
          </span>
        </div>

        <!-- ============ M13: QUY TẮC GỬI AN TOÀN (read-only) ============ -->
        <!-- 7 tile từ trigger.safetyRules. concurrencyPerNickPerMinute ẩn (wizard B3 không expose). -->
        <!-- Fallback: nếu BE chưa rebuild (safetyRules undefined) → empty-state "Chưa cấu hình". -->
        <section class="safety-card" aria-label="Quy tắc gửi an toàn">
          <header class="safety-head">
            <h3>🛡 Quy tắc gửi an toàn</h3>
            <button class="btn btn-sm" @click="onEdit">✏ Sửa</button>
          </header>
          <div v-if="data.trigger.safetyRules" class="safety-grid">
            <div class="safety-tile">
              <div class="st-icon">⏰</div>
              <div class="st-body">
                <div class="st-label">Giờ làm việc</div>
                <div class="st-value">
                  {{ pad2(data.trigger.safetyRules.sendHourStart) }}:00 –
                  {{ pad2(data.trigger.safetyRules.sendHourEnd) }}:00
                </div>
                <div class="st-hint">Chỉ gửi trong khoảng giờ VN này</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon">⏱</div>
              <div class="st-body">
                <div class="st-label">Khoảng cách gửi</div>
                <div class="st-value">
                  {{ Math.round(data.trigger.safetyRules.minFriendReqGapMs / 1000) }} giây
                </div>
                <div class="st-hint">Tối thiểu giữa 2 lời mời / nick</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon">📅</div>
              <div class="st-body">
                <div class="st-label">Lọc recency</div>
                <div class="st-value">
                  {{ data.trigger.safetyRules.recencySkipDays === 0
                      ? 'Tắt'
                      : `${data.trigger.safetyRules.recencySkipDays} ngày` }}
                </div>
                <div class="st-hint">Bỏ KH vừa tương tác nick khác</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon">👥</div>
              <div class="st-body">
                <div class="st-label">Multi-nick threshold</div>
                <div class="st-value">
                  {{ data.trigger.safetyRules.multiNickThreshold === 0
                      ? 'Tắt'
                      : `> ${data.trigger.safetyRules.multiNickThreshold} nick` }}
                </div>
                <div class="st-hint">Bỏ KH đã friend quá nhiều nick</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon">🤝</div>
              <div class="st-body">
                <div class="st-label">Delay sau friend-request</div>
                <div class="st-value">
                  {{ data.trigger.safetyRules.sequenceStartDelayMinutes }} phút
                </div>
                <div class="st-hint">Chờ trước khi bắt đầu chuỗi</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon">⏸</div>
              <div class="st-body">
                <div class="st-label">Pause khi KH reply</div>
                <div class="st-value">
                  {{ data.trigger.safetyRules.pauseOnActivityHours }} giờ
                </div>
                <div class="st-hint">Reset chuỗi khi KH có tương tác</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon">⚡</div>
              <div class="st-body">
                <div class="st-label">Concurrency</div>
                <div class="st-value">
                  {{ data.trigger.safetyRules.concurrencyPerNickPerMinute }} / phút / nick
                </div>
                <div class="st-hint">Trần xử lý song song mỗi nick</div>
              </div>
            </div>
          </div>
          <div v-else class="safety-empty">
            <span>Chưa cấu hình quy tắc gửi an toàn.</span>
            <a href="#" @click.prevent="onEdit">Mở wizard để thiết lập →</a>
          </div>
        </section>

        <!-- ============ 4 BIG STAT CARDS ============ -->
        <div class="stats-row">
          <div class="stat-card accent-blue">
            <div class="stat-label">Trong tệp</div>
            <div class="stat-value">{{ formatNum(stats.total) }}</div>
            <div class="stat-hint">Tổng KH gốc nhập từ tệp</div>
          </div>
          <div class="stat-card accent-green">
            <div class="stat-label">Đã xử lý</div>
            <div class="stat-value">{{ formatNum(stats.processed) }}</div>
            <div class="stat-hint">
              {{ pct(stats.processed, stats.total) }}% — đã qua bước kiểm Zalo
            </div>
          </div>
          <div class="stat-card accent-purple">
            <div class="stat-label">Có Zalo</div>
            <div class="stat-value">{{ formatNum(stats.hasZalo) }}</div>
            <div class="stat-hint">
              {{ pct(stats.hasZalo, stats.processed) }}% trong số đã xử lý — vào Phase 1
            </div>
          </div>
          <div class="stat-card accent-red">
            <div class="stat-label">Không có Zalo</div>
            <div class="stat-value">{{ formatNum(stats.noZalo) }}</div>
            <div class="stat-hint">Chuyển Lead Pool — gọi điện trực tiếp</div>
          </div>
        </div>

        <!-- ============ CTA RED BANNER ============ -->
        <div v-if="stats.noZalo > 0" class="cta-red">
          <span class="cta-bullet">🔴</span>
          <div class="cta-msg">
            <strong>Không có Zalo ({{ formatNum(stats.noZalo) }} KH)</strong>
            — gợi ý gọi điện qua Lead Pool, đừng để rơi rớt
          </div>
          <a href="#" class="cta-link" @click.prevent="goLeadPool">Xem danh sách →</a>
        </div>

        <!-- ============ 2-COL PHASE ============ -->
        <div class="phase-row">
          <div class="phase-card">
            <h3>📤 Phase 1: Mời kết bạn</h3>
            <div class="mini-grid">
              <div class="mini-card blue">
                <div class="mini-value">{{ formatNum(phase1.sent) }}</div>
                <div class="mini-label">Đã gửi</div>
              </div>
              <div class="mini-card green">
                <div class="mini-value">{{ formatNum(phase1.accepted) }}</div>
                <div class="mini-label">Đồng ý</div>
              </div>
              <div class="mini-card red">
                <div class="mini-value">{{ formatNum(phase1.rejected) }}</div>
                <div class="mini-label">Từ chối</div>
              </div>
              <div class="mini-card orange">
                <div class="mini-value">{{ formatNum(phase1.pending) }}</div>
                <div class="mini-label">Đang chờ</div>
              </div>
            </div>
          </div>

          <div class="phase-card">
            <h3>
              📨 Phase 2: Bám đuổi
              <span class="phase-hint">(stranger inbox — gửi luôn không chờ accept)</span>
            </h3>
            <div class="mini-grid">
              <div class="mini-card blue">
                <div class="mini-value">{{ formatNum(phase2.welcome) }}</div>
                <div class="mini-label">Welcome</div>
              </div>
              <div class="mini-card green">
                <div class="mini-value">{{ formatNum(phase2.running) }}</div>
                <div class="mini-label">Đang chạy</div>
              </div>
              <div class="mini-card">
                <div class="mini-value">{{ formatNum(phase2.done) }}</div>
                <div class="mini-label">Hoàn tất</div>
              </div>
              <div class="mini-card red">
                <div class="mini-value">{{ formatNum(phase2.stopped) }}</div>
                <div class="mini-label">Dừng</div>
              </div>
            </div>
            <div class="phase-sub">
              <span class="sub-pill">🛑 <strong>{{ formatNum(phase2.reply) }}</strong> KH reply</span>
              <span class="sub-pill">🚫 <strong>{{ formatNum(phase2.block) }}</strong> KH block</span>
              <span class="sub-pill">💎 <strong>{{ formatNum(phase2.lead) }}</strong> KH đã thành Lead</span>
            </div>
          </div>
        </div>

        <!-- ============ NICK PERFORMANCE TABLE ============ -->
        <div class="section">
          <div class="section-head">
            <h3>🎯 Hiệu quả theo nick</h3>
            <div class="head-hint">
              {{ data.nicks.length }} nick đang chạy · sort theo % Accept
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 28%;">Nick</th>
                <th class="num">Gửi <span class="sort-arrow">↕</span></th>
                <th class="num">Đồng ý <span class="sort-arrow">↕</span></th>
                <th class="sorted">
                  % Accept <span class="sort-arrow">↓</span>
                </th>
                <th>Quota hôm nay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(n, i) in nicksByAccept" :key="n.nickId">
                <td>
                  <div class="nick-cell">
                    <div class="avatar" :class="avatarClass(i)">
                      {{ nickInitial(n.displayName, n.nickId) }}
                    </div>
                    <div class="nick-name">{{ n.displayName ?? n.nickId.slice(0, 8) }}</div>
                  </div>
                </td>
                <td class="num">{{ formatNum(n.sentTotal) }}</td>
                <td class="num">{{ formatNum(n.acceptedTotal ?? 0) }}</td>
                <td>
                  <span
                    class="pct"
                    :class="n.acceptPct >= 10 ? 'hi' : n.acceptPct < 5 ? 'lo' : ''"
                  >
                    {{ n.acceptPct.toFixed(1) }}%
                  </span>
                  <span v-if="i === 0 && nicksByAccept.length > 1" class="medal">🥇</span>
                  <span v-else-if="i === nicksByAccept.length - 1 && nicksByAccept.length > 2" class="medal">🥉</span>
                </td>
                <td>
                  <div class="quota-cell">
                    <div class="quota-bar">
                      <div
                        class="quota-fill"
                        :style="{ width: capPct(n.sentToday, n.dailyFriendAddCap) + '%' }"
                      ></div>
                    </div>
                    <span class="num muted">
                      {{ n.sentToday }}/{{ n.dailyFriendAddCap }} ·
                      {{ capPct(n.sentToday, n.dailyFriendAddCap) }}%
                    </span>
                  </div>
                </td>
                <td>
                  <!-- Task B Nick offline 2026-05-30 — badge màu + "Offline X phút trước" -->
                  <span
                    class="nick-status-badge"
                    :class="n.status === 'connected' ? 'nsb-online' : 'nsb-offline'"
                  >
                    <span
                      :class="n.status === 'connected' ? 'dot-online' : 'dot-offline'"
                    ></span>
                    <span class="nick-status-txt">
                      {{ n.status === 'connected' ? 'Online' : 'Offline' }}
                    </span>
                  </span>
                  <span
                    v-if="n.status !== 'connected' && n.lastSeenAt"
                    class="nick-last-seen"
                    :title="`Lần online cuối: ${formatInOrgTz(n.lastSeenAt)}`"
                  >
                    · offline {{ relativeTime(n.lastSeenAt) }}
                  </span>
                </td>
              </tr>
              <tr v-if="!data.nicks.length">
                <td colspan="6" class="empty-row">Chưa có nick nào gắn vào Mục tiêu</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ============ ENTRIES SECTION ============ -->
        <div class="section">
          <div class="section-head">
            <h3>
              👥 Khách hàng
              <span class="head-hint">
                ({{ formatNum(stats.hasZalo) }} đang chạy + {{ formatNum(stats.noZalo) }} không Zalo)
              </span>
            </h3>
            <div class="head-actions">
              <button class="btn btn-sm" @click="exportEntries">📤 Xuất Excel</button>
              <button class="btn btn-sm" disabled title="Defer Wave 4">⚙ Cột hiển thị</button>
            </div>
          </div>

          <!-- filter bar -->
          <div class="filter-bar">
            <div class="search-wrap">
              <span class="search-icon">🔍</span>
              <input
                v-model="searchInput"
                class="search-input"
                placeholder="Tìm SĐT / tên KH..."
              />
            </div>
            <div class="chips">
              <span
                v-for="chip in entryChips"
                :key="chip.key"
                class="chip"
                :class="{ active: entryFilter === chip.key, 'has-tooltip': !!chip.tooltip }"
                :data-tooltip="chip.tooltip || null"
                @click="setEntryFilter(chip.key)"
              >
                {{ chip.label }} <span class="count">{{ formatNum(chip.count) }}</span>
              </span>
            </div>
          </div>

          <table class="entries-table">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th class="col-kh">KH <span class="sort-arrow">↕</span></th>
                <th class="col-phone">SĐT</th>
                <th class="col-nickpin">Nick PIN</th>
                <th class="col-step">Bước hiện tại</th>
                <th class="col-status">Trạng thái</th>
                <th class="col-update sorted">
                  Lần gửi gần nhất <span class="sort-arrow">↓</span>
                </th>
                <th class="col-next">Lần gửi tiếp theo</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(e, i) in filteredEntries"
                :key="e.id"
                class="entry-row"
                :style="{ cursor: 'pointer' }"
                :title="stepTooltip(e)"
                @click="openChat(e)"
              >
                <td class="col-num">{{ e.rowIndex ?? i + 1 }}</td>
                <td>
                  <div class="kh-cell">
                    <!-- Avatar Zalo (Phase Friend Invite UI 2026-05-30): ưu tiên
                         Contact.avatarUrl đồng bộ từ Zalo SDK; @error → ẩn img
                         và để initials sibling đảm nhận (luôn render khi có avatarUrl). -->
                    <template v-if="e.avatarUrl">
                      <img
                        :src="e.avatarUrl"
                        :alt="e.displayName ?? e.phone"
                        class="contact-avatar"
                        loading="lazy"
                        @error="onAvatarError($event)"
                      />
                      <div
                        class="avatar contact-avatar-fallback"
                        :class="avatarClass((e.rowIndex ?? i) - 1)"
                        style="display:none"
                      >
                        {{ initialsFromName(e.displayName ?? e.phone) }}
                      </div>
                    </template>
                    <div
                      v-else
                      class="avatar"
                      :class="avatarClass((e.rowIndex ?? i) - 1)"
                    >
                      {{ initialsFromName(e.displayName ?? e.phone) }}
                    </div>
                    <div>
                      <div class="kh-name">{{ e.displayName ?? '(chưa có tên Zalo)' }}</div>
                      <div class="kh-sub">
                        {{ e.dedup === 'merged' ? '🔗 Gộp KH cũ' : '✨ KH mới' }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="col-phone">{{ e.phone }}</td>
                <td>
                  <div v-if="e.nickName || e.nickId" class="nick-cell">
                    <div class="avatar avatar-sm" :class="avatarClass(nickIndex(e.nickId))">
                      {{ nickInitial(e.nickName, e.nickId ?? '?') }}
                    </div>
                    <span class="nick-pin-name">{{ e.nickName ?? e.nickId?.slice(0, 6) }}</span>
                  </div>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <div class="step-bar">
                    <span class="step-dots">
                      <span
                        v-for="(d, k) in stepDots(e)"
                        :key="k"
                        class="step-dot"
                        :class="d"
                      ></span>
                    </span>
                    <span class="step-label">{{ stepText(e) }}</span>
                  </div>
                </td>
                <td>
                  <!-- Phase Friend Invite UI 2026-05-30 — ưu tiên derivedStatus (5 enum)
                       BE shape; fallback queueStatus cho payload cũ chưa có derivedStatus. -->
                  <span class="estatus" :class="entryStatusClass(e)">
                    {{ entryStatusLabel(e) }}
                  </span>
                </td>
                <td class="col-update">{{ relativeTime(e.lastSentAt ?? e.updatedAt) }}</td>
                <td class="col-next">
                  <span
                    v-if="nextRunInfo(e).isDue"
                    class="estatus reply"
                    title="Tới giờ chạy nhưng đang chờ pickup"
                  >
                    Đến hạn
                  </span>
                  <span v-else :class="nextRunInfo(e).muted ? 'muted' : ''">
                    {{ nextRunInfo(e).label }}
                  </span>
                </td>
              </tr>
              <tr v-if="!filteredEntries.length">
                <td colspan="8" class="empty-row">
                  Chưa có khách nào khớp bộ lọc
                </td>
              </tr>
            </tbody>
          </table>

          <div class="pagination">
            <div>
              Hiển thị
              <strong>{{ data.entriesOffset + 1 }}-{{ Math.min(data.entriesOffset + data.entries.length, data.entriesTotal) }}</strong>
              trong <strong>{{ formatNum(data.entriesTotal) }}</strong> KH
            </div>
            <div class="page-nav">
              <button class="page-btn" :disabled="data.entriesOffset === 0" @click="prevPage">‹</button>
              <button class="page-btn active">{{ currentPage }}</button>
              <button class="page-btn" :disabled="!hasNextPage" @click="nextPage">›</button>
            </div>
          </div>
        </div>
      </div>

      <!-- =========================================================== -->
      <!-- ============ TAB 2: LOG SỰ KIỆN =========================== -->
      <!-- =========================================================== -->
      <div v-show="currentTab === 'log'" class="tab-panel">
        <div class="section section-mt">
          <div class="log-head">
            <h3>
              📋 Log sự kiện đầy đủ
              <span class="head-hint-inline">(lưu 90 ngày)</span>
            </h3>
            <button class="btn btn-sm" @click="exportCsv">📥 Xuất CSV</button>
          </div>

          <div class="log-toolbar">
            <div class="chips log-type-chips">
              <span
                v-for="chip in logTypeChips"
                :key="chip.key"
                class="chip"
                :class="{ active: logFilter.type === chip.key }"
                @click="logFilter.type = chip.key"
              >
                {{ chip.label }} <span class="count">{{ formatNum(chip.count) }}</span>
              </span>
            </div>

            <span class="date-range">
              Từ
              <input v-model="logFilter.from" type="date" />
              đến
              <input v-model="logFilter.to" type="date" />
            </span>

            <input
              v-model="logFilter.q"
              type="text"
              placeholder="🔍 Tìm theo tên khách hoặc số ĐT..."
            />
          </div>

          <table class="log-table">
            <thead>
              <tr>
                <th class="col-time">Thời gian <span class="sort-arrow">↓</span></th>
                <th class="col-type">Loại</th>
                <th class="col-nick">Nick</th>
                <th class="col-kh">Khách hàng</th>
                <th class="col-row">Row #</th>
                <th class="col-target">Mục tiêu</th>
                <th class="col-status">Trạng thái</th>
                <th class="col-detail">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ev in logEvents" :key="ev.id">
                <td class="col-time">{{ formatLogTime(ev.at) }}</td>
                <td>
                  <span class="type-pill" :class="typePillClass(ev.type)">
                    {{ typePillLabel(ev.type) }}
                  </span>
                </td>
                <td>{{ ev.nickName ?? '—' }}</td>
                <td>{{ ev.customerName ?? '—' }}</td>
                <td>{{ ev.rowIndex ? `#${ev.rowIndex}` : '—' }}</td>
                <td>{{ data.trigger.name }}</td>
                <td>
                  <span class="estatus" :class="logStatusClass(ev)">
                    {{ logStatusLabel(ev) }}
                  </span>
                </td>
                <td class="col-detail">{{ ev.detail ?? '—' }}</td>
              </tr>
              <tr v-if="logEvents.length === 0 && !logLoading">
                <td colspan="8" class="empty-row">
                  Chưa có sự kiện nào trong khoảng lọc
                </td>
              </tr>
              <tr v-if="logLoading">
                <td colspan="8" class="empty-row">Đang tải sự kiện...</td>
              </tr>
            </tbody>
          </table>

          <div class="pagination">
            <div>
              Hiển thị
              <strong>{{ logEvents.length === 0 ? 0 : (logPage - 1) * LOG_PAGE_SIZE + 1 }}-{{ Math.min(logPage * LOG_PAGE_SIZE, logTotal) }}</strong>
              trong <strong>{{ formatNum(logTotal) }}</strong> sự kiện
            </div>
            <div class="page-nav">
              <button class="page-btn" :disabled="logPage === 1" @click="logPage--; loadLog()">‹</button>
              <button class="page-btn active">{{ logPage }}</button>
              <button
                class="page-btn"
                :disabled="logPage * LOG_PAGE_SIZE >= logTotal"
                @click="logPage++; loadLog()"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ STICKY BOTTOM HINT ============ -->
      <div class="sticky-hint">
        <div class="sticky-hint-inner">
          <span class="hint-emoji">💡</span>
          <div>
            Sale có thể đổi giai đoạn KH bất kỳ lúc nào để
            <strong>tự động dừng</strong> Mục tiêu cho KH đó.
            <span class="muted-inline">(Bulk action ship Wave 4)</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import { formatInOrgTz } from '@/composables/use-org-timezone';

const route = useRoute();
const router = useRouter();
const triggerId = route.params.id as string;

// ===================================================================
// ============ TYPES ================================================
// ===================================================================

interface NickStat {
  nickId: string;
  displayName: string | null;
  status: string;
  dailyFriendAddCap: number;
  sentToday: number;
  sentTotal: number;
  acceptedTotal?: number | null;
  workerRunning: boolean;
  workerBusy: boolean;
  // Task B Nick offline 2026-05-30 — ISO timestamp lần nick còn online gần nhất.
  lastSeenAt?: string | null;
}

// Task B Nick offline 2026-05-30 — health rollup từ BE để render banner cảnh báo.
interface NickHealth {
  totalNicks: number;
  onlineCount: number;
  offlineCount: number;
  allOffline: boolean;
}

// Phase Friend Invite UI 2026-05-30 — BE thêm 5 field cho timeline + avatar
// (lastSentAt, nextRunAt, sequenceTotalSteps, avatarUrl, derivedStatus).
// derivedStatus là enum chuẩn hoá từ helper deriveKHFinalState — FE render trực tiếp.
type DerivedKHStatus =
  | 'pending_friend'
  | 'phase1_done'
  | 'in_sequence'
  | 'sequence_done'
  | 'stopped';

interface Entry {
  id: string;
  rowIndex: number;
  displayName: string | null;
  phone: string;
  nickId: string | null;
  nickName: string | null;
  queueStatus: string | null;
  hasZalo: boolean | null;
  dedup: 'merged' | 'new';
  currentStepIdx: number | null;
  taskStatus: string | null;
  updatedAt?: string | null;
  // Phase Friend Invite UI 2026-05-30 — ISO timestamps + derived enum + avatar URL
  lastSentAt?: string | null;
  nextRunAt?: string | null;
  sequenceTotalSteps?: number | null;
  avatarUrl?: string | null;
  derivedStatus?: DerivedKHStatus | null;
  // P0-3 2026-05-30 — BE deterministic Bước hiện tại + nick gần nhất đã invite.
  contactId?: string | null;
  progressLabel?: string | null;
  lastInviteNickId?: string | null;
}

// M13 2026-06-02 — 8 safety-rule columns BE return từ GET /:id/dashboard.
// Card "Quy tắc gửi an toàn" read-only hiển thị 7 trong 8 (concurrency ẩn vì
// wizard B3 không expose). Defer Wave 4: nút "Sửa" mở wizard edit.
interface SafetyRules {
  sendHourStart: number;             // 0-23 (giờ làm việc bắt đầu, VN)
  sendHourEnd: number;               // 0-23 (giờ làm việc kết thúc)
  sequenceStartDelayMinutes: number; // delay sau friend-request → step 1
  pauseOnActivityHours: number;      // pause khi KH reply (giờ)
  multiNickThreshold: number;        // 0 = không filter
  concurrencyPerNickPerMinute: number;
  recencySkipDays: number;           // 0 = không filter
  minFriendReqGapMs: number;         // ms giữa 2 friend-request per nick
}

interface DashboardData {
  trigger: {
    id: string;
    name: string;
    state: string;
    greetingTemplate: string;
    welcomeMessageTemplate: string | null;
    successorSequence: { id: string; name: string; stepsCount: number } | null;
    createdAt: string;
    createdBy?: { id: string; fullName: string } | null;
    // M13 — optional cho backward compat (deploy lệch BE chưa rebuild).
    safetyRules?: SafetyRules | null;
    // 2026-06-03 — pausedUntil ISO khi pause TTL set (vd /pause body {ttlHours:24}).
    // null khi pause vô hạn. FE dùng để render countdown "Đang dừng (Xh Ym)".
    pausedUntil?: string | null;
  };
  counters: Record<string, number>;
  nicks: NickStat[];
  // Task B Nick offline 2026-05-30 — optional cho backward compat trước khi BE rebuild.
  nickHealth?: NickHealth | null;
  entries: Entry[];
  entriesTotal: number;
  entriesOffset: number;
  entriesLimit: number;
}

interface LiveEvent {
  id: string;
  at: string;        // ISO
  timeLabel: string; // HH:mm:ss
  type: string;
  icon: string;
  text: string;
  tone?: 'stop' | 'block' | 'lead' | 'warn' | null;
  isNew?: boolean;
  // Fix #3b (2026-06-02) — BE đã trả 3 field này nhưng FE quên render.
  nickName?: string | null;
  customerName?: string | null;
  rowIndex?: number | null;
}

interface LogEvent {
  id: string;
  at: string;
  type: string;
  nickName: string | null;
  customerName: string | null;
  rowIndex: number | null;
  status: string | null;
  detail: string | null;
}

// ===================================================================
// ============ STATE ================================================
// ===================================================================

const data = ref<DashboardData | null>(null);
const searchInput = ref('');
const entryFilter = ref<EntryFilterKey>('all');
const page = ref(1);
let dashboardTimer: ReturnType<typeof setInterval> | null = null;

// Tab + URL hash sync
type TabKey = 'dashboard' | 'log';
const currentTab = ref<TabKey>('dashboard');

// Monitor state
const monitorEvents = ref<LiveEvent[]>([]);
const monitorPaused = ref(false);
const monitorBodyRef = ref<HTMLDivElement | null>(null);
const userScrolledAway = ref(false);
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let monitorPollPending = false;
let lastMonitorSince: string | null = null;

// Menu
const menuOpen = ref(false);
const menuWrapRef = ref<HTMLDivElement | null>(null);

// Log tab
const LOG_PAGE_SIZE = 50;
const logEvents = ref<LogEvent[]>([]);
const logTotal = ref(0);
const logPage = ref(1);
const logLoading = ref(false);
const logFilter = ref<{ type: string; from: string; to: string; q: string }>({
  type: 'all',
  from: todayIso(),
  to: todayIso(),
  q: '',
});

type EntryFilterKey =
  | 'all'
  | 'running'
  | 'done'
  | 'reply'
  | 'block'
  | 'lead'
  | 'cho-crm'
  | 'no-zalo';

// ===================================================================
// ============ DERIVED ==============================================
// ===================================================================

const creatorName = computed(() => data.value?.trigger.createdBy?.fullName ?? '—');

// 2026-06-03 Anh chốt — nút Pause khi state=paused:
// - Có pausedUntil tương lai → "⏸ Đang dừng (Xh Ym)" countdown
// - Không pausedUntil hoặc đã quá → "⏸ Đang dừng" (vô hạn)
// - Hover button: hiển thị "▶️ Tiếp tục" (xử lý qua CSS hover swap, không tick lại)
function fmtCountdown(targetIso: string): string {
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return '';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
const pauseLabel = computed(() => {
  const until = data.value?.trigger.pausedUntil;
  if (until) {
    const cd = fmtCountdown(until);
    if (cd) return `⏸ Đang dừng (${cd})`;
  }
  return '⏸ Đang dừng';
});
const pauseTooltip = computed(() => {
  const until = data.value?.trigger.pausedUntil;
  if (until) return `Tự động chạy lại sau ${fmtCountdown(until) || 'ít phút'}. Bấm để tiếp tục ngay.`;
  return 'Bấm để tiếp tục.';
});

const stats = computed(() => {
  const c = data.value?.counters ?? {};
  const total = c.total ?? 0;
  const noZalo = c.skipped_no_zalo ?? 0;
  const hasZalo = Math.max(0, total - noZalo);
  // "Đã xử lý" = đã qua kiểm Zalo (mọi entry có hasZalo true/false đều coi là processed)
  const processed =
    (c.processed ?? 0) +
    noZalo +
    (c.skipped_friend_cap ?? 0) +
    (c.skipped_recency ?? 0) +
    (c.failed_permanent ?? 0) +
    (c.failed_stuck ?? 0);
  return {
    total,
    processed: Math.min(processed, total),
    hasZalo,
    noZalo,
  };
});

const phase1 = computed(() => {
  const c = data.value?.counters ?? {};
  const sent = c.sent ?? 0;
  const accepted = c.accepted ?? 0;
  const rejected = c.rejected ?? 0;
  const pending = Math.max(0, sent - accepted - rejected);
  return { sent, accepted, rejected, pending };
});

const phase2 = computed(() => {
  const c = data.value?.counters ?? {};
  const welcome = c.welcome_sent ?? c.welcome ?? 0;
  const running = c.in_sequence ?? c.processing ?? 0;
  const done = c.sequence_completed ?? c.completed ?? 0;
  const reply = c.customer_reply ?? c.replied ?? 0;
  const block = c.customer_block ?? c.blocked ?? 0;
  const lead = c.converted_lead ?? 0;
  const stopped = reply + block + lead;
  return { welcome, running, done, stopped, reply, block, lead };
});

const etaInfo = computed(() => {
  const c = data.value?.counters ?? {};
  const total = stats.value.total;
  const processed = stats.value.processed;
  const remaining = Math.max(0, total - processed);
  // BE may expose etaSeconds / etaDays — fall back to crude estimate
  const etaDays = c.eta_days ?? estimateDays(remaining, data.value?.nicks ?? []);
  const finish = new Date(Date.now() + etaDays * 86400000);
  return {
    remaining,
    daysText: etaDays >= 1 ? `${etaDays.toFixed(1)} ngày` : `${Math.round(etaDays * 24)} giờ`,
    finishLabel: formatInOrgTz(finish.toISOString()),
  };
});

const nicksByAccept = computed(() => {
  const list = (data.value?.nicks ?? []).map((n) => {
    const accepted = n.acceptedTotal ?? 0;
    const acceptPct = n.sentTotal ? (accepted / n.sentTotal) * 100 : 0;
    return { ...n, acceptPct };
  });
  return [...list].sort((a, b) => b.acceptPct - a.acceptPct);
});

// Task B Nick offline 2026-05-30 — banner sức khoẻ nick.
// - allOffline=true  → banner ĐỎ "Tất cả nick offline" (Mục tiêu không chạy được).
// - offline >50%    → banner VÀNG cảnh báo (vẫn chạy nhưng throughput thấp).
// - Còn lại         → ẩn banner.
// Fallback: nếu BE chưa trả nickHealth (deploy lệch), tự derive từ data.nicks.
const nickHealthBanner = computed<{
  show: boolean;
  level: 'danger' | 'warn';
  text: string;
  offlineCount: number;
  totalNicks: number;
} | null>(() => {
  const list = data.value?.nicks ?? [];
  const totalNicks =
    data.value?.nickHealth?.totalNicks ?? list.length;
  if (totalNicks === 0) return null;
  const onlineCount =
    data.value?.nickHealth?.onlineCount ??
    list.filter((n) => n.status === 'connected').length;
  const offlineCount =
    data.value?.nickHealth?.offlineCount ?? totalNicks - onlineCount;
  const allOffline = data.value?.nickHealth?.allOffline ?? onlineCount === 0;

  if (allOffline) {
    return {
      show: true,
      level: 'danger',
      text: `Tất cả ${totalNicks} nick offline — Mục tiêu không gửi được mời kết bạn`,
      offlineCount,
      totalNicks,
    };
  }
  // >50% offline = quá nửa, warn.
  if (offlineCount * 2 > totalNicks) {
    return {
      show: true,
      level: 'warn',
      text: `${offlineCount}/${totalNicks} nick offline — throughput giảm mạnh, vui lòng kiểm tra`,
      offlineCount,
      totalNicks,
    };
  }
  return null;
});

// Wave 3 Day 5 — wire counters từ BE thật (waitingCrm + customer_*/converted_lead).
// BE response field reference (see GET /triggers/:id/dashboard):
//   counters.waitingCrm      — accepted nhưng chưa sale nào tiếp nhận trong CRM
//   counters.customer_reply  — KH đã reply tin (Phase 2 dừng cho KH này)
//   counters.customer_block  — KH đã block nick (Phase 2 dừng cho nick này)
//   counters.converted_lead  — đã thành Lead trong CRM
const entryChips = computed<{
  key: EntryFilterKey;
  label: string;
  count: number;
  tooltip?: string;
}[]>(() => {
  const c = data.value?.counters ?? {};
  const total = stats.value.total;
  return [
    { key: 'all',     label: 'Tất cả',             count: total },
    { key: 'running', label: '🟢 Đang chạy',        count: c.processing ?? 0 },
    { key: 'done',    label: '✅ Hoàn tất',         count: c.completed ?? 0 },
    { key: 'reply',   label: '🛑 KH reply',         count: c.customer_reply ?? phase2.value.reply },
    { key: 'block',   label: '🚫 KH block',         count: c.customer_block ?? phase2.value.block },
    { key: 'lead',    label: '💎 Lead',             count: c.converted_lead ?? phase2.value.lead },
    {
      key: 'cho-crm',
      label: '🟡 Chờ CRM',
      count: c.waitingCrm ?? c.accepted ?? 0,
      tooltip: 'KH đã đồng ý kết bạn nhưng chưa có sale tiếp nhận trong CRM',
    },
    { key: 'no-zalo', label: '🔴 Không có Zalo',    count: stats.value.noZalo },
  ];
});

// Log tab chips — counts derive từ logEvents page hiện tại (FE-only).
// Khi BE /events trả facets.typeCounts thì swap sang facets (Option B follow-up).
const logTypeChips = computed<{ key: string; label: string; count: number }[]>(() => {
  const all = logEvents.value;
  const countBy = (t: string) => all.filter((ev) => ev.type === t).length;
  return [
    { key: 'all',                label: '📋 Tất cả',         count: all.length },
    { key: 'friend_request',     label: '🤝 Gửi kết bạn',    count: countBy('friend_request') },
    { key: 'welcome',            label: '💌 Tin chào mừng',  count: countBy('welcome') },
    { key: 'follow_up',          label: '⏰ Bám đuổi',       count: countBy('follow_up') },
    { key: 'customer_reply',     label: '🛑 Khách reply',    count: countBy('customer_reply') },
    { key: 'customer_block',     label: '🚫 Khách block',    count: countBy('customer_block') },
    { key: 'nick_disconnected',  label: '⏸ Nick ngắt',       count: countBy('nick_disconnected') },
  ];
});

const filteredEntries = computed(() => {
  let list = data.value?.entries ?? [];
  if (searchInput.value.trim()) {
    const q = searchInput.value.trim().toLowerCase();
    list = list.filter(
      (e) =>
        (e.displayName ?? '').toLowerCase().includes(q) || e.phone.includes(q),
    );
  }
  switch (entryFilter.value) {
    case 'running':
      return list.filter((e) => e.queueStatus === 'processing');
    case 'done':
      return list.filter((e) => e.taskStatus === 'completed' || e.queueStatus === 'completed');
    case 'reply':
      return list.filter((e) => e.queueStatus === 'customer_reply' || e.taskStatus === 'customer_reply');
    case 'block':
      return list.filter((e) => e.queueStatus === 'customer_block' || e.taskStatus === 'customer_block');
    case 'lead':
      return list.filter((e) => e.queueStatus === 'converted_lead' || e.taskStatus === 'converted_lead');
    case 'cho-crm':
      return list.filter((e) => e.queueStatus === 'accepted' || e.queueStatus === 'queued_for_pickup');
    case 'no-zalo':
      return list.filter((e) => e.hasZalo === false || e.queueStatus === 'skipped_no_zalo');
    default:
      return list;
  }
});

const currentPage = computed(
  () => Math.floor((data.value?.entriesOffset ?? 0) / (data.value?.entriesLimit ?? 50)) + 1,
);
const hasNextPage = computed(() => {
  if (!data.value) return false;
  return data.value.entriesOffset + data.value.entries.length < data.value.entriesTotal;
});

// ===================================================================
// ============ LOAD =================================================
// ===================================================================

// Wave 3 2026-05-30 — map FE chip key → BE queueStatus enum (cho ?status query).
// chip 'all' + 'done' + 'cho-crm' + 'no-zalo' không map sang queueStatus đơn lẻ
// (FE filter client-side hoặc dùng nguồn khác), nên trả null → skip ?status.
function chipKeyToQueueStatus(key: EntryFilterKey): string | null {
  switch (key) {
    case 'running': return 'processing';
    case 'reply':   return 'customer_reply';
    case 'block':   return 'customer_block';
    case 'lead':    return 'converted_lead';
    case 'no-zalo': return 'skipped_no_zalo';
    default:        return null;
  }
}

async function load(): Promise<void> {
  try {
    const limit = data.value?.entriesLimit ?? 50;
    const offset = (page.value - 1) * limit;
    const status = chipKeyToQueueStatus(entryFilter.value);
    const params: Record<string, string | number> = { limit, offset };
    if (status) params.status = status;
    const r = await api.get(`/automation/triggers/${triggerId}/dashboard`, {
      params,
    });
    data.value = r.data;
  } catch (err) {
    console.error('[muc-tieu-detail] load failed', err);
  }
}

// Wave 3 2026-05-30 — chip click handler: đổi filter + reset page về 1 + reload
// (BE filter qua ?status sẽ trả đúng subset, FE switch case bên dưới vẫn fallback
// filter thêm cho các chip không map 1-1).
async function setEntryFilter(key: EntryFilterKey): Promise<void> {
  if (entryFilter.value === key) return;
  entryFilter.value = key;
  page.value = 1;
  await load();
}

// M13 2026-06-02 — Action handlers cho state-machine buttons.
// BE endpoint thực tế: /pause (TTL hoặc vô hạn) /resume /cancel (terminal) /activate (draft→active).
// P2 Wave 4 2026-06-03 — /pause nhận body { ttlHours?: number }:
//   - ttlHours=24 → pausedUntil=NOW+24h, cron sweep auto-resume.
//   - body={} → pausedUntil=NULL, pause vô hạn (user phải bấm Tiếp tục).
async function pause24h(): Promise<void> {
  if (!confirm('Tạm dừng Mục tiêu trong 24 giờ? Sẽ tự động tiếp tục sau khi hết hạn.')) return;
  try {
    await api.post(`/automation/triggers/${triggerId}/pause`, { ttlHours: 24 });
    await load();
  } catch (err) {
    console.error('[muc-tieu-detail] pause24h failed', err);
    alert('Không thể tạm dừng — vui lòng thử lại.');
  }
}
async function pauseForever(): Promise<void> {
  if (
    !confirm(
      'Dừng vĩnh viễn Mục tiêu? Worker sẽ dừng tất cả lượt gửi mời / chuỗi cho tới khi bạn bấm "Tiếp tục".',
    )
  )
    return;
  try {
    await api.post(`/automation/triggers/${triggerId}/pause`, {});
    await load();
  } catch (err) {
    console.error('[muc-tieu-detail] pauseForever failed', err);
    alert('Không thể tạm dừng — vui lòng thử lại.');
  }
}
async function resume(): Promise<void> {
  try {
    await api.post(`/automation/triggers/${triggerId}/resume`);
    await load();
  } catch (err) {
    console.error('[muc-tieu-detail] resume failed', err);
    alert('Không thể tiếp tục — vui lòng thử lại.');
  }
}
async function onCancel(): Promise<void> {
  menuOpen.value = false;
  // draft → wording "xoá" / active|paused → "dừng vĩnh viễn"
  const state = data.value?.trigger.state ?? '';
  const msg =
    state === 'draft'
      ? 'Xoá Mục tiêu nháp này? Hành động KHÔNG quay lại được.'
      : 'Dừng vĩnh viễn Mục tiêu? Các KH chưa gửi sẽ bị bỏ. KHÔNG quay lại được.';
  if (!confirm(msg)) return;
  try {
    await api.post(`/automation/triggers/${triggerId}/cancel`);
    if (state === 'draft') {
      router.push('/automation/muc-tieu');
      return;
    }
    await load();
  } catch (err) {
    console.error('[muc-tieu-detail] cancel failed', err);
    alert('Không thể dừng Mục tiêu — vui lòng thử lại.');
  }
}
// M13 — draft → active. BE T4 2026-05-30 đã có /activate endpoint (now hoặc scheduled).
async function onActivate(): Promise<void> {
  if (!confirm('Kích hoạt Mục tiêu này? Worker sẽ bắt đầu gửi lời mời theo cấu hình.')) return;
  try {
    await api.post(`/automation/triggers/${triggerId}/activate`);
    await load();
  } catch (err) {
    console.error('[muc-tieu-detail] activate failed', err);
    alert('Không thể kích hoạt — kiểm tra cấu hình rồi thử lại.');
  }
}
function onEdit(): void {
  // P2 Wave 4 #Edit 2026-06-02 — Mở wizard edit-mode (?edit=<triggerId>).
  // Wizard sẽ GET /:id/edit hydrate form 4 bước rồi submit qua PATCH.
  // Constraint: listId / nickIds / successorSequenceId / state KHÔNG đổi được.
  void router.push(`/automation/muc-tieu/tao-moi?edit=${encodeURIComponent(triggerId)}`);
}
function onDuplicate(): void {
  menuOpen.value = false;
  alert('Sao chép Mục tiêu — Wave 4.');
}
function exportExcel(): void {
  menuOpen.value = false;
  alert('Xuất Excel — Wave 4.');
}
function exportEntries(): void {
  alert('Xuất Excel danh sách KH — Wave 4.');
}
function exportCsv(): void {
  // Defer Wave 4 — keep button discoverable for now
  console.log('[muc-tieu-detail] Export CSV log — defer Wave 4');
  alert('Xuất CSV log — Wave 4.');
}
function goLeadPool(): void {
  void router.push({
    path: '/leads/stuck',
    query: { source: 'muc-tieu', id: triggerId, filter: 'noZalo' },
  });
}

function prevPage(): void {
  if (page.value > 1) {
    page.value--;
    void load();
  }
}
function nextPage(): void {
  if (hasNextPage.value) {
    page.value++;
    void load();
  }
}

// ===================================================================
// ============ TAB SWITCH ===========================================
// ===================================================================

function setTab(tab: TabKey): void {
  currentTab.value = tab;
  // Update URL hash so F5 keeps the active tab (anh's preference).
  const hash = `#tab=${tab}`;
  if (window.location.hash !== hash) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }
  if (tab === 'log') {
    void loadLog();
  }
}

function readTabFromHash(): TabKey {
  const h = window.location.hash;
  if (h.includes('tab=log')) return 'log';
  return 'dashboard';
}

// ===================================================================
// ============ MONITOR (live events) ================================
// ===================================================================

function toggleMonitor(): void {
  monitorPaused.value = !monitorPaused.value;
}

function onMonitorScroll(): void {
  const el = monitorBodyRef.value;
  if (!el) return;
  userScrolledAway.value = el.scrollTop > 40;
}

async function pollMonitor(): Promise<void> {
  if (monitorPaused.value || currentTab.value !== 'dashboard' || monitorPollPending) return;
  monitorPollPending = true;
  try {
    // openIssues: BE chưa có endpoint /events/live → tạm dùng mock fallback.
    // Khi BE ship, gọi: GET /automation/triggers/:id/events/live?since=<iso>
    const params: Record<string, string> = {};
    if (lastMonitorSince) params.since = lastMonitorSince;
    try {
      const r = await api.get(`/automation/triggers/${triggerId}/events/live`, { params });
      const fresh = (r.data?.events ?? []) as Array<{
        id: string;
        at: string;
        type: string;
        icon?: string;
        text?: string;
        tone?: LiveEvent['tone'];
        nickName?: string | null;
        customerName?: string | null;
        rowIndex?: number | null;
      }>;
      mergeEvents(
        fresh.map((ev) => ({
          id: ev.id,
          at: ev.at,
          type: ev.type,
          timeLabel: hhmmss(ev.at),
          icon: ev.icon ?? '🤝',
          text: ev.text ?? '',
          tone: ev.tone ?? null,
          // Fix #3b (2026-06-02) — map 3 field BE đã trả về (trước đây bị drop).
          nickName: ev.nickName ?? null,
          customerName: ev.customerName ?? null,
          rowIndex: ev.rowIndex ?? null,
          isNew: true,
        })),
      );
    } catch (err) {
      // Endpoint chưa có → silent fallback: chỉ log warn 1 lần
      if (!('warnedLiveMissing' in (window as unknown as Record<string, unknown>))) {
        console.warn('[muc-tieu-detail] /events/live chưa sẵn — dùng mock fallback');
        (window as unknown as Record<string, unknown>).warnedLiveMissing = true;
      }
    }
  } finally {
    monitorPollPending = false;
  }
}

function mergeEvents(fresh: LiveEvent[]): void {
  if (fresh.length === 0) return;
  // Newest first; cap at 20.
  // Fix #2 (2026-06-02): BỎ .reverse() — BE đã orderBy desc nên fresh[0] = mới nhất.
  // .reverse() trước đó đảo thành cũ → cũ lên đầu Monitor, mới xuống cuối (SAI).
  monitorEvents.value = [...fresh, ...monitorEvents.value].slice(0, 20);
  lastMonitorSince = fresh[0]?.at ?? lastMonitorSince;
  // Auto-scroll to top if user hasn't scrolled down
  if (!userScrolledAway.value) {
    requestAnimationFrame(() => {
      if (monitorBodyRef.value) monitorBodyRef.value.scrollTop = 0;
    });
  }
  // Drop the is-new flag after animation
  setTimeout(() => {
    monitorEvents.value = monitorEvents.value.map((e) => ({ ...e, isNew: false }));
  }, 400);
}

// seedMockEvents() đã bị xoá 30/05 — gây hiểu lầm "Mục tiêu đang chạy" khi thật ra chưa có entry nào.
// Monitor giờ chỉ render event THẬT từ /events/live; empty thì hiện "Chưa có sự kiện nào".

// ===================================================================
// ============ LOG TAB ==============================================
// ===================================================================

async function loadLog(): Promise<void> {
  if (logLoading.value) return;
  logLoading.value = true;
  try {
    const r = await api.get(`/automation/triggers/${triggerId}/events`, {
      params: {
        type: logFilter.value.type && logFilter.value.type !== 'all' ? logFilter.value.type : undefined,
        from: logFilter.value.from || undefined,
        to: logFilter.value.to || undefined,
        q: logFilter.value.q || undefined,
        limit: LOG_PAGE_SIZE,
        offset: (logPage.value - 1) * LOG_PAGE_SIZE,
      },
    });
    logEvents.value = r.data?.events ?? [];
    logTotal.value = r.data?.total ?? 0;
  } catch (err) {
    // BE may not have /events endpoint yet — leave empty + log
    console.warn('[muc-tieu-detail] /events list chưa sẵn', err);
    logEvents.value = [];
    logTotal.value = 0;
  } finally {
    logLoading.value = false;
  }
}

watch(
  () => [logFilter.value.type, logFilter.value.from, logFilter.value.to, logFilter.value.q],
  () => {
    logPage.value = 1;
    if (currentTab.value === 'log') void loadLog();
  },
);

// ===================================================================
// ============ HELPERS ==============================================
// ===================================================================

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    draft: '📝 Nháp',
    active: '🟢 Đang chạy',
    paused: '⏸ Tạm dừng',
    cancelling: '⏳ Đang huỷ',
    cancelled: '❌ Đã huỷ',
    completed: '✅ Hoàn tất',
  };
  return map[state] ?? state;
}

function formatNum(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString('vi-VN');
}
// M13 — zero-pad 1 chữ số cho giờ HH:00 trong card "Quy tắc gửi an toàn".
function pad2(n: number | undefined | null): string {
  const v = Math.max(0, Math.min(23, n ?? 0));
  return v < 10 ? `0${v}` : String(v);
}
function pct(num: number | undefined | null, denom: number | undefined | null): string {
  const a = num ?? 0;
  const b = denom ?? 0;
  if (!b) return '0';
  return ((a / b) * 100).toFixed(1);
}
function capPct(sent: number, cap: number): number {
  if (!cap) return 0;
  return Math.min(100, Math.round((sent / cap) * 100));
}
function nickInitial(name: string | null | undefined, id: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[parts.length - 1]?.[0] ?? parts[0]?.[0] ?? id[0] ?? '?').toUpperCase();
  }
  return (id[0] ?? '?').toUpperCase();
}
function avatarClass(i: number): string {
  const n = ((i % 6) + 6) % 6;
  const map = ['', 'a2', 'a3', 'a4', 'a5', 'a6'];
  return map[n];
}
function nickIndex(nickId: string | null): number {
  if (!nickId) return 0;
  let h = 0;
  for (let i = 0; i < nickId.length; i++) h = (h * 31 + nickId.charCodeAt(i)) & 0xff;
  return h;
}
function initialsFromName(s: string | null): string {
  if (!s) return '?';
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts[parts.length - 1];
  return (last[0] ?? '?').toUpperCase();
}

// Phase Friend Invite UI 2026-05-30 — derivedStatus → label + chip class.
// BE deriveKHFinalState trả 5 enum: pending_friend | phase1_done | in_sequence | sequence_done | stopped.
function entryStatusLabel(e: Entry): string {
  const ds = e.derivedStatus ?? null;
  if (ds === 'pending_friend') return '🟡 Chờ kết bạn';
  if (ds === 'phase1_done') return '🟢 Đã kết bạn';
  if (ds === 'in_sequence') {
    const cur = e.currentStepIdx ?? 0;
    const total = e.sequenceTotalSteps ?? data.value?.trigger.successorSequence?.stepsCount ?? 0;
    if (total > 0) return `🔵 Bám đuổi (${cur + 1}/${total})`;
    return '🔵 Bám đuổi';
  }
  if (ds === 'sequence_done') return '✅ Hoàn tất';
  if (ds === 'stopped') return '🛑 Dừng';
  // Fallback cũ (payload không có derivedStatus)
  return statusChipLabel(e.queueStatus, e.hasZalo);
}

function entryStatusClass(e: Entry): string {
  const ds = e.derivedStatus ?? null;
  if (ds === 'pending_friend') return 'cho-crm';
  if (ds === 'phase1_done') return 'running';
  if (ds === 'in_sequence') return 'in-seq';
  if (ds === 'sequence_done') return 'done';
  if (ds === 'stopped') return 'reply';
  return statusChipClass(e.queueStatus, e.hasZalo);
}

// Tính cột "Lần gửi tiếp theo" — null=—; future=relative; past+pending → Đến hạn.
function nextRunInfo(e: Entry): {
  label: string;
  isDue: boolean;
  muted: boolean;
} {
  const iso = e.nextRunAt ?? null;
  if (!iso) return { label: '—', isDue: false, muted: true };
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return { label: '—', isDue: false, muted: true };
  const diff = ts - Date.now();
  // Past + entry chưa hoàn tất → "Đến hạn" badge đỏ
  if (diff <= 0) {
    const ds = e.derivedStatus ?? null;
    const pending =
      ds === 'pending_friend' || ds === 'phase1_done' || ds === 'in_sequence' ||
      (ds == null && e.queueStatus !== 'completed' && e.queueStatus !== 'processed');
    if (pending) return { label: 'Đến hạn', isDue: true, muted: false };
    return { label: '—', isDue: false, muted: true };
  }
  // Future → "trong X phút / X giờ / X ngày"
  const sec = Math.round(diff / 1000);
  if (sec < 60) return { label: `trong ${sec}s`, isDue: false, muted: false };
  const min = Math.round(sec / 60);
  if (min < 60) return { label: `trong ${min} phút`, isDue: false, muted: false };
  const hr = Math.round(min / 60);
  if (hr < 24) return { label: `trong ${hr} giờ`, isDue: false, muted: false };
  const day = Math.round(hr / 24);
  return { label: `trong ${day} ngày`, isDue: false, muted: false };
}

// Avatar Zalo URL có thể 404 / expire (Zalo CDN ngắn hạn) — fallback hide image
// để initials block kế bên đảm nhiệm.
function onAvatarError(ev: Event): void {
  const img = ev.target as HTMLImageElement | null;
  if (!img) return;
  img.style.display = 'none';
  const fallback = img.nextElementSibling as HTMLElement | null;
  if (fallback && fallback.classList.contains('contact-avatar-fallback')) {
    fallback.style.display = 'inline-flex';
  }
}

function statusChipClass(qs: string | null, hasZalo: boolean | null): string {
  if (qs === 'processing') return 'running';
  if (qs === 'completed' || qs === 'processed') return 'done';
  if (qs === 'customer_reply') return 'reply';
  if (qs === 'customer_block') return 'block';
  if (qs === 'converted_lead') return 'lead';
  if (qs === 'accepted' || qs === 'queued_for_pickup') return 'cho-crm';
  if (qs === 'skipped_no_zalo' || hasZalo === false) return 'no-zalo';
  return 'cho-crm';
}
function statusChipLabel(qs: string | null, hasZalo: boolean | null): string {
  if (qs === 'processing') return '🟢 Đang chạy';
  if (qs === 'completed' || qs === 'processed') return '✅ Hoàn tất';
  if (qs === 'customer_reply') return '🛑 KH reply';
  if (qs === 'customer_block') return '🚫 KH block';
  if (qs === 'converted_lead') return '💎 Đã thành Lead';
  if (qs === 'accepted' || qs === 'queued_for_pickup') return '🟡 Chờ CRM';
  if (qs === 'skipped_no_zalo' || hasZalo === false) return '🔴 Không có Zalo';
  return qs ?? '—';
}

function stepText(e: Entry): string {
  // P0-3 2026-05-30 — prefer BE-deterministic progressLabel (active task earliest scheduledAt).
  if (e.progressLabel) return e.progressLabel;
  const total = data.value?.trigger.successorSequence?.stepsCount ?? 0;
  if (e.currentStepIdx === null) {
    if (e.queueStatus === 'skipped_no_zalo' || e.hasZalo === false) return '—';
    return total ? `Step 0/${total}` : '—';
  }
  return total ? `Step ${e.currentStepIdx + 1}/${total}` : `Step ${e.currentStepIdx + 1}`;
}
// P0-3 2026-05-30 — tooltip cho cột Bước hiện tại: currentStepIdx + scheduledAt.
function stepTooltip(e: Entry): string {
  const parts: string[] = [];
  if (e.currentStepIdx !== null && e.currentStepIdx !== undefined) {
    parts.push(`currentStepIdx=${e.currentStepIdx}`);
  }
  if (e.nextRunAt) {
    parts.push(`scheduledAt=${e.nextRunAt}`);
  }
  return parts.length ? parts.join(' · ') : '';
}
// P0-3 2026-05-30 — Row click → /chat với contactId + nickId pre-select.
// nickId ưu tiên BE.lastInviteNickId (nick gần nhất đã invite entry này).
function openChat(e: Entry): void {
  if (!e.contactId) return;
  const query: Record<string, string> = { contactId: e.contactId };
  if (e.lastInviteNickId) query.nickId = e.lastInviteNickId;
  void router.push({ path: '/chat', query });
}
function stepDots(e: Entry): string[] {
  const total = data.value?.trigger.successorSequence?.stepsCount ?? 5;
  const cur = e.currentStepIdx;
  const skipped =
    e.queueStatus === 'skipped_no_zalo' ||
    e.hasZalo === false ||
    e.queueStatus === 'cancelled';
  const dotsOut: string[] = [];
  for (let i = 0; i < total; i++) {
    if (skipped) dotsOut.push('skip');
    else if (cur === null) dotsOut.push('');
    else if (e.taskStatus === 'completed') dotsOut.push('done-filled');
    else if (i < (cur + 1)) dotsOut.push('filled');
    else dotsOut.push('');
  }
  return dotsOut;
}

function formatDate(iso: string): string {
  return formatInOrgTz(iso);
}
function hhmmss(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  return `${day} ngày trước`;
}
function todayIso(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function typePillClass(type: string): string {
  const map: Record<string, string> = {
    friend_request: 't-kb',
    welcome: 't-wel',
    follow_up: 't-bd',
    customer_reply: 't-reply',
    customer_block: 't-block',
    converted_lead: 't-lead',
    nick_disconnected: 't-dc',
    nick_resumed: 't-sys',
    zalo_check: 't-sys',
    warning: 't-warn',
  };
  return map[type] ?? 't-sys';
}
function typePillLabel(type: string): string {
  const map: Record<string, string> = {
    friend_request: '🤝 Gửi KB',
    welcome: '💌 Welcome',
    follow_up: '⏰ Bám đuổi',
    customer_reply: '🛑 Khách reply',
    customer_block: '🚫 Khách block',
    converted_lead: '💎 Thành Lead',
    nick_disconnected: '⏸ Ngắt kết nối',
    nick_resumed: '🔄 Tự chạy tiếp',
    zalo_check: '🔍 Kiểm Zalo',
    warning: '⚠️ Cảnh báo',
  };
  return map[type] ?? type;
}
function logStatusClass(ev: LogEvent): string {
  if (ev.status === 'success') return 'running';
  if (ev.status === 'reply') return 'reply';
  if (ev.status === 'block') return 'block';
  if (ev.status === 'lead') return 'lead';
  if (ev.status === 'paused') return 'paused';
  return 'running';
}
function logStatusLabel(ev: LogEvent): string {
  const map: Record<string, string> = {
    success: '🟢 Thành công',
    reply: '🛑 Dừng cho KH',
    block: '🚫 Dừng cho nick',
    lead: '💎 Đã thành Lead',
    paused: '⏸ Tạm dừng',
    failed: '⚠️ Lỗi',
  };
  return map[ev.status ?? ''] ?? '🟢 Thành công';
}

function estimateDays(remaining: number, nicks: NickStat[]): number {
  if (remaining <= 0 || nicks.length === 0) return 0;
  const dailyTotal = nicks.reduce((s, n) => s + (n.dailyFriendAddCap ?? 0), 0);
  if (!dailyTotal) return 0;
  return remaining / dailyTotal;
}

// ===================================================================
// ============ LIFECYCLE ============================================
// ===================================================================

function onDocClick(e: MouseEvent): void {
  if (!menuOpen.value) return;
  const wrap = menuWrapRef.value;
  if (wrap && !wrap.contains(e.target as Node)) menuOpen.value = false;
}

onMounted(() => {
  // Initial tab from URL hash
  currentTab.value = readTabFromHash();
  void load();
  dashboardTimer = setInterval(load, 5000);

  // BE /events/live đã ship Day 4 — KHÔNG seed mock nữa.
  // Monitor sẽ render empty state "Chưa có sự kiện nào" cho tới khi worker emit event thật.
  // Fix #5 (2026-06-02): gọi pollMonitor() NGAY khi mount để Anh không phải chờ 5s tick đầu.
  void pollMonitor();
  monitorTimer = setInterval(pollMonitor, 5000);

  if (currentTab.value === 'log') void loadLog();
  document.addEventListener('click', onDocClick);
});

onUnmounted(() => {
  if (dashboardTimer) clearInterval(dashboardTimer);
  if (monitorTimer) clearInterval(monitorTimer);
  document.removeEventListener('click', onDocClick);
});
</script>

<style scoped>
.mtd-page {
  --bg-page: #fafbfc;
  --bg-card: #ffffff;
  --bg-soft: #f4f5f7;
  --bg-hover: #ebf3ff;
  --border: #dfe1e6;
  --border-strong: #c1c7d0;
  --text-1: #172b4d;
  --text-2: #42526e;
  --text-3: #6b778c;
  --text-mute: #97a0af;
  --primary: #2d7ff9;
  --primary-hover: #1b6fe0;
  --primary-bg: #e7f0ff;
  --success: #36b37e;
  --success-bg: #e3fcef;
  --warning: #ffab00;
  --warning-bg: #fff7e0;
  --danger: #de350b;
  --danger-bg: #ffebe6;
  --purple: #6554c0;
  --purple-bg: #eae6ff;
  --shadow-1: 0 1px 2px rgba(9, 30, 66, 0.05);
  --shadow-2: 0 4px 12px rgba(9, 30, 66, 0.12);

  background: var(--bg-page);
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.45;
  min-height: 100vh;
  padding: 16px 24px 96px;
  width: 100%;
  min-width: 1280px;
  max-width: 1920px;
  margin: 0 auto;
}
.mtd-loading { text-align: center; padding: 80px; color: var(--text-3); }

/* breadcrumb */
.crumb { font-size: 12px; color: var(--text-3); margin-bottom: 6px; display: flex; align-items: center; flex-wrap: wrap; }
.crumb a { color: var(--text-3); text-decoration: none; cursor: pointer; }
.crumb a:hover { color: var(--primary); }
.crumb .sep { margin: 0 6px; color: var(--text-mute); }
.crumb .current { color: var(--text-2); }

.back-link {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--text-3); font-size: 12px; text-decoration: none; cursor: pointer;
  padding: 4px 0; margin-bottom: 8px; font-weight: 500;
}
.back-link:hover { color: var(--primary); }

/* topbar */
.topbar {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
  margin-bottom: 6px;
}
.topbar .left { min-width: 0; flex: 1; }
.topbar h1 {
  font-size: 22px; font-weight: 700; margin: 0 0 6px;
  letter-spacing: -0.01em; color: var(--text-1);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.topbar .sub { font-size: 12px; color: var(--text-3); margin: 0; }
.topbar .sub strong { color: var(--text-2); font-weight: 600; }
.actions { display: flex; gap: 8px; flex-shrink: 0; }

/* buttons */
.btn {
  padding: 8px 14px;
  background: white;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text-2);
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.btn:hover { background: var(--bg-soft); border-color: var(--text-3); }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
.btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
/* M13 — destructive action (Dừng hẳn / Xoá). Outline đỏ, fill khi hover. */
.btn-danger {
  color: var(--danger, #de350b);
  border-color: #ffbdad;
  background: white;
}
.btn-danger:hover {
  background: var(--danger, #de350b);
  border-color: var(--danger, #de350b);
  color: white;
}
/* 2026-06-03 Anh chốt — Pause button: hiển thị "Đang dừng (countdown)", hover → "Tiếp tục". */
.btn-pause-hover .pause-label-hover { display: none; }
.btn-pause-hover:hover {
  border-color: var(--primary, #0068ff);
  color: var(--primary, #0068ff);
  background: #ebf3ff;
}
.btn-pause-hover:hover .pause-label-default { display: none; }
.btn-pause-hover:hover .pause-label-hover { display: inline; font-weight: 600; }
.btn-icon { padding: 8px 10px; }
.btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 4px; }

/* status pill */
.status {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 4px;
  font-size: 12px; font-weight: 600; white-space: nowrap;
}
.status.s-active { background: var(--success-bg); color: #006644; }
.status.s-completed { background: var(--primary-bg); color: var(--primary); }
.status.s-paused { background: var(--bg-soft); color: var(--text-2); }
.status.s-draft { background: var(--bg-soft); color: var(--text-3); }
.status.s-cancelled { background: var(--danger-bg); color: var(--danger); }
.status.s-cancelling { background: var(--warning-bg); color: #974f00; }

/* estatus chips */
.estatus {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 4px;
  font-size: 12px; font-weight: 500; white-space: nowrap;
}
.estatus.running { background: var(--success-bg); color: #006644; }
.estatus.done { background: var(--primary-bg); color: var(--primary); }
.estatus.reply { background: var(--danger-bg); color: var(--danger); }
.estatus.block { background: #eceef1; color: #42526e; }
.estatus.lead { background: var(--purple-bg); color: var(--purple); }
.estatus.cho-crm { background: var(--warning-bg); color: #974f00; }
.estatus.no-zalo { background: #ffebe6; color: var(--danger); }
.estatus.paused { background: var(--bg-soft); color: var(--text-2); }
/* Phase Friend Invite UI 2026-05-30 — derivedStatus 'in_sequence' badge xanh dương */
.estatus.in-seq { background: var(--primary-bg); color: var(--primary); }

/* menu dropdown */
.menu-wrap { position: relative; }
.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 200px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-2);
  padding: 6px 0;
  z-index: 30;
}
.menu-item {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  display: flex; align-items: center; gap: 8px;
}
.menu-item:hover { background: var(--bg-soft); color: var(--text-1); }
.menu-item.danger { color: var(--danger); }
.menu-item.danger:hover { background: var(--danger-bg); }
.menu-divider { height: 1px; background: var(--border); margin: 4px 0; }

/* tab nav */
.tabs {
  margin-top: 14px;
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding: 0 2px;
}
.tab {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-3);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--text-2); }
.tab.active { color: var(--primary); border-bottom-color: var(--primary); }
.tab-panel { /* visible via v-show */ }

/* monitor */
.monitor {
  margin-top: 14px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-1);
  overflow: hidden;
}
.monitor-head {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  background: white;
}
.monitor-head h3 {
  font-size: 14px; font-weight: 700; margin: 0;
  color: var(--text-1); display: flex; align-items: center; gap: 8px;
}
.head-hint-inline { color: var(--text-3); font-weight: 500; font-size: 12px; }
.monitor-head-actions { display: flex; align-items: center; gap: 10px; }
.live-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px;
  background: var(--success-bg);
  color: #006644;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}
.live-chip.paused { background: var(--bg-soft); color: var(--text-3); }
.live-chip.paused .live-dot { background: var(--text-mute); animation: none; }
.live-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--success);
  animation: pulse-live 1.5s ease-in-out infinite;
}
@keyframes pulse-live {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
.monitor-body {
  height: 280px;
  overflow-y: auto;
  background: var(--bg-page);
}
.mon-row {
  display: grid;
  grid-template-columns: 28px 92px 1fr;
  gap: 10px;
  padding: 7px 14px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-1);
  background: white;
  transition: background 0.12s;
}
.mon-row:hover { background: var(--bg-hover); }
.mon-row .mon-icon { font-size: 16px; text-align: center; }
.mon-row .mon-time { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; font-weight: 500; }
.mon-row :deep(b), .mon-row b { font-weight: 600; color: var(--text-1); }
.mon-row.is-new { animation: slideInTop 300ms ease-out; }
@keyframes slideInTop {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.mon-row.t-stop   .mon-icon { color: var(--danger); }
.mon-row.t-block  .mon-icon { color: var(--text-2); }
.mon-row.t-lead   .mon-icon { color: var(--purple); }
.mon-row.t-warn   .mon-icon { color: var(--warning); }
/* Fix #3b (2026-06-02) — Monitor enrichment: row index pill + meta (KH ↔ nick) */
.mon-row .mon-row-idx {
  display: inline-block;
  min-width: 22px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-soft);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  margin-right: 4px;
}
.mon-row .mon-meta { color: var(--text-3); font-size: 11px; margin-left: 4px; }
.mon-row .mon-nick { color: var(--primary); font-weight: 500; }
.mon-empty { padding: 28px 14px; color: var(--text-3); font-style: italic; text-align: center; font-size: 12px; }

/* eta */
.eta-bar {
  margin-top: 10px;
  background: linear-gradient(90deg, #e7f0ff 0%, #f4f5f7 100%);
  border: 1px solid #bbddff;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-1);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.eta-bar .eta-icon { font-size: 16px; }
.eta-bar strong { color: var(--primary); font-weight: 700; }
.eta-bar .eta-sep { color: var(--text-mute); }

/* M13 2026-06-02 — Card "Quy tắc gửi an toàn" (read-only).
   Airtable-style: light bg, grid 4 col HD / 7 col Full-HD, tile mỗi rule. */
.safety-card {
  margin-top: 14px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-1);
}
.safety-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.safety-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.safety-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--border);
}
@media (min-width: 1600px) {
  .safety-grid { grid-template-columns: repeat(7, 1fr); }
}
.safety-tile {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  background: white;
  align-items: flex-start;
}
.safety-tile .st-icon {
  font-size: 18px;
  line-height: 1;
  flex: 0 0 auto;
  padding-top: 2px;
}
.safety-tile .st-body { min-width: 0; flex: 1; }
.safety-tile .st-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}
.safety-tile .st-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1);
  line-height: 1.2;
}
.safety-tile .st-hint {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 3px;
}
.safety-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  color: var(--text-3);
  font-size: 13px;
}
.safety-empty a { color: var(--primary); text-decoration: none; font-weight: 600; }
.safety-empty a:hover { text-decoration: underline; }

/* stats */
.stats-row {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.stat-card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  box-shadow: var(--shadow-1);
}
.stat-card .stat-label {
  font-size: 11px; font-weight: 600; color: var(--text-3);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.stat-card .stat-value {
  font-size: 24px; font-weight: 700; color: var(--text-1);
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.stat-card .stat-hint { font-size: 11px; color: var(--text-3); margin-top: 4px; }
.stat-card.accent-blue { border-top: 3px solid var(--primary); }
.stat-card.accent-green { border-top: 3px solid var(--success); }
.stat-card.accent-purple { border-top: 3px solid var(--purple); }
.stat-card.accent-red { border-top: 3px solid var(--danger); }

/* CTA red */
.cta-red {
  margin-top: 14px;
  background: var(--danger-bg);
  border: 1px solid #ffbdad;
  border-left: 4px solid var(--danger);
  border-radius: 6px;
  padding: 12px 16px;
  display: flex; align-items: center; gap: 12px;
}
.cta-red .cta-bullet { font-size: 18px; }
.cta-red .cta-msg { flex: 1; font-size: 13px; color: var(--text-1); }
.cta-red .cta-msg strong { color: var(--danger); font-weight: 700; }
.cta-red .cta-link {
  background: white;
  color: var(--danger);
  border: 1px solid var(--danger);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s;
}
.cta-red .cta-link:hover { background: var(--danger); color: white; }

/* Task B Nick offline 2026-05-30 — sức khoẻ nick banner (danger/warn) */
.nick-health-banner {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid transparent;
  border-left-width: 4px;
  font-size: 13px;
}
.nick-health-banner.level-danger {
  background: var(--danger-bg, #ffebe6);
  border-color: #ffbdad;
  border-left-color: var(--danger, #de350b);
  color: var(--text-1);
}
.nick-health-banner.level-warn {
  background: #fff8e1;
  border-color: #ffe082;
  border-left-color: #f5a623;
  color: var(--text-1);
}
.nick-health-banner .nhb-icon { font-size: 18px; line-height: 1; }
.nick-health-banner .nhb-msg { flex: 1; }
.nick-health-banner.level-danger .nhb-msg strong { color: var(--danger, #de350b); font-weight: 700; }
.nick-health-banner.level-warn .nhb-msg strong { color: #b76e00; font-weight: 700; }
.nick-health-banner .nhb-link {
  background: white;
  border: 1px solid currentColor;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s;
}
.nick-health-banner.level-danger .nhb-link {
  color: var(--danger, #de350b);
  border-color: var(--danger, #de350b);
}
.nick-health-banner.level-danger .nhb-link:hover {
  background: var(--danger, #de350b);
  color: white;
}
.nick-health-banner.level-warn .nhb-link {
  color: #b76e00;
  border-color: #f5a623;
}
.nick-health-banner.level-warn .nhb-link:hover {
  background: #f5a623;
  color: white;
}

/* Nick status badge (Task B) — viên màu rõ rệt trong nick table */
.nick-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.nick-status-badge.nsb-online {
  background: rgba(54, 179, 126, 0.12);
  color: #006644;
}
.nick-status-badge.nsb-offline {
  background: rgba(222, 53, 11, 0.10);
  color: #ad2a02;
}
.nick-last-seen {
  font-size: 11px;
  color: var(--text-3);
  margin-left: 6px;
}

/* phase grid */
.phase-row {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.phase-card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  box-shadow: var(--shadow-1);
}
.phase-card h3 {
  font-size: 13px; font-weight: 700; margin: 0 0 12px;
  color: var(--text-1); display: flex; align-items: center; gap: 6px;
}
.phase-card .phase-hint { font-size: 11px; color: var(--text-3); font-weight: 400; margin-left: 4px; }
.mini-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.mini-card {
  background: var(--bg-soft);
  border-radius: 4px;
  padding: 10px 12px;
  text-align: left;
}
.mini-card .mini-value {
  font-size: 18px; font-weight: 700; color: var(--text-1);
  line-height: 1.1;
}
.mini-card .mini-label {
  font-size: 11px; color: var(--text-3); margin-top: 4px; font-weight: 500;
}
.mini-card.green .mini-value { color: var(--success); }
.mini-card.red .mini-value { color: var(--danger); }
.mini-card.orange .mini-value { color: var(--warning); }
.mini-card.blue .mini-value { color: var(--primary); }

.phase-sub {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  font-size: 12px;
  color: var(--text-3);
  display: flex; gap: 14px; flex-wrap: wrap;
}
.phase-sub .sub-pill { display: inline-flex; align-items: center; gap: 4px; }
.phase-sub .sub-pill strong { color: var(--text-1); font-weight: 600; }

/* sections + tables */
.section {
  margin-top: 18px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-1);
  overflow: hidden;
}
.section-mt { margin-top: 14px; }
.section-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: white;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.section-head h3 {
  font-size: 14px; font-weight: 700; margin: 0;
  color: var(--text-1); display: flex; align-items: center; gap: 6px;
}
.section-head .head-hint { font-size: 12px; color: var(--text-3); font-weight: 400; margin-left: 4px; }
.section-head .head-actions { display: flex; gap: 8px; align-items: center; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead tr { background: var(--bg-soft); }
thead th {
  text-align: left;
  padding: 9px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
thead th:hover { background: #eceef1; color: var(--text-2); }
thead th .sort-arrow { color: var(--text-mute); font-size: 10px; margin-left: 4px; }
thead th.sorted .sort-arrow { color: var(--primary); }
thead th.sorted { color: var(--primary); }
tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
tbody tr:hover { background: var(--bg-hover); }
tbody tr:last-child { border-bottom: none; }
tbody td { padding: 10px 14px; vertical-align: middle; }

.empty-row { text-align: center; color: var(--text-3); font-style: italic; padding: 28px !important; }

/* nick + avatar */
.nick-cell { display: flex; align-items: center; gap: 8px; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.avatar.avatar-sm { width: 22px; height: 22px; font-size: 10px; }
.avatar.a2 { background: #ffe0b2; color: #b45309; }
.avatar.a3 { background: #d1fae5; color: #047857; }
.avatar.a4 { background: #e0e7ff; color: #4f46e5; }
.avatar.a5 { background: #fce7f3; color: #be185d; }
.avatar.a6 { background: #fde68a; color: #92400e; }
.nick-name { font-weight: 600; color: var(--text-1); }
.nick-pin-name { font-size: 12px; color: var(--text-2); }

.num { font-variant-numeric: tabular-nums; color: var(--text-1); }
.num.muted { color: var(--text-3); font-size: 12px; }
.pct { font-weight: 600; font-variant-numeric: tabular-nums; }
.pct.hi { color: var(--success); }
.pct.lo { color: var(--danger); }
.medal { font-size: 12px; margin-left: 4px; }

.quota-cell { display: flex; align-items: center; gap: 8px; }
.quota-bar {
  width: 80px; height: 4px;
  background: var(--bg-soft);
  border-radius: 2px;
  overflow: hidden;
}
.quota-fill { height: 100%; background: var(--success); }

.dot-online {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--success); display: inline-block;
  box-shadow: 0 0 0 2px rgba(54, 179, 126, 0.2);
}
.dot-offline {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--text-mute); display: inline-block;
}
.nick-status-txt { font-size: 12px; color: var(--text-2); margin-left: 4px; }

/* filter bar */
.filter-bar {
  background: white;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.search-wrap { position: relative; width: 280px; }
.search-input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 13px;
  background: white;
  font-family: inherit;
  color: var(--text-1);
  transition: border-color 0.15s;
}
.search-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(45, 127, 249, 0.15); }
.search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-3); font-size: 14px; }

.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  padding: 5px 11px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  user-select: none;
}
.chip:hover { background: var(--bg-soft); border-color: var(--border-strong); }
.chip.active { background: var(--primary-bg); border-color: var(--primary); color: var(--primary); font-weight: 600; }
.chip .count { color: var(--text-3); font-size: 11px; }
.chip.active .count { color: var(--primary); }

/* CSS-only tooltip — dark bg, 200ms delay, position above chip.
   Dùng cho chip có data-tooltip (vd: 🟡 Chờ CRM). Native title=slow + không style. */
.chip.has-tooltip { position: relative; }
.chip.has-tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 10px;
  background: rgba(23, 28, 38, 0.95);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  border-radius: 4px;
  white-space: normal;
  width: max-content;
  max-width: 240px;
  text-align: center;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease 0.2s, visibility 0s linear 0.35s;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(9, 30, 66, 0.2);
}
.chip.has-tooltip::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 1px);
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(23, 28, 38, 0.95);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease 0.2s, visibility 0s linear 0.35s;
  z-index: 1000;
}
.chip.has-tooltip:hover::after,
.chip.has-tooltip:hover::before {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.15s ease 0.2s, visibility 0s linear 0.2s;
}

/* Log tab chip row — full-width, wrap to next line, separator from date/search. */
.log-type-chips {
  width: 100%;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 4px;
}

/* entries table specifics */
.entries-table th, .entries-table td { padding: 9px 12px; }
/* P0-3 2026-05-30 — entry row hover hint cho row-click → /chat. */
.entries-table tbody tr.entry-row:hover { background: var(--bg-soft); }
.entries-table .col-num { width: 56px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.entries-table .col-kh { width: 22%; }
.entries-table .col-phone { width: 110px; font-variant-numeric: tabular-nums; color: var(--text-2); }
.entries-table .col-nickpin { width: 130px; }
.entries-table .col-step { width: 170px; }
.entries-table .col-status { width: 150px; }
.entries-table .col-update { width: 130px; color: var(--text-3); }
.entries-table .col-next { width: 130px; color: var(--text-3); }

/* Avatar Zalo (Phase Friend Invite UI 2026-05-30) — 40×40 round, fallback initials. */
.contact-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  object-fit: cover;
  background: var(--bg-soft);
  flex-shrink: 0;
  border: 1px solid var(--border);
}
.contact-avatar-fallback { width: 40px; height: 40px; font-size: 13px; }

.kh-cell { display: flex; align-items: center; gap: 8px; }
.kh-name { font-weight: 600; color: var(--text-1); font-size: 13px; }
.kh-sub { font-size: 11px; color: var(--text-3); margin-top: 1px; }

.muted { color: var(--text-mute); font-size: 12px; }

/* step bar */
.step-bar { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); }
.step-dots { display: inline-flex; gap: 3px; }
.step-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--border-strong);
}
.step-dot.filled { background: var(--primary); }
.step-dot.done-filled { background: var(--success); }
.step-dot.skip { background: var(--bg-soft); border: 1px dashed var(--border-strong); }
.step-label { font-size: 11px; color: var(--text-3); font-weight: 500; }

/* pagination */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-size: 12px;
  color: var(--text-3);
  background: white;
  border-top: 1px solid var(--border);
}
.page-nav { display: flex; gap: 4px; }
.page-btn {
  min-width: 28px; height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  background: white;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  font-family: inherit;
}
.page-btn:hover:not(:disabled) { background: var(--bg-soft); }
.page-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* log tab */
.log-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  background: white;
}
.log-head h3 {
  font-size: 14px; font-weight: 700; margin: 0;
  color: var(--text-1); display: flex; align-items: center; gap: 6px;
}
.log-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: white;
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
}
.log-toolbar select,
.log-toolbar input[type="date"],
.log-toolbar input[type="text"] {
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-1);
  background: white;
}
.log-toolbar select:focus,
.log-toolbar input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(45, 127, 249, 0.15);
}
.log-toolbar input[type="text"] { width: 240px; }
.log-toolbar .date-range { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); }

.log-table th, .log-table td { padding: 9px 12px; font-size: 12px; }
.log-table .col-time { width: 130px; font-variant-numeric: tabular-nums; color: var(--text-2); }
.log-table .col-type { width: 130px; }
.log-table .col-nick { width: 130px; }
.log-table .col-kh { width: 180px; }
.log-table .col-row { width: 70px; font-variant-numeric: tabular-nums; color: var(--text-3); }
.log-table .col-target { width: 180px; }
.log-table .col-status { width: 130px; }
.log-table .col-detail { color: var(--text-2); }
.log-table tr { cursor: default; }
.log-table tbody tr:hover { background: var(--bg-hover); }

.type-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.type-pill.t-kb     { background: var(--primary-bg);  color: var(--primary); }
.type-pill.t-wel    { background: #fce7f3;            color: #be185d; }
.type-pill.t-bd     { background: var(--warning-bg);  color: #974f00; }
.type-pill.t-reply  { background: var(--danger-bg);   color: var(--danger); }
.type-pill.t-block  { background: #eceef1;            color: var(--text-2); }
.type-pill.t-lead   { background: var(--purple-bg);   color: var(--purple); }
.type-pill.t-dc     { background: var(--bg-soft);     color: var(--text-2); }
.type-pill.t-sys    { background: var(--bg-soft);     color: var(--text-3); }
.type-pill.t-warn   { background: var(--warning-bg);  color: #974f00; }

/* sticky bottom hint */
.sticky-hint {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: linear-gradient(180deg, rgba(250, 251, 252, 0) 0%, #fafbfc 30%);
  padding: 14px 24px 14px;
  z-index: 20;
  pointer-events: none;
}
.sticky-hint-inner {
  max-width: 1920px; min-width: 1280px; margin: 0 auto;
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 16px;
  font-size: 12px;
  color: var(--text-2);
  box-shadow: var(--shadow-2);
  display: flex; align-items: center; gap: 8px;
  pointer-events: auto;
}
.sticky-hint-inner .hint-emoji { font-size: 14px; }
.sticky-hint-inner strong { color: var(--text-1); font-weight: 600; }
.muted-inline { color: var(--text-mute); }
</style>
