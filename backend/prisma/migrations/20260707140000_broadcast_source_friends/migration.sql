-- Broadcast — thêm nguồn 'friends' (bạn bè đã kết bạn của nick) (Community vòng 7)
-- Additive: thêm cột source_type, nới customer_list_id thành nullable.

ALTER TABLE "broadcast_jobs"
    ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'customer_list',
    ALTER COLUMN "customer_list_id" DROP NOT NULL;
