-- Ack-loop Nhịp 1 (2026-06-25) — nhắc lại tin báo lead tới khi sale thả cảm xúc xác nhận.
-- 3 cột config per-tệp + bảng theo dõi ack/nhắc-lại. Additive + IF NOT EXISTS → an toàn prod.
ALTER TABLE "customer_lists" ADD COLUMN IF NOT EXISTS "lead_notify_ack_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_lists" ADD COLUMN IF NOT EXISTS "lead_notify_ack_interval_sec" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "customer_lists" ADD COLUMN IF NOT EXISTS "lead_notify_ack_max_attempts" INTEGER NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS "lead_notify_acks" (
  "id"                     TEXT PRIMARY KEY,
  "org_id"                 TEXT NOT NULL,
  "customer_list_id"       TEXT NOT NULL,
  "entry_id"               TEXT NOT NULL,
  "contact_id"             TEXT NOT NULL,
  "target_user_id"         TEXT NOT NULL,
  "target_zalo_uid"        TEXT,
  "sender_zalo_account_id" TEXT,
  "zalo_msg_id"            TEXT,
  "group_zalo_msg_id"      TEXT,
  "conversation_id"        TEXT,
  "acked"                  BOOLEAN NOT NULL DEFAULT false,
  "acked_at"               TIMESTAMP(3),
  "ack_emoji"              TEXT,
  "attempts"               INTEGER NOT NULL DEFAULT 0,
  "max_attempts"           INTEGER NOT NULL DEFAULT 10,
  "interval_sec"           INTEGER NOT NULL DEFAULT 60,
  "last_sent_at"           TIMESTAMP(3),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_notify_acks_entry_id_target_user_id_key" ON "lead_notify_acks" ("entry_id", "target_user_id");
CREATE INDEX IF NOT EXISTS "lead_notify_acks_zalo_msg_id_idx" ON "lead_notify_acks" ("zalo_msg_id");
CREATE INDEX IF NOT EXISTS "lead_notify_acks_group_zalo_msg_id_idx" ON "lead_notify_acks" ("group_zalo_msg_id");
CREATE INDEX IF NOT EXISTS "lead_notify_acks_org_id_acked_idx" ON "lead_notify_acks" ("org_id", "acked");
