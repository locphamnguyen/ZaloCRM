/**
 * care-manager-resolve.test.ts — Test getManagerOfUser (CareSession notify manager).
 *
 * Resolve "quản lý trực tiếp" qua Department tree (cha xem con):
 *  - member → leader của dept mình
 *  - leader → leader của dept CHA
 *  - không có cha / không leader → null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  departmentMember: { findUnique: vi.fn(), findFirst: vi.fn() },
  department: { findUnique: vi.fn() },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));

const { getManagerOfUser } = await import('../src/modules/rbac/department-service.ts');

beforeEach(() => vi.clearAllMocks());

describe('getManagerOfUser', () => {
  it('member → leader của dept mình', async () => {
    prismaMock.departmentMember.findUnique.mockResolvedValue({ departmentId: 'd1', deptRole: 'member' });
    prismaMock.departmentMember.findFirst.mockResolvedValue({ userId: 'leader1' });

    const mgr = await getManagerOfUser('saleA');
    expect(mgr).toBe('leader1');
    // tìm leader của chính dept d1
    expect(prismaMock.departmentMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { departmentId: 'd1', deptRole: 'leader' } }),
    );
  });

  it('leader → leader của dept CHA (lên 1 cấp)', async () => {
    prismaMock.departmentMember.findUnique.mockResolvedValue({ departmentId: 'd2', deptRole: 'leader' });
    prismaMock.department.findUnique.mockResolvedValue({ parentId: 'dParent' });
    prismaMock.departmentMember.findFirst.mockResolvedValue({ userId: 'bigBoss' });

    const mgr = await getManagerOfUser('leaderB');
    expect(mgr).toBe('bigBoss');
    expect(prismaMock.departmentMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { departmentId: 'dParent', deptRole: 'leader' } }),
    );
  });

  it('leader của dept gốc (không cha) → null', async () => {
    prismaMock.departmentMember.findUnique.mockResolvedValue({ departmentId: 'root', deptRole: 'leader' });
    prismaMock.department.findUnique.mockResolvedValue({ parentId: null });

    const mgr = await getManagerOfUser('ceo');
    expect(mgr).toBeNull();
  });

  it('user không thuộc dept nào → null', async () => {
    prismaMock.departmentMember.findUnique.mockResolvedValue(null);
    const mgr = await getManagerOfUser('orphan');
    expect(mgr).toBeNull();
  });

  it('member nhưng dept không có leader → thử lên cha', async () => {
    prismaMock.departmentMember.findUnique.mockResolvedValue({ departmentId: 'd3', deptRole: 'member' });
    // không leader ở d3
    prismaMock.departmentMember.findFirst.mockResolvedValueOnce(null);
    prismaMock.department.findUnique.mockResolvedValue({ parentId: 'd3parent' });
    prismaMock.departmentMember.findFirst.mockResolvedValueOnce({ userId: 'parentLeader' });

    const mgr = await getManagerOfUser('saleC');
    expect(mgr).toBe('parentLeader');
  });

  it('không tự làm manager của chính mình (leader đơn độc)', async () => {
    prismaMock.departmentMember.findUnique.mockResolvedValue({ departmentId: 'd1', deptRole: 'leader' });
    prismaMock.department.findUnique.mockResolvedValue({ parentId: 'dp' });
    // leader của cha LÀ chính user này
    prismaMock.departmentMember.findFirst.mockResolvedValue({ userId: 'selfLeader' });

    const mgr = await getManagerOfUser('selfLeader');
    expect(mgr).toBeNull(); // không trả về chính mình
  });
});
