<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!--
    ContactProfileView — Tab/page "Hồ sơ KH tổng hợp" (SKELETON).

    STATUS: Phase Y future feature. Component này CHỈ render skeleton UI để
    placeholder route /contacts/:id/profile. Khi backend
    GET /api/v1/contacts/:id/profile sẵn sàng + composable
    use-contact-profile.ts unmock, view này sẽ hiển thị đầy đủ:

      - Header: avatar + tên + score aggregate + primary owner
      - Tab "Thông tin chung": email, địa chỉ, nghề nghiệp (3 field
        đã ẩn khỏi ChatContactPanel cột 4), birthday, gender, demographics
      - Tab "Nick Zalo (N)": list tất cả Friend rows với per-pair score + status
      - Tab "Tags tổng hợp": UNION từ Contact.tags + Friend.crmTagsPerNick
      - Tab "Timeline": aggregated activities từ tất cả Friend
      - Tab "Note": Contact-level notes (vs Friend-level)

    Liên hệ Phase 6: aggregateScore = MAX(Friend.scores) theo architecture
    chốt 2026-05-16 (chát + reference TODO Phase 6+ score).
  -->
  <div class="cp-view">
    <header class="cp-header">
      <button class="back-btn" @click="$router.back()">← Quay lại</button>
      <h1>🧑 Hồ sơ KH tổng hợp <span class="badge-skeleton">SKELETON</span></h1>
      <div class="cp-actions">
        <span class="cp-id" :title="contactId">ID: {{ contactId.slice(0, 8) }}…</span>
      </div>
    </header>

    <div v-if="loading" class="cp-loading">⏳ Đang tải hồ sơ tổng hợp…</div>

    <div v-else-if="error" class="cp-error">⚠️ {{ error }}</div>

    <div v-else-if="profile" class="cp-content">
      <section class="cp-card">
        <div class="cp-info-grid">
          <div class="cp-info-row">
            <span class="cp-label">Tên hiển thị:</span>
            <span class="cp-value">{{ profile.contact.displayName || profile.contact.fullName || '—' }}</span>
          </div>
          <div class="cp-info-row">
            <span class="cp-label">Điểm tổng hợp (MAX Friend):</span>
            <span class="cp-value score">{{ profile.aggregateScore }}</span>
          </div>
          <div class="cp-info-row">
            <span class="cp-label">Phụ trách chính:</span>
            <span class="cp-value">{{ profile.primaryOwner?.userName || '— chưa có —' }}</span>
          </div>
        </div>
      </section>

      <section class="cp-card cp-skeleton-note">
        <h2>📌 Đây là skeleton</h2>
        <p>Component chưa implement đầy đủ. Khi backend <code>GET /api/v1/contacts/:id/profile</code> sẵn sàng, view này sẽ hiển thị:</p>
        <ul class="cp-todo-list">
          <li>📧 Email · Địa chỉ · Nghề nghiệp <em>(3 field đã ẩn khỏi ChatContactPanel cột 4)</em></li>
          <li>📞 Phone chính + phone2 + phone3</li>
          <li>📅 Birthday, gender, province/district/ward</li>
          <li>🏷️ Tags aggregated (UNION Contact.tags + Friend.crmTagsPerNick)</li>
          <li>📱 List tất cả {{ profile.friends.length }} nick Zalo per-pair (với per-pair score)</li>
          <li>📊 Timeline aggregated activities</li>
          <li>💯 Score breakdown (Phase 6 4-dimension)</li>
        </ul>
        <p class="cp-hint">
          <strong>Trigger build full:</strong> ra lệnh <code>"Implement ContactProfileView full"</code> + backend route stub
          tại <code>backend/src/modules/contacts/contact-routes.ts</code>.
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useContactProfile } from '@/composables/use-contact-profile';

const route = useRoute();
const contactId = computed(() => String(route.params.id || ''));
const { profile, loading, error, fetchContactProfile } = useContactProfile();

onMounted(() => {
  if (contactId.value) fetchContactProfile(contactId.value);
});
</script>

<style scoped>
.cp-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, "Segoe UI", "Inter", system-ui, sans-serif;
}

.cp-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.cp-header h1 {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
  flex: 1;
  color: #111827;
}
.badge-skeleton {
  display: inline-block;
  background: linear-gradient(135deg, #FEF3C7, #FDE68A);
  color: #92400E;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 8px;
  margin-left: 8px;
  vertical-align: middle;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.back-btn {
  background: white;
  border: 1px solid #E5E7EB;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #4B5563;
  font-family: inherit;
}
.back-btn:hover {
  border-color: #6366F1;
  color: #4338CA;
}

.cp-id {
  font-size: 11px;
  color: #9CA3AF;
  font-family: ui-monospace, monospace;
}

.cp-loading,
.cp-error {
  background: white;
  border-radius: 12px;
  padding: 48px;
  text-align: center;
  color: #6B7280;
}
.cp-error {
  color: #DC2626;
}

.cp-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cp-card {
  background: white;
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.cp-card h2 {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 12px;
  color: #111827;
}

.cp-info-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-info-row {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 12px;
  align-items: center;
  font-size: 13px;
}
.cp-label {
  font-weight: 600;
  color: #6B7280;
}
.cp-value {
  color: #111827;
}
.cp-value.score {
  display: inline-block;
  font-size: 16px;
  font-weight: 700;
  color: #10B981;
  background: #ECFDF5;
  padding: 2px 12px;
  border-radius: 8px;
  width: fit-content;
}

.cp-skeleton-note {
  background: linear-gradient(135deg, #FEF3C7, #FFFBEB);
  border-left: 4px solid #F59E0B;
}
.cp-skeleton-note p {
  font-size: 13px;
  color: #78350F;
  margin: 8px 0;
  line-height: 1.55;
}
.cp-todo-list {
  list-style: none;
  padding: 0;
  margin: 8px 0;
}
.cp-todo-list li {
  padding: 4px 0;
  font-size: 13px;
  color: #78350F;
}
.cp-todo-list li em {
  color: #9A3412;
  font-size: 12px;
}
.cp-hint {
  background: rgba(255, 255, 255, 0.5);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: #78350F;
  margin-top: 12px;
}
.cp-hint code,
.cp-skeleton-note code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #92400E;
}
</style>
