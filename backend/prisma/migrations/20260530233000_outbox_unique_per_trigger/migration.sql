-- Fix 2026-05-30 23:30 — Outbox composite unique mở rộng kèm triggerId
-- Trước đây: 1 KH chỉ có 1 outbox FRIEND_REQUEST + 1 WELCOME_PROBE duy nhất → re-test
-- cùng KH trên trigger mới bị chặn → Phase 2 bám đuổi không enroll cho trigger mới.
-- Sau fix: mỗi (entry, kind, trigger) có 1 outbox → trigger mới luôn có workflow riêng.

BEGIN;

-- Drop old unique constraint
ALTER TABLE friend_request_outbox
  DROP CONSTRAINT IF EXISTS friend_request_outbox_customer_list_entry_id_kind_key;

-- Add new composite unique with triggerId
ALTER TABLE friend_request_outbox
  ADD CONSTRAINT friend_request_outbox_customer_list_entry_id_kind_trigger_key
  UNIQUE (customer_list_entry_id, kind, trigger_id);

COMMIT;
