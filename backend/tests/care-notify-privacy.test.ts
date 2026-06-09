/**
 * care-notify-privacy.test.ts — Test BẮT BUỘC privacy render (eng-review D8).
 *
 * Vùng nhạy cảm: rò SĐT/nội dung khách ra nhóm = vi phạm Privacy v2. Test này
 * đảm bảo cùng 1 sự kiện, 3 đích thấy 3 mức thông tin khác nhau ĐÚNG quy tắc.
 */
import { describe, it, expect } from 'vitest';
import {
  renderNotifyForTarget,
  abbreviateName,
} from '../src/modules/automation/care-session/notify-privacy.js';

const base = {
  eventType: 'reply' as const,
  contactName: 'Nguyễn Văn Hùng',
  contactPhone: '0909123412',
  contentPreview: 'Cho mình hỏi căn 2 phòng còn không',
  saleName: 'Thành',
  triggerName: 'Mời KB Q4',
};

describe('renderNotifyForTarget — OWNER (đầy đủ)', () => {
  it('owner thấy tên + SĐT + nội dung tin', () => {
    const out = renderNotifyForTarget({ ...base, target: 'owner' });
    expect(out).toContain('Nguyễn Văn Hùng');
    expect(out).toContain('0909123412');
    expect(out).toContain('Cho mình hỏi căn 2 phòng còn không');
  });
});

describe('renderNotifyForTarget — MANAGER (ẩn SĐT + nội dung)', () => {
  it('manager thấy tên + loại sự kiện NHƯNG KHÔNG SĐT, KHÔNG nội dung', () => {
    const out = renderNotifyForTarget({ ...base, target: 'manager' });
    expect(out).toContain('Nguyễn Văn Hùng'); // tên OK
    expect(out).not.toContain('0909123412'); // ẩn SĐT
    expect(out).not.toContain('Cho mình hỏi căn 2 phòng'); // ẩn nội dung
  });
});

describe('renderNotifyForTarget — GROUP (viết tắt, không SĐT/nội dung)', () => {
  it('group thấy tên VIẾT TẮT, KHÔNG SĐT, KHÔNG nội dung, KHÔNG tên đầy đủ', () => {
    const out = renderNotifyForTarget({ ...base, target: 'group' });
    expect(out).not.toContain('0909123412'); // ẩn SĐT
    expect(out).not.toContain('Cho mình hỏi căn 2 phòng'); // ẩn nội dung
    expect(out).not.toContain('Nguyễn Văn Hùng'); // KHÔNG tên đầy đủ
    expect(out).toContain('Nguyễn Văn H.'); // tên viết tắt
    expect(out).toContain('Thành'); // sale name OK (để QL biết của ai)
  });
});

describe('abbreviateName', () => {
  it('nhiều từ → giữ đầu, viết tắt từ cuối', () => {
    expect(abbreviateName('Nguyễn Văn Hùng')).toBe('Nguyễn Văn H.');
    expect(abbreviateName('Trần Mai')).toBe('Trần M.');
  });
  it('1 từ dài → cắt 3 ký tự + .', () => {
    expect(abbreviateName('Alexander')).toBe('Ale.');
  });
  it('1 từ ngắn → giữ nguyên', () => {
    expect(abbreviateName('An')).toBe('An');
  });
  it('rỗng → KH', () => {
    expect(abbreviateName('')).toBe('KH');
    expect(abbreviateName('   ')).toBe('KH');
  });
});

describe('privacy không rò xuyên đích (CRITICAL)', () => {
  it('SĐT chỉ xuất hiện ở owner, KHÔNG ở manager/group', () => {
    const phone = '0909123412';
    expect(renderNotifyForTarget({ ...base, target: 'owner' })).toContain(phone);
    expect(renderNotifyForTarget({ ...base, target: 'manager' })).not.toContain(phone);
    expect(renderNotifyForTarget({ ...base, target: 'group' })).not.toContain(phone);
  });
  it('nội dung tin chỉ ở owner', () => {
    const content = 'Cho mình hỏi căn 2 phòng còn không';
    expect(renderNotifyForTarget({ ...base, target: 'owner' })).toContain(content);
    expect(renderNotifyForTarget({ ...base, target: 'manager' })).not.toContain(content);
    expect(renderNotifyForTarget({ ...base, target: 'group' })).not.toContain(content);
  });
});
