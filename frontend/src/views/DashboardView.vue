<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="airtable-scope dh-v4">
    <!-- Attribution marquee (Apache License) -->
    <div v-if="attribution.enabled.value" class="dh-attr">
      <a :href="attribution.href" target="_blank" rel="noopener">{{ attribution.text }}</a>
    </div>

    <!-- ── Role-tab strip — chỉ hiện khi có quyền >1 tab (sale ẩn) ── -->
    <div v-if="hub.hasTeamSection.value || hub.hasSystemSection.value" class="at-roletabs">
      <button class="at-roletab" :class="{ 'is-active': activeTab === 'me' }" @click="activeTab = 'me'">
        <Target :size="16" :stroke-width="2" /> Việc của tôi
      </button>
      <button
        v-if="hub.hasTeamSection.value"
        class="at-roletab"
        :class="{ 'is-active': activeTab === 'team' }"
        @click="activeTab = 'team'"
      >
        <Users :size="16" :stroke-width="2" /> Quản lý team
        <span v-if="teamBacklog > 0" class="at-roletab__cnt">{{ teamBacklog }}</span>
      </button>
      <button
        v-if="hub.hasSystemSection.value"
        class="at-roletab"
        :class="{ 'is-active': activeTab === 'system' }"
        @click="activeTab = 'system'"
      >
        <Shield :size="16" :stroke-width="2" /> Quản lý hệ thống
      </button>
      <div class="at-roletabs__spacer"></div>
      <!-- Scope mirror (theo tab đang xem) -->
      <button
        v-if="activeTab === 'system'"
        class="at-roletabs__scope is-locked"
      >
        <Shield :size="14" :stroke-width="2" /> Toàn tổ chức <Lock :size="13" :stroke-width="2" />
      </button>
    </div>

    <div class="at-dash-body">
      <!-- ════════════════ TAB 1 — VIỆC CỦA TÔI ════════════════ -->
      <div v-show="activeTab === 'me'" class="dh-tabpanel">
        <!-- Greeting -->
        <div class="at-greet">
          <div>
            <div class="at-greet__h"><Sun :size="16" :stroke-width="2" /> Chào {{ greetingHour }}, {{ firstName(viewedName) }}!</div>
            <div class="at-greet__s">
              Hôm nay có <b>{{ totalUnreplied }} tin chưa rep</b>, <b>{{ totalAppts }} lịch hẹn</b>
              <template v-if="me?.sessions"> và <b>{{ me.sessions.active }} phiên đang theo dõi</b></template>.
            </div>
          </div>
          <div class="at-greet__r">
            <!-- Scope picker (view-as) — chỉ trưởng phòng/admin -->
            <div v-if="canPickUser" class="dh-scope" style="position:relative">
              <button class="at-roletabs__scope" @click.stop="userPickerOpen = !userPickerOpen">
                <User :size="14" :stroke-width="2" /> {{ currentViewedUserName }} <ChevronDown :size="14" :stroke-width="2" />
              </button>
              <div v-if="userPickerOpen" class="dh-pdd" @click.stop>
                <div class="dh-pdd-search">
                  <Search :size="14" :stroke-width="2" />
                  <input v-model="userPickerSearch" placeholder="Tìm nhân viên" />
                </div>
                <div class="dh-pdd-group">CỦA TÔI</div>
                <div class="dh-pdd-item" :class="{ active: !hub.viewAsUserId.value }" @click="selectUser(null)">
                  {{ auth.user?.fullName }}
                </div>
                <template v-if="filteredPickerUsers.length">
                  <div class="dh-pdd-group">CẤP DƯỚI</div>
                  <div
                    v-for="u in filteredPickerUsers"
                    :key="u.id"
                    class="dh-pdd-item"
                    :class="{ active: hub.viewAsUserId.value === u.id }"
                    @click="selectUser(u.id)"
                  >
                    {{ u.fullName }}<span class="dh-pdd-dept">{{ u.departmentName }}</span>
                  </div>
                </template>
              </div>
            </div>
            <button class="at-btn at-btn--secondary at-btn--sm" @click="goToLeadPool">
              <Gift :size="14" :stroke-width="2" /> Nhận khách
            </button>
            <button class="at-btn at-btn--primary at-btn--sm" @click="goToInbox">
              <MessageCircle :size="14" :stroke-width="2" /> Vào Tin nhắn
            </button>
          </div>
        </div>

        <!-- 6 KPI -->
        <div class="at-kpi-grid">
          <div class="at-kpi-tile at-kpi--clickable at-kpi--danger" @click="goToInbox">
            <div class="at-kpi-label"><Inbox :size="13" :stroke-width="2" /> Chưa rep</div>
            <div class="at-kpi-value"><PrivVal :split="me?.kpi.unreplied" /></div>
            <div class="at-kpi-sub">Cần trả lời ngay</div>
          </div>
          <div class="at-kpi-tile at-kpi--clickable at-kpi--warn" @click="goToAppts">
            <div class="at-kpi-label"><CalendarClock :size="13" :stroke-width="2" /> Hẹn hôm nay</div>
            <div class="at-kpi-value"><PrivVal :split="me?.kpi.todayAppointments" /></div>
            <div class="at-kpi-sub">Lịch hẹn của bạn</div>
          </div>
          <div class="at-kpi-tile at-kpi--clickable at-kpi--info">
            <div class="at-kpi-label"><Eye :size="13" :stroke-width="2" /> Đang theo dõi</div>
            <div class="at-kpi-value">{{ me?.sessions?.active ?? 0 }}</div>
            <div class="at-kpi-sub">{{ me?.sessions?.replied ?? 0 }} KH vừa rep</div>
          </div>
          <div class="at-kpi-tile at-kpi--clickable" @click="goToContacts">
            <div class="at-kpi-label"><Target :size="13" :stroke-width="2" /> KH của tôi</div>
            <div class="at-kpi-value">{{ me?.kpi.totalContacts ?? 0 }}</div>
            <div class="at-kpi-sub">{{ me?.interactionToday?.newLeads ?? 0 }} mới hôm nay</div>
          </div>
          <div class="at-kpi-tile at-kpi--clickable at-kpi--warn">
            <div class="at-kpi-label"><Moon :size="13" :stroke-width="2" /> KH đình trệ</div>
            <div class="at-kpi-value"><PrivVal :split="me?.kpi.dormantContacts" /></div>
            <div class="at-kpi-sub">&gt;7 ngày không nhắn</div>
          </div>
          <div class="at-kpi-tile at-kpi--clickable at-kpi--good">
            <div class="at-kpi-label"><CircleCheck :size="13" :stroke-width="2" /> Chốt tháng</div>
            <div class="at-kpi-value">{{ me?.kpi.closedThisMonth ?? 0 }}</div>
            <div class="at-kpi-sub">Khách đã chốt</div>
          </div>
        </div>

        <div class="at-dash-grid-2">
          <!-- LEFT -->
          <div class="at-dash-col">
            <!-- Cần rep gấp -->
            <div class="at-card">
              <div class="at-card__head">
                <div class="at-card__title"><Flame :size="14" :stroke-width="2" /> Cần rep gấp</div>
                <span v-if="me?.urgent.length" class="at-card__badge at-card__badge--d">{{ me.urgent.length }}</span>
              </div>
              <div class="at-card__body">
                <div
                  v-for="u in me?.urgent ?? []"
                  :key="u.conversationId"
                  class="at-urgent-row"
                  @click="goToConv(u.conversationId)"
                >
                  <Avatar
                    :src="u.contactAvatar || null"
                    :name="u.contactName"
                    :size="38"
                    :platform="'zalo'"
                    :gradient-seed="u.conversationId"
                    class="at-urgent-av"
                  />
                  <div class="at-urgent-body">
                    <div class="at-urgent-top">
                      <span class="at-urgent-nm">
                        <Lock v-if="u.isPrivateNick" :size="11" :stroke-width="2" />{{ u.contactName }}
                      </span>
                      <span class="at-urgent-time">{{ ago(u.lastMessageAt) }}</span>
                    </div>
                    <div class="at-urgent-preview" :class="{ 'is-blur': u.redacted }">
                      {{ u.messagePreview || 'Khách vừa nhắn' }}
                    </div>
                    <div class="at-urgent-meta">
                      <span v-if="urgentStatus(u.status)" class="at-statchip at-statchip--sm" :class="urgentStatus(u.status)!.cls">
                        {{ urgentStatus(u.status)!.label }}
                      </span>
                      <span class="at-urgent-nick">{{ u.nickName }}</span>
                    </div>
                  </div>
                  <span class="at-rowpill at-rowpill--unread">{{ u.unreadCount }}</span>
                </div>
                <div v-if="!me?.urgent.length" class="at-empty"><div class="at-empty__title">Không có tin nào chưa rep</div></div>
              </div>
            </div>

            <!-- Phiên theo dõi -->
            <div class="at-card">
              <div class="at-card__head">
                <div class="at-card__title"><Eye :size="14" :stroke-width="2" /> Phiên theo dõi</div>
                <span class="at-card__link" @click="goToCareSessions">Xem tất cả</span>
              </div>
              <div class="at-ministats">
                <div class="at-ministat"><div class="at-ministat__v">{{ me?.sessions?.active ?? 0 }}</div><div class="at-ministat__l">Đang theo dõi</div></div>
                <div class="at-ministat at-ministat--good"><div class="at-ministat__v">{{ me?.sessions?.replied ?? 0 }}</div><div class="at-ministat__l">KH vừa rep</div></div>
                <div class="at-ministat at-ministat--warn"><div class="at-ministat__v">{{ me?.sessions?.paused ?? 0 }}</div><div class="at-ministat__l">Tạm dừng</div></div>
                <div class="at-ministat"><div class="at-ministat__v">{{ me?.sessions?.closedThisMonth ?? 0 }}</div><div class="at-ministat__l">Chốt tháng</div></div>
              </div>
            </div>
          </div>

          <!-- RIGHT -->
          <div class="at-dash-col">
            <!-- Nhắc nhở -->
            <div class="at-card">
              <div class="at-card__head">
                <div class="at-card__title"><Bell :size="14" :stroke-width="2" /> Nhắc nhở</div>
                <span v-if="reminderCount > 0" class="at-card__badge at-card__badge--w">{{ reminderCount }}</span>
              </div>
              <div class="at-card__body">
                <div v-for="a in me?.reminders?.overdue ?? []" :key="'ov'+a.id" class="at-list-row" @click="goToAppts">
                  <span class="at-list-row__av at-list-row__av--r"><TriangleAlert :size="15" :stroke-width="2" /></span>
                  <div>
                    <div class="at-list-row__nm" style="color:var(--at-atlas-danger)">Hẹn QUÁ HẠN — {{ a.contactName || a.title }}</div>
                    <div class="at-list-row__mt">{{ apptHM(a.appointmentDate, a.appointmentTime) }} · {{ a.location || 'Không rõ địa điểm' }}</div>
                  </div>
                  <span class="at-list-row__rt"><TriangleAlert :size="13" :stroke-width="2" /></span>
                </div>
                <div v-for="a in me?.reminders?.today ?? []" :key="'td'+a.id" class="at-list-row" @click="goToAppts">
                  <span class="at-list-row__av at-list-row__av--o"><CalendarClock :size="15" :stroke-width="2" /></span>
                  <div>
                    <div class="at-list-row__nm">Hẹn hôm nay — {{ a.contactName || a.title }}</div>
                    <div class="at-list-row__mt">{{ apptHM(a.appointmentDate, a.appointmentTime) }} · {{ a.location || 'Không rõ' }}</div>
                  </div>
                  <span class="at-list-row__rt">Hôm nay</span>
                </div>
                <div v-for="a in me?.reminders?.tomorrow ?? []" :key="'tm'+a.id" class="at-list-row" @click="goToAppts">
                  <span class="at-list-row__av at-list-row__av--o"><CalendarClock :size="15" :stroke-width="2" /></span>
                  <div>
                    <div class="at-list-row__nm">Hẹn ngày mai — {{ a.contactName || a.title }}</div>
                    <div class="at-list-row__mt">{{ apptHM(a.appointmentDate, a.appointmentTime) }} · {{ a.location || 'Không rõ' }}</div>
                  </div>
                  <span class="at-list-row__rt">Mai</span>
                </div>
                <div v-for="b in me?.reminders?.birthdays ?? []" :key="'bd'+b.id" class="at-list-row" @click="goToContacts">
                  <span class="at-list-row__av at-list-row__av--p"><Cake :size="15" :stroke-width="2" /></span>
                  <div>
                    <div class="at-list-row__nm">Sinh nhật — {{ b.contactName }}</div>
                    <div class="at-list-row__mt">Hôm nay · gửi lời chúc</div>
                  </div>
                  <span class="at-list-row__rt"><Gift :size="13" :stroke-width="2" /></span>
                </div>
                <div v-if="reminderCount === 0" class="at-empty"><div class="at-empty__title">Không có nhắc nhở</div></div>
              </div>
            </div>

            <!-- Quota nick -->
            <div class="at-card">
              <div class="at-card__head"><div class="at-card__title"><Zap :size="14" :stroke-width="2" /> Quota nick hôm nay</div></div>
              <div class="at-quota">
                <div v-for="n in me?.quotaNicks ?? []" :key="n.id" class="at-quota__line">
                  <div class="at-quota__top">
                    <span class="at-quota__nm" :style="n.isPrivate ? 'color:var(--at-atlas-warning)' : ''">
                      <Lock v-if="n.isPrivate" :size="12" :stroke-width="2" />{{ n.displayName }}
                    </span>
                    <span class="at-quota__vl">{{ n.isPrivate ? '—' : (n.messagesToday + '/300') }}</span>
                  </div>
                  <div class="at-bar">
                    <div v-if="!n.isPrivate" class="at-bar__seg" :style="quotaSeg(n.messagesToday)"></div>
                    <div v-else class="at-bar__seg" style="width:100%;background:repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 4px,#f1f5f9 4px,#f1f5f9 8px)"></div>
                  </div>
                </div>
                <div v-if="!me?.quotaNicks.length" class="at-empty"><div class="at-empty__title">Chưa có nick</div></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Hàng KH: điểm số + trạng thái/tag + tương tác -->
        <div class="at-dash-grid-3" style="margin-top:12px">
          <!-- Điểm số -->
          <div class="at-card">
            <div class="at-card__head"><div class="at-card__title"><ChartColumn :size="14" :stroke-width="2" /> Điểm số khách hàng</div></div>
            <div class="at-scoredist">
              <div class="at-scoreline">
                <div class="at-scoreline__top"><span class="at-scoreline__nm" style="color:var(--lead-c)"><Target :size="13" :stroke-width="2" /> Lead (ý định)</span><span class="at-scoreline__vl">TB {{ me?.scores?.leadAvg ?? 0 }}</span></div>
                <div class="at-bar"><div class="at-bar__seg" :style="bandSeg(me?.scores?.leadMid, me?.scores?.leadHi, '#fde68a','#f59e0b')"></div></div>
              </div>
              <div class="at-scoreline">
                <div class="at-scoreline__top"><span class="at-scoreline__nm" style="color:var(--eng-c)"><MessageCircle :size="13" :stroke-width="2" /> Tương tác (28 ngày)</span><span class="at-scoreline__vl">TB {{ me?.scores?.engagementAvg ?? 0 }}</span></div>
                <div class="at-bar"><div class="at-bar__seg" :style="bandSeg(me?.scores?.engMid, me?.scores?.engHi, '#bfdbfe','#3b82f6')"></div></div>
              </div>
              <div class="at-scoreline">
                <div class="at-scoreline__top"><span class="at-scoreline__nm" style="color:var(--prio-c)"><Star :size="13" :stroke-width="2" /> Ưu tiên (tổng hợp)</span><span class="at-scoreline__vl">{{ me?.scores?.priorityHigh ?? 0 }} KH cao</span></div>
                <div class="at-bar"><div class="at-bar__seg" :style="`width:${priorityBarPct}%;background:#ef4444`"></div></div>
              </div>
              <div v-if="(me?.scores?.priorityHigh ?? 0) > 0" class="at-scorehint">
                {{ me?.scores?.priorityHigh }} KH ưu tiên cao đang chờ chốt — <span class="lnk" @click="goToContacts">xem danh sách</span>
              </div>
            </div>
          </div>

          <!-- Trạng thái + tag -->
          <div class="at-card">
            <div class="at-card__head"><div class="at-card__title"><Tag :size="14" :stroke-width="2" /> Trạng thái khách hàng</div></div>
            <div class="at-chipwrap">
              <span v-for="s in statusChips" :key="s.status" class="at-statchip" :class="s.cls">
                {{ s.label }} <span class="at-statchip__c">{{ s.count }}</span>
              </span>
              <span v-if="!statusChips.length" class="at-statchip">Chưa có dữ liệu</span>
            </div>
            <div class="at-card__head" style="border-top:1px solid var(--at-hairline)"><div class="at-card__title" style="font-size:12px"><Bookmark :size="13" :stroke-width="2" /> Tag phổ biến</div></div>
            <div class="at-chipwrap">
              <span v-for="t in me?.topTags ?? []" :key="t.tag" class="at-statchip">{{ t.tag }} <span class="at-statchip__c">{{ t.count }}</span></span>
              <span v-if="!me?.topTags?.length" class="at-statchip">Chưa gắn tag</span>
            </div>
          </div>

          <!-- Tương tác -->
          <div class="at-card">
            <div class="at-card__head"><div class="at-card__title"><TrendingUp :size="14" :stroke-width="2" /> Tương tác hôm nay</div></div>
            <div class="at-ministats">
              <div class="at-ministat"><div class="at-ministat__v">{{ me?.interactionToday?.sent ?? 0 }}</div><div class="at-ministat__l">Tin đã gửi</div></div>
              <div class="at-ministat at-ministat--good"><div class="at-ministat__v">{{ me?.interactionToday?.replied ?? 0 }}</div><div class="at-ministat__l">KH phản hồi</div></div>
              <div class="at-ministat"><div class="at-ministat__v">{{ me?.interactionToday?.replyRate ?? 0 }}%</div><div class="at-ministat__l">Tỷ lệ rep</div></div>
            </div>
            <div class="at-ministats">
              <div class="at-ministat"><div class="at-ministat__v">{{ me?.interactionToday?.newFriends ?? 0 }}</div><div class="at-ministat__l">Bạn mới</div></div>
              <div class="at-ministat"><div class="at-ministat__v">{{ me?.interactionToday?.newLeads ?? 0 }}</div><div class="at-ministat__l">Lead mới</div></div>
              <div class="at-ministat"><div class="at-ministat__v">{{ me?.kpi.closedThisMonth ?? 0 }}</div><div class="at-ministat__l">Chốt tháng</div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ════════════════ TAB 2 — QUẢN LÝ TEAM ════════════════ -->
      <div v-show="activeTab === 'team'" class="dh-tabpanel">
        <div class="at-banner-priv">
          <Lock :size="14" :stroke-width="2" />
          Privacy v2: số liệu hiển thị dạng công khai +<Lock :size="11" :stroke-width="2" />riêng tư. Trưởng phòng xem KPI/điểm số nhưng KHÔNG xem nội dung tin nhắn nick riêng tư.
        </div>

        <div class="at-kpi-grid">
          <div class="at-kpi-tile at-kpi--danger"><div class="at-kpi-label"><Inbox :size="13" :stroke-width="2" /> Tồn đọng team</div><div class="at-kpi-value"><PrivVal :split="team?.teamKpi.unreplied" /></div><div class="at-kpi-sub">cả PKD chưa rep</div></div>
          <div class="at-kpi-tile at-kpi--warn"><div class="at-kpi-label"><CalendarClock :size="13" :stroke-width="2" /> Hẹn team</div><div class="at-kpi-value"><PrivVal :split="team?.teamKpi.todayAppointments" /></div><div class="at-kpi-sub">hôm nay</div></div>
          <div class="at-kpi-tile at-kpi--info"><div class="at-kpi-label"><Eye :size="13" :stroke-width="2" /> Phiên theo dõi</div><div class="at-kpi-value">{{ team?.followSessions?.active ?? 0 }}</div><div class="at-kpi-sub">{{ team?.followSessions?.replied ?? 0 }} KH vừa rep</div></div>
          <div class="at-kpi-tile"><div class="at-kpi-label"><Target :size="13" :stroke-width="2" /> Tổng KH</div><div class="at-kpi-value">{{ team?.teamKpi.totalContacts ?? 0 }}</div><div class="at-kpi-sub">cả team</div></div>
          <div class="at-kpi-tile at-kpi--good"><div class="at-kpi-label"><CircleCheck :size="13" :stroke-width="2" /> Chốt tuần</div><div class="at-kpi-value">{{ team?.teamKpi.closedThisWeek ?? 0 }}</div><div class="at-kpi-sub">cả team</div></div>
          <div class="at-kpi-tile at-kpi--purple"><div class="at-kpi-label"><Star :size="13" :stroke-width="2" /> Top: {{ firstName(team?.topUser?.fullName) }}</div><div class="at-kpi-value">{{ team?.topUser?.closedThisWeek ?? 0 }}</div><div class="at-kpi-sub">chốt nhiều nhất</div></div>
        </div>

        <!-- Team table -->
        <div class="at-card" style="margin-bottom:12px">
          <div class="at-card__head"><div class="at-card__title"><Users :size="14" :stroke-width="2" /> Đội ngũ ({{ team?.perUser.length ?? 0 }} nhân viên)</div></div>
          <table class="at-table">
            <thead><tr><th>Nhân viên</th><th class="num">Chưa rep</th><th class="num">Hẹn</th><th class="num">KH</th><th class="num">Chốt tuần</th><th></th></tr></thead>
            <tbody>
              <tr v-for="u in team?.perUser ?? []" :key="u.userId">
                <td>
                  <div class="at-tname">
                    <Avatar :src="u.avatarUrl" :name="u.fullName" :size="26" :gradient-seed="u.userId" />
                    {{ firstName(u.fullName) }}
                    <span v-if="u.userId === team?.topUser?.userId" class="at-name-tag"><Star :size="9" :stroke-width="2.5" /> Top</span>
                    <span v-if="u.hasPrivateNick" class="at-name-lock"><Lock :size="10" :stroke-width="2" />{{ u.privateNickCount }}</span>
                  </div>
                </td>
                <td class="num"><PrivVal :split="u.unreplied" /></td>
                <td class="num"><PrivVal :split="u.todayAppointments" /></td>
                <td class="num">{{ u.totalContacts }}</td>
                <td class="num" :style="u.closedThisWeek > 0 ? 'color:var(--at-atlas-success)' : ''">{{ u.closedThisWeek }}</td>
                <td><span class="at-miniact" @click="selectUser(u.userId); activeTab = 'me'">Xem <ChevronDown :size="12" :stroke-width="2" style="transform:rotate(-90deg)" /></span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="at-dash-grid-3">
          <!-- Lead pool -->
          <div class="at-card">
            <div class="at-card__head"><div class="at-card__title"><Gift :size="14" :stroke-width="2" /> Nhận khách (Lead Pool)</div></div>
            <div class="at-ministats">
              <div class="at-ministat at-ministat--warn"><div class="at-ministat__v">{{ team?.leadPool?.pending ?? 0 }}</div><div class="at-ministat__l">Lead đang chờ</div></div>
              <div class="at-ministat at-ministat--good"><div class="at-ministat__v">{{ team?.leadPool?.claimedToday ?? 0 }}</div><div class="at-ministat__l">Nhận hôm nay</div></div>
              <div class="at-ministat at-ministat--danger"><div class="at-ministat__v">{{ team?.leadPool?.forgotten ?? 0 }}</div><div class="at-ministat__l">KH bỏ quên</div></div>
            </div>
          </div>

          <!-- Hiệu suất phản hồi -->
          <div class="at-card">
            <div class="at-card__head"><div class="at-card__title"><TrendingUp :size="14" :stroke-width="2" /> Hiệu suất phản hồi</div></div>
            <div class="at-scoredist">
              <div class="at-scoreline">
                <div class="at-scoreline__top"><span class="at-scoreline__nm">Tỷ lệ rep team hôm nay</span><span class="at-scoreline__vl">{{ team?.responsePerf?.replyRate ?? 0 }}%</span></div>
                <div class="at-bar"><div class="at-bar__seg" :style="`width:${team?.responsePerf?.replyRate ?? 0}%;background:var(--at-atlas-success)`"></div></div>
              </div>
              <div class="at-scoreline">
                <div class="at-scoreline__top"><span class="at-scoreline__nm">KH phản hồi / Tin gửi</span><span class="at-scoreline__vl">{{ team?.responsePerf?.replied ?? 0 }} / {{ team?.responsePerf?.sent ?? 0 }}</span></div>
                <div class="at-bar"><div class="at-bar__seg" :style="`width:${team?.responsePerf?.replyRate ?? 0}%;background:var(--at-action)`"></div></div>
              </div>
            </div>
          </div>

          <!-- Marketing đang chạy (reuse: link sang module) -->
          <div class="at-card">
            <div class="at-card__head"><div class="at-card__title"><Megaphone :size="14" :stroke-width="2" /> Marketing</div><span class="at-card__link" @click="goToMarketing">Xem</span></div>
            <div class="at-card__body">
              <div class="at-list-row" @click="goToMarketing">
                <span class="at-list-row__av at-list-row__av--p"><Target :size="15" :stroke-width="2" /></span>
                <div><div class="at-list-row__nm">Mục tiêu &amp; Luồng kịch bản</div><div class="at-list-row__mt">Quản lý chiến dịch đang chạy</div></div>
                <span class="at-list-row__rt"><ChevronDown :size="13" :stroke-width="2" style="transform:rotate(-90deg)" /></span>
              </div>
              <div class="at-list-row" @click="goToMarketing">
                <span class="at-list-row__av at-list-row__av--b"><Send :size="15" :stroke-width="2" /></span>
                <div><div class="at-list-row__nm">Broadcast</div><div class="at-list-row__mt">Gửi hàng loạt theo tệp KH</div></div>
                <span class="at-list-row__rt"><ChevronDown :size="13" :stroke-width="2" style="transform:rotate(-90deg)" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ════════════════ TAB 3 — QUẢN LÝ HỆ THỐNG ════════════════ -->
      <div v-show="activeTab === 'system'" class="dh-tabpanel">
        <div v-if="system?.recentAudit?.length" class="at-banner-audit">
          <ClipboardList :size="14" :stroke-width="2" />
          Audit gần nhất: <b>{{ system.recentAudit[0].actorName }}</b> — {{ system.recentAudit[0].action }} · {{ ago(system.recentAudit[0].createdAt) }}
          <span class="at-banner-audit__link">Xem nhật ký</span>
        </div>

        <div class="at-kpi-grid">
          <div class="at-kpi-tile at-kpi--good"><div class="at-kpi-label"><Sparkles :size="13" :stroke-width="2" /> Lead mới tháng</div><div class="at-kpi-value">{{ system?.orgKpi.newLeadsThisMonth ?? 0 }}</div><div class="at-kpi-sub">toàn tổ chức</div></div>
          <div class="at-kpi-tile"><div class="at-kpi-label"><ClipboardList :size="13" :stroke-width="2" /> Tổng KH</div><div class="at-kpi-value">{{ (system?.orgKpi.totalContacts ?? 0).toLocaleString('vi-VN') }}</div><div class="at-kpi-sub">toàn tổ chức</div></div>
          <div class="at-kpi-tile at-kpi--good"><div class="at-kpi-label"><Circle :size="13" :stroke-width="2" fill="currentColor" /> Nick khoẻ</div><div class="at-kpi-value">{{ system?.orgKpi.nickHealth.healthy ?? 0 }}</div><div class="at-kpi-sub">/ {{ system?.orgKpi.totalNicks ?? 0 }} nick</div></div>
          <div class="at-kpi-tile at-kpi--danger"><div class="at-kpi-label"><Circle :size="13" :stroke-width="2" fill="currentColor" /> Nick lỗi</div><div class="at-kpi-value">{{ (system?.orgKpi.nickHealth.banned ?? 0) + (system?.orgKpi.nickHealth.offline ?? 0) }}</div><div class="at-kpi-sub">cần đăng nhập lại</div></div>
          <div class="at-kpi-tile at-kpi--warn"><div class="at-kpi-label"><Lock :size="13" :stroke-width="2" /> Nick riêng tư</div><div class="at-kpi-value">{{ system?.orgKpi.nickHealth.private ?? 0 }}</div><div class="at-kpi-sub">admin xem sức khoẻ</div></div>
          <div class="at-kpi-tile at-kpi--purple"><div class="at-kpi-label"><Eye :size="13" :stroke-width="2" /> Phiên theo dõi</div><div class="at-kpi-value">{{ system?.orgKpi.followSessions ?? 0 }}</div><div class="at-kpi-sub">toàn hệ thống</div></div>
        </div>

        <div class="at-dash-grid-2">
          <!-- Dept ranking -->
          <div class="at-card">
            <div class="at-card__head"><div class="at-card__title"><Trophy :size="14" :stroke-width="2" /> Hiệu suất PKD (tháng này)</div></div>
            <table class="at-table">
              <thead><tr><th>Phòng KD</th><th class="num">NV</th><th class="num">Lead mới</th><th class="num">Chốt</th></tr></thead>
              <tbody>
                <tr v-for="d in system?.deptRanking ?? []" :key="d.departmentId">
                  <td><div class="at-tname"><span class="at-tname__av" :style="avBg(d.departmentId)">{{ initials(d.departmentName) }}</span> {{ d.departmentName }}</div></td>
                  <td class="num">{{ d.memberCount }}</td>
                  <td class="num">{{ d.newLeadsThisMonth }}</td>
                  <td class="num" style="color:var(--at-atlas-success)">{{ d.closedThisMonth }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Sức khoẻ + phễu -->
          <div class="at-dash-col">
            <div class="at-card">
              <div class="at-card__head"><div class="at-card__title"><Activity :size="14" :stroke-width="2" /> Sức khoẻ nick ({{ system?.orgKpi.totalNicks ?? 0 }} nick)</div></div>
              <div class="at-ministats">
                <div class="at-ministat at-ministat--good"><div class="at-ministat__v">{{ system?.orgKpi.nickHealth.healthy ?? 0 }}</div><div class="at-ministat__l">Khoẻ</div></div>
                <div class="at-ministat at-ministat--warn"><div class="at-ministat__v">{{ system?.orgKpi.nickHealth.offline ?? 0 }}</div><div class="at-ministat__l">Nghỉ</div></div>
                <div class="at-ministat at-ministat--danger"><div class="at-ministat__v">{{ system?.orgKpi.nickHealth.banned ?? 0 }}</div><div class="at-ministat__l">Lỗi</div></div>
                <div class="at-ministat"><div class="at-ministat__v">{{ system?.orgKpi.nickHealth.private ?? 0 }}</div><div class="at-ministat__l">Riêng tư</div></div>
              </div>
            </div>
            <div class="at-card">
              <div class="at-card__head"><div class="at-card__title"><ChartColumn :size="14" :stroke-width="2" /> Phễu khách hàng toàn tổ chức</div></div>
              <div class="at-scoredist">
                <div v-for="f in funnelBars" :key="f.status" class="at-scoreline">
                  <div class="at-scoreline__top"><span class="at-scoreline__nm">{{ f.label }}</span><span class="at-scoreline__vl">{{ f.count.toLocaleString('vi-VN') }}</span></div>
                  <div class="at-bar"><div class="at-bar__seg" :style="`width:${f.pct}%;background:${f.color}`"></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h, type Component } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { useDashboardActionHub, type PrivacySplit } from '@/composables/use-dashboard-action-hub';
