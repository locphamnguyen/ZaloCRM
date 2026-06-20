<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="system-notify-page airtable-scope">
    <!-- 2026-06-04 (Anh chốt) — redesign Atlas v2: topbar + 4 tab ngang. -->
    <div class="sn-topbar">
      <div class="sn-topbar-title">
        <div class="sn-ico">🔔</div>
        <div>
          <div class="sn-h1">Thông báo hệ thống</div>
          <div class="sn-sub">Nick tổ chức tự gửi thông báo nội bộ cho nhân viên · tin chào mừng khi tạo tài khoản</div>
        </div>
      </div>
      <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="loadingRecipients || loadingLogs" @click="refreshAll">
        Làm mới
      </v-btn>
    </div>

    <!-- 2026-06-10: gộp còn 3 tab — 'Cấu hình gửi' cũ (1 dropdown) dồn vào đầu
         tab 'Nhân viên nhận' vì cùng luồng: chọn nick gửi → xem ai nhận. -->
    <v-tabs v-model="activeTab" class="sn-tabs" color="primary" density="comfortable">
      <v-tab value="people">
        👥 Nhân viên nhận
        <span class="sn-tab-cnt">{{ recipients.length }}</span>
      </v-tab>
      <v-tab value="welcome">📨 Tin chào mừng</v-tab>
      <v-tab value="logs">
        📜 Lịch sử gửi
        <span class="sn-tab-cnt">{{ logTotal }}</span>
      </v-tab>
    </v-tabs>

    <v-window v-model="activeTab" class="sn-window">
      <!-- ════ TAB: TIN CHÀO MỪNG ════
           Atlas v3 2026-06-08 (anh chốt): sao chép "edit block view Zalo" — soạn WYSIWYG
           (bôi đậm/màu/cỡ) bên trái + bong bóng Zalo render LIVE bên phải. KHÔNG gõ **markup**. -->
      <v-window-item value="welcome">
    <div class="wm-editor">
      <!-- ── Cột trái: soạn tin ── -->
      <section class="wm-compose">
        <div class="wm-compose-head">
          <div>
            <div class="wm-compose-title">📨 Tin chào mừng khi tạo user mới</div>
            <div class="wm-compose-sub">
              Khi admin tạo sale mới + check SĐT Zalo OK, hệ thống tự gửi tin đăng nhập này. Bôi đen chữ rồi bấm Đậm / Màu / Cỡ như soạn trên Zalo.
            </div>
          </div>
          <button class="wm-reset-btn" title="Khôi phục mẫu mặc định" @click="resetTemplate">
            <v-icon size="14">mdi-restore</v-icon> Khôi phục mẫu
          </button>
        </div>

        <div class="wm-card">
          <RichTextEditor
            ref="welcomeEditorRef"
            :model-value="welcomeRichText"
            :show-toolbar="true"
            :submit-on-enter="false"
            placeholder="Soạn nội dung tin chào mừng..."
            class="wm-rich"
            @update:model-value="onWelcomeRichInput"
          />

          <!-- Chip chèn biến cá nhân hoá tại con trỏ (giống block editor) -->
          <div class="wm-var-bar">
            <span class="wm-var-bar-label"><v-icon size="13">mdi-cursor-text</v-icon> Chèn biến (bấm để chèn tại con trỏ):</span>
            <button
              v-for="p in PLACEHOLDER_HELP"
              :key="p.key"
              type="button"
              class="wm-var-chip"
              :title="p.desc + ' — chèn tại vị trí đang gõ'"
              @click="insertPlaceholder(p.key)"
            >
              <code>{{ placeholderLabel(p.key) }}</code>
              <span class="wm-var-chip-label">{{ p.short }}</span>
            </button>
          </div>
          <div class="wm-editor-footer">
            <span class="wm-hint">
              <v-icon size="13">mdi-lightbulb-on-outline</v-icon>
              Biến tự thay khi gửi cho từng sale. Dòng có biến rỗng (phòng ban…) sẽ tự ẩn.
            </span>
            <span class="wm-char-counter">{{ welcomeRichText.length }} ký tự</span>
          </div>
        </div>

        <!-- Ảnh + SĐT admin fallback -->
        <div class="wm-extras">
          <div class="welcome-image-block">
            <div class="wm-field-label">Ảnh đính kèm (gửi kèm tin)</div>
            <div class="welcome-image-preview">
              <img v-if="welcomeImageUrl" :src="welcomeImageUrl" alt="Welcome" />
              <div v-else class="text-caption text-disabled pa-3">Chưa có ảnh</div>
            </div>
            <input ref="imageFileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="d-none" @change="onImagePicked" />
            <div class="d-flex ga-2 mt-2">
              <v-btn size="small" variant="tonal" :loading="imageUploading" @click="imageFileInput?.click()">⬆ Chọn ảnh</v-btn>
              <v-btn v-if="welcomeImageUrl" size="small" variant="text" color="error" @click="clearImage">🗑 Xoá</v-btn>
            </div>
          </div>

          <div class="wm-phone-block">
            <div class="wm-field-label">SĐT admin nhận tin lỗi</div>
            <v-text-field
              v-model="adminFallbackPhone"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              placeholder="VD: 0908278807"
              class="admin-phone-field"
            />
            <div class="wm-field-hint">Khi gửi sale thất bại, hệ thống nhắn vào SĐT này để admin chuyển thủ công.</div>
          </div>
        </div>

        <div class="wm-actions">
          <v-btn variant="text" :disabled="!orgConfigDirty" @click="discardOrgConfigChanges">Huỷ thay đổi</v-btn>
          <v-btn
            color="primary"
            :loading="savingOrgConfig"
            :disabled="!orgConfigDirty"
            prepend-icon="mdi-content-save-outline"
            @click="saveOrgConfig"
          >
            Lưu cấu hình
          </v-btn>
        </div>
        <v-alert v-if="orgConfigError" type="error" density="compact" class="mt-2">{{ orgConfigError }}</v-alert>
        <v-alert v-if="orgConfigSuccess" type="success" density="compact" class="mt-2">{{ orgConfigSuccess }}</v-alert>
      </section>

      <!-- ── Cột phải: xem trước trên Zalo LIVE ── -->
      <aside class="wm-preview">
        <div class="wm-preview-head">
          <span><v-icon size="15">mdi-cellphone</v-icon> Xem trước trên Zalo</span>
          <span class="wm-live"><span class="wm-live-dot"></span> LIVE</span>
        </div>
        <div class="wm-variant-toggle">
          <button :class="{ active: previewVariant === 'stranger' }" @click="previewVariant = 'stranger'">Chưa kết bạn</button>
          <button :class="{ active: previewVariant === 'friend' }" @click="previewVariant = 'friend'">Đã kết bạn</button>
        </div>
        <div class="wm-zalo-window">
          <div class="wm-zalo-time-label">
            <v-icon size="12">mdi-cellphone</v-icon> Sale sẽ thấy thế này · {{ currentHHmm }}
          </div>
          <div v-if="welcomeImageUrl" class="wm-zalo-img-bubble">
            <img :src="welcomeImageUrl" alt="welcome" />
          </div>
          <div class="wm-zalo-bubble out" v-html="livePreviewHtml"></div>
          <div class="wm-zalo-time">{{ currentHHmm }} · <span class="wm-zalo-tin">Tin đăng nhập</span></div>
          <div v-if="previewError" class="wm-zalo-err">{{ previewError }}</div>
        </div>
        <div class="wm-preview-foot">
          <v-icon size="13">mdi-information-outline</v-icon>
          Dữ liệu giả: Nguyễn Văn A · 0931… · mật khẩu a3k7p9
        </div>
      </aside>
    </div>
      </v-window-item>

      <!-- ════ TAB 3: NHÂN VIÊN NHẬN ════ -->
      <v-window-item value="people">
    <!-- ── Cấu hình nick gửi (gộp từ tab Cấu hình cũ 2026-06-10) ── -->
    <div class="sn-sender-bar">
      <!-- Avatar nick hệ thống đang chọn (load từ danh sách nick Zalo) -->
      <img v-if="selectedSender?.avatarUrl" :src="selectedSender.avatarUrl" class="sn-nick-ava sn-nick-ava-lg" :alt="selectedSender.displayName || 'Nick'" />
      <span v-else-if="selectedSender" class="sn-nick-ava sn-nick-ava-lg sn-nick-ava-ph">🔔</span>
      <v-select
        v-model="senderId"
        :items="senderOptions"
        item-title="label"
        item-value="value"
        label="Nick Zalo gửi thông báo hệ thống"
        variant="outlined"
        density="compact"
        clearable
        hide-details="auto"
        :loading="loadingSettings || savingSender"
        class="sender-select"
        @update:model-value="saveSender"
      >
        <!-- Avatar nick trong từng dòng dropdown -->
        <template #item="{ item, props: itemProps }">
          <v-list-item v-bind="itemProps">
            <template #prepend>
              <img v-if="nickAvatar(item.value)" :src="nickAvatar(item.value)!" class="sn-nick-ava" alt="nick avatar" />
              <span v-else class="sn-nick-ava sn-nick-ava-ph">🔔</span>
            </template>
          </v-list-item>
        </template>
      </v-select>
      <v-chip v-if="selectedSender" :color="selectedSender.status === 'connected' ? 'success' : 'warning'" variant="flat" size="small" class="sn-sender-chip">
        <v-icon start size="14">{{ selectedSender.status === 'connected' ? 'mdi-check-circle' : 'mdi-pause-circle' }}</v-icon>
        {{ selectedSender.status === 'connected' ? 'Đang kết nối' : 'Offline' }}
      </v-chip>
      <v-chip v-else color="grey" variant="tonal" size="small" class="sn-sender-chip">Chưa chọn nick gửi</v-chip>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        :loading="recheckingAll"
        :disabled="!senderId || recheckingAll"
        prepend-icon="mdi-refresh"
        @click="recheckAll"
      >
        Check hàng loạt
      </v-btn>
    </div>
    <div class="sn-sender-hint">
      <v-icon size="14" class="mr-1">mdi-information-outline</v-icon>
      Đổi nick gửi thì bấm <strong>Check hàng loạt</strong> để dò lại UID theo góc nhìn nick mới (UID cũ của nick khác không dùng chung).
    </div>
    <v-alert v-if="senderError" type="error" density="compact" class="mb-3">{{ senderError }}</v-alert>

    <!-- KPI (2026-06-10: theo cơ chế Check Live) -->
    <div class="sn-kpi-grid">
      <div class="sn-kpi green"><div class="sn-kpi-val">{{ summary.ready || 0 }}</div><div class="sn-kpi-lbl">✅ Sẵn sàng nhận</div></div>
      <div class="sn-kpi amber"><div class="sn-kpi-val">{{ (summary.uid_not_found || 0) + (summary.missing_internal_contact || 0) + (summary.missing_internal_phone || 0) }}</div><div class="sn-kpi-lbl">🟡 Chưa Check Live</div></div>
      <div class="sn-kpi red"><div class="sn-kpi-val">{{ (summary.lookup_failed || 0) + (summary.sender_disconnected || 0) + (summary.missing_system_sender || 0) }}</div><div class="sn-kpi-lbl">🔴 Lỗi / offline</div></div>
      <div class="sn-kpi"><div class="sn-kpi-val">{{ recipients.length }}</div><div class="sn-kpi-lbl">Tổng nhân viên</div></div>
    </div>

    <v-alert v-if="lookupError" type="error" density="compact" class="mb-3">{{ lookupError }}</v-alert>
    <v-alert v-if="lookupSuccess" type="success" density="compact" class="mb-3">{{ lookupSuccess }}</v-alert>

    <!-- ── Bảng nhân viên nhận (redesign Atlas v2 2026-06-10) ── -->
    <div class="sn-table-card">
      <table class="sn-rtable">
        <thead>
          <tr>
            <th>Nhân viên</th>
            <th>Phòng ban / Chức vụ</th>
            <th>SĐT nhân viên</th>
            <th>UID (góc nhìn nick gửi)</th>
            <th>Trạng thái</th>
            <th class="ta-right">Hành động</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in recipients" :key="row.user.id" class="sn-rrow">
            <td>
              <div class="sn-emp">
                <img v-if="row.user.avatarUrl" :src="row.user.avatarUrl" class="sn-emp-avatar-img" :alt="row.user.fullName" />
                <span v-else class="sn-emp-avatar">{{ (row.user.fullName || '?').charAt(0).toUpperCase() }}</span>
                <div class="sn-emp-info">
                  <div class="sn-emp-name">{{ row.user.fullName }}</div>
                  <div class="sn-emp-mail">{{ row.user.email }}</div>
                </div>
              </div>
            </td>
            <td>
              <div class="sn-dept">{{ row.user.departmentMember?.department?.name || 'Chưa gán' }}</div>
              <div class="sn-role">{{ row.user.departmentMember?.deptRole || roleLabel(row.user.role) }}<template v-if="row.user.permissionGroup?.name"> · {{ row.user.permissionGroup.name }}</template></div>
            </td>
            <td>
              <span v-if="row.user.phone" class="sn-phone">{{ formatVnPhone(row.user.phone) }}</span>
              <v-chip v-else size="x-small" color="warning" variant="tonal">Chưa có SĐT</v-chip>
            </td>
            <td>
              <code v-if="row.recipient.threadIdInSenderView" class="sn-uid">{{ row.recipient.threadIdInSenderView }}</code>
              <span v-else class="sn-uid-empty">—</span>
            </td>
            <td>
              <v-chip size="small" :color="statusColor(row.recipient.status)" variant="tonal" class="sn-status-chip">
                {{ statusLabel(row.recipient.status) }}
              </v-chip>
              <div v-if="row.recipient.error" class="recipient-err">{{ row.recipient.error }}</div>
            </td>
            <td class="ta-right">
              <v-btn
                size="small"
                variant="tonal"
                color="primary"
                prepend-icon="mdi-account-search"
                :loading="lookupUserId === row.user.id"
                :disabled="!canLookup(row)"
                @click="lookupUid(row)"
              >
                Check Live
              </v-btn>
            </td>
          </tr>
          <tr v-if="!loadingRecipients && recipients.length === 0">
            <td colspan="6" class="sn-rempty">Chưa có nhân viên để kiểm tra.</td>
          </tr>
          <tr v-if="loadingRecipients">
            <td colspan="6" class="sn-rempty">Đang tải danh sách...</td>
          </tr>
        </tbody>
      </table>
    </div>
      </v-window-item>

      <!-- ════ TAB 4: LỊCH SỬ GỬI (2026-06-04 Anh chốt) ════
           Log: gửi gì, cho ai, thành công/thất bại, đã nhận/đã xem, lọc theo loại. -->
      <v-window-item value="logs">
    <!-- Thống kê đếm — KPI tile -->
    <div class="sn-kpi-grid">
      <div class="sn-kpi green"><div class="sn-kpi-val">{{ logStatusCounts.sent || 0 }}</div><div class="sn-kpi-lbl">✅ Đã gửi</div></div>
      <div class="sn-kpi red"><div class="sn-kpi-val">{{ logStatusCounts.failed || 0 }}</div><div class="sn-kpi-lbl">❌ Thất bại</div></div>
      <div class="sn-kpi amber"><div class="sn-kpi-val">{{ logStatusCounts.pending || 0 }}</div><div class="sn-kpi-lbl">⏳ Đang chờ</div></div>
      <div class="sn-kpi"><div class="sn-kpi-val">{{ logTotal }}</div><div class="sn-kpi-lbl">Tổng tin</div></div>
    </div>

    <!-- Bộ lọc -->
    <v-card variant="outlined" class="pa-3 mb-3 notify-card">
      <div class="d-flex flex-wrap ga-3 align-center">
        <v-select
          v-model="logFilterType"
          :items="typeFilterOptions"
          item-title="label"
          item-value="value"
          label="Loại tin"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          style="max-width: 220px"
          @update:model-value="onLogFilterChange"
        />
        <v-select
          v-model="logFilterStatus"
          :items="statusFilterOptions"
          item-title="label"
          item-value="value"
          label="Trạng thái"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          style="max-width: 180px"
          @update:model-value="onLogFilterChange"
        />
        <v-select
          v-model="logFilterChannel"
          :items="channelFilterOptions"
          item-title="label"
          item-value="value"
          label="Kênh"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          style="max-width: 160px"
          @update:model-value="onLogFilterChange"
        />
        <v-text-field
          v-model="logFilterFrom"
          type="date"
          label="Từ ngày"
          variant="outlined"
          density="compact"
          hide-details
          style="max-width: 170px"
          @update:model-value="onLogFilterChange"
        />
        <v-text-field
          v-model="logFilterTo"
          type="date"
          label="Đến ngày"
          variant="outlined"
          density="compact"
          hide-details
          style="max-width: 170px"
          @update:model-value="onLogFilterChange"
        />
        <v-btn v-if="hasLogFilter" size="small" variant="text" @click="clearLogFilter">Xoá lọc</v-btn>
      </div>
    </v-card>

    <v-card variant="outlined" class="notify-card">
      <v-table density="comfortable" class="recipient-table log-table">
        <thead>
          <tr>
            <th style="width: 150px">Thời gian</th>
            <th style="width: 160px">Loại tin</th>
            <th>Người nhận</th>
            <th>Nội dung</th>
            <th style="width: 120px">Kênh</th>
            <th style="width: 150px">Trạng thái</th>
            <th style="width: 130px">Đã nhận/xem</th>
            <th class="text-right" style="width: 90px">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="log in logs"
            :key="log.id"
            class="log-row"
            style="cursor: pointer"
            @click="openLogDetail(log)"
          >
            <td>
              <div class="text-body-2">{{ fmtDateTime(log.createdAt) }}</div>
            </td>
            <td>
              <v-chip size="x-small" :color="typeColor(log.type)" variant="tonal">
                {{ typeIcon(log.type) }} {{ typeLabel(log.type) }}
              </v-chip>
            </td>
            <td>
              <div class="font-weight-medium">{{ log.targetUser?.fullName || '—' }}</div>
              <div class="text-caption text-medium-emphasis">{{ log.targetUser?.email || '' }}</div>
            </td>
            <td>
              <div class="text-body-2 log-content-preview">{{ logTitleLine(log) }}</div>
            </td>
            <td>
              <v-chip size="x-small" :color="log.channel === 'zalo' ? 'primary' : 'grey'" variant="tonal">
                {{ log.channel === 'zalo' ? 'Zalo' : 'CRM' }}
              </v-chip>
            </td>
            <td>
              <v-chip size="small" :color="logStatusColor(log.status)" variant="tonal">
                {{ logStatusLabel(log.status) }}
              </v-chip>
            </td>
            <td>
              <span :title="readReceiptTitle(log)">{{ readReceiptLabel(log) }}</span>
            </td>
            <td class="text-right" @click.stop>
              <v-btn
                v-if="log.status === 'failed'"
                size="x-small"
                variant="tonal"
                color="primary"
                :loading="retryingId === log.id"
                @click="retryLog(log)"
              >
                Gửi lại
              </v-btn>
              <span v-else class="text-medium-emphasis text-caption">—</span>
            </td>
          </tr>
          <tr v-if="!loadingLogs && logs.length === 0">
            <td colspan="8" class="text-center text-medium-emphasis py-6">Chưa có thông báo nào khớp bộ lọc.</td>
          </tr>
          <tr v-if="loadingLogs">
            <td colspan="8" class="text-center text-medium-emphasis py-6">Đang tải lịch sử...</td>
          </tr>
        </tbody>
      </v-table>
      <div v-if="logTotal > logs.length" class="text-center py-3">
        <v-btn variant="text" :loading="loadingLogs" @click="loadMoreLogs">Tải thêm ({{ logs.length }}/{{ logTotal }})</v-btn>
      </div>
    </v-card>
      </v-window-item>
    </v-window>

    <!-- Popup kết quả Check Live (2026-06-10) -->
    <v-dialog v-model="checkLiveDialog" max-width="480">
      <v-card v-if="checkLiveResult" class="pa-2">
        <v-card-title class="d-flex align-center ga-2">
          <template v-if="checkLiveResult.verdict === 'pass'">
            <v-icon color="success">mdi-check-circle</v-icon> UID đúng
          </template>
          <template v-else-if="checkLiveResult.verdict === 'updated'">
            <v-icon color="info">mdi-autorenew</v-icon> Đã cập nhật UID mới
          </template>
          <template v-else-if="checkLiveResult.verdict === 'name_mismatch'">
            <v-icon color="error">mdi-alert</v-icon> Cảnh báo: UID lệch người
          </template>
          <template v-else>
            <v-icon color="warning">mdi-account-question</v-icon> Không tìm thấy Zalo
          </template>
        </v-card-title>
        <v-card-text>
          <div class="mb-2"><strong>Nhân viên:</strong> {{ checkLiveResult.userName }}</div>
          <div v-if="checkLiveResult.verdict === 'pass'" class="text-success">
            UID khớp đúng người (<strong>{{ checkLiveResult.zaloName }}</strong>). Sẵn sàng nhận thông báo.
          </div>
          <div v-else-if="checkLiveResult.verdict === 'updated'">
            <div class="text-info mb-1">UID đã thay đổi và được cập nhật lại cho đúng.</div>
            <div class="text-caption">UID cũ: <code>{{ checkLiveResult.previousUid || '—' }}</code></div>
            <div class="text-caption">UID mới: <code>{{ checkLiveResult.uid }}</code> (<strong>{{ checkLiveResult.zaloName }}</strong>)</div>
          </div>
          <div v-else-if="checkLiveResult.verdict === 'name_mismatch'" class="text-error">
            UID tìm được trỏ tới <strong>"{{ checkLiveResult.zaloName }}"</strong> — KHÔNG khớp nhân viên
            <strong>"{{ checkLiveResult.userName }}"</strong>. Đã CHẶN để tránh gửi nhầm.
            Kiểm tra lại SĐT nhân viên hoặc danh bạ nick gửi.
          </div>
          <div v-else class="text-warning">
            {{ checkLiveResult.error || 'SĐT này không có tài khoản Zalo.' }}
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="checkLiveDialog = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Popup kết quả Check hàng loạt -->
    <v-dialog v-model="recheckAllDialog" max-width="560">
      <v-card v-if="recheckAllResult" class="pa-2">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon color="primary">mdi-refresh</v-icon> Kết quả check hàng loạt
        </v-card-title>
        <v-card-text>
          <div class="d-flex flex-wrap ga-2 mb-3">
            <v-chip size="small" color="success" variant="tonal">✅ Đúng: {{ recheckAllResult.summary.ready || 0 }}</v-chip>
            <v-chip size="small" color="info" variant="tonal">🔄 Đã đổi UID: {{ recheckAllResult.summary.updated || 0 }}</v-chip>
            <v-chip size="small" color="error" variant="tonal">⚠️ Lệch người: {{ recheckAllResult.summary.mismatch || 0 }}</v-chip>
            <v-chip size="small" color="warning" variant="tonal">Không Zalo: {{ recheckAllResult.summary.no_zalo || 0 }}</v-chip>
            <v-chip size="small" variant="tonal">Lỗi tra: {{ recheckAllResult.summary.failed || 0 }}</v-chip>
          </div>
          <div v-if="recheckAllResult.changes.length" class="text-caption text-medium-emphasis mb-1">Thay đổi đáng chú ý:</div>
          <v-list v-if="recheckAllResult.changes.length" density="compact">
            <v-list-item v-for="(c, i) in recheckAllResult.changes" :key="i">
              <template #prepend>
                <v-icon size="small" :color="c.verdict === 'updated' ? 'info' : 'error'">
                  {{ c.verdict === 'updated' ? 'mdi-autorenew' : 'mdi-alert' }}
                </v-icon>
              </template>
              <v-list-item-title class="text-body-2">
                {{ c.userName }} → {{ c.verdict === 'updated' ? 'cập nhật UID mới' : 'LỆCH người' }} ({{ c.zaloName }})
              </v-list-item-title>
            </v-list-item>
          </v-list>
          <div v-else class="text-success text-body-2">Tất cả UID đã đúng, không có thay đổi.</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="recheckAllDialog = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Panel chi tiết tin -->
    <v-dialog v-model="showLogDetail" max-width="560">
      <v-card v-if="detailLog" class="pa-1">
        <v-card-title class="d-flex align-center ga-2">
          <v-chip size="small" :color="typeColor(detailLog.type)" variant="tonal">
            {{ typeIcon(detailLog.type) }} {{ typeLabel(detailLog.type) }}
          </v-chip>
          <v-chip size="small" :color="logStatusColor(detailLog.status)" variant="tonal">
            {{ logStatusLabel(detailLog.status) }}
          </v-chip>
        </v-card-title>
        <v-card-text>
          <div class="detail-row"><span class="detail-k">Người nhận</span><span>{{ detailLog.targetUser?.fullName }} ({{ detailLog.targetUser?.email }})</span></div>
          <div class="detail-row"><span class="detail-k">Nick gửi</span><span>{{ detailLog.senderNick?.displayName || 'CRM (không gửi Zalo)' }}</span></div>
          <div class="detail-row"><span class="detail-k">Kênh</span><span>{{ detailLog.channel === 'zalo' ? 'Zalo' : 'CRM panel' }}</span></div>
          <div class="detail-row"><span class="detail-k">Tạo lúc</span><span>{{ fmtDateTime(detailLog.createdAt) }}</span></div>
          <div class="detail-row"><span class="detail-k">Gửi lúc</span><span>{{ detailLog.sentAt ? fmtDateTime(detailLog.sentAt) : '—' }}</span></div>
          <div class="detail-row"><span class="detail-k">Đã nhận/xem</span><span>{{ readReceiptLabel(detailLog) }} <span class="text-caption text-medium-emphasis">{{ readReceiptTitle(detailLog) }}</span></span></div>
          <div v-if="detailLog.error" class="detail-row"><span class="detail-k">Lỗi</span><span class="text-error">{{ detailLog.error }}</span></div>
          <v-divider class="my-3" />
          <div class="text-caption text-medium-emphasis mb-1">Nội dung tin</div>
          <pre class="detail-content">{{ detailLog.content }}</pre>
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="detailLog.conversationId"
            variant="text"
            prepend-icon="mdi-chat"
            @click="goToConversation(detailLog)"
          >
            Mở hội thoại
          </v-btn>
          <v-spacer />
          <v-btn
            v-if="detailLog.status === 'failed'"
            color="primary"
            variant="tonal"
            :loading="retryingId === detailLog.id"
            @click="retryLog(detailLog)"
          >
            Gửi lại
          </v-btn>
          <v-btn variant="text" @click="showLogDetail = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import { api } from '@/api/index';
