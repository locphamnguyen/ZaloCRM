-- Mục tiêu — Tin chào khi khách chấp nhận kết bạn (Community extension vòng 6)
-- Additive: chỉ thêm cột/index mới, an toàn dữ liệu.

ALTER TABLE "target_jobs"
    ADD COLUMN "welcome_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "welcome_msg" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "welcome_block_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "welcomed_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "welcome_failed_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "last_welcome_at" TIMESTAMP(3);

ALTER TABLE "target_run_items"
    ADD COLUMN "contact_id" TEXT,
    ADD COLUMN "welcome_status" TEXT,
    ADD COLUMN "welcome_sent_at" TIMESTAMP(3),
    ADD COLUMN "welcome_error" TEXT;

CREATE INDEX "target_run_items_job_id_welcome_status_idx" ON "target_run_items"("job_id", "welcome_status");
