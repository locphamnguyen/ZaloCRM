<template>
  <div class="mtw-page">
    <!-- Header HS .mkt-top scaffold -->
    <div class="mkt-top">
      <div>
        <div class="mtt">{{ isEditMode ? 'Sửa Mục tiêu' : 'Tạo Mục tiêu mới' }}</div>
        <div class="mts">
          <template v-if="isEditMode">
            Sửa cấu hình. Tệp + nick + chuỗi không đổi được — tạo Mục tiêu mới nếu cần thay.
          </template>
          <template v-else>
            Mời kết bạn + bám đuổi 1 tệp khách hàng
          </template>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" @click="router.push('/marketing/triggers')">
        <v-icon size="16">mdi-close</v-icon> Huỷ
      </button>
    </div>

    <!-- Stepper = hàng chip HS (Anh chốt 2026-06-06: 4 bước, đắp da chip) -->
    <div class="stepchips">
      <template v-for="(label, idx) in stepLabels" :key="idx">
        <button
          class="chip step-chip"
          :class="{
            'chip-blue': currentStep === idx + 1,
            'chip-green done': currentStep > idx + 1,
            'chip-grey': currentStep < idx + 1,
          }"
          @click="goStep(idx + 1)"
        >
          <v-icon v-if="currentStep > idx + 1" size="13">mdi-check</v-icon>
          <span v-else class="step-num num">{{ idx + 1 }}</span>
          {{ label }}
        </button>
        <span v-if="idx < stepLabels.length - 1" class="step-sep">—</span>
      </template>
    </div>

    <!-- ============================ STEP 1 ============================ -->
    <div v-if="currentStep === 1" class="step-card active">
      <div class="step-card-header">
        <div class="num">1</div>
        <h2>Tệp khách hàng · Nick gửi mời · Quy tắc bỏ qua</h2>
        <div class="hint">Bắt buộc · ~30 giây</div>
      </div>
      <div class="step-card-body">

        <!-- Tên Mục tiêu -->
        <div class="section">
          <div class="section-title"><v-icon size="17">mdi-pencil-outline</v-icon> Tên Mục tiêu <span class="req">*</span></div>
          <div class="section-help">Đặt tên dễ nhận biết để theo dõi sau này.</div>
          <input
            v-model="form.name"
            class="text-input"
            placeholder="VD: Auto kết bạn Lead Q2 — 30.05.2026"
          />
        </div>

        <!-- Tệp -->
        <div class="section">
          <div class="section-title"><v-icon size="17">mdi-folder-outline</v-icon> Tệp khách hàng <span class="req">*</span></div>
          <div class="section-help">
            Mục tiêu chỉ chạy trên 1 tệp.
            <span v-if="prefilled">Đã chọn sẵn từ trang Tệp khách hàng.</span>
          </div>
          <div class="dropdown-wrap">
            <select
              v-model="form.listId"
              class="text-input"
              :disabled="prefilled || isEditMode"
            >
              <option :value="''" disabled>— Chọn tệp khách hàng —</option>
              <option v-for="l in lists" :key="l.id" :value="l.id">
                {{ l.name }} — {{ formatNum(l.totalEntries) }} SĐT
              </option>
            </select>
            <span v-if="selectedList" class="chip-inline">
              {{ formatNum(selectedList.totalEntries) }} SĐT
            </span>
            <span v-if="isEditMode" class="chip-inline" style="background: var(--bg-soft); color: var(--text-3);">
              <v-icon size="13">mdi-lock-outline</v-icon> Không đổi được
            </span>
          </div>
        </div>

        <!-- Nick gửi mời -->
        <div class="section">
          <div class="section-title"><v-icon size="17">mdi-account-multiple-outline</v-icon> Nick gửi mời (chọn nhiều) <span class="req">*</span></div>
          <div class="section-help">
            <template v-if="isEditMode">
              <v-icon size="13">mdi-lock-outline</v-icon> Không đổi được nick trong chế độ Sửa — tạo Mục tiêu mới nếu cần.
            </template>
            <template v-else>
              Mỗi nick được mời tối đa <strong>{{ defaultFriendCap }}</strong> lời mời/ngày
              <span class="hint-src">(trần an toàn SDK Zalo — Gửi lời mời kết bạn)</span>. Nick offline tự động bị loại.
            </template>
          </div>

          <!-- Toolbar: lọc theo nhân viên + chọn tất cả (item 3 2026-06-16) -->
          <div v-if="!isEditMode" class="nick-toolbar">
            <div class="nick-filter">
              <v-icon size="14">mdi-account-filter-outline</v-icon>
              <select v-model="employeeFilter" class="nick-filter-select">
                <option value="">Tất cả nhân viên</option>
                <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }}</option>
              </select>
            </div>
            <div class="nick-toolbar-right">
              <span class="nick-count">Đã chọn {{ form.nickIds.length }}/{{ filteredNicks.length }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="!selectableNicks.length"
                @click="toggleSelectAll"
              >
                <v-icon size="14">{{ allSelectableSelected ? 'mdi-checkbox-multiple-blank-outline' : 'mdi-checkbox-multiple-marked-outline' }}</v-icon>
                {{ allSelectableSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả (online)' }}
              </button>
            </div>
          </div>

          <div class="nick-list">
            <div
              v-for="(n, idx) in filteredNicks"
              :key="n.id"
              class="nick-row"
              :class="{
                selected: form.nickIds.includes(n.id),
                disabled: !isOnline(n),
              }"
              @click="toggleNick(n)"
            >
              <div class="nick-checkbox"></div>
              <div class="nick-avatar" :class="avatarVariant(idx)">{{ initials(n.displayName) }}</div>
              <div class="nick-info">
                <div class="nick-name">{{ n.displayName || n.id }}</div>
                <div class="nick-meta">
                  <span :class="isOnline(n) ? 'st-online' : 'st-offline'">
                    <span class="status-dot" :class="isOnline(n) ? 'status-online' : 'status-offline'"></span>
                    {{ isOnline(n) ? 'Online' : 'Offline' }}
                  </span>
                  <span class="dot">·</span>
                  <span>KB {{ nickFriendSent(n) }}/{{ nickFriendCap(n) }}</span>
                  <span class="dot">·</span>
                  <span>Tin {{ nickMsgSent(n) }}/{{ nickMsgCap(n) }}</span>
                </div>
              </div>
            </div>
            <div v-if="!nicks.length" class="empty-hint">Chưa có nick nào kết nối. Hãy kết nối nick Zalo trước.</div>
            <div v-else-if="!filteredNicks.length" class="empty-hint">Không có nick nào của nhân viên đã chọn.</div>
          </div>
        </div>

        <!-- Skip rules -->
        <div class="section">
          <div class="section-title"><v-icon size="17">mdi-shield-outline</v-icon> Quy tắc bỏ qua</div>
          <div class="section-help">Tránh spam KH đã quen, tiết kiệm quota của nick.</div>
          <div class="skip-rules">

            <div
              class="skip-row"
              :class="{ selected: form.skipRules.skipHadChat }"
              @click="form.skipRules.skipHadChat = !form.skipRules.skipHadChat"
            >
              <div class="skip-checkbox"></div>
              <div class="skip-label">Bỏ qua KH đã có chat trước (1-1)</div>
            </div>

            <div
              class="skip-row"
              :class="{ selected: form.skipRules.skipAlreadyFriend !== 'off' }"
              @click="toggleAlreadyFriend"
            >
              <div class="skip-checkbox"></div>
              <div class="skip-label">
                Bỏ qua KH đã là bạn rồi:
                <select
                  v-model="form.skipRules.skipAlreadyFriend"
                  class="skip-inline-dd"
                  @click.stop
                  :disabled="form.skipRules.skipAlreadyFriend === 'off'"
                >
                  <option value="whitelisted_nick">Bạn với nick trong danh sách</option>
                  <option value="any_nick">Bạn với bất kỳ nick nào</option>
                  <option value="off">Không bỏ qua</option>
                </select>
              </div>
            </div>

            <div
              class="skip-row"
              :class="{ selected: form.skipRules.skipNoZalo }"
              @click="form.skipRules.skipNoZalo = !form.skipRules.skipNoZalo"
            >
              <div class="skip-checkbox"></div>
              <div class="skip-label">Bỏ qua KH không có Zalo</div>
            </div>

            <div
              class="skip-row"
              :class="{ selected: form.skipRules.skipInactive }"
              @click.self="form.skipRules.skipInactive = !form.skipRules.skipInactive"
            >
              <div class="skip-checkbox" @click.stop="form.skipRules.skipInactive = !form.skipRules.skipInactive"></div>
              <div class="skip-label" @click.stop="form.skipRules.skipInactive = !form.skipRules.skipInactive">
                Bỏ qua KH có hoạt động dưới
                <input
                  type="number"
                  class="skip-inline-input"
                  :value="form.skipRules.inactiveDays"
                  min="1"
                  max="365"
                  @click.stop
                  @input="(e) => form.skipRules.inactiveDays = Number((e.target as HTMLInputElement).value) || 30"
                />
                ngày
              </div>
            </div>

          </div>

          <div class="info-banner">
            <v-icon size="16">mdi-information-outline</v-icon> <span><span class="strong">Tự động bỏ qua: {{ formatNum(skipEstimate.skipped) }} KH</span> · <span class="strong">Sẽ chạy: {{ formatNum(skipEstimate.willRun) }} KH</span></span>
            <span class="muted" style="margin-left: 8px; font-size: 11px;">(ước tính client — BE sẽ tính chính xác Ngày 5)</span>
          </div>
        </div>

      </div>
      <div class="step-footer">
        <div class="left">Bước 1 / 3</div>
        <div class="right">
          <button class="btn btn-ghost" @click="onCancel">Hủy</button>
          <button class="btn btn-primary" :disabled="!canNextStep1" @click="goStep(2)">Tiếp <v-icon size="16">mdi-arrow-right</v-icon></button>
        </div>
      </div>
    </div>

    <!-- ============================ STEP 2 ============================ -->
    <div v-if="currentStep === 2" class="step-card active">
      <div class="step-card-header">
        <div class="num">2</div>
        <h2>Lời chào · Chuỗi bám đuổi</h2>
        <div class="hint">Đã có template mặc định · sửa nếu muốn</div>
      </div>
      <div class="step-card-body">

        <!-- Bộ 5 tin nhắn -->
        <div class="section">
          <div class="msg-bundle">
            <div class="msg-bundle-header">
              <v-icon size="16">mdi-message-text-outline</v-icon> Bộ tin nhắn (5 loại tin gửi cho khách hàng)
              <span class="bundle-hint">Mỗi loại tin gửi vào 1 thời điểm khác nhau trong vòng đời của 1 KH lạ <v-icon size="12">mdi-arrow-right</v-icon> bạn.</span>
            </div>
            <div class="msg-bundle-body">

              <!-- Preview context: render biến theo KH mẫu + sale thật (2026-06-16) -->
              <div class="prev-ctx">
                <v-icon size="14">mdi-eye-outline</v-icon>
                <span class="pc-lead">Xem trước theo:</span>
                <span class="pc-chip"><span class="pc-av">{{ initials(previewSampleName) }}</span> {{ previewGenderLabel }} {{ previewNameShort }}</span>
                <span class="pc-chip"><span class="pc-av sl">{{ initials(saleName) }}</span> Sale {{ saleNameShort }}</span>
                <span class="grow"></span>
                <select v-model="previewGender" class="pc-sel">
                  <option value="male">KH mẫu: Nam → Anh</option>
                  <option value="female">KH mẫu: Nữ → Chị</option>
                  <option value="unknown">KH mẫu: chưa rõ → Anh Chị</option>
                </select>
              </div>

              <!-- Timeline luồng tin (giúp sale hiểu thứ tự) -->
              <div class="flow-strip">
                <b>Lời mời KB</b> <span class="fa"><v-icon size="13">mdi-arrow-right</v-icon></span>
                <b>Tin 1 Chào mừng</b> <span class="fa"><v-icon size="13">mdi-arrow-right</v-icon></span>
                <b>Chuỗi bám đuổi</b> <span class="fa">·</span>
                <span>khi đồng ý KB <v-icon size="13">mdi-arrow-right</v-icon> <b>Tin 2 Cảm ơn</b></span> <span class="fa">·</span>
                <span>lâu chưa đồng ý <v-icon size="13">mdi-arrow-right</v-icon> <b>Tin 3 Nhắc</b></span> <span class="fa">·</span>
                <span>từ chối <v-icon size="13">mdi-arrow-right</v-icon> <b>Tin 4</b></span>
              </div>

              <!-- LỜI MỜI KB — BẮT BUỘC, không công tắc -->
              <div class="msg-item msg-locked">
                <div class="msg-item-head">
                  <div class="msg-item-icon"><v-icon size="16">mdi-handshake-outline</v-icon></div>
                  <div class="msg-item-title">Lời mời kết bạn</div>
                  <span class="msg-item-badge badge-req"><v-icon size="12">mdi-lock-outline</v-icon> Bắt buộc</span>
                </div>
                <p class="msg-item-help">Lời nhắn gửi <strong>cùng lúc</strong> với lời mời kết bạn Zalo. Không thể tắt. Tối đa 200 ký tự.</p>
                <div class="msg-2pane">
                  <div class="msg-edit">
                    <div class="msg-pane-lbl"><v-icon size="11">mdi-pencil-outline</v-icon> Soạn nội dung</div>
                    <textarea v-model="form.messages.friendRequest" class="ta" rows="3" maxlength="200" :class="{ 'ta-invalid': !friendRequestHasName }" @focus="onMsgFocus($event, 'friendRequest')"></textarea>
                    <div class="ta-counter">{{ form.messages.friendRequest.length }}/200</div>
                    <p v-if="!friendRequestHasName" class="ta-warn"><v-icon size="13">mdi-alert-circle-outline</v-icon> Lời mời <strong>bắt buộc</strong> có biến <code>{name}</code>. Bấm chip <code>{name}</code> bên dưới.</p>
                  </div>
                  <div class="msg-prev">
                    <div class="msg-pane-lbl"><v-icon size="11">mdi-eye-outline</v-icon> Xem trước (gửi đi)</div>
                    <div class="zalo"><div class="zbubble me" v-html="renderPreview(form.messages.friendRequest)"></div></div>
                  </div>
                </div>
              </div>

              <!-- TIN 1 · CHÀO MỪNG -->
              <div class="msg-item" :class="{ 'msg-off': !form.enableWelcome }">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-blue"><v-icon size="16">mdi-hand-wave-outline</v-icon></div>
                  <div class="msg-item-title">Tin 1 · Tin chào mừng</div>
                  <span class="msg-item-badge badge-blue">Hộp người lạ</span>
                  <label class="msg-toggle"><input type="checkbox" v-model="form.enableWelcome" /><span class="msg-toggle-track"><span class="msg-toggle-thumb"></span></span><span class="msg-toggle-text">{{ form.enableWelcome ? 'BẬT' : 'TẮT' }}</span></label>
                </div>
                <p class="msg-item-help">Gửi qua hộp thư người lạ <strong>ngay sau khi gửi lời mời</strong> (không chờ đồng ý).
                  <span v-if="!form.enableWelcome" class="msg-off-note">— Đang TẮT: bỏ qua tin chào.</span></p>
                <template v-if="form.enableWelcome">
                  <div class="msg-2pane">
                    <div class="msg-edit">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-pencil-outline</v-icon> Soạn nội dung</div>
                      <textarea v-model="form.messages.welcome" class="ta" rows="3" @focus="onMsgFocus($event, 'welcome')"></textarea>
                      <div class="msg-delay-input"><label>Chờ sau khi mời</label><TimeAmountInput v-model="form.welcomeDelayMinutes" base-unit="minute" :units="['second','minute','hour']" /></div>
                    </div>
                    <div class="msg-prev">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-eye-outline</v-icon> Xem trước (gửi đi)</div>
                      <div class="zalo"><div class="zbubble me" v-html="renderPreview(form.messages.welcome)"></div></div>
                    </div>
                  </div>
                  <NotifyOwnerBox v-model="form.notifyOwner.welcome" />
                </template>
              </div>

              <!-- TIN 2 · CẢM ƠN ĐÃ ĐỒNG Ý -->
              <div class="msg-item" :class="{ 'msg-off': !form.enableThankYou }">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-green"><v-icon size="16">mdi-party-popper</v-icon></div>
                  <div class="msg-item-title">Tin 2 · Tin cảm ơn khách đã đồng ý kết bạn</div>
                  <span class="msg-item-badge badge-green">Sau khi đồng ý</span>
                  <label class="msg-toggle"><input type="checkbox" v-model="form.enableThankYou" /><span class="msg-toggle-track"><span class="msg-toggle-thumb"></span></span><span class="msg-toggle-text">{{ form.enableThankYou ? 'BẬT' : 'TẮT' }}</span></label>
                </div>
                <p class="msg-item-help">Gửi khi khách <strong>thực sự bấm Đồng ý</strong> kết bạn.
                  <span v-if="!form.enableThankYou" class="msg-off-note">— Đang TẮT.</span></p>
                <template v-if="form.enableThankYou">
                  <div class="msg-2pane">
                    <div class="msg-edit">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-pencil-outline</v-icon> Soạn nội dung</div>
                      <textarea v-model="form.messages.thankYou" class="ta" rows="3" @focus="onMsgFocus($event, 'thankYou')"></textarea>
                      <div class="msg-delay-input"><label>Chờ sau khi đồng ý</label><TimeAmountInput v-model="form.thankYouDelayMinutes" base-unit="minute" :units="['second','minute','hour']" /></div>
                    </div>
                    <div class="msg-prev">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-eye-outline</v-icon> Xem trước (gửi đi)</div>
                      <div class="zalo"><div class="zbubble me" v-html="renderPreview(form.messages.thankYou)"></div></div>
                    </div>
                  </div>
                  <NotifyOwnerBox v-model="form.notifyOwner.thankYou" />
                </template>
              </div>

              <!-- TIN 3 · NHẮC ĐỒNG Ý KB -->
              <div class="msg-item" :class="{ 'msg-off': !form.enableRemind }">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-yellow"><v-icon size="16">mdi-clock-outline</v-icon></div>
                  <div class="msg-item-title">Tin 3 · Nhắc khách đồng ý kết bạn</div>
                  <span class="msg-item-badge badge-yellow">Nhắc lại</span>
                  <label class="msg-toggle"><input type="checkbox" v-model="form.enableRemind" /><span class="msg-toggle-track"><span class="msg-toggle-thumb"></span></span><span class="msg-toggle-text">{{ form.enableRemind ? 'BẬT' : 'TẮT' }}</span></label>
                </div>
                <p class="msg-item-help">Gửi qua hộp người lạ nếu khách lâu chưa đồng ý.
                  <span v-if="!form.enableRemind" class="msg-off-note">— Đang TẮT.</span></p>
                <template v-if="form.enableRemind">
                  <div class="msg-2pane">
                    <div class="msg-edit">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-pencil-outline</v-icon> Soạn nội dung</div>
                      <textarea v-model="form.messages.remind" class="ta" rows="3" @focus="onMsgFocus($event, 'remind')"></textarea>
                      <div class="msg-delay-input"><label>Nhắc sau</label><TimeAmountInput v-model="form.remindDelayDays" base-unit="day" :units="['hour','day']" /></div>
                      <span class="cond-chip"><v-icon size="13">mdi-check-circle-outline</v-icon> Tự bỏ qua nếu khách đã đồng ý (Tin 2 đã chạy)</span>
                    </div>
                    <div class="msg-prev">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-eye-outline</v-icon> Xem trước (gửi đi)</div>
                      <div class="zalo"><div class="zbubble me" v-html="renderPreview(form.messages.remind)"></div></div>
                    </div>
                  </div>
                  <NotifyOwnerBox v-model="form.notifyOwner.remind" />
                </template>
              </div>

              <!-- TIN 4 · KHI TỪ CHỐI -->
              <div class="msg-item" :class="{ 'msg-off': !form.enableRejectedFollowUp }">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-orange"><v-icon size="16">mdi-account-cancel-outline</v-icon></div>
                  <div class="msg-item-title">Tin 4 · Khi khách từ chối kết bạn</div>
                  <span class="msg-item-badge badge-gray">Từ chối</span>
                  <label class="msg-toggle"><input type="checkbox" v-model="form.enableRejectedFollowUp" /><span class="msg-toggle-track"><span class="msg-toggle-thumb"></span></span><span class="msg-toggle-text">{{ form.enableRejectedFollowUp ? 'BẬT' : 'TẮT' }}</span></label>
                </div>
                <p class="msg-item-help">Gửi qua hộp người lạ khi khách bấm Từ chối. KH reject vẫn được bám đuổi qua hộp người lạ.
                  <span v-if="!form.enableRejectedFollowUp" class="msg-off-note">— Đang TẮT.</span></p>
                <template v-if="form.enableRejectedFollowUp">
                  <div class="msg-2pane">
                    <div class="msg-edit">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-pencil-outline</v-icon> Soạn nội dung</div>
                      <textarea v-model="form.messages.rejectedFollowUp" class="ta" rows="3" @focus="onMsgFocus($event, 'rejectedFollowUp')"></textarea>
                    </div>
                    <div class="msg-prev">
                      <div class="msg-pane-lbl"><v-icon size="11">mdi-eye-outline</v-icon> Xem trước (gửi đi)</div>
                      <div class="zalo"><div class="zbubble me" v-html="renderPreview(form.messages.rejectedFollowUp)"></div></div>
                    </div>
                  </div>
                  <NotifyOwnerBox v-model="form.notifyOwner.rejected" />
                </template>
              </div>

            </div>
          </div>

          <!-- CareSession 2026-06-07: phần "Báo nội bộ khi khách tương tác" + "Điều kiện
               dừng chăm sóc" ĐÃ TÁCH sang trang chung cấp tổ chức "Lắng nghe & Nhắc"
               (/marketing/care-listen) vì lắng nghe dùng chung cho MỌI Mục tiêu. -->
          <div class="moved-hint">
            <v-icon size="15" color="#0a7a47">mdi-bell-ring-outline</v-icon>
            <span>Cấu hình <b>báo nội bộ + điều kiện dừng chăm sóc</b> giờ là quy tắc chung cho cả tổ chức.
            Chỉnh ở mục <router-link to="/marketing/care-listen">Lắng nghe &amp; Nhắc</router-link> (không phải mỗi Mục tiêu một bộ).</span>
          </div>

          <!-- item 4 2026-06-16: chèn biến cá nhân hoá vào ô tin đang chọn -->
          <div class="var-chips">
            <span class="var-chips-label">
              <v-icon size="13">mdi-cursor-text</v-icon>
              Chèn biến cá nhân hoá (bấm vào ô tin trước, rồi bấm biến):
            </span>
            <button
              v-for="v in PERSONALIZE_VARS"
              :key="v.code"
              type="button"
              class="var-chip var-chip-btn"
              :title="`Chèn ${v.code} — ${v.label} (vd: ${v.example})`"
              @mousedown.prevent
              @click="insertVar(v.code)"
            >
              <v-icon size="12">{{ v.icon }}</v-icon>
              <code>{{ v.code }}</code>
            </button>
          </div>
        </div>

        <!-- Chuỗi bám đuổi -->
        <div class="section">
          <div class="section-title"><v-icon size="17">mdi-sync</v-icon> Chuỗi bám đuổi</div>
          <div class="section-help">
            Chuỗi tin nhắn gửi tự động <strong>sau Tin chào mừng</strong>. Thời điểm bắt đầu tuỳ chế độ chọn bên dưới. Có thể dùng chuỗi có sẵn hoặc tạo mới.
          </div>

          <!-- #1 2026-06-06 (Anh chốt): CHỌN 1 TRONG 2 chế độ bám đuổi theo trạng thái kết bạn -->
          <div class="followup-mode">
            <div class="fum-label">Khi nào bắt đầu bám đuổi?</div>
            <label class="fum-row" :class="{ selected: followUpMode === 'stranger' }">
              <input type="radio" value="stranger" v-model="followUpMode" />
              <span class="fum-radio"></span>
              <span class="fum-text">
                <span class="fum-title">Bám đuổi ngay cả khi chưa là bạn trên Zalo <span class="fum-badge">Mặc định</span></span>
                <span class="fum-help">Gửi chuỗi bám đuổi qua hộp người lạ ngay sau tin chào, không chờ khách bấm đồng ý kết bạn. Phủ rộng nhất.</span>
              </span>
            </label>
            <label class="fum-row" :class="{ selected: followUpMode === 'friend' }">
              <input type="radio" value="friend" v-model="followUpMode" />
              <span class="fum-radio"></span>
              <span class="fum-text">
                <span class="fum-title">Bám đuổi chỉ khi ĐÃ là bạn trên Zalo</span>
                <span class="fum-help">Chỉ bắt đầu chuỗi bám đuổi sau khi khách thật sự bấm Đồng ý kết bạn (gửi qua kênh bạn bè). Lịch sự hơn, tránh làm phiền người chưa duyệt.</span>
              </span>
            </label>
          </div>

          <div class="radio-group">
            <div
              class="radio-row"
              :class="{ selected: form.sequenceMode === 'reuse' }"
              @click="form.sequenceMode = 'reuse'"
            >
              <div class="radio-circle"></div>
              <div class="radio-content">
                <div class="radio-title">Dùng chuỗi có sẵn</div>
                <div class="radio-help">
                  <select
                    v-model="form.successorSequenceId"
                    class="text-input"
                    style="min-width: 320px; margin-top: 6px;"
                    :disabled="isEditMode"
                    @click.stop
                  >
                    <option :value="''" disabled>— Chọn Luồng kịch bản —</option>
                    <option
                      v-for="s in sequences"
                      :key="s.id"
                      :value="s.id"
                      :disabled="s.enabled === false"
                    >
                      {{ s.name }} ({{ stepCount(s) }} bước){{ s.enabled === false ? ' — đang TẮT' : '' }}
                    </option>
                  </select>
                  <div v-if="isEditMode" class="safety-help" style="margin-top: 4px;">
                    <v-icon size="13">mdi-lock-outline</v-icon> Không đổi được chuỗi trong chế độ Sửa.
                  </div>
                </div>

                <!-- Preview steps -->
                <!-- item 5 2026-06-16: card 2 dòng gọn — dòng 1 tên KHỐI, dòng 2 thời điểm gửi -->
                <div v-if="selectedSequence && sequenceSteps.length" class="chuoi-preview">
                  <div v-for="(step, i) in sequenceSteps" :key="i" class="chuoi-row2">
                    <span class="n">{{ i + 1 }}</span>
                    <div class="r-body">
                      <div class="r-title">{{ stepLabel(step, i) }}</div>
                      <div class="r-sub">
                        <v-icon size="12">mdi-timer-outline</v-icon>
                        <template v-if="i === 0">Gửi ngay sau Tin chào mừng</template>
                        <template v-else>Chờ {{ delayLabel(step) }} sau bước {{ i }}</template>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="selectedSequence" class="chuoi-total">
                  <v-icon size="15">mdi-chart-box-outline</v-icon> <span><span class="strong">Tổng thời gian chuỗi: {{ totalSequenceLabel }}</span> (Bước 1 <v-icon size="13">mdi-arrow-right</v-icon> Bước {{ sequenceSteps.length }})</span>
                </div>
                <div v-if="selectedSequence" class="chuoi-footnote">
                  Mỗi bước gửi 1 tin nhắn theo template do anh cấu hình ở phần <strong>Luồng kịch bản</strong>.
                </div>
              </div>
            </div>

            <div class="radio-row disabled">
              <div class="radio-circle"></div>
              <div class="radio-content">
                <div class="radio-title">Tạo chuỗi mới riêng cho Mục tiêu này <span class="defer-badge">Wave 4</span></div>
                <div class="radio-help">Mở khung soạn 5 bước trống. Phù hợp khi nội dung khác hẳn các chuỗi có sẵn.</div>
              </div>
            </div>
          </div>
        </div>

        <div class="flow-explainer">
          <v-icon size="15">mdi-lightbulb-outline</v-icon> <span class="strong">Cách hoạt động:</span>
          Gửi <strong>Lời mời kết bạn</strong> (kèm lời chào) <v-icon size="13">mdi-arrow-right</v-icon>
          <strong>Tin 1 Chào mừng</strong>
          <template v-if="followUpMode === 'stranger'">
            <v-icon size="13">mdi-arrow-right</v-icon> vào <strong>Chuỗi bám đuổi</strong> ngay (qua hộp người lạ, không chờ khách duyệt).
          </template>
          <template v-else>
            <v-icon size="13">mdi-arrow-right</v-icon> chờ khách <strong>Đồng ý kết bạn</strong> <v-icon size="13">mdi-arrow-right</v-icon> mới vào <strong>Chuỗi bám đuổi</strong> (qua kênh bạn bè).
          </template>
          Khi khách đồng ý sẽ gửi <strong>Tin 2 Cảm ơn</strong>; nếu lâu chưa đồng ý gửi <strong>Tin 3 Nhắc</strong>; nếu khách từ chối thì gửi <strong>Tin 4</strong> (nếu bật).
        </div>

      </div>
      <div class="step-footer">
        <div class="left">Bước 2 / 4</div>
        <div class="right">
          <button class="btn btn-ghost" @click="onCancel">Hủy</button>
          <button class="btn" @click="goStep(1)"><v-icon size="16">mdi-arrow-left</v-icon> Quay lại</button>
          <button class="btn btn-primary" :disabled="!canNextStep2" @click="goStep(3)">Tiếp <v-icon size="16">mdi-arrow-right</v-icon></button>
        </div>
      </div>
    </div>

    <!-- ============================ STEP 3 — Quy tắc gửi an toàn (8 inputs) ============================ -->
    <!-- Mockup 1: 8 inputs theo design doc v6 Section 6.6 + v3 Fix #3 + section 22.9 -->
    <div v-if="currentStep === 3" class="step-card active">
      <div class="step-card-header">
        <div class="num">3</div>
        <h2>Quy tắc gửi an toàn</h2>
        <div class="hint">Bảo vệ nick Zalo khỏi bị khoá. Em điền sẵn mặc định an toàn, anh chỉnh nếu cần đặc biệt.</div>
      </div>
      <div class="step-card-body">
        <div class="info-banner" style="margin-bottom: 12px;">
          <v-icon size="16">mdi-information-outline</v-icon> <strong>Quy tắc gửi an toàn</strong> giữ nick Zalo không bị Zalo cảnh báo. Em đã điền sẵn các giá trị mặc định theo kinh nghiệm — anh có thể chỉnh nếu chiến dịch đặc biệt.
        </div>

        <!-- Section 1: Thời gian -->
        <div class="safety-section">
          <div class="safety-section-title"><v-icon size="16">mdi-clock-outline</v-icon> Thời gian <span class="badge">2 input</span></div>

          <!-- Input 1: Giờ hoạt động -->
          <div class="safety-row">
            <div class="safety-label">
              Giờ hoạt động <span class="req">*</span>
              <div class="safety-help">Chỉ gửi tin trong khung giờ này (giờ Việt Nam UTC+7)</div>
            </div>
            <div class="safety-input-wrap">
              <div class="time-range">
                <input type="time" v-model="form.safetyRules.quietHoursStart" class="time-input" />
                <span class="separator"><v-icon size="15">mdi-arrow-right</v-icon></span>
                <input type="time" v-model="form.safetyRules.quietHoursEnd" class="time-input" />
                <span class="alert-chip info">{{ workingHoursLabel }}</span>
              </div>
              <div class="safety-help">Tránh gửi đêm khuya bị Zalo cảnh báo spam</div>
            </div>
          </div>

          <!-- (item 6 2026-06-16 — A) Ô "Khoảng cách tối thiểu 60s" ĐÃ CHUYỂN xuống nhóm
               "Bám đuổi" + đổi tên theo đúng chức năng (chống gửi dồn tin). Trước đây nó nằm
               đây cạnh "Nhịp gửi lời mời" gây hiểu nhầm là về lời mời. -->

          <!-- Input 3 (#3 2026-06-06): Nhịp gửi lời mời mỗi nick (min–max phút) -->
          <!-- Trước đây HARDCODE 20-40 phút trong hệ thống, ô anh nhập bị bỏ qua. -->
          <div class="safety-row">
            <div class="safety-label">
              Nhịp gửi lời mời mỗi nick <span class="req">*</span>
              <div class="safety-help">Nhịp THỰC TẾ giữa 2 lời mời kết bạn của cùng 1 nick — random trong khoảng này. Đây là ô quyết định tốc độ gửi lời mời.</div>
            </div>
            <div class="safety-input-wrap">
              <div class="num-row" style="gap: 8px; align-items: center;">
                <span class="unit">Từ</span>
                <input type="number" v-model.number="form.safetyRules.friendReqIntervalMinMinutes" min="0" max="1440" class="num-input" style="width: 80px;" />
                <span class="unit">đến</span>
                <input type="number" v-model.number="form.safetyRules.friendReqIntervalMaxMinutes" min="0" max="1440" class="num-input" style="width: 80px;" />
                <span class="unit">phút</span>
              </div>
              <div class="safety-help">An toàn nick: 20–40 phút. Muốn chạy thử nhanh: đặt cả hai = 1 (gửi mỗi phút). Tối đa = phải ≥ tối thiểu.</div>
            </div>
          </div>
        </div>

        <!-- Section 2: Cap & Quota (item 7 2026-06-16: trần SDK CÒN LẠI hôm nay) -->
        <div class="safety-section">
          <div class="safety-section-title"><v-icon size="16">mdi-chart-box-outline</v-icon> Giới hạn / Ngày / Nick <span class="badge">trần SDK còn lại</span></div>

          <div class="cap-display-banner">
            <v-icon size="15">mdi-information-outline</v-icon> Trần an toàn SDK Zalo cấu hình tại
            <a href="/settings/channels/zalo" target="_blank">/settings/channels/zalo</a>.
            Số dưới đây là phần CÒN LẠI hôm nay của <strong>{{ form.nickIds.length }} nick đã chọn</strong> (trần − đã gửi).
          </div>

          <div class="cap-tiles">
            <div class="cap-tile">
              <div class="cap-tile-label">Lời mời còn gửi được hôm nay</div>
              <div class="cap-tile-value">
                {{ formatNum(friendRemaining) }}
                <span class="cap-tile-sub">(đã gửi {{ formatNum(totalFriendSent) }}/{{ formatNum(totalFriendCap) }})</span>
              </div>
            </div>
            <div class="cap-tile">
              <div class="cap-tile-label">Tin nhắn còn gửi được hôm nay</div>
              <div class="cap-tile-value">
                {{ formatNum(msgRemaining) }}
                <span class="cap-tile-sub">(đã gửi {{ formatNum(totalMsgSent) }}/{{ formatNum(totalMsgCap) }})</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 3: Lọc KH thông minh -->
        <div class="safety-section">
          <div class="safety-section-title"><v-icon size="16">mdi-target</v-icon> Lọc khách hàng thông minh <span class="badge">2 input</span></div>

          <!-- Input 3: Recency -->
          <div class="safety-row">
            <div class="safety-label">
              Bỏ qua KH đã tương tác gần đây
              <div class="safety-help">Tránh gửi trùng cho KH đã từng nhận tin từ nick khác</div>
            </div>
            <div class="safety-input-wrap">
              <div class="num-row">
                <TimeAmountInput v-model="form.safetyRules.recencyDays" base-unit="day" :units="['hour','day']" />
                <span class="alert-chip info">0 = không lọc</span>
              </div>
              <div class="safety-help">VD: KH X đã được nick A nhắn ngày 25/05 <v-icon size="12">mdi-arrow-right</v-icon> nick B sẽ bỏ qua nếu &lt; 30 ngày</div>
            </div>
          </div>

          <!-- Input 4: Multi-nick threshold -->
          <div class="safety-row">
            <div class="safety-label">
              Bỏ qua KH đã kết bạn nhiều nick
              <div class="safety-help">KH đã là bạn của ≥ N nick <v-icon size="12">mdi-arrow-right</v-icon> không gửi nữa</div>
            </div>
            <div class="safety-input-wrap">
              <div class="num-row">
                <input type="number" v-model.number="form.safetyRules.multinickThreshold" min="0" max="50" class="num-input" />
                <span class="unit">nick (Threshold)</span>
                <span class="alert-chip info">0 = không filter</span>
              </div>
              <div class="safety-help">Privacy: chỉ đếm nick trong phạm vi phòng/dept của anh (RBAC M2)</div>
            </div>
          </div>
        </div>

        <!-- Section 4: Bám đuổi -->
        <div class="safety-section">
          <div class="safety-section-title"><v-icon size="16">mdi-flash-outline</v-icon> Bám đuổi (sau lời chào kết bạn) <span class="badge">3 input</span></div>

          <!-- (item 6 2026-06-16 — A) Chuyển ô "Khoảng cách tối thiểu" về đây + đổi tên
               theo đúng chức năng: chống gửi DỒN tin của 1 nick. Cùng field cũ
               (sendIntervalSeconds), backend giữ nguyên. -->
          <div class="safety-row">
            <div class="safety-label">
              Giãn cách tối thiểu giữa 2 lần gửi của 1 nick <span class="req">*</span>
              <div class="safety-help">Chống gửi dồn: cùng 1 nick phải cách nhau ít nhất bấy nhiêu giữa 2 lần gửi liên tiếp. Áp cho từng nick (không phải giữa 2 nick).</div>
            </div>
            <div class="safety-input-wrap">
              <TimeAmountInput v-model="form.safetyRules.sendIntervalSeconds" base-unit="second" :units="['second','minute']" />
              <div class="safety-help">Chủ yếu tác động tới <em>chuỗi tin bám đuổi</em> gửi sát nhau (lời mời đã cách 20–40 phút nên hiếm khi chạm sàn này). Mặc định 60 giây. Muốn test nhanh: đặt = 1 giây.</div>
            </div>
          </div>

          <!-- Input 5: Delay sau friend-request (2026-06-16: hỗ trợ GIÂY, mặc định 10s, 0 = ngay) -->
          <div class="safety-row">
            <div class="safety-label">
              Delay sau lời mời <v-icon size="14">mdi-arrow-right</v-icon> bước 1 bám đuổi <span class="req">*</span>
              <div class="safety-help">Tính từ khi gửi lời mời kết bạn (không phụ thuộc KH đã accept hay chưa)</div>
            </div>
            <div class="safety-input-wrap">
              <TimeAmountInput v-model="form.safetyRules.delayAfterFriendRequestSeconds" base-unit="second" :units="['second','minute','hour']" />
              <div class="safety-help">Mặc định 10 giây. Đặt <strong>0</strong> = gửi bước 1 ngay sau lời mời (không delay). "Spam HẾT luồng" — KH KHÔNG cần accept vẫn nhận đủ chuỗi qua stranger inbox.</div>
            </div>
          </div>

          <!-- Input 6: Pause hours -->
          <div class="safety-row">
            <div class="safety-label">
              Pause khi KH tương tác <span class="req">*</span>
              <div class="safety-help">KH reply / react <v-icon size="12">mdi-arrow-right</v-icon> tạm dừng chuỗi N giờ</div>
            </div>
            <div class="safety-input-wrap">
              <div class="num-row">
                <TimeAmountInput v-model="form.safetyRules.pauseHoursOnReply" base-unit="hour" :units="['hour','day']" />
                <span class="alert-chip info">KH reply tiếp <v-icon size="12">mdi-arrow-right</v-icon> reset</span>
              </div>
              <div class="safety-help">KH reply giữa chuỗi <v-icon size="12">mdi-arrow-right</v-icon> cancel job pending + notify KHẨN sale</div>
            </div>
          </div>
        </div>

        <!-- Section 5: Phản ứng cao cấp (2 input fixed, disabled) -->
        <div class="safety-section">
          <div class="safety-section-title"><v-icon size="16">mdi-tune-variant</v-icon> Phản ứng nâng cao <span class="badge">2 cố định</span></div>

          <div class="safety-row">
            <div class="safety-label">
              Reaction tích cực (tim, like, hoa)
              <div class="safety-help">Anh chốt 2026-06-01</div>
            </div>
            <div class="safety-input-wrap">
              <select disabled class="select-disabled">
                <option>KHÔNG dừng chuỗi (chỉ +5 điểm CRM)</option>
              </select>
              <div class="safety-help">Anh đã chốt cố định — không cho config để tránh sai logic. Sale chỉ thấy KPI tăng điểm.</div>
            </div>
          </div>

          <div class="safety-row">
            <div class="safety-label">
              Reaction tiêu cực (giận, dislike, tim vỡ)
              <div class="safety-help">Anh chốt 2026-06-01</div>
            </div>
            <div class="safety-input-wrap">
              <select disabled class="select-disabled">
                <option>Pause 48h + -5 điểm + notify sale</option>
              </select>
              <div class="safety-help">Mạnh hơn customer_reply (24h) vì react âm = KH bực mình rõ ràng</div>
            </div>
          </div>
        </div>
      </div>

      <div class="step-footer">
        <div class="left">Bước 3 / 4 · Quy tắc này áp dụng riêng cho Mục tiêu này.</div>
        <div class="right">
          <button class="btn btn-ghost" @click="onCancel">Hủy</button>
          <button class="btn" @click="goStep(2)"><v-icon size="16">mdi-arrow-left</v-icon> Quay lại</button>
          <button class="btn btn-primary" :disabled="!canNextStep3" @click="goStep(4)">Tiếp <v-icon size="16">mdi-arrow-right</v-icon></button>
        </div>
      </div>
    </div>

    <!-- ============================ STEP 4 — Preview + Start (was step 3) ============================ -->
    <div v-if="currentStep === 4" class="step-card active">
      <div class="step-card-header">
        <div class="num">4</div>
        <h2>Xem trước · Bắt đầu chạy</h2>
        <div class="hint">Kiểm tra số liệu thật + 3 KH mẫu trước khi nhấn chạy</div>
      </div>
      <div class="step-card-body">

        <!-- Loading skeleton -->
        <div v-if="previewLoading" class="preview-skeleton">
          <div class="sk-banner"></div>
          <div class="sk-grid">
            <div class="sk-card"></div>
            <div class="sk-card"></div>
            <div class="sk-card sk-card-wide"></div>
          </div>
        </div>

        <!-- Error state -->
        <div v-else-if="previewError" class="preview-error">
          <div class="big-banner warn">
            <div class="icon"><v-icon size="24" color="white">mdi-alert-outline</v-icon></div>
            <div class="text">
              <div class="title">Chưa ước được — sẽ tính khi bắt đầu chạy</div>
              <div class="desc">{{ previewError }}</div>
            </div>
            <button class="btn" @click="loadPreview">Thử lại</button>
          </div>

          <!-- Fallback local compute -->
          <div v-if="localFallback" class="preview-grid">
            <div class="preview-card">
              <h3><v-icon size="15">mdi-chart-box-outline</v-icon> Phân bổ nick (ước tính client)</h3>
              <table class="alloc-table">
                <thead><tr><th>Nick</th><th style="text-align:right">Số KH</th></tr></thead>
                <tbody>
                  <tr v-for="row in localFallback.allocation" :key="row.nickId">
                    <td>{{ row.displayName }}</td>
                    <td class="num">~{{ formatNum(row.count) }}</td>
                  </tr>
                  <tr class="total-row">
                    <td>Tổng</td>
                    <td class="num">{{ formatNum(localFallback.willRun) }} KH</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="preview-card">
              <h3><v-icon size="15">mdi-timer-outline</v-icon> Thời gian dự kiến (ước tính client)</h3>
              <div class="time-list">
                <div class="time-row"><span class="lbl">Hoàn thành Kết bạn</span><span class="val">~ {{ localFallback.etaFriendDays }} ngày</span></div>
                <div class="time-row"><span class="lbl">Hoàn thành toàn bộ chuỗi</span><span class="val hi">~ {{ localFallback.etaTotalDays }} ngày <span class="hint-badge">ước tính ±20%</span></span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Success state -->
        <div v-else-if="preview">
          <div class="big-banner">
            <div class="icon"><v-icon size="24" color="white">mdi-check</v-icon></div>
            <div class="text">
              <div class="title">Sẽ chạy với <span class="num">{{ formatNum(preview.willRun) }} / {{ formatNum(preview.totalEntries) }}</span> KH</div>
              <div class="desc">
                Đã loại {{ formatNum(preview.skipped) }} KH theo quy tắc bỏ qua
                (no-Zalo, đã là bạn, đã chat). Bắt đầu ngay khi nhấn nút bên dưới.
              </div>
            </div>
          </div>

          <div class="preview-grid">
            <!-- Phân bổ nick -->
            <div class="preview-card">
              <h3><v-icon size="15">mdi-chart-box-outline</v-icon> Phân bổ nick</h3>
              <table class="alloc-table">
                <thead>
                  <tr><th>Nick</th><th style="text-align:right">Số KH</th></tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in preview.allocation"
                    :key="row.nickId"
                    :class="{ disabled: !row.selected }"
                  >
                    <td>
                      <span class="nick-name-cell">{{ row.displayName }}</span>
                      <span v-if="!row.selected" class="muted">(không chọn)</span>
                    </td>
                    <td class="num">{{ row.selected ? '~' + formatNum(row.count) : 0 }}</td>
                  </tr>
                  <tr class="total-row">
                    <td>Tổng</td>
                    <td class="num">{{ formatNum(preview.willRun) }} KH</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Thời gian dự kiến -->
            <div class="preview-card">
              <h3><v-icon size="15">mdi-timer-outline</v-icon> Thời gian dự kiến</h3>
              <div class="time-list">
                <div class="time-row">
                  <span class="lbl">KH có Zalo (validate xong)</span>
                  <span class="val">~ {{ preview.eta.validateDays }} ngày</span>
                </div>
                <div class="time-row">
                  <span class="lbl">Hoàn thành Kết bạn</span>
                  <span class="val">~ {{ preview.eta.friendDays }} ngày</span>
                </div>
                <div class="time-row">
                  <span class="lbl">Hoàn thành tin Chào mừng</span>
                  <span class="val">~ {{ preview.eta.welcomeDays }} ngày</span>
                </div>
                <div class="time-row">
                  <span class="lbl">Hoàn thành toàn bộ chuỗi</span>
                  <span class="val hi">
                    ~ {{ preview.eta.totalDays }} ngày
                    <span class="hint-badge">ước tính ±20%</span>
                  </span>
                </div>
              </div>
              <div class="prod-line">
                <v-icon size="14">mdi-chart-box-outline</v-icon> Năng suất hệ thống: {{ preview.throughputPerDay }} KB/ngày
                ({{ preview.allocation.filter(a => a.selected).length }} nick × ~32 KB/ngày × 16h)
              </div>
              <div class="info-banner sm">
                <v-icon size="15">mdi-clock-outline</v-icon> Hoạt động giờ 6h–22h (VN). Random delay 20–40 phút. 10 nick = ~5 ngày.
              </div>
            </div>

            <!-- Preview 3 KH -->
            <div class="preview-card card-preview-kh">
              <h3><v-icon size="15">mdi-eye-outline</v-icon> Preview 3 KH mẫu (số liệu thật)</h3>

              <div v-for="(kh, i) in preview.sampleCustomers" :key="i" class="kh-card">
                <div class="kh-header">
                  <div class="kh-name">{{ kh.name }}</div>
                  <div class="kh-meta">{{ selectedList?.name || 'Tệp' }} · row #{{ kh.rowIndex }}</div>
                  <span class="kh-nick-badge">Nick: {{ kh.nickName }}</span>
                </div>
                <div class="kh-msgs">
                  <div class="kh-msg">
                    <span class="when">Tin xin KB</span>
                    <span class="body" v-html="renderTemplate(kh.renderedMessages?.friendRequest || form.messages.friendRequest, kh)"></span>
                  </div>
                  <div class="kh-msg">
                    <span class="when">Tin chào mừng</span>
                    <span class="body" v-html="renderTemplate(kh.renderedMessages?.welcome || form.messages.welcome, kh)"></span>
                  </div>
                  <div v-if="kh.renderedMessages?.step1" class="kh-msg">
                    <span class="when">Step 1 (sau KB +24h)</span>
                    <span class="body" v-html="renderTemplate(kh.renderedMessages.step1, kh)"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- M12 — Preview Quy tắc gửi an toàn (read-only, luôn hiển thị kể cả khi preview API fail) -->
        <div class="preview-card preview-card-safety">
          <h3><v-icon size="15">mdi-tune-variant</v-icon> Quy tắc gửi an toàn (đã cấu hình ở Bước 3)</h3>
          <div class="time-list safety-list">
            <div class="time-row">
              <span class="lbl">Giờ hoạt động (giờ VN)</span>
              <span class="val">
                {{ form.safetyRules.quietHoursStart }} – {{ form.safetyRules.quietHoursEnd }}
                <span class="hint-badge safety-badge">{{ workingHoursLabel }}</span>
              </span>
            </div>
            <div class="time-row">
              <span class="lbl">Giãn cách tối thiểu giữa 2 lần gửi / nick</span>
              <span class="val">
                {{ formatNum(form.safetyRules.sendIntervalSeconds) }} giây
                <span class="hint-badge safety-badge">
                  ~ {{ (form.safetyRules.sendIntervalSeconds / 60).toFixed(form.safetyRules.sendIntervalSeconds % 60 === 0 ? 0 : 1) }} phút
                </span>
              </span>
            </div>
            <div class="time-row">
              <span class="lbl">Bỏ qua KH gần đây (cross-nick)</span>
              <span class="val">
                <template v-if="form.safetyRules.recencyDays > 0">
                  {{ form.safetyRules.recencyDays }} ngày
                </template>
                <template v-else>
                  <span class="safety-off">— Không lọc</span>
                </template>
              </span>
            </div>
            <div class="time-row">
              <span class="lbl">Bỏ qua KH nhiều nick</span>
              <span class="val">
                <template v-if="form.safetyRules.multinickThreshold > 0">
                  ≥ {{ form.safetyRules.multinickThreshold }} nick <v-icon size="13">mdi-arrow-right</v-icon> bỏ qua
                </template>
                <template v-else>
                  <span class="safety-off">— Tắt (không filter)</span>
                </template>
              </span>
            </div>
            <div class="time-row">
              <span class="lbl">Delay sau khi gửi kết bạn</span>
              <span class="val">
                <template v-if="form.safetyRules.delayAfterFriendRequestSeconds <= 0">Gửi ngay (không delay)</template>
                <template v-else-if="form.safetyRules.delayAfterFriendRequestSeconds < 60">{{ form.safetyRules.delayAfterFriendRequestSeconds }} giây</template>
                <template v-else>
                  {{ formatNum(form.safetyRules.delayAfterFriendRequestSeconds) }} giây
                  <span class="hint-badge safety-badge">
                    ~ {{ (form.safetyRules.delayAfterFriendRequestSeconds / 60).toFixed(form.safetyRules.delayAfterFriendRequestSeconds % 60 === 0 ? 0 : 1) }} phút
                  </span>
                </template>
              </span>
            </div>
            <div class="time-row">
              <span class="lbl">Tạm dừng khi KH reply</span>
              <span class="val">
                {{ form.safetyRules.pauseHoursOnReply }} giờ
              </span>
            </div>
          </div>
          <div class="info-banner sm safety-info">
            <v-icon size="15">mdi-information-outline</v-icon> Các giá trị này chỉ áp dụng cho Mục tiêu hiện tại — sửa ở Bước 3 nếu cần đổi.
          </div>
        </div>

        <!-- Thời điểm bắt đầu (chỉ Create mode — edit-mode giữ schedule cũ) -->
        <div v-if="!isEditMode" class="section start-mode-section">
          <div class="section-title"><v-icon size="17">mdi-rocket-launch-outline</v-icon> Thời điểm bắt đầu <span class="req">*</span></div>
          <div class="section-help">
            Chọn chạy ngay hoặc hẹn lịch một thời điểm trong tương lai (chỉ trong khung 6h–22h giờ VN).
          </div>

          <div class="radio-group">
            <div
              class="radio-row"
              :class="{ selected: form.startMode === 'now' }"
              @click="setStartMode('now')"
            >
              <div class="radio-circle"></div>
              <div class="radio-content">
                <div class="radio-title">Bắt đầu ngay</div>
                <div class="radio-help">Mục tiêu sẽ chạy ngay khi anh nhấn nút bên dưới.</div>
              </div>
            </div>

            <div
              class="radio-row"
              :class="{ selected: form.startMode === 'scheduled' }"
              @click="setStartMode('scheduled')"
            >
              <div class="radio-circle"></div>
              <div class="radio-content">
                <div class="radio-title">Hẹn lịch</div>
                <div class="radio-help">
                  Đặt thời điểm chính xác. Hệ thống sẽ tự khởi chạy đúng giờ (theo múi giờ Việt Nam).
                </div>
                <div v-if="form.startMode === 'scheduled'" class="schedule-picker" @click.stop>
                  <input
                    type="datetime-local"
                    class="text-input dt-input"
                    v-model="form.scheduledAt"
                    :min="scheduledMin"
                  />
                  <div class="hint-row">
                    <v-icon size="15">mdi-clock-outline</v-icon> Chỉ cho phép giờ chạy trong khung <strong>6h–22h</strong> (giờ Việt Nam).
                    Hệ thống sẽ tự dừng ngoài khung này.
                  </div>
                  <div v-if="scheduledError" class="schedule-error"><v-icon size="14">mdi-alert-outline</v-icon> {{ scheduledError }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
      <div class="step-footer">
        <div class="left">
          Bước 4 / 4 · Sau khi bắt đầu vẫn có thể tạm dừng/sửa bất cứ lúc nào.
        </div>
        <div class="right">
          <button class="btn" @click="goStep(3)"><v-icon size="16">mdi-arrow-left</v-icon> Quay lại</button>
          <button
            class="btn btn-primary lg"
            :disabled="submitting || !canSubmit"
            @click="submit"
          >
            {{ submitButtonLabel }}
          </button>
        </div>
      </div>
    </div>

    <!-- 2026-06-16 — xác nhận Hủy (HS theme, thay window.confirm) -->
    <ConfirmActionModal
      v-model:open="cancelConfirmOpen"
      tone="danger"
      title="Hủy bỏ tạo Mục tiêu?"
      message="Mọi thông tin đã nhập sẽ mất và không khôi phục được."
      confirm-text="Hủy bỏ"
      cancel-text="Tiếp tục soạn"
      @confirm="doCancelConfirmed"
      @cancel="cancelConfirmOpen = false"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api } from '@/api';
import TimeAmountInput from '@/components/automation/TimeAmountInput.vue';
import NotifyOwnerBox from '@/components/automation/NotifyOwnerBox.vue';
import ConfirmActionModal from '@/components/chat/ConfirmActionModal.vue';
import { TEMPLATE_VARIABLES } from '@/constants/template-variables';
import { useToast } from '@/composables/use-toast';
import { useAuthStore } from '@/stores/auth';

const toast = useToast();
const auth = useAuthStore();

// 2026-06-16 — Việt hoá lỗi tạo/sửa Mục tiêu từ mã lỗi backend (sale dễ hiểu).
// Backend trả { error: '<code>', hint?: '<tiếng Việt>' }. Ưu tiên map dưới → hint → mã.
const TRIGGER_ERROR_VN: Record<string, string> = {
  name_required: 'Chưa đặt tên Mục tiêu.',
  listId_required: 'Chưa chọn tệp khách hàng.',
  nickIds_required: 'Chưa chọn nick gửi mời.',
  successorSequenceId_required: 'Chưa chọn chuỗi kịch bản bám đuổi.',
  sequence_disabled: 'Kịch bản bám đuổi đang TẮT — hãy bật kịch bản trước khi gắn vào Mục tiêu.',
  sequence_not_found: 'Không tìm thấy kịch bản bám đuổi.',
  greetingTemplate_required: 'Chưa nhập nội dung "Lời mời kết bạn".',
  greetingTemplate_too_long: '"Lời mời kết bạn" quá dài — tối đa 200 ký tự.',
  greetingTemplate_missing_name:
    '"Lời mời kết bạn" phải có biến {name} (tên khách). Bấm chip {name} để chèn vào lời mời rồi thử lại.',
  welcomeMessageTemplate_too_long: '"Tin chào mừng" quá dài — tối đa 4000 ký tự.',
  welcomeMessageTemplate_missing_var: '"Tin chào mừng" phải có biến {name} hoặc {gender}.',
  workingHours_invalid_range: 'Giờ hoạt động chưa hợp lệ: giờ bắt đầu phải nhỏ hơn giờ kết thúc.',
  sendIntervalSeconds_invalid: 'Giãn cách tối thiểu giữa 2 lần gửi chưa hợp lệ.',
  delayAfterFriendRequestSeconds_invalid: 'Delay sau lời mời chưa hợp lệ (0–604800 giây).',
  delayAfterFriendRequestMin_invalid: 'Delay sau lời mời chưa hợp lệ.',
  friendReqIntervalMin_invalid: 'Nhịp gửi lời mời (tối thiểu) chưa hợp lệ.',
  friendReqIntervalMax_invalid: 'Nhịp gửi lời mời (tối đa) chưa hợp lệ.',
  friendReqInterval_range: 'Nhịp gửi lời mời: giá trị tối đa phải ≥ tối thiểu.',
  pauseHoursOnReply_invalid: 'Thời gian tạm dừng khi KH tương tác chưa hợp lệ.',
  multinickThreshold_invalid: 'Ngưỡng "bỏ qua KH nhiều nick" chưa hợp lệ.',
  trigger_terminal_state: 'Mục tiêu đã huỷ/hoàn tất nên không sửa được. Hãy tạo Mục tiêu mới.',
  trigger_not_found: 'Không tìm thấy Mục tiêu.',
};
function friendlyTriggerError(err: any): string {
  const code = err?.response?.data?.error as string | undefined;
  const hint = err?.response?.data?.hint as string | undefined;
  if (code && TRIGGER_ERROR_VN[code]) return TRIGGER_ERROR_VN[code];
  if (hint) return hint;
  if (code) return code;
  return err?.message || 'Có lỗi xảy ra, thử lại sau.';
}

// CareSession 2026-06-07: cấu hình lắng nghe (7 event × 3 đích) đã TÁCH sang trang
// chung cấp tổ chức /marketing/care-listen. Wizard KHÔNG còn cấu hình lắng nghe.

const router = useRouter();
const route = useRoute();

// ============== TYPES ==============
interface ListSummary { id: string; name: string; totalEntries: number; }
// 2026-06-16 — nick model lấy từ GET /zalo-accounts/enriched (có metrics today +
// owner) gộp với trần friend_action từ GET /zalo-accounts/sdk-limits. Counter KB/Tin
// + cap "Giới hạn/Ngày/Nick" load thật, không còn getMockCounter.
interface NickSummary {
  id: string;
  displayName: string | null;
  status: string;
  liveStatus?: string;
  dailyFriendAddCap?: number;
  ownerUserId?: string | null;
  ownerName?: string | null;
  friendReqSent?: number; // lời mời KB đã gửi hôm nay (metricsToday.friendReqSent)
  msgToday?: number;      // tin gửi người lạ hôm nay (enriched.msgToday)
  msgCap?: number;        // trần tin/ngày của nick (enriched.quota = dailyStrangerMessageCap)
  friendCap?: number;     // trần lời mời/ngày (override per-nick ?? org default friend_action)
}
interface SequenceStep { delayMinutes?: number; name?: string; label?: string; messageTemplate?: string; blockId?: string; }
interface SequenceSummary { id: string; name: string; steps: SequenceStep[] | unknown; enabled?: boolean; }

interface PreviewAllocation {
  nickId: string;
  displayName: string;
  count: number;
  selected: boolean;
}
interface PreviewSampleCustomer {
  name: string;
  rowIndex: number;
  nickName: string;
  gender?: string;
  renderedMessages?: {
    friendRequest?: string;
    welcome?: string;
    step1?: string;
  };
}
interface PreviewResponse {
  totalEntries: number;
  skipped: number;
  willRun: number;
  allocation: PreviewAllocation[];
  eta: {
    validateDays: number;
    friendDays: number;
    welcomeDays: number;
    totalDays: number;
  };
  throughputPerDay: number;
  sampleCustomers: PreviewSampleCustomer[];
}

// ============== STATE ==============
const currentStep = ref(1);
const stepLabels = ['Tệp + Nick + Skip', 'Lời chào + Chuỗi', 'Quy tắc gửi an toàn', 'Xem trước + Bắt đầu'];

const lists = ref<ListSummary[]>([]);
const nicks = ref<NickSummary[]>([]);
const sequences = ref<SequenceSummary[]>([]);
const submitting = ref(false);
const prefilled = ref(false);

// 2026-06-16 — Step 1: lọc nick theo nhân viên (owner) + chọn tất cả.
const employeeFilter = ref<string>(''); // ownerUserId, '' = tất cả nhân viên
// Trần "Gửi lời mời kết bạn" mặc định hệ thống (org default friend_action.daily),
// load từ GET /zalo-accounts/sdk-limits. Fallback 30 khi chưa cấu hình.
const defaultFriendCap = ref(30);
// 2026-06-16 — Step 2: map blockId → tên khối, load từ GET /automation/sequences/:id
// khi chọn "Dùng chuỗi có sẵn" → preview hiển thị đúng tên khối mỗi bước.
const sequenceBlockNames = ref<Record<string, string>>({});

// P2 Wave 4 #Edit 2026-06-02 — Edit-mode: route truyền `?edit=<triggerId>` →
// wizard fetch GET /:id/edit hydrate form, submit gọi PATCH thay POST. Listid /
// nickIds / successorSequenceId KHÔNG sửa được (BE PATCH reject silently —
// xem friend-invite-routes.ts comment).
const editingTriggerId = ref<string | null>(null);
const isEditMode = computed(() => !!editingTriggerId.value);
const editLoading = ref(false);

// #1 2026-06-06 (Anh chốt): chọn 1 trong 2 chế độ bám đuổi (radio), map sang 2 cột BE.
//   'stranger' = bám đuổi ngay cả khi chưa là bạn → stranger ON + friend ON (phủ rộng).
//   'friend'   = chỉ bám đuổi khi đã là bạn      → stranger OFF + friend ON.
// followUpFriendEnabled luôn ON ở cả 2 chế độ (đã là bạn thì luôn bám đuổi).
const followUpMode = computed<'stranger' | 'friend'>({
  get: () => (form.value.followUpStrangerEnabled ? 'stranger' : 'friend'),
  set: (mode) => {
    form.value.followUpStrangerEnabled = mode === 'stranger';
    form.value.followUpFriendEnabled = true;
  },
});

const previewLoading = ref(false);
const previewError = ref<string | null>(null);
const preview = ref<PreviewResponse | null>(null);
const localFallback = ref<{
  willRun: number;
  allocation: { nickId: string; displayName: string; count: number }[];
  etaFriendDays: number;
  etaTotalDays: number;
} | null>(null);

const SYSTEM_THROUGHPUT_PER_NICK_PER_DAY = 32; // KB/ngày per nick

const form = ref({
  name: '',
  listId: '',
  nickIds: [] as string[],
  sequenceMode: 'reuse' as 'reuse' | 'new',
  successorSequenceId: '',
  startMode: 'now' as 'now' | 'scheduled',
  scheduledAt: null as string | null, // datetime-local string "YYYY-MM-DDTHH:mm" (giờ VN)
  // FIX 2026-06-08 (Anh chốt): default 1 phút → 1 GIÂY. Sàn welcome_min_floor (BE) đã bỏ
  // → độ trễ welcome = đúng giá trị này. Anh chỉnh khi tạo trigger (ô nhập có đơn vị giây/phút/giờ).
  // base-unit của TimeAmountInput là minute → 1 giây = 1/60 phút.
  welcomeDelayMinutes: 1 / 60, // Tin 1 Chào mừng: chờ bao lâu sau khi gửi lời mời. 0 = gửi ngay.
  thankYouDelayMinutes: 1, // Tin 2 Cảm ơn: chờ bao lâu sau khi KH đồng ý KB.
  remindDelayDays: 3,      // Tin 3 Nhắc: sau bao nhiêu ngày KH chưa đồng ý.
  // ── I10 2026-06-04 — cấu trúc 5 tin (Anh chốt /design-html v2) ──
  // Lời mời KB = friendRequest BẮT BUỘC (không cờ). 4 tin còn lại có công tắc.
  enableWelcome: true,            // Tin 1 Chào mừng (sau khi mời, hộp người lạ)
  enableThankYou: true,           // Tin 2 Cảm ơn (sau khi KH đồng ý KB)
  enableRemind: true,             // Tin 3 Nhắc đồng ý KB sau N ngày (tự bỏ qua nếu đã đồng ý)
  enableRejectedFollowUp: false,  // Tin 4 Khi KH từ chối KB
  // #1 2026-06-06 — 2 công tắc bám đuổi theo trạng thái kết bạn (Anh chốt).
  followUpStrangerEnabled: true,  // Bám đuổi cả khi KH CHƯA đồng ý KB (qua hộp người lạ)
  followUpFriendEnabled: true,    // Bám đuổi khi KH ĐÃ là bạn (chờ accept thật)
  // Thông báo nội bộ TIN (welcome/thankYou/remind/rejected) = boolean owner per-trigger.
  // CareSession 2026-06-07: cấu hình LẮNG NGHE (event khách + điều kiện đóng) đã TÁCH
  // sang trang chung cấp tổ chức (/marketing/care-listen), KHÔNG còn trong wizard.
  notifyOwner: {
    welcome: true, thankYou: true, remind: true, rejected: true,
  } as Record<string, boolean>,
  messages: {
    friendRequest: 'Em chào {gender} {name}, em là {sale} bên dự án The Emerald Garden View. Em xin kết bạn để gửi tài liệu chi tiết ạ.',
    welcome: 'Em chào {gender} {name}, em vừa gửi lời mời kết bạn. Mong {gender} duyệt giúp em để nhận tài liệu dự án ạ.',
    thankYou: 'Cảm ơn {gender} {name} đã đồng ý kết bạn ạ. Em xin gửi {gender} bộ tài liệu dự án chi tiết.',
    remind: 'Em chào {gender} {name}, em có gửi lời mời kết bạn nhưng chưa thấy phản hồi. Mong {gender} dành chút thời gian duyệt giúp em ạ.',
    rejectedFollowUp: 'Em chào {gender} {name}, không sao ạ. Em vẫn gửi {gender} bộ tài liệu dự án qua đây, mong {gender} dành ít phút xem giúp em.',
  },
  skipRules: {
    skipHadChat: true,
    skipAlreadyFriend: 'whitelisted_nick' as 'whitelisted_nick' | 'any_nick' | 'off',
    skipNoZalo: true,
    skipInactive: false,
    inactiveDays: 30,
  },
  // Bước 3 mới (Luồng Mục Tiêu mockup 1) — 6 inputs config riêng cho Mục tiêu này.
  // Defaults chốt theo design doc v6 + memory project_zalocrm_automation_delay_rules.
  safetyRules: {
    quietHoursStart: '06:00',       // Input 1a
    quietHoursEnd:   '22:00',       // Input 1b
    sendIntervalSeconds: 60,        // Input 2 (1 phút)
    recencyDays: 30,                // Input 3 (cross-nick friendship recency)
    multinickThreshold: 0,          // Input 4 (0 = off)
    delayAfterFriendRequestSeconds: 10, // Input 5 — 2026-06-16: giây, mặc định 10s (0 = ngay)
    pauseHoursOnReply: 24,          // Input 6 (P2.1: KH reply → pause 24h)
    // #3 2026-06-06 (Anh chốt): nhịp gửi lời mời mỗi nick (phút) — trước đây HARDCODE
    // 20-40 phút trong nick-worker, ô UI bị phớt lờ. Giờ Anh nhập đây, worker đọc thật.
    // Muốn test nhanh: đặt min=max=1. Default 20-40 = an toàn nick.
    friendReqIntervalMinMinutes: 20,
    friendReqIntervalMaxMinutes: 40,
    // Sàn tối thiểu (giây) trước khi gửi Tin 1 chào — trước đây hardcode 60s.
    welcomeMinFloorSeconds: 60,
    // Cửa sổ (ngày) coi KH "ấm" để gửi Tin 1 qua kênh bạn bè — trước đây hardcode 30 ngày.
    warmWindowDays: 30,
    // Section 5 fixed (display only — không gửi lên BE, server-side default):
    // - reactionPositive: 'no_pause_plus_5_points'
    // - reactionNegative: 'pause_48h_minus_5_points_notify'
  },
});

// ============== COMPUTED ==============
const selectedList = computed(() => lists.value.find(l => l.id === form.value.listId) || null);
const selectedSequence = computed(() => sequences.value.find(s => s.id === form.value.successorSequenceId) || null);

const sequenceSteps = computed((): SequenceStep[] => {
  if (!selectedSequence.value) return [];
  const steps = selectedSequence.value.steps;
  if (Array.isArray(steps)) return steps as SequenceStep[];
  return [];
});

const totalSequenceMinutes = computed(() =>
  sequenceSteps.value.reduce((sum, s) => sum + (s.delayMinutes || 0), 0),
);
const totalSequenceLabel = computed(() => formatDelay(totalSequenceMinutes.value));

const canNextStep1 = computed(() => {
  return form.value.name.trim().length > 0
    && !!form.value.listId
    && form.value.nickIds.length > 0;
});

// 2026-06-05 (Anh chốt) — "Lưu nháp" cần đủ 5 mục cơ bản mà BE create bắt buộc
// (tên + tệp + nick + luồng + lời chào có {name}). Wizard auto-chọn sẵn nick + luồng
// + lời chào mặc định nên thực tế sale chỉ cần gõ tên + chọn tệp là lưu nháp được.
// TODO Đợt 2 (redesign wizard) — nối nút "Lưu nháp" dùng computed này.
const canSaveDraft = computed(() =>
  canNextStep1.value
  && !!form.value.successorSequenceId
  && form.value.messages.friendRequest.includes('{name}'),
);
// Đánh dấu giữ chủ ý (chưa nối nút) để build không báo unused — sẽ dùng ở Đợt 2.
void canSaveDraft;

// 2026-06-16 — Lời mời kết bạn BẮT BUỘC có {name} (backend chặn). Guard sớm tại Step 2
// để sale thấy lỗi ngay tại ô, không đợi tới lúc bấm Tạo mới báo.
const friendRequestHasName = computed(() => form.value.messages.friendRequest.includes('{name}'));

// ===== Step 2 — Live preview biến (item 2026-06-16) =====
// renderPreview KHỚP 100% logic backend render-template.ts (resolveVars):
//   {gender} female→Chị / male→Anh / else→Anh Chị · {name}=last word fullName
//   {name_full}=full · {crm_*}=fallback tên thật KH (alias per-nick chỉ biết lúc gửi)
//   {sale}=last word tên sale THẬT (user đăng nhập) · {sale_full}=full.
const previewGender = ref<'male' | 'female' | 'unknown'>('male');
const PREVIEW_SAMPLE: Record<'male' | 'female' | 'unknown', string> = {
  male: 'Trần Văn Lộc',
  female: 'Nguyễn Thị Hương',
  unknown: 'Trần Văn Lộc',
};
const saleName = computed(() => (auth.user?.fullName || 'em').trim());
const saleNameShort = computed(() => saleName.value.split(/\s+/).pop() || saleName.value);
const previewSampleName = computed(() => PREVIEW_SAMPLE[previewGender.value]);
const previewNameShort = computed(() => previewSampleName.value.split(/\s+/).pop() || previewSampleName.value);
const previewGenderLabel = computed(() =>
  previewGender.value === 'female' ? 'Chị' : previewGender.value === 'male' ? 'Anh' : 'Anh Chị');

function previewVars(): Record<string, string> {
  const full = previewSampleName.value;
  const fp = full.trim().split(/\s+/);
  const sf = saleName.value;
  const sp = sf.split(/\s+/);
  const crmFull = full; // alias per-nick không có lúc tạo → fallback tên thật KH (giống BE)
  const cp = crmFull.trim().split(/\s+/);
  return {
    gender: previewGenderLabel.value,
    name: fp[fp.length - 1] || 'Anh Chị',
    name_full: full || 'Anh Chị',
    crm_full: crmFull || 'Anh Chị',
    crm_first: cp[0] || 'Anh Chị',
    crm_last: cp[cp.length - 1] || 'Anh Chị',
    sale: sp[sp.length - 1] || 'em',
    sale_full: sf || 'em',
  };
}
function escPv(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderPreview(tpl: string): string {
  const v = previewVars();
  // escape text trước, rồi thay 8 token (name_full trước name, crm_full trước crm_first/last,
  // sale_full trước sale — regex alternation match trái→phải đúng thứ tự).
  const out = escPv(tpl).replace(
    /\{(gender|name_full|name|crm_full|crm_first|crm_last|sale_full|sale)\}/g,
    (_m, k: string) => `<span class="pv-var">${escPv(v[k] ?? '')}</span>`,
  );
  return out.trim() ? out : '<span class="pv-empty">(chưa có nội dung)</span>';
}

const canNextStep2 = computed(() => {
  return form.value.messages.friendRequest.trim().length > 0
    && friendRequestHasName.value
    && form.value.messages.welcome.trim().length > 0
    && !!form.value.successorSequenceId;
});

// ===== Bước 3 — Safety rules validations =====
const canNextStep3 = computed(() => {
  const r = form.value.safetyRules;
  // Required fields with valid ranges:
  if (!r.quietHoursStart || !r.quietHoursEnd) return false;
  if (r.sendIntervalSeconds < 1 || r.sendIntervalSeconds > 3600) return false;
  if (r.delayAfterFriendRequestSeconds < 0 || r.delayAfterFriendRequestSeconds > 604800) return false;
  if (r.pauseHoursOnReply < 1 || r.pauseHoursOnReply > 720) return false;
  // Quiet hours start < end check (giờ VN):
  const startH = parseInt(r.quietHoursStart.split(':')[0] || '0', 10);
  const endH = parseInt(r.quietHoursEnd.split(':')[0] || '0', 10);
  if (startH >= endH) return false;
  return true;
});

const workingHoursLabel = computed(() => {
  const r = form.value.safetyRules;
  const startH = parseInt(r.quietHoursStart.split(':')[0] || '0', 10);
  const endH = parseInt(r.quietHoursEnd.split(':')[0] || '0', 10);
  const diff = Math.max(0, endH - startH);
  return `${diff} giờ/ngày`;
});

// ── 2026-06-16 — trần SDK thật của từng nick (load từ enriched + sdk-limits) ──
function nickFriendCap(n: NickSummary): number { return n.friendCap ?? defaultFriendCap.value; }
function nickFriendSent(n: NickSummary): number { return n.friendReqSent ?? 0; }
function nickMsgCap(n: NickSummary): number { return n.msgCap ?? 300; }
function nickMsgSent(n: NickSummary): number { return n.msgToday ?? 0; }

const selectedNickObjs = computed(() => nicks.value.filter(n => form.value.nickIds.includes(n.id)));

// Step 3 "Giới hạn / Ngày / Nick" — trần SDK CÒN LẠI hôm nay của các nick đã chọn ở Step 1.
const totalFriendCap = computed(() => selectedNickObjs.value.reduce((s, n) => s + nickFriendCap(n), 0));
const totalFriendSent = computed(() => selectedNickObjs.value.reduce((s, n) => s + nickFriendSent(n), 0));
const friendRemaining = computed(() => Math.max(0, totalFriendCap.value - totalFriendSent.value));

const totalMsgCap = computed(() => selectedNickObjs.value.reduce((s, n) => s + nickMsgCap(n), 0));
const totalMsgSent = computed(() => selectedNickObjs.value.reduce((s, n) => s + nickMsgSent(n), 0));
const msgRemaining = computed(() => Math.max(0, totalMsgCap.value - totalMsgSent.value));

// ===== Step 3: Start mode (Bắt đầu ngay vs Hẹn lịch) =====
// scheduledAt là string "YYYY-MM-DDTHH:mm" do <input type="datetime-local"> trả ra,
// hiểu là giờ VN (hệ thống chốt timezone Asia/Ho_Chi_Minh).
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

const scheduledMin = computed(() => {
  // Min picker = giờ VN hiện tại (+5 phút buffer) để không cho chọn quá khứ.
  const now = new Date(Date.now() + 5 * 60 * 1000);
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const h = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  return `${y}-${m}-${d}T${h}:${mi}`;
});

const scheduledError = computed(() => {
  if (form.value.startMode !== 'scheduled') return '';
  const raw = form.value.scheduledAt;
  if (!raw) return 'Hãy chọn ngày + giờ bắt đầu.';
  // Parse "YYYY-MM-DDTHH:mm" as local (= giờ VN trên máy sale).
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return 'Định dạng thời gian không hợp lệ.';
  const nowMs = Date.now();
  if (dt.getTime() <= nowMs) return 'Thời điểm bắt đầu phải ở tương lai.';
  // hour 6-22 inclusive start (cho phép 06:00 → 22:00, không cho 22:01+ hoặc 05:59-)
  const hourStr = raw.split('T')[1]?.slice(0, 2) ?? '';
  const hour = Number(hourStr);
  if (Number.isNaN(hour) || hour < 6 || hour > 22) {
    return 'Giờ chạy phải nằm trong khung 6h–22h (giờ Việt Nam).';
  }
  return '';
});

const canSubmit = computed(() => {
  if (!canNextStep1.value || !canNextStep2.value) return false;
  if (form.value.startMode === 'scheduled') {
    return scheduledError.value === '';
  }
  return true;
});

const submitButtonLabel = computed(() => {
  if (submitting.value) return isEditMode.value ? 'Đang lưu...' : 'Đang khởi tạo...';
  if (isEditMode.value) return 'Lưu thay đổi';
  return form.value.startMode === 'scheduled'
    ? 'Hẹn lịch chạy Mục tiêu'
    : 'Bắt đầu chạy Mục tiêu';
});

function setStartMode(mode: 'now' | 'scheduled') {
  form.value.startMode = mode;
  if (mode === 'scheduled' && !form.value.scheduledAt) {
    // Gợi ý mặc định: 1 tiếng sau bây giờ, làm tròn lên 5 phút, kẹp vào khung 6h-22h.
    const t = new Date(Date.now() + 60 * 60 * 1000);
    const rounded = Math.ceil(t.getMinutes() / 5) * 5;
    t.setMinutes(rounded, 0, 0);
    if (t.getHours() < 6) t.setHours(6, 0, 0, 0);
    if (t.getHours() > 22) {
      // Đẩy sang 6h sáng hôm sau
      t.setDate(t.getDate() + 1);
      t.setHours(6, 0, 0, 0);
    }
    form.value.scheduledAt =
      `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}T${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  }
  if (mode === 'now') {
    form.value.scheduledAt = null;
  }
}

// TODO BE Ngày 5: endpoint POST /muc-tieu/skip-count để có realtime
const skipEstimate = computed(() => {
  const total = selectedList.value?.totalEntries ?? 0;
  // Heuristic 26.4% skip
  let skipPct = 0;
  if (form.value.skipRules.skipNoZalo) skipPct += 0.12;
  if (form.value.skipRules.skipHadChat) skipPct += 0.08;
  if (form.value.skipRules.skipAlreadyFriend !== 'off') skipPct += 0.05;
  if (form.value.skipRules.skipInactive) skipPct += 0.04;
  skipPct = Math.min(skipPct, 0.6);
  const skipped = Math.round(total * skipPct);
  return { skipped, willRun: Math.max(0, total - skipped) };
});

// ============== METHODS ==============
function formatNum(n: number | null | undefined): string {
  if (n == null) return '0';
  return n.toLocaleString('vi-VN');
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarVariant(idx: number): string {
  const variants = ['', 'av-2', 'av-3', 'av-4', 'av-5'];
  return variants[idx % variants.length];
}

// 2026-06-16 — trạng thái online lấy liveStatus (zaloPool realtime) → fallback status.
function isOnline(n: NickSummary): boolean {
  return (n.liveStatus ?? n.status) === 'connected';
}

// ── Step 1: lọc nick theo nhân viên + chọn tất cả ──
// Danh sách nhân viên (owner) có nick — để render dropdown lọc.
const employees = computed(() => {
  const map = new Map<string, string>();
  for (const n of nicks.value) {
    if (n.ownerUserId) map.set(n.ownerUserId, n.ownerName || 'Không tên');
  }
  return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
});

// Nick hiển thị sau khi áp filter nhân viên (online lên trước cho dễ chọn).
const filteredNicks = computed(() => {
  const arr = employeeFilter.value
    ? nicks.value.filter(n => n.ownerUserId === employeeFilter.value)
    : nicks.value.slice();
  return arr.sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)));
});

// Nick online trong phạm vi đang lọc — đối tượng của "Chọn tất cả".
const selectableNicks = computed(() => filteredNicks.value.filter(isOnline));
const allSelectableSelected = computed(() =>
  selectableNicks.value.length > 0 && selectableNicks.value.every(n => form.value.nickIds.includes(n.id)),
);

function toggleSelectAll() {
  if (isEditMode.value) return;
  const ids = selectableNicks.value.map(n => n.id);
  if (allSelectableSelected.value) {
    // Bỏ chọn các nick đang hiển thị (giữ nguyên nick thuộc bộ lọc khác).
    form.value.nickIds = form.value.nickIds.filter(id => !ids.includes(id));
  } else {
    const set = new Set(form.value.nickIds);
    ids.forEach(id => set.add(id));
    form.value.nickIds = Array.from(set);
  }
}

function toggleNick(n: NickSummary) {
  // Edit mode: locked — nick set không đổi được (xem PATCH endpoint contract).
  if (isEditMode.value) return;
  if (!isOnline(n)) return;
  const idx = form.value.nickIds.indexOf(n.id);
  if (idx >= 0) form.value.nickIds.splice(idx, 1);
  else form.value.nickIds.push(n.id);
}

function toggleAlreadyFriend() {
  if (form.value.skipRules.skipAlreadyFriend === 'off') {
    form.value.skipRules.skipAlreadyFriend = 'whitelisted_nick';
  } else {
    form.value.skipRules.skipAlreadyFriend = 'off';
  }
}

// ── Step 2 (item 4 2026-06-16): chèn biến cá nhân hoá vào ô tin ĐANG chọn ──
// Bấm chip biến → chèn {code} tại vị trí con trỏ của textarea cuối cùng được focus.
type MsgKey = keyof typeof form.value.messages;
const PERSONALIZE_VARS = TEMPLATE_VARIABLES;
const MSG_MAXLEN: Partial<Record<MsgKey, number>> = { friendRequest: 200 };
const activeMsgField = ref<{ el: HTMLTextAreaElement | null; key: MsgKey }>({ el: null, key: 'friendRequest' });

function onMsgFocus(e: FocusEvent, key: MsgKey) {
  activeMsgField.value = { el: e.target as HTMLTextAreaElement, key };
}

function insertVar(code: string) {
  const { el, key } = activeMsgField.value;
  const cur = form.value.messages[key] ?? '';
  const max = MSG_MAXLEN[key];
  if (el && typeof el.selectionStart === 'number') {
    const start = el.selectionStart;
    const end = el.selectionEnd ?? start;
    let next = cur.slice(0, start) + code + cur.slice(end);
    if (max && next.length > max) next = next.slice(0, max);
    form.value.messages[key] = next;
    nextTick(() => {
      el.focus();
      const pos = Math.min(start + code.length, next.length);
      el.setSelectionRange(pos, pos);
    });
  } else {
    // Chưa focus ô nào → nối vào cuối ô đang chọn (mặc định Lời mời KB).
    let next = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + code;
    if (max && next.length > max) next = next.slice(0, max);
    form.value.messages[key] = next;
  }
}

function stepCount(s: SequenceSummary): number {
  return Array.isArray(s.steps) ? (s.steps as SequenceStep[]).length : 0;
}

function stepLabel(step: SequenceStep, idx: number): string {
  // 2026-06-16 — ưu tiên TÊN KHỐI thật (resolve blockId → block.name).
  if (step.blockId && sequenceBlockNames.value[step.blockId]) return sequenceBlockNames.value[step.blockId];
  if (step.label) return step.label;
  if (step.name) return step.name;
  if (step.messageTemplate) {
    const txt = step.messageTemplate.slice(0, 40);
    return txt + (step.messageTemplate.length > 40 ? '…' : '');
  }
  return `Bước ${idx + 1}`;
}

function formatDelay(min: number): string {
  if (!min || min <= 0) return 'Ngay sau';
  if (min < 60) return `${min} phút`;
  if (min < 1440) {
    const h = min / 60;
    return Number.isInteger(h) ? `${h} giờ` : `${h.toFixed(1)} giờ`;
  }
  const d = min / 1440;
  return Number.isInteger(d) ? `${d} ngày` : `${d.toFixed(1)} ngày`;
}

function delayLabel(step: SequenceStep): string {
  return formatDelay(step.delayMinutes || 0);
}

function renderTemplate(tpl: string, kh: PreviewSampleCustomer): string {
  const safe = (tpl || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Highlight {var} → <i>value</i>
  return safe
    .replace(/\{gender\}/g, `<i>${kh.gender || 'Anh/Chị'}</i>`)
    .replace(/\{name\}/g, `<i>${kh.name?.split(/\s+/).pop() || 'KH'}</i>`)
    .replace(/\{sale\}/g, `<i>${kh.nickName?.split(/\s+/).pop() || 'Sale'}</i>`);
}

function goStep(n: number) {
  // Forward validation
  if (n > currentStep.value) {
    if (currentStep.value === 1 && !canNextStep1.value) return;
    if (currentStep.value === 2 && !canNextStep2.value) return;
    if (currentStep.value === 3 && !canNextStep3.value) return;
  }
  currentStep.value = n;
  // Bước 4 là Preview — Load khi vào Step 4 (was Step 3 cũ)
  if (n === 4) loadPreview();
}

// 2026-06-16 — thay window.confirm bằng ConfirmActionModal (HS theme).
const cancelConfirmOpen = ref(false);
function onCancel() {
  cancelConfirmOpen.value = true;
}
function doCancelConfirmed() {
  cancelConfirmOpen.value = false;
  router.push('/marketing/triggers');
}

function computeETALocal() {
  const selectedNicks = nicks.value.filter(n => form.value.nickIds.includes(n.id));
  const throughput = selectedNicks.length * SYSTEM_THROUGHPUT_PER_NICK_PER_DAY;
  const willRun = skipEstimate.value.willRun;
  const etaFriendDays = throughput > 0 ? Math.ceil((willRun / throughput) * 10) / 10 : 0;
  const sequenceDays = totalSequenceMinutes.value / 1440;
  const allocation = selectedNicks.map((n, _i, arr) => ({
    nickId: n.id,
    displayName: n.displayName || n.id,
    count: Math.round(willRun / Math.max(1, arr.length)),
  }));
  localFallback.value = {
    willRun,
    allocation,
    etaFriendDays,
    etaTotalDays: etaFriendDays + sequenceDays,
  };
}

async function loadPreview() {
  previewLoading.value = true;
  previewError.value = null;
  preview.value = null;
  localFallback.value = null;
  try {
    const resp = await api.post('/automation/triggers/preview', buildSubmitPayload());
    // Wave 3 Ngày 2 — BE service trả shape mới (poolStats/nickDistribution/sampleContacts),
    // FE wizard expect shape phẳng. Adapter layer giữ UI ổn định.
    const raw: any = resp.data;
    const nickIdsSelected = form.value.nickIds;
    const allocation = (raw?.nickDistribution || []).map((d: any) => ({
      nickId: d.nickId,
      displayName: d.displayName,
      count: d.assignedCount ?? 0,
      selected: nickIdsSelected.includes(d.nickId),
    }));
    preview.value = {
      willRun: raw?.poolStats?.willRun ?? 0,
      totalEntries: raw?.poolStats?.total ?? 0,
      skipped: raw?.poolStats?.skipped ?? 0,
      allocation,
      eta: {
        validateDays: raw?.eta?.validateHasZalo?.days ? Math.round(raw.eta.validateHasZalo.days * 10) / 10 : 0,
        friendDays: raw?.eta?.finishFriendInvite?.days ? Math.round(raw.eta.finishFriendInvite.days * 10) / 10 : 0,
        welcomeDays: raw?.eta?.finishWelcomeMessage?.days ? Math.round(raw.eta.finishWelcomeMessage.days * 10) / 10 : 0,
        totalDays: raw?.eta?.finishFullSequence?.days ? Math.round(raw.eta.finishFullSequence.days * 10) / 10 : 0,
      },
      throughputPerDay: (raw?.constants?.systemThroughputPerDay ?? 32) * (allocation.filter((a: any) => a.selected).length || 1),
      sampleCustomers: (raw?.sampleContacts || []).map((c: any) => ({
        name: c.name,
        rowIndex: c.rowIndex,
        nickName: c.nickAssigned,
        renderedMessages: c.renderedMessages || {},
      })),
    } as PreviewResponse;
  } catch (err: any) {
    previewError.value = err?.response?.data?.error || err?.message || 'BE preview chưa sẵn sàng';
    computeETALocal();
  } finally {
    previewLoading.value = false;
  }
}

function buildSubmitPayload() {
  // Wave 3: BE chỉ accept welcomeMessageTemplate + greetingTemplate (tin 1 = greeting, tin 3 = welcome).
  // Tin 2/4/5 lưu vào segmentSpec.extendedMessages JSONB cho Wave 4 BE đọc.
  // T4 Wizard: thêm startMode + scheduledAt (ISO UTC) để BE schedule activation.
  let scheduledIso: string | null = null;
  if (form.value.startMode === 'scheduled' && form.value.scheduledAt) {
    // Browser parse "YYYY-MM-DDTHH:mm" theo local time. Trên máy sale VN (UTC+7)
    // → kết quả ISO đã đúng instant. BE tự convert sang Asia/Ho_Chi_Minh khi cần.
    const dt = new Date(form.value.scheduledAt);
    if (!Number.isNaN(dt.getTime())) scheduledIso = dt.toISOString();
  }
  return {
    name: form.value.name.trim(),
    listId: form.value.listId,
    nickIds: form.value.nickIds,
    successorSequenceId: form.value.successorSequenceId,
    greetingTemplate: form.value.messages.friendRequest.trim(),
    welcomeMessageTemplate: form.value.messages.welcome.trim() || null,
    welcomeDelaySeconds: Math.max(0, (form.value.welcomeDelayMinutes ?? 1) * 60),
    // I10 2026-06-04 — Tin 2 Cảm ơn + 4 cờ enable + thông báo per-event.
    thankYouTemplate: form.value.messages.thankYou.trim() || null,
    thankYouDelaySeconds: Math.max(0, (form.value.thankYouDelayMinutes ?? 1) * 60),
    // I12 2026-06-04 — Tin 3 (nhắc) + Tin 4 (từ chối).
    remindTemplate: form.value.messages.remind.trim() || null,
    remindDelayDays: Math.max(1, form.value.remindDelayDays ?? 3),
    rejectedTemplate: form.value.messages.rejectedFollowUp.trim() || null,
    enableWelcome: form.value.enableWelcome,
    enableThankYou: form.value.enableThankYou,
    enableRemind: form.value.enableRemind,
    enableRejectedFollowUp: form.value.enableRejectedFollowUp,
    // #1 2026-06-06 — 2 công tắc bám đuổi theo trạng thái kết bạn.
    followUpStrangerEnabled: form.value.followUpStrangerEnabled,
    followUpFriendEnabled: form.value.followUpFriendEnabled,
    // notifyChannels: chỉ TIN (welcome/thankYou/remind/rejected) per-trigger.
    // Care event (reply/reaction/...) đã chuyển sang cấu hình LẮNG NGHE chung cấp org.
    notifyChannels: Object.fromEntries(
      Object.entries(form.value.notifyOwner).map(([k, owner]) => [k, { owner, manager: false, zaloGroup: false }]),
    ),
    startMode: form.value.startMode,
    scheduledAt: scheduledIso,
    skipRules: {
      // Map UI shape to legacy BE shape + raw new fields
      // Note: recencyDays/multinickThreshold giờ ưu tiên lấy từ safetyRules (Bước 3 mới).
      recencyDays: form.value.safetyRules.recencyDays > 0
        ? form.value.safetyRules.recencyDays
        : (form.value.skipRules.skipInactive ? form.value.skipRules.inactiveDays : 0),
      friendCap: form.value.safetyRules.multinickThreshold > 0
        ? form.value.safetyRules.multinickThreshold
        : (form.value.skipRules.skipAlreadyFriend === 'off' ? 999 : 2),
      skipHadChat: form.value.skipRules.skipHadChat,
      skipAlreadyFriend: form.value.skipRules.skipAlreadyFriend,
      skipNoZalo: form.value.skipRules.skipNoZalo,
      skipInactive: form.value.skipRules.skipInactive,
      inactiveDays: form.value.skipRules.inactiveDays,
      entryStatuses: [] as string[],
    },
    // Bước 3 mới (mockup 1) — 6 inputs config riêng cho Mục tiêu. BE Luồng Mục Tiêu
    // sẽ persist vào AutomationTrigger.* columns (quietHoursStart/End, sendInterval, etc.)
    safetyRules: {
      quietHoursStart: form.value.safetyRules.quietHoursStart,
      quietHoursEnd: form.value.safetyRules.quietHoursEnd,
      sendIntervalSeconds: form.value.safetyRules.sendIntervalSeconds,
      recencyDays: form.value.safetyRules.recencyDays,
      multinickThreshold: form.value.safetyRules.multinickThreshold,
      delayAfterFriendRequestSeconds: form.value.safetyRules.delayAfterFriendRequestSeconds,
      pauseHoursOnReply: form.value.safetyRules.pauseHoursOnReply,
      // #3 2026-06-06 — nhịp gửi + sàn welcome + cửa sổ warm (Anh nhập trên UI).
      friendReqIntervalMinMinutes: form.value.safetyRules.friendReqIntervalMinMinutes,
      friendReqIntervalMaxMinutes: form.value.safetyRules.friendReqIntervalMaxMinutes,
      welcomeMinFloorSeconds: form.value.safetyRules.welcomeMinFloorSeconds,
      warmWindowDays: form.value.safetyRules.warmWindowDays,
    },
    segmentSpec: {
      // I10 2026-06-04 — cấu trúc 5 tin mới. thankYou/remind có cột BE riêng (gửi qua
      // field top-level); extendedMessages lưu thêm remind/rejected text + delay cho ref.
      extendedMessages: {
        remind: form.value.messages.remind,
        remindDelayDays: form.value.remindDelayDays,
        rejectedFollowUp: form.value.messages.rejectedFollowUp,
      },
    },
  };
}

async function submit() {
  // 2026-06-05 — FIX double-submit (Anh phát hiện: bấm tạo NHIỀU bản trùng "Ngoán Mai").
  // Re-entry guard: nếu đang gửi rồi thì bỏ qua click thừa. Vue cập nhật :disabled ở
  // next-tick nên trong khoảng đó nút vẫn bấm được → guard JS chặn chắc chắn.
  if (submitting.value) return;
  if (!canNextStep1.value || !canNextStep2.value || !canNextStep3.value) {
    toast.warning('Chưa đủ thông tin. Hãy quay lại các bước trước để bổ sung.');
    return;
  }
  if (!isEditMode.value && form.value.startMode === 'scheduled' && scheduledError.value) {
    toast.warning(scheduledError.value);
    return;
  }
  submitting.value = true;
  try {
    if (isEditMode.value && editingTriggerId.value) {
      // P2 Wave 4 #Edit — PATCH partial update. Chỉ gửi các field BE chấp nhận
      // (name, greetingTemplate, welcomeMessageTemplate, welcomeDelaySeconds,
      // safetyRules, segmentSpec.skipRules). KHÔNG gửi listId/nickIds/sequence/
      // startMode — BE reject silently nhưng tránh waste payload.
      const fullPayload = buildSubmitPayload();
      const patchBody = {
        name: fullPayload.name,
        greetingTemplate: fullPayload.greetingTemplate,
        welcomeMessageTemplate: fullPayload.welcomeMessageTemplate,
        welcomeDelaySeconds: fullPayload.welcomeDelaySeconds,
        safetyRules: fullPayload.safetyRules,
        segmentSpec: { skipRules: fullPayload.skipRules },
      };
      await api.patch(`/automation/triggers/${editingTriggerId.value}`, patchBody);
      await router.push(`/marketing/triggers/${editingTriggerId.value}`);
      return;
    }

    const createResp = await api.post('/automation/triggers/friend-invite', buildSubmitPayload());
    const triggerId = createResp.data.trigger?.id;
    if (!triggerId) throw new Error('trigger id missing');

    // Chỉ activate ngay nếu mode = now. Mode = scheduled: BE giữ DRAFT/SCHEDULED và
    // tự activate đúng thời điểm scheduledAt (worker check). FE không gọi activate.
    if (form.value.startMode === 'now') {
      await api.post(`/automation/triggers/${triggerId}/activate`);
    }
    // 2026-06-05 — AWAIT push (trước fire-and-forget): nếu điều hướng chậm/bị huỷ,
    // anh thấy "không chuyển trang" rồi bấm lại → tạo trùng. await để chắc đi tới
    // trang chi tiết; giữ submitting=true tới lúc rời trang (KHÔNG reset ở finally
    // cho nhánh thành công — tránh nút sống lại cho bấm thêm trước khi route đổi).
    await router.push(`/marketing/triggers/${triggerId}`);
    return;
  } catch (err: any) {
    submitting.value = false;
    const verb = isEditMode.value ? 'Lưu' : 'Tạo';
    toast.error(`${verb} Mục tiêu thất bại: ${friendlyTriggerError(err)}`, 6000);
  }
}

// P2 Wave 4 #Edit 2026-06-02 — Hydrate form từ GET /:id/edit cho edit-mode.
// Gọi sau loadData() để dropdown lists/nicks/sequences đã ready (option list
// match value đúng — Vue <select> mới render đúng item selected).
async function loadForEdit(triggerId: string): Promise<void> {
  editLoading.value = true;
  try {
    const r = await api.get(`/automation/triggers/${triggerId}/edit`);
    const t = r.data;
    form.value.name = t.name ?? '';
    if (t.listId) {
      form.value.listId = t.listId;
      prefilled.value = true;
    }
    if (Array.isArray(t.nickIds)) form.value.nickIds = [...t.nickIds];
    if (t.successorSequenceId) form.value.successorSequenceId = t.successorSequenceId;
    if (typeof t.greetingTemplate === 'string') {
      form.value.messages.friendRequest = t.greetingTemplate;
    }
    if (typeof t.welcomeMessageTemplate === 'string') {
      form.value.messages.welcome = t.welcomeMessageTemplate;
    } else if (t.welcomeMessageTemplate === null) {
      // Mục tiêu trước đó không có welcome — wizard hiện cần ít nhất template,
      // giữ default đã có sẵn trong form, không clear.
    }
    if (typeof t.welcomeDelaySeconds === 'number') {
      // FIX 2026-06-08: KHÔNG round (mất độ chính xác giây — vd 1s → round(0.0167)=0).
      // base-unit minute → giữ giá trị thực giây/60 để ô nhập hiện đúng "1 giây".
      form.value.welcomeDelayMinutes = Math.max(0, t.welcomeDelaySeconds / 60);
    }
    // I13 2026-06-04 — load cấu hình 5 tin khi sửa Mục tiêu.
    if (typeof t.thankYouTemplate === 'string') form.value.messages.thankYou = t.thankYouTemplate;
    if (typeof t.thankYouDelaySeconds === 'number') form.value.thankYouDelayMinutes = Math.max(0, Math.round(t.thankYouDelaySeconds / 60));
    if (typeof t.remindTemplate === 'string') form.value.messages.remind = t.remindTemplate;
    if (typeof t.remindDelayDays === 'number') form.value.remindDelayDays = t.remindDelayDays;
    if (typeof t.rejectedTemplate === 'string') form.value.messages.rejectedFollowUp = t.rejectedTemplate;
    if (typeof t.enableWelcome === 'boolean') form.value.enableWelcome = t.enableWelcome;
    if (typeof t.enableThankYou === 'boolean') form.value.enableThankYou = t.enableThankYou;
    if (typeof t.enableRemind === 'boolean') form.value.enableRemind = t.enableRemind;
    if (typeof t.enableRejectedFollowUp === 'boolean') form.value.enableRejectedFollowUp = t.enableRejectedFollowUp;
    // #1 2026-06-06 — 2 công tắc bám đuổi.
    if (typeof t.followUpStrangerEnabled === 'boolean') form.value.followUpStrangerEnabled = t.followUpStrangerEnabled;
    if (typeof t.followUpFriendEnabled === 'boolean') form.value.followUpFriendEnabled = t.followUpFriendEnabled;
    if (t.notifyChannels && typeof t.notifyChannels === 'object') {
      const nc = t.notifyChannels as Record<string, { owner?: boolean }>;
      // Chỉ tin (welcome/thankYou/remind/rejected) — care event đã chuyển sang org-level.
      for (const k of Object.keys(form.value.notifyOwner)) {
        if (nc[k] && typeof nc[k].owner === 'boolean') form.value.notifyOwner[k] = nc[k].owner!;
      }
    }
    if (t.safetyRules) {
      const s = t.safetyRules;
      if (typeof s.quietHoursStart === 'string') form.value.safetyRules.quietHoursStart = s.quietHoursStart;
      if (typeof s.quietHoursEnd === 'string') form.value.safetyRules.quietHoursEnd = s.quietHoursEnd;
      if (typeof s.sendIntervalSeconds === 'number') form.value.safetyRules.sendIntervalSeconds = s.sendIntervalSeconds;
      if (typeof s.recencyDays === 'number') form.value.safetyRules.recencyDays = s.recencyDays;
      if (typeof s.multinickThreshold === 'number') form.value.safetyRules.multinickThreshold = s.multinickThreshold;
      // 2026-06-16 — ưu tiên giây; Mục tiêu cũ chỉ có phút → ×60.
      if (typeof s.delayAfterFriendRequestSeconds === 'number') form.value.safetyRules.delayAfterFriendRequestSeconds = s.delayAfterFriendRequestSeconds;
      else if (typeof s.delayAfterFriendRequestMin === 'number') form.value.safetyRules.delayAfterFriendRequestSeconds = s.delayAfterFriendRequestMin * 60;
      if (typeof s.pauseHoursOnReply === 'number') form.value.safetyRules.pauseHoursOnReply = s.pauseHoursOnReply;
    }
    if (t.skipRules && typeof t.skipRules === 'object') {
      const sr = t.skipRules as Record<string, unknown>;
      if (typeof sr.skipHadChat === 'boolean') form.value.skipRules.skipHadChat = sr.skipHadChat;
      if (typeof sr.skipAlreadyFriend === 'string')
        form.value.skipRules.skipAlreadyFriend = sr.skipAlreadyFriend as 'whitelisted_nick' | 'any_nick' | 'off';
      if (typeof sr.skipNoZalo === 'boolean') form.value.skipRules.skipNoZalo = sr.skipNoZalo;
      if (typeof sr.skipInactive === 'boolean') form.value.skipRules.skipInactive = sr.skipInactive;
      if (typeof sr.inactiveDays === 'number') form.value.skipRules.inactiveDays = sr.inactiveDays;
    }
    // Edit mode: skip start-mode picker (giữ schedule cũ — BE PATCH không chấp
    // nhận đổi scheduledAt qua endpoint này).
    form.value.startMode = 'now';
    form.value.scheduledAt = null;
  } catch (err: any) {
    console.error('[muc-tieu-wizard] loadForEdit failed', err);
    toast.error('Không tải được Mục tiêu để sửa: ' + friendlyTriggerError(err), 6000);
    router.push('/marketing/triggers');
  } finally {
    editLoading.value = false;
  }
}

async function loadData() {
  try {
    // 2026-06-16 — dùng /zalo-accounts/enriched (metrics today + owner) thay cho
    // /zalo-accounts, + /zalo-accounts/sdk-limits để biết trần "Gửi lời mời kết bạn".
    // enriched + sdk-limits đặt .catch riêng để 1 endpoint lỗi không nuốt lists/sequences.
    const [lr, nr, sr, kr] = await Promise.all([
      api.get('/customer-lists?status=active&limit=100'),
      api.get('/zalo-accounts/enriched').catch(() => null),
      api.get('/automation/sequences'),
      api.get('/zalo-accounts/sdk-limits').catch(() => null),
    ]);
    lists.value = (lr.data.lists ?? []) as ListSummary[];
    sequences.value = (sr.data.sequences ?? sr.data ?? []) as SequenceSummary[];

    // Trần "Gửi lời mời kết bạn" — org default + override per-nick (friend_action).
    const orgFriendDaily: number | undefined = kr?.data?.orgDefault?.friend_action?.daily;
    if (typeof orgFriendDaily === 'number') defaultFriendCap.value = orgFriendDaily;
    const nickOverrides: Record<string, { friend_action?: { daily?: number } }> = kr?.data?.nickOverrides ?? {};

    // enriched trả mảng trực tiếp. Nếu lỗi → fallback /zalo-accounts (mất counter, vẫn chọn được nick).
    let nr2 = nr;
    if (!nr2) { try { nr2 = await api.get('/zalo-accounts'); } catch { nr2 = null; } }
    const rawNicks = (nr2 ? (Array.isArray(nr2.data) ? nr2.data : (nr2.data.accounts ?? [])) : []) as any[];
    nicks.value = rawNicks.map((a): NickSummary => ({
      id: a.id,
      displayName: a.displayName ?? null,
      status: a.status,
      liveStatus: a.liveStatus ?? a.status,
      ownerUserId: a.ownerUserId ?? a.owner?.id ?? null,
      ownerName: a.owner?.fullName ?? null,
      friendReqSent: a.metricsToday?.friendReqSent ?? 0,
      msgToday: a.msgToday ?? a.metricsToday?.msgSentToStrangers ?? 0,
      msgCap: a.quota ?? 300,
      friendCap: nickOverrides[a.id]?.friend_action?.daily ?? defaultFriendCap.value,
    }));

    // Auto-pick first connected nicks as default (top 3)
    if (!form.value.nickIds.length) {
      form.value.nickIds = nicks.value
        .filter(isOnline)
        .slice(0, 3)
        .map(n => n.id);
    }
    // Auto-pick first sequence
    if (!form.value.successorSequenceId && sequences.value.length) {
      form.value.successorSequenceId = sequences.value[0].id;
    }
  } catch (err) {
    console.error('[muc-tieu-wizard] loadData failed', err);
  }
}

// 2026-06-16 — resolve tên khối của chuỗi đang chọn (GET /automation/sequences/:id
// trả kèm `blocks`). Dùng cho preview "tên khối ở mỗi bước".
async function loadSequenceBlockNames(seqId: string) {
  if (!seqId) { sequenceBlockNames.value = {}; return; }
  try {
    const { data } = await api.get(`/automation/sequences/${seqId}`);
    const blocks = (data?.blocks ?? []) as Array<{ id: string; name: string }>;
    sequenceBlockNames.value = Object.fromEntries(blocks.map(b => [b.id, b.name]));
  } catch (err) {
    console.warn('[muc-tieu-wizard] loadSequenceBlockNames failed', err);
    sequenceBlockNames.value = {};
  }
}

watch(() => form.value.successorSequenceId, (id) => {
  if (form.value.sequenceMode === 'reuse' && id) loadSequenceBlockNames(id);
}, { immediate: true });

// Pre-fill from route.query.listId
watch(() => route.query.listId, (newVal) => {
  if (newVal && typeof newVal === 'string') {
    form.value.listId = newVal;
    prefilled.value = true;
  }
}, { immediate: true });

onMounted(async () => {
  await loadData();
  // P2 Wave 4 #Edit — hydrate edit-mode AFTER loadData (cần options ready).
  const editId = route.query.edit;
  if (typeof editId === 'string' && editId.trim()) {
    editingTriggerId.value = editId.trim();
    await loadForEdit(editingTriggerId.value);
  }
});
</script>

<style scoped>
/* ============================ DESIGN TOKENS ============================ */
.mtw-page {
  /* HS re-skin 2026-06-05 — map token scoped sang HS Holding. Tên biến giữ
     nguyên (scoped trong .mtw-page nên không ảnh hưởng global). Chỉ đổi giá
     trị. State machine + template giữ nguyên. */
  --bg-page: var(--surface-2, #f7f9fc);
  --bg-card: var(--surface, #ffffff);
  --bg-soft: var(--surface-3, #f1f4f9);
  --bg-hover: var(--brand-softer, #f2f8fc);
  --bg-disabled: var(--surface-3, #f1f4f9);
  --border: var(--line, #e7eaf0);
  --border-strong: var(--line, #cdd4e0);
  --text-1: var(--ink, #141a24);
  --text-2: var(--ink-2, #475066);
  --text-3: var(--ink-3, #6b7488);
  --text-mute: var(--ink-4, #97a0b3);
  --primary: var(--brand, #1786be);
  --primary-hover: var(--brand-600, #0f6fa0);
  --primary-bg: var(--brand-soft, #e4f1f8);
  --primary-soft: var(--brand-softer, #f2f8fc);
  /* FIX 2026-06-16: bỏ tự-tham-chiếu vòng (--success: var(--success,...)) — global
     không định nghĩa --success nên var(--success) bị cyclic → vô hiệu → màu xanh
     (chấm Online, avatar av-2, banner) mất màu, hiện xám. Gán thẳng hằng số. */
  --success: #12b76a;
  --success-bg: var(--success-soft, #e7f7ef);
  --warning: var(--warning, #f5a524);
  --warning-bg: var(--warning-soft, #fdf3e2);
  --danger: var(--error, #f04438);
  --danger-bg: var(--error-soft, #fdeceb);
  --danger-border: var(--error, #ffbdad);
  --success-border: #97e5c5;
  --purple: var(--chip-purple, #6d28d9);
  --purple-bg: var(--chip-purple-bg, #f1ecfe);
  /* Amber border tint cho badge cảnh báo (HS không có token border amber riêng) */
  --amber-text: #b45309;
  --amber-border: var(--chip-amber, #f4cf8f);
  /* Indigo (defer/safety badge) — map sang chip purple HS */
  --indigo-bg: var(--chip-purple-bg, #eef2ff);
  --indigo-text: var(--chip-purple, #4f46e5);
  --indigo-border: var(--chip-purple, #c7d2fe);
  /* Skeleton shimmer mid-stop */
  --sk-mid: var(--line-2, #eceef1);
  --shadow-1: 0 1px 2px rgba(20, 26, 36, 0.05);
  --shadow-2: 0 4px 12px rgba(20, 26, 36, 0.12);

  /* HD-first: bỏ min-width 1280 (sidebar Marketing 244px → 1366-244=1122 < 1280
     gây scroll ngang). Để width:100% fit trong shell. */
  width: 100%;
  max-width: 1920px;
  margin: 0 auto;
  padding: 16px 24px 80px;
  background: var(--bg-page);
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.45;
  font-family: var(--font);
}

/* HEADER */
.crumb { font-size: 12px; color: var(--text-3); margin-bottom: 8px; }
.crumb a { color: var(--text-3); text-decoration: none; cursor: pointer; }
.crumb a:hover { color: var(--primary); }
.crumb .sep { margin: 0 6px; color: var(--text-mute); }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 20px; }
.topbar h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.01em; color: var(--text-1); }
.topbar .sub { font-size: 13px; color: var(--text-3); margin: 0; }

/* STEPPER — hàng chip HS (Anh chốt 2026-06-06) */
.stepchips {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 16px 0 4px;
  padding: 0;
}
.step-chip {
  height: 30px;
  padding: 0 14px;
  font-size: 13px;
  gap: 7px;
  cursor: pointer;
  border: 0;
}
.step-num {
  font-family: var(--mono);
  font-weight: 700;
}
.step-sep { color: var(--ink-4); }

/* STEP CARD */
.step-card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-1);
  overflow: hidden;
  margin-bottom: 8px;
}
.step-card.active { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-bg), var(--shadow-1); }
.step-card-header {
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--primary-soft);
  display: flex;
  align-items: center;
  gap: 12px;
}
.step-card-header .num {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.step-card-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
}
.step-card-header .hint {
  font-size: 12px;
  color: var(--text-3);
  margin-left: auto;
}
.step-card-body { padding: 24px; }

/* SECTION */
.section { margin-bottom: 24px; }
.section:last-child { margin-bottom: 0; }
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-help {
  font-size: 12px;
  color: var(--text-3);
  margin: 0 0 12px;
}
.req { color: var(--danger); }

/* INPUT */
.text-input {
  width: 100%;
  padding: 10px 14px;
  background: white;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-1);
  transition: all 0.15s ease;
}
.text-input:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 3px var(--primary-bg);
}
.text-input:disabled {
  background: var(--bg-disabled);
  cursor: not-allowed;
  color: var(--text-3);
}
.dropdown-wrap { display: flex; align-items: center; gap: 10px; }
.chip-inline {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: var(--primary-bg);
  color: var(--primary);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

/* NICK LIST */
/* Toolbar nick (item 3 2026-06-16): lọc nhân viên + chọn tất cả */
.nick-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin: 4px 0 10px;
}
.nick-filter { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); }
.nick-filter-select {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: white;
  font-size: 12px;
  color: var(--text-1);
  min-width: 180px;
}
.nick-toolbar-right { display: inline-flex; align-items: center; gap: 10px; }
.nick-count { font-size: 12px; color: var(--text-3); font-weight: 600; }

.nick-list {
  display: grid;
  /* item 2 2026-06-16: xếp gọn hơn — card hẹp hơn, nhiều cột hơn */
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}
.empty-hint {
  grid-column: 1 / -1;
  padding: 18px;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
  background: var(--bg-soft);
  border-radius: 6px;
}
.nick-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: white;
  cursor: pointer;
  transition: all 0.15s ease;
}
.nick-row:hover { background: var(--bg-hover); border-color: var(--primary); }
.nick-row.selected { background: var(--primary-soft); border-color: var(--primary); }
.nick-row.disabled { background: var(--bg-disabled); cursor: not-allowed; opacity: 0.6; }
.nick-row.disabled:hover { background: var(--bg-disabled); border-color: var(--border); }
.nick-checkbox {
  width: 18px; height: 18px;
  border: 2px solid var(--border-strong);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: white;
  transition: all 0.15s ease;
}
.nick-row.selected .nick-checkbox {
  background: var(--primary);
  border-color: var(--primary);
}
.nick-row.selected .nick-checkbox::after {
  content: "✓";
  color: white;
  font-size: 12px;
  font-weight: 700;
}
.nick-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--chip-purple), var(--brand));
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.nick-avatar.av-2 { background: linear-gradient(135deg, var(--success), var(--brand)); }
.nick-avatar.av-3 { background: linear-gradient(135deg, var(--warning), var(--error)); }
.nick-avatar.av-4 { background: linear-gradient(135deg, var(--ink-4), var(--ink-3)); }
.nick-avatar.av-5 { background: linear-gradient(135deg, var(--error), var(--chip-purple)); }
.nick-info { flex: 1; min-width: 0; }
.nick-name { font-size: 13px; font-weight: 600; color: var(--text-1); margin-bottom: 2px; }
.nick-meta { font-size: 11px; color: var(--text-3); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.nick-meta .dot { color: var(--text-mute); }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; vertical-align: middle; margin-right: 4px; }
/* item 2 2026-06-16: Online xanh, Offline ĐỎ */
.status-online { background: var(--success); }
.status-offline { background: var(--danger); }
.st-online { color: var(--success); font-weight: 600; }
.st-offline { color: var(--danger); font-weight: 600; }

/* SKIP RULES */
.skip-rules { display: flex; flex-direction: column; gap: 10px; }
.skip-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: white;
  cursor: pointer;
  transition: all 0.15s ease;
}
.skip-row:hover { background: var(--bg-hover); }
.skip-row.selected { background: var(--primary-soft); border-color: var(--primary); }
.skip-checkbox {
  width: 18px; height: 18px;
  border: 2px solid var(--border-strong);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: white;
}
.skip-row.selected .skip-checkbox { background: var(--primary); border-color: var(--primary); }
.skip-row.selected .skip-checkbox::after { content: "✓"; color: white; font-size: 12px; font-weight: 700; }
.skip-label { flex: 1; font-size: 13px; color: var(--text-1); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.skip-inline-dd {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: white;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.skip-inline-dd:hover { border-color: var(--primary); }
.skip-inline-input {
  width: 60px;
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  text-align: center;
  margin: 0 4px;
}
.skip-inline-input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 2px var(--primary-bg); }

/* INFO BANNER */
.info-banner {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--primary-bg);
  border: 1px solid var(--brand-soft);
  border-radius: 6px;
  font-size: 13px;
  color: var(--brand-700);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.info-banner.sm { padding: 10px 12px; font-size: 12px; margin-top: 10px; }
.info-banner .strong { font-weight: 700; }
.info-banner .muted { color: var(--text-3); }

/* STEP FOOTER */
.step-footer {
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.step-footer .left { color: var(--text-3); font-size: 12px; }
.step-footer .right { display: flex; gap: 8px; }

/* BTN — dùng global PART 4 (.btn / .btn-primary / .btn-ghost / .btn-sm).
   Chỉ giữ modifier .lg riêng cho nút submit lớn (global không có). */
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary.lg { height: 44px; padding: 0 22px; font-size: 14px; font-weight: 700; }

/* TEXTAREA */
textarea.ta {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-1);
  background: white;
  resize: vertical;
  line-height: 1.6;
  transition: all 0.15s ease;
  box-sizing: border-box;
}
textarea.ta:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 3px var(--primary-bg); }
/* item 2026-06-16: cảnh báo lời mời thiếu {name} */
textarea.ta.ta-invalid { border-color: var(--danger); }
textarea.ta.ta-invalid:focus { box-shadow: 0 0 0 3px var(--danger-bg); }
.ta-counter { font-size: 11px; color: var(--text-3); text-align: right; margin-top: 4px; }
.ta-warn {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: var(--danger); margin-top: 4px; font-weight: 500;
}
.ta-warn code {
  font-family: var(--mono); background: var(--danger-bg);
  color: var(--danger); padding: 0 4px; border-radius: 3px; font-size: 11px;
}

/* VAR CHIPS */
.var-chips { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
.var-chips-label { font-size: 12px; color: var(--text-3); margin-right: 4px; display: inline-flex; align-items: center; gap: 4px; }
.var-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--purple-bg);
  color: var(--purple);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--mono);
  cursor: pointer;
}
.var-chip:hover { background: var(--chip-purple-bg); }
/* item 4 2026-06-16: chip dạng nút bấm để chèn biến vào ô tin */
.var-chip-btn { border: 1px solid var(--purple-bg); }
.var-chip-btn:hover { border-color: var(--purple); }
.var-chip-btn code { font-family: var(--mono); background: transparent; padding: 0; color: inherit; }
/* nguồn trần SDK trong section-help nick */
.hint-src { color: var(--text-mute); font-size: 11px; }

/* MSG BUNDLE */
.msg-bundle {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
  overflow: hidden;
}
.msg-bundle-header {
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  display: flex;
  align-items: center;
  gap: 8px;
}
.bundle-hint { margin-left: auto; font-size: 11px; font-weight: 500; color: var(--text-3); }
.msg-bundle-body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
/* CareSession 2026-06-07: hint chỉ tới trang lắng nghe chung (đã tách khỏi wizard) */
.moved-hint { margin-top: 14px; background: #e6f7ef; border: 1px solid #bfe9d4; border-radius: 8px; padding: 11px 14px; font-size: 12px; color: #0a7a47; line-height: 1.5; display: flex; align-items: flex-start; gap: 8px; }
.moved-hint a { color: var(--brand, #1786be); font-weight: 600; text-decoration: none; }
.moved-hint a:hover { text-decoration: underline; }
.msg-item {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px;
}
/* #1 2026-06-06 — chọn 1 trong 2 chế độ bám đuổi (radio) */
.followup-mode {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 14px;
}
.fum-label { font-size: 13px; font-weight: 600; color: var(--text-2, #374151); margin-bottom: 2px; }
.fum-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color .12s, background .12s;
}
.fum-row.selected { border-color: #2563eb; background: #eff6ff; }
.fum-row input[type="radio"] { display: none; }
.fum-radio {
  flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px;
  border: 2px solid #cbd5e1; border-radius: 50%; position: relative;
}
.fum-row.selected .fum-radio { border-color: #2563eb; }
.fum-row.selected .fum-radio::after {
  content: ''; position: absolute; inset: 3px; border-radius: 50%; background: #2563eb;
}
.fum-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.fum-title { font-size: 13.5px; font-weight: 600; color: var(--text-1, #1f2937); }
.fum-help { font-size: 12px; color: var(--text-3, #6b7280); line-height: 1.45; }
.fum-badge {
  display: inline-block; font-size: 10.5px; font-weight: 600; color: #2563eb;
  background: #dbeafe; border-radius: 4px; padding: 1px 6px; margin-left: 4px; vertical-align: middle;
}
.msg-item-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.msg-item-icon {
  width: 28px; height: 28px;
  border-radius: 6px;
  background: var(--primary-bg);
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.msg-item-icon.icon-orange { background: var(--warning-bg); color: #b45309; }
.msg-item-icon.icon-green { background: var(--success-bg); color: #157f3c; }
.msg-item-icon.icon-yellow { background: var(--warning-bg); color: #b45309; }
.msg-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  flex: 1;
}
.msg-item-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.badge-blue { background: var(--primary-bg); color: var(--primary); }
.badge-green { background: var(--success-bg); color: #157f3c; }
.badge-orange { background: var(--warning-bg); color: #b45309; }
.badge-yellow { background: var(--warning-bg); color: #b45309; }
/* I10 2026-06-04 — cấu trúc 5 tin */
.badge-req { background: var(--ink); color: #fff; }
.badge-gray { background: var(--line-2); color: var(--ink-2); }
.msg-item.msg-locked { border-color: var(--brand-soft); background: linear-gradient(0deg, var(--brand-softer), var(--surface)); }
.icon-blue { background: var(--primary-bg); color: var(--primary); }
.flow-strip { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:14px; padding:9px 13px;
  background:var(--surface); border:1px solid var(--border); border-radius:9px; font-size:12px; color:var(--text-3); }
.flow-strip b { color:var(--text-1); }
.flow-strip .fa { color:var(--border-strong); }
.cond-chip { display:inline-block; font-size:11.5px; color:#157f3c; background:var(--success-bg); padding:2px 8px; border-radius:6px; margin-top:7px; }

/* ===== Step 2 redesign 2026-06-16 — editor + live preview ===== */
.prev-ctx {
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  padding:8px 12px; margin-bottom:12px;
  background:var(--primary-bg); border:1px solid var(--brand-soft); border-radius:6px;
  font-size:12px; color:var(--brand-700);
}
.prev-ctx .pc-lead { font-weight:700; }
.prev-ctx .grow { flex:1; }
.pc-chip { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1px solid var(--brand-soft); border-radius:999px; padding:2px 9px; font-weight:600; color:var(--text-2); }
.pc-av { width:17px; height:17px; border-radius:50%; background:linear-gradient(135deg, var(--primary), var(--brand-700,#0b5880)); color:#fff; font-size:8.5px; font-weight:800; display:inline-flex; align-items:center; justify-content:center; }
.pc-av.sl { background:linear-gradient(135deg, var(--success), var(--brand-700,#0b5880)); }
.pc-sel { font:inherit; font-size:12px; font-weight:600; color:var(--text-2); border:1px solid var(--brand-soft); border-radius:6px; background:#fff; padding:4px 8px; }

.msg-2pane { display:grid; grid-template-columns:1fr 1fr; gap:0; border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-top:8px; }
.msg-edit { padding:11px; border-right:1px dashed var(--border); }
.msg-prev { padding:11px; background:linear-gradient(180deg,#eef4f8,#f5f9fb); }
.msg-pane-lbl { font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-mute); margin-bottom:6px; display:flex; align-items:center; gap:4px; }
.msg-2pane textarea.ta { margin:0; }
.msg-edit .msg-delay-input { margin-top:9px; }
.msg-edit .cond-chip { margin-top:9px; }

/* bong bóng Zalo (tin mình gửi) */
.zalo { display:flex; }
.zbubble { max-width:90%; font-size:13px; line-height:1.55; padding:9px 12px; border-radius:14px 4px 14px 14px;
  background:var(--primary); color:#fff; white-space:pre-wrap; word-break:break-word; margin-left:auto; box-shadow:var(--shadow-1); }
.zbubble :deep(.pv-var) { background:rgba(255,255,255,.24); border-radius:4px; padding:0 3px; font-weight:700; }
.zbubble :deep(.pv-empty) { opacity:.65; font-style:italic; }

@media (max-width: 720px) {
  .msg-2pane { grid-template-columns:1fr; }
  .msg-edit { border-right:0; border-bottom:1px dashed var(--border); }
}
.ev-notify-item { padding:8px 0; border-top:1px dashed var(--border); }
.ev-notify-item:first-child { border-top:none; }
.ev-notify-head { font-size:13px; color:var(--text-1); display:flex; align-items:center; gap:7px; }
.msg-item-help {
  font-size: 12px;
  color: var(--text-3);
  margin: 0 0 10px;
  line-height: 1.5;
}
.msg-item-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.msg-item-row textarea.ta { flex: 1; }
.msg-delay-input {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 6px;
  min-width: 88px;
  flex-shrink: 0;
}
.msg-delay-input label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.msg-delay-input input {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  text-align: center;
  font-weight: 700;
  color: var(--text-1);
}
.msg-delay-input input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 2px var(--primary-bg); }
.msg-delay-input .unit { font-size: 11px; color: var(--text-3); }

/* RADIO */
.radio-group { display: flex; flex-direction: column; gap: 10px; }
.radio-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.radio-row:hover:not(.disabled) { background: var(--bg-hover); }
.radio-row.selected { background: var(--primary-soft); border-color: var(--primary); }
.radio-row.disabled { opacity: 0.5; cursor: not-allowed; background: var(--bg-disabled); }
.radio-circle {
  width: 18px; height: 18px;
  border: 2px solid var(--border-strong);
  border-radius: 50%;
  flex-shrink: 0;
  background: white;
  margin-top: 1px;
  position: relative;
}
.radio-row.selected .radio-circle { border-color: var(--primary); }
.radio-row.selected .radio-circle::after {
  content: "";
  position: absolute;
  inset: 3px;
  background: var(--primary);
  border-radius: 50%;
}
.radio-content { flex: 1; }
.radio-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.defer-badge {
  padding: 2px 6px;
  background: var(--warning-bg);
  color: var(--amber-text);
  border: 1px solid var(--amber-border);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}
.radio-help { font-size: 12px; color: var(--text-3); }

/* CHUOI PREVIEW — item 5 2026-06-16: list card 2 dòng gọn (thay grid card to) */
.chuoi-preview {
  margin-top: 12px;
  padding: 10px;
  background: var(--bg-soft);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chuoi-row2 {
  display: flex;
  align-items: center;
  gap: 10px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
}
.chuoi-row2 .n {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 700;
  font-size: 12px;
  line-height: 24px;
  text-align: center;
  flex-shrink: 0;
}
.chuoi-row2 .r-body { min-width: 0; flex: 1; }
.chuoi-row2 .r-title {
  font-size: 13px;
  color: var(--text-1);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chuoi-row2 .r-sub {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
}
.chuoi-total {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--primary-soft);
  border: 1px solid var(--brand-soft);
  border-radius: 6px;
  font-size: 12px;
  color: var(--brand-700);
  display: flex;
  align-items: center;
  gap: 8px;
}
.chuoi-total .strong { font-weight: 700; }
.chuoi-footnote { margin-top: 6px; font-size: 11px; color: var(--text-3); font-style: italic; }

/* FLOW EXPLAINER */
.flow-explainer {
  margin-top: 20px;
  padding: 14px 18px;
  background: var(--primary-bg);
  border: 1px solid var(--brand-soft);
  border-radius: 6px;
  font-size: 12px;
  color: var(--brand-700);
  line-height: 1.65;
}
.flow-explainer .strong { font-weight: 700; }

/* STEP 3 PREVIEW */
.big-banner {
  background: linear-gradient(135deg, var(--success-bg) 0%, var(--brand-soft) 100%);
  border: 1px solid var(--success-border);
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.big-banner.warn {
  background: linear-gradient(135deg, var(--warning-bg) 0%, var(--error-soft) 100%);
  border-color: var(--amber-border);
}
.big-banner .icon {
  width: 48px; height: 48px;
  border-radius: 50%;
  background: var(--success);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}
.big-banner.warn .icon { background: var(--warning); }
.big-banner .text { flex: 1; }
.big-banner .text .title { font-size: 16px; font-weight: 700; color: var(--text-1); margin-bottom: 4px; }
.big-banner .text .desc { font-size: 13px; color: var(--text-2); }
.big-banner .text .num { font-weight: 700; color: var(--success); }

.preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1.5fr;
  gap: 16px;
}
@media (max-width: 1366px) {
  .preview-grid { grid-template-columns: 1fr 1fr; }
  .preview-grid .card-preview-kh { grid-column: 1 / -1; }
}
.preview-card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
}
.preview-card h3 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* M12 — Safety rules preview card (standalone, full-width row sau preview-grid) */
.preview-card-safety {
  margin-top: 16px;
}
.preview-card-safety .safety-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 24px;
}
@media (max-width: 1366px) {
  .preview-card-safety .safety-list { grid-template-columns: 1fr; }
}
.preview-card-safety .safety-badge {
  background: var(--indigo-bg);
  color: var(--indigo-text);
  border-color: var(--indigo-border);
  margin-left: 8px;
}
.preview-card-safety .safety-off {
  color: var(--text-mute);
  font-weight: 500;
  font-style: italic;
}
.preview-card-safety .safety-info {
  margin-top: 12px;
  background: var(--bg-soft);
  color: var(--text-2);
  border: 1px dashed var(--border);
}

.alloc-table { width: 100%; border-collapse: collapse; }
.alloc-table th, .alloc-table td { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--border); font-size: 12px; }
.alloc-table th { font-weight: 600; color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.alloc-table td.num { text-align: right; font-weight: 600; color: var(--text-1); font-variant-numeric: tabular-nums; }
.alloc-table tr.disabled td { color: var(--text-mute); }
.alloc-table tr.disabled .nick-name-cell { text-decoration: line-through; }
.alloc-table tr.total-row { font-weight: 700; background: var(--bg-soft); }
.muted { color: var(--text-mute); font-size: 10px; margin-left: 4px; }

.time-list { display: flex; flex-direction: column; gap: 10px; }
.time-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 12px;
}
.time-row:last-child { border-bottom: none; }
.time-row .lbl { color: var(--text-2); }
.time-row .val { font-weight: 700; color: var(--text-1); font-variant-numeric: tabular-nums; }
.time-row .val.hi { color: var(--primary); }
.hint-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  background: var(--warning-bg);
  color: var(--amber-text);
  border: 1px solid var(--amber-border);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  vertical-align: middle;
}
.prod-line { margin-top: 10px; font-size: 12px; color: var(--text-3); line-height: 1.5; }

.kh-card {
  background: var(--bg-soft);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 10px;
  border-left: 3px solid var(--primary);
}
.kh-card:last-child { margin-bottom: 0; }
.kh-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.kh-name { font-weight: 700; font-size: 13px; color: var(--text-1); }
.kh-meta { font-size: 11px; color: var(--text-3); }
.kh-nick-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--primary-bg);
  color: var(--primary);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  margin-left: auto;
}
.kh-msgs { display: flex; flex-direction: column; gap: 6px; }
.kh-msg {
  background: white;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}
.kh-msg .when {
  font-size: 10px;
  color: var(--text-mute);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 3px;
  display: block;
}
.kh-msg .body :deep(i) {
  color: var(--purple);
  font-style: normal;
  background: var(--purple-bg);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  font-family: var(--mono);
}

/* SKELETON */
.preview-skeleton { display: flex; flex-direction: column; gap: 16px; }
@keyframes sk-pulse {
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
}
.sk-banner {
  height: 90px;
  background: linear-gradient(90deg, var(--bg-soft) 0%, var(--sk-mid) 50%, var(--bg-soft) 100%);
  border-radius: 8px;
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1.5fr;
  gap: 16px;
}
.sk-card {
  height: 220px;
  background: linear-gradient(90deg, var(--bg-soft) 0%, var(--sk-mid) 50%, var(--bg-soft) 100%);
  border-radius: 6px;
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-card-wide { grid-column: span 1; }
@media (max-width: 1366px) {
  .sk-grid { grid-template-columns: 1fr 1fr; }
  .sk-card-wide { grid-column: 1 / -1; }
}

/* START MODE (Step 3 — Bắt đầu ngay vs Hẹn lịch) */
.start-mode-section { margin-top: 24px; }
.schedule-picker {
  margin-top: 10px;
  padding: 12px 14px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.schedule-picker .dt-input {
  width: 260px;
  font-variant-numeric: tabular-nums;
}
.schedule-picker .hint-row {
  font-size: 12px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 6px;
}
.schedule-picker .hint-row strong { color: var(--text-1); }
.schedule-error {
  margin-top: 4px;
  padding: 8px 10px;
  background: var(--danger-bg);
  color: var(--danger);
  border: 1px solid var(--danger-border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

/* ────────────────────── Bước 3 — 8 inputs config (Luồng Mục Tiêu mockup 1) ────────────────────── */
.safety-section {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
  padding: 14px 16px;
  margin-bottom: 12px;
}
.safety-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  margin-bottom: 12px;
}
.safety-section-title .badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--primary-bg);
  color: var(--primary);
  text-transform: uppercase;
}
.safety-row {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border);
}
.safety-row:last-child { border-bottom: none; }
.safety-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}
.safety-label .req { color: var(--danger); font-weight: 700; }
.safety-help {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
  margin-top: 2px;
}
.safety-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.safety-input-wrap .safety-help {
  margin-top: 4px;
}
.time-range {
  display: flex;
  align-items: center;
  gap: 8px;
}
.time-input,
.num-input {
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  background: white;
  color: var(--text-1);
}
.time-input { width: 110px; }
.num-input { width: 90px; }
.num-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.num-output {
  display: inline-block;
  min-width: 36px;
  padding: 5px 8px;
  background: var(--bg-soft);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-align: center;
}
.unit {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
}
.separator {
  color: var(--text-3);
  font-weight: 600;
}
.alert-chip {
  display: inline-block;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 500;
}
.alert-chip.info {
  background: var(--primary-bg);
  color: var(--primary);
}
.cap-display-banner {
  background: var(--primary-bg);
  border-left: 3px solid var(--primary);
  padding: 10px 12px;
  font-size: 12px;
  border-radius: 4px;
  margin-bottom: 10px;
  color: var(--text-2);
}
.cap-display-banner a {
  color: var(--primary);
  font-weight: 600;
  text-decoration: none;
}
.cap-tiles {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.cap-tile {
  background: var(--bg-soft);
  padding: 10px 12px;
  border-radius: 4px;
  min-width: 160px;
}
.cap-tile-label {
  font-size: 11px;
  color: var(--text-3);
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 4px;
}
.cap-tile-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
}
.cap-tile-value .cap-tile-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
  margin-left: 4px;
}
.select-disabled {
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-soft);
  color: var(--text-2);
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  cursor: not-allowed;
}
</style>
