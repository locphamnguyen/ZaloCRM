<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  CustomerProfileDialog — Hồ sơ KH tổng hợp (component TÁI DÙNG).

  Chốt qua /office-hours 2026-06-03 (anh duyệt):
    - Modal popup giữa màn (~960px), mở từ MỌI màn (Contacts, Chat, Lead Pool…)
      qua nút "👤 Xem hồ sơ". Nhận `contactId` (tự fetch) hoặc `contact` (dùng luôn).
    - Là nơi lưu trữ + hiển thị toàn bộ thông tin KH tổng, tổng hợp từ Friend rows.
    - Sale chính = Contact.assignedUser. Sale hỗ trợ = contactAccess role='collaborator'.
      KHÔNG tạo field mới — dùng model có sẵn.
    - Field "tổng hợp" (Trạng thái/Score/Zalo) tự cập nhật từ Friend rows (aggregate
      backend có sẵn) → UI chỉ HIỂN THỊ. Field cá nhân (tên/SĐT/email/nghề/địa chỉ/
      tag CRM) sửa trực tiếp tại đây → PUT /contacts/:id + PUT /contacts/:id/tags.
    - Zalo status CHỈ 3 trạng thái: 🟢 Có Zalo / ⚪ Chưa tìm / 🔴 Không tìm thấy.
    - Responsive: modal co theo viewport (HD 1366 / FHD 1920 / 2K 2560).

  4 tab: Tổng quan · Nick chăm (N) · Lịch sử · Ghi chú.
