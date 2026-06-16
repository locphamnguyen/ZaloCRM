<template>
  <div class="mtl-page">
    <!-- ================== TOPBAR (HS .mkt-top scaffold) ================== -->
    <div class="mkt-top">
      <div>
        <div class="mtt">Mục tiêu</div>
        <div class="mts">Quản lý chiến dịch mời kết bạn + bám đuổi</div>
      </div>
      <div class="actions">
        <button
          class="btn btn-ghost btn-sm"
          disabled
          title="Tính năng dự kiến phát hành ở Wave 4"
        >
          <v-icon size="16">mdi-tray-arrow-down</v-icon> Nhập từ Excel
        </button>
        <!-- #3 2026-06-06 (Anh chốt): nút bánh răng dẫn sang Cài đặt kỹ thuật tự động hoá -->
        <button
          class="btn btn-ghost btn-icon btn-sm"
          title="Cài đặt kỹ thuật tự động hoá (nhịp quét, ngưỡng kẹt, timeout)"
          @click="goTechSettings"
        >
          <v-icon size="16">mdi-cog-outline</v-icon>
        </button>
        <button class="btn btn-primary btn-sm" @click="onCreate">
          <v-icon size="16">mdi-plus-circle-outline</v-icon> Tạo Mục tiêu mới
        </button>
      </div>
    </div>

    <!-- ================== STATS BAND (Atlas .mkt-stats) ================== -->
    <div class="mkt-stats">
      <div class="mstat">
        <div class="mv num">{{ pageStats.activeRunning }} / {{ pageStats.totalGoals }}</div>
        <div class="ml">Mục tiêu đang bật</div>
      </div>
      <div class="mstat">
        <div class="mv num">{{ formatNum(pageStats.customersEntered) }}</div>
        <div class="ml">Khách đã vào</div>
      </div>
      <div class="mstat">
        <div class="mv num">{{ formatNum(pageStats.customersDone) }}</div>
        <div class="ml">Đã hoàn thành</div>
      </div>
      <div class="mstat">
        <div class="mv num">{{ pageStats.replyRate }}%</div>
        <div class="ml">Tỉ lệ phản hồi</div>
      </div>
    </div>

    <!-- ================== FILTER BAR ================== -->
    <div class="filter-bar">
      <div class="search-wrap">
        <v-icon class="search-icon" size="16">mdi-magnify</v-icon>
        <input
          v-model="searchInput"
          class="search-input"
          type="text"
          placeholder="Tìm theo tên Mục tiêu, Tệp KH..."
        />
      </div>

      <div class="chips">
        <span
          v-for="chip in statusChips"
          :key="chip.key"
          class="fchip"
          :class="{ active: statusFilter === chip.key }"
          @click="statusFilter = chip.key"
        >
          <span v-if="chip.dot" class="fdot" :style="{ background: chip.dot }"></span>
          {{ chip.label }} <span class="count num">{{ chipCount(chip.key) }}</span>
        </span>
      </div>

      <div class="filter-spacer"></div>

      <div class="filter-right">
        <select v-model="sortKey" class="sort-dd">
          <option value="created_desc">Sắp xếp: Mới tạo</option>
          <option value="progress_desc">Sắp xếp: Tiến độ</option>
          <option value="reply_desc">Sắp xếp: Phản hồi cao nhất</option>
        </select>
        <div class="view-toggle">
          <button class="active"><v-icon size="15">mdi-table</v-icon> Bảng</button>
          <button disabled title="Defer Wave 4"><v-icon size="15">mdi-view-grid-outline</v-icon> Card</button>
        </div>
      </div>
    </div>

    <!-- ===== System row: Bám đuổi khách hàng thủ công (Anh chốt 2026-06-07) =====
         Mục tiêu hệ thống gom mọi KH sale gắn luồng tay từ chat. Tách riêng khỏi
         bảng friend-invite vì khác mô hình dữ liệu. Click → side panel danh sách KH. -->
    <button
      v-if="manualSummary && manualSummary.counts.total > 0"
      class="sys-row"
      @click="goManualFollowup"
    >
      <span class="sys-ic">
        <v-icon size="18">mdi-account-arrow-right-outline</v-icon>
      </span>
      <span class="sys-main">
        <span class="sys-name">
          {{ manualSummary.name }}
          <span class="sys-tag">Hệ thống</span>
        </span>
        <span class="sys-sub">KH được sale gắn luồng bám đuổi thủ công từ chat</span>
      </span>
      <span class="sys-stats">
        <span class="sys-stat"><b class="num">{{ formatNum(manualSummary.counts.active) }}</b><i>Đang chạy</i></span>
        <span class="sys-stat"><b class="num" style="color:var(--success)">{{ formatNum(manualSummary.counts.completed) }}</b><i>Đã xong</i></span>
        <span class="sys-stat"><b class="num" style="color:var(--ink-3)">{{ formatNum(manualSummary.counts.stopped) }}</b><i>Đã dừng</i></span>
      </span>
      <v-icon size="20" class="sys-arrow">mdi-chevron-right</v-icon>
    </button>

    <!-- ================== TABLE 10 cột (anh chốt 2026-06-05) ================== -->
    <!-- STT · Ngày tạo · Tên · Tệp KH · Nick · Phase 1 · Phase 2 · Phản hồi · Trạng thái · Ngày kết thúc -->
    <div class="table-card">
      <table class="mt10">
        <thead>
          <tr>
            <th class="col-stt center">#</th>
            <th
              class="col-created"
              :class="{ sorted: sortKey === 'created_desc' }"
              @click="sortKey = 'created_desc'"
            >
              Ngày tạo
              <v-icon class="sort-arrow" size="13">{{ sortKey === 'created_desc' ? 'mdi-menu-down' : 'mdi-unfold-more-horizontal' }}</v-icon>
            </th>
            <th class="col-name">Mục tiêu</th>
            <th class="col-list">Tệp KH</th>
            <th class="col-nick center">Nick</th>
            <th
              class="col-p1"
              :class="{ sorted: sortKey === 'progress_desc' }"
              @click="sortKey = 'progress_desc'"
            >
              Phase 1 · Mời KB
              <v-icon class="sort-arrow" size="13">{{ sortKey === 'progress_desc' ? 'mdi-menu-down' : 'mdi-unfold-more-horizontal' }}</v-icon>
            </th>
            <th class="col-p2">Phase 2 · Bám đuổi</th>
            <th
              class="col-reply right"
              :class="{ sorted: sortKey === 'reply_desc' }"
              @click="sortKey = 'reply_desc'"
            >
              Phản hồi
              <v-icon class="sort-arrow" size="13">{{ sortKey === 'reply_desc' ? 'mdi-menu-down' : 'mdi-unfold-more-horizontal' }}</v-icon>
            </th>
            <th class="col-status">Trạng thái</th>
            <th class="col-end">Ngày kết thúc</th>
          </tr>
        </thead>
        <tbody>
          <!-- Loading skeleton -->
          <template v-if="loading && items.length === 0">
            <tr v-for="i in 8" :key="`sk-${i}`" class="skeleton-row">
              <td><div class="sk-bar sk-bar-reply"></div></td>
              <td><div class="sk-bar sk-bar-sub"></div></td>
              <td><div class="sk-bar sk-bar-name"></div><div class="sk-bar sk-bar-sub"></div></td>
              <td><div class="sk-bar sk-bar-name"></div><div class="sk-bar sk-bar-sub"></div></td>
              <td><div class="sk-bar sk-bar-nick"></div></td>
              <td><div class="sk-bar sk-bar-progress"></div></td>
              <td><div class="sk-bar sk-bar-progress"></div></td>
              <td><div class="sk-bar sk-bar-reply"></div></td>
              <td><div class="sk-bar sk-bar-status"></div></td>
              <td><div class="sk-bar sk-bar-sub"></div></td>
            </tr>
          </template>

          <!-- Error state -->
          <tr v-else-if="error">
            <td colspan="10" class="empty-cell">
              <div class="empty-state">
                <v-icon class="empty-icon" size="40" color="warning">mdi-alert-circle-outline</v-icon>
                <div class="empty-title">Không tải được danh sách</div>
                <div class="empty-desc">{{ error }}</div>
                <button class="btn btn-primary" @click="loadList">Thử lại</button>
              </div>
            </td>
          </tr>

          <!-- Empty state -->
          <tr v-else-if="!loading && visibleItems.length === 0">
            <td colspan="10" class="empty-cell">
              <div class="empty-state">
                <v-icon class="empty-icon" size="40" color="#97a0b3">mdi-target</v-icon>
                <div class="empty-title">
                  {{ searchInput || statusFilter !== 'all' ? 'Không có Mục tiêu nào khớp bộ lọc' : 'Chưa có Mục tiêu nào' }}
                </div>
                <div class="empty-desc">
                  {{ searchInput || statusFilter !== 'all'
                    ? 'Thử xoá tìm kiếm hoặc đổi bộ lọc.'
                    : 'Mục tiêu là chiến dịch mời kết bạn + bám đuổi 1 tệp khách hàng.' }}
                </div>
                <button
                  v-if="!searchInput && statusFilter === 'all'"
                  class="btn btn-primary"
                  @click="onCreate"
                >
                  + Tạo Mục tiêu đầu tiên
                </button>
              </div>
            </td>
          </tr>

          <!-- Data rows -->
          <tr
            v-for="(item, idx) in visibleItems"
            v-else
            :key="item.id"
            :class="{ active: activeId === item.id }"
            @click="onRowClick(item)"
          >
            <!-- 1. STT -->
            <td class="stt-cell">{{ (page - 1) * pageSize + idx + 1 }}</td>

            <!-- 2. Ngày tạo -->
            <td class="date-cell">{{ formatDateTime(item.createdAt) }}</td>

            <!-- 3. Mục tiêu (tên + luồng kịch bản) -->
            <td>
              <div class="row-name">{{ item.name }}</div>
              <div class="row-sub">{{ item.sequenceName ?? `bởi ${item.createdBy?.fullName ?? '—'}` }}</div>
            </td>

            <!-- 4. Tệp KH -->
            <td>
              <div class="row-name" style="font-weight:500">{{ item.list?.name ?? '—' }}</div>
              <div class="row-sub">{{ listSummaryLine(item) }}</div>
            </td>

            <!-- 5. Nick -->
            <td>
              <div class="avatars">
                <span
                  v-for="(n, i) in (item.nicks ?? []).slice(0, 3)"
                  :key="n.id ?? i"
                  class="avatar"
                  :class="`a${(i % 5) + 1}`"
                  :title="n.displayName ?? ''"
                >
                  {{ nickInitials(n.displayName ?? n.id ?? '?') }}
                </span>
                <span v-if="(item.nicks?.length ?? 0) > 3" class="avatar-more">
                  +{{ (item.nicks?.length ?? 0) - 3 }}
                </span>
                <span v-if="!item.nicks || item.nicks.length === 0" class="text-mute">—</span>
              </div>
            </td>

            <!-- 6. Phase 1 · Mời kết bạn = % KH đồng ý / KH đã gửi mời (per-KH) -->
            <td>
              <div class="ph">
                <div class="ph-top">
                  <span class="ph-pct">{{ phase1.pct(item) }}%</span>
                  <span class="ph-frac" title="Đồng ý / Đã gửi mời (số khách)">{{ formatNum(item.friendAccepted ?? 0) }}/{{ formatNum(phase1.denom(item)) }}</span>
                </div>
                <div class="ph-bar"><i class="p1" :style="{ width: phase1.pct(item) + '%' }"></i></div>
                <div class="ph-meta">Gửi <b>{{ formatNum(item.friendSent ?? 0) }}</b> · Đồng ý <b>{{ formatNum(item.friendAccepted ?? 0) }}</b></div>
              </div>
            </td>

            <!-- 7. Phase 2 · Bám đuổi = % KH gửi xong luồng / KH đã vào luồng (per-KH) -->
            <td>
              <div class="ph">
                <div class="ph-top">
                  <span class="ph-pct">{{ phase2.pct(item) }}%</span>
                  <span class="ph-frac" title="Xong chuỗi / Đã vào chuỗi (số khách)">{{ formatNum(phase2.done(item)) }}/{{ formatNum(phase2.denom(item)) }}</span>
                </div>
                <div class="ph-bar"><i class="p2" :style="{ width: phase2.pct(item) + '%' }"></i></div>
                <div class="ph-meta">Xong <b>{{ formatNum(phase2.done(item)) }}</b> · Đang chạy <b>{{ formatNum(item.enrollingSequence ?? 0) }}</b></div>
              </div>
            </td>

            <!-- 8. Phản hồi -->
            <td class="reply-cell">
              <template v-if="(item.replyCount ?? 0) > 0">
                <div class="reply-num">{{ item.replyCount }}</div>
                <div class="reply-sub">reply{{ (item.blockCount ?? 0) > 0 ? ` · ${item.blockCount} chặn` : '' }}</div>
              </template>
              <template v-else>
                <div class="reply-num reply-zero">0</div>
                <div class="reply-sub">{{ item.status === 'scheduled' ? 'chưa chạy' : 'chưa có' }}</div>
              </template>
            </td>

            <!-- 9. Trạng thái -->
            <td>
              <span class="status" :class="statusClass(item.status)">
                <span class="dot" :style="{ background: statusDot(item.status) }"></span>
                {{ statusLabel(item) }}
              </span>
            </td>

            <!-- 10. Ngày kết thúc (đang chạy → ETA dự đoán; đã xong → ngày thật) -->
            <td>
              <template v-if="item.status === 'done' && item.completedAt">
                <div class="end-real">{{ formatDateTime(item.completedAt) }}</div>
                <div class="end-sub">hoàn tất</div>
              </template>
              <template v-else-if="item.status === 'scheduled' && item.scheduledAt">
                <div class="end-eta scheduled">Bắt đầu {{ formatShortDateTime(item.scheduledAt) }}</div>
              </template>
              <template v-else-if="item.eta">
                <div
                  class="end-eta"
                  :class="{ stalled: item.eta.mode === 'stalled' }"
                  :title="item.eta.mode === 'measured' ? 'Ước tính từ tốc độ gửi thực tế' : item.eta.mode === 'formula' ? 'Ước tính sơ bộ theo cấu hình' : 'Mục tiêu nhiều ngày không gửi được — kiểm tra nick'"
                >{{ item.eta.label }}</div>
              </template>
              <template v-else>
                <span class="text-mute">—</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ================== PAGINATION ================== -->
    <div v-if="!loading && !error && items.length > 0" class="pagination">
      <div>
        Hiển thị
        <strong>{{ pageFrom }}-{{ pageTo }}</strong>
        trong <strong>{{ formatNum(total) }}</strong> Mục tiêu
      </div>
      <div class="page-nav">
        <button
          class="page-btn"
          :disabled="page <= 1"
          @click="page > 1 && (page--, loadList())"
        ><v-icon size="16">mdi-chevron-left</v-icon></button>
        <button class="page-btn active">{{ page }}</button>
        <button
          class="page-btn"
          :disabled="!hasNextPage"
          @click="hasNextPage && (page++, loadList())"
        ><v-icon size="16">mdi-chevron-right</v-icon></button>
      </div>
    </div>

    <!-- ================== SIDE PANEL ================== -->
    <div class="panel-overlay" :class="{ show: panelOpen }" @click="closePanel"></div>
    <aside class="side-panel" :class="{ open: panelOpen }">
      <template v-if="activeItem">
        <div class="panel-header">
          <div class="panel-header-row">
            <div style="flex:1; min-width:0">
              <h3 class="panel-title">{{ activeItem.name }}</h3>
              <div class="panel-meta-row">
                <span class="status" :class="statusClass(activeItem.status)"><span class="dot" :style="{ background: statusDot(activeItem.status) }"></span>{{ statusLabel(activeItem) }}</span>
                <span class="panel-meta">
                  · tạo {{ formatShortDate(activeItem.createdAt) }} · {{ activeItem.createdBy?.fullName ?? '—' }}
                </span>
              </div>
            </div>
            <div class="menu-wrap">
              <button class="panel-icon-btn" title="Tác vụ khác" @click.stop="menuOpen = !menuOpen"><v-icon size="18">mdi-dots-horizontal</v-icon></button>
              <div class="menu" :class="{ show: menuOpen }">
                <!-- 2026-06-05 — Trong thùng rác (Đã xóa): Khôi phục + Xóa hẳn.
                     Ngoài thùng rác: pause/resume/sao chép + Xóa (→ thùng rác). -->
                <template v-if="activeItem.status === 'cancelled'">
                  <div class="menu-item" @click="panelAction('restore')"><v-icon size="16">mdi-restore</v-icon> Khôi phục</div>
                  <div class="menu-divider"></div>
                  <div class="menu-item danger" @click="panelAction('hardDelete')"><v-icon size="16">mdi-delete-forever-outline</v-icon> Xóa hẳn vĩnh viễn</div>
                </template>
                <template v-else>
                  <div v-if="activeItem.status === 'running'" class="menu-item" @click="panelAction('pause')"><v-icon size="16">mdi-pause</v-icon> Tạm dừng</div>
                  <div v-else-if="activeItem.status === 'paused'" class="menu-item" @click="panelAction('resume')"><v-icon size="16">mdi-play</v-icon> Tiếp tục</div>
                  <div class="menu-item" @click="panelAction('duplicate')"><v-icon size="16">mdi-content-copy</v-icon> Sao chép</div>
                  <div class="menu-divider"></div>
                  <div class="menu-item danger" @click="panelAction('cancel')"><v-icon size="16">mdi-delete-outline</v-icon> Xóa (vào thùng rác)</div>
                </template>
              </div>
            </div>
            <button class="panel-icon-btn" title="Đóng" @click="closePanel"><v-icon size="18">mdi-close</v-icon></button>
          </div>
        </div>

        <div class="panel-body">
          <!-- Loading state -->
          <div v-if="dashboardLoading" class="panel-loading">
            <div class="sk-bar sk-bar-name" style="width:60%"></div>
            <div class="sk-bar sk-bar-sub" style="width:40%; margin-top:8px"></div>
          </div>

          <!-- Error state -->
          <div v-else-if="dashboardError" class="panel-error">
            <v-icon class="empty-icon" size="32" color="warning">mdi-alert-circle-outline</v-icon>
            <div class="empty-title">Không tải được chi tiết</div>
            <button class="btn btn-sm btn-primary" @click="loadDashboard(activeItem.id)">Thử lại</button>
          </div>

          <template v-else-if="dashboard">
            <!-- 4 stat cards -->
            <div class="panel-section">
              <div class="stat-grid">
                <div class="stat-card">
                  <div class="stat-label">Trong tệp</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.total) }}</div>
                </div>
                <div class="stat-card">
                  <div class="stat-label">Đã xử lý</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.processed) }}</div>
                </div>
                <div class="stat-card green">
                  <div class="stat-label">Có Zalo</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.hasZalo) }}</div>
                </div>
                <div class="stat-card red">
                  <div class="stat-label">Không Zalo</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.noZalo) }}</div>
                </div>
              </div>
            </div>

            <!-- Danger CTA -->
            <div v-if="dashboardStats.noZalo > 0" class="cta-banner">
              <v-icon size="18" color="error">mdi-phone-alert-outline</v-icon>
              <div class="cta-banner-text">
                <strong>Không có Zalo ({{ formatNum(dashboardStats.noZalo) }} KH)</strong>
                — gợi ý gọi điện qua Lead Pool
              </div>
              <a
                href="#"
                @click.prevent="goLeadPool(activeItem.id)"
              >Xem danh sách <v-icon size="13">mdi-arrow-right</v-icon></a>
            </div>

            <!-- Phase 1 -->
            <div class="panel-section">
              <div class="panel-section-title">Phase 1 · Mời kết bạn</div>
              <div class="phase-block">
                <div class="phase-head">
                  <span>Tiến độ Phase 1</span>
                  <span style="color:var(--mtl-text-3); font-weight:500">
                    {{ formatNum(dashboardStats.sent) }} / {{ formatNum(Math.max(dashboardStats.hasZalo, dashboardStats.sent)) }}
                  </span>
                </div>
                <div class="progress">
                  <div
                    class="progress-fill"
                    :style="{ width: phase1Pct + '%' }"
                  ></div>
                </div>
                <div class="phase-row" style="margin-top:10px">
                  <span>Đã gửi lời mời</span><span class="v">{{ formatNum(dashboardStats.sent) }}</span>
                </div>
                <div class="phase-row">
                  <span>Đồng ý kết bạn</span>
                  <span class="v" style="color:var(--mtl-success)">{{ formatNum(dashboardStats.accepted) }}</span>
                </div>
                <div class="phase-row">
                  <span>Từ chối</span>
                  <span class="v" style="color:var(--mtl-danger)">{{ formatNum(dashboardStats.rejected) }}</span>
                </div>
                <div class="phase-row muted">
                  <span>Đang chờ phản hồi</span>
                  <span class="v">{{ formatNum(dashboardStats.pending) }}</span>
                </div>
              </div>
            </div>

            <!-- Phase 2 -->
            <div class="panel-section">
              <div class="panel-section-title">Phase 2 · Chuỗi bám đuổi (Welcome → Follow-up)</div>
              <div class="phase-block">
                <div class="phase-head">
                  <span>Tiến độ Phase 2</span>
                  <span style="color:var(--mtl-text-3); font-weight:500">
                    {{ formatNum(dashboardStats.welcomeSent) }} KH đã nhận tin đầu
                  </span>
                </div>
                <div class="progress">
                  <div
                    class="progress-fill"
                    :style="{ width: phase2Pct + '%' }"
                  ></div>
                </div>
                <div class="phase-row" style="margin-top:10px">
                  <span>Đã gửi tin Welcome</span><span class="v">{{ formatNum(dashboardStats.welcomeSent) }}</span>
                </div>
                <div class="phase-row">
                  <span>Đang chạy bước tiếp</span>
                  <span class="v" style="color:var(--mtl-primary)">{{ formatNum(dashboardStats.inSequence) }}</span>
                </div>
                <div class="phase-row">
                  <span>Hoàn tất chuỗi</span>
                  <span class="v" style="color:var(--mtl-success)">{{ formatNum(dashboardStats.sequenceDone) }}</span>
                </div>
                <div class="phase-row muted">
                  <span>Dừng (reply / block)</span>
                  <span class="v">{{ formatNum(dashboardStats.sequenceStopped) }}</span>
                </div>
              </div>
            </div>

            <!-- Top nicks -->
            <div v-if="topNicks.length > 0" class="panel-section">
              <div class="panel-section-title">Top 3 nick theo tỉ lệ Accept</div>
              <table class="nick-table">
                <thead>
                  <tr><th>Nick</th><th>Gửi</th><th>Accept</th><th>%</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(n, idx) in topNicks" :key="n.nickId">
                    <td>
                      <span class="rank" :class="`rank-${idx + 1}`">{{ idx + 1 }}</span>
                      {{ n.displayName ?? n.nickId.slice(0, 6) }}
                    </td>
                    <td>{{ formatNum(n.sent) }}</td>
                    <td>{{ formatNum(n.accepted) }}</td>
                    <td>
                      <span class="accept-bar">
                        <span class="fill" :style="{ width: Math.min(100, n.acceptPct * 6) + '%' }"></span>
                      </span>
                      <strong>{{ n.acceptPct.toFixed(1) }}%</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>

        <div class="panel-footer">
          <button class="btn btn-primary btn-block" @click="goDetail(activeItem.id)">
            Mở trang chi tiết đầy đủ <v-icon size="16">mdi-arrow-right</v-icon>
          </button>
        </div>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();

