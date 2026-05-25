/**
 * round-robin-assigner.ts — Race-safe round-robin sale assignment for FB leads.
 *
 * Logic:
 *   1. SELECT FOR UPDATE on SaleAssignmentState (per customerListId) — serializes concurrent calls.
 *   2. Load enabled sale pool from CustomerListSaleAssignment ordered by userId ASC (stable order).
 *   3. idx = counter % pool.length → pick userId.
 *   4. UPDATE Contact.assignedUserId + SaleAssignmentState.counter atomically in same TX.
 *
 * Caller guard: worker checks Contact.assignedUserId IS NULL before calling.
 * This fn always assigns — no skip logic here.
 *
 * Returns assigned userId, or null if pool is empty.
 */

import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';

export async function assignSale(
  orgId: string,
  customerListId: string,
  contactId: string,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    // SELECT FOR UPDATE — serializes concurrent ingestion for same list
    const rows = await tx.$queryRaw<Array<{
      id: string;
      counter: number;
      last_assigned_user_id: string | null;
    }>>`
      SELECT id, counter, last_assigned_user_id
      FROM sale_assignment_states
      WHERE customer_list_id = ${customerListId}
      FOR UPDATE
    `;

    let stateId: string;
    let counter: number;

    if (rows.length === 0) {
      // First lead for this list — create state row
      const created = await tx.saleAssignmentState.create({
        data: { orgId, customerListId, counter: 0 },
        select: { id: true, counter: true },
      });
      stateId = created.id;
      counter = created.counter;
    } else {
      stateId = rows[0].id;
      counter = rows[0].counter;
    }

    // Load pool: enabled assignments for this list, ordered by userId for stable rotation
    const pool = await tx.customerListSaleAssignment.findMany({
      where: { customerListId, enabled: true },
      orderBy: { userId: 'asc' },
      select: { userId: true },
    });

    if (pool.length === 0) {
      logger.warn(
        '[round-robin] customerListId=%s has no enabled sale assignments — skipping',
        customerListId,
      );
      return null;
    }

    const idx = counter % pool.length;
    const picked = pool[idx].userId;

    // Assign contact
    await tx.contact.update({
      where: { id: contactId },
      data: { assignedUserId: picked },
    });

    // Advance counter
    await tx.saleAssignmentState.update({
      where: { id: stateId },
      data: { counter: counter + 1, lastAssignedUserId: picked },
    });

    logger.info(
      '[round-robin] list=%s contact=%s → user=%s (counter=%d)',
      customerListId,
      contactId,
      picked,
      counter,
    );

    return picked;
  });
}
