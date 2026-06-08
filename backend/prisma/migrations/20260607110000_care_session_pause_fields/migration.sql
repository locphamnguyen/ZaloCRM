-- CareSession 2026-06-07: hiển thị pause cho sale ở trang Phiên chăm sóc.
ALTER TABLE "care_sessions" ADD COLUMN "last_reply_at" TIMESTAMP(3);
ALTER TABLE "care_sessions" ADD COLUMN "paused_until" TIMESTAMP(3);
