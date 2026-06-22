// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit test cho 3 adapter chuẩn-hoá shape SDK (hàm thuần, không DB).
import { describe, it, expect } from 'vitest';
import { fromGetUserInfo, fromGetAllFriends, fromFindUser } from './zalo-profile-capture.js';

describe('zalo-profile-capture adapters', () => {
  describe('fromGetUserInfo (shape lồng changed_profiles)', () => {
    it('gỡ đúng profile theo key uid', () => {
      const res = { changed_profiles: { '123': { zaloName: 'Bình Minh', avatar: 'http://a', globalId: 'g1', username: 'bm', gender: 1, sdob: '02/07/1990', phoneNumber: '0982707329' } } };
      const p = fromGetUserInfo(res, '123');
      expect(p).toMatchObject({ uid: '123', zaloName: 'Bình Minh', avatar: 'http://a', globalId: 'g1', username: 'bm', gender: 1, sdob: '02/07/1990', phoneNumber: '0982707329' });
    });
    it('fallback key uid+"_0"', () => {
      const res = { changed_profiles: { '123_0': { zaloName: 'A', gender: 0 } } };
      expect(fromGetUserInfo(res, '123')?.zaloName).toBe('A');
    });
    it('snake_case display_name khi không có camelCase', () => {
      const res = { changed_profiles: { '9': { display_name: 'Snake Tên' } } };
      expect(fromGetUserInfo(res, '9')?.zaloName).toBe('Snake Tên');
    });
    it('không có profile → null', () => {
      expect(fromGetUserInfo({ changed_profiles: {} }, '404')).toBeNull();
      expect(fromGetUserInfo(null, '1')).toBeNull();
    });
  });

  describe('fromGetAllFriends (mảng phẳng)', () => {
    it('userId/uid + zaloName/displayName', () => {
      expect(fromGetAllFriends({ userId: '7', zaloName: 'Z', avatar: 'av', globalId: 'g', username: 'u', gender: 0, sdob: '01/01/2000' }))
        .toMatchObject({ uid: '7', zaloName: 'Z', gender: 0, sdob: '01/01/2000' });
    });
    it('thiếu uid → null', () => {
      expect(fromGetAllFriends({ zaloName: 'x' })).toBeNull();
    });
  });

  describe('fromFindUser (phẳng, snake_case, thường không dob)', () => {
    it('ưu tiên display_name (snake_case runtime)', () => {
      const p = fromFindUser({ uid: '5', display_name: 'Findy', zalo_name: 'zz', gender: 1, avatar: 'a', globalId: 'g', username: 'un', phoneNumber: '0900' });
      expect(p).toMatchObject({ uid: '5', zaloName: 'Findy', gender: 1, avatar: 'a', globalId: 'g', username: 'un', phoneNumber: '0900' });
      expect(p?.dob).toBeNull();
      expect(p?.sdob).toBeNull();
    });
    it('thiếu uid → null', () => {
      expect(fromFindUser({ display_name: 'no-uid' })).toBeNull();
      expect(fromFindUser(null)).toBeNull();
    });
    it('trim + rỗng→null cho field text', () => {
      const p = fromFindUser({ uid: '6', display_name: '  ', avatar: '' });
      expect(p?.zaloName).toBeNull();
      expect(p?.avatar).toBeNull();
    });
  });
});
