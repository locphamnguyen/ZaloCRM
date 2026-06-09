<template>
  <div class="mtd-page">
    <div v-if="!data" class="mtd-loading">Đang tải...</div>
    <template v-else>
      <!-- ============ HEADER ============ -->
      <div class="crumb">
        <a href="#" @click.prevent="router.push('/marketing/triggers')">Marketing</a>
        <span class="sep">/</span>
        <a href="#" @click.prevent="router.push('/marketing/triggers')">Mục tiêu</a>
        <span class="sep">/</span>
        <span class="current">{{ data.trigger.name }}</span>
      </div>

      <a href="#" class="back-link" @click.prevent="router.push('/marketing/triggers')"><v-icon size="14">mdi-arrow-left</v-icon> Mục tiêu</a>

      <div class="topbar">
        <div class="left">
          <h1>
            {{ data.trigger.name }}
            <span class="status" :class="`s-${data.trigger.state}`">
              <span class="dot"></span>{{ stateLabel(data.trigger.state) }}
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
            <button class="btn" @click="pause24h"><v-icon size="15">mdi-pause-circle-outline</v-icon> Tạm dừng 24h</button>
            <button class="btn" @click="pauseForever"><v-icon size="15">mdi-pause</v-icon> Tạm dừng</button>
            <button class="btn btn-danger" @click="onCancel"><v-icon size="15">mdi-stop-circle-outline</v-icon> Kết thúc</button>
          </template>
          <template v-else-if="data.trigger.state === 'paused'">
            <!-- 2026-06-03 — Pause card mới: text mặc định "Đang dừng (Xh Ym)" với countdown
                 nếu paused_until set; hover → "▶️ Tiếp tục". Pause vô hạn (không TTL) thì
                 text mặc định "⏸ Đang dừng" (không countdown), hover same. -->
            <button class="btn btn-pause-hover" @click="resume" :title="pauseTooltip">
              <span class="pause-label-default"><v-icon size="15">mdi-pause</v-icon> {{ pauseLabel }}</span>
              <span class="pause-label-hover"><v-icon size="15">mdi-play</v-icon> Tiếp tục</span>
            </button>
            <button class="btn btn-danger" @click="onCancel"><v-icon size="15">mdi-stop-circle-outline</v-icon> Kết thúc</button>
          </template>
          <template v-else-if="data.trigger.state === 'draft'">
            <button class="btn btn-primary" @click="onActivate"><v-icon size="15">mdi-play</v-icon> Kích hoạt</button>
            <button class="btn btn-danger" @click="onCancel"><v-icon size="15">mdi-trash-can-outline</v-icon> Xoá</button>
          </template>
          <template v-else-if="data.trigger.state === 'cancelling'">
            <button class="btn" disabled><v-icon size="15">mdi-timer-sand</v-icon> Đang huỷ…</button>
          </template>
          <template v-else>
            <!-- cancelled | completed → chỉ xem lịch sử + sao chép -->
            <button class="btn" @click="setTab('log')"><v-icon size="15">mdi-chart-box-outline</v-icon> Xem lịch sử</button>
          </template>
          <button class="btn" @click="onEdit"><v-icon size="15">mdi-pencil-outline</v-icon> Sửa</button>
          <div class="menu-wrap" ref="menuWrapRef">
            <button class="btn btn-icon" title="Tác vụ khác" @click.stop="menuOpen = !menuOpen"><v-icon size="18">mdi-dots-horizontal</v-icon></button>
            <div v-show="menuOpen" class="menu">
              <div class="menu-item" @click="onDuplicate"><v-icon size="16">mdi-content-copy</v-icon> Sao chép</div>
              <div class="menu-item" @click="exportExcel"><v-icon size="16">mdi-tray-arrow-up</v-icon> Xuất Excel</div>
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
          <v-icon size="15">mdi-view-dashboard-outline</v-icon> Dashboard
        </button>
        <button
          class="tab"
          :class="{ active: currentTab === 'log' }"
          role="tab"
          @click="setTab('log')"
        >
          <v-icon size="15">mdi-format-list-bulleted</v-icon> Log sự kiện
        </button>
      </div>

      <!-- =========================================================== -->
      <!-- ============ TAB 1: DASHBOARD ============================ -->
      <!-- =========================================================== -->
      <div v-show="currentTab === 'dashboard'" class="tab-panel">
        <!-- ============ MONITOR LIVE FEED — Option B (bảng 6 cột 1 dòng) ============ -->
        <div class="monitor">
          <div class="monitor-head">
            <h3>
              <v-icon size="16">mdi-monitor-eye</v-icon> Theo dõi trực tiếp
              <span class="head-hint-inline">20 sự kiện mới nhất · tự làm mới mỗi 5 giây · Giờ VN (UTC+7)</span>
            </h3>
            <div class="monitor-head-actions">
              <span class="live-chip" :class="{ paused: monitorPaused }">
                <span class="live-dot"></span>
                {{ monitorPaused ? 'TẠM DỪNG' : 'LIVE' }}
              </span>
              <button class="btn btn-sm" @click="toggleMonitor">
                <v-icon size="14">{{ monitorPaused ? 'mdi-play' : 'mdi-pause' }}</v-icon>
                {{ monitorPaused ? 'Tiếp tục' : 'Tạm dừng' }}
              </button>
            </div>
          </div>
          <!-- Sprint v3 (2026-06-03) — Chip filter 6 nhóm + sound toggle -->
          <div class="monitor-filter-row">
            <span class="mon-chip" :class="{ active: monitorFilter === 'all' }" @click="monitorFilter = 'all'">
              Tất cả <span class="mon-chip-count">{{ monitorChipCounts.all }}</span>
            </span>
            <span class="mon-chip" :class="{ active: monitorFilter === 'rescue' }" @click="monitorFilter = 'rescue'">
              <v-icon size="13">mdi-fire</v-icon> KH cần cứu <span class="mon-chip-count">{{ monitorChipCounts.rescue }}</span>
            </span>
            <span class="mon-chip" :class="{ active: monitorFilter === 'lead' }" @click="monitorFilter = 'lead'">
              <v-icon size="13">mdi-diamond-stone</v-icon> Lead <span class="mon-chip-count">{{ monitorChipCounts.lead }}</span>
            </span>
            <span class="mon-chip" :class="{ active: monitorFilter === 'reply' }" @click="monitorFilter = 'reply'">
              <v-icon size="13">mdi-message-text-outline</v-icon> KH trả lời <span class="mon-chip-count">{{ monitorChipCounts.reply }}</span>
            </span>
            <span class="mon-chip" :class="{ active: monitorFilter === 'block' }" @click="monitorFilter = 'block'">
              <v-icon size="13">mdi-cancel</v-icon> Chặn <span class="mon-chip-count">{{ monitorChipCounts.block }}</span>
            </span>
            <span class="mon-chip" :class="{ active: monitorFilter === 't23h' }" @click="monitorFilter = 't23h'">
              <v-icon size="13">mdi-clock-alert-outline</v-icon> T+23h <span class="mon-chip-count">{{ monitorChipCounts.t23h }}</span>
            </span>
            <button class="sound-toggle" :class="{ on: soundEnabled }" @click="toggleSound" :title="soundEnabled ? 'Tắt âm' : 'Bật âm cảnh báo'">
              <v-icon size="14">{{ soundEnabled ? 'mdi-bell-ring-outline' : 'mdi-bell-off-outline' }}</v-icon>
              {{ soundEnabled ? 'Âm: BẬT' : 'Âm: Tắt' }}
            </button>
          </div>
          <div ref="monitorBodyRef" class="ev-table-wrap mon-table-wrap" @scroll="onMonitorScroll">
            <table class="ev-table mon-table">
              <thead>
                <tr>
                  <th class="col-time"><v-icon size="13">mdi-clock-outline</v-icon> Giờ VN</th>
                  <th class="col-nick"><v-icon size="13">mdi-cellphone</v-icon> Nick chăm</th>
                  <th class="col-kh"><v-icon size="13">mdi-account-outline</v-icon> Khách hàng</th>
                  <th class="col-phase">Loại sự kiện</th>
                  <th class="col-status">Chi tiết</th>
                  <th class="col-ago">Cách đây</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="ev in monitorFilteredEvents"
                  :key="ev.id"
                  :class="[{ 'is-new': ev.isNew }]"
                >
                  <td class="col-time">{{ ev.timeLabel }}</td>
                  <td class="col-nick">
                    <span class="nick-dot" :class="nickDotClass(ev.nickName)"></span>
                    <span class="nick-name">{{ ev.nickName || '—' }}</span>
                  </td>
                  <td class="col-kh">
                    <span v-if="ev.rowIndex != null" class="row-idx">#{{ ev.rowIndex }}</span>
                    <span class="kh-name">{{ ev.customerName || '—' }}</span>
                  </td>
                  <td class="col-phase">
                    <span class="phase-pill" :class="'phase-' + phaseTone(ev.type)">
                      <v-icon class="phase-ico" size="13">{{ phaseMdi(ev.type) }}</v-icon>
                      {{ phaseLabel(ev.type) }}
                    </span>
                  </td>
                  <td class="col-status">
                    <span class="detail-text">{{ detailText(ev) }}</span>
                  </td>
                  <td class="col-ago">{{ shortAgo(ev.at) }}</td>
                </tr>
                <tr v-if="monitorFilteredEvents.length === 0">
                  <td colspan="6" class="ev-empty-row">
                    {{ monitorEvents.length === 0
                      ? 'Chưa có sự kiện nào — feed sẽ xuất hiện ở đây khi worker chạy.'
                      : 'Không có sự kiện nào khớp bộ lọc — chọn "Tất cả" để xem hết.' }}
                  </td>
                </tr>
              </tbody>
            </table>
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
            <v-icon size="18" :color="nickHealthBanner.level === 'danger' ? '#f04438' : '#f5a524'">{{ nickHealthBanner.level === 'danger' ? 'mdi-alert-circle' : 'mdi-alert' }}</v-icon>
          </span>
          <div class="nhb-msg">
            <strong>{{ nickHealthBanner.text }}</strong>
          </div>
          <a href="#" class="nhb-link" @click.prevent="router.push('/settings/channels/zalo')">
            Mở Zalo Accounts <v-icon size="13">mdi-arrow-right</v-icon>
          </a>
        </div>

        <!-- ============ ETA BAR ============ -->
        <!-- Wave 4 2026-06-03 — P1 sequence-aware "Còn X KH":
             - isDone=true  → "✅ Đã xử lý hết KH"
             - hasBreakdown → "Còn N KH đang xử lý (M bám đuổi + K chờ gửi) ~ Y giờ"
             - fallback     → "Còn X KH ~ Y giờ" (BE cũ chưa rebuild) -->
        <div class="eta-bar">
          <span class="eta-icon">
            <v-icon size="16" :color="etaInfo.isDone ? '#12b76a' : 'var(--brand)'">{{ etaInfo.isDone ? 'mdi-check-circle' : 'mdi-clock-outline' }}</v-icon>
          </span>
          <span v-if="etaInfo.isDone">
            <strong>Đã xử lý hết KH</strong>
          </span>
          <span v-else-if="etaInfo.hasBreakdown">
            Còn <strong class="num">{{ formatNum(etaInfo.remaining) }} KH đang xử lý</strong>
            (<strong class="num">{{ formatNum(etaInfo.phase2Running) }}</strong> bám đuổi
            + <strong class="num">{{ formatNum(etaInfo.phase1Pending) }}</strong> chờ gửi)
            ~ <strong class="num">{{ etaInfo.daysText }}</strong>
          </span>
          <span v-else>
            Còn <strong class="num">{{ formatNum(etaInfo.remaining) }} KH</strong>
            ~ <strong class="num">{{ etaInfo.daysText }}</strong>
          </span>
          <span v-if="!etaInfo.isDone" class="eta-sep">·</span>
          <span v-if="!etaInfo.isDone">
            Dự kiến xong <strong>{{ etaInfo.finishLabel }}</strong>
          </span>
        </div>

        <!-- ============ M13: QUY TẮC GỬI AN TOÀN (read-only) ============ -->
        <!-- 7 tile từ trigger.safetyRules. concurrencyPerNickPerMinute ẩn (wizard B3 không expose). -->
        <!-- Fallback: nếu BE chưa rebuild (safetyRules undefined) → empty-state "Chưa cấu hình". -->
        <section class="safety-card" aria-label="Quy tắc gửi an toàn">
          <header class="safety-head">
            <h3><v-icon size="16">mdi-shield-check-outline</v-icon> Quy tắc gửi an toàn</h3>
            <button class="btn btn-sm" @click="onEdit"><v-icon size="14">mdi-pencil-outline</v-icon> Sửa</button>
          </header>
          <div v-if="data.trigger.safetyRules" class="safety-grid">
            <div class="safety-tile">
              <div class="st-icon"><v-icon size="18">mdi-clock-time-four-outline</v-icon></div>
              <div class="st-body">
                <div class="st-label">Giờ làm việc</div>
                <div class="st-value num">
                  {{ pad2(data.trigger.safetyRules.sendHourStart) }}:00 –
                  {{ pad2(data.trigger.safetyRules.sendHourEnd) }}:00
                </div>
                <div class="st-hint">Chỉ gửi trong khoảng giờ VN này</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon"><v-icon size="18">mdi-timer-outline</v-icon></div>
              <div class="st-body">
                <div class="st-label">Khoảng cách gửi</div>
                <div class="st-value num">
                  {{ Math.round(data.trigger.safetyRules.minFriendReqGapMs / 1000) }} giây
                </div>
                <div class="st-hint">Tối thiểu giữa 2 lời mời / nick</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon"><v-icon size="18">mdi-calendar-range-outline</v-icon></div>
              <div class="st-body">
                <div class="st-label">Lọc recency</div>
                <div class="st-value num">
                  {{ data.trigger.safetyRules.recencySkipDays === 0
                      ? 'Tắt'
                      : `${data.trigger.safetyRules.recencySkipDays} ngày` }}
                </div>
                <div class="st-hint">Bỏ KH vừa tương tác nick khác</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon"><v-icon size="18">mdi-account-group-outline</v-icon></div>
              <div class="st-body">
                <div class="st-label">Multi-nick threshold</div>
                <div class="st-value num">
                  {{ data.trigger.safetyRules.multiNickThreshold === 0
                      ? 'Tắt'
                      : `> ${data.trigger.safetyRules.multiNickThreshold} nick` }}
                </div>
                <div class="st-hint">Bỏ KH đã friend quá nhiều nick</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon"><v-icon size="18">mdi-handshake-outline</v-icon></div>
              <div class="st-body">
                <div class="st-label">Delay sau friend-request</div>
                <div class="st-value num">
                  {{ data.trigger.safetyRules.sequenceStartDelayMinutes }} phút
                </div>
                <div class="st-hint">Chờ trước khi bắt đầu chuỗi</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon"><v-icon size="18">mdi-pause-circle-outline</v-icon></div>
              <div class="st-body">
                <div class="st-label">Pause khi KH reply</div>
                <div class="st-value num">
                  {{ data.trigger.safetyRules.pauseOnActivityHours }} giờ
                </div>
                <div class="st-hint">Reset chuỗi khi KH có tương tác</div>
              </div>
            </div>
            <div class="safety-tile">
              <div class="st-icon"><v-icon size="18">mdi-lightning-bolt-outline</v-icon></div>
              <div class="st-body">
                <div class="st-label">Concurrency</div>
                <div class="st-value num">
                  {{ data.trigger.safetyRules.concurrencyPerNickPerMinute }} / phút / nick
                </div>
                <div class="st-hint">Trần xử lý song song mỗi nick</div>
              </div>
            </div>
          </div>
          <div v-else class="safety-empty">
            <span>Chưa cấu hình quy tắc gửi an toàn.</span>
            <a href="#" @click.prevent="onEdit">Mở wizard để thiết lập <v-icon size="13">mdi-arrow-right</v-icon></a>
          </div>
        </section>

        <!-- ============ 6 BIG STAT CARDS ============ -->
        <!-- Wave 4 2026-06-03 — P2 thêm 2 ô campaign-level sau "Đã xử lý":
             - ô 3: 🎯 Đang bám đuổi (enrollingSequence) — KH đang chăm sóc qua sequence
             - ô 4: ✅ Hoàn tất sequence (completedSequence) — KH đã xong toàn bộ chuỗi
             Grid 6 cột (HD-first 1366px): ~210px/card, gap 10px, vẫn dày đặc OK. -->
        <div class="stats-row">
          <div class="stat-card accent-blue">
            <div class="stat-label">Trong tệp</div>
            <div class="stat-value num">{{ formatNum(stats.total) }}</div>
            <div class="stat-hint">Tổng KH gốc nhập từ tệp</div>
          </div>
          <div class="stat-card accent-green">
            <div class="stat-label">Đã xử lý</div>
            <div class="stat-value num">{{ formatNum(stats.processed) }}</div>
            <div class="stat-hint">
              <span class="num">{{ pct(stats.processed, stats.total) }}%</span> — đã qua bước kiểm Zalo
            </div>
          </div>
          <div class="stat-card accent-orange">
            <div class="stat-label"><v-icon size="13">mdi-target</v-icon> Đang bám đuổi</div>
            <div class="stat-value num">{{ formatNum(stats.enrollingSequence) }}</div>
            <div class="stat-hint">KH đang chăm sóc qua sequence</div>
          </div>
          <div class="stat-card accent-teal">
            <div class="stat-label"><v-icon size="13">mdi-check-circle-outline</v-icon> Hoàn tất sequence</div>
            <div class="stat-value num">{{ formatNum(stats.completedSequence) }}</div>
            <div class="stat-hint">KH đã xong toàn bộ chuỗi</div>
          </div>
          <div class="stat-card accent-purple">
            <div class="stat-label">Có Zalo</div>
            <div class="stat-value num">{{ formatNum(stats.hasZalo) }}</div>
            <div class="stat-hint">
              <!-- FIX 2026-06-08 (Anh chốt): mẫu số CŨ là stats.processed (đã xử lý) → 30/7
                   = 428% vô lý. "Có Zalo" là tập con của TỔNG tệp, không phải của "đã xử lý"
                   → chia cho stats.total (30/30 = 100%). -->
              <span class="num">{{ pct(stats.hasZalo, stats.total) }}%</span> trong tổng tệp
            </div>
          </div>
          <div class="stat-card accent-red">
            <div class="stat-label">Không có Zalo</div>
            <div class="stat-value num">{{ formatNum(stats.noZalo) }}</div>
            <div class="stat-hint">Chuyển Lead Pool — gọi điện trực tiếp</div>
          </div>
        </div>

        <!-- ============ CTA RED BANNER ============ -->
        <div v-if="stats.noZalo > 0" class="cta-red">
          <span class="cta-bullet"><v-icon size="18" color="#f04438">mdi-phone-alert</v-icon></span>
          <div class="cta-msg">
            <strong>Không có Zalo (<span class="num">{{ formatNum(stats.noZalo) }}</span> KH)</strong>
            — gợi ý gọi điện qua Lead Pool, đừng để rơi rớt
          </div>
          <a href="#" class="cta-link" @click.prevent="goLeadPool">Xem danh sách <v-icon size="13">mdi-arrow-right</v-icon></a>
        </div>

        <!-- ============ 2-COL PHASE ============ -->
        <div class="phase-row">
          <div class="phase-card">
            <h3><v-icon size="15">mdi-send-outline</v-icon> Phase 1: Mời kết bạn</h3>
            <div class="mini-grid">
              <div class="mini-card blue">
                <div class="mini-value num">{{ formatNum(phase1.sent) }}</div>
                <div class="mini-label">Đã gửi</div>
              </div>
              <div class="mini-card green">
                <div class="mini-value num">{{ formatNum(phase1.accepted) }}</div>
                <div class="mini-label">Đồng ý</div>
              </div>
              <div class="mini-card red">
                <div class="mini-value num">{{ formatNum(phase1.rejected) }}</div>
                <div class="mini-label">Từ chối</div>
              </div>
              <div class="mini-card orange">
                <div class="mini-value num">{{ formatNum(phase1.pending) }}</div>
                <div class="mini-label">Đang chờ</div>
              </div>
            </div>
          </div>

          <div class="phase-card">
            <h3>
              <v-icon size="15">mdi-email-fast-outline</v-icon> Phase 2: Bám đuổi
              <span class="phase-hint">(stranger inbox — gửi luôn không chờ accept)</span>
            </h3>
            <div class="mini-grid">
              <div class="mini-card blue">
                <div class="mini-value num">{{ formatNum(phase2.welcome) }}</div>
                <div class="mini-label">Welcome</div>
              </div>
              <div class="mini-card green">
                <div class="mini-value num">{{ formatNum(phase2.running) }}</div>
                <div class="mini-label">Đang chạy</div>
              </div>
              <div class="mini-card">
                <div class="mini-value num">{{ formatNum(phase2.done) }}</div>
                <div class="mini-label">Hoàn tất</div>
              </div>
              <div class="mini-card red">
                <div class="mini-value num">{{ formatNum(phase2.stopped) }}</div>
                <div class="mini-label">Dừng</div>
              </div>
            </div>
            <div class="phase-sub">
              <span class="sub-pill"><v-icon size="13" color="#f04438">mdi-hand-back-right-off-outline</v-icon> <strong class="num">{{ formatNum(phase2.reply) }}</strong> KH reply</span>
              <span class="sub-pill"><v-icon size="13" color="#6b7488">mdi-cancel</v-icon> <strong class="num">{{ formatNum(phase2.block) }}</strong> KH block</span>
              <span class="sub-pill"><v-icon size="13" color="#6554c0">mdi-diamond-stone</v-icon> <strong class="num">{{ formatNum(phase2.lead) }}</strong> KH đã thành Lead</span>
            </div>
          </div>
        </div>

        <!-- ============ NICK PERFORMANCE TABLE ============ -->
        <div class="section">
          <div class="section-head">
            <h3><v-icon size="16">mdi-target</v-icon> Hiệu quả theo nick</h3>
            <div class="head-hint">
              <span class="num">{{ data.nicks.length }}</span> nick đang chạy · sort theo % Accept
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 28%;">Nick</th>
                <th class="num">Gửi <v-icon class="sort-arrow" size="13">mdi-unfold-more-horizontal</v-icon></th>
                <th class="num">Đồng ý <v-icon class="sort-arrow" size="13">mdi-unfold-more-horizontal</v-icon></th>
                <th class="sorted">
                  % Accept <v-icon class="sort-arrow" size="13">mdi-menu-down</v-icon>
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
                    class="pct num"
                    :class="n.acceptPct >= 10 ? 'hi' : n.acceptPct < 5 ? 'lo' : ''"
                  >
                    {{ n.acceptPct.toFixed(1) }}%
                  </span>
                  <v-icon v-if="i === 0 && nicksByAccept.length > 1" class="medal" size="14" color="#d4a017">mdi-medal</v-icon>
                  <v-icon v-else-if="i === nicksByAccept.length - 1 && nicksByAccept.length > 2" class="medal" size="14" color="#b87333">mdi-medal-outline</v-icon>
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
              <v-icon size="16">mdi-account-group-outline</v-icon> Khách hàng
              <span class="entry-breakdown">
                <span class="eb-pill eb-done" title="Đã gửi lời mời & có kết quả (xong chuỗi / reply / block / lead)">
                  <span class="num">{{ formatNum(entryBreakdown.daChay) }}</span> đã chạy
                </span>
                <span class="eb-pill eb-running" title="Nick đang gửi lời mời HOẶC KH đang trong chuỗi bám đuổi">
                  <span class="num">{{ formatNum(entryBreakdown.dangChay) }}</span> đang chạy
                </span>
                <span class="eb-pill eb-pending" title="KH đang chờ tới lượt nick gửi lời mời">
                  <span class="num">{{ formatNum(entryBreakdown.sapChay) }}</span> sắp chạy
                </span>
                <span v-if="entryBreakdown.noZalo > 0" class="eb-pill eb-nozalo" title="KH không có tài khoản Zalo">
                  <span class="num">{{ formatNum(entryBreakdown.noZalo) }}</span> không Zalo
                </span>
              </span>
            </h3>
            <div class="head-actions">
              <button class="btn btn-sm" @click="exportEntries"><v-icon size="14">mdi-tray-arrow-up</v-icon> Xuất Excel</button>
              <button class="btn btn-sm" disabled title="Defer Wave 4"><v-icon size="14">mdi-cog-outline</v-icon> Cột hiển thị</button>
            </div>
          </div>

          <!-- filter bar -->
          <div class="filter-bar">
            <div class="search-wrap">
              <v-icon class="search-icon" size="16">mdi-magnify</v-icon>
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
                {{ chip.label }} <span class="count num">{{ formatNum(chip.count) }}</span>
              </span>
            </div>
          </div>

          <table class="entries-table">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th class="col-kh">KH <v-icon class="sort-arrow" size="13">mdi-unfold-more-horizontal</v-icon></th>
                <th class="col-phone">SĐT</th>
                <th class="col-nickpin">Nick PIN</th>
                <th class="col-step">Bước hiện tại</th>
                <th class="col-status">Trạng thái</th>
                <th class="col-update sorted">
                  Lần gửi gần nhất <v-icon class="sort-arrow" size="13">mdi-menu-down</v-icon>
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
                <td class="col-num num">{{ e.rowIndex ?? i + 1 }}</td>
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
                        <v-icon size="11">{{ e.dedup === 'merged' ? 'mdi-link-variant' : 'mdi-star-four-points-outline' }}</v-icon>
                        {{ e.dedup === 'merged' ? 'Gộp KH cũ' : 'KH mới' }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="col-phone num">{{ e.phone }}</td>
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
                  <!-- 2026-06-04 — Anh chốt 2 dòng: D1 = x/y tiến độ chuỗi có màu
                       (3/3 xanh lá+Hoàn tất / đang gửi vàng / KH reply giữa chừng đỏ),
                       D2 = trạng thái kết bạn Phase 1 (Đang chờ KB / Đã kết bạn...). -->
                  <div class="step-cell">
                    <div class="step-line1" :class="stepProgressClass(e)">{{ stepProgressLabel(e) }}</div>
                    <div class="step-line2">{{ phase1Label(e) }}</div>
                  </div>
                </td>
                <td>
                  <!-- Phase Friend Invite UI 2026-05-30 — ưu tiên derivedStatus (5 enum)
                       BE shape; fallback queueStatus cho payload cũ chưa có derivedStatus. -->
                  <span class="estatus" :class="entryStatusClass(e)">
                    {{ entryStatusLabel(e) }}
                  </span>
                </td>
                <td class="col-update">
                  <!-- ĐÃ GỬI (tin đã tới khách) — icon ✅ + bước + mốc giờ -->
                  <div v-if="e.lastSentAt" class="send-cell">
                    <div class="send-l1 send-sent">
                      <span class="send-ico"><v-icon size="13">mdi-check-circle</v-icon> Đã gửi</span>
                      <span v-if="lastSentInfo(e).stepLabel" class="send-step">{{ lastSentInfo(e).stepLabel }}</span>
                    </div>
                    <div class="send-l2 num">{{ lastSentInfo(e).label }}</div>
                  </div>
                  <span v-else class="muted">—</span>
                </td>
                <td class="col-next">
                  <!-- ĐÃ HẸN (chưa gửi) / Đến hạn / Đã xong -->
                  <div v-if="nextRunInfo(e).isDue" class="send-cell">
                    <div class="send-l1 send-due" title="Tới giờ chạy nhưng đang chờ pickup">
                      <span class="send-ico"><v-icon size="13">mdi-alert-circle</v-icon> Đến hạn</span>
                      <span v-if="nextRunInfo(e).stepLabel" class="send-step">{{ nextRunInfo(e).stepLabel }}</span>
                    </div>
                  </div>
                  <div v-else-if="nextRunInfo(e).icon === 'scheduled'" class="send-cell">
                    <div class="send-l1 send-scheduled">
                      <span class="send-ico"><v-icon size="13">mdi-timer-sand</v-icon> Đã hẹn</span>
                      <span v-if="nextRunInfo(e).stepLabel" class="send-step">{{ nextRunInfo(e).stepLabel }}</span>
                    </div>
                    <div class="send-l2 num">{{ nextRunInfo(e).label }}</div>
                  </div>
                  <div v-else-if="nextRunInfo(e).icon === 'done'" class="send-cell">
                    <div class="send-l1 send-done">{{ nextRunInfo(e).label }}</div>
                  </div>
                  <span v-else class="muted">{{ nextRunInfo(e).label }}</span>
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
              <strong class="num">{{ data.entriesOffset + 1 }}-{{ Math.min(data.entriesOffset + data.entries.length, data.entriesTotal) }}</strong>
              trong <strong class="num">{{ formatNum(data.entriesTotal) }}</strong> KH
            </div>
            <div class="page-nav">
              <button class="page-btn" :disabled="data.entriesOffset === 0" @click="prevPage"><v-icon size="16">mdi-chevron-left</v-icon></button>
              <button class="page-btn active num">{{ currentPage }}</button>
              <button class="page-btn" :disabled="!hasNextPage" @click="nextPage"><v-icon size="16">mdi-chevron-right</v-icon></button>
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
              <v-icon size="16">mdi-history</v-icon> Lịch sử đầy đủ
              <span class="head-hint-inline">
                <span class="num">{{ formatNum(logTotal) }}</span> sự kiện · lưu 90 ngày · Giờ VN (UTC+7)
              </span>
            </h3>
            <div class="log-head-actions">
              <button class="btn btn-sm" @click="exportCsv"><v-icon size="14">mdi-tray-arrow-down</v-icon> Xuất Excel</button>
            </div>
          </div>

          <!-- Filter bar — 1 hàng (Anh chốt 2026-06-03 — gọn, responsive wrap)
               4 element cơ bản: range chip + search + select loại + reset.
               Bỏ KH/Nick dropdown riêng (search cover) + custom date (4 preset đủ) +
               11 chip row 2 (gộp vào select Loại). -->
          <div class="filter-bar filter-bar-single">
            <div class="range-btns">
              <button
                v-for="r in RANGE_OPTIONS"
                :key="r.key"
                class="range-btn"
                :class="{ active: logRange === r.key }"
                @click="setLogRange(r.key)"
              >
                {{ r.label }}
              </button>
            </div>

            <input
              v-model="logFilter.q"
              type="text"
              class="filter-input filter-input-search"
              placeholder="Tìm tên KH, SĐT, nick, mã tin nhắn…"
            />

            <select v-model="logFilter.type" class="filter-select filter-select-type">
              <option
                v-for="chip in logTypeChips"
                :key="chip.key"
                :value="chip.key"
              >
                {{ chip.label }} ({{ formatNum(chip.count) }})
              </option>
            </select>

            <button class="filter-reset" @click="resetLogFilter" title="Đặt lại lọc"><v-icon size="16">mdi-restore</v-icon></button>
          </div>

          <div class="ev-table-wrap">
            <table class="ev-table log-table">
              <thead>
                <tr>
                  <th class="col-check">
                    <input
                      type="checkbox"
                      :checked="selectAllLog"
                      @change="toggleSelectAllLog"
                    />
                  </th>
                  <th class="col-time"><v-icon size="13">mdi-clock-outline</v-icon> Thời gian</th>
                  <th class="col-nick"><v-icon size="13">mdi-cellphone</v-icon> Nick chăm</th>
                  <th class="col-kh"><v-icon size="13">mdi-account-outline</v-icon> Khách hàng</th>
                  <th class="col-phase">Loại sự kiện</th>
                  <th class="col-status">Trạng thái</th>
                  <th class="col-detail"><v-icon size="13">mdi-note-text-outline</v-icon> Chi tiết</th>
                  <th class="col-action"><v-icon size="13">mdi-cog-outline</v-icon></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="ev in logEvents"
                  :key="ev.id"
                  :class="{ selected: selectedLogIds.includes(ev.id) }"
                >
                  <td class="col-check">
                    <input
                      type="checkbox"
                      :checked="selectedLogIds.includes(ev.id)"
                      @change="toggleLogRow(ev.id)"
                    />
                  </td>
                  <td class="col-time">
                    <!-- 2026-06-04 — bỏ dòng 2 "X giờ trước" (shortAgo) cho gọn, chỉ giữ ngày giờ -->
                    <div class="time-main num">{{ formatLogTime(ev.at) }}</div>
                  </td>
                  <td class="col-nick">
                    <span class="nick-dot" :class="nickDotClass(ev.nickName)"></span>
                    <span class="nick-name">{{ ev.nickName || '—' }}</span>
                  </td>
                  <td class="col-kh">
                    <span v-if="ev.rowIndex != null" class="row-idx">#{{ ev.rowIndex }}</span>
                    <span class="kh-name">{{ ev.customerName || '—' }}</span>
                  </td>
                  <td class="col-phase">
                    <span class="phase-pill" :class="'phase-' + phaseTone(ev.type)">
                      <v-icon class="phase-ico" size="13">{{ phaseMdi(ev.type) }}</v-icon>
                      {{ phaseLabel(ev.type) }}
                    </span>
                  </td>
                  <td class="col-status">
                    <span class="estatus" :class="logStatusClass(ev)">
                      {{ logStatusLabel(ev) }}
                    </span>
                  </td>
                  <td class="col-detail">
                    <span class="detail-text">{{ detailText(ev, true) }}</span>
                  </td>
                  <td class="col-action">
                    <button
                      class="icon-btn"
                      title="Mở hồ sơ KH / chat"
                      @click="jumpToConv(ev)"
                    >
                      <v-icon size="16">mdi-open-in-new</v-icon>
                    </button>
                  </td>
                </tr>
                <tr v-if="logEvents.length === 0 && !logLoading">
                  <td colspan="8" class="ev-empty-row">
                    Chưa có sự kiện nào trong khoảng lọc
                  </td>
                </tr>
                <tr v-if="logLoading">
                  <td colspan="8" class="ev-empty-row">Đang tải sự kiện...</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pagination">
            <div>
              Hiển thị
              <strong class="num">{{ logEvents.length === 0 ? 0 : (logPage - 1) * LOG_PAGE_SIZE + 1 }}-{{ Math.min(logPage * LOG_PAGE_SIZE, logTotal) }}</strong>
              trong <strong class="num">{{ formatNum(logTotal) }}</strong> sự kiện
              · <span class="num">{{ LOG_PAGE_SIZE }}</span>/trang
            </div>
            <div class="page-nav">
              <button class="page-btn" :disabled="logPage === 1" @click="logPage--; loadLog()"><v-icon size="16">mdi-chevron-left</v-icon></button>
              <button class="page-btn active num">{{ logPage }}</button>
              <button
                class="page-btn"
                :disabled="logPage * LOG_PAGE_SIZE >= logTotal"
                @click="logPage++; loadLog()"
              >
                <v-icon size="16">mdi-chevron-right</v-icon>
              </button>
            </div>
          </div>
        </div>

        <!-- Bulk action bar — sticky bottom khi có row chọn -->
        <div v-if="selectedLogIds.length > 0" class="bulk-bar">
          <span class="count-pill"><span class="num">{{ selectedLogIds.length }}</span> đã chọn</span>
          <span class="bulk-label">Hành động hàng loạt:</span>
          <button class="bulk-btn" @click="exportSelected"><v-icon size="14">mdi-tray-arrow-down</v-icon> Xuất Excel</button>
          <button class="bulk-btn" @click="markReviewed"><v-icon size="14">mdi-check</v-icon> Đánh dấu đã xem</button>
          <button class="bulk-btn" @click="copySelectedIds"><v-icon size="14">mdi-content-copy</v-icon> Sao chép</button>
          <span class="filter-spacer"></span>
          <button class="bulk-btn bulk-btn-ghost" @click="selectedLogIds = []">Bỏ chọn</button>
        </div>
      </div>

      <!-- ============ STICKY BOTTOM HINT ============ -->
      <div class="sticky-hint">
        <div class="sticky-hint-inner">
          <span class="hint-emoji"><v-icon size="14" color="#f5a524">mdi-lightbulb-on-outline</v-icon></span>
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
import { useMucTieuSocket, type FriendInviteClaimedPayload } from '@/composables/use-muc-tieu-socket';

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
  // I5 2026-06-03 — cờ pause per-contact (Redis) cho cột Trạng thái + đếm ngược.
  pauseRemainingMs?: number | null;
  pauseReason?: string | null;
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
  // I6 2026-06-03 — detail + metadata cho detailText() dựng chi tiết cụ thể.
  detail?: unknown;
  metadata?: unknown;
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
  // I6 2026-06-03 — metadata cho detailText() chi tiết.
  metadata?: unknown;
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

// ── Sprint v3 (2026-06-03) — Monitor filter + sound toggle ──
// Chip filter 6 nhóm: tất cả / KH cần cứu / Lead / KH trả lời / Chặn / T+23h.
// Sound toggle: localStorage per user, mặc định tắt. 3 âm Web Audio sin/sin/vuông.
type MonitorFilter = 'all' | 'rescue' | 'lead' | 'reply' | 'block' | 't23h';
const monitorFilter = ref<MonitorFilter>('all');
const soundEnabled = ref<boolean>(
  (typeof localStorage !== 'undefined' && localStorage.getItem('mt:monitor:sound') === '1') || false,
);

function toggleSound(): void {
  soundEnabled.value = !soundEnabled.value;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('mt:monitor:sound', soundEnabled.value ? '1' : '0');
  }
  if (soundEnabled.value) {
    // Demo âm khi bật để Anh nghe
    playTone('vui');
  }
}

