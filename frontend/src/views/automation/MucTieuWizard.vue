<template>
  <div class="mtw-page">
    <!-- Breadcrumb + Header -->
    <div class="crumb">
      <a href="#" @click.prevent="router.push('/marketing/triggers')">Marketing</a>
      <span class="sep">/</span>
      <a href="#" @click.prevent="router.push('/marketing/triggers')">Mục tiêu</a>
      <span class="sep">/</span>
      <span>Tạo mới</span>
    </div>
    <div class="topbar">
      <div>
        <h1>Tạo Mục tiêu mới</h1>
        <p class="sub">Mời kết bạn + bám đuổi 1 tệp khách hàng</p>
      </div>
    </div>

    <!-- Stepper sticky -->
    <div class="stepper">
      <div
        v-for="(label, idx) in stepLabels"
        :key="idx"
        class="step-wrap"
      >
        <div
          class="step-item"
          :class="{ active: currentStep === idx + 1, completed: currentStep > idx + 1 }"
          @click="goStep(idx + 1)"
        >
          <div class="step-circle">
            <span v-if="currentStep > idx + 1">✓</span>
            <span v-else>{{ idx + 1 }}</span>
          </div>
          <div class="step-label">{{ label }}</div>
        </div>
        <div
          v-if="idx < stepLabels.length - 1"
          class="step-connector"
          :class="{ done: currentStep > idx + 1 }"
        ></div>
      </div>
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
          <div class="section-title">📝 Tên Mục tiêu <span class="req">*</span></div>
          <div class="section-help">Đặt tên dễ nhận biết để theo dõi sau này.</div>
          <input
            v-model="form.name"
            class="text-input"
            placeholder="VD: Auto kết bạn Lead Q2 — 30.05.2026"
          />
        </div>

        <!-- Tệp -->
        <div class="section">
          <div class="section-title">📋 Tệp khách hàng <span class="req">*</span></div>
          <div class="section-help">
            Mục tiêu chỉ chạy trên 1 tệp.
            <span v-if="prefilled">Đã chọn sẵn từ trang Tệp khách hàng.</span>
          </div>
          <div class="dropdown-wrap">
            <select
              v-model="form.listId"
              class="text-input"
              :disabled="prefilled"
            >
              <option :value="''" disabled>— Chọn tệp khách hàng —</option>
              <option v-for="l in lists" :key="l.id" :value="l.id">
                {{ l.name }} — {{ formatNum(l.totalEntries) }} SĐT
              </option>
            </select>
            <span v-if="selectedList" class="chip-inline">
              {{ formatNum(selectedList.totalEntries) }} SĐT
            </span>
          </div>
        </div>

        <!-- Nick gửi mời -->
        <div class="section">
          <div class="section-title">👥 Nick gửi mời (chọn nhiều) <span class="req">*</span></div>
          <div class="section-help">
            Mỗi nick gửi tối đa 300 lời mời/ngày + 300 tin nhắn/ngày. Nick offline tự động bị loại.
          </div>
          <div class="nick-list">
            <div
              v-for="(n, idx) in nicks"
              :key="n.id"
              class="nick-row"
              :class="{
                selected: form.nickIds.includes(n.id),
                disabled: n.status !== 'connected',
              }"
              @click="toggleNick(n)"
            >
              <div class="nick-checkbox"></div>
              <div class="nick-avatar" :class="avatarVariant(idx)">{{ initials(n.displayName) }}</div>
              <div class="nick-info">
                <div class="nick-name">{{ n.displayName || n.id }}</div>
                <div class="nick-meta">
                  <span>
                    <span class="status-dot" :class="n.status === 'connected' ? 'status-online' : 'status-offline'"></span>
                    {{ n.status === 'connected' ? 'Online' : 'Offline' }}
                  </span>
                  <span class="dot">·</span>
                  <span>KB {{ getMockCounter(n.id, 'kb') }}/300</span>
                  <span class="dot">·</span>
                  <span>Tin {{ getMockCounter(n.id, 'msg') }}/300</span>
                </div>
              </div>
            </div>
            <div v-if="!nicks.length" class="empty-hint">Chưa có nick nào kết nối. Hãy kết nối nick Zalo trước.</div>
          </div>
        </div>

        <!-- Skip rules -->
        <div class="section">
          <div class="section-title">🛡 Quy tắc bỏ qua</div>
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
            🔵 <span><span class="strong">Tự động bỏ qua: {{ formatNum(skipEstimate.skipped) }} KH</span> · <span class="strong">Sẽ chạy: {{ formatNum(skipEstimate.willRun) }} KH</span></span>
            <span class="muted" style="margin-left: 8px; font-size: 11px;">(ước tính client — BE sẽ tính chính xác Ngày 5)</span>
          </div>
        </div>

      </div>
      <div class="step-footer">
        <div class="left">Bước 1 / 3</div>
        <div class="right">
          <button class="btn btn-ghost" @click="onCancel">Hủy</button>
          <button class="btn btn-primary" :disabled="!canNextStep1" @click="goStep(2)">Tiếp →</button>
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
              💬 Bộ tin nhắn (5 loại tin gửi cho khách hàng)
              <span class="bundle-hint">Mỗi loại tin gửi vào 1 thời điểm khác nhau trong vòng đời của 1 KH lạ → bạn.</span>
            </div>
            <div class="msg-bundle-body">

              <!-- TIN 1 -->
              <div class="msg-item">
                <div class="msg-item-head">
                  <div class="msg-item-icon">📤</div>
                  <div class="msg-item-title">Tin 1 · Tin xin kết bạn</div>
                  <span class="msg-item-badge badge-blue">Mặc định</span>
                </div>
                <p class="msg-item-help">Gửi <strong>cùng lúc</strong> với lời mời kết bạn Zalo. Tối đa 200 ký tự.</p>
                <textarea
                  v-model="form.messages.friendRequest"
                  class="ta"
                  rows="3"
                  maxlength="200"
                ></textarea>
                <div class="ta-counter">{{ form.messages.friendRequest.length }}/200</div>
              </div>

              <!-- TIN 2 -->
              <div class="msg-item">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-orange">💭</div>
                  <div class="msg-item-title">Tin 2 · Tin đề xuất KH đồng ý kết bạn</div>
                  <span class="msg-item-badge badge-orange">Stranger inbox</span>
                </div>
                <p class="msg-item-help">Gửi qua <strong>hộp thư người lạ</strong> sau khi xin KB ~30 phút, nhắc KH mở Zalo check.</p>
                <div class="msg-item-row">
                  <textarea
                    v-model="form.messages.acceptReminder"
                    class="ta"
                    rows="2"
                  ></textarea>
                  <div class="msg-delay-input">
                    <label>Sau</label>
                    <input
                      v-model.number="form.messages.acceptReminderDelayMin"
                      type="number"
                      min="5"
                      max="240"
                    />
                    <span class="unit">phút</span>
                  </div>
                </div>
              </div>

              <!-- TIN 3 -->
              <div class="msg-item">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-green">🎉</div>
                  <div class="msg-item-title">Tin 3 · Tin chào mừng khi KH đồng ý kết bạn</div>
                  <span class="msg-item-badge badge-green">Friend channel</span>
                </div>
                <p class="msg-item-help">Gửi sau khi KH bấm đồng ý kết bạn. Đặt 0 để gửi ngay lập tức.</p>
                <div class="msg-item-row">
                  <textarea
                    v-model="form.messages.welcome"
                    class="ta"
                    rows="3"
                  ></textarea>
                  <div class="msg-delay-input">
                    <label>Sau</label>
                    <input
                      v-model.number="form.welcomeDelayMinutes"
                      type="number"
                      min="0"
                      max="60"
                    />
                    <span>phút</span>
                  </div>
                </div>
              </div>

              <!-- TIN 4 -->
              <div class="msg-item">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-yellow">⏰</div>
                  <div class="msg-item-title">Tin 4 · Tin nhắc sau N ngày KH chưa đồng ý KB</div>
                  <span class="msg-item-badge badge-yellow">Sau N ngày</span>
                </div>
                <p class="msg-item-help">Gửi qua <strong>hộp thư người lạ</strong> khi quá N ngày KH chưa accept.</p>
                <div class="msg-item-row">
                  <textarea
                    v-model="form.messages.followUpAfterDays"
                    class="ta"
                    rows="3"
                  ></textarea>
                  <div class="msg-delay-input">
                    <label>Sau</label>
                    <input
                      v-model.number="form.messages.followUpDelayDays"
                      type="number"
                      min="1"
                      max="14"
                    />
                    <span class="unit">ngày</span>
                  </div>
                </div>
              </div>

              <!-- TIN 5 -->
              <div class="msg-item">
                <div class="msg-item-head">
                  <div class="msg-item-icon icon-orange">🙏</div>
                  <div class="msg-item-title">Tin 5 · Tin nhắc khi KH từ chối kết bạn</div>
                  <span class="msg-item-badge badge-orange">Stranger inbox</span>
                </div>
                <p class="msg-item-help">
                  Gửi qua <strong>hộp thư người lạ</strong> khi KH bấm từ chối KB.
                  KH reject vẫn ĐƯỢC bám đuổi tiếp qua chuỗi 5 bước.
                </p>
                <textarea
                  v-model="form.messages.rejectedFollowUp"
                  class="ta"
                  rows="3"
                ></textarea>
              </div>

            </div>
          </div>

          <div class="var-chips">
            <span class="var-chips-label">Biến dùng được trong cả 5 tin:</span>
            <span class="var-chip">{gender}</span>
            <span class="var-chip">{name}</span>
            <span class="var-chip">{sale}</span>
          </div>
        </div>

        <!-- Chuỗi bám đuổi -->
        <div class="section">
          <div class="section-title">🔄 Chuỗi bám đuổi (sau khi đã kết bạn)</div>
          <div class="section-help">
            Chạy <strong>sau Tin 3 (chào mừng)</strong> trong kênh bạn bè. Có thể dùng chuỗi có sẵn hoặc tạo mới.
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
                    @click.stop
                  >
                    <option :value="''" disabled>— Chọn Luồng kịch bản —</option>
                    <option v-for="s in sequences" :key="s.id" :value="s.id">
                      {{ s.name }} ({{ stepCount(s) }} bước)
                    </option>
                  </select>
                </div>

                <!-- Preview steps -->
                <div v-if="selectedSequence && sequenceSteps.length" class="chuoi-preview">
                  <template v-for="(step, i) in sequenceSteps" :key="i">
                    <div class="chuoi-step">
                      <span class="n">{{ i + 1 }}</span>
                      <div class="when">{{ i === 0 ? 'Ngay sau Welcome' : `Bước ${i + 1}` }}</div>
                      <div class="what">{{ stepLabel(step, i) }}</div>
                    </div>
                    <div
                      v-if="i < sequenceSteps.length - 1"
                      class="chuoi-delay"
                    >
                      ⏱ Chờ {{ delayLabel(sequenceSteps[i + 1]) }}
                    </div>
                  </template>
                </div>

                <div v-if="selectedSequence" class="chuoi-total">
                  📊 <span><span class="strong">Tổng thời gian chuỗi: {{ totalSequenceLabel }}</span> (Bước 1 → Bước {{ sequenceSteps.length }})</span>
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
          💡 <span class="strong">Cách hoạt động:</span> KH lạ → <strong>Tin 1</strong> (xin KB) → 30 phút sau <strong>Tin 2</strong> (nhắc) → nếu accept → <strong>Tin 3</strong> (chào mừng) → vào <strong>Chuỗi 5 bước</strong>. Nếu sau 3 ngày chưa accept → <strong>Tin 4</strong>. Nếu KH bấm từ chối KB → <strong>Tin 5</strong> → vẫn vào chuỗi 5 bước.
        </div>

      </div>
      <div class="step-footer">
        <div class="left">Bước 2 / 3</div>
        <div class="right">
          <button class="btn btn-ghost" @click="onCancel">Hủy</button>
          <button class="btn" @click="goStep(1)">← Quay lại</button>
          <button class="btn btn-primary" :disabled="!canNextStep2" @click="goStep(3)">Tiếp →</button>
        </div>
      </div>
    </div>

    <!-- ============================ STEP 3 ============================ -->
    <div v-if="currentStep === 3" class="step-card active">
      <div class="step-card-header">
        <div class="num">3</div>
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
            <div class="icon">⚠</div>
            <div class="text">
              <div class="title">Chưa ước được — sẽ tính khi bắt đầu chạy</div>
              <div class="desc">{{ previewError }}</div>
            </div>
            <button class="btn" @click="loadPreview">Thử lại</button>
          </div>

          <!-- Fallback local compute -->
          <div v-if="localFallback" class="preview-grid">
            <div class="preview-card">
              <h3>📊 Phân bổ nick (ước tính client)</h3>
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
              <h3>⏱ Thời gian dự kiến (ước tính client)</h3>
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
            <div class="icon">✓</div>
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
              <h3>📊 Phân bổ nick</h3>
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
              <h3>⏱ Thời gian dự kiến</h3>
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
                📊 Năng suất hệ thống: {{ preview.throughputPerDay }} KB/ngày
                ({{ preview.allocation.filter(a => a.selected).length }} nick × ~32 KB/ngày × 16h)
              </div>
              <div class="info-banner sm">
                🕒 Hoạt động giờ 6h–22h (VN). Random delay 20–40 phút. 10 nick = ~5 ngày.
              </div>
            </div>

            <!-- Preview 3 KH -->
            <div class="preview-card card-preview-kh">
              <h3>👁 Preview 3 KH mẫu (số liệu thật)</h3>

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

        <!-- Thời điểm bắt đầu -->
        <div class="section start-mode-section">
          <div class="section-title">🚀 Thời điểm bắt đầu <span class="req">*</span></div>
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
                    🕒 Chỉ cho phép giờ chạy trong khung <strong>6h–22h</strong> (giờ Việt Nam).
                    Hệ thống sẽ tự dừng ngoài khung này.
                  </div>
                  <div v-if="scheduledError" class="schedule-error">⚠ {{ scheduledError }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
      <div class="step-footer">
        <div class="left">
          Bước 3 / 3 · Sau khi bắt đầu vẫn có thể tạm dừng/sửa bất cứ lúc nào.
        </div>
        <div class="right">
          <button class="btn" @click="goStep(2)">← Quay lại</button>
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

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api } from '@/api';

