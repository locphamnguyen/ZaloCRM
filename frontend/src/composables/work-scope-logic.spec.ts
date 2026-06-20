// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { describe, it, expect } from 'vitest';
import {
  isInScope,
  validateScopeIds,
  scopeEquals,
  classifyIncoming,
  shouldAdoptNickScope,
} from './work-scope-logic';

describe('isInScope', () => {
  it('scope rỗng = TẤT CẢ → mọi nick in-scope', () => {
    expect(isInScope([], 'A')).toBe(true);
    expect(isInScope([], null)).toBe(true);
    expect(isInScope([], undefined)).toBe(true);
  });
  it('scope [A] → chỉ A in-scope, B out', () => {
    expect(isInScope(['A'], 'A')).toBe(true);
    expect(isInScope(['A'], 'B')).toBe(false);
  });
  it('scope [A] + accountId null/undefined → out (không xác định nick)', () => {
    expect(isInScope(['A'], null)).toBe(false);
    expect(isInScope(['A'], undefined)).toBe(false);
  });
  it('nhóm [A,B] (phase 2) → A và B in, C out', () => {
    expect(isInScope(['A', 'B'], 'A')).toBe(true);
    expect(isInScope(['A', 'B'], 'B')).toBe(true);
    expect(isInScope(['A', 'B'], 'C')).toBe(false);
  });
});

describe('validateScopeIds (BẢO MẬT — bỏ nick ngoài quyền)', () => {
  it('giữ nick có quyền, bỏ nick mất quyền', () => {
    expect(validateScopeIds(['A', 'B'], ['A'])).toEqual(['A']); // B mất quyền → bỏ
  });
  it('nick KHÔNG có trong accessible bị loại HẾT → scope rỗng (về tất cả)', () => {
    expect(validateScopeIds(['X'], ['A', 'B'])).toEqual([]);
  });
  it('user KHÔNG đưa được nick ngoài quyền vào scope (cửa hậu vượt quyền bị chặn)', () => {
    // dù savedIds có nick lạ Z, accessible chỉ [A,B] → Z bị loại
    expect(validateScopeIds(['A', 'Z'], ['A', 'B'])).toEqual(['A']);
  });
  it('scope rỗng (tất cả) giữ nguyên rỗng', () => {
    expect(validateScopeIds([], ['A', 'B'])).toEqual([]);
  });
});

describe('scopeEquals (idempotent guard — chống vòng lặp)', () => {
  it('cùng phần tử cùng thứ tự = bằng', () => {
    expect(scopeEquals(['A'], ['A'])).toBe(true);
    expect(scopeEquals([], [])).toBe(true);
  });
  it('khác độ dài hoặc phần tử = khác', () => {
    expect(scopeEquals(['A'], ['B'])).toBe(false);
    expect(scopeEquals(['A'], [])).toBe(false);
    expect(scopeEquals(['A'], ['A', 'B'])).toBe(false);
  });
});

describe('shouldAdoptNickScope (REGRESSION nav-bug — iron rule)', () => {
  it('đang khóa nick A, mở chat khách nick B (ngoài scope) → CẦN đổi scope + reload', () => {
    expect(shouldAdoptNickScope(['A'], 'B')).toBe(true);
  });
  it('đang khóa nick A, mở lại chat nick A → KHÔNG cần (luồng tự thông)', () => {
    expect(shouldAdoptNickScope(['A'], 'A')).toBe(false);
  });
  it('scope rỗng (TẤT CẢ), mở chat nick bất kỳ → KHÔNG cần (đã in-scope)', () => {
    expect(shouldAdoptNickScope([], 'B')).toBe(false);
  });
  it('nhóm [A,B] (phase 2), mở chat nick B → KHÔNG cần; mở nick C → CẦN', () => {
    expect(shouldAdoptNickScope(['A', 'B'], 'B')).toBe(false);
    expect(shouldAdoptNickScope(['A', 'B'], 'C')).toBe(true);
  });
  it('không biết nick conv (null) → KHÔNG đổi (an toàn, không reload mù)', () => {
    expect(shouldAdoptNickScope(['A'], null)).toBe(false);
    expect(shouldAdoptNickScope(['A'], undefined)).toBe(false);
  });
});

describe('classifyIncoming (TRÁI TIM socket guard — fix 2 bug v1)', () => {
  const base = { conversationId: 'c1', selectedConvId: null as string | null, scope: ['A'] };

  it('IN-SCOPE + KHÔNG mở thread → vào cột 2, không badge, không thread', () => {
    const r = classifyIncoming({ ...base, accountId: 'A', conversationId: 'c2' });
    expect(r).toEqual({ insertThread: false, updateColumn2: true, bumpBadge: false });
  });

  it('OUT-OF-SCOPE + KHÔNG mở thread → CHỈ badge, KHÔNG vào cột 2, KHÔNG thread', () => {
    const r = classifyIncoming({ ...base, accountId: 'B', conversationId: 'c2' });
    expect(r).toEqual({ insertThread: false, updateColumn2: false, bumpBadge: true });
  });

  it('BUG v1.2 FIX — OUT-OF-SCOPE nhưng là THREAD ĐANG MỞ → VẪN insert thread (không mất tin), không badge, không cột 2', () => {
    // tình huống vừa nav sang nick B (ngoài scope A) mà chưa reload — tin của thread B đang mở phải vào
    const r = classifyIncoming({ accountId: 'B', conversationId: 'c1', selectedConvId: 'c1', scope: ['A'] });
    expect(r.insertThread).toBe(true); // KHÔNG mất tin thread đang mở
    expect(r.bumpBadge).toBe(false);   // không badge thread đang mở
    expect(r.updateColumn2).toBe(false); // B ngoài scope → không vào cột 2
  });

  it('IN-SCOPE + là thread đang mở → vào cả thread lẫn cột 2', () => {
    const r = classifyIncoming({ accountId: 'A', conversationId: 'c1', selectedConvId: 'c1', scope: ['A'] });
    expect(r.insertThread).toBe(true);
    expect(r.updateColumn2).toBe(true);
    expect(r.bumpBadge).toBe(false);
  });

  it('scope RỖNG (tất cả) → mọi tin vào cột 2, không bao giờ badge', () => {
    const r = classifyIncoming({ accountId: 'Z', conversationId: 'c2', selectedConvId: null, scope: [] });
    expect(r.updateColumn2).toBe(true);
    expect(r.bumpBadge).toBe(false);
  });
});
