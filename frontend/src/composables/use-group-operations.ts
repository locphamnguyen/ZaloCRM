/**
 * use-group-operations.ts — Unified composable for all group management operations.
 * Combines group CRUD, membership, invite links, and polls into one interface.
 * Delegates to use-groups and use-polls internally.
 */
import { useGroups } from './use-groups';
import { usePolls } from './use-polls';
import type { CreatePollPayload } from './use-polls';

export type { CreatePollPayload };

export function useGroupOperations() {
  const groups = useGroups();
  const polls = usePolls();

  return {
    // ── State ────────────────────────────────────────────────────────────────
    groups: groups.groups,
    selectedGroup: groups.selectedGroup,
    members: groups.members,
    blocked: groups.blocked,
    pending: groups.pending,
    loading: groups.loading,
    actionLoading: groups.actionLoading,
    polls: polls.polls,
    pollsLoading: polls.loading,

    // ── Group CRUD ───────────────────────────────────────────────────────────
    fetchGroups: groups.fetchGroups,
    fetchGroup: groups.fetchGroup,
    createGroup: groups.createGroup,
    renameGroup: groups.renameGroup,
    updateSettings: groups.updateSettings,
    leaveGroup: groups.leaveGroup,
    disperseGroup: groups.disperseGroup,

    // ── Members ──────────────────────────────────────────────────────────────
    fetchMembers: groups.fetchMembers,
    addMembers: groups.addMembers,
    removeMembers: groups.removeMembers,
    addDeputy: groups.addDeputy,
    removeDeputy: groups.removeDeputy,
    transferOwnership: groups.transferOwnership,
    blockMember: groups.blockMember,
    unblockMember: groups.unblockMember,
    fetchBlocked: groups.fetchBlocked,
    fetchPending: groups.fetchPending,

    // ── Invite Links ─────────────────────────────────────────────────────────
    getInviteLink: groups.getInviteLink,
    enableInviteLink: groups.enableInviteLink,
    disableInviteLink: groups.disableInviteLink,
    joinByLink: groups.joinByLink,

    // ── Polls ────────────────────────────────────────────────────────────────
    createPoll: polls.createPoll,
    getPollDetail: polls.getPollDetail,
    votePoll: polls.votePoll,
    lockPoll: polls.lockPoll,
    sharePoll: polls.sharePoll,
  };
}