const router = useRouter();
const route = useRoute();

// ============== TYPES ==============
interface ListSummary { id: string; name: string; totalEntries: number; }
interface NickSummary { id: string; displayName: string | null; status: string; dailyFriendAddCap?: number; }
interface SequenceStep { delayMinutes?: number; name?: string; label?: string; messageTemplate?: string; }
interface SequenceSummary { id: string; name: string; steps: SequenceStep[] | unknown; }

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
const stepLabels = ['Tệp + Nick + Skip', 'Lời chào + Chuỗi', 'Xem trước + Bắt đầu'];

const lists = ref<ListSummary[]>([]);
const nicks = ref<NickSummary[]>([]);
const sequences = ref<SequenceSummary[]>([]);
const submitting = ref(false);
const prefilled = ref(false);

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
  welcomeDelayMinutes: 1, // Sau khi KH accept friend, chờ bao lâu rồi gửi tin chào mừng. 0 = gửi ngay.
  messages: {
    friendRequest: 'Em chào {gender} {name}, em là {sale} bên dự án The Emerald Garden View. Em xin kết bạn để gửi tài liệu chi tiết ạ.',
    acceptReminder: 'Em vừa gửi lời mời kết bạn ạ. Anh chị mở Zalo check giúp em để em gửi tài liệu nhé.',
    acceptReminderDelayMin: 30,
    welcome: 'Em chào {gender} {name}, cảm ơn {gender} đã đồng ý kết bạn. Em xin gửi {gender} bộ tài liệu dự án ạ.',
    followUpAfterDays: 'Em chào {gender} {name}, em có gửi lời mời kết bạn nhưng chưa thấy phản hồi. Mong {gender} dành chút thời gian xem giúp em ạ.',
    followUpDelayDays: 3,
    rejectedFollowUp: 'Em chào {gender} {name}, không sao ạ. Em vẫn gửi {gender} bộ tài liệu dự án qua đây, mong {gender} dành ít phút xem giúp em.',
  },
  skipRules: {
    skipHadChat: true,
    skipAlreadyFriend: 'whitelisted_nick' as 'whitelisted_nick' | 'any_nick' | 'off',
    skipNoZalo: true,
    skipInactive: false,
    inactiveDays: 30,
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

const canNextStep2 = computed(() => {
  return form.value.messages.friendRequest.trim().length > 0
    && form.value.messages.welcome.trim().length > 0
    && !!form.value.successorSequenceId;
});

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
  if (submitting.value) return 'Đang khởi tạo...';
  return form.value.startMode === 'scheduled'
    ? '⏰ Hẹn lịch chạy Mục tiêu'
    : '▶ Bắt đầu chạy Mục tiêu';
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

// TODO BE: hiện chưa expose dailyFriendRequestCount/dailyMessageCount per nick.
// Tạm hardcode counter để minh hoạ UI. Khi BE expose → đổi thành n.dailyFriendRequestCount ?? 0
function getMockCounter(nickId: string, kind: 'kb' | 'msg'): number {
  const seedBase = nickId.charCodeAt(0) + nickId.charCodeAt(nickId.length - 1);
  if (kind === 'kb') return 280 - (seedBase % 80);
  return 156 - (seedBase % 60);
}

function toggleNick(n: NickSummary) {
  if (n.status !== 'connected') return;
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

function stepCount(s: SequenceSummary): number {
  return Array.isArray(s.steps) ? (s.steps as SequenceStep[]).length : 0;
}

function stepLabel(step: SequenceStep, idx: number): string {
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
  }
  currentStep.value = n;
  if (n === 3) loadPreview();
}

function onCancel() {
  if (confirm('Hủy bỏ tạo Mục tiêu? Mọi thay đổi sẽ mất.')) {
    router.push('/marketing/triggers');
  }
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
    startMode: form.value.startMode,
    scheduledAt: scheduledIso,
    skipRules: {
      // Map UI shape to legacy BE shape + raw new fields
      recencyDays: form.value.skipRules.skipInactive ? form.value.skipRules.inactiveDays : 0,
      friendCap: form.value.skipRules.skipAlreadyFriend === 'off' ? 999 : 2,
      skipHadChat: form.value.skipRules.skipHadChat,
      skipAlreadyFriend: form.value.skipRules.skipAlreadyFriend,
      skipNoZalo: form.value.skipRules.skipNoZalo,
      skipInactive: form.value.skipRules.skipInactive,
      inactiveDays: form.value.skipRules.inactiveDays,
      entryStatuses: [] as string[],
    },
    segmentSpec: {
      extendedMessages: {
        acceptReminder: form.value.messages.acceptReminder,
        acceptReminderDelayMin: form.value.messages.acceptReminderDelayMin,
        followUpAfterDays: form.value.messages.followUpAfterDays,
        followUpDelayDays: form.value.messages.followUpDelayDays,
        rejectedFollowUp: form.value.messages.rejectedFollowUp,
      },
    },
  };
}

