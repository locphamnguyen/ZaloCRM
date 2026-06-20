<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-dialog v-model="show" max-width="980" persistent scrollable>
    <v-card>
      <!-- ─────────── HEADER: avatar + name + chips + progress + action strip ─────────── -->
      <div v-if="!isNew" class="cdd-header">
        <div class="cdd-header-top">
          <v-avatar size="56" color="grey-lighten-3" class="cdd-avatar">
            <v-img v-if="contact?.avatarUrl" :src="contact.avatarUrl" />
            <v-icon v-else size="28">mdi-account</v-icon>
          </v-avatar>
          <div class="cdd-header-main">
            <div class="cdd-name-row">
              <span class="cdd-name">{{ contact?.crmName || contact?.fullName || 'KH chưa đặt tên' }}</span>
              <!-- 2026-06-03: thống nhất 3 nhãn Zalo chuẩn (office-hours review) -->
              <v-chip
                v-if="contact?.hasZalo === true"
                color="success" size="x-small" variant="tonal"
              >🟢 Có Zalo</v-chip>
              <v-chip
                v-else-if="contact?.hasZalo === false"
                color="error" size="x-small" variant="tonal"
              >🔴 Không tìm thấy</v-chip>
              <v-chip
                v-else
                color="grey" size="x-small" variant="tonal"
              >⚪ Chưa tìm</v-chip>
              <v-chip v-if="contact?.source" size="x-small" variant="tonal" color="info">{{ contact.source }}</v-chip>
              <v-chip v-if="contact?.status" size="x-small" variant="tonal" color="warning">{{ contact.status }}</v-chip>
            </div>
            <div class="cdd-phone-row">
              <v-icon size="14">mdi-phone</v-icon>
              <span>{{ contact?.phone || '— chưa có SĐT —' }}</span>
              <span v-if="contact?.email" class="cdd-email">
                <v-icon size="14">mdi-email-outline</v-icon>{{ contact.email }}
              </span>
            </div>
          </div>
          <v-spacer />
          <!-- Action strip: quick edit name / appointment / share / close -->
          <div class="cdd-action-strip">
            <v-btn
              icon size="small" variant="text"
              title="Tạo lịch hẹn nhanh"
              @click="showQuickAppointment = true"
            ><v-icon>mdi-calendar-plus</v-icon></v-btn>
            <v-btn
              icon size="small" variant="text"
              title="Copy link KH"
              @click="copyShareLink"
            ><v-icon>mdi-share-variant</v-icon></v-btn>
            <v-btn icon size="small" variant="text" @click="close">
              <v-icon>mdi-close</v-icon>
            </v-btn>
          </div>
        </div>
        <!-- Progress bar hoàn thiện hồ sơ -->
        <div class="cdd-progress-row">
          <span class="cdd-progress-label">
            Hoàn thiện hồ sơ <strong>{{ profileCompletionPct }}%</strong>
            <span v-if="missingFields.length" class="cdd-progress-hint">
              · còn thiếu: {{ missingFields.slice(0, 3).join(', ') }}{{ missingFields.length > 3 ? '…' : '' }}
            </span>
          </span>
          <v-progress-linear
            :model-value="profileCompletionPct"
            :color="profileCompletionPct >= 75 ? 'success' : profileCompletionPct >= 40 ? 'warning' : 'error'"
            height="6"
            rounded
          />
        </div>
      </div>

      <!-- Simpler header cho NEW contact (không có avatar/progress) -->
      <v-card-title v-else class="d-flex align-center">
        <span>Thêm khách hàng</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="close" />
      </v-card-title>

      <v-tabs v-model="activeTab" density="compact" color="primary">
        <v-tab value="basic">Cơ bản</v-tab>
        <v-tab value="personal">Cá nhân</v-tab>
        <v-tab value="friends" :disabled="isNew">
          Friends
          <v-chip v-if="friendships.length" size="x-small" class="ml-1">{{ friendships.length }}</v-chip>
        </v-tab>
        <v-tab value="address">Địa chỉ</v-tab>
        <v-tab value="zalo">Zalo & Consent</v-tab>
        <v-tab value="activity" :disabled="isNew">Tiếp cận</v-tab>
      </v-tabs>

      <v-divider />

      <v-card-text>
        <v-tabs-window v-model="activeTab">
          <!-- ── TAB: Cơ bản ────────────────────────────────────────── -->
          <v-tabs-window-item value="basic">
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-text-field v-model="form.crmName" label="Tên CRM (tên thật)" hint="Dùng cho automation" persistent-hint />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="form.fullName" label="Tên hiển thị Zalo" :rules="[required]" />
              </v-col>

              <v-col cols="12" sm="4">
                <v-text-field v-model="form.phone" label="SĐT chính" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field v-model="form.phone2" label="SĐT 2" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field v-model="form.phone3" label="SĐT 3" />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field v-model="form.email" label="Email" type="email" />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.source"
                  :items="SOURCE_OPTIONS"
                  item-title="text"
                  item-value="value"
                  label="Nguồn"
                  clearable
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.status"
                  :items="STATUS_OPTIONS"
                  item-title="text"
                  item-value="value"
                  label="Trạng thái"
                  clearable
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="form.firstContactDate"
                  label="Ngày tiếp nhận"
                  type="date"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="form.nextAppointmentDate"
                  label="Ngày tái khám"
                  type="date"
                />
              </v-col>

              <v-col cols="12">
                <v-combobox
                  v-model="form.tags"
                  label="Tags CRM"
                  hint="Tag CRM do sale gắn (tag tự động bắt đầu bằng auto:)"
                  persistent-hint
                  multiple
                  chips
                  closable-chips
                  clearable
                />
              </v-col>

              <v-col cols="12">
                <v-textarea v-model="form.notes" label="Ghi chú" rows="3" auto-grow />
              </v-col>
            </v-row>
          </v-tabs-window-item>

          <!-- ── TAB: Cá nhân ───────────────────────────────────────── -->
          <v-tabs-window-item value="personal">
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.gender"
                  :items="GENDER_OPTIONS"
                  item-title="text"
                  item-value="value"
                  label="Giới tính"
                  clearable
                />
              </v-col>
              <v-col cols="12" sm="3">
                <v-text-field
                  v-model.number="form.birthYear"
                  label="Năm sinh"
                  type="number"
                  :min="1900"
                  :max="currentYear"
                  hint="Nhập riêng năm nếu không có ngày đầy đủ"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="3">
                <v-text-field
                  v-model="form.birthDate"
                  label="Ngày sinh"
                  type="date"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="form.occupation"
                  label="Nghề nghiệp"
                />
              </v-col>

              <!-- Computed age display -->
              <v-col cols="12" sm="6" class="d-flex align-center">
                <v-chip
                  v-if="computedAge !== null"
                  color="primary"
                  variant="tonal"
                >
                  <v-icon start>mdi-cake-variant</v-icon>
                  {{ computedAge }} tuổi
                </v-chip>
                <span v-else class="text-grey">Chưa có ngày/năm sinh</span>
              </v-col>

              <!-- Advanced toggle: hiện social + income + preferredLang chỉ khi cần -->
              <v-col cols="12">
                <v-btn
                  size="small"
                  variant="text"
                  density="compact"
                  @click="showAdvanced = !showAdvanced"
                >
                  <v-icon size="16" class="mr-1">
                    {{ showAdvanced ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
                  </v-icon>
                  {{ showAdvanced ? 'Thu gọn' : 'Nâng cao (Social, Thu nhập, Ngôn ngữ)' }}
                </v-btn>
              </v-col>

              <template v-if="showAdvanced">
                <v-col cols="12" sm="6">
                  <v-select
                    v-model="form.incomeRange"
                    :items="INCOME_RANGE_OPTIONS"
                    item-title="text"
                    item-value="value"
                    label="Mức thu nhập"
                    clearable
                  />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select
                    v-model="form.preferredLang"
                    :items="LANG_OPTIONS"
                    item-title="text"
                    item-value="value"
                    label="Ngôn ngữ ưu tiên"
                  />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field
                    v-model="form.socialFacebook"
                    label="Facebook"
                    prepend-inner-icon="mdi-facebook"
                    placeholder="username hoặc URL"
                  />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field
                    v-model="form.socialTiktok"
                    label="TikTok"
                    prepend-inner-icon="mdi-music-note"
                    placeholder="@username"
                  />
                </v-col>
              </template>
            </v-row>
          </v-tabs-window-item>

          <!-- ── TAB: Friends ───────────────────────────────────────────
               List per-pair (Friend rows). Mỗi nick Zalo chăm KH này = 1 row.
               Tên gợi nhớ inline editable + sync 2-way với Zalo Real.
               Click 💬 → nav vào chat của cặp (nick × KH). -->
          <v-tabs-window-item value="friends">
            <div v-if="loadingFriendships" class="text-center py-6">
              <v-progress-circular indeterminate size="28" />
            </div>
            <div v-else-if="!friendships.length" class="text-grey text-body-2 text-center py-6">
              KH này chưa có nick CRM nào chăm.
            </div>
            <div v-else>
              <div class="text-caption text-grey mb-2">
                {{ friendships.length }} nick CRM đang chăm KH này. "Tên gợi nhớ" sync 2-way với Zalo Real.
              </div>
              <v-table density="compact" class="friends-table">
                <thead>
                  <tr>
                    <th>Nick Zalo (Sale)</th>
                    <th>Tên Zalo gốc</th>
                    <th>Tên gợi nhớ (Zalo alias)</th>
                    <th class="text-center">KB</th>
                    <th class="text-center">Score</th>
                    <th>Last tin nhắn</th>
                    <th class="text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in friendships" :key="f.id">
                    <td>
                      <div class="d-flex align-center">
                        <v-avatar size="22" color="grey-lighten-3" class="mr-2">
                          <v-img v-if="f.zaloAccount?.avatarUrl" :src="f.zaloAccount.avatarUrl" />
                          <v-icon v-else size="14">mdi-account</v-icon>
                        </v-avatar>
                        <div>
                          <div class="text-body-2">{{ f.zaloAccount?.displayName || '—' }}</div>
                          <div class="text-caption text-grey">{{ f.zaloAccount?.phone || '' }}</div>
                        </div>
                      </div>
                    </td>
                    <td>{{ f.zaloDisplayName || f.zaloName || '—' }}</td>
                    <td>
                      <input
                        :value="f.aliasInNick || ''"
                        class="friend-alias-input"
                        placeholder="— chưa đặt —"
                        :title="'Sync 2-chiều Zalo. Đổi đây → push lên Zalo Real qua changeFriendAlias.'"
                        @change="onFriendAliasInline(f, ($event.target as HTMLInputElement).value)"
                      />
                    </td>
                    <td class="text-center">
                      <v-chip
                        :color="kindChipColor(f.relationshipKind)"
                        size="x-small"
                        variant="tonal"
                      >{{ kindChipLabel(f.relationshipKind) }}</v-chip>
                    </td>
                    <td class="text-center">
                      <input
                        type="number"
                        :value="f.leadScore ?? 0"
                        class="friend-score-input"
                        min="0" max="100"
                        @change="onFriendScoreInline(f, ($event.target as HTMLInputElement).value)"
                      />
                    </td>
                    <td class="text-caption">
                      <div v-if="f.lastInboundAt || f.lastOutboundAt">
                        <span v-if="f.lastInboundAt" class="text-grey">
                          📩 {{ formatRecentDateTime(f.lastInboundAt) }}
                        </span>
                        <span v-if="f.lastOutboundAt" class="text-primary ml-1">
                          📤 {{ formatRecentDateTime(f.lastOutboundAt) }}
                        </span>
                      </div>
                      <span v-else class="text-grey">—</span>
                    </td>
                    <td class="text-center">
                      <v-btn
                        icon size="x-small" variant="text"
                        color="primary"
                        title="Mở chat qua nick này"
                        @click="onChatFriend(f)"
                      ><v-icon size="16">mdi-message-text</v-icon></v-btn>
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-tabs-window-item>

          <!-- ── TAB: Địa chỉ ───────────────────────────────────────── -->
          <v-tabs-window-item value="address">
            <v-row dense>
              <v-col cols="12" sm="4">
                <v-text-field v-model="form.province" label="Tỉnh/Thành phố" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field v-model="form.district" label="Quận/Huyện" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field v-model="form.ward" label="Phường/Xã" />
              </v-col>
              <v-col cols="12">
                <v-textarea
                  v-model="form.addressLine"
                  label="Địa chỉ chi tiết"
                  rows="2"
                  auto-grow
                />
              </v-col>
            </v-row>
          </v-tabs-window-item>

          <!-- ── TAB: Zalo & Consent ────────────────────────────────── -->
          <v-tabs-window-item value="zalo">
            <v-row dense>
              <v-col cols="12" sm="4">
                <div class="text-caption text-grey">Zalo UID</div>
                <div class="text-body-2 font-mono">{{ contact?.zaloUid ?? '—' }}</div>
              </v-col>
              <v-col cols="12" sm="4">
                <div class="text-caption text-grey">Có Zalo?</div>
                <div class="text-body-2">
                  <v-chip
                    v-if="contact?.hasZalo === true"
                    color="success"
                    size="x-small"
                    variant="tonal"
                  >Có</v-chip>
                  <v-chip
                    v-else-if="contact?.hasZalo === false"
                    color="error"
                    size="x-small"
                    variant="tonal"
                  >Không</v-chip>
                  <span v-else class="text-grey">Chưa kiểm tra</span>
                </div>
              </v-col>
              <v-col cols="12" sm="4">
                <div class="text-caption text-grey">Lần kiểm tra cuối</div>
                <div class="text-body-2">
                  {{ contact?.zaloLookupAt ? formatDateTime(contact.zaloLookupAt) : '—' }}
                  <span v-if="contact?.zaloLookupAttempts" class="text-grey">
                    ({{ contact.zaloLookupAttempts }} lần)
                  </span>
                </div>
              </v-col>

              <v-col cols="12"><v-divider class="my-2" /></v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.consentStatus"
                  :items="CONSENT_OPTIONS"
                  item-title="text"
                  item-value="value"
                  label="Trạng thái đồng ý"
                  hint="Đánh dấu 'Đã rút' để các nick không gửi mời/tin tới KH này"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="form.consentSource"
                  label="Nguồn đồng ý"
                  placeholder="form_landing, opt_in_msg, manual..."
                />
              </v-col>
              <v-col v-if="contact?.consentRevokedAt" cols="12">
                <v-alert type="warning" density="compact" variant="tonal">
                  Đã rút đồng ý lúc {{ formatDateTime(contact.consentRevokedAt) }}
                </v-alert>
              </v-col>
            </v-row>
          </v-tabs-window-item>

          <!-- ── TAB: Tiếp cận (read-only) ──────────────────────────── -->
          <v-tabs-window-item value="activity">
            <div v-if="!contact?.id" class="text-center py-8 text-grey">
              Lưu khách hàng trước để xem lịch sử tiếp cận
            </div>
            <template v-else>
              <v-row dense>
                <v-col cols="6" sm="3">
                  <v-card variant="tonal" class="text-center pa-2">
                    <div class="text-caption text-grey">KH gửi</div>
                    <div class="text-h6">{{ contact.totalInbound ?? 0 }}</div>
                  </v-card>
                </v-col>
                <v-col cols="6" sm="3">
                  <v-card variant="tonal" color="primary" class="text-center pa-2">
                    <div class="text-caption">Sale gửi</div>
                    <div class="text-h6">{{ contact.totalOutbound ?? 0 }}</div>
                  </v-card>
                </v-col>
                <v-col cols="6" sm="3">
                  <v-card variant="tonal" color="orange" class="text-center pa-2">
                    <div class="text-caption">Lịch hẹn</div>
                    <div class="text-h6">{{ contact.totalAppointments ?? 0 }}</div>
                  </v-card>
                </v-col>
                <v-col cols="6" sm="3">
                  <v-card variant="tonal" color="success" class="text-center pa-2">
                    <div class="text-caption">Lead score</div>
                    <div class="text-h6">{{ contact.leadScore ?? 0 }}</div>
                  </v-card>
                </v-col>
              </v-row>

              <!-- Per-account activity (only nicks that have interacted) -->
              <div class="text-subtitle-2 mt-4 mb-2 d-flex align-center">
                Hoạt động theo từng nick Zalo
                <v-spacer />
                <v-btn
                  v-if="contact?.id"
                  size="x-small"
                  variant="text"
                  icon="mdi-refresh"
                  :loading="loadingActivity"
                  @click="contact?.id && loadAccountActivity(contact.id)"
                />
              </div>

              <div v-if="loadingActivity" class="text-center py-4">
                <v-progress-circular indeterminate size="24" />
              </div>
              <div
                v-else-if="accountActivity.length === 0"
                class="text-grey text-body-2 pa-3 text-center"
              >
                Chưa có nick nào trong hệ thống có tương tác với khách hàng này
              </div>
              <div v-else>
                <v-card
                  v-for="acct in accountActivity"
                  :key="acct.zaloAccountId"
                  variant="outlined"
                  class="mb-2 pa-3"
                >
                  <div class="d-flex align-center mb-2">
                    <v-avatar size="32" class="mr-2" color="grey-lighten-2">
                      <v-img v-if="acct.zaloAccount.avatarUrl" :src="acct.zaloAccount.avatarUrl" />
                      <v-icon v-else size="18">mdi-account</v-icon>
                    </v-avatar>
                    <div>
                      <div class="text-body-2 font-weight-medium">
                        {{ acct.zaloAccount.displayName ?? '(không tên)' }}
                      </div>
                      <div class="text-caption text-grey">
                        {{ acct.zaloAccount.phone ?? '—' }}
                      </div>
                    </div>
                    <v-spacer />
                    <v-chip size="x-small" variant="tonal" class="mr-1">
                      KH: {{ acct.totalInbound }}
                    </v-chip>
                    <v-chip size="x-small" variant="tonal" color="primary">
                      Sale: {{ acct.totalOutbound }}
                    </v-chip>
                  </div>

                  <div class="ml-1">
                    <div class="d-flex align-start mb-1">
                      <v-icon size="x-small" color="info" class="mr-2 mt-1">
                        mdi-message-arrow-left
                      </v-icon>
                      <div class="flex-grow-1" style="min-width: 0">
                        <template v-if="acct.lastInbound">
                          <span class="text-caption text-grey-darken-1">
                            {{ formatRecentDateTime(acct.lastInbound.sentAt) }}
                          </span>
                          <v-tooltip
                            location="top"
                            max-width="420"
                            :disabled="!acct.lastInbound.content"
                          >
                            <template #activator="{ props: tipProps }">
                              <span
                                v-bind="tipProps"
                                class="text-body-2 ml-2 d-inline-block text-truncate"
                                style="max-width: 60%; vertical-align: middle"
                              >
                                {{
                                  messagePreview(
                                    acct.lastInbound.content,
                                    acct.lastInbound.contentType,
                                  )
                                }}
                              </span>
                            </template>
                            <div class="text-pre-wrap">{{ acct.lastInbound.content }}</div>
                          </v-tooltip>
                        </template>
                        <span v-else class="text-grey text-body-2">Chưa có tin từ KH</span>
                      </div>
                    </div>

                    <div class="d-flex align-start">
                      <v-icon size="x-small" color="primary" class="mr-2 mt-1">
                        mdi-message-arrow-right
                      </v-icon>
                      <div class="flex-grow-1" style="min-width: 0">
                        <template v-if="acct.lastOutbound">
                          <span class="text-caption text-grey-darken-1">
                            {{ formatRecentDateTime(acct.lastOutbound.sentAt) }}
                          </span>
                          <v-tooltip
                            location="top"
                            max-width="420"
                            :disabled="!acct.lastOutbound.content"
                          >
                            <template #activator="{ props: tipProps }">
                              <span
                                v-bind="tipProps"
                                class="text-body-2 ml-2 d-inline-block text-truncate"
                                style="max-width: 60%; vertical-align: middle"
                              >
                                {{
                                  messagePreview(
                                    acct.lastOutbound.content,
                                    acct.lastOutbound.contentType,
                                  )
                                }}
                              </span>
                            </template>
                            <div class="text-pre-wrap">{{ acct.lastOutbound.content }}</div>
                          </v-tooltip>
                          <span
                            v-if="acct.lastOutbound.repliedBy"
                            class="text-caption text-grey ml-1"
                          >
                            — {{ acct.lastOutbound.repliedBy.fullName }}
                          </span>
                        </template>
                        <span v-else class="text-grey text-body-2">Chưa có tin từ Sale</span>
                      </div>
                    </div>
                  </div>
                </v-card>
              </div>

              <v-divider class="my-3" />

              <div class="text-subtitle-2 mb-2">Lịch sử mời kết bạn</div>
              <div v-if="loadingAttempts" class="text-center py-4">
                <v-progress-circular indeterminate size="24" />
              </div>
              <div v-else-if="attempts.length === 0" class="text-grey text-body-2 pa-2">
                Chưa có lần mời kết bạn nào
              </div>
              <v-table v-else density="compact">
                <thead>
                  <tr>
                    <th>Nick</th>
                    <th>State</th>
                    <th>Queued</th>
                    <th>Sent</th>
                    <th>Decided</th>
                    <th>Lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="a in attempts" :key="a.id">
                    <td>{{ a.zaloAccount?.displayName ?? a.zaloAccountId.slice(0, 8) }}</td>
                    <td>
                      <v-chip :color="attemptStateColor(a.state)" size="x-small" variant="tonal">
                        {{ a.state }}
                      </v-chip>
                    </td>
                    <td>{{ a.queuedAt ? formatDateTime(a.queuedAt) : '—' }}</td>
                    <td>{{ a.sentAt ? formatDateTime(a.sentAt) : '—' }}</td>
                    <td>{{ a.decidedAt ? formatDateTime(a.decidedAt) : '—' }}</td>
                    <td>
                      <span v-if="a.errorCode" class="text-error text-caption">{{ a.errorCode }}</span>
                      <span v-else class="text-grey">—</span>
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </template>
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn
          v-if="!isNew"
          color="error"
          variant="text"
          :loading="deleting"
          @click="onDelete"
        >
          Xoá
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="close">Huỷ</v-btn>
        <v-btn color="primary" :loading="saving" @click="onSave">Lưu</v-btn>
      </v-card-actions>
    </v-card>

    <!-- Modal "Nhắc hẹn" — unified Editor (chốt 2026-05-21) -->
    <AppointmentEditor
      v-if="contact?.id"
      v-model="showQuickAppointment"
      :prefill-contact="{
        id: contact.id,
        fullName: contact.fullName || contact.crmName || null,
        phone: contact.phone || null,
        zaloUid: contact.zaloUid ?? null,
        zaloUsername: contact.zaloUsername ?? null,
      }"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import type { Contact } from '@/composables/use-contacts';
import { formatInOrgTz } from '@/composables/use-org-timezone';
import AppointmentEditor from '@/components/appointments/AppointmentEditor.vue';
import {
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  GENDER_OPTIONS,
  INCOME_RANGE_OPTIONS,
  CONSENT_OPTIONS,
  useContacts,
  formatRecentDateTime,
  messagePreview,
  type AccountActivityItem,
} from '@/composables/use-contacts';

const LANG_OPTIONS = [
  { text: 'Tiếng Việt', value: 'vi' },
  { text: 'English', value: 'en' },
];

const props = defineProps<{
  modelValue: boolean;
  contact: Contact | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [contact: Contact];
  deleted: [id: string];
}>();

const { saving, deleting, createContact, updateContact, deleteContact } = useContacts();

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isNew = computed(() => !props.contact?.id);
const activeTab = ref<'basic' | 'personal' | 'friends' | 'address' | 'zalo' | 'activity'>('basic');
const currentYear = new Date().getFullYear();
const router = useRouter();
const toast = useToast();
const showQuickAppointment = ref(false);
const showAdvanced = ref(false); // toggle ẩn/hiện các field hiếm dùng

interface FormState {
  fullName: string;
  crmName: string;
  phone: string;
  phone2: string;
  phone3: string;
  email: string;
  source: string;
  status: string;
  nextAppointmentDate: string;
  firstContactDate: string;
  notes: string;
  tags: string[];
  // personal
  gender: string;
  birthYear: number | null;
  birthDate: string;
  occupation: string;
  incomeRange: string;
  socialFacebook: string;
  socialTiktok: string;
  preferredLang: string;
  // address
  province: string;
  district: string;
  ward: string;
  addressLine: string;
  // consent
  consentStatus: string;
  consentSource: string;
}

function emptyForm(): FormState {
  return {
    fullName: '',
    crmName: '',
    phone: '',
    phone2: '',
    phone3: '',
    email: '',
    source: '',
    status: '',
    nextAppointmentDate: '',
    firstContactDate: '',
    notes: '',
    tags: [],
    gender: '',
    birthYear: null,
    birthDate: '',
    occupation: '',
    incomeRange: '',
    socialFacebook: '',
    socialTiktok: '',
    preferredLang: 'vi',
    province: '',
    district: '',
    ward: '',
    addressLine: '',
    consentStatus: 'implicit',
    consentSource: '',
  };
}

const form = ref<FormState>(emptyForm());

// Attempts on activity tab
const attempts = ref<Array<{
  id: string;
  state: string;
  zaloAccountId: string;
  zaloAccount?: { id: string; displayName: string | null; phone: string | null } | null;
  queuedAt: string;
  sentAt: string | null;
  decidedAt: string | null;
  errorCode: string | null;
}>>([]);
const loadingAttempts = ref(false);

// Per-Zalo-account message activity for this contact
const accountActivity = ref<AccountActivityItem[]>([]);
const loadingActivity = ref(false);

async function loadAccountActivity(contactId: string) {
  loadingActivity.value = true;
  try {
    const res = await api.get(`/contacts/${contactId}/account-activity`);
    accountActivity.value = res.data?.items ?? [];
  } catch {
    accountActivity.value = [];
  } finally {
    loadingActivity.value = false;
  }
}

// ══════ Friends (per-pair) ════════════════════════════════════════════
// Mỗi Friend row = 1 nick CRM chăm KH này. aliasInNick sync 2-way với Zalo Real.
interface FriendshipRow {
  id: string;
  zaloUidInNick: string;
  zaloName: string | null;
  zaloDisplayName: string | null;
  aliasInNick: string | null;
  relationshipKind: string;
  leadScore: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  zaloAccount: {
    id: string;
    displayName: string | null;
    phone: string | null;
    avatarUrl: string | null;
  } | null;
}
const friendships = ref<FriendshipRow[]>([]);
const loadingFriendships = ref(false);

async function loadFriendships(contactId: string) {
  loadingFriendships.value = true;
  try {
    const res = await api.get(`/contacts/${contactId}/friendships`);
    friendships.value = res.data?.friendships ?? [];
  } catch {
    friendships.value = [];
  } finally {
    loadingFriendships.value = false;
  }
}

/** Inline edit alias trong Friends tab → PATCH /friends/:id (BE push lên Zalo qua changeFriendAlias) */
async function onFriendAliasInline(f: FriendshipRow, value: string) {
  const trimmed = (value || '').trim();
  const newAlias = trimmed.length ? trimmed : null;
  if (newAlias === (f.aliasInNick || null)) return;
  try {
    await api.patch(`/friends/${f.id}`, { aliasInNick: newAlias });
    f.aliasInNick = newAlias;
    toast.success(newAlias ? `Đã đổi tên gợi nhớ → "${newAlias}"` : 'Đã xoá tên gợi nhớ');
  } catch {
    toast.error('Lưu tên gợi nhớ thất bại');
  }
}

async function onFriendScoreInline(f: FriendshipRow, value: string) {
  const score = Math.max(0, Math.min(100, parseInt(value) || 0));
  if (score === f.leadScore) return;
  try {
    await api.patch(`/friends/${f.id}`, { leadScore: score });
    f.leadScore = score;
  } catch {
    toast.error('Lưu score thất bại');
  }
}

async function onChatFriend(f: FriendshipRow) {
  try {
    const res = await api.post<{ conversationId: string }>(
      `/friends/${f.id}/ensure-conversation`, {},
    );
    if (res.data?.conversationId) {
      router.push({ name: 'Chat', params: { convId: res.data.conversationId } });
      close();
    }
  } catch {
    toast.error(`Không mở được chat qua nick ${f.zaloAccount?.displayName || ''}`);
  }
}

function kindChipColor(kind: string): string {
  return ({
    friend: 'success',
    pending_friend: 'warning',
    chatting_stranger: 'info',
    ghost: 'grey',
  } as Record<string, string>)[kind] || 'grey';
}
function kindChipLabel(kind: string): string {
  return ({
    friend: 'Đã KB',
    pending_friend: 'Đã mời',
    chatting_stranger: 'Lạ',
    ghost: 'Ngắt',
  } as Record<string, string>)[kind] || kind;
}

// ══════ Profile completion progress ════════════════════════════════════
const FIELD_WEIGHTS: Array<{ key: keyof FormState; label: string; weight: number }> = [
  { key: 'fullName', label: 'Tên', weight: 15 },
  { key: 'phone', label: 'SĐT', weight: 25 },
  { key: 'gender', label: 'Giới tính', weight: 10 },
  { key: 'birthDate', label: 'Ngày sinh', weight: 10 },
  { key: 'source', label: 'Nguồn', weight: 10 },
  { key: 'email', label: 'Email', weight: 8 },
  { key: 'occupation', label: 'Nghề', weight: 7 },
  { key: 'addressLine', label: 'Địa chỉ', weight: 8 },
  { key: 'status', label: 'Trạng thái', weight: 7 },
];

const profileCompletionPct = computed(() => {
  let earned = 0;
  let total = 0;
  for (const f of FIELD_WEIGHTS) {
    total += f.weight;
    const v = form.value[f.key];
    if (v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
      earned += f.weight;
    }
  }
  return total > 0 ? Math.round((earned / total) * 100) : 0;
});

const missingFields = computed(() => {
  const list: string[] = [];
  for (const f of FIELD_WEIGHTS) {
    const v = form.value[f.key];
    if (v === '' || v === null || v === undefined) list.push(f.label);
  }
  return list;
});

function copyShareLink() {
  const id = props.contact?.id;
  if (!id) return;
  const url = `${window.location.origin}/customers/${id}`;
  navigator.clipboard?.writeText(url).then(() => {
    toast.success('Đã copy link KH');
  }).catch(() => {
    toast.error('Không copy được link');
  });
}

watch(() => props.contact, (c) => {
  if (c) {
    form.value = {
      fullName: c.fullName ?? '',
      crmName: c.crmName ?? '',
      phone: c.phone ?? '',
      phone2: c.phone2 ?? '',
      phone3: c.phone3 ?? '',
      email: c.email ?? '',
      source: c.source ?? '',
      status: c.status ?? '',
      nextAppointmentDate: c.nextAppointment
        ? new Date(c.nextAppointment).toISOString().split('T')[0]
        : '',
      firstContactDate: c.firstContactDate
        ? new Date(c.firstContactDate).toISOString().split('T')[0]
        : '',
      notes: c.notes ?? '',
      tags: c.tags ?? [],
      gender: c.gender ?? '',
      birthYear: c.birthYear ?? null,
      birthDate: c.birthDate
        ? new Date(c.birthDate).toISOString().split('T')[0]
        : '',
      occupation: c.occupation ?? '',
      incomeRange: c.incomeRange ?? '',
      socialFacebook: c.socialFacebook ?? '',
      socialTiktok: c.socialTiktok ?? '',
      preferredLang: c.preferredLang ?? 'vi',
      province: c.province ?? '',
      district: c.district ?? '',
      ward: c.ward ?? '',
      addressLine: c.addressLine ?? '',
      consentStatus: c.consentStatus ?? 'implicit',
      consentSource: c.consentSource ?? '',
    };
    activeTab.value = 'basic';
    if (c.id) {
      loadAttempts(c.id);
      loadAccountActivity(c.id);
      loadFriendships(c.id);
    } else {
      attempts.value = [];
      accountActivity.value = [];
      friendships.value = [];
    }
  } else {
    form.value = emptyForm();
    activeTab.value = 'basic';
    attempts.value = [];
    accountActivity.value = [];
    friendships.value = [];
  }
}, { immediate: true, deep: true });

async function loadAttempts(contactId: string) {
  loadingAttempts.value = true;
  try {
    const res = await api.get(`/campaigns/contacts/${contactId}/attempts`);
    attempts.value = res.data?.attempts ?? [];
  } catch {
    attempts.value = [];
  } finally {
    loadingAttempts.value = false;
  }
}

const computedAge = computed<number | null>(() => {
  if (form.value.birthDate) {
    const y = new Date(form.value.birthDate).getFullYear();
    if (Number.isFinite(y)) return currentYear - y;
  }
  if (form.value.birthYear && Number.isFinite(form.value.birthYear)) {
    return currentYear - form.value.birthYear;
  }
  return null;
});

function attemptStateColor(state: string) {
  const map: Record<string, string> = {
    queued: 'grey',
    looking_up: 'blue',
    sent: 'info',
    accepted: 'success',
    rejected: 'error',
    no_zalo: 'warning',
    cancelled: 'grey',
    expired: 'grey',
    error: 'error',
  };
  return map[state] ?? 'grey';
}

function formatDateTime(iso: string) {
  return formatInOrgTz(iso);
}

function required(v: string) {
  return !!v || 'Bắt buộc';
}

async function onSave() {
  const payload: Partial<Contact> & Record<string, unknown> = {
    fullName: form.value.fullName || null,
    crmName: form.value.crmName || null,
    phone: form.value.phone || null,
    phone2: form.value.phone2 || null,
    phone3: form.value.phone3 || null,
    email: form.value.email || null,
    source: form.value.source || null,
    status: form.value.status || null,
    nextAppointment: form.value.nextAppointmentDate
      ? new Date(form.value.nextAppointmentDate + 'T00:00:00').toISOString()
      : null,
    firstContactDate: form.value.firstContactDate
      ? new Date(form.value.firstContactDate + 'T00:00:00').toISOString()
      : null,
    notes: form.value.notes || null,
    tags: form.value.tags,

    gender: form.value.gender || null,
    birthYear: form.value.birthYear ?? null,
    birthDate: form.value.birthDate
      ? new Date(form.value.birthDate + 'T00:00:00').toISOString()
      : null,
    occupation: form.value.occupation || null,
    incomeRange: form.value.incomeRange || null,
    socialFacebook: form.value.socialFacebook || null,
    socialTiktok: form.value.socialTiktok || null,
    preferredLang: form.value.preferredLang || 'vi',

    province: form.value.province || null,
    district: form.value.district || null,
    ward: form.value.ward || null,
    addressLine: form.value.addressLine || null,

    consentStatus: form.value.consentStatus || 'implicit',
    consentSource: form.value.consentSource || null,
  };

  let result: Contact | null;
  if (isNew.value) {
    result = await createContact(payload);
  } else {
    result = await updateContact(props.contact!.id, payload);
  }
  if (result) {
    emit('saved', result);
    close();
  }
}

async function onDelete() {
  if (!props.contact?.id) return;
  const ok = await deleteContact(props.contact.id);
  if (ok) {
    emit('deleted', props.contact.id);
    close();
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* ──────── Header: avatar + name + chips + progress + action strip ──────── */
.cdd-header {
  padding: 14px 20px 10px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  background: linear-gradient(180deg, rgba(0,0,0,0.015), transparent);
}
.cdd-header-top {
  display: flex;
  align-items: center;
  gap: 14px;
}
.cdd-avatar {
  flex-shrink: 0;
}
.cdd-header-main {
  flex: 1;
  min-width: 0;
}
.cdd-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.cdd-name {
  font-size: 18px;
  font-weight: 600;
  color: rgba(0,0,0,0.87);
}
.cdd-phone-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: rgba(0,0,0,0.6);
}
.cdd-email {
  margin-left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cdd-action-strip {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.cdd-progress-row {
  margin-top: 10px;
}
.cdd-progress-label {
  font-size: 12px;
  color: rgba(0,0,0,0.65);
  display: block;
  margin-bottom: 3px;
}
.cdd-progress-hint {
  color: rgba(0,0,0,0.45);
}

/* ──────── Friends table inline edit ──────── */
.friends-table th {
  font-size: 11px;
  color: rgba(0,0,0,0.55);
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.friends-table td {
  font-size: 13px;
}
.friend-alias-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 6px;
  background: transparent;
  transition: border-color 0.12s, background 0.12s;
}
.friend-alias-input:focus {
  outline: none;
  border-color: var(--smax-primary, #2962ff);
  background: white;
}
.friend-alias-input::placeholder {
  color: rgba(0,0,0,0.35);
  font-style: italic;
}
.friend-score-input {
  width: 56px;
  padding: 3px 4px;
  font-size: 12px;
  text-align: center;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 4px;
  background: transparent;
}
.friend-score-input:focus {
  outline: 1.5px solid var(--smax-primary, #2962ff);
  background: white;
}
</style>