// Web Audio runtime: KHÔNG cần file mp3, sinh sóng sin/vuông tại runtime.
let audioCtx: AudioContext | null = null;
function playTone(kind: 'vui' | 'nhac' | 'canh'): void {
  if (!soundEnabled.value) return;
  if (typeof window === 'undefined' || typeof (window as any).AudioContext === 'undefined') return;
  try {
    if (!audioCtx) audioCtx = new ((window as any).AudioContext)();
    const ctx = audioCtx!;
    if (kind === 'canh') {
      // "Tịt-tịt" 2 lần, sóng vuông 220Hz
      [0, 130].forEach((delayMs) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 220;
        gain.gain.value = 0.25;
        osc.connect(gain).connect(ctx.destination);
        const start = ctx.currentTime + delayMs / 1000;
        osc.start(start);
        osc.stop(start + 0.1);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = kind === 'vui' ? 880 : 440;
      gain.gain.value = 0.3;
      osc.connect(gain).connect(ctx.destination);
      const start = ctx.currentTime;
      osc.start(start);
      osc.stop(start + (kind === 'vui' ? 0.2 : 0.25));
    }
  } catch {
    // Ignore audio errors (browser autoplay restriction)
  }
}

// Phân loại P0/P1 event để filter + sound
function eventClass(type: string): MonitorFilter[] {
  const cl: MonitorFilter[] = ['all'];
  if (type === 'customer_reply') cl.push('reply');
  if (type === 'converted_lead') cl.push('lead');
  if (type === 'customer_block' || type === 'welcome_blocked' || type === 'customer_block_detected_on_invite') {
    cl.push('block');
  }
  if (type === 'nick_hold_reset' || type === 'campaign_timeout') cl.push('rescue', 't23h');
  if (type === 'notification_sent') cl.push('t23h');
  if (type === 'nick_disconnected') cl.push('rescue');
  return cl;
}

// Filter chip count
const monitorFilteredEvents = computed(() => {
  if (monitorFilter.value === 'all') return monitorEvents.value;
  return monitorEvents.value.filter((ev) => eventClass(ev.type).includes(monitorFilter.value));
});

const monitorChipCounts = computed(() => {
  const counts: Record<MonitorFilter, number> = {
    all: monitorEvents.value.length,
    rescue: 0, lead: 0, reply: 0, block: 0, t23h: 0,
  };
  for (const ev of monitorEvents.value) {
    for (const c of eventClass(ev.type)) {
      if (c !== 'all') counts[c]++;
    }
  }
  return counts;
});

// Menu
const menuOpen = ref(false);
const menuWrapRef = ref<HTMLDivElement | null>(null);

// Log tab
const LOG_PAGE_SIZE = 50;
const logEvents = ref<LogEvent[]>([]);
const logTotal = ref(0);
const logPage = ref(1);
const logLoading = ref(false);
const logFilter = ref<{
  type: string;
  from: string;
  to: string;
  q: string;
  khId: string;
  nickId: string;
}>({
  type: 'all',
  from: isoNDaysAgo(7),
  to: todayIso(),
  q: '',
  khId: '',
  nickId: '',
});

// Option B v2 2026-06-03 — range preset chips (24h / 7 ngày / 30 ngày / Tất cả).
// Bỏ 'custom' (date input rườm rà) — 4 preset đủ dùng theo Anh chốt.
type LogRangeKey = '24h' | '7d' | '30d' | 'all';
const RANGE_OPTIONS: { key: LogRangeKey; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: 'all', label: 'Tất cả' },
];
const logRange = ref<LogRangeKey>('7d');