import { useAttribution } from '@/composables/use-attribution';
import Avatar from '@/components/ui/Avatar.vue';
import {
  Sun, Target, Users, Shield, User, ChevronDown, Lock, Search,
  Inbox, CalendarClock, Eye, Moon, CircleCheck, Flame, Bell,
  TriangleAlert, Cake, Gift, Zap, ChartColumn, MessageCircle, Star,
  Tag, Bookmark, TrendingUp, Megaphone, Send, ClipboardList,
  Sparkles, Circle, Activity, Trophy,
} from 'lucide-vue-next';
import '@/assets/atlas-v2-dashboard.css';

const attribution = useAttribution();
const auth = useAuthStore();
const router = useRouter();
const hub = useDashboardActionHub();

const me = computed(() => hub.me.value);
const team = computed(() => hub.team.value);
const system = computed(() => hub.system.value);

// Tab state — mặc định 'me'. Sale chỉ có me (thanh tab ẩn).
const activeTab = ref<'me' | 'team' | 'system'>('me');

// Picker state
const userPickerOpen = ref(false);
const userPickerSearch = ref('');
const tempSelectedDepts = ref<string[]>([]);

const canPickUser = computed(() => hub.hasTeamSection.value || hub.hasSystemSection.value);
const viewedName = computed(() => {
  if (!hub.viewAsUserId.value) return auth.user?.fullName ?? '';
  return hub.pickerUsers.value.find((u) => u.id === hub.viewAsUserId.value)?.fullName ?? '';
});
const currentViewedUserName = computed(() =>
  hub.viewAsUserId.value ? viewedName.value : `Tôi (${auth.user?.fullName ?? ''})`,
);
const filteredPickerUsers = computed(() => {
  const q = userPickerSearch.value.trim().toLowerCase();
  return hub.pickerUsers.value.filter((u) => !u.isSelf).filter((u) => !q || u.fullName.toLowerCase().includes(q));
});

