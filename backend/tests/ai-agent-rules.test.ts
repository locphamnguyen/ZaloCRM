import { describe, it, expect } from 'vitest';
import {
  computeReplyDelayMs,
  isWithinWorkHours,
  matchesHandoff,
  parseAgentOutput,
  parseHm,
  randomDelayMs,
} from '../src/modules/ai-agent/ai-agent-rules.js';

// 2026-11-03 03:00Z = 10:00 giờ VN; 15:30Z = 22:30 giờ VN
const DAY_VN = new Date('2026-11-03T03:00:00Z');
const NIGHT_VN = new Date('2026-11-03T15:30:00Z');
const TZ = 'Asia/Ho_Chi_Minh';

describe('ai-agent rules', () => {
  it('parseHm', () => {
    expect(parseHm('08:00')).toBe(480);
    expect(parseHm('8:05')).toBe(485);
    expect(parseHm('24:00')).toBeNull();
    expect(parseHm('abc')).toBeNull();
  });

  it('isWithinWorkHours — normal and overnight windows', () => {
    expect(isWithinWorkHours(DAY_VN, '08:00', '21:00', TZ)).toBe(true);
    expect(isWithinWorkHours(NIGHT_VN, '08:00', '21:00', TZ)).toBe(false);
    expect(isWithinWorkHours(NIGHT_VN, '20:00', '02:00', TZ)).toBe(true);
    expect(isWithinWorkHours(DAY_VN, '20:00', '02:00', TZ)).toBe(false);
  });

  it('randomDelayMs stays within bounds', () => {
    expect(randomDelayMs(5, 20, () => 0)).toBe(5000);
    expect(randomDelayMs(5, 20, () => 1)).toBe(20000);
    expect(randomDelayMs(20, 5, () => 0)).toBe(5000);
  });

  it('computeReplyDelayMs — off_hours waits for staff during work hours only', () => {
    const base = { workStart: '08:00', workEnd: '21:00', timezone: TZ, staffGraceMinutes: 10, minDelaySec: 10, maxDelaySec: 10, rand: () => 0 };
    expect(computeReplyDelayMs({ ...base, mode: 'off_hours', now: NIGHT_VN })).toBe(10_000);
    expect(computeReplyDelayMs({ ...base, mode: 'off_hours', now: DAY_VN })).toBe(600_000 + 10_000);
    expect(computeReplyDelayMs({ ...base, mode: 'always', now: DAY_VN })).toBe(10_000);
  });

  it('matchesHandoff', () => {
    expect(matchesHandoff('Cho mình gặp NHÂN VIÊN với', 'nhân viên|khiếu nại')).toBe(true);
    expect(matchesHandoff('Kem này giá bao nhiêu', 'nhân viên|khiếu nại')).toBe(false);
    expect(matchesHandoff('bất kỳ', '')).toBe(false);
  });

  it('parseAgentOutput strips handoff token and quotes', () => {
    expect(parseAgentOutput('"Dạ em chào chị"')).toEqual({ text: 'Dạ em chào chị', handoff: false });
    expect(parseAgentOutput('Dạ em xin lỗi chị [HANDOFF]')).toEqual({ text: 'Dạ em xin lỗi chị', handoff: true });
    expect(parseAgentOutput('   ').handoff).toBe(true);
  });
});