import RichTextEditor from '@/components/chat/rich-text-editor.vue';
import { zaloRichToMarkup } from '@/utils/zalo-rich-to-markup';

interface SenderNick {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  zaloUid?: string | null;
  phone?: string | null;
  status: string;
}

interface RecipientRow {
  user: {
    id: string;
    fullName: string;
    email: string;
    phone?: string | null;
    avatarUrl?: string | null;
    role: string;
    departmentMember: { deptRole: string | null; department: { id: string; name: string; path: string } | null } | null;
    permissionGroup: { id: string; name: string; isSystem: boolean } | null;
  };
  internalContactNick: { id: string; displayName: string | null; avatarUrl?: string | null; phone?: string | null; status: string } | null;
  recipient: {
    id: string;
    status: string;
    error: string | null;
    conversationId: string | null;
    threadIdInSenderView: string | null;
    lastVerifiedAt: string;
  };
}

// 2026-06-04 — Atlas v2 redesign: tab ngang. 2026-06-10: gộp còn 3 tab, mặc định 'people'.
const activeTab = ref<'welcome' | 'people' | 'logs'>('people');

const loadingSettings = ref(false);
const loadingRecipients = ref(false);
const savingSender = ref(false);
const senderError = ref('');
const lookupError = ref('');
const lookupSuccess = ref('');
const senderId = ref<string | null>(null);
const nicks = ref<SenderNick[]>([]);
const recipients = ref<RecipientRow[]>([]);
const summary = ref<Record<string, number>>({});
const lookupUserId = ref<string | null>(null);

