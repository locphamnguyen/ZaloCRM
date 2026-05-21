/**
 * round-robin-assigner.test.ts — Unit tests for assignSale().
 *
 * Strategy: mock prisma.$transaction + inner calls via vi.mock.
 * The $transaction mock receives the callback and executes it with a mock tx.
 * This validates the round-robin logic and counter tracking without a live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Prisma ───────────────────────────────────────────────────────────────

// Shared mutable state so each test can configure pool + state
let mockStateRows: Array<{ id: string; counter: number; last_assigned_user_id: string | null }> = [];
let mockPool: Array<{ userId: string }> = [];
let mockContactUpdateSpy: ReturnType<typeof vi.fn>;
let mockStateUpdateSpy: ReturnType<typeof vi.fn>;
let mockStateCreateSpy: ReturnType<typeof vi.fn>;

vi.mock('../../src/shared/database/prisma-client.js', () => {
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $queryRaw: vi.fn().mockImplementation(() => Promise.resolve(mockStateRows)),
          saleAssignmentState: {
            create: mockStateCreateSpy,
            update: mockStateUpdateSpy,
          },
          customerListSaleAssignment: {
            findMany: vi.fn().mockImplementation(() => Promise.resolve(mockPool)),
          },
          contact: {
            update: mockContactUpdateSpy,
          },
        };
        return fn(tx);
      }),
    },
  };
});

vi.mock('../../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER mocks are set up
const { assignSale } = await import('../../src/modules/integrations/providers/facebook/round-robin-assigner.js');

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockStateRows = [];
  mockPool = [];

  mockContactUpdateSpy = vi.fn().mockResolvedValue({});
  mockStateUpdateSpy = vi.fn().mockResolvedValue({});
  mockStateCreateSpy = vi.fn().mockImplementation(({ data }: { data: { counter: number } }) =>
    Promise.resolve({ id: 'state-new', counter: data.counter })
  );
});

// ── Distribution tests ────────────────────────────────────────────────────────

describe('assignSale — distribution', () => {
  it('6 leads × 2 sales → distribution [3,3]', async () => {
    const pool = [{ userId: 'user-A' }, { userId: 'user-B' }];
    mockPool = pool;

    const assignments: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Simulate counter incrementing across calls
      if (mockStateRows.length === 0) {
        mockStateRows = [{ id: 'state-1', counter: i, last_assigned_user_id: null }];
      } else {
        mockStateRows = [{ id: 'state-1', counter: i, last_assigned_user_id: null }];
      }
      const result = await assignSale('org-1', 'list-1', `contact-${i}`);
      if (result) assignments.push(result);
    }

    const countA = assignments.filter((u) => u === 'user-A').length;
    const countB = assignments.filter((u) => u === 'user-B').length;
    expect(countA).toBe(3);
    expect(countB).toBe(3);
  });

  it('100 leads × 3 sales → distribution variance ≤ 1', async () => {
    const pool = [{ userId: 'A' }, { userId: 'B' }, { userId: 'C' }];
    mockPool = pool;

    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < 100; i++) {
      mockStateRows = [{ id: 'state-1', counter: i, last_assigned_user_id: null }];
      const result = await assignSale('org-1', 'list-1', `contact-${i}`);
      if (result) counts[result] = (counts[result] ?? 0) + 1;
    }

    const values = Object.values(counts);
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeLessThanOrEqual(1);
    expect(values.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

// ── Counter monotonic ─────────────────────────────────────────────────────────

describe('assignSale — counter', () => {
  it('counter increments on each call', async () => {
    mockPool = [{ userId: 'user-A' }];

    for (let i = 0; i < 10; i++) {
      mockStateRows = [{ id: 'state-1', counter: i, last_assigned_user_id: null }];
      await assignSale('org-1', 'list-1', `contact-${i}`);
    }

    // Each call should invoke stateUpdate with counter = i+1
    expect(mockStateUpdateSpy).toHaveBeenCalledTimes(10);
    // Last update should have counter=10
    const lastCall = mockStateUpdateSpy.mock.calls[9];
    expect(lastCall[0].data.counter).toBe(10);
  });

  it('creates state row on first call (no existing state)', async () => {
    mockPool = [{ userId: 'user-A' }];
    mockStateRows = []; // no state exists

    await assignSale('org-1', 'list-new', 'contact-1');

    expect(mockStateCreateSpy).toHaveBeenCalledWith({
      data: { orgId: 'org-1', customerListId: 'list-new', counter: 0 },
      select: { id: true, counter: true },
    });
    expect(mockStateUpdateSpy).toHaveBeenCalledTimes(1);
    expect(mockStateUpdateSpy.mock.calls[0][0].data.counter).toBe(1);
  });
});

// ── Empty pool ────────────────────────────────────────────────────────────────

describe('assignSale — empty pool', () => {
  it('returns null when pool is empty', async () => {
    mockPool = [];
    mockStateRows = [{ id: 'state-1', counter: 0, last_assigned_user_id: null }];

    const result = await assignSale('org-1', 'list-1', 'contact-1');
    expect(result).toBeNull();
  });

  it('does not update Contact when pool empty', async () => {
    mockPool = [];
    mockStateRows = [{ id: 'state-1', counter: 0, last_assigned_user_id: null }];

    await assignSale('org-1', 'list-1', 'contact-1');
    expect(mockContactUpdateSpy).not.toHaveBeenCalled();
  });

  it('does not increment counter when pool empty', async () => {
    mockPool = [];
    mockStateRows = [{ id: 'state-1', counter: 5, last_assigned_user_id: null }];

    await assignSale('org-1', 'list-1', 'contact-1');
    expect(mockStateUpdateSpy).not.toHaveBeenCalled();
  });
});

// ── Correct assignment ────────────────────────────────────────────────────────

describe('assignSale — idx rotation', () => {
  it('picks by counter % pool.length', async () => {
    const pool = [{ userId: 'X' }, { userId: 'Y' }, { userId: 'Z' }];
    mockPool = pool;

    const expected = ['X', 'Y', 'Z', 'X', 'Y', 'Z'];
    for (let i = 0; i < 6; i++) {
      mockStateRows = [{ id: 'state-1', counter: i, last_assigned_user_id: null }];
      const result = await assignSale('org-1', 'list-1', `contact-${i}`);
      expect(result).toBe(expected[i]);
    }
  });

  it('updates Contact.assignedUserId with picked userId', async () => {
    mockPool = [{ userId: 'picked-user' }];
    mockStateRows = [{ id: 'state-1', counter: 0, last_assigned_user_id: null }];

    await assignSale('org-1', 'list-1', 'contact-abc');

    expect(mockContactUpdateSpy).toHaveBeenCalledWith({
      where: { id: 'contact-abc' },
      data: { assignedUserId: 'picked-user' },
    });
  });

  it('records lastAssignedUserId in state', async () => {
    mockPool = [{ userId: 'sale-1' }];
    mockStateRows = [{ id: 'state-1', counter: 0, last_assigned_user_id: null }];

    await assignSale('org-1', 'list-1', 'contact-1');

    expect(mockStateUpdateSpy).toHaveBeenCalledWith({
      where: { id: 'state-1' },
      data: { counter: 1, lastAssignedUserId: 'sale-1' },
    });
  });

  it('returns the assigned userId', async () => {
    mockPool = [{ userId: 'sale-42' }];
    mockStateRows = [{ id: 'state-1', counter: 3, last_assigned_user_id: null }];

    const result = await assignSale('org-1', 'list-1', 'contact-1');
    expect(result).toBe('sale-42');
  });
});
