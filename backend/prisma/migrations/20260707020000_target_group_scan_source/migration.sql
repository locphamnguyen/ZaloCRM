-- Mục tiêu — nguồn target từ Quét nhóm (GroupMember), Community extension 2026-07-07
-- customer_list_id giờ optional (chỉ bắt buộc khi source_type='customer_list').

ALTER TABLE "target_jobs" ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'customer_list';
ALTER TABLE "target_jobs" ADD COLUMN "group_scan_id" TEXT;
ALTER TABLE "target_jobs" ALTER COLUMN "customer_list_id" DROP NOT NULL;
