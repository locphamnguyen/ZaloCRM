-- P2 2026-06-02 — RATE_LIMITED escalation cap.
--
-- Bối cảnh: nick-worker khi gặp RATE_LIMITED/NOT_CONNECTED/timeout chỉ release
-- entry về 'queued_for_pickup' KHÔNG append failed_nick_ids → cùng 1 entry
-- có thể được claim lại bởi CHÍNH nick đó (hoặc nick khác cũng đang rate-limit
-- cùng lúc) → retry vô hạn, lãng phí Phase 1+2.
--
-- Fix: thêm rate_limit_count đếm số lần soft-fail per-entry. Khi >= 3 lần,
-- escalate sang hard fail (releaseEntryFailed → append failed_nick_ids).
--
-- Tách khỏi stuck_recovery_count vì cap khác nhau (3 vs 10), semantic khác
-- (rate-limit vs worker stuck >5 phút), và stuck-sweeper KHÔNG reset count
-- → trộn lẫn 2 counter sẽ làm rate-limit cap trigger sớm khi entry vốn chỉ
-- bị stuck mạng/Redis.

ALTER TABLE "customer_list_entries"
  ADD COLUMN "rate_limit_count" INTEGER NOT NULL DEFAULT 0;