// ============ Types (FE-side, mirrors expected BE response) ============

type MucTieuStatus = 'running' | 'paused' | 'done' | 'scheduled' | 'draft' | 'cancelled';

interface NickMini {
  id: string;
  displayName: string | null;
}

interface MucTieuListItem {
  id: string;
  name: string;
  status: MucTieuStatus;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  list: { id: string; name: string; phoneCount: number } | null;
  processedCount: number;
  totalCount: number;
  scheduledAt: string | null;
  nicks: NickMini[];
  replyCount: number;
  replyTrend: number | null;
  // Phase Friend Invite UI 2026-05-30 — flat counters from BE (top-level)
  // shipped by muc-tieu-list-service: tổng SĐT / có Zalo / không Zalo / đã xử lý /
  // KH đã hoàn tất Sequence (derive từ AutomationTask state='done'|'skipped').
  totalEntries?: number;
  hasZaloCount?: number;
  noZaloCount?: number;
  completedKHCount?: number;
  // I3 2026-06-03 — ETA dự đoán còn lại (Lai A→B) + số KH còn chạy.
  stillRunning?: number;
  eta?: { mode: 'formula' | 'measured' | 'stalled'; etaDays: number | null; label: string } | null;
  // 2026-06-05 — Bảng 10 cột (anh chốt). Field cho Phase 1/Phase 2/Ngày kết thúc.
  sequenceName?: string | null;     // hiện dưới tên Mục tiêu
  friendSent?: number;              // Phase 1 — KH đã gửi lời mời (per-KH)
  friendAccepted?: number;          // Phase 1 — KH đồng ý kết bạn (per-KH)
  enrollingSequence?: number;       // Phase 2 — KH đang trong chuỗi bám đuổi
  completedSequence?: number;       // Phase 2 — KH đã đi hết chuỗi (= completedKHCount)
  blockCount?: number;              // Phản hồi — số chặn
  completedAt?: string | null;      // Ngày kết thúc (state=completed)
}

