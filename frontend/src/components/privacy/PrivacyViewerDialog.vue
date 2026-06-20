<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  PrivacyViewerDialog — Non-owner (admin/user khác) read-only popup.
  Anh chốt 2026-05-22: theme trắng + xanh sậm, blockchain style.
  KHÔNG có ô nhập, KHÔNG cách bẻ khoá. Chỉ 1 nút "Đã hiểu — Đóng".

  Props:
    modelValue: boolean
    nick: { displayName, avatarUrl, zaloUid }
-->
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="360"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="pv-popup">
      <div class="pv-hash-flow">
        <div class="pv-hash-line">0xc4d8e2b6f9a3c7e1d5b8f2a6c4d9e7b3f1a5c8e2d6b4f9a7c3e1d5b8f2a6c4d9</div>
        <div class="pv-hash-line">0xd1a5e9c3b7f4d2a8e6c1b5f9d3a7e4c2b8f6d1a9e5c3b7f2d4a8e6c1b5f9d3a7</div>
      </div>

      <div class="pv-nick-info">
        <div class="pv-avatar-wrap">
          <div class="pv-avatar" :style="{ background: avatarColor(nick?.displayName) }">
            <img v-if="nick?.avatarUrl" :src="nick.avatarUrl" />
            <template v-else>{{ initials(nick?.displayName) }}</template>
          </div>
        </div>
        <div class="pv-nick-name">{{ nick?.displayName || 'Nick Zalo' }}</div>
        <div v-if="nick?.zaloUid" class="pv-nick-uid">UID {{ nick.zaloUid }}</div>
      </div>

      <div class="pv-lock-emblem">
        <div class="pv-lock-hex"><div class="pv-lock-icon">🔒</div></div>
      </div>

      <div class="pv-title">Tin riêng tư · Chỉ chính chủ xem được</div>
      <div class="pv-subtitle">Tin nhắn được mã hoá đầu cuối. Bạn không có quyền giải mã.</div>

      <div class="pv-encryption-proof">
        <div class="pv-enc-label">
          <span>SECURE HASH</span>
          <span class="pv-alg">SHA-256</span>
        </div>
        <div class="pv-enc-hash">
          7f4a3c<span class="pv-blink">█</span>9e2b6d8f1a5c4e9b2d7f3a6c8e1b4d9f2a7c5e8b3d6f1a4
        </div>
      </div>

      <div class="pv-status-row">
        <span class="pv-secure-chip"><span class="pv-dot"></span> ENCRYPTED</span>
        <span class="pv-secure-chip"><span class="pv-dot"></span> ON-CHAIN</span>
        <span class="pv-secure-chip"><span class="pv-dot"></span> ZERO-KNOWLEDGE</span>
      </div>

      <button class="pv-close-btn" type="button" @click="$emit('update:modelValue', false)">
        Đã hiểu — Đóng
      </button>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