async function submit() {
  if (!canNextStep1.value || !canNextStep2.value) {
    alert('Form chưa đủ thông tin. Quay lại các bước trước để bổ sung.');
    return;
  }
  if (form.value.startMode === 'scheduled' && scheduledError.value) {
    alert(scheduledError.value);
    return;
  }
  submitting.value = true;
  try {
    const createResp = await api.post('/automation/triggers/friend-invite', buildSubmitPayload());
    const triggerId = createResp.data.trigger?.id;
    if (!triggerId) throw new Error('trigger id missing');

    // Chỉ activate ngay nếu mode = now. Mode = scheduled: BE giữ DRAFT/SCHEDULED và
    // tự activate đúng thời điểm scheduledAt (worker check). FE không gọi activate.
    if (form.value.startMode === 'now') {
      await api.post(`/automation/triggers/${triggerId}/activate`);
    }
    router.push(`/marketing/triggers/${triggerId}`);
  } catch (err: any) {
    alert('Tạo Mục tiêu thất bại: ' + (err?.response?.data?.error ?? err?.message ?? 'unknown'));
  } finally {
    submitting.value = false;
  }
}

async function loadData() {
  try {
    const [lr, nr, sr] = await Promise.all([
      api.get('/customer-lists?status=active&limit=100'),
      api.get('/zalo-accounts'),
      api.get('/automation/sequences'),
    ]);
    lists.value = (lr.data.lists ?? []) as ListSummary[];
    nicks.value = (nr.data.accounts ?? nr.data ?? []) as NickSummary[];
    sequences.value = (sr.data.sequences ?? sr.data ?? []) as SequenceSummary[];

    // Auto-pick first connected nicks as default (top 3)
    if (!form.value.nickIds.length) {
      form.value.nickIds = nicks.value
        .filter(n => n.status === 'connected')
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

// Pre-fill from route.query.listId
watch(() => route.query.listId, (newVal) => {
  if (newVal && typeof newVal === 'string') {
    form.value.listId = newVal;
    prefilled.value = true;
  }
}, { immediate: true });

onMounted(() => {
  loadData();
});
</script>

<style scoped>
/* ============================ DESIGN TOKENS ============================ */
.mtw-page {
  --bg-page: #FAFBFC;
  --bg-card: #FFFFFF;
  --bg-soft: #F4F5F7;
  --bg-hover: #EBF3FF;
  --bg-disabled: #F4F5F7;
  --border: #DFE1E6;
  --border-strong: #C1C7D0;
  --text-1: #172B4D;
  --text-2: #42526E;
  --text-3: #6B778C;
  --text-mute: #97A0AF;
  --primary: #2D7FF9;
  --primary-hover: #1B6FE0;
  --primary-bg: #E7F0FF;
  --primary-soft: #F0F6FF;
  --success: #36B37E;
  --success-bg: #E3FCEF;
  --warning: #FFAB00;
  --warning-bg: #FFF7E0;
  --danger: #DE350B;
  --danger-bg: #FFEBE6;
  --purple: #6554C0;
  --purple-bg: #EAE6FF;
  --shadow-1: 0 1px 2px rgba(9, 30, 66, 0.05);
  --shadow-2: 0 4px 12px rgba(9, 30, 66, 0.12);

  width: 100%;
  min-width: 1280px;
  max-width: 1920px;
  margin: 0 auto;
  padding: 16px 24px 80px;
  background: var(--bg-page);
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.45;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto, Arial, sans-serif;
}

/* HEADER */
.crumb { font-size: 12px; color: var(--text-3); margin-bottom: 8px; }
.crumb a { color: var(--text-3); text-decoration: none; cursor: pointer; }
.crumb a:hover { color: var(--primary); }
.crumb .sep { margin: 0 6px; color: var(--text-mute); }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 20px; }
.topbar h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.01em; color: var(--text-1); }
.topbar .sub { font-size: 13px; color: var(--text-3); margin: 0; }

/* STEPPER */
.stepper {
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 20px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-1);
  position: sticky;
  top: 0;
  z-index: 20;
}
.step-wrap { display: contents; }
.step-item {
  display: flex; align-items: center; gap: 10px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  transition: background 0.15s ease;
  flex-shrink: 0;
}
.step-item:hover { background: var(--bg-soft); }
.step-circle {
  width: 26px; height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-soft);
  color: var(--text-3);
  border: 2px solid var(--border);
  flex-shrink: 0;
}
.step-item.completed .step-circle {
  background: var(--success);
  color: white;
  border-color: var(--success);
}
.step-item.active .step-circle {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
  box-shadow: 0 0 0 4px var(--primary-bg);
}
.step-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3);
  white-space: nowrap;
}
.step-item.completed .step-label { color: var(--success); }
.step-item.active .step-label { color: var(--primary); font-weight: 600; }
.step-connector {
  flex: 1;
  height: 2px;
  background: var(--border);
  margin: 0 16px;
  min-width: 40px;
}
.step-connector.done { background: var(--success); }

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
.nick-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 10px;
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
  gap: 12px;
  padding: 12px 14px;
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
  width: 36px; height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6554C0, #2D7FF9);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}