// NOTE: BE list response shape is defined as `BeListResponse` inside loadList()
// (FE adapter scope) — the FE-side `MucTieuListItem` above represents the
// POST-adapter shape consumed by the template.

// Trigger dashboard payload (Wave 2 endpoint).
// Side panel adapter reads counters[] + nicks[] from it.
interface DashboardCounters {
  total?: number;
  processed?: number;
  sent?: number;
  accepted?: number;
  rejected?: number;
  pending?: number;
  skipped_no_zalo?: number;
  failed_permanent?: number;
  failed_stuck?: number;
  welcome_sent?: number;
  in_sequence?: number;
  sequence_done?: number;
  sequence_stopped?: number;
  [k: string]: number | undefined;
}

interface DashboardNick {
  nickId: string;
  displayName: string | null;
  sentTotal?: number;
  sent?: number;
  accepted?: number;
}

interface DashboardPayload {
  trigger: { id: string; name: string; state: string };
  counters: DashboardCounters;
  nicks: DashboardNick[];
}

// ============ State ============

const items = ref<MucTieuListItem[]>([]);
const total = ref(0);
const statusCounts = ref<Record<string, number>>({});

// 2026-06-05 (Anh chốt) — "Tất cả" KHÔNG hiện Nháp + Đã xóa (cho gọn). Lọc FE-side
// để không phá hợp đồng BE (BE default vẫn trả mọi state). Chỉ hiện draft/cancelled
// khi anh bấm đúng chip của chúng.
const visibleItems = computed(() =>
  statusFilter.value === 'all'
    ? items.value.filter((i) => i.status !== 'cancelled' && i.status !== 'draft')
    : items.value,
);