-->
<template>
  <teleport to="body">
    <div v-if="modelValue" class="cpd-overlay" @click.self="close">
      <div class="cpd-modal" role="dialog" aria-modal="true">
        <div v-if="loading" class="cpd-loading">⏳ Đang tải hồ sơ khách hàng…</div>
        <div v-else-if="error" class="cpd-error">⚠️ {{ error }}</div>

        <template v-else-if="c || isCreate">
          <!-- ════════ Header — chế độ TẠO MỚI (gọn, cùng style Smax) ════════ -->
          <header v-if="isCreate" class="cpd-head cpd-head-create">
            <div class="cpd-av cpd-av-create"><span>＋</span></div>
            <div class="cpd-head-main">
              <div class="cpd-name">Thêm khách hàng mới</div>
              <div class="cpd-sub"><span>Nhập thông tin khách. Tên + Số điện thoại là bắt buộc.</span></div>
            </div>
            <button class="cpd-x" @click="close" title="Đóng">✕</button>
          </header>

          <!-- ════════ Header — chế độ XEM hồ sơ ════════ -->
          <header v-else-if="c" class="cpd-head">
            <div class="cpd-av" :style="{ background: avatarBg }">
              <img v-if="c.avatarUrl" :src="c.avatarUrl" :alt="displayName" />
              <span v-else>{{ initials }}</span>
            </div>
            <div class="cpd-head-main">
              <div class="cpd-name">
                {{ displayName }}
                <span v-if="c.gender === 'male'" class="gtag male">♂</span>
                <span v-else-if="c.gender === 'female'" class="gtag female">♀</span>
                <span v-if="ageOf" class="age">{{ ageOf }} tuổi</span>
              </div>
              <div class="cpd-sub">
                <span v-if="primaryPhone">📱 {{ formatVnPhone(primaryPhone) }}</span>
                <span v-if="c.email">✉ {{ c.email }}</span>
                <span v-if="locationLine">📍 {{ locationLine }}</span>
                <span v-if="c.createdAt">📅 KH từ {{ formatDate(c.createdAt) }}</span>
              </div>
              <div class="cpd-pills">
                <span class="zpill" :class="zaloPillClass">{{ zaloPillText }}</span>
                <span v-if="c.displayStatus" class="chip" :style="statusPillStyle">{{ c.displayStatus.name }}</span>
                <span v-else-if="c.status" class="chip chip-grey">{{ c.status }}</span>
                <span v-for="t in (c.tags || []).slice(0, 5)" :key="t" class="crmtag">🏷 {{ t }}</span>
              </div>
            </div>
            <div class="cpd-scorebig">
              <div class="n" :class="scoreClass">{{ Math.round(c.displayLeadScore ?? c.leadScore ?? 0) }}</div>
              <div class="l">Score</div>
            </div>
            <button class="cpd-x" @click="close" title="Đóng">✕</button>
          </header>

          <!-- ════════ Tabs (ẩn khi tạo mới — chỉ form Tổng quan) ════════ -->
          <nav v-if="!isCreate" class="cpd-tabs">
            <button
              v-for="t in tabs" :key="t.key"
              class="cpd-tab" :class="{ active: activeTab === t.key }"
              @click="activeTab = t.key"
            >
              {{ t.label }}
              <span v-if="t.count !== undefined" class="badge">{{ t.count }}</span>
            </button>
          </nav>

          <!-- ════════ Body ════════ -->
          <div class="cpd-body">
            <!-- ─── TAB: Tổng quan ─── -->
            <section v-if="activeTab === 'overview'" class="cpd-pane">
              <div class="cpd-grid2">
                <!-- Thông tin cá nhân (sửa được) -->
                <div class="cpd-card">
                  <h4>👤 Thông tin cá nhân</h4>
                  <div class="kv">
                    <span class="k">Tên khách</span>
                    <span class="v"><input v-model="form.fullName" class="cpd-in" /></span>
                  </div>
                  <div class="kv">
                    <span class="k">Giới tính</span>
                    <span class="v">
                      <select v-model="form.gender" class="cpd-in">
                        <option :value="null">— Không rõ —</option>
                        <option value="male">Nam</option>
                        <option value="female">Nữ</option>
                        <option value="other">Khác</option>
                      </select>
                    </span>
                  </div>
                  <div class="kv">
                    <span class="k">Năm sinh</span>
                    <span class="v"><input v-model="form.birthYear" class="cpd-in" placeholder="vd 1992" /></span>
                  </div>
                  <div class="kv">
                    <span class="k">Số điện thoại</span>
                    <span class="v">
                      <div class="phones-edit">
                        <div class="phone-row">
                          <input v-model="form.phone" class="cpd-in" placeholder="Số chính" />
                        </div>
                        <div v-for="(p, i) in form.extraPhones" :key="i" class="phone-row">
                          <input v-model="p.label" class="cpd-in cpd-in-mini" placeholder="Nhãn" />
                          <input v-model="p.phone" class="cpd-in" placeholder="Số phụ" />
                          <span class="phone-rm" @click="form.extraPhones.splice(i, 1)" title="Xoá số">✕</span>
                        </div>
                        <span class="add-phone" @click="form.extraPhones.push({ phone: '', label: '' })">+ Thêm số</span>
                      </div>
                    </span>
                  </div>
                  <div class="kv">
                    <span class="k">Email</span>
                    <span class="v"><input v-model="form.email" class="cpd-in" /></span>
                  </div>
                  <div class="kv">
                    <span class="k">Nghề nghiệp</span>
                    <span class="v"><input v-model="form.occupation" class="cpd-in" /></span>
                  </div>
                  <div class="kv">
                    <span class="k">Địa chỉ</span>
                    <span class="v"><input v-model="form.addressLine" class="cpd-in" placeholder="Tỉnh / Quận / chi tiết" /></span>
                  </div>
                </div>

                <!-- Chăm sóc & phân loại -->
                <div class="cpd-card">
                  <h4>🎯 Chăm sóc &amp; phân loại</h4>
                  <div class="kv">
                    <span class="k">Sale chính</span>
                    <span class="v">
                      <select v-model="form.assignedUserId" class="cpd-in">
                        <option :value="null">— Chưa gán —</option>
                        <option v-for="u in allUsers" :key="u.id" :value="u.id">{{ u.fullName }}</option>
                      </select>
                    </span>
                  </div>
                  <div v-if="!isCreate" class="kv">
                    <span class="k">Sale hỗ trợ <span class="agg">cùng chăm</span></span>
                    <span class="v">
                      <div class="assist-list">
                        <span v-for="(a, ai) in assistSales" :key="a.user?.id || ai" class="sa-chip">
                          {{ a.user?.fullName || a.user?.email || 'Sale' }}
                        </span>
                        <span v-if="!assistSales.length" class="empty">— chưa có —</span>
                      </div>
                    </span>
                  </div>
                  <div v-if="!isCreate" class="kv">
                    <span class="k">Trạng thái KH <span class="agg">tổng hợp</span></span>
                    <span class="v">
                      <span v-if="c?.displayStatus" class="chip" :style="statusPillStyle">{{ c.displayStatus.name }}</span>
                      <span v-else class="empty">—</span>
                    </span>
                  </div>
                  <div class="kv">
                    <span class="k">Nguồn khách</span>
                    <span class="v"><input v-model="form.source" class="cpd-in" placeholder="vd Facebook, Tổng đài…" /></span>
                  </div>
                  <div class="kv kv-tag">
                    <span class="k">Tag CRM <span v-if="!isCreate" class="agg">theo nick</span></span>
                    <span class="v">
                      <!-- XEM: tag per-nick (TagV2) của nick đang chăm — tái dùng TagCrmBar (DRY). -->
                      <div v-if="!isCreate" class="tag-pernick">
                        <TagCrmBar v-if="activeFriendId" :friend-id="activeFriendId" :contact-id="c?.id" />
                        <span v-else class="tag-empty-hint">Chưa có nick chăm — chưa gắn được tag riêng.</span>
                      </div>
                      <!-- TẠO MỚI: chưa có nick → nhãn CRM tự do (legacy, lưu khi tạo). -->
                      <div v-else class="tag-edit">
                        <span v-if="!form.tags.length" class="tag-empty-hint">Chưa gắn nhãn —</span>
                        <span v-for="(t, i) in form.tags" :key="i" class="crmtag editable">
                          {{ t }}<span class="rm" @click="form.tags.splice(i, 1)">✕</span>
                        </span>
                        <input
                          v-model="newTag" class="tag-add-in" placeholder="+ thêm nhãn"
                          @keydown.enter.prevent="addTag"
                        />
                      </div>
                    </span>
                  </div>
                  <div v-if="!isCreate" class="kv">
                    <span class="k">Score <span class="agg">tổng hợp</span></span>
                    <span class="v"><b :class="scoreClass">{{ Math.round((c?.displayLeadScore ?? c?.leadScore) || 0) }}</b></span>
                  </div>
                  <div v-if="!isCreate" class="kv">
                    <span class="k">Zalo <span class="agg">tổng hợp</span></span>
                    <span class="v"><span class="zpill" :class="zaloPillClass">{{ zaloPillText }}</span></span>
                  </div>
                </div>
              </div>

              <!-- ════ P2: Bảng attribute đầy đủ (read-only, xem 360°) ════ -->
              <div v-if="!isCreate" class="cpd-attr">
                <!-- Lead score breakdown 4 chiều -->
                <div v-if="hasScoreBd" class="attr-card full">
                  <h4 class="attr-h"><span class="ic">📊</span> Lead Score — {{ Math.round((c?.displayLeadScore ?? c?.leadScore) || 0) }}/100 (4 chiều)</h4>
                  <div class="bd-row">
                    <div v-for="b in scoreBd" :key="b.key" class="bd-it">
                      <div class="bd-l">{{ b.label }} <b>{{ Math.round(b.val) }}</b></div>
                      <div class="bd-t"><i :style="{ width: Math.min(100, b.val) + '%', background: b.color }"></i></div>
                    </div>
                  </div>
                </div>

                <!-- Bảng biến cá nhân hóa: Nhãn | hàm {code} (bấm copy) | giá trị thật của khách -->
                <div class="attr-tablewrap">
                  <div class="attr-tbhead">
                    <h4 class="attr-h"><span class="ic">🧬</span> Biến cá nhân hóa — bấm <code class="hh">{mã}</code> để copy chèn tin</h4>
                    <label v-if="friends.length" class="attr-nicksel" title="Biến ● đổi giá trị theo nick này">
                      Nick:
                      <select v-model="attrNickId" class="cpd-in sm">
                        <option :value="null">— Nick chính —</option>
                        <option v-for="f in sortedFriends" :key="f.id" :value="f.id">
                          {{ friendName(f) }}<span v-if="(f as any).zaloUidInNick"> · {{ (f as any).zaloUidInNick }}</span>
                        </option>
                      </select>
                    </label>
                  </div>

                  <table class="attr-tb">
                    <colgroup><col class="c-lbl" /><col class="c-code" /><col class="c-val" /></colgroup>
                    <thead>
                      <tr><th>Thuộc tính</th><th>Hàm gọi</th><th>Giá trị của khách này</th></tr>
                    </thead>
                    <tbody>
                      <template v-for="g in attrGroups" :key="g.group">
                        <tr class="attr-grp"><td colspan="3">{{ g.group }}</td></tr>
                        <tr v-for="it in g.items" :key="it.code" class="attr-itrow">
                          <td class="attr-lbl">{{ it.label }}<span v-if="it.pernick" class="pn-dot" title="Đổi theo nick đang chọn">●</span></td>
                          <td class="attr-code">
                            <button type="button" class="codechip" :title="'Copy ' + it.code" @click="copyAttr(it.code)">{{ it.code }}</button>
                          </td>
                          <td class="attr-val">
                            <span v-if="it.value" class="av-real">{{ it.value }}</span>
                            <span v-else class="dim">— trống —</span>
                          </td>
                        </tr>
                      </template>

                      <!-- Ngoài 36 biến (không chèn được vào tin) — cùng style bảng -->
                      <tr class="attr-grp"><td colspan="3">🪪 Định danh Cha (ngoài biến)</td></tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Global ID</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.zaloGlobalId" class="mono">{{ cc.zaloGlobalId }}</span><span v-else class="dim">—</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Username</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.zaloUsername" class="mono">{{ cc.zaloUsername }}</span><span v-else class="dim">—</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">UID</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span class="dim">per-nick → xem bảng trên / tab "Nick chăm"</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Có Zalo?</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span class="zpill" :class="zaloPillClass">{{ zaloPillText }}</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Lần tra cuối</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.zaloLookupAt">{{ formatDate(cc.zaloLookupAt) }}<span v-if="cc.zaloLookupAttempts" class="dim"> · {{ cc.zaloLookupAttempts }} lần</span></span><span v-else class="dim">—</span></td>
                      </tr>

                      <tr class="attr-grp"><td colspan="3">⚙ Hệ thống & nguồn (ngoài biến)</td></tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Consent</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.consentStatus">{{ cc.consentStatus }}<span v-if="cc.consentSource" class="dim"> · {{ cc.consentSource }}</span></span><span v-else class="dim">—</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Ngày nguồn</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.sourceDate">{{ formatDate(cc.sourceDate) }}</span><span v-else class="dim">—</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Tổng lịch hẹn</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val">{{ cc.totalAppointments ?? 0 }}</td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Tạo lúc</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.createdAt">{{ formatDate(cc.createdAt) }}</span><span v-else class="dim">—</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Cập nhật</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.updatedAt">{{ formatDate(cc.updatedAt) }}</span><span v-else class="dim">—</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Liên hệ đầu</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val"><span v-if="cc.firstContactDate">{{ formatDate(cc.firstContactDate) }}</span><span v-else class="dim">—</span></td>
                      </tr>
                      <tr class="attr-itrow">
                        <td class="attr-lbl">Vào pool</td>
                        <td class="attr-code"><span class="nocode">—</span></td>
                        <td class="attr-val">{{ cc.pooledCount ?? 0 }} lần</td>
                      </tr>
                    </tbody>
                  </table>
                  <div class="attr-foot">💡 36 biến dùng chung cho ô chat · mẫu tin · Khối · Sequence. Cột giá trị lấy thật từ hồ sơ khách + nick đang chọn (khớp lúc render tin). Nhóm "ngoài biến" là thông tin hệ thống, không chèn vào tin.</div>
                </div>
              </div>

              <div v-if="!isCreate" class="cpd-aggnote">
                💡 Field gắn nhãn <span class="agg">tổng hợp</span> tự cập nhật từ các nick chăm (tab "Nick chăm").
                Thông tin cá nhân sửa trực tiếp tại đây, lưu vào hồ sơ tổng.
              </div>
            </section>

            <!-- ─── TAB: Nick chăm ─── -->
            <section v-else-if="activeTab === 'nicks'" class="cpd-pane">
              <div v-if="loadingFriends" class="cpd-empty">Đang tải nick chăm…</div>
              <template v-else>
                <div class="deck-head">{{ friends.length }} NICK ĐANG CHĂM KHÁCH NÀY</div>
                <div
                  v-for="f in sortedFriends" :key="f.id"
                  class="strip" :class="[kbStripClass(f.relationshipKind), { 'strip-active': f.id === activeFriendId && props.friendId }]"
                >
                  <div class="s-r">
                    <span class="s-av" :style="{ background: friendBg(f) }">{{ friendInitials(f) }}</span>
                    <span class="nm">{{ friendName(f) }}</span>
                    <span v-if="f.isWinner" class="winb">🏆 Nick chính</span>
                    <span class="kb" :class="kbChipClass(f.relationshipKind)">{{ kbLabel(f.relationshipKind) }}</span>
                    <span class="chatdot" :class="{ off: !f.hasConversation }">
                      {{ f.hasConversation ? '💬 đang chat' : 'ø chưa chat' }}
                    </span>
                    <span class="s-right">
                      <span class="s-score" :class="friendScoreClass(f.leadScore)">{{ f.leadScore || 0 }}</span>
                    </span>
                  </div>
                  <div class="s-r s-r2">
                    <span class="s-sale">Sale <b>{{ ownerName(f) }}</b></span>
                    <span v-if="(f as any).zaloUidInNick" class="s-uid" :title="'UID Zalo của KH nhìn từ nick này'">🆔 {{ (f as any).zaloUidInNick }}</span>
                    <span v-if="f.statusRef" class="chip" :style="{ background: (f.statusRef.color || '#5a6478') + '22', color: f.statusRef.color || '#5a6478' }">{{ f.statusRef.name }}</span>
                    <span v-for="tag in friendTags(f)" :key="tag" class="ftag ft-manual">{{ tag }}</span>
                    <span class="s-meta">
                      <span>📥 <b>{{ f.totalInbound ?? 0 }}</b></span>
                      <span>📤 <b>{{ f.totalOutbound ?? 0 }}</b></span>
                    </span>
                  </div>
                  <div v-if="f.lastInboundPreview || f.lastOutboundPreview" class="s-r s-msg">
                    <span v-if="(f as any).redacted">
                      <span class="who kh">KH</span> <PrivateBlur :redacted="true" mode="inline" />
                    </span>
                    <span v-else-if="f.lastInboundPreview">
                      <span class="who kh">KH</span> "{{ cleanPreview(f.lastInboundPreview, f.lastInboundType) }}"
                    </span>
                    <span v-else-if="f.lastOutboundPreview">
                      <span class="who sale">Sale</span> "{{ cleanPreview(f.lastOutboundPreview, f.lastOutboundType) }}"
                    </span>
                  </div>
                </div>
                <div v-if="friends.length === 0" class="cpd-empty">
                  Khách này chưa có nick nào chăm (chưa có Zalo).
                </div>
              </template>
            </section>

            <!-- ─── TAB: Lịch sử ─── -->
            <section v-else-if="activeTab === 'timeline'" class="cpd-pane">
              <div v-if="loadingTimeline" class="cpd-empty">Đang tải lịch sử…</div>
              <template v-else>
                <div v-for="t in timeline" :key="t.id" class="tl-item">
                  <span class="dot"></span>
                  <div class="tx">{{ t.icon }} {{ t.text }}<div class="tt">{{ formatRelative(t.at) }}</div></div>
                </div>
                <div v-if="timeline.length === 0" class="cpd-empty">Chưa có hoạt động.</div>
              </template>
            </section>

            <!-- ─── TAB: Ghi chú ─── -->
            <section v-else-if="activeTab === 'notes'" class="cpd-pane">
              <div v-if="loadingNotes" class="cpd-empty">Đang tải ghi chú…</div>
              <template v-else>
                <div v-for="n in notes" :key="n.id" class="tl-item">
                  <span class="dot note"></span>
                  <div class="tx">{{ n.body }}<div class="tt">{{ n.author?.fullName || 'N/A' }} · {{ formatRelative(n.createdAt) }}</div></div>
                </div>
                <div v-if="notes.length === 0" class="cpd-empty">Chưa có ghi chú nào.</div>
              </template>
            </section>
          </div>

          <!-- ════════ Footer ════════ -->
          <footer class="cpd-foot">
            <template v-if="isCreate">
              <button class="btn primary" :disabled="saving" @click="save">{{ saving ? '⏳ Đang tạo…' : '＋ Tạo khách hàng' }}</button>
              <span class="spacer"></span>
              <button class="btn" @click="close">✕ Hủy</button>
            </template>
            <template v-else-if="c">
              <button v-if="c.hasZalo" class="btn primary" @click="goChat">💬 Mở chat Zalo</button>
              <button v-else class="btn virtual" @click="goChat">🔒 Mở chat nội bộ</button>
              <button class="btn" @click="$emit('automation', c)">⚡ Marketing</button>
              <span class="spacer"></span>
              <button class="btn" :disabled="saving" @click="save">{{ saving ? '⏳ Đang lưu…' : '💾 Lưu thay đổi' }}</button>
              <button class="btn" @click="close">✕ Đóng</button>
            </template>
          </footer>
        </template>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { formatRecentDateTime, cleanPreview } from '@/composables/use-contacts';
