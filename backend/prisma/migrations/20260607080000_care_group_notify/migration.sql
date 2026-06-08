-- CareSession 2026-06-07: UID nhóm Zalo nhận thông báo đích nhóm.
ALTER TABLE "organizations" ADD COLUMN "internal_notify_group_thread_id" TEXT;