// ── Org config: welcome template + image + admin fallback phone ──
// Atlas v3 2026-06-08: soạn WYSIWYG (RichTextEditor) thay textarea markup.
// welcomeTemplate = markup string lưu DB (vẫn giữ để {{biến}} literal + dirty-tracking);
// welcomeRichText = text thuần trong editor (char counter). Editor là nguồn sự thật khi gõ:
// mỗi keystroke → đọc {text,styles} → zaloRichToMarkup → welcomeTemplate.
const welcomeTemplate = ref<string>('');
const welcomeRichText = ref<string>('');
const welcomeImageUrl = ref<string | null>(null);
const adminFallbackPhone = ref<string>('');
const defaultTemplate = ref<string>('');
const savedSnapshot = ref<{ template: string; image: string | null; phone: string }>({ template: '', image: null, phone: '' });
const savingOrgConfig = ref(false);
const orgConfigError = ref('');
const orgConfigSuccess = ref('');
const imageUploading = ref(false);
const imageFileInput = ref<HTMLInputElement | null>(null);

type RichEditorExposed = {
  getRichPayload: () => { text: string; styles: Array<{ st: string; start: number; len: number }> };
  applyRichPayload: (p: { text: string; styles?: Array<{ st: string; start: number; len: number }> }, opts?: { focus?: boolean }) => void;
  insertText: (text: string) => void;
  focus: (position?: 'start' | 'end' | number) => void;
};
const welcomeEditorRef = ref<RichEditorExposed | null>(null);
const applyingWelcomeRich = ref(false); // guard vòng lặp applyRichPayload ↔ update

