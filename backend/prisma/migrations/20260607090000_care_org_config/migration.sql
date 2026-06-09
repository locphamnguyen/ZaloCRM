-- CareSession 2026-06-07: cấu hình lắng nghe CHUNG cấp tổ chức (anh chốt).
ALTER TABLE "organizations" ADD COLUMN "care_notify_channels" JSONB;
ALTER TABLE "organizations" ADD COLUMN "care_close_conditions" JSONB;