// ── KPI totals ──
const totalUnreplied = computed(() => me.value ? me.value.kpi.unreplied.public + me.value.kpi.unreplied.private : 0);
const totalAppts = computed(() => me.value ? me.value.kpi.todayAppointments.public + me.value.kpi.todayAppointments.private : 0);
const teamBacklog = computed(() => team.value ? team.value.teamKpi.unreplied.public + team.value.teamKpi.unreplied.private : 0);
const reminderCount = computed(() => {
  const r = me.value?.reminders;
  if (!r) return 0;
  return r.overdue.length + r.today.length + r.tomorrow.length + r.birthdays.length;
});
const priorityBarPct = computed(() => {
  const hi = me.value?.scores?.priorityHigh ?? 0;
  const total = me.value?.kpi.totalContacts ?? 0;
  return total > 0 ? Math.min(100, Math.round((hi / total) * 100)) : 0;
});

const greetingHour = computed(() => {
  const h = new Date().getHours();
  if (h < 11) return 'buổi sáng';
  if (h < 14) return 'buổi trưa';
  if (h < 18) return 'buổi chiều';
  return 'buổi tối';
});

// ── Status chips (map status thật → label + màu) ──
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: 'Mới', cls: 'at-statchip--blue' },
  contacted: { label: 'Đã liên hệ', cls: 'at-statchip--blue' },
  nurturing: { label: 'Đang chăm', cls: 'at-statchip--yellow' },
  caring: { label: 'Đang chăm', cls: 'at-statchip--yellow' },
  negotiating: { label: 'Đang tư vấn', cls: 'at-statchip--yellow' },
  interested: { label: 'Quan tâm', cls: 'at-statchip--green' },
  closed_won: { label: 'Chốt', cls: 'at-statchip--green' },
  closed: { label: 'Chốt', cls: 'at-statchip--green' },
  chot: { label: 'Chốt', cls: 'at-statchip--green' },
  cold: { label: 'Nguội', cls: 'at-statchip--red' },
  lost: { label: 'Mất', cls: 'at-statchip--red' },
  archived: { label: 'Lưu trữ', cls: '' },
};
// Helper map 1 status → {label, cls} cho thẻ Cần rep gấp (null nếu không có/không map).
function urgentStatus(status?: string): { label: string; cls: string } | null {
  if (!status) return null;
  return STATUS_MAP[status] ?? { label: status, cls: '' };
}
const statusChips = computed(() => {
  const sb = me.value?.statusBreakdown ?? [];
  return sb
    .filter((s) => s.count > 0)
    .map((s) => ({ status: s.status, count: s.count, ...(STATUS_MAP[s.status] ?? { label: s.status, cls: '' }) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
});

// ── Funnel bars (system) ──
const FUNNEL_ORDER = ['new', 'contacted', 'negotiating', 'nurturing', 'caring', 'interested', 'closed_won', 'closed', 'chot', 'cold'];
const FUNNEL_COLOR: Record<string, string> = { new: '#bfdbfe', contacted: '#93c5fd', negotiating: '#60a5fa', nurturing: '#fbbf24', caring: '#fbbf24', interested: '#34d399', closed_won: 'var(--at-atlas-success)', closed: 'var(--at-atlas-success)', chot: 'var(--at-atlas-success)', cold: '#94a3b8' };
const funnelBars = computed(() => {
  const f = (system.value?.funnel ?? []).filter((x) => x.status && x.count > 0);
  const max = Math.max(1, ...f.map((x) => x.count));
  return f
    .sort((a, b) => FUNNEL_ORDER.indexOf(a.status ?? '') - FUNNEL_ORDER.indexOf(b.status ?? ''))
    .slice(0, 6)
    .map((x) => ({ status: x.status ?? 'khac', label: STATUS_MAP[x.status ?? '']?.label ?? x.status ?? 'Khác', count: x.count, pct: Math.round((x.count / max) * 100), color: FUNNEL_COLOR[x.status ?? ''] ?? '#cbd5e1' }));
});

// ── Picker actions ──
async function selectUser(userId: string | null) {
  userPickerOpen.value = false;
  await hub.fetchMe(userId);
}

// ── Navigation ──
function goToInbox() { router.push('/chat'); }
function goToAppts() { router.push('/appointments'); }
function goToContacts() { router.push('/contacts'); }
function goToConv(id: string) { router.push(`/chat?conv=${id}`); }
function goToLeadPool() { router.push('/lead-pool'); }
function goToCareSessions() { router.push('/automation/care-sessions'); }
function goToMarketing() { router.push('/marketing'); }

// ── Format helpers ──
function firstName(full?: string | null): string {
  if (!full) return 'bạn';
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1];
}
function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'vừa xong';
  if (ms < 3600000) return Math.floor(ms / 60000) + ' phút trước';
  if (ms < 86400000) return Math.floor(ms / 3600000) + ' giờ trước';
  return Math.floor(ms / 86400000) + ' ngày trước';
}
function apptHM(iso: string, time: string | null): string {
  if (time) return time;
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}
function quotaSeg(msgs: number | null): string {
  const v = msgs ?? 0;
  const pct = Math.min(100, Math.round((v / 300) * 100));
  const color = v > 270 ? 'var(--at-atlas-danger)' : v > 210 ? 'var(--at-atlas-warning)' : 'var(--at-atlas-success)';
  return `width:${pct}%;background:${color}`;
}
function bandSeg(mid: number | undefined, hi: number | undefined, midColor: string, hiColor: string): string {
  // bar 2-segment: mid (40-69) + hi (70+). Tổng width tỷ lệ theo (mid+hi) so 100% giả định ~ nhiều.
  const m = mid ?? 0; const h = hi ?? 0; const tot = Math.max(1, m + h);
  const midPct = Math.round((m / tot) * 100);
  return `width:100%;background:linear-gradient(90deg, ${midColor} ${midPct}%, ${hiColor} ${midPct}%)`;
}
const AV_BG = ['linear-gradient(135deg,#60a5fa,#2962ff)', 'linear-gradient(135deg,#34d399,#16a34a)', 'linear-gradient(135deg,#f59e0b,#d97706)', 'linear-gradient(135deg,#a78bfa,#7c3aed)', 'linear-gradient(135deg,#f87171,#dc2626)'];
function avBg(seed: string): string {
  let s = 0; for (let i = 0; i < seed.length; i++) s += seed.charCodeAt(i);
  return `background:${AV_BG[s % AV_BG.length]}`;
}

// ── Privacy value inline component (thay emoji +🔒 bằng Lucide Lock) ──
const PrivVal: Component = {
  props: { split: { type: Object as () => PrivacySplit | undefined, default: undefined } },
  setup(props) {
    return () => {
      const s = props.split;
      if (!s) return h('span', '0');
      const children: ReturnType<typeof h>[] = [h('span', String(s.public))];
      if (s.private > 0) {
        children.push(h('span', { class: 'at-kpi-priv' }, [h(Lock, { size: 11, strokeWidth: 2.2 }), String(s.private)]));
      }
      return h('span', { style: 'display:inline-flex;align-items:center' }, children);
    };
  },
};

// ── Mount ──
onMounted(async () => {
  await hub.fetchAll();
  tempSelectedDepts.value = [...hub.selectedDeptIds.value];
  document.addEventListener('click', onOutsideClick);
});
onUnmounted(() => {
  document.removeEventListener('click', onOutsideClick);
});
function onOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.dh-scope')) {
    userPickerOpen.value = false;
  }
}
</script>

