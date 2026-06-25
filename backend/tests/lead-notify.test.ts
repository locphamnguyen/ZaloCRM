// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// Lead-notify Nhịp 1 — unit test hàm thuần: jobId dedup keys + tiêu đề đếm số lần nhắc.
import { describe, it, expect } from 'vitest';
import {
  buildLeadAssignJobId,
  buildLeadNotifyTickJobId,
} from '../src/_ee/automation/queues/queue-registry.js';
import { buildLeadRemindHeadline } from '../src/_ee/automation/queues/lead-notify-tick-worker.js';

describe('buildLeadAssignJobId — dedup theo (list, contact)', () => {
  it('DETERMINISTIC: cùng (list, contact) → cùng jobId (2 emit đua = 1 job)', () => {
    expect(buildLeadAssignJobId('L1', 'C1')).toBe('la-L1-C1');
    expect(buildLeadAssignJobId('L1', 'C1')).toBe(buildLeadAssignJobId('L1', 'C1'));
  });

  it('KHÔNG chứa ":" (BullMQ v5 cấm trong custom jobId)', () => {
    expect(buildLeadAssignJobId('L1', 'C1')).not.toContain(':');
  });

  it('contact/list khác → jobId khác (không dedup nhầm lead khác)', () => {
    expect(buildLeadAssignJobId('L1', 'C1')).not.toBe(buildLeadAssignJobId('L1', 'C2'));
    expect(buildLeadAssignJobId('L1', 'C1')).not.toBe(buildLeadAssignJobId('L2', 'C1'));
  });
});

describe('buildLeadNotifyTickJobId — nonce attempt chống dedup-nuốt khi re-enqueue', () => {
  it('attempt khác → jobId khác (re-add tick không bị BullMQ nuốt)', () => {
    expect(buildLeadNotifyTickJobId('A1', 0)).toBe('lnt-A1-a0');
    expect(buildLeadNotifyTickJobId('A1', 0)).not.toBe(buildLeadNotifyTickJobId('A1', 1));
  });

  it('KHÔNG chứa ":"', () => {
    expect(buildLeadNotifyTickJobId('A1', 5)).not.toContain(':');
  });

  it('ack khác → jobId khác', () => {
    expect(buildLeadNotifyTickJobId('A1', 1)).not.toBe(buildLeadNotifyTickJobId('A2', 1));
  });
});

describe('buildLeadRemindHeadline — đếm số lần nhắc (anh chốt)', () => {
  it('lần 1 = "Lead mới"', () => {
    expect(buildLeadRemindHeadline(1)).toContain('LEAD MỚI');
    expect(buildLeadRemindHeadline(1)).toContain('lần 1');
  });

  it('từ lần 2 = "Nhắc nhận lead lần N" (đếm đúng số)', () => {
    expect(buildLeadRemindHeadline(2)).toBe('🔔 NHẮC NHẬN LEAD — LẦN 2');
    expect(buildLeadRemindHeadline(5)).toContain('LẦN 5');
  });

  it('biên 0 / âm → coi như lần 1 (an toàn)', () => {
    expect(buildLeadRemindHeadline(0)).toContain('LEAD MỚI');
  });
});
