/**
 * broadcast-content-block-org-scope.test.ts — P1 (B1+B2) regression.
 * resolveJobContent PHẢI lọc contentBlock theo orgId: dù DB có row bẩn (id khối của
 * org khác lọt vào job), findMany lọc orgId trả rỗng → fallback messageText, KHÔNG
 * gửi nội dung ngoài org của job.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  contentBlock: { findMany: vi.fn() },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

const { resolveJobContent } = await import('../src/modules/broadcast/broadcast-cron.js');

describe('resolveJobContent org scope (P1)', () => {
  beforeEach(() => {
    prismaMock.contentBlock.findMany.mockReset();
  });

  it('truyền orgId vào where của contentBlock.findMany', async () => {
    prismaMock.contentBlock.findMany.mockResolvedValue([
      { id: 'blk-1', messageText: 'nội dung org A', imageUrl: null },
    ]);
    await resolveJobContent(
      { messageText: 'fallback', imageUrl: null, contentBlockIds: ['blk-1'] },
      0,
      'org-A',
    );
    expect(prismaMock.contentBlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['blk-1'] }, orgId: 'org-A' } }),
    );
  });

  it('id khối của org khác → findMany trả rỗng → fallback messageText, không lộ nội dung ngoài org', async () => {
    // Mô phỏng row bẩn: job.contentBlockIds chứa id org khác, nhưng lọc orgId trả rỗng.
    prismaMock.contentBlock.findMany.mockResolvedValue([]);
    const out = await resolveJobContent(
      { messageText: 'nội dung an toàn của org', imageUrl: null, contentBlockIds: ['blk-org-khac'] },
      0,
      'org-A',
    );
    expect(out).toEqual({ messageText: 'nội dung an toàn của org', imageUrl: null, blockId: null });
  });

  it('không có contentBlockIds → dùng messageText/imageUrl gõ tay', async () => {
    const out = await resolveJobContent(
      { messageText: 'text tay', imageUrl: 'http://x/y.jpg', contentBlockIds: [] },
      0,
      'org-A',
    );
    expect(out).toEqual({ messageText: 'text tay', imageUrl: 'http://x/y.jpg', blockId: null });
    expect(prismaMock.contentBlock.findMany).not.toHaveBeenCalled();
  });
});