const loading = ref(false);
const error = ref<string | null>(null);

// ── Mục tiêu hệ thống "Bám đuổi thủ công" (Anh chốt 2026-06-07) ──
interface ManualSummary {
  exists: boolean;
  triggerId: string | null;
  name: string;
  counts: { active: number; completed: number; stopped: number; total: number };
}
const manualSummary = ref<ManualSummary | null>(null);
function goManualFollowup() { void router.push({ name: 'Marketing.ManualFollowup' }); }
async function loadManualSummary() {
  try {
    const res = await api.get<ManualSummary>('/automation/manual-followup/summary');
    manualSummary.value = res.data;
  } catch (err) {
    console.error('[manual-followup] summary failed', err);
    manualSummary.value = null;
  }
}

const searchInput = ref('');
const searchDebounced = ref('');
const statusFilter = ref<'all' | MucTieuStatus>('all');
const sortKey = ref<'created_desc' | 'progress_desc' | 'reply_desc'>('created_desc');

const page = ref(1);
const pageSize = 20;

const activeId = ref<string | null>(null);
const activeItem = computed<MucTieuListItem | null>(() =>
  items.value.find((x) => x.id === activeId.value) ?? null,
);
const panelOpen = ref(false);
const menuOpen = ref(false);

const dashboard = ref<DashboardPayload | null>(null);
const dashboardLoading = ref(false);
const dashboardError = ref<string | null>(null);

// ============ Status chips ============
// FE chip-key (UX label) ↔ BE state map.
// BE AutomationTrigger.state ∈ { draft | active | paused | completed | cancelled }.
// "scheduled" UX bucket = trigger có state='draft' + scheduledAt — Wave 3 BE chưa
// trả riêng → tạm map sang `draft` count, hiển thị 0 nếu trống.
const chipToBeState: Record<Exclude<'all' | MucTieuStatus, 'all'>, string> = {
  running: 'active',
  paused: 'paused',
  done: 'completed',
  scheduled: 'draft',
  draft: 'draft',
  cancelled: 'cancelled',
};

// label = text thuần (không emoji); dot = màu trạng thái (HS .status .dot).
const statusChips: { key: 'all' | MucTieuStatus; label: string; dot?: string }[] = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'running',   label: 'Đang chạy',  dot: 'var(--success)' },
  { key: 'paused',    label: 'Tạm dừng',   dot: 'var(--ink-4)' },
  { key: 'done',      label: 'Hoàn tất',   dot: 'var(--info)' },
  { key: 'scheduled', label: 'Hẹn lịch',   dot: 'var(--warning)' },
  // 2026-06-05 (Anh chốt) — 2 chip mới: Nháp (draft) + Đã xóa (cancelled, thùng rác).
  { key: 'draft',     label: 'Nháp',       dot: 'var(--chip-purple)' },
  { key: 'cancelled', label: 'Đã xóa',     dot: 'var(--ink-4)' },
];

// Display count for a chip — reads BE-keyed statusCounts via chipToBeState mapping.
function chipCount(key: 'all' | MucTieuStatus): number {
  if (key === 'all') return statusCounts.value.all ?? total.value ?? 0;
  const beKey = chipToBeState[key];
  return statusCounts.value[beKey] ?? 0;
}

// ============ Debounce search input → searchDebounced ============

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchDebounced.value = val.trim();
  }, 400);
});

// Reset to page 1 + reload when filter changes
watch([searchDebounced, statusFilter, sortKey], () => {
  page.value = 1;
  void loadList();
});

// ============ API calls ============

// ============ FE Adapter — BE shape → FE expected shape ============
// P0-1 FIX 2026-05-30 — BE service `muc-tieu-list-service.ts` ship payload với
// shape không khớp template `<tr v-for>` (template đọc `item.status`/`item.list`/
// `item.processedCount`/`createdBy.fullName`/`item.nicks[]`). Anh chốt fix trên
// FE: adapter map field 1-1 thay vì refactor BE.
//
// Map rules:
//   BE `state`             → FE `status` (active→running, completed→done, …)
//   BE `sourceList`        → FE `list` (totalEntries → phoneCount)
//   BE `progress.processed`→ FE `processedCount`
//   BE `progress.totalContacts` → FE `totalCount`
//   BE `counters.replyCount` → FE `replyCount`
//   BE `createdBy.displayName` → FE `createdBy.fullName`
//   BE `nickIds[]` (bulk-loaded via GET /zalo-accounts) → FE `nicks[]` (id+displayName)
//
// Nick lookup: gom unique nickIds toàn page rồi gọi 1 GET /zalo-accounts → map.
// /zalo-accounts không hỗ trợ ?ids= filter (đọc-all rồi filter client), nhưng
// dataset nick org thường <50 (memory zalocrm_scale_target) nên acceptable.

const stateToStatus: Record<string, MucTieuStatus> = {
  active: 'running',
  paused: 'paused',
  completed: 'done',
  draft: 'draft',
  // 2026-06-05 (Anh chốt) — TÁCH cancelled khỏi draft (trước gộp → chip "Đã xóa"
  // không khớp item nào, item đã xóa hiện nhầm "Nháp"). Giờ cancelled = chip Đã xóa.
  cancelled: 'cancelled',
};

// Raw BE shape (mirrors muc-tieu-list-service.MucTieuListItem)
interface BeMucTieuItem {
  id: string;
  name: string;
  state: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
  sourceList: { id: string; name: string; totalEntries: number } | null;
  sequenceName: string | null;
  nickCount?: number;
  nickIds?: string[];
  progress?: { totalContacts: number; processed: number; percent: number };
  counters?: { friendSent?: number; friendAccepted?: number; replyCount?: number; blockCount?: number };
  totalEntries?: number;
  hasZaloCount?: number;
  noZaloCount?: number;
  processedCount?: number;
  completedKHCount?: number;
  scheduledAt?: string | null;
  replyCount?: number; // tolerate already-flat shape
  replyTrend?: number | null;
  // I3 2026-06-03 — ETA + still-running từ BE.
  stillRunning?: number;
  eta?: { mode: 'formula' | 'measured' | 'stalled'; etaDays: number | null; label: string } | null;
  // 2026-06-05 — Phase 2 đang chạy + đã xong + ngày kết thúc.
  enrollingSequence?: number;
  completedSequence?: number;
  completedAt?: string | null;
}

interface ZaloAccountMini {
  id: string;
  displayName: string | null;
}

