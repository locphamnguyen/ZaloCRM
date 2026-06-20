// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-relative-time.ts — ticker dùng CHUNG cho toàn app (1 setInterval duy nhất).
 *
 * 2026-06-11 (perf): trước đây ConversationList có ref `now` cập nhật mỗi 30s rồi
 * truyền vào formatTime của TỪNG hàng → đổi `now` làm Vue re-render CẢ 100 hàng
 * (avatar/tag/badge tính lại) → giật theo chu kỳ. Tách thành ticker chung + component
 * ConvTime con: chỉ phần thời gian re-render mỗi 30s, không đụng cả hàng.
 *
 * 1 interval duy nhất cho mọi component (singleton) — không tạo 100 interval.
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { getOrgParts } from './use-org-timezone';

/**
 * formatConvTime — định dạng thời gian tương đối cho danh sách hội thoại (cột 2).
 * Tách từ ConversationList.formatTime để dùng chung với component ConvTime.
 *   < 1 phút → "Now" · < 60p → "Xp" · < 24h → "HH:mm" · 1 ngày → "Hôm qua" ·
 *   < 7 ngày → "Xd" · ≥7 ngày cùng năm → "DD/MM" · năm cũ → "MM/YYYY".
 * tickMs: timestamp hiện tại (từ ticker chung) để tính delta — đổi mỗi 30s.
 */
export function formatConvTime(dateStr: string | null, tickMs: number): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const nowDate = new Date(tickMs);
  const diffMs = nowDate.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}p`;
  const diffHours = Math.floor(diffMins / 60);
  const p = getOrgParts(date);
  const nowP = getOrgParts(nowDate);
  if (!p || !nowP) return '';
  if (diffHours < 24) {
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays}d`;
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  if (p.year === nowP.year) return `${dd}/${mm}`;
  return `${mm}/${p.year}`;
}

const nowMs = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

function tick() { nowMs.value = Date.now(); }
function onVisibility() { if (!document.hidden) tick(); }

function start() {
  if (timer) return;
  timer = setInterval(tick, 30000);
  document.addEventListener('visibilitychange', onVisibility);
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  document.removeEventListener('visibilitychange', onVisibility);
}

/** Component dùng hook này sẽ tự đăng ký vào ticker chung; ticker chỉ chạy khi có
 *  ít nhất 1 subscriber, tự dừng khi không còn ai (tránh leak interval). */
export function useSharedNow() {
  onMounted(() => {
    subscribers++;
    start();
  });
  onUnmounted(() => {
    subscribers--;
    if (subscribers <= 0) { subscribers = 0; stop(); }
  });
  return nowMs;
}