// Bulk select 2026-06-03 — checkbox state Log table.
const selectedLogIds = ref<string[]>([]);

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
    if (cd) return `Đang dừng (${cd})`;
  }
  return 'Đang dừng';
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
  // Wave 4 2026-06-03 — P2 campaign-level (sequence bám đuổi).
  // BE trả `enrollingSequence` + `completedSequence` qua spread counters. Fallback 0
  // khi BE chưa rebuild (deploy lệch FE/BE).
  const enrollingSequence = c.enrollingSequence ?? 0;
  const completedSequence = c.completedSequence ?? 0;
  return {
    total,
    processed: Math.min(processed, total),
    hasZalo,
    noZalo,
    enrollingSequence,
    completedSequence,
  };
});

// FIX 2026-06-08 (Anh chốt): header "Khách hàng" CŨ hiện "(hasZalo đang chạy + noZalo
// không Zalo)" — SAI: hasZalo = total - noZalo = 30 cố định, KHÔNG đổi dù poll 5s →
// trông như "30 đang chạy" đứng im, không realtime, không khớp Log sự kiện.
// Đúng phải tách 3 nhóm theo trạng thái queue THẬT (poll 5s tự cập nhật):
//   - Sắp chạy  = queued_for_pickup (KH chờ tới lượt nick gửi lời mời)
//   - Đang chạy = processing (nick đang gửi) + enrollingSequence (đang bám đuổi chuỗi)
//   - Đã chạy   = đã qua bước gửi & có kết quả (xong chuỗi / reply / block / lead / accepted)
//   - Không Zalo = noZalo (tách riêng, không tính vào 3 nhóm trên)
const entryBreakdown = computed(() => {
  const c = data.value?.counters ?? {};
  const sapChay = c.queued_for_pickup ?? 0;
  const dangChay = (c.processing ?? 0) + (c.enrollingSequence ?? 0);
  const noZalo = stats.value.noZalo;
  // Đã chạy = tổng - sắp - đang - noZalo (suy ngược để luôn khớp tổng, tránh đếm trùng
  // giữa các nguồn event chồng lấn). Clamp ≥ 0.
  const daChay = Math.max(0, stats.value.total - sapChay - dangChay - noZalo);
  return { daChay, dangChay, sapChay, noZalo };
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
  const running = c.enrollingSequence ?? c.in_sequence ?? c.processing ?? 0;
  // FIX 2026-06-04: "Hoàn tất" = completedSequence (BE đếm distinct KH đã gửi bước
  // cuối). Trước đây đọc key sai (sequence_completed/completed không tồn tại) → luôn 0
  // dù KH đã gửi đủ 3/3.
  const done = c.completedSequence ?? c.sequence_completed ?? c.completed ?? 0;
  const reply = c.customer_reply ?? c.replied ?? 0;
  const block = c.customer_block ?? c.blocked ?? 0;
  const lead = c.converted_lead ?? 0;
  // FIX 2026-06-04: "Dừng" CHỈ gồm KH chặn nick (block) — tín hiệu chấm dứt thật.
  // Trước đây gom cả reply (tạm dừng, tín hiệu TỐT) + lead (đã thành Lead = hoàn tất
  // đẹp) vào "Dừng" → "Dừng=2" sai. reply + lead tách riêng, KHÔNG tính là dừng.
  const stopped = block;
  return { welcome, running, done, stopped, reply, block, lead };
});

