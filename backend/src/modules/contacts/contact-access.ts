/**
 * contact-access.ts — helper populate bảng ContactAccess (quyền sở hữu KH).
 *
 * OSS / trung tính: chỉ ghi data (primary owner + backfill). Logic enforce scope
 * (lọc list theo quyền) nằm ở plugin EE qua app.scope.resolve('contact', ...).
 *
 * role: 'primary' | 'collaborator'. source: 'manual' | <khác> (audit nguồn tạo row).
 */
import type { prisma } from '../../shared/database/prisma-client.js';

/**
 * Client hoặc tx (interactive transaction) — chỉ cần 2 model dùng ở đây.
 * Lấy kiểu từ extended client singleton để khớp cả `prisma` lẫn `tx`.
 */
type Db = Pick<typeof prisma, 'contactAccess' | 'contact'>;

export interface SetPrimaryOwnerInput {
  orgId: string;
  contactId: string;
  userId: string;
  source?: string;
}

/**
 * Đặt user làm primary owner của contact. Upsert theo unique (contactId, userId):
 * - chưa có row → tạo role='primary'
 * - đã có row (collaborator) → nâng lên 'primary'
 *
 * Giữ đơn giản (KISS): không tự demote primary cũ của user khác. Khi cần đảm bảo
 * "1 primary / contact", EE hoặc caller xử lý riêng.
 */
export async function setPrimaryOwner(
  prisma: Db,
  { orgId, contactId, userId, source = 'manual' }: SetPrimaryOwnerInput,
): Promise<void> {
  await prisma.contactAccess.upsert({
    where: { contactId_userId: { contactId, userId } },
    create: { orgId, contactId, userId, role: 'primary', source },
    update: { role: 'primary' },
  });
}

/**
 * Backfill: với mỗi Contact có assignedUserId mà CHƯA có ContactAccess primary,
 * tạo row primary tương ứng. Dùng để seed dữ liệu test / migrate dữ liệu cũ.
 *
 * @param orgId  giới hạn 1 org; bỏ trống → toàn bộ.
 * @returns số row ContactAccess được tạo.
 */
export async function backfillContactAccessFromAssigned(
  prisma: Db,
  orgId?: string,
): Promise<number> {
  const contacts = await prisma.contact.findMany({
    where: {
      assignedUserId: { not: null },
      ...(orgId ? { orgId } : {}),
      contactAccess: { none: { role: 'primary' } },
    },
    select: { id: true, orgId: true, assignedUserId: true },
  });

  let created = 0;
  for (const c of contacts) {
    if (!c.assignedUserId) continue;
    await setPrimaryOwner(prisma, {
      orgId: c.orgId,
      contactId: c.id,
      userId: c.assignedUserId,
      source: 'backfill',
    });
    created += 1;
  }
  return created;
}
