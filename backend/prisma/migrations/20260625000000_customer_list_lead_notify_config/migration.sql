-- Lead-notify Nhịp 1 (2026-06-24) — cấu hình "tự giao sale + báo lead mới" PER-TỆP.
-- 3 cột additive trên customer_lists:
--   lead_notify_enabled: bật/tắt luồng cho từng tệp. Mặc định FALSE → lead vào tệp
--     chưa bật KHÔNG bị tự giao/báo (an toàn: không đổi hành vi tới khi admin bật).
--   notify_group_thread_id: group UID nhóm Zalo nhận lead (góc nick gửi hệ thống).
--     NULL = không gửi nhóm.
--   notify_individual: có gửi tin Zalo cá nhân cho sale được giao không (mặc định TRUE).
-- Additive + DEFAULT + IF NOT EXISTS → an toàn áp prod đang chạy (Postgres fill default nhanh).
ALTER TABLE "customer_lists" ADD COLUMN IF NOT EXISTS "lead_notify_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_lists" ADD COLUMN IF NOT EXISTS "notify_group_thread_id" TEXT;
ALTER TABLE "customer_lists" ADD COLUMN IF NOT EXISTS "notify_individual" BOOLEAN NOT NULL DEFAULT true;