const previewVariant = ref<'friend' | 'stranger'>('stranger');
const livePreviewHtml = ref<string>('');
const previewError = ref<string>('');

// Giờ HH:mm VN cho nhãn "Sale sẽ thấy lúc..." trong bong bóng preview (giờ VN per memory).
const currentHHmm = computed(() => {
  const d = new Date();
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
});

function placeholderLabel(key: string): string {
  return '{{' + key + '}}';
}

// short = nhãn ngắn trên chip (giống bed-var-chip-label block editor).
const PLACEHOLDER_HELP = [
  { key: 'fullName', short: 'Tên sale', desc: 'Họ tên sale' },
  { key: 'phone', short: 'SĐT login', desc: 'SĐT đăng nhập' },
  { key: 'password', short: 'Mật khẩu', desc: 'Mật khẩu tạm tự sinh' },
  { key: 'loginUrl', short: 'Link CRM', desc: 'Link CRM (ENV CRM_LOGIN_URL)' },
  { key: 'orgName', short: 'Tổ chức', desc: 'Tên tổ chức' },
  { key: 'email', short: 'Email', desc: 'Email (nếu có)' },
  { key: 'departmentName', short: 'Phòng ban', desc: 'Phòng ban (rỗng → dòng biến mất)' },
  { key: 'roleName', short: 'Chức vụ', desc: 'Chức vụ' },
  { key: 'adminPhone', short: 'SĐT admin', desc: 'SĐT admin fallback (ô bên cạnh)' },
];

const orgConfigDirty = computed(() =>
  welcomeTemplate.value !== savedSnapshot.value.template ||
  welcomeImageUrl.value !== savedSnapshot.value.image ||
  adminFallbackPhone.value !== savedSnapshot.value.phone,
);

// ── Render bong bóng Zalo LIVE (COPY applyRichFormat từ BlockEditorDialog) ──
// Render {text, styles[]} (mã Zalo b/i/u/s/c_HEX/f_NN) → HTML escaped cho bubble.
interface ZaloStyleR { st: string; start: number; len: number }
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function rOpen(st: string): string {
  if (st === 'b') return '<strong>';
  if (st === 'i') return '<em>';
  if (st === 'u') return '<u>';
  if (st === 's') return '<s>';
  if (st.startsWith('c_')) return `<span style="color:#${st.slice(2)}">`;
  if (st.startsWith('f_')) return `<span style="font-size:${st.slice(2)}px">`;
  return '';
}
function rClose(st: string): string {
  if (st === 'b') return '</strong>';
  if (st === 'i') return '</em>';
  if (st === 'u') return '</u>';
  if (st === 's') return '</s>';
  if (st.startsWith('c_') || st.startsWith('f_')) return '</span>';
  return '';
}
function applyRichFormat(text: string, sList: ZaloStyleR[]): string {
  if (!text) return '';
  const len = text.length;
  const perChar: string[][] = Array.from({ length: len }, () => []);
  for (const m of sList) {
    const start = Math.max(0, m.start | 0);
    const end = Math.min(len, start + (m.len | 0));
    for (let i = start; i < end; i++) perChar[i].push(m.st);
  }
  let out = '';
  let prevKey = '';
  let prevList: string[] = [];
  for (let i = 0; i < len; i++) {
    const cur = perChar[i].slice().sort();
    const curKey = cur.join(',');
    if (curKey !== prevKey) {
      out += [...prevList].reverse().map(rClose).join('');
      out += cur.map(rOpen).join('');
      prevList = cur;
      prevKey = curKey;
    }
    const ch = text[i];
    if (ch === '\n') out += '<br>';
    else if (ch !== '\r') out += escHtml(ch);
  }
  out += [...prevList].reverse().map(rClose).join('');
  return out;
}

