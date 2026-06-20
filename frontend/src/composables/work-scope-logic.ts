// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * work-scope-logic.ts — LOGIC THUẦN cho "Phạm vi làm việc" (tách khỏi Vue để unit-test).
 *
 * Bối cảnh (DESIGN-PHAM-VI-LAM-VIEC-20260615 + eng-review 2026-06-15):
 *   "Phạm vi xem" đổi từ FILTER mềm → ĐIỀU KIỆN LOAD. workScope = danh sách nick đang
 *   làm việc. Cột 2 + socket + route đọc từ đây (1 nguồn chân lý).
 *
 * QUY ƯỚC scope (Anh chốt):
 *   - accountIds = [] (RỖNG)  → "TẤT CẢ nick CÓ QUYỀN của tôi" (mặc định khi vào chat).
 *   - accountIds = [X]        → KHÓA vào nick X (khi Anh tự chọn). v1 length ≤ 1; nhóm A-B-C phase 2.
 *
 * ⭐ RÀNG BUỘC BẢO MẬT (bất khả xâm phạm): workScope CHỈ là lớp lọc THÊM bên trong quyền
 *   server đã cấp (getZaloScope). validateScopeIds bỏ mọi nick ngoài danh sách CÓ QUYỀN.
 *   Đây KHÔNG phải cửa hậu vượt quyền — server vẫn là chốt chặn cuối.
 *
 * Các hàm dưới đây THUẦN (không Vue, không storage, không DOM) → unit-test trực tiếp.
 */

/**
 * Quyết định khi mở 1 hội thoại của nick `convNick`, có cần ĐỔI scope + reload không
 * (fix bug nhảy nick — Anh chốt: mở chat nick NGOÀI scope → reload + nạp scope nick đó).
 *
 *   - convNick null/undefined → không biết nick → KHÔNG đổi (an toàn).
 *   - scope rỗng (TẤT CẢ) → convNick đã in-scope → KHÔNG cần (luồng tự thông).
 *   - convNick ĐÃ trong scope → KHÔNG cần (luồng tự thông).
 *   - convNick NGOÀI scope → cần đổi scope=[convNick] + reload (state sạch).
 *
 * Idempotent: chỉ trả true khi thực sự cần đổi → chống reload vô ích / vòng lặp.
 */
export function shouldAdoptNickScope(scope: string[], convNick: string | null | undefined): boolean {
  if (!convNick) return false;
  return !isInScope(scope, convNick);
}

/** Tin có nằm trong scope không. RỖNG = tất cả → mọi nick in-scope. */
export function isInScope(scope: string[], accountId: string | null | undefined): boolean {
  if (scope.length === 0) return true; // rỗng = tất cả
  if (!accountId) return false;
  return scope.includes(accountId);
}

/**
 * Lọc scope đã lưu chỉ còn nick CÓ QUYỀN (accessibleIds = nick qua getZaloScope).
 * Nick mất quyền/bị gỡ → loại. Đây là chốt bảo mật phía FE (server vẫn chặn lần nữa).
 */
export function validateScopeIds(savedIds: string[], accessibleIds: string[]): string[] {
  const accessible = new Set(accessibleIds);
  return savedIds.filter((id) => accessible.has(id));
}

/** So sánh 2 scope (idempotent guard — chống vòng lặp setScope↔refetch). */
export function scopeEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface IncomingClassification {
  /** Chèn vào thread đang mở (cột 3). LUÔN true nếu là conv đang mở — KHÔNG bị scope chặn. */
  insertThread: boolean;
  /** Cập nhật optimistic cột 2 (move-to-top, unread, preview). Chỉ khi in-scope. */
  updateColumn2: boolean;
  /** Tăng badge "N tin nick khác". Chỉ khi out-of-scope (và KHÔNG phải thread đang mở). */
  bumpBadge: boolean;
}

/**
 * Quyết định 1 tin socket tới sẽ làm gì — TRÁI TIM của socket guard (use-chat.ts:744).
 *
 * Sửa 2 bug v1 (eng-review):
 *   - Đọc accountId TỪ CẤP NGOÀI payload (data.accountId), KHÔNG data.message.zaloAccountId.
 *   - Thread đang mở LUÔN nhận tin (insertThread) — guard CHỈ chặn cột-2, không chặn thread.
 *
 * @param accountId  nick của tin (data.accountId từ emit-chat.ts:52)
 * @param conversationId  conv của tin
 * @param selectedConvId  conv đang mở (null nếu không mở gì)
 * @param scope  workScope hiện tại ([] = tất cả)
 */
export function classifyIncoming(params: {
  accountId: string | null | undefined;
  conversationId: string;
  selectedConvId: string | null;
  scope: string[];
}): IncomingClassification {
  const { accountId, conversationId, selectedConvId, scope } = params;
  const isOpenThread = !!selectedConvId && conversationId === selectedConvId;
  const inScope = isInScope(scope, accountId);

  return {
    // Thread đang mở luôn nhận (kể cả nick ngoài scope — vd vừa nav sang). KHÔNG mất tin.
    insertThread: isOpenThread,
    // Cột 2 chỉ nhận tin in-scope (đây là chỗ "không load tin nick khác vào UI").
    updateColumn2: inScope,
    // Out-of-scope + KHÔNG phải thread đang mở → đếm badge "có tin ở nick khác".
    bumpBadge: !inScope && !isOpenThread,
  };
}