.nick-avatar.av-2 { background: linear-gradient(135deg, #36B37E, #2D7FF9); }
.nick-avatar.av-3 { background: linear-gradient(135deg, #FFAB00, #DE350B); }
.nick-avatar.av-4 { background: linear-gradient(135deg, #97A0AF, #6B778C); }
.nick-avatar.av-5 { background: linear-gradient(135deg, #DE350B, #6554C0); }
.nick-info { flex: 1; min-width: 0; }
.nick-name { font-size: 13px; font-weight: 600; color: var(--text-1); margin-bottom: 2px; }
.nick-meta { font-size: 11px; color: var(--text-3); display: flex; gap: 8px; flex-wrap: wrap; }
.nick-meta .dot { color: var(--text-mute); }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; vertical-align: middle; margin-right: 4px; }
.status-online { background: var(--success); }
.status-offline { background: var(--text-mute); }

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
  border: 1px solid #B8D4FF;
  border-radius: 6px;
  font-size: 13px;
  color: #0C4A9E;
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

/* BTN */
.btn {
  padding: 9px 16px;
  background: white;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text-2);
  transition: all 0.15s ease;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn:hover { background: var(--bg-soft); border-color: var(--text-3); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn-primary.lg { padding: 11px 22px; font-size: 14px; font-weight: 600; }
.btn-ghost { background: transparent; border-color: transparent; color: var(--text-3); }
.btn-ghost:hover { background: var(--bg-soft); color: var(--text-2); }

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
.ta-counter { font-size: 11px; color: var(--text-3); text-align: right; margin-top: 4px; }

/* VAR CHIPS */
.var-chips { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
.var-chips-label { font-size: 12px; color: var(--text-3); margin-right: 4px; }
.var-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  background: var(--purple-bg);
  color: var(--purple);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  cursor: pointer;
}
.var-chip:hover { background: #DCD6FF; }

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
.msg-item {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px;
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
.msg-item-icon.icon-orange { background: #FFEDD5; color: #B65500; }
.msg-item-icon.icon-green { background: var(--success-bg); color: #006644; }
.msg-item-icon.icon-yellow { background: var(--warning-bg); color: #B07700; }
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
.badge-green { background: var(--success-bg); color: #006644; }
.badge-orange { background: #FFEDD5; color: #B65500; }
.badge-yellow { background: var(--warning-bg); color: #B07700; }
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
  color: #B07700;
  border: 1px solid #FFD380;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}
.radio-help { font-size: 12px; color: var(--text-3); }

/* CHUOI PREVIEW */
.chuoi-preview {
  margin-top: 12px;
  padding: 16px 12px;
  background: var(--bg-soft);
  border-radius: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 8px;
  justify-content: center;
}
.chuoi-step {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 10px;
  text-align: center;
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.chuoi-step .n {
  display: inline-block;
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 700;
  font-size: 13px;
  line-height: 26px;
  margin-bottom: 6px;
}
.chuoi-step .when { font-size: 11px; color: var(--text-3); margin-bottom: 6px; font-weight: 600; }
.chuoi-step .what { font-size: 12px; color: var(--text-2); line-height: 1.4; font-weight: 500; }
.chuoi-delay {
  display: inline-flex;
  align-items: center;
  align-self: center;
  padding: 5px 10px;
  background: white;
  border: 1px dashed var(--border-strong);
  border-radius: 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  white-space: nowrap;
}
.chuoi-total {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--primary-soft);
  border: 1px solid #B8D4FF;
  border-radius: 6px;
  font-size: 12px;
  color: #0C4A9E;
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
  border: 1px solid #B8D4FF;
  border-radius: 6px;
  font-size: 12px;
  color: #0C4A9E;
  line-height: 1.65;
}
.flow-explainer .strong { font-weight: 700; }

/* STEP 3 PREVIEW */
.big-banner {
  background: linear-gradient(135deg, #E3FCEF 0%, #E7F0FF 100%);
  border: 1px solid #97E5C5;
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.big-banner.warn {
  background: linear-gradient(135deg, #FFF7E0 0%, #FFEBE6 100%);
  border-color: #FFD380;
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
  background: #FFF7E0;
  color: #B07700;
  border: 1px solid #FFD380;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  vertical-align: middle;
}
.prod-line { margin-top: 10px; font-size: 12px; color: #6B778C; line-height: 1.5; }

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
  font-family: ui-monospace, monospace;
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
  background: linear-gradient(90deg, var(--bg-soft) 0%, #ECEEF1 50%, var(--bg-soft) 100%);
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
  background: linear-gradient(90deg, var(--bg-soft) 0%, #ECEEF1 50%, var(--bg-soft) 100%);
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
  border: 1px solid #FFBDAD;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
</style>