// Gọi /preview-welcome (debounce) để render bong bóng với data giả + đúng style Zalo +
// dòng nhắc kết bạn theo variant. Reuse backend builder → preview = tin gửi thật.
let previewTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { void refreshLivePreview(); }, 350);
}
async function refreshLivePreview() {
  previewError.value = '';
  try {
    const { data } = await api.post('/system-notifications/preview-welcome', {
      templateOverride: welcomeTemplate.value.trim() || undefined,
      variant: previewVariant.value,
    });
    livePreviewHtml.value = applyRichFormat(data.text || '', data.styles || []);
  } catch (err: any) {
    previewError.value = err?.response?.data?.error || 'Lỗi tạo xem trước';
  }
}
watch(previewVariant, () => { void refreshLivePreview(); });

// ── Editor ↔ markup sync ────────────────────────────────────────────────
// Mỗi keystroke: đọc payload editor → zaloRichToMarkup → welcomeTemplate (lưu DB) → preview.
function onWelcomeRichInput() {
  if (applyingWelcomeRich.value) return; // update do applyRichPayload phát ra → bỏ qua
  const payload = welcomeEditorRef.value?.getRichPayload();
  if (!payload) return;
  welcomeRichText.value = payload.text;
  welcomeTemplate.value = zaloRichToMarkup(payload.text, payload.styles || []);
  schedulePreview();
}

// Nạp markup vào editor: compile (BE) markup → {text,styles} → applyRichPayload.
async function loadMarkupIntoEditor(markup: string) {
  const { data } = await api.post('/system-notifications/compile-template', { template: markup });
  await nextTick();
  if (!welcomeEditorRef.value) return;
  applyingWelcomeRich.value = true;
  welcomeEditorRef.value.applyRichPayload({ text: data.text || '', styles: data.styles || [] });
  welcomeRichText.value = data.text || '';
  await nextTick();
  applyingWelcomeRich.value = false;
}

function insertPlaceholder(key: string) {
  const ed = welcomeEditorRef.value;
  if (!ed) return;
  ed.insertText(placeholderLabel(key));
  onWelcomeRichInput();
}

// Vuetify v-window-item lazy-mount: editor tab "welcome" chỉ render khi active → ref
// welcomeEditorRef CHƯA tồn tại lúc onMounted/fetchOrgConfig chạy (tab mặc định = 'config').
// → nạp markup vào editor KHI chuyển sang tab welcome (đợi editor mount xong).
const welcomeEditorLoaded = ref(false);
watch(activeTab, async (tab) => {
  if (tab !== 'welcome' || welcomeEditorLoaded.value) return;
  await nextTick(); // chờ v-window-item render + RichTextEditor mount
  // retry vài nhịp cho chắc editor đã expose ref (TipTap useEditor async).
  for (let i = 0; i < 10 && !welcomeEditorRef.value; i++) await nextTick();
  if (!welcomeEditorRef.value) return;
  await loadMarkupIntoEditor(welcomeTemplate.value || defaultTemplate.value);
  welcomeEditorLoaded.value = true;
  void refreshLivePreview();
});

const senderOptions = computed(() => nicks.value.map((nick) => ({
  value: nick.id,
  label: `${nick.displayName || 'Nick chưa đặt tên'}${nick.status === 'connected' ? '' : ' (offline)'}`,
})));

const selectedSender = computed(() => nicks.value.find((nick) => nick.id === senderId.value) || null);

// Lookup avatar nick theo id (cho slot v-select, type-safe — không dùng item.raw)
function nickAvatar(id: string | null | undefined): string | null {
  if (!id) return null;
  return nicks.value.find((n) => n.id === id)?.avatarUrl || null;
}

async function fetchSettings() {
  loadingSettings.value = true;
  senderError.value = '';
  try {
    const { data } = await api.get('/system-notifications/settings');
    senderId.value = data.systemNotifyZaloAccountId ?? null;
    nicks.value = data.nicks || [];
  } catch (err: any) {
    senderError.value = err?.response?.data?.error || 'Lỗi tải cấu hình thông báo hệ thống';
  } finally {
    loadingSettings.value = false;
  }
}

async function fetchRecipients() {
  loadingRecipients.value = true;
  try {
    const { data } = await api.get('/system-notifications/recipients');
    recipients.value = data.recipients || [];
    summary.value = data.summary || {};
  } finally {
    loadingRecipients.value = false;
  }
}

async function saveSender(value: unknown) {
  savingSender.value = true;
  senderError.value = '';
  lookupError.value = '';
  lookupSuccess.value = '';
  try {
    await api.patch('/system-notifications/settings/sender', { zaloAccountId: value || null });
    await fetchRecipients();
  } catch (err: any) {
    senderError.value = err?.response?.data?.error || 'Lỗi lưu nick gửi thông báo hệ thống';
  } finally {
    savingSender.value = false;
  }
}

// Check Live (2026-06-10): nút chỉ cần user CÓ SĐT (bỏ phụ thuộc nick nội bộ cũ).
function canLookup(row: RecipientRow) {
  return Boolean(senderId.value && row.user.phone && lookupUserId.value !== row.user.id);
}

// Popup kết quả Check Live
const checkLiveDialog = ref(false);
const checkLiveResult = ref<{
  verdict: string; userName: string; zaloName: string | null;
  uid: string | null; previousUid: string | null; changed: boolean; error: string | null;
} | null>(null);

async function lookupUid(row: RecipientRow) {
  lookupUserId.value = row.user.id;
  lookupError.value = '';
  lookupSuccess.value = '';
  try {
    const { data } = await api.post(`/system-notifications/recipients/${row.user.id}/check-live`);
    const recipient = data.recipient;
    if (recipient) {
      row.recipient = {
        id: recipient.id,
        status: recipient.status,
        error: recipient.error,
        conversationId: recipient.conversationId ?? row.recipient.conversationId,
        threadIdInSenderView: recipient.threadIdInSenderView,
        lastVerifiedAt: recipient.lastVerifiedAt,
      };
    }
    // Mở popup báo admin kết quả (đúng/đổi UID/lệch tên/không có Zalo)
    checkLiveResult.value = {
      verdict: data.verdict,
      userName: data.userName ?? row.user.fullName,
      zaloName: data.zaloName ?? null,
      uid: data.uid ?? null,
      previousUid: data.previousUid ?? null,
      changed: Boolean(data.changed),
      error: data.error ?? null,
    };
    checkLiveDialog.value = true;
    await fetchRecipients();
  } catch (err: any) {
    lookupError.value = err?.response?.data?.error || 'Lỗi Check Live';
    await fetchRecipients();
  } finally {
    lookupUserId.value = null;
  }
}

// Check hàng loạt khi đổi nick gửi
const recheckingAll = ref(false);
const recheckAllResult = ref<{ summary: Record<string, number>; changes: Array<{ userName: string | null; verdict: string; zaloName: string | null }> } | null>(null);
const recheckAllDialog = ref(false);

async function recheckAll() {
  recheckingAll.value = true;
  lookupError.value = '';
  try {
    const { data } = await api.post('/system-notifications/recipients/recheck-all');
    recheckAllResult.value = { summary: data.summary, changes: data.changes ?? [] };
    recheckAllDialog.value = true;
    await fetchRecipients();
  } catch (err: any) {
    lookupError.value = err?.response?.data?.error || 'Lỗi check hàng loạt';
  } finally {
    recheckingAll.value = false;
  }
}

function statusColor(status: string) {
  if (status === 'ready') return 'success';
  if (status === 'uid_not_found' || status === 'missing_internal_phone' || status === 'missing_internal_contact') return 'warning';
  if (status === 'sender_disconnected' || status === 'missing_system_sender' || status === 'lookup_failed') return 'error';
  return 'grey';
}

function statusLabel(status: string) {
  // 2026-06-10: nhãn theo cơ chế MỚI (Check Live), bỏ khái niệm "nick nội bộ" cũ.
  return ({
    ready: 'Sẵn sàng nhận',
    missing_system_sender: 'Chưa chọn nick gửi',
    missing_internal_contact: 'Chưa Check Live',
    missing_internal_phone: 'Thiếu SĐT',
    sender_disconnected: 'Nick gửi offline',
    uid_not_found: 'Chưa có UID / lệch',
    lookup_failed: 'Lỗi tìm UID',
    invalid: 'Chưa kiểm tra',
  } as Record<string, string>)[status] || status;
}

function roleLabel(role: string) {
  return ({ owner: 'Chủ tổ chức', admin: 'Admin', member: 'Nhân viên' } as Record<string, string>)[role] || role;
}