// Cache trong scope load — không cross-page persist (page mới refetch để pickup
// nick rename / new nick).
async function loadNickDisplayMap(nickIds: string[]): Promise<Map<string, ZaloAccountMini>> {
  const map = new Map<string, ZaloAccountMini>();
  if (nickIds.length === 0) return map;
  try {
    const res = await api.get<ZaloAccountMini[]>('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : [];
    for (const acc of accounts) {
      if (acc?.id) map.set(acc.id, { id: acc.id, displayName: acc.displayName ?? null });
    }
  } catch {
    // Nick fetch fail không bể list — avatar fallback hiện ID prefix.
  }
  return map;
}

function adaptItem(be: BeMucTieuItem, nickMap: Map<string, ZaloAccountMini>): MucTieuListItem {
  const nickIds = be.nickIds ?? [];
  const nicks: NickMini[] = nickIds.map((nid) => {
    const hit = nickMap.get(nid);
    return { id: nid, displayName: hit?.displayName ?? null };
  });
  return {
    id: be.id,
    name: be.name,
    status: stateToStatus[be.state] ?? 'draft',
    createdAt: be.createdAt,
    createdBy: be.createdBy
      ? { id: be.createdBy.id, fullName: be.createdBy.displayName }
      : null,
    list: be.sourceList
      ? { id: be.sourceList.id, name: be.sourceList.name, phoneCount: be.sourceList.totalEntries }
      : null,
    processedCount: be.progress?.processed ?? be.processedCount ?? 0,
    totalCount: be.progress?.totalContacts ?? be.totalEntries ?? 0,
    scheduledAt: be.scheduledAt ?? null,
    nicks,
    replyCount: be.counters?.replyCount ?? be.replyCount ?? 0,
    replyTrend: be.replyTrend ?? null,
    totalEntries: be.totalEntries,
    hasZaloCount: be.hasZaloCount,
    noZaloCount: be.noZaloCount,
    completedKHCount: be.completedKHCount,
    // I3 2026-06-03 — ETA + số KH còn chạy.
    stillRunning: be.stillRunning,
    eta: be.eta ?? null,
    // 2026-06-05 — Bảng 10 cột.
    sequenceName: be.sequenceName ?? null,
    friendSent: be.counters?.friendSent ?? 0,
    friendAccepted: be.counters?.friendAccepted ?? 0,
    enrollingSequence: be.enrollingSequence,
    completedSequence: be.completedSequence ?? be.completedKHCount,
    blockCount: be.counters?.blockCount ?? 0,
    completedAt: be.completedAt ?? null,
  };
}

// BE raw list response shape
interface BeListResponse {
  items: BeMucTieuItem[];
  total: number;
  page?: number;
  pageSize?: number;
  statusCounts?: Record<string, number>;
  filters?: { statusCounts?: Record<string, number> };
}

async function loadList() {
  loading.value = true;
  error.value = null;
  try {
    const params: Record<string, string | number> = {
      page: page.value,
      pageSize,
      sort: sortKey.value,
    };
    if (searchDebounced.value) params.search = searchDebounced.value;
    if (statusFilter.value !== 'all') {
      // Map FE chip key → BE state key (e.g., "running" → "active").
      params.status = chipToBeState[statusFilter.value] ?? statusFilter.value;
    }

    const res = await api.get<BeListResponse>('/automation/muc-tieu/list', { params });
    const beItems = res.data.items ?? [];

    // Bulk-load nick displayNames cho toàn page (1 GET).
    const allNickIds = new Set<string>();
    for (const it of beItems) {
      for (const nid of it.nickIds ?? []) allNickIds.add(nid);
    }
    const nickMap = await loadNickDisplayMap([...allNickIds]);

    items.value = beItems.map((be) => adaptItem(be, nickMap));
    total.value = res.data.total ?? 0;
    // BE Wave 3 ships counters under `filters.statusCounts`; fallback to root for safety.
    statusCounts.value =
      res.data.filters?.statusCounts ?? res.data.statusCounts ?? {};
  } catch (err) {
    const e = err as { response?: { data?: { error?: string; detail?: string } }; message?: string };
    error.value =
      e.response?.data?.detail ??
      e.response?.data?.error ??
      e.message ??
      'Lỗi không xác định';
  } finally {
    loading.value = false;
  }
}

async function loadDashboard(triggerId: string) {
  dashboardLoading.value = true;
  dashboardError.value = null;
  dashboard.value = null;
  try {
    const res = await api.get<DashboardPayload>(`/automation/triggers/${triggerId}/dashboard`);
    dashboard.value = res.data;
  } catch (err) {
    const e = err as { response?: { data?: { error?: string } }; message?: string };
    dashboardError.value =
      e.response?.data?.error ??
      e.message ??
      'Lỗi tải dashboard';
  } finally {
    dashboardLoading.value = false;
  }
}

// ============ Side panel ============

function onRowClick(item: MucTieuListItem) {
  activeId.value = item.id;
  panelOpen.value = true;
  menuOpen.value = false;
  void loadDashboard(item.id);
}

function closePanel() {
  panelOpen.value = false;
  menuOpen.value = false;
  // Clear active row indicator after slide-out transition
  setTimeout(() => {
    if (!panelOpen.value) activeId.value = null;
  }, 250);
}

async function panelAction(action: 'pause' | 'resume' | 'duplicate' | 'cancel' | 'restore' | 'hardDelete') {
  menuOpen.value = false;
  if (!activeItem.value) return;
  const id = activeItem.value.id;
  const name = activeItem.value.name;
  const errOf = (err: unknown): string => {
    const e = err as { response?: { data?: { error?: string; hint?: string } }; message?: string };
    return e.response?.data?.hint ?? e.response?.data?.error ?? e.message ?? 'lỗi';
  };
  // 2026-06-05 — "Xóa" = đưa vào thùng rác (soft, cancel). KHÔNG xoá hẳn ở đây.
  if (action === 'cancel') {
    if (!(await confirm({
      title: 'Chuyển vào thùng rác?',
      message: `Mục tiêu "${name}" sẽ chuyển sang Đã xóa.`,
      tone: 'danger',
      confirmText: 'Chuyển vào thùng rác',
      cancelText: 'Hủy',
    }))) return;
    void api
      .post(`/automation/triggers/${id}/cancel`)
      .then(() => { closePanel(); void loadList(); })
      .catch((err: unknown) => toast.error(`Không xoá được: ${errOf(err)}`, 5000));
    return;
  }
  // Khôi phục từ thùng rác → về Tạm dừng (paused), anh bấm "Bắt đầu" để chạy lại.
  if (action === 'restore') {
    void api
      .post(`/automation/triggers/${id}/restore`)
      .then(() => { closePanel(); void loadList(); })
      .catch((err: unknown) => toast.error(`Không khôi phục được: ${errOf(err)}`, 5000));
    return;
  }
  // Xóa HẲN vĩnh viễn (chỉ trong thùng rác). Giữ KH trong Tệp gốc.
  if (action === 'hardDelete') {
    if (!(await confirm({
      title: `Xoá HẲN "${name}" vĩnh viễn?`,
      message: 'Không khôi phục được. Khách hàng vẫn giữ trong Tệp gốc.',
      tone: 'danger',
      confirmText: 'Xoá hẳn',
      cancelText: 'Hủy',
    }))) return;
    void api
      .delete(`/automation/triggers/${id}`)
      .then(() => { closePanel(); void loadList(); })
      .catch((err: unknown) => toast.error(`Không xoá hẳn được: ${errOf(err)}`, 5000));
    return;
  }
  if (action === 'pause') {
    void api
      .post(`/automation/triggers/${id}/pause`)
      .then(() => loadList())
      .catch(() => toast.error('Không tạm dừng được', 5000));
    return;
  }
  if (action === 'resume') {
    void api
      .post(`/automation/triggers/${id}/resume`)
      .then(() => loadList())
      .catch(() => toast.error('Không tiếp tục được', 5000));
    return;
  }
  if (action === 'duplicate') {
    toast.success('Sao chép — Wave 4');
    return;
  }
}

function onCreate() {
  void router.push('/marketing/triggers/tao-moi');
}

// #3 2026-06-06 (Anh chốt): nút bánh răng → trang Cài đặt kỹ thuật tự động hoá.
function goTechSettings() {
  void router.push('/settings/channels/automation');
}

function goDetail(id: string) {
  // Wave 3 Day 1 — MucTieuDetailView (Dashboard + Log) thay TriggerDetailView legacy.
  void router.push(`/marketing/triggers/${id}`);
}

function goLeadPool(id: string) {
  void router.push({ path: '/leads/stuck', query: { source: 'muc-tieu', id } });
}

// ============ Page-level stats band (.mkt-stats) ============
// Tổng hợp từ statusCounts (server) + các counter per-item của trang hiện tại.
// "Khách đã vào" = tổng KH đã vào Sequence (enrolling + done); "Đã hoàn thành" =
// tổng KH đi hết chuỗi; "Tỉ lệ phản hồi" = reply / (KH đã vào chuỗi) — chặn 0.
const pageStats = computed(() => {
  const activeRunning = statusCounts.value.active ?? 0;
  const totalGoals = statusCounts.value.all ?? total.value ?? items.value.length;
  let entered = 0;
  let done = 0;
  let replies = 0;
  for (const it of items.value) {
    const enrolling = it.enrollingSequence ?? 0;
    const completed = it.completedKHCount ?? it.completedSequence ?? 0;
    entered += enrolling + completed;
    done += completed;
    replies += it.replyCount ?? 0;
  }
  const replyRate = entered > 0 ? Math.min(100, Math.round((replies / entered) * 100)) : 0;
  return {
    activeRunning,
    totalGoals,
    customersEntered: entered,
    customersDone: done,
    replyRate,
  };
});

// ============ Derived stats for side panel ============

const dashboardStats = computed(() => {
  const c = dashboard.value?.counters ?? {};
  const total = c.total ?? 0;
  const processed = c.processed ?? 0;
  const sent = c.sent ?? processed;
  const accepted = c.accepted ?? 0;
  const rejected = c.rejected ?? 0;
  const hasZalo = total - (c.skipped_no_zalo ?? 0);
  const noZalo = c.skipped_no_zalo ?? 0;
  const pending = Math.max(0, sent - accepted - rejected);
  return {
    total,
    processed,
    sent,
    accepted,
    rejected,
    pending,
    hasZalo,
    noZalo,
    welcomeSent: c.welcome_sent ?? c.processed ?? 0,
    inSequence: c.in_sequence ?? 0,
    sequenceDone: c.sequence_done ?? 0,
    sequenceStopped: c.sequence_stopped ?? 0,
  };
});

const phase1Pct = computed(() => {
  const s = dashboardStats.value;
  if (s.hasZalo <= 0) return 0;
  return Math.min(100, Math.round((s.sent / s.hasZalo) * 100));
});
const phase2Pct = computed(() => {
  const s = dashboardStats.value;
  if (s.welcomeSent <= 0) return 0;
  const denom = s.welcomeSent;
  const num = s.sequenceDone + s.inSequence;
  return Math.min(100, Math.round((num / Math.max(denom, 1)) * 100));
});

const topNicks = computed(() => {
  const ns = dashboard.value?.nicks ?? [];
  return ns
    .map((n) => {
      const sent = n.sent ?? n.sentTotal ?? 0;
      const accepted = n.accepted ?? 0;
      const acceptPct = sent > 0 ? (accepted / sent) * 100 : 0;
      return { nickId: n.nickId, displayName: n.displayName, sent, accepted, acceptPct };
    })
    .sort((a, b) => b.acceptPct - a.acceptPct)
    .slice(0, 3);
});

// ============ Helpers ============

// 2026-06-05 — Bảng đổi sang Phase 1/Phase 2 riêng (helper phase1/phase2 ở dưới).
// 3 hàm cũ progressPct/progressClass/progressSubLine (cột "Tiến độ" gộp) đã gỡ.
// Side panel vẫn dùng phase1Pct/phase2Pct riêng (computed ở phần dưới).

// Cột "Tệp KH": "X SĐT · Y có Zalo · Z không Zalo".
// Hiển thị placeholder "—" nếu BE chưa kèm flat counters (cũ payload).
function listSummaryLine(item: MucTieuListItem): string {
  const totalSdt = item.totalEntries ?? item.list?.phoneCount ?? 0;
  const hasZalo = item.hasZaloCount;
  const noZalo = item.noZaloCount;
  if (hasZalo == null && noZalo == null) {
    return `${formatNum(totalSdt)} SĐT`;
  }
  return `${formatNum(totalSdt)} SĐT · ${formatNum(hasZalo ?? 0)} có Zalo · ${formatNum(noZalo ?? 0)} không Zalo`;
}

function statusClass(status: MucTieuStatus): string {
  return status; // CSS classes: running / paused / done / scheduled / draft
}

function statusLabel(item: MucTieuListItem): string {
  if (item.status === 'running') return 'Đang chạy';
  if (item.status === 'paused') return 'Tạm dừng';
  if (item.status === 'done') return 'Hoàn tất';
  if (item.status === 'scheduled') {
    if (item.scheduledAt) return `Hẹn ${formatShortDateTime(item.scheduledAt)}`;
    return 'Hẹn lịch';
  }
  if (item.status === 'cancelled') return 'Đã xóa';
  return 'Nháp';
}

// Màu dot trạng thái (HS .status .dot) theo state.
function statusDot(status: MucTieuStatus): string {
  switch (status) {
    case 'running':   return 'var(--success)';
    case 'paused':    return 'var(--ink-4)';
    case 'done':      return 'var(--info)';
    case 'scheduled': return 'var(--warning)';
    case 'cancelled': return 'var(--ink-4)';
    default:          return 'var(--chip-purple)';
  }
}

function nickInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts[parts.length - 1];
  if (parts.length === 1) {
    return last.slice(0, 2).toUpperCase();
  }
  return (parts[0][0] ?? '').toUpperCase() + (last[0] ?? '').toUpperCase();
}

