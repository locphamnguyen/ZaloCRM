-- RBAC follow-up (2026-05-22): backfill 2 partial unique index cho leader/deputy.
-- Migration gốc 20260521020000 định nghĩa 2 index này nhưng bị drift / không apply.
-- Hệ quả: 2 UI (Sơ đồ tổ chức + Chi tiết NV) cho phép gán 2 trưởng/2 phó cùng dept.
--
-- IDEMPOTENT: dùng IF NOT EXISTS. Trước khi tạo, duplicate đã được resolve manually
-- (HS HOLDING: keep Phạm Chí Thành leader, demote test-ceo xuống member).

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_one_leader_per_dept"
  ON "department_members"("department_id")
  WHERE "dept_role" = 'leader';

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_one_deputy_per_dept"
  ON "department_members"("department_id")
  WHERE "dept_role" = 'deputy';