<style scoped>
.dh-v4 {
  max-width: 1366px;
  margin: 0 auto;
  /* App khoá cuộn cấp trang (main.css overflow:hidden) → dashboard PHẢI tự cuộn,
     không thì nội dung tràn không kéo xuống được (anh báo 2026-06-17). */
  height: calc(100vh - var(--smax-topnav-h, 48px));
  overflow-y: auto;
  padding-bottom: 32px;
  /* Score line màu theo 3 hệ điểm */
  --lead-c: #d97706;
  --eng-c: #2563eb;
  --prio-c: #dc2626;
}
.dh-attr {
  font-size: 10px; color: var(--at-hint, #97a0b3);
  padding: 2px 14px; text-align: center; opacity: 0.7;
}
.dh-tabpanel { animation: dh-fade 0.15s ease-out; }
@keyframes dh-fade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

/* Picker dropdown (giữ từ bản cũ, Atlas-ish) */
.dh-pdd {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 30;
  width: 260px; max-height: 360px; overflow-y: auto;
  background: #fff; border: 1px solid var(--at-hairline, #e2e8f0);
  border-radius: 9px; box-shadow: 0 8px 28px rgba(15,23,42,0.16); padding: 6px;
}
.dh-pdd-search { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-bottom: 1px solid var(--at-hairline, #eef2f6); margin-bottom: 4px; color: var(--at-hint, #97a0b3); }
.dh-pdd-search input { border: 0; outline: 0; flex: 1; font-size: 12.5px; font-family: inherit; }
.dh-pdd-group { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--at-hint, #94a3b8); padding: 6px 8px 2px; letter-spacing: 0.3px; }
.dh-pdd-item { padding: 6px 8px; font-size: 12.5px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
.dh-pdd-item:hover { background: var(--at-surface-soft, #f8fafc); }
.dh-pdd-item.active { background: var(--at-action-soft, #e4f1f8); color: var(--at-action, #1786be); font-weight: 600; }
.dh-pdd-dept { font-size: 10.5px; color: var(--at-hint, #94a3b8); }

/* ── Thẻ "Cần rep gấp" nâng cấp: avatar thật + preview tin + trạng thái KH ── */
.at-urgent-row {
  display: grid; grid-template-columns: 38px 1fr auto; gap: 10px;
  align-items: center; padding: 8px 12px; cursor: pointer;
  border-bottom: 1px solid var(--at-hairline, #eef2f6);
}
.at-urgent-row:last-child { border-bottom: 0; }
.at-urgent-row:hover { background: var(--at-surface-soft, #f8fafc); }
.at-urgent-av { flex-shrink: 0; }
.at-urgent-body { min-width: 0; }
.at-urgent-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.at-urgent-nm { font-size: 12.5px; font-weight: 600; color: var(--at-ink, #141a24); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-flex; align-items: center; gap: 3px; }
.at-urgent-time { font-size: 10.5px; color: var(--at-hint, #94a3b8); flex-shrink: 0; }
.at-urgent-preview {
  font-size: 11.5px; color: var(--at-body, #475066); margin-top: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.at-urgent-preview.is-blur { filter: blur(3.5px); user-select: none; letter-spacing: 1px; }
.at-urgent-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.at-urgent-nick { font-size: 10.5px; color: var(--at-hint, #94a3b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.at-statchip--sm { font-size: 10px; padding: 1px 7px; }
</style>
