-- 2026-05-29 Phase Lead Pool v2.I — Self-reclaim lock.
-- Sale trả lead → sale đó KHÔNG được nhận lại lead trả đó trong N ngày.
-- Sale KHÁC vẫn xin được ngay (workflow chia lead bình thường).
-- Default 7 ngày — đủ lâu để chống spam loop, không quá strict.
ALTER TABLE "lead_pool_configs"
  ADD COLUMN "self_reclaim_lock_days" INTEGER NOT NULL DEFAULT 7;