function formatNum(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString('vi-VN');
}

function formatShortDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function formatShortDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

// 2026-06-05 — Ngày tạo / kết thúc đầy đủ dd/mm/yy HH:mm (giờ VN, Date local).
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

// ============ Phase 1 / Phase 2 helpers (bảng 10 cột) ============
// 2026-06-05 — Anh chốt ngữ nghĩa, tất cả PER-KH (BE đã fix đếm distinct contactId,
// KHÔNG còn đếm row Friend = KH×nick gây số "lượt" sai như friendAccepted=3 cũ):
//   • Phase 1 = % KH ĐỒNG Ý trên số KH ĐÃ GỬI lời mời = friendAccepted / friendSent.
//   • Phase 2 = % KH đã GỬI XONG TOÀN BỘ luồng sequence = completedSequence /
//     (số KH đã VÀO luồng = enrollingSequence + completedSequence).
// max(1, denom) chống chia 0; min(100, …) chống >100% (an toàn dù số liệu lệch nguồn).
const phase1 = {
  denom(item: MucTieuListItem): number {
    return item.friendSent ?? 0;
  },
  pct(item: MucTieuListItem): number {
    const d = phase1.denom(item);
    if (d <= 0) return 0;
    return Math.min(100, Math.round(((item.friendAccepted ?? 0) / d) * 100));
  },
};
const phase2 = {
  // completedSequence (alias completedKHCount) = tử; enrolling + completed = mẫu.
  done(item: MucTieuListItem): number {
    return item.completedSequence ?? item.completedKHCount ?? 0;
  },
  denom(item: MucTieuListItem): number {
    return (item.enrollingSequence ?? 0) + phase2.done(item);
  },
  pct(item: MucTieuListItem): number {
    const d = phase2.denom(item);
    if (d <= 0) return 0;
    return Math.min(100, Math.round((phase2.done(item) / d) * 100));
  },
};

// ============ Pagination ============

const pageFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize + 1));
const pageTo = computed(() => Math.min(total.value, page.value * pageSize));
const hasNextPage = computed(() => page.value * pageSize < total.value);

// ============ Keyboard ESC closes panel + click-outside menu ============

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (menuOpen.value) menuOpen.value = false;
    else if (panelOpen.value) closePanel();
  }
}
function onDocClick() {
  if (menuOpen.value) menuOpen.value = false;
}

onMounted(() => {
  void loadList();
  void loadManualSummary();
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocClick);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', onDocClick);
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
});
</script>