import PrivateBlur from '@/components/privacy/PrivateBlur.vue';
import TagCrmBar from '@/components/chat/TagCrmBar.vue';
import { TEMPLATE_VARIABLES } from '@/constants/template-variables';
import type { Contact } from '@/composables/use-contacts';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  /** Mở bằng id (tự fetch) HOẶC contact object có sẵn (dùng luôn, vẫn refetch chi tiết). */
  contactId?: string | null;
  contact?: Contact | null;
  /** 'view' = xem/sửa hồ sơ KH có sẵn. 'create' = form thêm KH mới (cùng style Smax). */
  mode?: 'view' | 'create';
  /** Nick (friendId) đang xem — mở từ /friends. Lái tag per-nick (Tổng quan) + highlight Nick chăm. */
  friendId?: string | null;
  /** Tab mở mặc định (vd 'nicks' khi mở từ panel Bạn bè). */
  initialTab?: TabKey;
}>(), { mode: 'view' });
const emit = defineEmits<{
  'update:modelValue': [v: boolean];
  saved: [];
  created: [c: { id: string; fullName: string | null; phone: string | null }];
  automation: [c: Contact];
}>();

const isCreate = computed(() => props.mode === 'create');

const router = useRouter();
const toast = useToast();

type TabKey = 'overview' | 'nicks' | 'timeline' | 'notes';
const activeTab = ref<TabKey>('overview');

