// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * campaign-service.ts — Outreach campaign primitives.
 *
 * Phase 1 scope:
 *   - pickRandomEligibleContact(): pick a contact a given nick has not yet attempted,
 *     skipping known no-Zalo and revoked-consent contacts.
 *   - attemptFriendRequest(): findUser by phone → discover hasZalo → send friend request.
 *     Discovery is a side-effect of the attempt, not a separate scan.
 *   - executeRandomFriendRequest(): the composed flow exposed via the route.
 */
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { zaloOps, ZaloOpError } from '../../shared/zalo-operations.js';
import { logger } from '../../shared/utils/logger.js';
import { markFriendRequestSent } from '../zalo/friend-event-handler.js';

export const DEFAULT_REQUEST_MESSAGE =
  'Xin chào! Tôi đang phân phối dự án bất động sản, kết bạn để gửi thông tin tới anh/chị nhé.';

export type AttemptOutcome =
  | { ok: true; state: 'sent'; zaloUid: string }
  | { ok: false; state: 'no_zalo'; reason: 'phone_not_on_zalo' }
  | { ok: false; state: 'error'; errorCode: string; errorDetail: string };

interface PickedContact {
  id: string;
  phone: string;
}

/**
 * Pick one random contact eligible for the given nick:
 *  - same org as the nick
 *  - not merged
 *  - has a phone number
 *  - hasZalo is not explicitly false (null=unknown is allowed)
 *  - consent not revoked
 *  - this nick has not already attempted this contact
 *  - no other nick has already accepted this contact (avoid duplicate friending)
 *
 * Uses ORDER BY random() — fine for low-volume manual triggers; will need
 * sampling strategy when dispatcher runs every 30s on 1M rows.
 */