<style scoped>
/* ============================ DESIGN TOKENS (scoped) ============================ */
.mtl-page {
  /* HS re-skin 2026-06-05 — map --mtl-* sang token HS Holding (--brand/--ink/
     --surface…). Giữ NGUYÊN tên biến → template + CSS bên dưới không đụng,
     chỉ đổi giá trị màu để cả màn khoác áo HS metallic-blue. */
  --mtl-bg-page: var(--surface-2, #f7f9fc);
  --mtl-bg-card: var(--surface, #ffffff);
  --mtl-bg-soft: var(--surface-3, #f1f4f9);
  --mtl-bg-hover: var(--brand-softer, #f2f8fc);
  --mtl-border: var(--line, #e7eaf0);
  --mtl-border-strong: var(--line, #e7eaf0);
  --mtl-text-1: var(--ink, #141a24);
  --mtl-text-2: var(--ink-2, #475066);
  --mtl-text-3: var(--ink-3, #6b7488);
  --mtl-text-mute: var(--ink-4, #97a0b3);
  /* Brand action = HS metallic blue #1786be (thay #0068ff Atlassian cũ) */
  --mtl-primary: var(--brand, #1786be);
  --mtl-primary-hover: var(--brand-600, #0f6fa0);
  --mtl-primary-bg: var(--brand-soft, #e4f1f8);
  --mtl-success: var(--success, #12b76a);
  --mtl-success-bg: var(--success-soft, #e7f7ef);
  --mtl-warning: var(--warning, #f5a524);
  --mtl-warning-bg: var(--warning-soft, #fdf3e2);
  --mtl-danger: var(--error, #f04438);
  --mtl-danger-bg: var(--error-soft, #fdeceb);
  --mtl-purple: var(--chip-purple, #8b5cf6);
  --mtl-purple-bg: var(--chip-purple-bg, #f1ecfe);
  --mtl-shadow-1: var(--sh-xs);
  --mtl-shadow-2: var(--sh-md);
  --mtl-shadow-panel: var(--sh-lg);

  /* 2026-06-04 v2 — Nằm trong BotAutoShell, bỏ min-width: 1280px (gây crop) */
  width: 100%;
  padding: 24px;
  background: var(--mtl-bg-page);
  color: var(--mtl-text-1);
  font-size: 13px;
  line-height: 1.45;
}

/* ============================ HEADER (HS .mkt-top scaffold) ============================ */
/* Override .mkt-top global cho page context (.mtl-page đã có padding 24px) */
.mtl-page .mkt-top {
  position: static;
  padding: 0 0 16px;
  border-bottom: 0;
  background: transparent;
  align-items: flex-start;
}
.mtl-page .mkt-top .mtt { font-size: 18px; }
.actions { display: flex; gap: 8px; flex-shrink: 0; }
.actions .btn[disabled] { opacity: 0.55; }

/* Stats band — .mkt-stats/.mstat global; chỉ chỉnh margin trong page */
.mtl-page .mkt-stats { margin-bottom: 16px; }

.btn {
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--mtl-border-strong);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--mtl-text-2);
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.btn:hover:not(:disabled) { background: var(--mtl-bg-soft); border-color: var(--mtl-text-3); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary { background: var(--mtl-primary); color: white; border-color: var(--mtl-primary); }
.btn-primary:hover:not(:disabled) { background: var(--mtl-primary-hover); border-color: var(--mtl-primary-hover); }
.btn-ghost { background: transparent; border-color: transparent; }
.btn-ghost:hover:not(:disabled) { background: var(--mtl-bg-soft); }
.btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 4px; }
.btn-block { width: 100%; justify-content: center; }

/* ============================ FILTER BAR ============================ */
.filter-bar {
  position: sticky; top: 0; z-index: 10;
  background: var(--mtl-bg-page);
  padding: 10px 0;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--mtl-border);
}
.search-wrap { position: relative; width: 320px; }
.search-input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  border: 1px solid var(--mtl-border-strong);
  border-radius: 6px;
  font-size: 13px;
  background: var(--surface);
  font-family: inherit;
  color: var(--mtl-text-1);
  transition: border-color 0.15s;
}
.search-input:focus { outline: none; border-color: var(--mtl-primary); box-shadow: 0 0 0 3px var(--brand-soft, rgba(23, 134, 190, 0.18)); }
.search-icon {
  position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
  color: var(--mtl-text-mute);
}

/* Filter chip (HS) — dot màu trạng thái + count mono */
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.fchip {
  padding: 5px 11px;
  background: var(--surface);
  border: 1px solid var(--mtl-border);
  border-radius: var(--r-pill);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mtl-text-2);
  cursor: pointer;
  transition: background .14s, border-color .14s, color .14s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  user-select: none;
}
.fchip:hover { background: var(--mtl-bg-soft); border-color: var(--mtl-border-strong); }
.fchip.active { background: var(--mtl-primary-bg); border-color: var(--mtl-primary); color: var(--mtl-primary); }
.fdot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.fchip .count { color: var(--mtl-text-mute); font-size: 11.5px; }
.fchip.active .count { color: var(--mtl-primary); }

.filter-spacer { flex: 1; }
.filter-right { display: flex; gap: 8px; align-items: center; }
.sort-dd {
  padding: 7px 12px;
  background: var(--surface);
  border: 1px solid var(--mtl-border-strong);
  border-radius: 6px;
  font-size: 12px;
  color: var(--mtl-text-2);
  cursor: pointer;
  font-family: inherit;
}
.view-toggle { display: flex; border: 1px solid var(--mtl-border-strong); border-radius: 6px; overflow: hidden; }
.view-toggle button {
  padding: 6px 10px;
  background: var(--surface);
  border: none;
  font-size: 12px;
  color: var(--mtl-text-3);
  cursor: pointer;
  font-family: inherit;
}
.view-toggle button.active { background: var(--mtl-primary); color: white; }
.view-toggle button:disabled { opacity: 0.5; cursor: not-allowed; }

/* ============================ TABLE ============================ */
/* ── System row "Bám đuổi thủ công" (Anh chốt 2026-06-07) ──────────────── */
.sys-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: var(--surface);
  border: 1px solid var(--line, #e7eaf0);
  border-left: 3px solid var(--brand, #1786be);
  border-radius: var(--r-md, 10px);
  box-shadow: var(--sh-xs);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color .14s, box-shadow .14s;
}
.sys-row:hover { border-color: var(--brand, #1786be); box-shadow: var(--sh-sm); }
.sys-ic {
  width: 38px; height: 38px; border-radius: var(--r-sm, 8px); flex-shrink: 0;
  background: var(--brand-soft, #e4f1f8); color: var(--brand, #1786be);
  display: inline-flex; align-items: center; justify-content: center;
}
.sys-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sys-name {
  font-size: 14px; font-weight: 600; color: var(--ink, #141a24);
  display: flex; align-items: center; gap: 8px;
}
.sys-tag {
  font-size: 10.5px; font-weight: 600; color: var(--ink-3, #6b7488);
  background: var(--surface-3, #f1f4f9); border-radius: var(--r-pill, 999px); padding: 1px 8px;
}
.sys-sub { font-size: 12px; color: var(--ink-3, #6b7488); }
.sys-stats { display: flex; gap: 22px; flex-shrink: 0; }
.sys-stat { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.sys-stat b { font-size: 17px; font-weight: 600; line-height: 1; color: var(--ink, #141a24); }
.sys-stat i { font-size: 10.5px; font-style: normal; color: var(--ink-3, #6b7488); }
.sys-arrow { color: var(--ink-4, #97a0b3); flex-shrink: 0; }

@media (max-width: 1100px) {
  .sys-row { gap: 10px; }
  .sys-stats { gap: 14px; }
  .sys-sub { display: none; }
}

.table-card {
  background: var(--surface);
  border: 1px solid var(--mtl-border);
  border-radius: 6px;
  /* IMPORTANT: KHÔNG overflow:hidden — cắt sticky context của <thead> bên trong.
     Dùng clip-path để vẫn giữ rounded corner cho border-radius mà không phá sticky. */
  overflow: visible;
  box-shadow: var(--mtl-shadow-1);
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
/* Sticky thead must paint OVER tbody row 1 — bg-white + z-index 10 + shadow.
   Background lives on both THEAD và TH: thead sticky cho Safari ≤14 cross-browser,
   th sticky cho modern. top:0 dính tới mép trên scroll container (.mtl-page),
   KHÔNG hardcode 64px (offset navbar thay đổi theo layout). */
thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--surface);
}
thead tr {
  border-bottom: 1px solid var(--mtl-border);
}
thead th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--surface);
  text-align: left;
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mtl-text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
  cursor: pointer;
  border-bottom: 1px solid var(--mtl-border);
  white-space: nowrap;
  /* Crisp drop shadow so row 1 visibly slides UNDER the header on scroll. */
  box-shadow: 0 1px 0 var(--mtl-border), 0 2px 4px rgba(20, 26, 36, 0.06);
}
thead th:hover { background: var(--surface-3); color: var(--mtl-text-2); }
thead th .sort-arrow { color: var(--mtl-text-mute); font-size: 10px; margin-left: 4px; }
thead th.sorted .sort-arrow { color: var(--mtl-primary); }

tbody tr {
  border-bottom: 1px solid var(--mtl-border);
  cursor: pointer;
  transition: background 0.1s;
  height: 56px;
}
tbody tr:hover { background: var(--mtl-bg-hover); }
tbody tr.active { background: var(--mtl-primary-bg); box-shadow: inset 3px 0 0 var(--mtl-primary); }
tbody td { padding: 10px 14px; vertical-align: middle; }
tbody tr:last-child { border-bottom: none; }

/* 2026-06-05 — Bảng 10 cột. Width % gợi ý cho table-layout auto (giãn theo nội dung). */
.col-stt     { width: 36px; }
.col-created { width: 96px; }
.col-name    { width: 17%; }
.col-list    { width: 14%; }
.col-nick    { width: 78px; }
.col-p1      { width: 13%; }
.col-p2      { width: 13%; }
.col-reply   { width: 64px; }
.col-status  { width: 104px; }
.col-end     { width: 116px; }
/* Bảng 10 cột: padding ô gọn hơn để vừa HD 1366. */
.mt10 thead th { padding: 9px 9px; }
.mt10 tbody td { padding: 9px 9px; }
.center { text-align: center !important; }
.right  { text-align: right !important; }

/* STT + ngày */
.stt-cell { font-family: var(--mono, 'Roboto Mono', monospace); font-weight: 600; color: var(--mtl-text-mute); text-align: center; }
.date-cell { font-family: var(--mono, 'Roboto Mono', monospace); font-size: 11px; color: var(--mtl-text-2); white-space: nowrap; }

/* Phase 1/2 mini bar */
.ph { min-width: 110px; }
.ph-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 10.5px; margin-bottom: 3px; }
.ph-pct { font-family: var(--mono, monospace); font-weight: 700; color: var(--mtl-text-1); font-size: 12px; }
.ph-frac { font-family: var(--mono, monospace); color: var(--mtl-text-mute); }
.ph-bar { height: 5px; border-radius: 99px; background: var(--mtl-bg-soft); overflow: hidden; }
.ph-bar > i { display: block; height: 100%; border-radius: 99px; transition: width .3s; }
.ph-bar .p1 { background: var(--mtl-primary); }
.ph-bar .p2 { background: var(--mtl-success); }
.ph-meta { font-size: 10px; color: var(--mtl-text-3); margin-top: 3px; white-space: nowrap; }
.ph-meta b { color: var(--mtl-text-2); font-family: var(--mono, monospace); }

/* Phản hồi (căn phải, 2 dòng) */
.reply-cell { text-align: right; }
.reply-cell .reply-num { font-family: var(--mono, monospace); font-weight: 700; color: var(--mtl-text-1); }
.reply-cell .reply-num.reply-zero { color: var(--mtl-text-mute); font-weight: 500; }
.reply-sub { font-size: 10px; color: var(--mtl-text-3); margin-top: 1px; }

/* Ngày kết thúc / ETA */
.end-real { font-family: var(--mono, monospace); font-size: 11px; color: var(--mtl-text-2); white-space: nowrap; }
.end-eta { font-size: 12px; font-weight: 700; color: var(--mtl-primary); white-space: nowrap; letter-spacing: .1px; }
.end-eta.stalled { color: var(--warning); }
.end-eta.scheduled { color: var(--mtl-warning, #b45309); }
.end-sub { font-size: 10px; color: var(--mtl-text-mute); margin-top: 1px; }

.row-name { font-weight: 600; color: var(--mtl-text-1); font-size: 13px; line-height: 1.3; }
.row-sub { font-size: 11px; color: var(--mtl-text-3); margin-top: 2px; }
/* I3 2026-06-03 — ETA dự đoán còn lại: font to-rõ-đậm (Anh chốt). */
.eta-line { font-size: 13px; font-weight: 700; color: var(--mtl-primary, #1786be); margin-top: 4px; letter-spacing: 0.1px; }
.eta-line.stalled { color: #d97706; }
.text-mute { color: var(--mtl-text-mute); }

/* Progress bar */
.progress {
  width: 100%;
  height: 4px;
  background: var(--mtl-bg-soft);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}
.progress-fill { height: 100%; background: var(--mtl-primary); border-radius: 2px; transition: width 0.3s; }
.progress-fill.success { background: var(--mtl-success); }
.progress-fill.warning { background: var(--mtl-warning); }
.progress-fill.muted { background: var(--mtl-text-mute); }
.progress-row { display: flex; align-items: center; gap: 8px; }
.progress-pct { font-weight: 600; font-size: 12px; color: var(--mtl-text-2); min-width: 36px; }

/* Avatar group */
.avatars { display: flex; align-items: center; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--mtl-primary-bg);
  color: var(--mtl-primary);
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid white;
  margin-left: -8px;
  text-transform: uppercase;
}
.avatar:first-child { margin-left: 0; }
/* Palette HS đa sắc cho nick (nền nhạt + chữ đậm cùng tông) */
.avatar.a2 { background: var(--warning-soft); color: #b45309; }
.avatar.a3 { background: var(--success-soft); color: #157f3c; }
.avatar.a4 { background: var(--chip-purple-bg); color: #6d28d9; }
.avatar.a5 { background: #fce7f3; color: #be185d; }
.avatar-more {
  margin-left: 4px;
  font-size: 11px;
  color: var(--mtl-text-3);
  font-weight: 600;
}

/* Status chip */
.status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.status.running { background: var(--mtl-success-bg); color: #157f3c; }
.status.done { background: var(--mtl-primary-bg); color: var(--mtl-primary); }
.status.paused { background: var(--mtl-bg-soft); color: var(--mtl-text-2); }
.status.scheduled { background: var(--mtl-warning-bg); color: #974F00; }
.status.draft { background: var(--mtl-purple-bg); color: var(--mtl-purple); }
/* 2026-06-05 — Đã xóa (thùng rác): xám trung tính, KHÔNG đỏ gắt (chỉ là đã huỷ). */
.status.cancelled { background: var(--mtl-bg-soft); color: var(--mtl-text-3); }

/* Reply cell */
.reply-num { font-weight: 600; color: var(--mtl-text-1); }
.reply-trend { color: var(--mtl-success); font-size: 11px; margin-left: 4px; }
.reply-trend.down { color: var(--mtl-danger); }
.reply-zero { color: var(--mtl-text-mute); font-weight: 500; }

/* ============================ EMPTY / SKELETON ============================ */
.empty-cell { padding: 0 !important; }
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
}
.empty-icon { font-size: 36px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--mtl-text-1); }
.empty-desc { font-size: 13px; color: var(--mtl-text-3); margin-bottom: 8px; text-align: center; }

.skeleton-row { cursor: default; }
.skeleton-row:hover { background: var(--surface); }
.sk-bar {
  height: 10px;
  background: linear-gradient(90deg, var(--surface-3) 0%, var(--surface-2) 50%, var(--surface-3) 100%);
  background-size: 200% 100%;
  border-radius: 3px;
  animation: sk-shimmer 1.4s infinite;
  border: 1px dashed transparent;
}
.sk-bar-name { width: 70%; }
.sk-bar-sub { width: 40%; height: 8px; margin-top: 6px; }
.sk-bar-progress { width: 90%; height: 8px; }
.sk-bar-nick { width: 60%; height: 24px; border-radius: 12px; }
.sk-bar-reply { width: 40%; }
.sk-bar-status { width: 80%; height: 16px; border-radius: 4px; }
@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ============================ FOOTER PAGINATION ============================ */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 4px;
  font-size: 12px;
  color: var(--mtl-text-3);
}
.page-nav { display: flex; gap: 4px; }
.page-btn {
  min-width: 28px; height: 28px;
  padding: 0 8px;
  border: 1px solid var(--mtl-border);
  background: var(--surface);
  border-radius: 4px;
  font-size: 12px;
  color: var(--mtl-text-2);
  cursor: pointer;
  font-family: inherit;
}
.page-btn:hover:not(:disabled) { background: var(--mtl-bg-soft); }
.page-btn.active { background: var(--mtl-primary); color: white; border-color: var(--mtl-primary); }
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ============================ SIDE PANEL ============================ */
.panel-overlay {
  position: fixed; inset: 0;
  background: rgba(20, 26, 36, 0.30);
  z-index: 90;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}
.panel-overlay.show { opacity: 1; pointer-events: auto; }

.side-panel {
  position: fixed;
  top: 0; right: 0;
  height: 100vh;
  width: 460px;
  background: var(--surface);
  z-index: 100;
  transform: translateX(100%);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--mtl-shadow-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.side-panel.open { transform: translateX(0); }

.panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--mtl-border);
  background: var(--surface);
  flex-shrink: 0;
}
.panel-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.panel-title { font-size: 16px; font-weight: 700; color: var(--mtl-text-1); line-height: 1.3; margin: 0 0 6px; }
.panel-meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.panel-meta { font-size: 11px; color: var(--mtl-text-3); }
.panel-icon-btn {
  background: transparent; border: none; cursor: pointer;
  padding: 4px 8px; color: var(--mtl-text-3); font-size: 18px;
  line-height: 1; border-radius: 4px; font-family: inherit;
}
.panel-icon-btn:hover { background: var(--mtl-bg-soft); color: var(--mtl-text-1); }

.panel-body { flex: 1; overflow-y: auto; padding: 16px 20px; }

.panel-section { margin-bottom: 20px; }
.panel-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--mtl-text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px;
}

.panel-loading, .panel-error {
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

/* Stat cards */
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat-card {
  background: var(--mtl-bg-soft);
  border-radius: 6px;
  padding: 10px 12px;
}
.stat-label { font-size: 11px; color: var(--mtl-text-3); margin-bottom: 2px; }
.stat-value { font-size: 18px; font-weight: 700; color: var(--mtl-text-1); line-height: 1.1; }
.stat-card.green { background: var(--mtl-success-bg); }
.stat-card.green .stat-value { color: #157f3c; }
.stat-card.red { background: var(--mtl-danger-bg); }
.stat-card.red .stat-value { color: var(--mtl-danger); }

/* Danger CTA banner */
.cta-banner {
  background: var(--mtl-danger-bg);
  border: 1px solid #f6b9b4;
  border-radius: var(--r-sm);
  padding: 10px 12px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.cta-banner-text { flex: 1; font-size: 12px; color: #b42318; }
.cta-banner-text strong { color: var(--mtl-danger); }
.cta-banner a { color: var(--mtl-danger); font-weight: 600; text-decoration: none; font-size: 12px; white-space: nowrap; cursor: pointer; }
.cta-banner a:hover { text-decoration: underline; }

/* Phase progress */
.phase-block {
  background: var(--mtl-bg-soft);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 10px;
}
.phase-head { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--mtl-text-1); margin-bottom: 8px; }
.phase-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px;
  font-size: 12px;
  padding: 3px 0;
  color: var(--mtl-text-2);
}
.phase-row .v { font-weight: 600; color: var(--mtl-text-1); }
.phase-row.muted .v { color: var(--mtl-text-3); }

/* Nick mini table */
.nick-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.nick-table th { text-align: left; padding: 6px 4px; color: var(--mtl-text-3); font-weight: 600; font-size: 11px; border-bottom: 1px solid var(--mtl-border); }
.nick-table th:last-child, .nick-table td:last-child { text-align: right; }
.nick-table td { padding: 7px 4px; border-bottom: 1px solid var(--mtl-border); color: var(--mtl-text-1); }
/* Huy chương = số thứ hạng (thay medal emoji theo quy tắc no-emoji) */
.rank {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%; margin-right: 6px;
  font-family: var(--mono); font-size: 10.5px; font-weight: 700;
  background: var(--surface-3); color: var(--ink-3); vertical-align: middle;
}
.rank-1 { background: var(--warning-soft); color: #b45309; }
.rank-2 { background: var(--surface-3); color: var(--ink-2); }
.rank-3 { background: #f4e6da; color: #92500f; }
.accept-bar {
  display: inline-block;
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--mtl-bg-soft);
  margin-right: 6px;
  vertical-align: middle;
  position: relative;
  overflow: hidden;
}
.accept-bar .fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--mtl-success); border-radius: 2px; }

/* Panel footer */
.panel-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--mtl-border);
  background: var(--surface);
  flex-shrink: 0;
}

/* Dropdown menu */
.menu-wrap { position: relative; }
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--mtl-border);
  border-radius: 6px;
  box-shadow: var(--mtl-shadow-2);
  min-width: 160px;
  padding: 4px;
  display: none;
  z-index: 110;
}
.menu.show { display: block; }
.menu-item {
  padding: 7px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--mtl-text-2);
  cursor: pointer;
  user-select: none;
}
.menu-item:hover { background: var(--mtl-bg-soft); color: var(--mtl-text-1); }
.menu-item.danger { color: var(--mtl-danger); }
.menu-item.danger:hover { background: var(--mtl-danger-bg); }
.menu-divider { height: 1px; background: var(--mtl-border); margin: 4px 0; }
</style>