interface NickInfo {
  displayName?: string | null;
  avatarUrl?: string | null;
  zaloUid?: string | null;
}
defineProps<{
  modelValue: boolean;
  nick?: NickInfo | null;
}>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name?: string | null): string {
  const colors = ['linear-gradient(135deg,#f59e0b,#ef4444)', 'linear-gradient(135deg,#3b82f6,#1e40af)', 'linear-gradient(135deg,#10b981,#059669)', 'linear-gradient(135deg,#8b5cf6,#6d28d9)'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style scoped>
.pv-popup {
  background: #fff;
  border-radius: 14px;
  padding: 22px 18px 16px;
  position: relative;
  overflow: hidden;
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
  min-height: 480px;
}
.pv-popup::before {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 30% 15%, rgba(30, 64, 175, 0.04), transparent 50%),
    radial-gradient(circle at 70% 85%, rgba(59, 130, 246, 0.03), transparent 50%);
  pointer-events: none;
}
.pv-hash-flow { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.pv-hash-line {
  position: absolute;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: rgba(30, 64, 175, 0.08);
  white-space: nowrap;
  animation: pv-scroll 25s linear infinite;
}
.pv-hash-line:nth-child(1) { top: 6%; animation-delay: 0s; }
.pv-hash-line:nth-child(2) { top: 92%; animation-delay: -12s; }
@keyframes pv-scroll {
  from { transform: translateX(100%); }
  to { transform: translateX(-100%); }
}

.pv-nick-info {
  display: flex; flex-direction: column; align-items: center;
  gap: 4px; margin-bottom: 14px;
  position: relative; z-index: 2;
}
.pv-avatar-wrap { position: relative; width: 48px; height: 48px; }
.pv-avatar-wrap::before, .pv-avatar-wrap::after {
  content: ''; position: absolute; inset: -5px;
  border-radius: 50%; border: 1.5px solid rgba(30, 64, 175, 0.25);
  animation: pv-ring 2.5s ease-in-out infinite;
}
.pv-avatar-wrap::after { inset: -10px; animation-delay: 1.2s; }
@keyframes pv-ring {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 0; transform: scale(1.2); }
}
.pv-avatar {
  width: 100%; height: 100%; border-radius: 50%;
  color: white; display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700;
  border: 2.5px solid #1e40af;
  position: relative; z-index: 2; overflow: hidden;
}
.pv-avatar img { width: 100%; height: 100%; object-fit: cover; }
.pv-nick-name {
  font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px;
}
.pv-nick-uid {
  font-size: 9px; color: #94a3b8;
  font-family: 'JetBrains Mono', monospace; letter-spacing: 0.3px;
}

.pv-lock-emblem {
  width: 72px; height: 72px; margin: 0 auto 12px;
  position: relative; z-index: 2;
}
.pv-lock-hex {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, #1e40af, #0f172a);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  display: flex; align-items: center; justify-content: center;
  position: relative;
  box-shadow: 0 8px 24px rgba(30, 64, 175, 0.25);
}
.pv-lock-hex::before {
  content: ''; position: absolute; inset: 3px;
  background: linear-gradient(135deg, #fff, #eff6ff);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
.pv-lock-icon {
  font-size: 24px; position: relative; z-index: 2;
  filter: drop-shadow(0 2px 5px rgba(30, 64, 175, 0.3));
}
.pv-lock-emblem::before {
  content: ''; position: absolute; inset: -5px; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent, #3b82f6, transparent, #1e40af, transparent);
  animation: pv-glow 5s linear infinite;
  filter: blur(8px); opacity: 0.35; z-index: 1;
}
@keyframes pv-glow { to { transform: rotate(360deg); } }

.pv-title {
  text-align: center; font-size: 14px; font-weight: 600;
  color: #0f172a; margin-bottom: 4px;
  position: relative; z-index: 2;
}
.pv-subtitle {
  text-align: center; font-size: 11px; color: #475569;
  margin-bottom: 14px; line-height: 1.5; max-width: 260px;
  margin-left: auto; margin-right: auto;
  position: relative; z-index: 2;
}

.pv-encryption-proof {
  background: #eff6ff; border: 1px solid #dbeafe;
  border-radius: 8px; padding: 9px 12px;
  margin-bottom: 12px; max-width: 260px;
  margin-left: auto; margin-right: auto;
  position: relative; z-index: 2;
}
.pv-enc-label {
  font-size: 9px; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.5px;
  margin-bottom: 5px; display: flex;
  align-items: center; justify-content: space-between;
  font-weight: 600;
}
.pv-enc-label .pv-alg {
  background: #1e40af; color: white; padding: 2px 6px;
  border-radius: 3px; font-weight: 700; letter-spacing: 0.5px;
}
.pv-enc-hash {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px; color: #1e40af;
  word-break: break-all; line-height: 1.5;
}
.pv-enc-hash .pv-blink { animation: pv-blink 1s infinite; color: #3b82f6; }
@keyframes pv-blink { 50% { opacity: 0.3; } }

.pv-status-row {
  display: flex; justify-content: center; gap: 10px;
  margin-bottom: 8px;
  position: relative; z-index: 2; flex-wrap: wrap;
}
.pv-secure-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 9px; color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
}
.pv-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #059669; box-shadow: 0 0 4px #059669;
  animation: pv-pulse 1.5s ease-in-out infinite;
}
@keyframes pv-pulse { 50% { opacity: 0.4; } }

.pv-close-btn {
  display: block; width: 100%; max-width: 240px;
  margin: 12px auto 0; padding: 10px;
  background: linear-gradient(135deg, #1e40af, #0f172a);
  border: 0; color: white; border-radius: 10px;
  font-size: 12px; font-weight: 600;
  cursor: pointer; letter-spacing: 0.3px;
  transition: all 0.15s; position: relative; z-index: 2;
  font-family: inherit;
}
.pv-close-btn:hover {
  background: linear-gradient(135deg, #0f172a, #0a1020);
  box-shadow: 0 6px 20px rgba(30, 64, 175, 0.35);
  transform: translateY(-1px);
}
</style>