// Wave 4 2026-06-03 — P1 fix counter "Còn X KH" semantic.
// BE giờ trả `stillRunning` = phase1 (queued_for_pickup + processing) + phase2
// (campaign state='active'). Đây là số KH thực sự ĐANG trong workflow (gửi friend-req
// HOẶC bám đuổi sequence). Trước đây dùng (total - processed) → khi tất cả entry
// đều processed nhưng campaign vẫn active → "Còn 0 KH" SAI. Giờ split rõ:
//   - phase1Pending = stillRunningPhase1 (chờ gửi)
//   - phase2Running = enrollingSequence (bám đuổi)
//   - remaining     = stillRunning (tổng 2 phase)
// Fallback (BE chưa rebuild): trả về (total - processed) như cũ.
const etaInfo = computed(() => {
  const c = data.value?.counters ?? {};
  const total = stats.value.total;
  const processed = stats.value.processed;
  const phase1Pending = c.stillRunningPhase1 ?? 0;
  const phase2Running = c.enrollingSequence ?? 0;
  const beStillRunning = c.stillRunning;
  const remaining =
    typeof beStillRunning === 'number'
      ? beStillRunning
      : Math.max(0, total - processed);
  // BE may expose etaSeconds / etaDays — fall back to crude estimate
  const etaDays = c.eta_days ?? estimateDays(remaining, data.value?.nicks ?? []);
  const finish = new Date(Date.now() + etaDays * 86400000);
  // "Còn N KH đang xử lý (M bám đuổi + K chờ gửi)" — chỉ render khi có data phân tách.
  const hasBreakdown =
    typeof beStillRunning === 'number' && (phase1Pending > 0 || phase2Running > 0);
  return {
    remaining,
    phase1Pending,
    phase2Running,
    hasBreakdown,
    isDone: remaining === 0,
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
    { key: 'running', label: 'Đang chạy',          count: c.processing ?? 0 },
    { key: 'done',    label: 'Hoàn tất',           count: c.completed ?? 0 },
    { key: 'reply',   label: 'KH reply',           count: c.customer_reply ?? phase2.value.reply },
    { key: 'block',   label: 'KH block',           count: c.customer_block ?? phase2.value.block },
    { key: 'lead',    label: 'Lead',               count: c.converted_lead ?? phase2.value.lead },
    {
      key: 'cho-crm',
      label: 'Chờ CRM',
      count: c.waitingCrm ?? c.accepted ?? 0,
      tooltip: 'KH đã đồng ý kết bạn nhưng chưa có sale tiếp nhận trong CRM',
    },
    { key: 'no-zalo', label: 'Không có Zalo',      count: stats.value.noZalo },
  ];
});