// Format SĐT kiểu Việt Nam: 84365925267 → 0365 925 267 (đồng bộ ContactsView).
function formatVnPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  let s = String(phone).replace(/\D/g, '');
  if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  else if (s.length === 9 && !s.startsWith('0')) s = '0' + s;
  if (s.length === 10 || s.length === 11) return s.slice(0, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  return phone;
}

async function fetchOrgConfig() {
  try {
    const { data } = await api.get('/system-notifications/org-config');
    defaultTemplate.value = data.defaultTemplate ?? '';
    // Ô trống = chưa cấu hình → fill mẫu mặc định sẵn vào editor cho admin sửa (anh dặn).
    welcomeTemplate.value = data.welcomeMessageTemplate ?? defaultTemplate.value;
    welcomeImageUrl.value = data.welcomeImageUrl ?? null;
    adminFallbackPhone.value = data.adminFallbackPhone ?? '';
    // Snapshot = giá trị GỐC từ DB (template gốc có thể null → coi như rỗng, để nút Lưu sáng
    // khi admin chỉ "xác nhận" mẫu mặc định). Dùng welcomeMessageTemplate thực, không phải default.
    savedSnapshot.value = {
      template: data.welcomeMessageTemplate ?? '',
      image: welcomeImageUrl.value,
      phone: adminFallbackPhone.value,
    };
    // Nếu editor đã mount (user đang ở tab welcome) → nạp ngay; nếu chưa, watcher activeTab lo.
    if (welcomeEditorRef.value && !welcomeEditorLoaded.value) {
      await loadMarkupIntoEditor(welcomeTemplate.value || defaultTemplate.value);
      welcomeEditorLoaded.value = true;
    }
    void refreshLivePreview();
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Lỗi tải cấu hình tin chào mừng';
  }
}

async function saveOrgConfig() {
  savingOrgConfig.value = true;
  orgConfigError.value = '';
  orgConfigSuccess.value = '';
  try {
    await api.patch('/system-notifications/org-config', {
      welcomeMessageTemplate: welcomeTemplate.value.trim() || null,
      welcomeImageUrl: welcomeImageUrl.value,
      adminFallbackPhone: adminFallbackPhone.value.trim() || null,
    });
    savedSnapshot.value = {
      template: welcomeTemplate.value,
      image: welcomeImageUrl.value,
      phone: adminFallbackPhone.value,
    };
    orgConfigSuccess.value = 'Lưu thành công';
    setTimeout(() => { orgConfigSuccess.value = ''; }, 3000);
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Lỗi lưu cấu hình';
  } finally {
    savingOrgConfig.value = false;
  }
}

function discardOrgConfigChanges() {
  // Khôi phục về bản đã lưu (snapshot rỗng = chưa từng lưu → dùng mẫu mặc định cho editor).
  welcomeTemplate.value = savedSnapshot.value.template;
  welcomeImageUrl.value = savedSnapshot.value.image;
  adminFallbackPhone.value = savedSnapshot.value.phone;
  orgConfigError.value = '';
  orgConfigSuccess.value = '';
  void loadMarkupIntoEditor(welcomeTemplate.value || defaultTemplate.value);
  void refreshLivePreview();
}

function resetTemplate() {
  welcomeTemplate.value = defaultTemplate.value;
  void loadMarkupIntoEditor(defaultTemplate.value).then(() => {
    // loadMarkupIntoEditor không tự set welcomeTemplate; giữ default đã set ở trên để dirty bật.
    schedulePreview();
  });
}

async function onImagePicked(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  imageUploading.value = true;
  orgConfigError.value = '';
  try {
    const fd = new FormData();
    fd.append('image', file);
    const { data } = await api.post('/system-notifications/welcome-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    welcomeImageUrl.value = data.url;
    savedSnapshot.value.image = data.url; // server-side đã commit, sync snapshot
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Upload ảnh thất bại';
  } finally {
    imageUploading.value = false;
    if (target) target.value = '';
  }
}

async function clearImage() {
  welcomeImageUrl.value = null;
  // Force save ngay vì image upload đã save vào DB lúc upload — clear local-only sẽ misalign.
  // Đơn giản: gọi PATCH để xoá luôn.
  try {
    await api.patch('/system-notifications/org-config', { welcomeImageUrl: null });
    savedSnapshot.value.image = null;
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Xoá ảnh thất bại';
  }
}

// ════════════════════════════════════════════════════════════════════════
// 2026-06-04 (Anh chốt) — LỊCH SỬ GỬI THÔNG BÁO HỆ THỐNG
// ════════════════════════════════════════════════════════════════════════
interface LogItem {
  id: string;
  type: string;
  title: string;
  content: string;
  priority: string;
  channel: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  conversationId: string | null;
  targetUser: { id: string; fullName: string; email: string } | null;
  senderNick: { id: string; displayName: string | null } | null;
  deliveredAt: string | null;
  seenAt: string | null;
}

const logs = ref<LogItem[]>([]);
const logTotal = ref(0);
const loadingLogs = ref(false);
const logStatusCounts = ref<Record<string, number>>({});
const logFilterType = ref<string | null>(null);
const logFilterStatus = ref<string | null>(null);
const logFilterChannel = ref<string | null>(null);
const logFilterFrom = ref<string>('');
const logFilterTo = ref<string>('');
const logOffset = ref(0);
const LOG_PAGE = 50;

const retryingId = ref<string | null>(null);
const showLogDetail = ref(false);
const detailLog = ref<LogItem | null>(null);

// 9 loại tin nội bộ + test → nhãn tiếng Việt + màu + icon (Anh: dễ hiểu, không jargon).
const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  'customer-reply':     { label: 'KH trả lời',      color: 'error',   icon: '🔥' },
  'reaction-negative':  { label: 'Cảm xúc xấu',     color: 'error',   icon: '😡' },
  'customer-block':     { label: 'KH chặn nick',    color: 'error',   icon: '🚫' },
  'friend-accept':      { label: 'Đồng ý kết bạn',  color: 'success', icon: '🤝' },
  'friend-accept-late': { label: 'Đồng ý (trễ)',    color: 'success', icon: '🕐' },
  'reaction-positive':  { label: 'Cảm xúc tốt',     color: 'warning', icon: '❤️' },
  'friend-reject':      { label: 'Từ chối kết bạn', color: 'grey',    icon: '❌' },
  'no-zalo':            { label: 'Không có Zalo',    color: 'grey',    icon: '📵' },
  'send-error':         { label: 'Lỗi gửi kết bạn', color: 'warning', icon: '⚠️' },
  'test':               { label: 'Tin test',        color: 'info',    icon: '🧪' },
};
function typeLabel(t: string): string { return TYPE_META[t]?.label ?? t; }
function typeColor(t: string): string { return TYPE_META[t]?.color ?? 'grey'; }
function typeIcon(t: string): string { return TYPE_META[t]?.icon ?? '📨'; }

const typeFilterOptions = computed(() =>
  Object.entries(TYPE_META).map(([value, m]) => ({ value, label: `${m.icon} ${m.label}` })),
);
const statusFilterOptions = [
  { value: 'sent', label: '✅ Đã gửi' },
  { value: 'failed', label: '❌ Thất bại' },
  { value: 'pending', label: '⏳ Đang chờ' },
];
const channelFilterOptions = [
  { value: 'zalo', label: 'Zalo' },
  { value: 'crm_panel', label: 'CRM panel' },
];

function logStatusLabel(s: string): string {
  if (s === 'sent') return '✅ Đã gửi';
  if (s === 'failed') return '❌ Thất bại';
  if (s === 'pending') return '⏳ Đang chờ';
  return s;
}
function logStatusColor(s: string): string {
  if (s === 'sent') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'pending') return 'warning';
  return 'grey';
}

// Đã nhận/đã xem — chỉ tin gửi qua Zalo thành công mới có (delivered/seen từ Message).
function readReceiptLabel(log: LogItem): string {
  if (log.channel !== 'zalo' || log.status !== 'sent') return '—';
  if (log.seenAt) return '👀 Đã xem';
  if (log.deliveredAt) return '✓✓ Đã nhận';
  return '✓ Đã gửi';
}
function readReceiptTitle(log: LogItem): string {
  if (log.channel !== 'zalo' || log.status !== 'sent') return 'Không gửi qua Zalo';
  if (log.seenAt) return `KH xem lúc ${fmtDateTime(log.seenAt)}`;
  if (log.deliveredAt) return `KH nhận lúc ${fmtDateTime(log.deliveredAt)}`;
  return 'Đã gửi, chưa nhận xác nhận';
}