const c = ref<Contact | null>(null);
// P2 Hồ sơ — cast gọn để bind các attribute read-only (field có sẵn từ API full-row).
const cc = computed<Record<string, any>>(() => (c.value ?? {}) as any);
// Lead score breakdown 4 chiều (engagement/intent/fit/velocity) từ aggregateBreakdown.
const scoreBd = computed(() => {
  const b = cc.value.aggregateBreakdown || {};
  return [
    { key: 'engagement', label: 'Tương tác', val: Number(b.engagement ?? 0), color: '#1786be' },
    { key: 'intent',     label: 'Ý định mua', val: Number(b.intent ?? 0),     color: '#ec4899' },
    { key: 'fit',        label: 'Phù hợp',    val: Number(b.fit ?? 0),        color: '#12b76a' },
    { key: 'velocity',   label: 'Tốc độ',     val: Number(b.velocity ?? 0),   color: '#f5a524' },
  ];
});
const hasScoreBd = computed(() => scoreBd.value.some((x) => x.val > 0));
const loading = ref(false);
const error = ref<string | null>(null);
const saving = ref(false);

const friends = ref<any[]>([]);
const loadingFriends = ref(false);
const timeline = ref<any[]>([]);
const loadingTimeline = ref(false);
const notes = ref<any[]>([]);
const loadingNotes = ref(false);
const allUsers = ref<Array<{ id: string; fullName: string }>>([]);

// ── Form state (field cấp Contact sửa được) ──
const form = ref({
  fullName: '' as string | null,
  gender: null as string | null,
  birthYear: '' as string | number | null,
  phone: '' as string | null,
  extraPhones: [] as Array<{ phone: string; label: string }>,
  email: '' as string | null,
  occupation: '' as string | null,
  addressLine: '' as string | null,
  source: '' as string | null,
  assignedUserId: null as string | null,
  tags: [] as string[],
});
const newTag = ref('');

function hydrateForm(ct: Contact) {
  form.value = {
    fullName: ct.fullName || ct.crmName || '',
    gender: ct.gender ?? null,
    birthYear: ct.birthYear ?? (ct.birthDate ? new Date(ct.birthDate).getFullYear() : ''),
    phone: ct.phone || '',
    extraPhones: (ct.phonesExtra || []).map((p) => ({ phone: p.phone, label: p.label || '' })),
    email: ct.email || '',
    occupation: ct.occupation || '',
    addressLine: ct.addressLine || '',
    source: ct.source || '',
    assignedUserId: ct.assignedUserId ?? ct.assignedUser?.id ?? null,
    tags: [...(ct.tags || [])],
  };
}

function emptyForm() {
  form.value = {
    fullName: '', gender: null, birthYear: '', phone: '', extraPhones: [],
    email: '', occupation: '', addressLine: '', source: '', assignedUserId: null, tags: [],
  };
}

// ── Fetch chi tiết khi mở ──
async function loadDetail() {
  // Mở từ /friends có thể chỉ định tab mặc định (vd 'nicks'). Create luôn ở Tổng quan.
  activeTab.value = (!isCreate.value && props.initialTab) ? props.initialTab : 'overview';
  friends.value = [];
  timeline.value = [];
  notes.value = [];
  // Mode create: form rỗng, không fetch, không cần c.value (header create không bind c).
  if (isCreate.value) {
    c.value = null;
    error.value = null;
    emptyForm();
    loadUsers();
    return;
  }
  const id = props.contactId || props.contact?.id;
  if (!id) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<Contact & { friends?: any[] }>(`/contacts/${id}`);
    c.value = res.data;
    friends.value = sortFriends(res.data.friends || []);
    hydrateForm(res.data);
  } catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || 'Không tải được hồ sơ';
  } finally {
    loading.value = false;
  }
  loadUsers();
}

function sortFriends(arr: any[]): any[] {
  const sorted = [...arr].sort((a, b) => {
    if (a.hasConversation !== b.hasConversation) return a.hasConversation ? -1 : 1;
    return (b.leadScore || 0) - (a.leadScore || 0);
  });
  if (sorted.length) sorted[0].isWinner = true;
  return sorted;
}
const sortedFriends = computed(() => friends.value);

// Nick "active" cho ô Tag CRM (tab Tổng quan) = per-nick tag (anh chốt: dùng getFriendTags).
// Ưu tiên nick được truyền vào (mở từ /friends) → nick chính (winner) → nick đầu tiên.
const activeFriendId = computed<string | null>(() => {
  if (!friends.value.length) return null;
  if (props.friendId && friends.value.some((f) => f.id === props.friendId)) return props.friendId;
  const winner = friends.value.find((f) => f.isWinner);
  return winner?.id || friends.value[0]?.id || null;
});

async function loadUsers() {
  if (allUsers.value.length) return;
  try {
    const res = await api.get<{ users?: Array<{ id: string; fullName: string }> }>('/users');
    allUsers.value = res.data?.users || [];
  } catch { /* non-critical */ }
}

async function loadTimeline() {
  const id = c.value?.id;
  if (!id || timeline.value.length) return;
  loadingTimeline.value = true;
  try {
    const res = await api.get<any>(`/customers/${id}/timeline?limit=25`);
    timeline.value = (res.data?.items ?? [])
      .map((x: any, i: number) => describeTimelineItem(x, i))
      .filter((t: any) => t.text); // bỏ item rỗng không mô tả được
  } catch { timeline.value = []; }
  finally { loadingTimeline.value = false; }
}

// Dịch enum status legacy sang tiếng Việt (activity-log lưu mã enum).
function statusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  const map: Record<string, string> = {
    new: 'Mới', contacted: 'Đã liên hệ', interested: 'Quan tâm', negotiating: 'Đang đàm phán',
    converted: 'Đã chốt', closed: 'Đã chốt', lost: 'Đã mất', following: 'Đang follow',
  };
  return map[s] || s;
}

// Timeline item từ /customers/:id/timeline. Có 2 dạng:
//  - type='message'/'call': data có preview/content
//  - type='activity': activity-log (data.action + data.details) — map sang câu tiếng Việt.
function describeTimelineItem(x: any, idx: number): { id: string; icon: string; text: string; at: string } {
  const d = x.data || {};
  const at = x.createdAt || d.createdAt;
  const id = d.id || `${x.type}-${idx}`;
  // message/call có nội dung trực tiếp
  if (x.type === 'message') {
    return { id, icon: '💬', text: cleanPreview(d.preview || d.content || d.body, d.contentType), at };
  }
  if (x.type === 'call') return { id, icon: '📞', text: d.summary || 'Cuộc gọi', at };
  if (x.type === 'note') return { id, icon: '📝', text: d.body || d.content || 'Ghi chú', at };
  if (x.type === 'appointment') return { id, icon: '📅', text: d.title || 'Lịch hẹn', at };
  // activity-log: dịch action + details sang câu người đọc
  const actor = d.user?.fullName || (d.actorType === 'system' ? 'Hệ thống' : 'Sale');
  const det = d.details || {};
  const tagName = det.to || det.tag || det.name || det.value;
  const map: Record<string, () => { icon: string; text: string }> = {
    tag_change_zalo: () => ({ icon: '🏷', text: `${actor} đổi nhãn Zalo${det.from ? ` từ "${det.from}"` : ''} → "${det.to}"` }),
    tag_change:      () => ({ icon: '🏷', text: `${actor} đổi nhãn${det.from ? ` từ "${det.from}"` : ''} → "${det.to}"` }),
    tag_add_crm:     () => ({ icon: '🏷', text: `${actor} gắn nhãn "${tagName}"` }),
    tag_remove_crm:  () => ({ icon: '🏷', text: `${actor} gỡ nhãn "${tagName}"` }),
    tag_add_zalo:    () => ({ icon: '🏷', text: `Gắn nhãn Zalo "${tagName}"` }),
    tag_remove_zalo: () => ({ icon: '🏷', text: `Gỡ nhãn Zalo "${tagName}"` }),
    auto_tag_change: () => ({ icon: '🤖', text: `Tự động cập nhật nhãn${det.to ? ` → "${det.to}"` : ''}` }),
    status_change:   () => ({ icon: '🎯', text: `${actor} đổi trạng thái → "${statusLabel(det.new ?? det.to ?? det.status)}"` }),
    contact_status_changed: () => ({ icon: '🎯', text: `${actor} đổi trạng thái KH → "${statusLabel(det.new ?? det.to ?? det.status)}"` }),
    friend_added:    () => ({ icon: '🤝', text: `Kết bạn Zalo thành công` }),
    friend_request:  () => ({ icon: '📨', text: `Đã gửi lời mời kết bạn` }),
    alias_change:    () => ({ icon: '✏️', text: `${actor} đổi tên gợi nhớ → "${det.to}"` }),
    score_change:    () => ({ icon: '⭐', text: `Score thay đổi → ${det.to ?? det.score}` }),
  };
  const built = map[d.action]?.();
  if (built) return { id, icon: built.icon, text: built.text, at };
  // fallback: category có nghĩa hơn action; dịch nhóm category phổ biến
  if (d.category === 'tags_crm' || d.category === 'tags_zalo') {
    return { id, icon: '🏷', text: `Cập nhật nhãn${tagName ? ` "${tagName}"` : ''}`, at };
  }
  // cuối cùng: hiện action thô (vẫn hơn để trống) — dev thấy để bổ sung map sau
  const label = d.action || d.category || x.type;
  return { id, icon: '•', text: label ? `Hoạt động: ${label}` : '', at };
}
async function loadNotes() {
  const id = c.value?.id;
  if (!id || notes.value.length) return;
  loadingNotes.value = true;
  try {
    const res = await api.get<any>(`/contacts/${id}/notes`);
    notes.value = res.data?.notes ?? [];
  } catch { notes.value = []; }
  finally { loadingNotes.value = false; }
}

