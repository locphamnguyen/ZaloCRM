-- P6 (E3/C4) — chống gửi trùng ở tầng DB cho Broadcast: unique(run_id, entry_id).
-- Nền tảng cho P4 (claim-before-send) + chặn race 2 instance.
-- Additive: đổi index thường → unique index, không DROP COLUMN, không mất dữ liệu nghiệp vụ.
--
-- Dedupe PHÒNG VỆ trước khi tạo unique: nếu (do bug cũ) đã có dòng log trùng
-- (run_id, entry_id), chỉ giữ dòng sớm nhất, xoá dòng trùng còn lại. Chỉ chạm đúng
-- các dòng log TRÙNG LẶP (thứ đang muốn chặn) — bản ghi hợp lệ giữ nguyên. DELETE 0
-- dòng nếu không có trùng (an toàn với DB sạch).
DELETE FROM "broadcast_run_items" a
 USING "broadcast_run_items" b
 WHERE a."run_id" = b."run_id"
   AND a."entry_id" = b."entry_id"
   AND (a."created_at" > b."created_at"
        OR (a."created_at" = b."created_at" AND a."id" > b."id"));

DROP INDEX IF EXISTS "broadcast_run_items_run_id_entry_id_idx";

CREATE UNIQUE INDEX "broadcast_run_items_run_id_entry_id_key"
    ON "broadcast_run_items"("run_id", "entry_id");