function logTitleLine(log: LogItem): string {
  // Tin styled (mới): dòng đầu content = tiêu đề. Tin cũ: dùng title.
  const firstLine = (log.content ?? '').split('\n')[0]?.trim();
  return firstLine || log.title || '(không nội dung)';
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const hasLogFilter = computed(
  () => !!(logFilterType.value || logFilterStatus.value || logFilterChannel.value || logFilterFrom.value || logFilterTo.value),
);

async function fetchLogs(reset = true) {
  loadingLogs.value = true;
  try {
    if (reset) logOffset.value = 0;
    const params: Record<string, string> = {
      limit: String(LOG_PAGE),
      offset: String(logOffset.value),
    };
    if (logFilterType.value) params.type = logFilterType.value;
    if (logFilterStatus.value) params.status = logFilterStatus.value;
    if (logFilterChannel.value) params.channel = logFilterChannel.value;
    if (logFilterFrom.value) params.from = `${logFilterFrom.value}T00:00:00`;
    if (logFilterTo.value) params.to = `${logFilterTo.value}T23:59:59`;
    const { data } = await api.get('/system-notifications/logs', { params });
    if (reset) logs.value = data.items ?? [];
    else logs.value = [...logs.value, ...(data.items ?? [])];
    logTotal.value = data.total ?? 0;
    logStatusCounts.value = data.statusCounts ?? {};
  } catch (err) {
    logs.value = [];
    logTotal.value = 0;
  } finally {
    loadingLogs.value = false;
  }
}

function onLogFilterChange() { fetchLogs(true); }
function clearLogFilter() {
  logFilterType.value = null;
  logFilterStatus.value = null;
  logFilterChannel.value = null;
  logFilterFrom.value = '';
  logFilterTo.value = '';
  fetchLogs(true);
}
function loadMoreLogs() {
  logOffset.value += LOG_PAGE;
  fetchLogs(false);
}

function openLogDetail(log: LogItem) {
  detailLog.value = log;
  showLogDetail.value = true;
}

async function retryLog(log: LogItem) {
  retryingId.value = log.id;
  try {
    await api.post(`/system-notifications/logs/${log.id}/retry`);
    showLogDetail.value = false;
    await fetchLogs(true);
  } catch (err) {
    /* lỗi retry — giữ nguyên, fetch lại để thấy bản ghi mới nếu có */
    await fetchLogs(true);
  } finally {
    retryingId.value = null;
  }
}

function goToConversation(log: LogItem) {
  if (!log.conversationId) return;
  window.open(`/chat?conversationId=${log.conversationId}`, '_blank');
}

// Làm mới toàn trang (nút topbar) — refresh dữ liệu tab đang xem + recipients.
async function refreshAll() {
  await Promise.all([fetchRecipients(), fetchLogs(true)]);
}

onMounted(async () => {
  await fetchSettings();
  await fetchRecipients();
  await fetchOrgConfig();
  await fetchLogs();
});
</script>

<style scoped>
.system-notify-page {
  max-width: 1180px;
}

/* ══════ Atlas v2 redesign (2026-06-04, Anh chốt) ══════
   Khớp design system marketing-unified + airtable.css.
   primary #0068ff, topbar + tab ngang + KPI tile accent. */
:root, .system-notify-page {
  --at-primary: #0068ff; --at-primary-soft: #e7f0ff;
  --at-ink: #181d26; --at-muted: #6b778c; --at-hairline: #e6e8eb;
  --at-success: #36b37e; --at-danger: #de350b; --at-warning: #ff8b00;
}

/* Topbar */
.sn-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 16px; flex-wrap: wrap;
}
.sn-topbar-title { display: flex; align-items: center; gap: 12px; }
.sn-ico {
  width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0;
  background: var(--at-primary-soft); color: var(--at-primary);
  display: flex; align-items: center; justify-content: center; font-size: 20px;
}
.sn-h1 { font-size: 19px; font-weight: 700; color: var(--at-ink); line-height: 1.2; }
.sn-sub { font-size: 12.5px; color: var(--at-muted); margin-top: 2px; }

/* Tabs — Vuetify v-tabs nhưng tinh chỉnh sang Atlas */
.sn-tabs { border-bottom: 1px solid var(--at-hairline); margin-bottom: 20px; }
.sn-tabs :deep(.v-tab) { text-transform: none; font-weight: 500; letter-spacing: 0; font-size: 13.5px; }
.sn-tab-cnt {
  font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 9999px;
  background: rgba(0,0,0,.06); color: var(--at-muted); margin-left: 6px;
}
.sn-window { overflow: visible; }
.sn-window :deep(.v-window__container) { overflow: visible; }

