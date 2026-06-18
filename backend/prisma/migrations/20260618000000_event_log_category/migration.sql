-- Observability "vì sao không gửi" 2026-06-18: cột phân loại blocker + index lọc nhanh.
-- An toàn/backward-compat: cột NULL cho event cũ, không backfill.

-- AddColumn
ALTER TABLE "automation_event_log" ADD COLUMN "category" TEXT;

-- CreateIndex (lọc theo lý do trong 1 trigger: triggerId + category + createdAt desc)
CREATE INDEX "idx_event_log_trigger_category_time" ON "automation_event_log"("trigger_id", "category", "created_at" DESC);
