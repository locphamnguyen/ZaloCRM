// Unit test (thuần) — conflict-guard backfill globalId-từ-Friend (FIX 2026-06-20 dedup).
// Phủ logic RỦI RO NHẤT: chọn sai = gộp nhầm 2 người khác nhau. Merge re-point + followMergedInto
// + worker/tab follow → verify tay (DB tx, không harness) + dry-run + self-verify dev.
import { describe, it, expect } from 'vitest';
import { pickBackfillGlobalId } from '../src/modules/contacts/duplicate-detector.js';

describe('pickBackfillGlobalId — conflict-guard (sai = gộp nhầm người)', () => {
  it('đúng 1 globalId → trả globalId đó', () => {
    expect(pickBackfillGlobalId(new Set(['G1']))).toBe('G1');
  });
  it('≥2 globalId khác nhau (mơ hồ) → null (KHÔNG backfill/merge)', () => {
    expect(pickBackfillGlobalId(new Set(['G1', 'G2']))).toBeNull();
    expect(pickBackfillGlobalId(new Set(['G1', 'G2', 'G3']))).toBeNull();
  });
  it('rỗng / undefined → null', () => {
    expect(pickBackfillGlobalId(new Set())).toBeNull();
    expect(pickBackfillGlobalId(undefined)).toBeNull();
  });
});
