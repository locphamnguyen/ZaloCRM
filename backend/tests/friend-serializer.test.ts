/**
 * friend-serializer.test.ts — Snapshot lock cho canonical Friend include shape.
 * Mục đích: regression test khi ai đổi FRIEND_INCLUDE/FRIEND_INCLUDE_WITH_CONTACT
 * phải explicit update test → buộc review tác động cross-endpoint.
 */
import { describe, it, expect } from 'vitest';
import {
  FRIEND_INCLUDE,
  FRIEND_INCLUDE_WITH_CONTACT,
  STATUS_LITE_SELECT,
  ZALO_ACCOUNT_LITE_SELECT,
  CONTACT_LITE_SELECT,
  toFriendDto,
  buildFriendUpdatedPayload,
} from '../src/shared/friend-serializer.js';

describe('FRIEND_INCLUDE shape', () => {
  it('includes statusRef and zaloAccount relations', () => {
    expect(FRIEND_INCLUDE).toHaveProperty('statusRef');
    expect(FRIEND_INCLUDE).toHaveProperty('zaloAccount');
    // No contact relation (KH Cha là parent của query khi dùng include này)
    expect(FRIEND_INCLUDE).not.toHaveProperty('contact');
  });

  it('FRIEND_INCLUDE_WITH_CONTACT extends with contact relation', () => {
    expect(FRIEND_INCLUDE_WITH_CONTACT).toHaveProperty('statusRef');
    expect(FRIEND_INCLUDE_WITH_CONTACT).toHaveProperty('zaloAccount');
    expect(FRIEND_INCLUDE_WITH_CONTACT).toHaveProperty('contact');
  });

  it('STATUS_LITE_SELECT carries 5 fields needed for status chip UI', () => {
    expect(Object.keys(STATUS_LITE_SELECT).sort()).toEqual(
      ['color', 'id', 'isTerminal', 'name', 'order'].sort(),
    );
  });

  it('ZALO_ACCOUNT_LITE_SELECT includes owner nested select', () => {
    expect(ZALO_ACCOUNT_LITE_SELECT).toHaveProperty('owner');
    expect(ZALO_ACCOUNT_LITE_SELECT.owner).toEqual({
      select: { id: true, fullName: true },
    });
  });

  it('CONTACT_LITE_SELECT exposes fullName + phone (used as cell display in /friends-db)', () => {
    expect(CONTACT_LITE_SELECT).toHaveProperty('fullName');
    expect(CONTACT_LITE_SELECT).toHaveProperty('phone');
    expect(CONTACT_LITE_SELECT).toHaveProperty('tags');
  });
});

describe('toFriendDto', () => {
  it('identity passthrough — same reference returned', () => {
    const row = { id: 'f1', zaloUidInNick: 'uid1' } as any;
    const out = toFriendDto(row);
    expect(out).toBe(row);
  });
});

describe('buildFriendUpdatedPayload', () => {
  it('builds standard socket payload shape', () => {
    const payload = buildFriendUpdatedPayload({
      friendId: 'f1',
      contactId: 'c1',
      zaloAccountId: 'za1',
      patch: { zaloDisplayName: 'KH An Updated' },
    });
    expect(payload).toEqual({
      friendId: 'f1',
      contactId: 'c1',
      zaloAccountId: 'za1',
      patch: { zaloDisplayName: 'KH An Updated' },
    });
  });

  it('preserves empty patch (caller decides whether to emit)', () => {
    const payload = buildFriendUpdatedPayload({
      friendId: 'f1',
      contactId: 'c1',
      zaloAccountId: 'za1',
      patch: {},
    });
    expect(payload.patch).toEqual({});
  });
});
