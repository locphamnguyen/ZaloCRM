-- Màn Quản lý nick Zalo redesign 2026-06-09. Idempotent.
-- 1) Xóa mềm nick: archivedAt
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "zalo_accounts_org_id_archived_at_idx" ON "zalo_accounts" ("org_id", "archived_at");
-- 2) Tách Bot/User cho kết bạn: source trên FriendshipAttempt
ALTER TABLE "friendship_attempts" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'automation';