export async function pickRandomEligibleContact(
  orgId: string,
  zaloAccountId: string,
): Promise<PickedContact | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; phone: string }>>`
    SELECT c.id, c.phone
      FROM contacts c
     WHERE c.org_id = ${orgId}
       AND c.merged_into IS NULL
       AND c.phone IS NOT NULL
       AND c.phone <> ''
       AND (c.has_zalo IS NULL OR c.has_zalo = true)
       AND c.consent_status <> 'revoked'
       AND NOT EXISTS (
         SELECT 1 FROM friendship_attempts fa
          WHERE fa.contact_id = c.id
            AND fa.zalo_account_id = ${zaloAccountId}
       )
       AND NOT EXISTS (
         SELECT 1 FROM friendship_attempts fa2
          WHERE fa2.contact_id = c.id
            AND fa2.state = 'accepted'
       )
     ORDER BY random()
     LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Try to find the contact on Zalo and send a friend request.
 * Persists discovery state on Contact and a FriendshipAttempt row.
 */
export async function attemptFriendRequest(args: {
  orgId: string;
  zaloAccountId: string;
  contactId: string;
  phone: string;
  message: string;
}): Promise<{ attemptId: string } & AttemptOutcome> {
  const { orgId, zaloAccountId, contactId, phone, message } = args;

  // Create attempt row first so we always have an audit trail, even on crash.
  // unique(zalo_account_id, contact_id) — if a row already exists this throws P2002.
  const attempt = await prisma.friendshipAttempt.create({
    data: {
      orgId,
      zaloAccountId,
      contactId,
      state: 'looking_up',
      requestMsg: message,
    },
  });

  // ── 1. findUser → discovery ─────────────────────────────────────────────
  let zaloUid: string | null = null;
  try {
    const user = await zaloOps.findUser(zaloAccountId, phone);
    // zca-js returns UserBasic on success; for unknown phone Zalo returns
    // error code 216 which the SDK swallows, leaving result.data undefined or {}.
    zaloUid = (user as any)?.uid ?? null;
  } catch (err: any) {
    if (err instanceof ZaloOpError && (err.code === 'NOT_CONNECTED' || err.code === 'RATE_LIMITED')) {
      // Nick problem — do NOT conclude contact has no Zalo
      await prisma.friendshipAttempt.update({
        where: { id: attempt.id },
        data: {
          state: 'error',
          errorCode: err.code,
          errorDetail: err.message,
        },
      });
      return {
        attemptId: attempt.id,
        ok: false,
        state: 'error',
        errorCode: err.code,
        errorDetail: err.message,
      };
    }
    // Treat ZaloApiError-from-findUser as "no Zalo for this phone".
    // Real network errors are rare; if they slip through, mark attempt error
    // but DO NOT touch contact.has_zalo so a retry can happen.
    const msg = String(err?.message ?? err);
    const code = String(err?.code ?? 'FIND_USER_FAILED');
    logger.warn(`[campaign] findUser failed for contact=${contactId} phone=${phone}: ${msg}`);
    await prisma.friendshipAttempt.update({
      where: { id: attempt.id },
      data: {
        state: 'error',
        errorCode: 'FIND_USER_FAILED',
        errorDetail: `${code}: ${msg}`,
        lookedUpAt: new Date(),
      },
    });
    return {
      attemptId: attempt.id,
      ok: false,
      state: 'error',
      errorCode: 'FIND_USER_FAILED',
      errorDetail: `${code}: ${msg}`,
    };
  }

  if (!zaloUid) {
    // Verified: phone has no Zalo account
    await tenantTransaction(async (tx) => {
      await tx.contact.update({
        where: { id: contactId },
        data: {
          hasZalo: false,
          zaloLookupAt: new Date(),
          zaloLookupAttempts: { increment: 1 },
        },
      });
      await tx.friendshipAttempt.update({
        where: { id: attempt.id },
        data: {
          state: 'no_zalo',
          errorCode: 'NOT_FOUND',
          lookedUpAt: new Date(),
          decidedAt: new Date(),
        },
      });
    });
    return {
      attemptId: attempt.id,
      ok: false,
      state: 'no_zalo',
      reason: 'phone_not_on_zalo',
    };
  }

  // Mark contact as discovered. Don't overwrite zaloUid if already set.
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      hasZalo: true,
      zaloLookupAt: new Date(),
      zaloLookupAttempts: { increment: 1 },
    },
  });
  await prisma.contact.updateMany({
    where: { id: contactId, zaloUid: null },
    data: { zaloUid },
  });

  // ── 2. sendFriendRequest ────────────────────────────────────────────────
  try {
    await zaloOps.sendFriendRequest(zaloAccountId, message, zaloUid);
    await prisma.friendshipAttempt.update({
      where: { id: attempt.id },
      data: {
        state: 'sent',
        zaloUidFound: zaloUid,
        lookedUpAt: new Date(),
        sentAt: new Date(),
      },
    });
    // Mirror state into Friend table so /friends "Đã gửi lời mời" tab shows it
    await markFriendRequestSent(zaloAccountId, zaloUid, contactId);
    return { attemptId: attempt.id, ok: true, state: 'sent', zaloUid };
  } catch (err: any) {
    const code = err instanceof ZaloOpError ? err.code : 'SEND_FRIEND_REQ_FAILED';
    const detail = String(err?.message ?? err);
    logger.warn(`[campaign] sendFriendRequest failed for uid=${zaloUid}: ${detail}`);
    await prisma.friendshipAttempt.update({
      where: { id: attempt.id },
      data: {
        state: 'error',
        zaloUidFound: zaloUid,
        errorCode: code,
        errorDetail: detail,
        lookedUpAt: new Date(),
      },
    });
    return {
      attemptId: attempt.id,
      ok: false,
      state: 'error',
      errorCode: code,
      errorDetail: detail,
    };
  }
}

/** Compose pick + attempt. Returns the outcome plus the picked contact's id (or null). */
export async function executeRandomFriendRequest(args: {
  orgId: string;
  zaloAccountId: string;
  message?: string;
}) {
  const message = args.message?.trim() || DEFAULT_REQUEST_MESSAGE;
  const picked = await pickRandomEligibleContact(args.orgId, args.zaloAccountId);
  if (!picked) {
    return { picked: false as const, reason: 'no_eligible_contact' };
  }
  const outcome = await attemptFriendRequest({
    orgId: args.orgId,
    zaloAccountId: args.zaloAccountId,
    contactId: picked.id,
    phone: picked.phone,
    message,
  });
  return { picked: true as const, contactId: picked.id, phone: picked.phone, ...outcome };
}