watch(() => props.modelValue, (open) => {
  if (open) loadDetail();
});
watch(activeTab, (t) => {
  if (t === 'timeline') loadTimeline();
  if (t === 'notes') loadNotes();
});

// ── Save ──
function addTag() {
  const t = newTag.value.trim();
  if (t && !form.value.tags.includes(t)) form.value.tags.push(t);
  newTag.value = '';
}
async function save() {
  if (saving.value) return;
  const by = typeof form.value.birthYear === 'string' ? parseInt(form.value.birthYear) : form.value.birthYear;
  const payload: Record<string, any> = {
    fullName: form.value.fullName,
    gender: form.value.gender,
    birthYear: Number.isFinite(by) ? by : null,
    phone: form.value.phone,
    phonesExtra: form.value.extraPhones.filter((p) => p.phone?.trim()),
    email: form.value.email,
    occupation: form.value.occupation,
    addressLine: form.value.addressLine,
    source: form.value.source,
    assignedUserId: form.value.assignedUserId,
  };

  // ── Chế độ TẠO MỚI: POST /contacts ──
  if (isCreate.value) {
    if (!form.value.fullName?.trim() || !form.value.phone?.trim()) {
      toast.warning('Vui lòng nhập Tên khách và Số điện thoại');
      return;
    }
    saving.value = true;
    try {
      const res = await api.post<{ id: string; fullName: string | null; phone: string | null }>(
        '/contacts', { ...payload, tags: form.value.tags },
      );
      toast.success('Đã thêm khách hàng mới');
      emit('created', { id: res.data.id, fullName: res.data.fullName, phone: res.data.phone });
      emit('saved');
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'Tạo khách thất bại');
    } finally {
      saving.value = false;
    }
    return;
  }

  // ── Chế độ XEM: PUT /contacts/:id ──
  const id = c.value?.id;
  if (!id) return;
  saving.value = true;
  try {
    await api.put(`/contacts/${id}`, payload);
    // Tag per-nick (TagV2) đã tự lưu ngay qua TagCrmBar (POST/DELETE /friends/:id/tags) —
    // không ghi đè field tags legacy ở đây nữa (anh chốt: Tổng quan dùng getFriendTags).
    toast.success('Đã lưu hồ sơ khách hàng');
    emit('saved');
    close();
  } catch (err: any) {
    toast.error(err?.response?.data?.message || err?.response?.data?.error || 'Lưu thất bại');
  } finally {
    saving.value = false;
  }
}

function close() { emit('update:modelValue', false); }

function goChat() {
  if (!c.value) return;
  close();
  router.push({ path: '/chat', query: { contactId: c.value.id } });
}

