// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-work-scope.ts — "Phạm vi làm việc" (work-scope): NGUỒN CHÂN LÝ DUY NHẤT cho
 * "đang làm việc với nick nào" trong UI chat.
 *
 * Thay khái niệm FILTER mềm cũ (accountFilter). Cột 2 + socket + route đều đọc từ đây.
 * Logic thuần (test được) nằm ở work-scope-logic.ts; file này lo state Vue + localStorage.
 *
 * QUY ƯỚC (Anh chốt 2026-06-15, eng-review):
 *   - scope rỗng []        → TẤT CẢ nick CÓ QUYỀN của tôi (mặc định vào chat).
 *   - scope [X]            → khóa nick X (khi tự chọn). v1 length ≤ 1; nhóm A-B-C phase 2.
 *   - Lưu localStorage 'chat.workscope.v2' (giữ cơ chế cũ, Anh chốt KHÔNG dùng DB/sessionStorage).
 *   - Mở chat nick NGOÀI scope → caller RELOAD trang + nạp scope (state sạch). use-work-scope
 *     chỉ cung cấp setScope; việc reload do ChatView quyết.
 *   - setScope IDEMPOTENT (shallow-equal early-return) → chống vòng lặp setScope↔refetch.
 *
 * ⭐ BẢO MẬT: validateAgainst() bỏ mọi nick ngoài quyền (accessibleIds = nick qua getZaloScope).
 *   workScope KHÔNG bao giờ vượt quyền server đã cấp.
 */
import { ref } from 'vue';
import { isInScope, validateScopeIds, scopeEquals } from './work-scope-logic';

const SCOPE_KEY = 'chat.workscope.v2';

// Module-level — chia sẻ across mọi useWorkScope() (giống accountFilter cũ).
const accountIds = ref<string[]>(loadScopeRaw());

function loadScopeRaw(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SCOPE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return []; // localStorage chặn/hỏng → mặc định TẤT CẢ, không crash.
  }
}

function persist(ids: string[]) {
  try {
    localStorage.setItem(SCOPE_KEY, JSON.stringify(ids));
  } catch {
    /* localStorage đầy/chặn → bỏ qua, scope vẫn sống in-memory */
  }
}

export function useWorkScope() {
  /** Đặt scope. IDEMPOTENT: scope không đổi → no-op (không ghi, không trigger watcher). */
  function setScope(ids: string[]): boolean {
    if (scopeEquals(accountIds.value, ids)) return false; // no-op → chống vòng lặp
    accountIds.value = [...ids];
    persist(accountIds.value);
    return true;
  }

  /** Khóa vào đúng 1 nick (v1). [] để về TẤT CẢ. */
  function lockToNick(id: string | null): boolean {
    return setScope(id ? [id] : []);
  }

  /** Tin của nick này có được vào cột 2 không. */
  function inScope(accountId: string | null | undefined): boolean {
    return isInScope(accountIds.value, accountId);
  }

  /** Cho query /conversations. v1 single-nick → trả accountId đơn (BE counts chưa nhận CSV). */
  function scopeAccountId(): string | undefined {
    return accountIds.value[0] ?? undefined; // [] → undefined = server tự lọc theo quyền (tất cả)
  }

  /**
   * Lọc scope chỉ còn nick CÓ QUYỀN. Gọi sau khi fetchZaloAccounts xong.
   * Nick mất quyền → bỏ. Ghi đè localStorage nếu có thay đổi. (Bảo mật.)
   */
  function validateAgainst(accessibleIds: string[]): void {
    const valid = validateScopeIds(accountIds.value, accessibleIds);
    if (!scopeEquals(valid, accountIds.value)) {
      accountIds.value = valid;
      persist(valid);
    }
  }

  return {
    accountIds,
    setScope,
    lockToNick,
    inScope,
    scopeAccountId,
    validateAgainst,
  };
}