/* KPI tiles (accent border-left) */
.sn-kpi-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px; margin-bottom: 16px;
}
.sn-kpi {
  background: #fff; border: 1px solid var(--at-hairline); border-radius: 12px;
  padding: 14px 16px; border-left: 4px solid var(--at-hairline);
}
.sn-kpi.green { border-left-color: var(--at-success); }
.sn-kpi.red   { border-left-color: var(--at-danger); }
.sn-kpi.amber { border-left-color: var(--at-warning); }
.sn-kpi-val { font-size: 24px; font-weight: 700; color: var(--at-ink); line-height: 1; }
.sn-kpi.green .sn-kpi-val { color: #1b6b46; }
.sn-kpi.red .sn-kpi-val   { color: var(--at-danger); }
.sn-kpi.amber .sn-kpi-val { color: #92400e; }
.sn-kpi-lbl {
  font-size: 11px; font-weight: 600; color: var(--at-muted);
  text-transform: uppercase; letter-spacing: .4px; margin-top: 6px;
  display: flex; align-items: center; gap: 4px;
}

.notify-card {
  border-color: rgba(var(--v-theme-outline), 0.18);
}

.sender-select {
  min-width: 320px;
  max-width: 520px;
}

.recipient-table :deep(td),
.recipient-table :deep(th) {
  white-space: nowrap;
}
/* 2026-06-04 — bảng dài hơn vùng main (sidebar CRM 256px) → cho cuộn ngang
   để cột cuối (Thao tác / Đã nhận-xem) không bị cắt mép phải. */
.recipient-table :deep(.v-table__wrapper) {
  overflow-x: auto;
}
/* Atlas v3 2026-06-08 — nới rộng để tab "Tin chào mừng" đủ 2 cột (editor + preview Zalo).
   HD-first: container min 1280 cho layout 2 cột thoáng. */
.system-notify-page { max-width: 1280px; }

.uid-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
/* Text lỗi/cảnh báo lệch người — giới hạn 2 dòng, không vỡ layout HD 1366 */
.recipient-err {
  max-width: 260px;
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.35;
  color: #b45309;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ══════ Tab Nhân viên nhận — gộp cấu hình + bảng redesign (2026-06-10) ══════ */
.sn-sender-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  margin-bottom: 8px;
}
.sn-sender-chip { font-weight: 600; }
.sn-sender-hint {
  display: flex;
  align-items: center;
  font-size: 12.5px;
  color: #64748b;
  margin: 0 2px 16px;
}
/* Avatar nick hệ thống trong dropdown */
.sn-nick-opt { display: flex; align-items: center; gap: 8px; }
.sn-nick-ava {
  width: 24px; height: 24px; border-radius: 50%;
  object-fit: cover; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.sn-nick-ava-ph { background: #e0f2fe; font-size: 13px; }
.sn-nick-ava-lg { width: 38px; height: 38px; border: 1px solid #e5e7eb; }

/* Bảng redesign — Atlas v2: header nền nhạt, hàng thoáng, hover, zebra nhẹ */
.sn-table-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow-x: auto;  /* HD 1366: bảng dày → cuộn ngang, cột Hành động không bị cắt */
  background: #fff;
}
.sn-rtable {
  width: 100%;
  min-width: 920px;
  border-collapse: collapse;
  font-size: 13px;
}
.sn-rtable thead th {
  text-align: left;
  padding: 11px 16px;
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  border-bottom: 1px solid #e5e7eb;
  white-space: nowrap;
}
.sn-rtable td {
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.sn-rrow:last-child td { border-bottom: none; }
.sn-rrow:hover td { background: #f8fafc; }
.ta-right { text-align: right; }

/* Cột nhân viên: avatar + tên + email */
.sn-emp { display: flex; align-items: center; gap: 10px; }
.sn-emp-avatar,
.sn-emp-avatar-img {
  width: 34px; height: 34px; border-radius: 50%;
  flex-shrink: 0;
}
.sn-emp-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; font-weight: 600; font-size: 14px;
}
.sn-emp-avatar-img { object-fit: cover; border: 1px solid #e5e7eb; }
.sn-emp-name { font-weight: 600; color: #1e293b; }
.sn-emp-mail { font-size: 11.5px; color: #94a3b8; }
.sn-dept { color: #334155; }
.sn-role { font-size: 11.5px; color: #94a3b8; margin-top: 1px; }
.sn-phone { font-weight: 600; color: #1e293b; font-variant-numeric: tabular-nums; }

/* UID badge gọn */
.sn-uid {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  background: #f1f5f9;
  color: #475569;
  padding: 2px 7px;
  border-radius: 5px;
}
.sn-uid-empty { color: #cbd5e1; }
.sn-status-chip { font-weight: 600; }
.sn-rempty { text-align: center; color: #94a3b8; padding: 32px 0; }

/* ══════ Atlas v3 — Tin chào mừng kiểu "edit block Zalo" (2026-06-08) ══════
   2 cột: soạn WYSIWYG trái + bong bóng Zalo render LIVE phải. Copy hệ token bubble
   từ BlockEditorDialog (nền xanh nhạt gradient, bubble trắng viền xám). */
.wm-editor {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 1100px) {
  .wm-editor { grid-template-columns: 1fr; }
}

.wm-compose { min-width: 0; }
.wm-compose-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 12px; flex-wrap: wrap;
}
.wm-compose-title { font-size: 15px; font-weight: 700; color: var(--at-ink); }
.wm-compose-sub { font-size: 12px; color: var(--at-muted); margin-top: 3px; max-width: 560px; line-height: 1.45; }
.wm-reset-btn {
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: 1px solid var(--at-hairline);
  padding: 6px 11px; border-radius: 8px; cursor: pointer;
  font-size: 12px; font-weight: 600; color: var(--at-muted); font-family: inherit;
  white-space: nowrap; flex-shrink: 0;
}
.wm-reset-btn:hover { border-color: var(--at-primary); color: var(--at-primary); background: var(--at-primary-soft); }

.wm-card {
  background: #fff; border: 1px solid var(--at-hairline);
  border-radius: 12px; padding: 14px; margin-bottom: 16px;
}
/* RichTextEditor cao thoáng cho soạn tin nhiều dòng */
.wm-rich :deep(.tiptap-input) { min-height: 280px; max-height: 460px; font-size: 13.5px; }

/* Chip chèn biến — copy bed-var-bar/bed-var-chip của block editor */
.wm-var-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  padding-top: 12px; margin-top: 10px; border-top: 1px solid var(--at-hairline);
}
.wm-var-bar-label {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600; color: var(--at-muted);
}
.wm-var-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 9px; border-radius: 9999px;
  border: 1px solid #b9d4ff; background: var(--at-primary-soft);
  color: var(--at-primary); font-size: 11px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: transform 0.12s, background 0.12s;
}
.wm-var-chip:hover { background: #d8e8ff; transform: translateY(-1px); }
.wm-var-chip:active { transform: translateY(0); }
.wm-var-chip code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px; background: transparent; color: inherit;
}
.wm-var-chip-label { color: var(--at-muted); font-weight: 500; font-size: 10px; }

.wm-editor-footer {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; margin-top: 10px; font-size: 11px; color: var(--at-muted);
}
.wm-hint { display: inline-flex; align-items: center; gap: 4px; }
.wm-char-counter { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-variant-numeric: tabular-nums; flex-shrink: 0; }

/* Ảnh + SĐT admin */
.wm-extras { display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 16px; align-items: flex-start; }
.wm-field-label {
  font-size: 11px; font-weight: 700; color: var(--at-muted);
  text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px;
}
.wm-field-hint { font-size: 11px; color: var(--at-muted); margin-top: 5px; line-height: 1.4; max-width: 280px; }
.wm-phone-block { flex: 1 1 260px; min-width: 240px; }

.wm-actions { display: flex; justify-content: flex-end; gap: 8px; }

.welcome-image-block { flex: 0 0 auto; }
.welcome-image-preview {
  width: 180px; height: 120px;
  border: 1px dashed rgba(var(--v-theme-outline), 0.4);
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  overflow: hidden; background: rgba(var(--v-theme-surface-variant), 0.3);
}
.welcome-image-preview img { width: 100%; height: 100%; object-fit: cover; }
.admin-phone-field { max-width: 280px; }

/* ── Cột phải: xem trước Zalo LIVE (copy bed-col3) ── */
.wm-preview {
  position: sticky; top: 12px;
  border: 1px solid var(--at-hairline); border-radius: 12px; overflow: hidden;
  background: linear-gradient(180deg, #e3f2fd 0%, #bbdefb 100%);
  display: flex; flex-direction: column;
}
.wm-preview-head {
  padding: 11px 14px; background: #fff; border-bottom: 1px solid var(--at-hairline);
  font-size: 12px; font-weight: 600; color: var(--at-ink);
  display: flex; justify-content: space-between; align-items: center;
}
.wm-preview-head > span:first-child { display: inline-flex; align-items: center; gap: 6px; }
.wm-live { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--at-muted); }
.wm-live-dot { width: 7px; height: 7px; background: var(--at-success); border-radius: 50%; animation: wmpulse 1.4s ease-in-out infinite; }
@keyframes wmpulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }

.wm-variant-toggle {
  display: flex; gap: 0; padding: 8px 10px 0; background: linear-gradient(180deg, #e3f2fd 0%, #e3f2fd 100%);
}
.wm-variant-toggle button {
  flex: 1; padding: 6px 8px; font-size: 11.5px; font-weight: 600;
  border: 1px solid var(--at-hairline); background: rgba(255,255,255,0.6);
  color: var(--at-muted); cursor: pointer; font-family: inherit;
}
.wm-variant-toggle button:first-child { border-radius: 8px 0 0 8px; border-right: 0; }
.wm-variant-toggle button:last-child { border-radius: 0 8px 8px 0; }
.wm-variant-toggle button.active { background: var(--at-primary); border-color: var(--at-primary); color: #fff; }

.wm-zalo-window {
  flex: 1; padding: 14px 12px; display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; max-height: 64vh;
  background: linear-gradient(180deg, #e3f2fd 0%, #cfe5fb 100%);
}
.wm-zalo-time-label {
  align-self: center; display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: #475569; padding: 4px 10px; font-weight: 500;
}
.wm-zalo-img-bubble {
  align-self: flex-end; max-width: 75%; border-radius: 14px;
  border-bottom-right-radius: 5px; overflow: hidden; border: 1px solid #e3e6ea;
}
.wm-zalo-img-bubble img { display: block; width: 100%; height: auto; max-height: 180px; object-fit: cover; }
.wm-zalo-bubble {
  max-width: 88%; padding: 10px 14px; border-radius: 14px;
  font-size: 13px; line-height: 1.55; word-wrap: break-word; white-space: pre-wrap;
}
.wm-zalo-bubble.out {
  background: #fff; color: #1f2328; border: 1px solid #e3e6ea;
  align-self: flex-end; border-bottom-right-radius: 5px;
}
.wm-zalo-bubble :deep(strong) { font-weight: 700; }
.wm-zalo-bubble :deep(em) { font-style: italic; }
.wm-zalo-bubble :deep(u) { text-decoration: underline; }
.wm-zalo-bubble :deep(s) { text-decoration: line-through; }
.wm-zalo-time {
  font-size: 10px; color: #475569; align-self: flex-end; padding: 0 6px; margin-top: -2px;
  display: inline-flex; align-items: center; gap: 4px;
}
.wm-zalo-tin { background: rgba(255,255,255,0.6); padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.wm-zalo-err {
  align-self: center; font-size: 11px; color: var(--at-danger);
  background: rgba(255,255,255,0.8); padding: 8px 12px; border-radius: 8px; text-align: center;
}
.wm-preview-foot {
  display: flex; justify-content: center; align-items: center; gap: 6px;
  padding: 9px 12px; background: rgba(255,255,255,0.75); border-top: 1px solid var(--at-hairline);
  font-size: 10.5px; color: var(--at-primary); font-weight: 500; text-align: center;
}

/* ── Log thông báo hệ thống (2026-06-04) ── */
.log-table :deep(tr.log-row:hover) {
  background: rgba(var(--v-theme-primary), 0.04);
}
.log-content-preview {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-row {
  display: flex;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
}
.detail-k {
  flex: 0 0 110px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-weight: 500;
}
.detail-content {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  white-space: pre-wrap;
  line-height: 1.5;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  padding: 10px;
  border-radius: 8px;
  margin: 0;
  max-height: 40vh;
  overflow: auto;
}
</style>
