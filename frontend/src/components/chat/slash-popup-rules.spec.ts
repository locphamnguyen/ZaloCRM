// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { describe, it, expect } from 'vitest';

// Test quy tắc ẩn popup mẫu tin nhắn khi gõ "/" (anh chốt 2026-06-15, FIX 2).
// Tách quy tắc thành predicate thuần để test (logic gốc trong MessageThread.onTypingEvent).
// q = phần text SAU dấu "/" trigger.
function shouldHidePopup(q: string): boolean {
  // (a) "//" → q bắt đầu bằng "/"; (b) "/tukhoa nội dung" → q chứa khoảng trắng.
  return q.startsWith('/') || /\s/.test(q);
}

describe('shouldHidePopup — FIX 2 ẩn popup mẫu tin nhắn', () => {
  it('gõ "//" (q = "/") → ẩn popup', () => {
    expect(shouldHidePopup('/')).toBe(true);
  });
  it('gõ "/tukhoa " (có dấu cách) → ẩn popup', () => {
    expect(shouldHidePopup('tukhoa ')).toBe(true);
  });
  it('gõ "/tukhoa nội dung tin" (dấu cách giữa) → ẩn popup', () => {
    expect(shouldHidePopup('tukhoa nội dung')).toBe(true);
  });
  it('gõ "/chao" (đang gõ từ khóa, chưa cách) → GIỮ popup', () => {
    expect(shouldHidePopup('chao')).toBe(false);
  });
  it('gõ "/" mới (q rỗng) → GIỮ popup (đang chờ gõ từ khóa)', () => {
    expect(shouldHidePopup('')).toBe(false);
  });
  it('gõ "/chao-ban" (gạch nối, không cách) → GIỮ popup', () => {
    expect(shouldHidePopup('chao-ban')).toBe(false);
  });
});