// ── Computed display ──
const displayName = computed(() => c.value?.fullName || c.value?.crmName || '(chưa đặt tên)');
const primaryPhone = computed(() => c.value?.phone || null);
const locationLine = computed(() => [c.value?.province, c.value?.district].filter(Boolean).join(' / '));
const ageOf = computed(() => {
  if (!c.value) return null;
  const cy = new Date().getFullYear();
  if (c.value.birthDate) { const y = new Date(c.value.birthDate).getFullYear(); if (Number.isFinite(y)) return cy - y; }
  if (c.value.birthYear) return cy - c.value.birthYear;
  return null;
});
const initials = computed(() => {
  const s = displayName.value.trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  return parts.length === 1 ? s.charAt(0).toUpperCase() : (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
});
const avatarBg = computed(() => {
  const palette = ['#0ea5e9', '#f97316', '#10b981', '#a855f7', '#ec4899', '#eab308', '#06b6d4'];
  const h = displayName.value.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return palette[h % palette.length];
});

// Zalo CHỈ 3 trạng thái (anh chốt 2026-06-03)
const zaloDisplay = computed<'yes' | 'no' | 'unknown'>(() => {
  const ct: any = c.value;
  if (!ct) return 'unknown';
  if ((ct.childrenCount ?? 0) > 0 || ct.zaloUid || ct.zaloGlobalId || ct.zaloUsername) return 'yes';
  if (ct.displayHasZalo === true || ct.hasZalo === true) return 'yes';
  if (ct.hasZalo === false) return 'no';
  return 'unknown';
});
const zaloPillClass = computed(() => zaloDisplay.value === 'yes' ? 'z-yes' : zaloDisplay.value === 'no' ? 'z-no' : 'z-unk');
const zaloPillText = computed(() => zaloDisplay.value === 'yes' ? '🟢 Có Zalo' : zaloDisplay.value === 'no' ? '🔴 Không tìm thấy' : '⚪ Chưa tìm');

const statusPillStyle = computed(() => {
  const s: any = c.value?.displayStatus;
  if (!s?.color) return { background: 'rgba(90,100,120,0.12)', color: '#5a6478' };
  return { background: s.color + '22', color: s.color };
});
const scoreClass = computed(() => {
  const s = Math.round((c.value as any)?.displayLeadScore ?? c.value?.leadScore ?? 0);
  return s >= 70 ? 'sc-hi' : s >= 40 ? 'sc-mid' : 'sc-lo';
});

const assistSales = computed(() =>
  (c.value?.contactAccess || []).filter((a) => a.role === 'collaborator'),
);

const tabs = computed(() => [
  { key: 'overview' as TabKey, label: 'Tổng quan', count: undefined },
  { key: 'nicks' as TabKey, label: 'Nick chăm', count: friends.value.length || (c.value as any)?.childrenCount || 0 },
  { key: 'timeline' as TabKey, label: 'Lịch sử', count: undefined },
  { key: 'notes' as TabKey, label: 'Ghi chú', count: notes.value.length || undefined },
]);

// ── Friend helpers ──
function friendName(f: any) { return f.zaloAccount?.displayName || f.zaloDisplayName || f.aliasInNick || 'Nick'; }
function ownerName(f: any) { return f.zaloAccount?.owner?.fullName || '—'; }
function friendInitials(f: any) {
  const s = friendName(f); const parts = s.split(/\s+/);
  return parts.length === 1 ? s.charAt(0).toUpperCase() : (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
function friendBg(f: any) {
  const palette = ['#1e88e5', '#43a047', '#ff9800', '#7e57c2', '#ec407a'];
  const h = friendName(f).split('').reduce((a: number, ch: string) => a + ch.charCodeAt(0), 0);
  return palette[h % palette.length];
}
function friendScoreClass(s: number) { return (s || 0) >= 70 ? 'sc-hi' : (s || 0) >= 40 ? 'sc-mid' : 'sc-lo'; }
function friendTags(f: any): string[] {
  const labels = Array.isArray(f.zaloLabels) ? f.zaloLabels.map((l: any) => l.name || '').filter(Boolean) : [];
  return labels.slice(0, 3);
}
function kbLabel(k: string) {
  return { friend: '🟢 Đã kết bạn', pending_friend: '🟡 Đã gửi mời', chatting_stranger: '🔵 Chat lạ', ghost: '⚪ Đã ngắt' }[k] || k;
}
function kbChipClass(k: string) {
  return { friend: 'kbY', pending_friend: 'kbP', chatting_stranger: 'kbI', ghost: 'kbO' }[k] || 'kbO';
}
function kbStripClass(k: string) {
  return { friend: 'kb-yes', pending_friend: 'kb-pending', chatting_stranger: 'kb-info', ghost: 'kb-off' }[k] || '';
}

// ── Format ──
function formatRelative(iso: string | null | undefined) { return formatRecentDateTime(iso); }
function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function formatVnPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let s = String(phone).replace(/\D/g, '');
  if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  if (s.length === 10) return s.slice(0, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  return phone;
}

// ════════ P4: Bảng biến cá nhân hóa (per-khách) ════════
// Map 36 biến {code} → giá trị THẬT của khách đang xem. Mirror đúng resolveVars
// (BE render-template.ts) để giá trị khớp với lúc render tin. Biến per-nick
// đổi theo nick chọn ở selector (mặc định nick chính / đang chăm).
const attrNickId = ref<string | null>(null);
const attrFriend = computed<any | null>(() => {
  const list = friends.value;
  if (!list.length) return null;
  const id = attrNickId.value || activeFriendId.value;
  return list.find((f) => f.id === id) || list[0] || null;
});

function firstWordU(s: string) { const p = (s || '').trim().split(/\s+/).filter(Boolean); return p[0] || ''; }
function lastWordU(s: string) { const p = (s || '').trim().split(/\s+/).filter(Boolean); return p.length ? p[p.length - 1] : ''; }
const KB_LABEL_U: Record<string, string> = {
  friend: 'Đã kết bạn', pending_friend: 'Đã gửi mời', chatting_stranger: 'Đang nhắn lạ', ghost: 'Đã ngắt', none: 'Người lạ',
};

// Giá trị từng biến — keyed theo code KHÔNG ngoặc ({name}→name). '' = trống.
const attrValues = computed<Record<string, string>>(() => {
  const ct: any = c.value || {};
  const f: any = attrFriend.value || null;
  const fullName = (ct.fullName ?? '').trim();
  const crmFull = ((f?.aliasInNick ?? '').trim()) || fullName;
  const age = ct.birthYear ? String(new Date().getFullYear() - ct.birthYear) : (ageOf.value != null ? String(ageOf.value) : '');
  const fmt = (iso: any) => (iso ? formatDate(iso) : '');
  return {
    gender: ct.gender === 'female' ? 'Chị' : ct.gender === 'male' ? 'Anh' : 'Anh Chị',
    name: lastWordU(fullName) || 'Anh Chị',
    name_full: fullName || 'Anh Chị',
    name_first: firstWordU(fullName),
    crm_full: crmFull || 'Anh Chị',
    crm_first: firstWordU(crmFull) || 'Anh Chị',
    crm_last: lastWordU(crmFull) || 'Anh Chị',
    phone: ct.phone ?? '',
    email: ct.email ?? '',
    facebook: ct.socialFacebook ?? '',
    tiktok: ct.socialTiktok ?? '',
    age,
    occupation: ct.occupation ?? '',
    province: ct.province ?? '',
    district: ct.district ?? '',
    ward: ct.ward ?? '',
    address: ct.addressLine ?? '',
    income: ct.incomeRange ?? '',
    status: ct.statusRef?.name ?? ct.displayStatus?.name ?? '',
    nick_status: f?.statusRef?.name ?? '',
    source: ct.source ?? '',
    next_appt: fmt(ct.nextAppointment),
    score: ct.leadScore != null ? String(ct.leadScore) : '',
    first_active: fmt(ct.firstContactDate),
    last_active: fmt(ct.lastActivity ?? ct.lastInteractionAt),
    last_message: (ct.lastInboundPreview ?? '').trim(),
    last_inbound: fmt(ct.lastInboundAt),
    last_outbound: fmt(ct.lastOutboundAt),
    last_interaction: fmt(ct.lastInteractionAt),
    msg_count: f ? `${f.totalInbound ?? 0}/${f.totalOutbound ?? 0}` : '',
    uid: f?.zaloUidInNick ?? '',
    nick_name: f?.zaloAccount?.displayName ?? f?.zaloDisplayName ?? '',
    kb_status: f ? (KB_LABEL_U[f.relationshipKind] ?? '') : '',
    became_friend: fmt(f?.becameFriendAt),
    sale: lastWordU(f?.zaloAccount?.owner?.fullName ?? '') || '',
    sale_full: f?.zaloAccount?.owner?.fullName ?? '',
  };
});

// Gom 36 biến theo nhóm `cat` (giữ thứ tự catalog); pernick → 1 nhóm riêng.
const attrGroups = computed(() => {
  const order: string[] = [];
  const map: Record<string, Array<{ code: string; label: string; value: string; pernick: boolean }>> = {};
  for (const v of TEMPLATE_VARIABLES) {
    const grp = v.cat === 'pernick' ? 'Theo nick đang chọn' : (v.cat || 'Khác');
    if (!map[grp]) { map[grp] = []; order.push(grp); }
    const key = v.code.replace(/[{}]/g, '');
    map[grp].push({ code: v.code, label: v.label, value: attrValues.value[key] ?? '', pernick: v.cat === 'pernick' });
  }
  return order.map((g) => ({ group: g, items: map[g] }));
});

async function copyAttr(code: string) {
  try { await navigator.clipboard.writeText(code); toast.success(`Đã copy ${code}`); }
  catch { toast.warning(`Copy thủ công: ${code}`); }
}
</script>

<style scoped>
.cpd-overlay {
  position: fixed; inset: 0; background: rgba(20, 24, 35, 0.55);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 32px 16px; z-index: 1200;
}
.cpd-modal {
  position: relative; width: 960px; max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px); background: #fff; border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  display: flex; flex-direction: column; overflow: hidden;
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
}
/* Responsive: FHD/2K cho rộng hơn, HD co lại */
@media (min-width: 1920px) { .cpd-modal { width: 1080px; } }
@media (min-width: 2560px) { .cpd-modal { width: 1200px; } }

.cpd-loading, .cpd-error { padding: 60px; text-align: center; color: var(--smax-grey-700); }
.cpd-error { color: var(--smax-error); }

/* Header */
.cpd-head { padding: 16px 20px; border-bottom: 1px solid var(--smax-grey-200); display: flex; gap: 14px; align-items: flex-start; position: relative; }
.cpd-av { width: 56px; height: 56px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 22px; flex-shrink: 0; overflow: hidden; }
.cpd-av img { width: 100%; height: 100%; object-fit: cover; }
.cpd-head-create { align-items: center; }
.cpd-av-create { background: var(--smax-primary-soft); color: var(--smax-primary); font-size: 28px; font-weight: 400; }
.cpd-head-main { flex: 1; min-width: 0; }
.cpd-name { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gtag { font-size: 12px; border-radius: 8px; padding: 1px 7px; font-weight: 600; }
.gtag.male { background: rgba(30, 136, 229, 0.13); color: #1565c0; }
.gtag.female { background: rgba(233, 30, 99, 0.12); color: #c2185b; }
.age { font-size: 13px; color: var(--smax-grey-700); font-weight: 500; }
.cpd-sub { font-size: 12.5px; color: var(--smax-grey-700); margin-top: 4px; display: flex; gap: 12px; flex-wrap: wrap; }
.cpd-pills { display: flex; gap: 6px; margin-top: 9px; flex-wrap: wrap; align-items: center; }
.cpd-scorebig { flex-shrink: 0; text-align: center; padding: 0 6px; }
.cpd-scorebig .n { font-size: 26px; font-weight: 800; line-height: 1; }
.cpd-scorebig .n.sc-hi { color: #1b8a3f; } .cpd-scorebig .n.sc-mid { color: #ef6c00; } .cpd-scorebig .n.sc-lo { color: #c62828; }
.cpd-scorebig .l { font-size: 10px; color: var(--smax-grey-400); text-transform: uppercase; }
.cpd-x { position: absolute; top: 14px; right: 16px; border: none; background: none; font-size: 20px; color: var(--smax-grey-400); cursor: pointer; }
.cpd-x:hover { color: var(--smax-text); }

.zpill { display: inline-flex; align-items: center; gap: 3px; padding: 2px 9px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.z-yes { background: rgba(0, 200, 83, 0.14); color: #1b8a3f; }
.z-no { background: rgba(255, 61, 0, 0.12); color: #c62828; }
.z-unk { background: var(--smax-grey-100); color: #9e9e9e; }
.chip { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.chip-grey { background: rgba(90, 100, 120, 0.1); color: var(--smax-grey-700); }
.crmtag { font-size: 11px; border: 1px solid var(--smax-grey-300); border-radius: 9px; padding: 1px 8px; color: var(--smax-grey-700); background: #fff; }

/* Tabs */
.cpd-tabs { display: flex; padding: 0 20px; border-bottom: 1px solid var(--smax-grey-200); background: var(--smax-grey-50); gap: 2px; }
.cpd-tab { padding: 11px 16px; font-size: 13px; cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; color: var(--smax-grey-700); font-weight: 500; font-family: inherit; }
.cpd-tab.active { color: var(--smax-primary); border-bottom-color: var(--smax-primary); font-weight: 700; background: #fff; }
.cpd-tab .badge { font-size: 10px; background: var(--smax-grey-200); border-radius: 7px; padding: 0 6px; margin-left: 4px; }

.cpd-body { padding: 18px 20px; overflow-y: auto; flex: 1; }
.cpd-pane { animation: fade 0.12s ease; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.cpd-empty { color: var(--smax-grey-400); font-size: 12.5px; padding: 16px 0; text-align: center; }
.empty { color: var(--smax-grey-400); }

/* Overview grid */
.cpd-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 880px) { .cpd-grid2 { grid-template-columns: 1fr; } }
.cpd-card { border: 1px solid var(--smax-grey-200); border-radius: 9px; overflow: hidden; }
.cpd-card h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--smax-grey-700); font-weight: 700; padding: 9px 13px; background: var(--smax-grey-50); border-bottom: 1px solid var(--smax-grey-200); }
.kv { display: flex; justify-content: space-between; align-items: center; padding: 7px 13px; border-bottom: 1px solid var(--smax-grey-100); font-size: 12.5px; gap: 10px; }
.kv:last-child { border-bottom: none; }
.kv .k { color: var(--smax-grey-700); flex-shrink: 0; }
.kv .v { font-weight: 600; text-align: right; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex: 1; min-width: 0; }
.agg { font-size: 9px; background: rgba(41, 98, 255, 0.1); color: #1565c0; border-radius: 5px; padding: 1px 5px; font-weight: 600; }
.cpd-in { border: 1px solid transparent; border-radius: 5px; padding: 4px 8px; font-size: 12.5px; font-family: inherit; text-align: right; background: transparent; font-weight: 600; width: 100%; max-width: 230px; color: var(--smax-text); }
.cpd-in:hover { border-color: var(--smax-grey-300); background: #fff; }
.cpd-in:focus { outline: none; border-color: var(--smax-primary); background: #fff; text-align: left; }
.cpd-in-mini { max-width: 72px; text-align: left; flex-shrink: 0; }
.phones-edit { display: flex; flex-direction: column; gap: 5px; align-items: stretch; width: 100%; }
.phone-row { display: flex; gap: 6px; align-items: center; justify-content: flex-end; width: 100%; }
/* số chính 1 mình → căn phải; số phụ: nhãn trái + số phải, không dồn cục */
.phone-row .cpd-in:not(.cpd-in-mini) { flex: 1; min-width: 0; }
.phone-rm { cursor: pointer; color: var(--smax-grey-400); font-size: 11px; }
.add-phone { font-size: 11px; color: var(--smax-primary); cursor: pointer; font-weight: 600; }
.assist-list { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.sa-chip { font-size: 11px; background: var(--smax-grey-100); border-radius: 9px; padding: 2px 8px; color: var(--smax-grey-700); }
.tag-edit { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.crmtag.editable .rm { cursor: pointer; color: var(--smax-grey-400); margin-left: 4px; }
.tag-empty-hint { font-size: 11px; color: var(--smax-grey-400); font-style: italic; }
/* Ô Tag CRM theo nick (TagCrmBar) — cho phép xuống dòng, căn trái trong cột value */
.kv-tag { align-items: flex-start; }
.kv-tag .v { justify-content: flex-start; }
.tag-pernick { width: 100%; display: flex; justify-content: flex-end; }
.tag-pernick :deep(.tag-crm-bar) { padding: 0; justify-content: flex-end; }
/* Nick đang xem (mở từ /friends) — viền nổi bật */
.strip.strip-active { box-shadow: 0 0 0 2px var(--smax-primary); }
.tag-add-in { border: 1px dashed var(--smax-grey-300); border-radius: 9px; padding: 1px 8px; font-size: 11px; width: 80px; font-family: inherit; }
.tag-add-in:focus { outline: none; border-color: var(--smax-primary); }
.cpd-aggnote { margin-top: 14px; font-size: 11.5px; color: var(--smax-grey-700); background: #f7f9fc; border: 1px solid var(--smax-grey-200); border-radius: 7px; padding: 9px 13px; }

/* ── P2 Hồ sơ: bảng attribute đầy đủ (HS theme) ── */
.cpd-attr { margin-top: 14px; display: flex; flex-direction: column; gap: 12px; }
.attr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.attr-card { border: 1px solid var(--line, #e7eaf0); border-radius: var(--r-md, 10px); overflow: hidden; background: var(--surface, #fff); }
.attr-card.full { grid-column: 1 / -1; }
.attr-h { margin: 0; padding: 9px 13px; font-size: 12px; font-weight: 700; color: var(--brand-700, #0b5880); background: var(--surface-2, #f7f9fc); border-bottom: 1px solid var(--line, #e7eaf0); display: flex; align-items: center; gap: 7px; }
.attr-h .ic { font-size: 13px; }
.dim { color: var(--ink-4, #97a0b3); }
/* nhóm "ngoài biến" gộp vào bảng: mono ID + ô "không có hàm" (—) đồng nhất với .attr-* */
.attr-val .mono { font-family: var(--mono, 'Roboto Mono', monospace); font-size: 11.5px; color: var(--ink-2, #475066); background: var(--surface-3, #f1f4f9); padding: 1px 6px; border-radius: 5px; }
.attr-code .nocode { color: var(--ink-4, #97a0b3); font-size: 11px; }
/* Score breakdown 4 chiều */
.bd-row { display: flex; gap: 16px; flex-wrap: wrap; padding: 12px 13px; }
.bd-it { display: flex; flex-direction: column; gap: 5px; min-width: 110px; flex: 1; }
.bd-l { font-size: 11px; color: var(--ink-3, #6b7488); font-weight: 600; display: flex; justify-content: space-between; }
.bd-l b { font-family: var(--mono, monospace); color: var(--ink, #141a24); }
.bd-t { height: 6px; border-radius: 3px; background: var(--line, #e7eaf0); overflow: hidden; }
.bd-t i { display: block; height: 100%; border-radius: 3px; transition: width .3s; }

/* ════ P4: Bảng biến cá nhân hóa (Nhãn | {code} | giá trị thật) ════ */
.attr-tablewrap { border: 1px solid var(--line, #e7eaf0); border-radius: var(--r-md, 10px); overflow: hidden; background: var(--surface, #fff); }
.attr-tbhead { display: flex; align-items: center; gap: 10px; background: var(--surface-2, #f7f9fc); border-bottom: 1px solid var(--line, #e7eaf0); padding-right: 12px; }
.attr-tbhead .attr-h { flex: 1; border-bottom: 0; background: none; }
.attr-h .hh { font-family: var(--mono, 'Roboto Mono', monospace); font-size: 10.5px; background: var(--brand-soft, #e4f1f8); color: var(--brand-700, #0b5880); padding: 0 5px; border-radius: 4px; }
.attr-nicksel { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-3, #6b7488); font-weight: 600; white-space: nowrap; }
.cpd-in.sm { height: 28px; padding: 0 8px; font-size: 12px; border: 1px solid var(--line, #e7eaf0); border-radius: 6px; background: var(--surface, #fff); color: var(--ink, #141a24); max-width: 200px; }
.attr-tb { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.attr-tb col.c-lbl { width: 34%; } .attr-tb col.c-code { width: 26%; } .attr-tb col.c-val { width: 40%; }
.attr-tb thead th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--ink-4, #97a0b3); font-weight: 700; padding: 7px 13px; border-bottom: 1px solid var(--line, #e7eaf0); background: var(--surface, #fff); }
.attr-grp td { background: var(--surface-3, #f1f4f9); color: var(--ink-3, #6b7488); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: 5px 13px; }
.attr-itrow { border-bottom: 1px solid var(--line-2, #eef1f6); }
.attr-itrow:hover { background: var(--surface-2, #f7f9fc); }
.attr-lbl { padding: 6px 13px; color: var(--ink-2, #475066); font-weight: 600; }
.pn-dot { color: var(--brand, #1786be); font-size: 8px; margin-left: 5px; vertical-align: 1px; }
.attr-code { padding: 5px 13px; }
.codechip { font-family: var(--mono, 'Roboto Mono', monospace); font-size: 11px; color: var(--brand-700, #0b5880); background: var(--brand-soft, #e4f1f8); border: 1px solid transparent; border-radius: 5px; padding: 2px 7px; cursor: pointer; transition: background .12s, border-color .12s; }
.codechip:hover { background: var(--brand, #1786be); color: #fff; border-color: var(--brand, #1786be); }
.codechip:active { transform: translateY(1px); }
.attr-val { padding: 6px 13px; color: var(--ink, #141a24); word-break: break-word; }
.attr-val .av-real { font-weight: 500; }
.attr-foot { padding: 8px 13px; font-size: 11px; color: var(--ink-4, #97a0b3); background: var(--surface-2, #f7f9fc); border-top: 1px solid var(--line, #e7eaf0); }

/* UID per-nick ở tab Nick chăm */
.s-uid { font-family: var(--mono, monospace); font-size: 10.5px; color: var(--ink-3, #6b7488); background: var(--surface-3, #f1f4f9); padding: 1px 6px; border-radius: 5px; }

/* Nick strip (lai ①+② đã chốt) */
.deck-head { font-size: 11px; text-transform: uppercase; color: var(--smax-grey-700); font-weight: 700; margin-bottom: 9px; }
.strip { background: #fff; border: 1px solid var(--smax-grey-200); border-left: 5px solid var(--smax-grey-300); border-radius: 6px; padding: 9px 12px; margin-bottom: 7px; }
.strip.kb-yes { border-left-color: var(--smax-success); }
.strip.kb-pending { border-left-color: var(--smax-warning); }
.strip.kb-info { border-left-color: var(--smax-info); }
.strip.kb-off { border-left-color: #9e9e9e; opacity: 0.72; }
.s-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 5px; }
.s-r:last-child { margin-bottom: 0; }
.s-av { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 600; }
.s-r .nm { font-weight: 700; }
.winb { font-size: 10px; background: rgba(0, 200, 83, 0.13); color: #1b8a3f; border-radius: 6px; padding: 1px 6px; }
.kb { font-size: 11px; font-weight: 600; border-radius: 9px; padding: 1px 8px; }
.kbY { background: rgba(0, 200, 83, 0.15); color: #1b8a3f; } .kbP { background: rgba(255, 145, 0, 0.16); color: #ef6c00; }
.kbI { background: rgba(33, 150, 243, 0.14); color: #1565c0; } .kbO { background: var(--smax-grey-100); color: #9e9e9e; }
.chatdot { font-size: 11px; color: #1b8a3f; } .chatdot.off { color: #9e9e9e; }
.s-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.s-score { min-width: 30px; text-align: center; padding: 2px 7px; border-radius: 5px; font-weight: 700; font-size: 12px; }
.sc-hi { background: rgba(0, 200, 83, 0.15); color: #1b8a3f; } .sc-mid { background: rgba(255, 145, 0, 0.15); color: #ef6c00; } .sc-lo { background: rgba(255, 61, 0, 0.13); color: #c62828; }
.s-r2 { font-size: 11.5px; }
.s-sale { color: var(--smax-grey-700); } .s-sale b { color: var(--smax-text); }
.ftag { font-size: 10.5px; border: 1px solid #42a5f5; color: #1565c0; border-radius: 9px; padding: 1px 7px; font-weight: 600; }
.s-meta { display: flex; gap: 10px; margin-left: auto; color: var(--smax-grey-700); } .s-meta b { color: var(--smax-text); }
.s-msg { font-size: 11px; }
.who { font-size: 10px; font-weight: 600; border-radius: 4px; padding: 0 5px; }
.who.kh { background: rgba(0, 200, 83, 0.12); color: #1b8a3f; } .who.sale { background: rgba(33, 150, 243, 0.1); color: #1565c0; }

/* Timeline / Notes */
.tl-item { display: flex; gap: 9px; padding: 8px 0; border-bottom: 1px dashed var(--smax-grey-100); }
.tl-item .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--smax-primary); margin-top: 5px; flex-shrink: 0; }
.tl-item .dot.note { background: var(--smax-warning); }
.tl-item .tx { flex: 1; font-size: 12.5px; }
.tl-item .tx .tt { font-size: 11px; color: var(--smax-grey-400); margin-top: 2px; }

/* Footer */
.cpd-foot { padding: 12px 20px; border-top: 1px solid var(--smax-grey-200); display: flex; gap: 8px; background: var(--smax-grey-50); }
.cpd-foot .spacer { flex: 1; }
.btn { border: 1px solid var(--smax-grey-300); background: #fff; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; color: var(--smax-grey-700); font-weight: 500; font-family: inherit; }
.btn:hover { border-color: var(--smax-primary); color: var(--smax-primary); }
.btn.primary { background: var(--smax-primary); color: #fff; border-color: var(--smax-primary); }
.btn.primary:hover { background: var(--smax-primary-hover); color: #fff; }
.btn.virtual { background: #fff3e0; color: #ef6c00; border-color: #ffcc80; }
.btn:disabled { opacity: 0.6; cursor: default; }
</style>