// Log tab chips — Option B (2026-06-03): 11 chip (Tất cả + 10 phase type).
// Counts derive từ logEvents page hiện tại (FE-only). Khi BE /events trả
// facets.typeCounts thì swap sang facets (follow-up).
const logTypeChips = computed<{ key: string; label: string; count: number }[]>(() => {
  const all = logEvents.value;
  const countBy = (t: string) => all.filter((ev) => ev.type === t).length;
  return [
    { key: 'all',                label: 'Tất cả',            count: all.length },
    { key: 'follow_up',          label: 'Bám đuổi',          count: countBy('follow_up') },
    { key: 'welcome',            label: 'Welcome',           count: countBy('welcome') },
    { key: 'friend_request',     label: 'Mời kết bạn',       count: countBy('friend_request') },
    { key: 'friend_accepted',    label: 'KH chấp nhận',      count: countBy('friend_accepted') },
    { key: 'customer_reply',     label: 'KH trả lời',        count: countBy('customer_reply') },
    { key: 'reaction_positive',  label: 'Reaction',          count: countBy('reaction_positive') + countBy('reaction_negative') },
    { key: 'skipped',            label: 'Bỏ qua',            count: countBy('skipped') },
    { key: 'warning',            label: 'Lỗi',               count: countBy('warning') },
    { key: 'customer_block',     label: 'Chặn',              count: countBy('customer_block') },
    { key: 'converted_lead',     label: 'Chuyển lead',       count: countBy('converted_lead') },
  ];
});

