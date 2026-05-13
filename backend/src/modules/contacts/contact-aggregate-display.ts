/**
 * contact-aggregate-display.ts — On-demand aggregation cho KH Cha.
 *
 * Model B: mỗi Friend row = 1 "KH Con" (per nick CRM chăm).
 *   displayStatus    = status có order CAO NHẤT trong friends (fallback Contact.statusRef)
 *   displayLeadScore = AVG(friends.leadScore) — fallback Contact.leadScore khi 0 friend
 *   displayHasZalo   = friends.length > 0 ? true : Contact.hasZalo (giữ giá trị cũ)
 */

interface StatusLite {
  id: string;
  name: string;
  order: number;
  color: string | null;
  isTerminal: boolean;
}

interface FriendLite {
  id: string;
  leadScore: number;
  statusRef?: StatusLite | null;
}

interface ContactWithFriends {
  statusRef?: StatusLite | null;
  leadScore: number;
  hasZalo: boolean | null;
  friends?: FriendLite[];
}

export interface AggregateDisplay {
  displayStatus: StatusLite | null;
  displayLeadScore: number;
  displayHasZalo: boolean | null;
  childrenCount: number; // = friends.length (per-pair = "con")
}

export function computeAggregateDisplay<T extends ContactWithFriends>(contact: T): AggregateDisplay {
  const friends = contact.friends ?? [];

  // Status cao nhất theo order — ưu tiên friends; fallback Contact.statusRef khi 0 friend.
  const friendStatuses = friends
    .map((f) => f.statusRef)
    .filter((s): s is StatusLite => s != null)
    .sort((a, b) => b.order - a.order);
  const displayStatus = friendStatuses[0] ?? contact.statusRef ?? null;

  // AVG leadScore của friends; fallback Contact.leadScore khi 0 friend.
  const displayLeadScore = friends.length > 0
    ? Math.round((friends.reduce((s, f) => s + (f.leadScore ?? 0), 0) / friends.length) * 10) / 10
    : (contact.leadScore ?? 0);

  // hasZalo: any friend tồn tại → KH có Zalo. Else giữ Contact.hasZalo.
  const displayHasZalo = friends.length > 0 ? true : contact.hasZalo;

  return {
    displayStatus,
    displayLeadScore,
    displayHasZalo,
    childrenCount: friends.length,
  };
}

/** Standard include shape cho Prisma query để feed computeAggregateDisplay.
 *  Friends include statusRef per-pair + zaloAccount (cho UI hiển thị nick CRM). */
export const AGGREGATE_INCLUDE = {
  statusRef: { select: { id: true, name: true, order: true, color: true, isTerminal: true } },
  friends: {
    select: {
      id: true,
      zaloAccountId: true,
      zaloUidInNick: true,
      relationshipKind: true,
      friendshipStatus: true,
      hasConversation: true,
      aliasInNick: true,
      zaloLabels: true,
      becameFriendAt: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      totalInbound: true,
      totalOutbound: true,
      leadScore: true,
      statusId: true,
      statusRef: { select: { id: true, name: true, order: true, color: true, isTerminal: true } },
      zaloAccount: {
        select: {
          id: true,
          displayName: true,
          phone: true,
          zaloUid: true,
          avatarUrl: true,
          owner: { select: { id: true, fullName: true } },
        },
      },
    },
    orderBy: { lastInboundAt: { sort: 'desc', nulls: 'last' } },
  },
} as const;
