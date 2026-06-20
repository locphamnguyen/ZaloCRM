-- 2026-06-20 (#3) — Đếm số lần ĐÃ GỬI kết bạn cho mỗi SĐT (Contact, mức Cha).
-- Additive, an toàn: 2 cột mới default 0/null + 1 index → KH cũ KHÔNG đổi behavior.
-- friend_invite_sent_count: +1 mỗi lần worker GỬI MỚI lời mời kết bạn THÀNH CÔNG
--   (KHÔNG tính nhánh "đã là bạn" — vì không gửi lời mời nào).
-- friend_invite_last_sent_at: thời điểm gửi gần nhất.
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "friend_invite_sent_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "friend_invite_last_sent_at" TIMESTAMP(3);

-- Lọc "SĐT đã gửi kết bạn ≥ N" nhanh.
CREATE INDEX IF NOT EXISTS "contacts_org_id_friend_invite_sent_count_idx"
  ON "contacts" ("org_id", "friend_invite_sent_count");