// Bulk select helpers — selectAll = mọi row trên page hiện tại đều selected.
const selectAllLog = computed<boolean>(() => {
  if (logEvents.value.length === 0) return false;
  return logEvents.value.every((ev) => selectedLogIds.value.includes(ev.id));
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
      router.push('/marketing/triggers');
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
  void router.push(`/marketing/triggers/tao-moi?edit=${encodeURIComponent(triggerId)}`);
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
        detail?: unknown;
        metadata?: unknown;
      }>;
      mergeEvents(
        fresh.map((ev) => ({
          id: ev.id,
          at: ev.at,
          type: ev.type,
          timeLabel: dmyhms(ev.at),
          icon: ev.icon ?? '',
          text: ev.text ?? '',
          tone: ev.tone ?? null,
          // Fix #3b (2026-06-02) — map 3 field BE đã trả về (trước đây bị drop).
          nickName: ev.nickName ?? null,
          customerName: ev.customerName ?? null,
          rowIndex: ev.rowIndex ?? null,
          // I6 2026-06-03 — detail + metadata cho detailText() dựng chi tiết "Gửi bước 2/4".
          detail: ev.detail ?? null,
          metadata: ev.metadata ?? null,
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

  // ── Sprint v3 (2026-06-03) — Play sound theo phân loại event ──
  // 3 âm: vui (tin vui) / nhac (nhắc nhở) / canh (cảnh báo).
  for (const ev of fresh) {
    if (ev.type === 'friend_accepted' || ev.type === 'customer_reply' || ev.type === 'converted_lead') {
      playTone('vui');
      break; // chỉ play 1 lần per merge
    }
    if (ev.type === 'notification_sent' || ev.type === 'nick_hold_reset') {
      playTone('nhac');
      break;
    }
    if (ev.type === 'customer_block' || ev.type === 'welcome_blocked' || ev.type === 'sequence_step_failed' || ev.type === 'campaign_timeout') {
      playTone('canh');
      break;
    }
  }
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
        // Option B 2026-06-03 — 2 dropdown filter mới. BE chưa hỗ trợ thì sẽ ignore.
        khId: logFilter.value.khId || undefined,
        nickId: logFilter.value.nickId || undefined,
        limit: LOG_PAGE_SIZE,
        offset: (logPage.value - 1) * LOG_PAGE_SIZE,
      },
    });
    let events: LogEvent[] = r.data?.events ?? [];
    // FE fallback filter khi BE chưa hỗ trợ khId / nickId (so theo customerName / nickName).
    if (logFilter.value.khId) {
      events = events.filter((ev) => ev.customerName === logFilter.value.khId);
    }
    if (logFilter.value.nickId) {
      events = events.filter((ev) => ev.nickName === logFilter.value.nickId);
    }
    logEvents.value = events;
    logTotal.value = r.data?.total ?? events.length;
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
  () => [
    logFilter.value.type,
    logFilter.value.from,
    logFilter.value.to,
    logFilter.value.q,
    logFilter.value.khId,
    logFilter.value.nickId,
  ],
  () => {
    logPage.value = 1;
    selectedLogIds.value = [];
    if (currentTab.value === 'log') void loadLog();
  },
);

// Option B v2 (2026-06-03) — range preset → set from/to. Chỉ 4 preset.
function setLogRange(key: LogRangeKey): void {
  logRange.value = key;
  if (key === '24h') {
    logFilter.value.from = todayIso();
    logFilter.value.to = todayIso();
  } else if (key === '7d') {
    logFilter.value.from = isoNDaysAgo(7);
    logFilter.value.to = todayIso();
  } else if (key === '30d') {
    logFilter.value.from = isoNDaysAgo(30);
    logFilter.value.to = todayIso();
  } else if (key === 'all') {
    logFilter.value.from = '';
    logFilter.value.to = '';
  }
}
function resetLogFilter(): void {
  logRange.value = '7d';
  logFilter.value = {
    type: 'all',
    from: isoNDaysAgo(7),
    to: todayIso(),
    q: '',
    khId: '',
    nickId: '',
  };
  selectedLogIds.value = [];
}

function toggleSelectAllLog(): void {
  if (selectAllLog.value) {
    // Đang full-select page → bỏ chọn hết page
    const pageIds = new Set(logEvents.value.map((ev) => ev.id));
    selectedLogIds.value = selectedLogIds.value.filter((id) => !pageIds.has(id));
  } else {
    // Add tất cả id của page hiện tại (giữ các id ngoài page nếu có).
    const merged = new Set(selectedLogIds.value);
    for (const ev of logEvents.value) merged.add(ev.id);
    selectedLogIds.value = Array.from(merged);
  }
}
function toggleLogRow(id: string): void {
  const i = selectedLogIds.value.indexOf(id);
  if (i >= 0) selectedLogIds.value.splice(i, 1);
  else selectedLogIds.value.push(id);
}
function exportSelected(): void {
  // Wave 4 follow-up — BE endpoint chưa có. Tạm: dùng exportCsv() để xuất full filter.
  exportCsv();
}
function markReviewed(): void {
  // Stub UI — chờ BE bổ sung trường `reviewed` trên EventLog.
  console.warn('[muc-tieu-detail] markReviewed stub — BE chưa có endpoint', selectedLogIds.value);
  alert('Tính năng "Đánh dấu đã xem" sẽ bật khi BE bổ sung trường reviewed.');
}
function copySelectedIds(): void {
  const ids = selectedLogIds.value.join('\n');
  if (!ids) return;
  void navigator.clipboard?.writeText(ids).catch(() => {
    /* clipboard có thể bị deny — silent fail. */
  });
}
function jumpToConv(ev: LogEvent): void {
  // Cố gắng deep-link sang /chat. LogEvent chưa expose contactId/conversationId, fallback
  // route /marketing/triggers (giữ user trên cùng page) cho tới khi BE bổ sung.
  if (!ev.customerName) return;
  void router.push({ path: '/chat', query: { q: ev.customerName } });
}

// ===================================================================
// ============ HELPERS ==============================================
// ===================================================================

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    draft: 'Nháp',
    active: 'Đang chạy',
    paused: 'Tạm dừng',
    cancelling: 'Đang huỷ',
    cancelled: 'Đã huỷ',
    completed: 'Hoàn tất',
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
  // FIX 2026-06-08 — clamp [0,100]: trước đây num/denom với mẫu sai (vd 30/7) ra 428%
  // vô lý. Tỷ lệ phần trăm KHÔNG bao giờ vượt 100; clamp để phòng mọi caller mẫu lệch.
  const p = (a / b) * 100;
  return Math.min(100, Math.max(0, p)).toFixed(1);
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
// I1 2026-06-03 — Cột Trạng thái CHỈ lo Phase 2 (chuỗi bám đuổi). Anh chốt 7 nhãn,
// 2 nhóm gốc: tạm dừng (chạy lại) vs dừng hẳn. KH Reply + KH Block + Không có Zalo
// giữ nhãn RIÊNG cho sale dễ thấy. Phase 1 (Chưa/Đã kết bạn) đã chuyển sang cột
// "Bước hiện tại" → ở đây hiện '—'.
function entryStatusLabel(e: Entry): string {
  const ds = e.derivedStatus ?? null;
  const qs = e.queueStatus;

  // Nhãn RIÊNG ưu tiên cao (signal mạnh, đọc từ queueStatus).
  if (qs === 'customer_block') return 'KH Block';
  if (qs === 'skipped_no_zalo' || e.hasZalo === false) return 'Không có Zalo';

  // Pause flag (Redis): KH Reply (nhãn riêng) vs Tạm dừng (reaction/manual/nick-hold).
  // pauseRemainingMs > 0 = đang tạm dừng sẽ chạy lại → đếm ngược ở pauseCountdown().
  if (e.pauseRemainingMs && e.pauseRemainingMs > 0) {
    if (e.pauseReason === 'customer_reply' || qs === 'customer_reply') {
      return `KH Reply ${pauseCountdown(e)}`;
    }
    return `Tạm dừng ${pauseCountdown(e)}`;
  }
  if (qs === 'customer_reply') return 'KH Reply';

  // Phase 1 → cột Bước hiện tại lo, cột Trạng thái để '—'.
  if (ds === 'pending_friend' || ds === 'phase1_done') return '—';

  if (ds === 'in_sequence') {
    const cur = e.currentStepIdx ?? 0;
    const total = e.sequenceTotalSteps ?? data.value?.trigger.successorSequence?.stepsCount ?? 0;
    if (total > 0) return `Bám đuổi (${cur + 1}/${total})`;
    return 'Bám đuổi';
  }
  if (ds === 'sequence_done' || qs === 'converted_lead') return 'Hoàn tất';
  if (ds === 'stopped') return 'Dừng';
  // Fallback cũ (payload không có derivedStatus)
  return statusChipLabel(e.queueStatus, e.hasZalo);
}

function entryStatusClass(e: Entry): string {
  const ds = e.derivedStatus ?? null;
  const qs = e.queueStatus;
  if (qs === 'customer_block') return 'block';
  if (qs === 'skipped_no_zalo' || e.hasZalo === false) return 'no-zalo';
  if (e.pauseRemainingMs && e.pauseRemainingMs > 0) {
    return (e.pauseReason === 'customer_reply' || qs === 'customer_reply') ? 'reply' : 'paused';
  }
  if (qs === 'customer_reply') return 'reply';
  if (ds === 'pending_friend' || ds === 'phase1_done') return 'muted';
  if (ds === 'in_sequence') return 'in-seq';
  if (ds === 'sequence_done' || qs === 'converted_lead') return 'done';
  if (ds === 'stopped') return 'reply';
  return statusChipClass(e.queueStatus, e.hasZalo);
}

// I5 2026-06-03 — đếm ngược "còn Xh Ym" cho nhãn tạm dừng từ pauseRemainingMs (BE).
function pauseCountdown(e: Entry): string {
  const ms = e.pauseRemainingMs ?? 0;
  if (ms <= 0) return '';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `(còn ${h}h${m > 0 ? ` ${m}m` : ''})`;
  return `(còn ${m}m)`;
}

// Tính cột "Lần gửi tiếp theo" — null=—; future=relative; past+pending → Đến hạn.
// dd/MM HH:mm (bỏ năm, bỏ giây — gọn cho cột hẹp). Reuse formatInOrgTz rồi strip /yyyy.
function dmHm(iso: string | null | undefined): string {
  if (!iso) return '—';
  const full = formatInOrgTz(iso, undefined, {}); // dd/MM/yyyy HH:mm
  if (full === '—') return '—';
  return full.replace(/^(\d{2}\/\d{2})\/\d{4} /, '$1 ');
}

// 2026-06-04 (Anh chốt) — Tổng số bước của chuỗi cho 1 entry.
function totalStepsOf(e: Entry): number {
  return e.sequenceTotalSteps ?? data.value?.trigger.successorSequence?.stepsCount ?? 0;
}

// ════════════════════════════════════════════════════════════════════════
// 2026-06-04 — Anh chốt: phân biệt rõ "ĐÃ HẸN" vs "ĐÃ GỬI" trong bảng Khách hàng.
//
// Kiến trúc dữ liệu (BE friend-invite-routes.ts):
//   • currentStepIdx + nextRunAt = bước SẮP GỬI, đang nằm CHỜ trong queue (ĐÃ HẸN).
//   • lastSentAt = thời điểm bước ĐÃ GỬI gần nhất (event sequence_step_sent).
//   • Lazy chain: gửi xong bước N → mới hẹn bước N+1. Nên bước vừa gửi = currentStepIdx - 1.
// ════════════════════════════════════════════════════════════════════════

// Cột "Lần gửi gần nhất" — bước ĐÃ GỬI thật (tin đã tới khách). icon ✅.
function lastSentInfo(e: Entry): { label: string; stepLabel: string | null; muted: boolean } {
  if (!e.lastSentAt) return { label: '—', stepLabel: null, muted: true };
  const total = totalStepsOf(e);
  // Bước vừa gửi = currentStepIdx - 1 (vì đã hẹn bước currentStepIdx kế tiếp).
  // Nếu không còn currentStepIdx (chuỗi xong) → bước cuối = total.
  let sentStep: number | null = null;
  if (e.currentStepIdx !== null && e.currentStepIdx !== undefined && e.currentStepIdx > 0) {
    sentStep = e.currentStepIdx; // bước vừa gửi (1-based) = idx (vì idx kế = currentStepIdx, 0-based)
  } else if (e.derivedStatus === 'sequence_done' && total) {
    sentStep = total;
  }
  const stepLabel = sentStep && total ? `Bước ${sentStep}/${total}` : null;
  return {
    label: formatInOrgTz(e.lastSentAt, undefined, { withSeconds: true }),
    stepLabel,
    muted: false,
  };
}

// Cột "Lần gửi tiếp theo" — bước ĐÃ HẸN (chưa gửi) / Đến hạn / Đã xong.
function nextRunInfo(e: Entry): {
  label: string;
  stepLabel: string | null;
  icon: string;
  isDue: boolean;
  muted: boolean;
} {
  const total = totalStepsOf(e);
  // 2026-06-04 — Anh chốt: KH hoàn tất chuỗi (không còn bước nào) → "Đã xong"
  // thay vì "—" (trống trông như lỗi). sequence_done = đã gửi hết bước cuối.
  if (e.derivedStatus === 'sequence_done') {
    return { label: 'Đã xong', stepLabel: null, icon: 'done', isDue: false, muted: true };
  }
  const iso = e.nextRunAt ?? null;
  if (!iso) {
    // Không còn job kế tiếp + đã gửi ít nhất 1 bước → coi như xong chuỗi.
    if (e.lastSentAt) return { label: 'Đã xong', stepLabel: null, icon: 'done', isDue: false, muted: true };
    return { label: '—', stepLabel: null, icon: '', isDue: false, muted: true };
  }
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return { label: '—', stepLabel: null, icon: '', isDue: false, muted: true };
  // Bước đã hẹn = currentStepIdx (0-based) → hiển thị 1-based = idx+1.
  const nextStep =
    e.currentStepIdx !== null && e.currentStepIdx !== undefined ? e.currentStepIdx + 1 : null;
  const stepLabel = nextStep && total ? `Bước ${nextStep}/${total}` : null;
  const diff = ts - Date.now();
  // Past + entry chưa hoàn tất → "Đến hạn" badge đỏ (đã tới giờ nhưng chờ pickup).
  if (diff <= 0) {
    const ds = e.derivedStatus ?? null;
    const pending =
      ds === 'pending_friend' || ds === 'phase1_done' || ds === 'in_sequence' ||
      (ds == null && e.queueStatus !== 'completed' && e.queueStatus !== 'processed');
    if (pending) return { label: 'Đến hạn', stepLabel, icon: 'due', isDue: true, muted: false };
    return { label: '—', stepLabel: null, icon: '', isDue: false, muted: true };
  }
  // ĐÃ HẸN (chưa tới giờ) — icon scheduled + mốc giờ dd/MM HH:mm.
  return { label: dmHm(iso), stepLabel, icon: 'scheduled', isDue: false, muted: false };
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
  if (qs === 'processing') return 'Đang chạy';
  if (qs === 'completed' || qs === 'processed') return 'Hoàn tất';
  if (qs === 'customer_reply') return 'KH reply';
  if (qs === 'customer_block') return 'KH block';
  if (qs === 'converted_lead') return 'Đã thành Lead';
  if (qs === 'accepted' || qs === 'queued_for_pickup') return 'Chờ CRM';
  if (qs === 'skipped_no_zalo' || hasZalo === false) return 'Không có Zalo';
  return qs ?? '—';
}

// ════════════════════════════════════════════════════════════════════════
// 2026-06-04 — Cột "Bước hiện tại" 2 dòng (Anh chốt)
// ════════════════════════════════════════════════════════════════════════
// DÒNG 1 — tiến độ chuỗi x/y + màu:
//   • Đã gửi đủ y/y  → "y/y ✅ Hoàn tất"  (xanh lá)
//   • KH reply giữa chừng (chưa đủ) → "x/y" (đỏ)
//   • Đang gửi dở     → "x/y" (vàng)
//   • Chưa vào chuỗi  → "0/y" (xám) hoặc "—" nếu no-zalo
function stepProgressLabel(e: Entry): string {
  const total = e.sequenceTotalSteps ?? data.value?.trigger.successorSequence?.stepsCount ?? 0;
  if (e.queueStatus === 'skipped_no_zalo' || e.hasZalo === false) return '—';
  // Hoàn tất: BE trả derivedStatus='sequence_done' HOẶC đã gửi bước cuối.
  if (e.derivedStatus === 'sequence_done') {
    return total ? `${total}/${total} Hoàn tất` : 'Hoàn tất';
  }
  // Đang trong chuỗi: currentStepIdx 0-based → bước hiện tại = idx+1.
  if (e.currentStepIdx !== null && e.currentStepIdx !== undefined) {
    return total ? `${e.currentStepIdx + 1}/${total}` : `${e.currentStepIdx + 1}`;
  }
  // Chưa có bước nào (mới kết bạn, chưa vào chuỗi).
  return total ? `0/${total}` : '—';
}

// Màu dòng 1 theo trạng thái tiến độ.
function stepProgressClass(e: Entry): string {
  if (e.queueStatus === 'skipped_no_zalo' || e.hasZalo === false) return 'step-muted';
  if (e.derivedStatus === 'sequence_done') return 'step-done';   // xanh lá
  // KH reply / pause giữa chừng → đỏ (đang dở mà KH tương tác/dừng).
  if (e.queueStatus === 'customer_reply' || (e.pauseRemainingMs && e.pauseRemainingMs > 0)) {
    return 'step-reply'; // đỏ
  }
  if (e.currentStepIdx !== null && e.currentStepIdx !== undefined) return 'step-sending'; // vàng (đang gửi)
  return 'step-muted';
}

// DÒNG 2 — trạng thái kết bạn Phase 1.
function phase1Label(e: Entry): string {
  if (e.queueStatus === 'skipped_no_zalo' || e.hasZalo === false) return 'Không có Zalo';
  const ds = e.derivedStatus ?? null;
  if (ds === 'pending_friend') {
    if (e.queueStatus === 'processed') return 'Đã gửi · chờ duyệt';
    return 'Đang chờ kết bạn';
  }
  // phase1_done / in_sequence / sequence_done → đều đã kết bạn (hoặc đã là bạn / stranger).
  if (ds === 'phase1_done' || ds === 'in_sequence' || ds === 'sequence_done') return 'Đã kết bạn';
  if (e.queueStatus === 'processed') return 'Đã kết bạn';
  return 'Đang chờ kết bạn';
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
// stepDots() REMOVED 2026-06-04 — cột "Bước hiện tại" đổi sang 2 dòng text
// (stepProgressLabel + phase1Label), không còn dùng chuỗi chấm tròn.

function formatDate(iso: string): string {
  return formatInOrgTz(iso);
}
// hhmmss() REMOVED 2026-06-04 — thay bằng dmyhms (Monitor cần có ngày).
// 2026-06-04 — Monitor cột Giờ: Anh yêu cầu có NGÀY. Dùng giờ VN org-tz, dạng gọn
// dd/MM HH:mm:ss (cột hẹp, không cần năm). formatInOrgTz cho full dd/MM/yyyy → cắt năm.
function dmyhms(iso: string): string {
  const full = formatInOrgTz(iso, undefined, { withSeconds: true }); // dd/MM/yyyy HH:mm:ss
  if (full === '—') return '—';
  // "03/06/2026 13:59:49" → "03/06 13:59:49"
  return full.replace(/^(\d{2}\/\d{2})\/\d{4} /, '$1 ');
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
function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (k: number): string => String(k).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 2026-06-03 — typePillClass/typePillLabel REMOVED. Option B dùng phase-pill (5 tone)
// thay cho 10 type-pill class cũ (.t-kb / .t-wel / .t-bd / ...). Style cũ .type-pill
// vẫn còn trong CSS dùng cho các page khác (chưa migration) nên giữ class CSS.

// ===================================================================
// ============ OPTION B (2026-06-03) — phase + nick dot + ago =======
// I6 2026-06-03 — Dựng câu CHI TIẾT cụ thể cho cột "Chi tiết" (Anh chốt: Monitor gọn,
// Log chi tiết hơn). Đọc metadata BE trả (stepIdx/totalSteps, channel, ...) để hiện
// "Gửi bước 2/4" thay vì "Bám đuổi" cụt. verbose=true (Log) → kèm text thô từ detail.
function detailText(ev: { type: string; detail?: unknown; metadata?: unknown }, verbose = false): string {
  const md = (ev.metadata && typeof ev.metadata === 'object' ? ev.metadata : {}) as Record<string, unknown>;
  const rawDetail = typeof ev.detail === 'string' ? ev.detail : '';
  const stepIdx = typeof md.stepIdx === 'number' ? md.stepIdx : null;
  const totalSteps = typeof md.totalSteps === 'number' ? md.totalSteps : null;
  const channel = typeof md.channel === 'string' ? md.channel : null;
  const restartCycle = typeof md.restartCycle === 'number' ? md.restartCycle : null;

  let base = '';
  switch (ev.type) {
    case 'sequence_step_sent':
    case 'follow_up':
      base = stepIdx != null && totalSteps != null
        ? `Gửi bước ${stepIdx + 1}/${totalSteps} — luồng chăm sóc`
        : 'Gửi bước chăm sóc';
      break;
    case 'sequence_step_enqueued':
      base = stepIdx != null && totalSteps != null
        ? `Lên lịch bước ${stepIdx + 1}/${totalSteps}`
        : 'Lên lịch bước tiếp theo';
      break;
    case 'sequence_done':
      base = totalSteps != null ? `Hoàn tất luồng (${totalSteps}/${totalSteps} bước)` : 'Hoàn tất luồng chăm sóc';
      break;
    case 'friend_request':
    case 'friend_request_sent':
      base = 'Gửi lời mời kết bạn';
      break;
    case 'friend_accepted':
      base = 'KH đồng ý kết bạn';
      break;
    case 'friend_already':
      base = 'KH đã là bạn (vào luôn bám đuổi)';
      break;
    case 'welcome_sent':
    case 'welcome_message_sent':
      base = channel === 'stranger_inbox'
        ? 'Gửi tin chào (hộp người lạ)'
        : channel === 'friend_msg'
          ? 'Gửi tin chào (đã là bạn)'
          : 'Gửi tin chào mừng';
      break;
    case 'welcome_blocked':
      base = 'KH chặn tin chào (hộp người lạ)';
      break;
    case 'customer_reply':
      base = rawDetail ? `KH trả lời: "${rawDetail.slice(0, 50)}${rawDetail.length > 50 ? '…' : ''}"` : 'KH trả lời';
      break;
    case 'customer_block':
      base = 'KH chặn nick — dừng chăm sóc';
      break;
    case 'customer_reaction_positive':
    case 'reaction_positive':
      base = `KH thả cảm xúc tích cực${rawDetail ? ` ${rawDetail}` : ''}`;
      break;
    case 'customer_reaction_negative':
    case 'reaction_negative':
      base = `KH thả cảm xúc tiêu cực${rawDetail ? ` ${rawDetail}` : ''} — tạm dừng 48h`;
      break;
    case 'converted_lead':
      base = 'KH chuyển thành Lead';
      break;
    case 'nick_hold_reset':
      base = restartCycle != null
        ? `Reset hàng đợi (nick offline >24h, vòng ${restartCycle})`
        : 'Reset hàng đợi (nick offline >24h)';
      break;
    case 'campaign_timeout':
      base = 'Mục tiêu hết hạn (worker không advance)';
      break;
    case 'no_zalo':
      base = 'SĐT không có Zalo — gọi điện';
      break;
    case 'send_error':
      base = rawDetail ? `Lỗi gửi: ${rawDetail.slice(0, 60)}` : 'Lỗi gửi kết bạn';
      break;
    default:
      base = rawDetail || phaseLabel(ev.type);
  }
  // Log (verbose) kèm text thô nếu khác base — để tra cứu đầy đủ.
  if (verbose && rawDetail && !base.includes(rawDetail.slice(0, 20))) {
    return `${base} · ${rawDetail}`;
  }
  return base;
}

// ===================================================================
// 5 phase tone map (success/info/warn/danger/neutral) cho .phase-pill.
// Đồng nhất Monitor + Log: cùng emoji + label tiếng Việt.
function phaseTone(type: string): string {
  if (!type) return 'neutral';
  if (
    type === 'friend_request' ||
    type === 'friend_request_sent' ||
    type === 'friend_accepted' ||
    type === 'friend_already' ||
    type === 'welcome' ||
    type === 'welcome_sent' ||
    type === 'follow_up' ||
    type === 'sequence_step_sent' ||
    type === 'sequence_done' ||
    type === 'nick_reconnected' ||
    type === 'nick_resumed'
  ) return 'success';
  if (type === 'customer_reply' || type === 'converted_lead') return 'info';
  if (type === 'reaction_positive') return 'success';
  if (type === 'reaction_negative') return 'danger';
  if (type === 'customer_block' || type === 'nick_hold_reset' || type === 'campaign_timeout') return 'danger';
  if (type === 'warning' || type.startsWith('failed_') || type === 'nick_disconnected' || type === 'notification_sent') return 'warn';
  if (type === 'skipped' || type.startsWith('skipped_')) return 'neutral';
  return 'neutral';
}
// Phase label tiếng Việt — short, dùng trong pill 12px (KHÔNG có icon, icon riêng).
function phaseLabel(type: string): string {
  const map: Record<string, string> = {
    friend_request: 'Mời kết bạn',
    friend_request_sent: 'Mời kết bạn',
    friend_accepted: 'KH chấp nhận',
    friend_already: 'Đã là bạn',
    welcome: 'Welcome',
    welcome_sent: 'Welcome',
    follow_up: 'Bám đuổi',
    sequence_step_sent: 'Bám đuổi',
    sequence_done: 'Hoàn tất',
    customer_reply: 'KH trả lời',
    customer_block: 'Chặn',
    converted_lead: 'Chuyển lead',
    nick_disconnected: 'Nick ngắt',
    nick_resumed: 'Nick chạy tiếp',
    // ── Sprint v3 (2026-06-03) — Sticky 24h Hold events ──
    nick_reconnected: 'Nick hồi tỉnh',
    nick_hold_reset: 'Reset 24h',
    notification_sent: 'Đã báo nội bộ',
    campaign_timeout: 'Hết hạn',
    soft_fail_escalated: 'Soft fail',
    zalo_check: 'Kiểm Zalo',
    reaction_positive: 'Reaction +',
    reaction_negative: 'Reaction -',
    warning: 'Cảnh báo',
    skipped: 'Bỏ qua',
    skipped_no_zalo: 'Bỏ qua: no-Zalo',
    skipped_recency: 'Bỏ qua: recency',
    failed_send: 'Lỗi gửi',
  };
  return map[type] ?? type;
}
// Phase icon (mdi) dùng chung Monitor + Log phase-pill. Map event type → mdi name.
function phaseMdi(type: string): string {
  const map: Record<string, string> = {
    friend_request: 'mdi-send-outline',
    friend_request_sent: 'mdi-send-outline',
    friend_accepted: 'mdi-handshake-outline',
    friend_already: 'mdi-handshake-outline',
    welcome: 'mdi-hand-wave-outline',
    welcome_sent: 'mdi-hand-wave-outline',
    follow_up: 'mdi-email-outline',
    sequence_step_sent: 'mdi-email-outline',
    sequence_done: 'mdi-star-outline',
    customer_reply: 'mdi-message-text-outline',
    customer_block: 'mdi-cancel',
    converted_lead: 'mdi-diamond-stone',
    nick_disconnected: 'mdi-access-point-network-off',
    nick_resumed: 'mdi-refresh',
    // ── Sprint v3 (2026-06-03) — Sticky 24h Hold icons ──
    nick_reconnected: 'mdi-check-circle-outline',
    nick_hold_reset: 'mdi-clock-alert-outline',
    notification_sent: 'mdi-bell-outline',
    campaign_timeout: 'mdi-alert-octagon-outline',
    soft_fail_escalated: 'mdi-alert-outline',
    zalo_check: 'mdi-magnify',
    reaction_positive: 'mdi-heart-outline',
    reaction_negative: 'mdi-emoticon-angry-outline',
    warning: 'mdi-alert-outline',
    skipped: 'mdi-skip-next-outline',
    skipped_no_zalo: 'mdi-skip-next-outline',
    skipped_recency: 'mdi-skip-next-outline',
    failed_send: 'mdi-alert-outline',
  };
  return map[type] ?? 'mdi-circle-small';
}
// Nick dot color — stable hash của nick name modulo 3 → n1/n2/n3 (blue/purple/orange).
function nickDotClass(name: string | null | undefined): string {
  if (!name) return 'n0';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xff;
  return ['n1', 'n2', 'n3'][h % 3];
}
// Short ago label — "5s", "2 phút", "1 giờ", "3 ngày" (compact, KHÔNG có chữ "trước").
function shortAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} giây`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ`;
  const day = Math.floor(hr / 24);
  return `${day} ngày`;
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
    success: 'Thành công',
    reply: 'Dừng cho KH',
    block: 'Dừng cho nick',
    lead: 'Đã thành Lead',
    paused: 'Tạm dừng',
    failed: 'Lỗi',
  };
  return map[ev.status ?? ''] ?? 'Thành công';
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

// Sprint v3 Tuần 3 Row 2.2 (2026-06-03): listen socket realtime cho event
// "friend-invite:claimed" — surface UI ngay khi nick pick KH (đỡ phải chờ poll 5s).
// Filter theo triggerId để bỏ qua claim của Mục tiêu khác cùng org.
const _escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
useMucTieuSocket((payload: FriendInviteClaimedPayload) => {
  if (payload.triggerId !== triggerId) return;
  const isoAt = payload.claimedAt;
  const liveEv: LiveEvent = {
    id: `claimed-${payload.entryId}-${Date.now()}`,
    at: isoAt,
    timeLabel: dmyhms(isoAt),
    type: 'friend_sent',
    icon: '',
    text: `Nick <b>${_escHtml(payload.nickName)}</b> -> <b>${_escHtml(payload.contactName)}</b> (#${payload.rowIndex})`,
    tone: null,
    isNew: true,
    nickName: payload.nickName,
    customerName: payload.contactName,
    rowIndex: payload.rowIndex,
  };
  mergeEvents([liveEv]);
});

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
  /* HS re-skin 2026-06-05 — map token scoped sang HS Holding (tên giữ nguyên,
     scoped trong .mtd-page). State machine + template giữ nguyên. */
  --bg-page: var(--surface-2, #f7f9fc);
  --bg-card: var(--surface, #ffffff);
  --bg-soft: var(--surface-3, #f1f4f9);
  --bg-hover: var(--brand-softer, #f2f8fc);
  --border: var(--line, #e7eaf0);
  --border-strong: #cdd4e0;
  --text-1: var(--ink, #141a24);
  --text-2: var(--ink-2, #475066);
  --text-3: var(--ink-3, #6b7488);
  --text-mute: var(--ink-4, #97a0b3);
  /* brand HS metallic blue (thay #1786be Atlassian) */
  --primary: var(--brand, #1786be);
  --primary-hover: var(--brand-600, #0f6fa0);
  --primary-bg: var(--brand-soft, #e4f1f8);
  --success: var(--success, #12b76a);
  --success-bg: var(--success-soft, #e7f7ef);
  --warning: var(--warning, #f5a524);
  --warning-bg: var(--warning-soft, #fdf3e2);
  --danger: var(--error, #f04438);
  --danger-bg: #fdeceb;
  --purple: #6554c0;
  --purple-bg: #eae6ff;
  --shadow-1: 0 1px 2px rgba(20, 26, 36, 0.05);
  --shadow-2: 0 4px 12px rgba(20, 26, 36, 0.12);

  /* 2026-06-04 v2 — Khi nằm trong BotAutoShell, layout đã có sidebar 240px.
     Bỏ min-width: 1280px (gây crop), max-width: 1920px (không cần),
     dùng padding chuẩn --at-s-lg cho consistent với BlocksView. */
  background: var(--bg-page);
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.45;
  min-height: 100%;
  padding: var(--at-s-lg, 24px);
  width: 100%;
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
  border-color: var(--primary, #1786be);
  color: var(--primary, #1786be);
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
.status .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.status.s-active { background: var(--success-bg); color: #157f3c; }
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
.estatus.running { background: var(--success-bg); color: #157f3c; }
.estatus.done { background: var(--primary-bg); color: var(--primary); }
.estatus.reply { background: var(--danger-bg); color: var(--danger); }
.estatus.block { background: #eceef1; color: #42526e; }
.estatus.lead { background: var(--purple-bg); color: var(--purple); }
.estatus.cho-crm { background: var(--warning-bg); color: #974f00; }
.estatus.no-zalo { background: #ffebe6; color: var(--danger); }
/* I5 2026-06-03 — 🔶 Tạm dừng (chạy lại) tông cam nổi bật, phân biệt với 🛑 Dừng hẳn (đỏ) */
.estatus.paused { background: var(--warning-bg); color: #974f00; font-weight: 600; }
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
  color: #157f3c;
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
/* Option B (2026-06-03) — Monitor + Log dùng chung .ev-table (bảng compact 1 dòng).
   Drop hẳn .mon-row grid 3-col cũ. Dùng <table> để sale scan như Excel. */
.ev-table-wrap {
  background: white;
  overflow-x: auto;
}
.mon-table-wrap {
  /* Sprint v3 (2026-06-03) — Anh chốt câu 3: 320px (gọn hơn 420 ban đầu) */
  max-height: 320px;
  overflow-y: auto;
}

/* ── Sprint v3 (2026-06-03) — Monitor chip filter row ── */
.monitor-filter-row {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: #fafafa;
  flex-wrap: wrap;
}
.mon-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px;
  border-radius: 12px;
  font-size: 11px; font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: white;
  color: var(--text-2);
  transition: all 0.15s;
}
.mon-chip:hover { background: var(--bg-soft); }
.mon-chip.active {
  background: #2d7ff9;
  border-color: #2d7ff9;
  color: white;
}
.mon-chip-count {
  display: inline-block;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(0,0,0,0.08);
  font-weight: 600;
  font-size: 10px;
}
.mon-chip.active .mon-chip-count {
  background: rgba(255,255,255,0.25);
}
.sound-toggle {
  margin-left: auto;
  padding: 3px 9px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: white;
  cursor: pointer;
  color: var(--text-2);
}
.sound-toggle.on { background: #fff7e6; border-color: #fad08a; color: #b8740b; }
.sound-toggle:hover { background: var(--bg-soft); }
.ev-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  color: var(--text-1);
  background: white;
}
.ev-table thead th {
  position: sticky;
  top: 0;
  background: var(--bg-soft);
  border-bottom: 1px solid var(--border);
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-3);
  text-align: left;
  white-space: nowrap;
  z-index: 1;
}
.ev-table tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  font-size: 13px;
  line-height: 1.35;
}
.ev-table tbody tr { transition: background 0.12s; }
.ev-table tbody tr:hover { background: var(--bg-hover); }
.ev-table tbody tr.selected { background: #eff6ff; }
.ev-table tbody tr.is-new { animation: slideInTop 400ms ease-out; }
@keyframes slideInTop {
  from { opacity: 0; transform: translateY(-8px); background: var(--success-bg); }
  to   { opacity: 1; transform: translateY(0); }
}
.ev-empty-row {
  padding: 28px 14px !important;
  color: var(--text-3);
  font-style: italic;
  text-align: center;
  font-size: 12px;
}

/* Monitor table column widths */
.mon-table .col-time   { width: 108px; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--text-2); font-size: 12px; }
.mon-table .col-phase  { width: 152px; }
.mon-table .col-kh     { width: 200px; }
.mon-table .col-nick   { width: 152px; }
.mon-table .col-status { min-width: 240px; }
.mon-table .col-ago    { width: 76px; text-align: right; color: var(--text-mute); font-size: 11px; }

/* Phase pill — 5 màu (success/info/warn/danger/neutral) */
.phase-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
}
.phase-pill .phase-ico { font-size: 12px; line-height: 1; }
.phase-pill.phase-success { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
.phase-pill.phase-info    { background: #e4f1f8; color: #0b5880; border-color: #9fcfe7; }
.phase-pill.phase-warn    { background: #fef3c7; color: #b45309; border-color: #fde68a; }
.phase-pill.phase-danger  { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
.phase-pill.phase-neutral { background: #f3f4f6; color: #4b5563; border-color: #e5e7eb; }

/* Row idx pill — "#3" badge nhỏ trước tên KH */
.row-idx {
  display: inline-block;
  min-width: 22px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-soft);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  margin-right: 6px;
  font-variant-numeric: tabular-nums;
}
.kh-name { font-weight: 500; color: var(--text-1); }

/* Nick dot — màu hash theo nick name (3 màu cycle) */
.nick-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--text-mute);
  margin-right: 6px;
  vertical-align: middle;
}
.nick-dot.n1 { background: #1786be; }
.nick-dot.n2 { background: #9333ea; }
.nick-dot.n3 { background: #f59e0b; }
.nick-dot.n0 { background: var(--text-mute); }
.nick-name { color: var(--text-2); font-size: 12px; }

/* Tone chip — Monitor "Trạng thái" cell, dùng ev.tone (stop/block/lead/warn/info) */
.tone-chip {
  display: inline;
  font-size: 13px;
  color: var(--text-1);
}
.tone-chip.tone-stop  { color: var(--danger); }
.tone-chip.tone-block { color: var(--text-2); }
.tone-chip.tone-lead  { color: var(--purple); font-weight: 600; }
.tone-chip.tone-warn  { color: var(--warning); }
.tone-chip.tone-info  { color: var(--text-1); }
.tone-chip :deep(b), .tone-chip b { font-weight: 600; color: var(--text-1); }

/* eta */
.eta-bar {
  margin-top: 10px;
  background: linear-gradient(90deg, #e4f1f8 0%, #f4f5f7 100%);
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

/* stats — Wave 4 2026-06-03 grid 4→6 cột (HD-first 1366px: ~210px/card). */
.stats-row {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
}
.stat-card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  box-shadow: var(--shadow-1);
  min-width: 0;
}
.stat-card .stat-label {
  font-size: 11px; font-weight: 600; color: var(--text-3);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat-card .stat-value {
  font-size: 22px; font-weight: 700; color: var(--text-1);
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.stat-card .stat-hint { font-size: 11px; color: var(--text-3); margin-top: 4px; }
.stat-card.accent-blue { border-top: 3px solid var(--primary); }
.stat-card.accent-green { border-top: 3px solid var(--success); }
.stat-card.accent-purple { border-top: 3px solid var(--purple); }
.stat-card.accent-red { border-top: 3px solid var(--danger); }
/* Wave 4 2026-06-03 — orange (đang bám đuổi) + teal (hoàn tất sequence). */
.stat-card.accent-orange { border-top: 3px solid var(--warning); }
.stat-card.accent-teal { border-top: 3px solid #00b8d9; }

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
  color: #157f3c;
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

/* FIX 2026-06-08 — header "Khách hàng" breakdown 3 nhóm realtime (Đã/Đang/Sắp chạy)
   thay "(30 đang chạy)" tĩnh cũ. Pill nhỏ, màu phân biệt trạng thái, poll 5s tự đổi. */
.entry-breakdown { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; flex-wrap: wrap; }
.eb-pill {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 500; line-height: 1.2;
  padding: 2px 9px; border-radius: 999px;
  border: 1px solid transparent;
}
.eb-pill .num { font-weight: 700; font-variant-numeric: tabular-nums; }
.eb-done    { background: #e7f7ef; color: #1b6b46; border-color: #86efac; }  /* xanh lá — đã chạy */
.eb-running { background: #e4f1f8; color: #0b5880; border-color: #93c5fd; }  /* xanh dương — đang chạy */
.eb-pending { background: #f1f4f9; color: #475066; border-color: #cdd4e0; }  /* xám — sắp chạy */
.eb-nozalo  { background: #fdeceb; color: #b42318; border-color: #fca5a5; }  /* đỏ — không Zalo */
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
/* Palette HS đa sắc cho avatar (nền nhạt token + chữ đậm cùng tông) — đồng bộ MucTieuListView */
.avatar.a2 { background: var(--warning-soft); color: #b45309; }
.avatar.a3 { background: var(--success-soft); color: #157f3c; }
.avatar.a4 { background: var(--chip-blue-bg); color: #1565c0; }
.avatar.a5 { background: var(--chip-purple-bg); color: #6d28d9; }
.avatar.a6 { background: var(--warning-soft); color: #b45309; }
.nick-name { font-weight: 600; color: var(--text-1); }
.nick-pin-name { font-size: 12px; color: var(--text-2); }

.num { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--text-1); }
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
.entries-table .col-update { width: 150px; color: var(--text-3); }
.entries-table .col-next { width: 150px; color: var(--text-3); }

/* ════════════════════════════════════════════════════════════════════
   2026-06-04 (Anh chốt) — Cột "Lần gửi gần nhất" + "Lần gửi tiếp theo"
   phân biệt rõ ĐÃ GỬI (✅ tin đã tới khách) vs ĐÃ HẸN (⏳ chờ tới giờ).
   2 dòng: D1 = nhãn trạng thái + bước, D2 = mốc giờ.
   ════════════════════════════════════════════════════════════════════ */
.send-cell { display: flex; flex-direction: column; gap: 2px; line-height: 1.25; }
.send-l1 {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 11.5px; font-weight: 600; white-space: nowrap;
}
.send-l2 { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.send-step {
  font-size: 10.5px; font-weight: 600; color: var(--text-2);
  background: var(--bg-soft); border-radius: 4px; padding: 0 5px;
}
.send-ico { white-space: nowrap; }
/* Màu trạng thái: đã gửi = xanh lá, đã hẹn = xanh dương, đến hạn = đỏ, đã xong = xám. */
.send-sent .send-ico, .send-sent { color: #0a8f3c; }
.send-scheduled .send-ico { color: #0f6fa0; }
.send-due .send-ico { color: #d32f2f; }
.send-done { color: var(--text-mute); font-size: 12px; }

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
/* 2026-06-04 — Cột "Bước hiện tại" 2 dòng (Anh chốt). step-dots/step-bar cũ bỏ. */
.step-cell { display: flex; flex-direction: column; gap: 2px; line-height: 1.3; }
.step-line1 { font-size: 13px; font-weight: 700; }
.step-line1.step-done    { color: var(--success); }          /* 3/3 xanh lá */
.step-line1.step-sending { color: #b7791f; }                 /* đang gửi vàng */
.step-line1.step-reply   { color: var(--danger); }           /* KH reply giữa chừng đỏ */
.step-line1.step-muted   { color: var(--text-3); font-weight: 500; }
.step-line2 { font-size: 11px; color: var(--text-3); }

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
/* Option B v2 (2026-06-03) — Filter bar 1 hàng responsive
   4 element: range chip + search + dropdown Loại + reset. Wrap khi <1100px. */
.filter-bar {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: white;
}
.filter-bar-single {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.filter-input,
.filter-select {
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-1);
  background: white;
}
.filter-input:focus,
.filter-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(45, 127, 249, 0.15);
}
.filter-input-search {
  flex: 1 1 240px;
  min-width: 200px;
  max-width: 360px;
}
.filter-select-type {
  flex: 0 0 auto;
  min-width: 200px;
  max-width: 260px;
  cursor: pointer;
}
.filter-reset {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  padding: 0;
  background: white;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-2);
  cursor: pointer;
  margin-left: auto;
}
.filter-reset:hover { background: var(--bg-soft); border-color: var(--text-3); color: var(--text-1); }
@media (max-width: 1100px) {
  .filter-input-search { max-width: none; }
  .filter-reset { margin-left: 0; }
}

/* Range preset buttons (24h / 7 ngày / 30 ngày / Tất cả / Tự chọn) */
.range-btns {
  display: inline-flex;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}
.range-btn {
  padding: 5px 12px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.range-btn:hover { background: white; color: var(--text-1); }
.range-btn.active {
  background: white;
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
}

/* Log table — 8 cột Option B */
.log-table .col-check  { width: 32px; padding: 6px 8px; }
.log-table .col-check input[type="checkbox"] { cursor: pointer; }
.log-table .col-time   { width: 130px; font-variant-numeric: tabular-nums; }
.log-table .col-time .time-main { color: var(--text-2); font-size: 12px; }
.log-table .col-time .time-rel  { color: var(--text-mute); font-size: 10px; margin-top: 1px; }
.log-table .col-phase  { width: 152px; }
.log-table .col-kh     { width: 200px; }
.log-table .col-nick   { width: 152px; }
.log-table .col-status { width: 140px; }
.log-table .col-detail { min-width: 220px; color: var(--text-2); font-size: 12px; }
.log-table .col-detail .detail-text { display: inline-block; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.log-table .col-action { width: 70px; text-align: right; }
.icon-btn {
  width: 28px; height: 28px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-2);
  transition: background 0.12s, border-color 0.12s;
}
.icon-btn:hover { background: var(--bg-soft); border-color: var(--border); color: var(--text-1); }

/* Bulk action bar — sticky bottom dark */
.bulk-bar {
  position: sticky;
  bottom: 60px;
  margin-top: 10px;
  background: #1f2937;
  color: white;
  border-radius: 8px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
  z-index: 15;
  animation: bulkSlideUp 0.25s ease-out;
}
@keyframes bulkSlideUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.count-pill {
  background: rgba(255, 255, 255, 0.18);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.bulk-label { font-size: 12px; color: #d1d5db; }
.bulk-btn {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s;
}
.bulk-btn:hover { background: rgba(255, 255, 255, 0.22); }
.bulk-btn-ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.18);
  color: #d1d5db;
}
.bulk-btn-ghost:hover { background: rgba(255, 255, 255, 0.08); }

/* Log head actions cluster */
.log-head-actions { display: inline-flex; gap: 8px; align-items: center; }

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
  max-width: 1920px; margin: 0 auto;
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
