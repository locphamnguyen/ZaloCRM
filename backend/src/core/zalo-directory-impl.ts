/**
 * zalo-directory-impl.ts — core impl của capability 'zalo.directory'.
 *
 * Bọc zaloOps.findUser (SDK) thành contract ổn định + normalize response lộn xộn
 * (uid|userId, zaloName|zalo_name…) thành ZaloUserLookup. Plugin tra UID Zalo theo
 * SĐT qua 1 nick mà KHÔNG đụng internal zaloOps/zaloPool.
 */
import { zaloOps } from '../shared/zalo-operations.js';
import type { ZaloDirectoryCapability, ZaloUserLookup } from '../plugin-api/index.js';

export const zaloDirectoryImpl: ZaloDirectoryCapability = {
  async findUser(accountId: string, phone: string): Promise<ZaloUserLookup | null> {
    let res: Record<string, unknown> | null = null;
    try {
      res = (await zaloOps.findUser(accountId, phone)) as Record<string, unknown> | null;
    } catch {
      return null;
    }
    if (!res) return null;
    const u = res as Record<string, unknown>;
    const uid = String((u.uid as string) || (u.userId as string) || '') || null;
    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
    return {
      uid,
      zaloName:
        (u.zaloName as string) || (u.zalo_name as string) || (u.displayName as string) ||
        (u.display_name as string) || null,
      username: (u.username as string) || null,
      avatar: (u.avatar as string) || null,
      globalId: (u.globalId as string) || null,
      gender: num(u.gender),
      dob: (u.dob as string | number) ?? (u.birthday as string | number) ?? null,
      bio: (u.status as string) || (u.aboutMe as string) || (u.bio as string) || null,
      bizPkg: (u.bizPkg as unknown) || (u.business as unknown) || null,
      accountStatus: num(u.accountStatus) ?? num(u.status),
      isFriend: bool(u.isFr) ?? bool(u.is_fr),
    };
  },
};
