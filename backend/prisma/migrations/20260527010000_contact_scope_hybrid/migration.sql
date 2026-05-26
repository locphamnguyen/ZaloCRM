-- Phase Contact Scope Hybrid 2026-05-27
-- 1) ContactAccess table — collaborator share (primary + collaborator).
-- 2) Friend per-pair preview fields — chặn aggregate leak cross-sale.
-- 3) Backfill ContactAccess từ Contact.assignedUserId + Friend rows.

-- ── 1. ContactAccess table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "contact_access" (
  "id"         TEXT NOT NULL,
  "org_id"     TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "role"       TEXT NOT NULL DEFAULT 'collaborator',
  "source"     TEXT NOT NULL DEFAULT 'manual',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contact_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_access_contact_id_user_id_key"
  ON "contact_access" ("contact_id", "user_id");
CREATE INDEX IF NOT EXISTS "contact_access_org_id_user_id_idx"
  ON "contact_access" ("org_id", "user_id");
CREATE INDEX IF NOT EXISTS "contact_access_org_id_contact_id_idx"
  ON "contact_access" ("org_id", "contact_id");

ALTER TABLE "contact_access"
  ADD CONSTRAINT "contact_access_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_access"
  ADD CONSTRAINT "contact_access_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_access"
  ADD CONSTRAINT "contact_access_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Friend per-pair preview fields ─────────────────────────────────────
ALTER TABLE "friends"
  ADD COLUMN IF NOT EXISTS "last_inbound_preview"     TEXT,
  ADD COLUMN IF NOT EXISTS "last_inbound_type"        TEXT,
  ADD COLUMN IF NOT EXISTS "last_inbound_message_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_preview"    TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_type"       TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_message_id" TEXT;

-- ── 3. Backfill ContactAccess ─────────────────────────────────────────────
-- 3a. Primary owner từ Contact.assignedUserId (mọi contact có assignedUserId).
INSERT INTO "contact_access" ("id", "org_id", "contact_id", "user_id", "role", "source", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  c."org_id",
  c."id",
  c."assigned_user_id",
  'primary',
  'auto_from_assignment',
  NOW(),
  NOW()
FROM "contacts" c
WHERE c."assigned_user_id" IS NOT NULL
ON CONFLICT ("contact_id", "user_id") DO NOTHING;

-- 3b. Collaborator từ Friend rows (sale có nick chăm KH → collaborator nếu chưa primary).
INSERT INTO "contact_access" ("id", "org_id", "contact_id", "user_id", "role", "source", "created_at", "updated_at")
SELECT DISTINCT
  gen_random_uuid()::text,
  f."org_id",
  f."contact_id",
  za."owner_user_id",
  'collaborator',
  'auto_from_friend',
  NOW(),
  NOW()
FROM "friends" f
JOIN "zalo_accounts" za ON za."id" = f."zalo_account_id"
WHERE za."owner_user_id" IS NOT NULL
ON CONFLICT ("contact_id", "user_id") DO NOTHING;

-- 3c. Preview backfill cho Friend rows từ Message lịch sử (best-effort).
-- Cho mỗi Friend row, lấy message inbound/outbound mới nhất trong conversation
-- của (nick này × KH này) gắn vào Friend.last*Preview/Type/MessageId.
-- Skip nếu không có Conversation match (sẽ fill khi có tin mới).
WITH last_inbound AS (
  SELECT DISTINCT ON (conv."zalo_account_id", conv."contact_id")
    conv."zalo_account_id" AS za_id,
    conv."contact_id"      AS c_id,
    m."id"                 AS msg_id,
    m."content"            AS content,
    m."content_type"       AS content_type
  FROM "messages" m
  JOIN "conversations" conv ON conv."id" = m."conversation_id"
  WHERE m."sender_type" = 'contact'
    AND m."is_deleted" = false
    AND conv."contact_id" IS NOT NULL
    AND conv."threadType" = 'user'
  ORDER BY conv."zalo_account_id", conv."contact_id", m."sent_at" DESC
)
UPDATE "friends" f
   SET "last_inbound_message_id" = li.msg_id,
       "last_inbound_preview"    = LEFT(COALESCE(NULLIF(TRIM(li.content), ''), ''), 200),
       "last_inbound_type"       = li.content_type
  FROM last_inbound li
 WHERE f."zalo_account_id" = li.za_id
   AND f."contact_id"      = li.c_id
   AND f."last_inbound_message_id" IS NULL;

WITH last_outbound AS (
  SELECT DISTINCT ON (conv."zalo_account_id", conv."contact_id")
    conv."zalo_account_id" AS za_id,
    conv."contact_id"      AS c_id,
    m."id"                 AS msg_id,
    m."content"            AS content,
    m."content_type"       AS content_type
  FROM "messages" m
  JOIN "conversations" conv ON conv."id" = m."conversation_id"
  WHERE m."sender_type" = 'self'
    AND m."is_deleted" = false
    AND conv."contact_id" IS NOT NULL
    AND conv."threadType" = 'user'
  ORDER BY conv."zalo_account_id", conv."contact_id", m."sent_at" DESC
)
UPDATE "friends" f
   SET "last_outbound_message_id" = lo.msg_id,
       "last_outbound_preview"    = LEFT(COALESCE(NULLIF(TRIM(lo.content), ''), ''), 200),
       "last_outbound_type"       = lo.content_type
  FROM last_outbound lo
 WHERE f."zalo_account_id" = lo.za_id
   AND f."contact_id"      = lo.c_id
   AND f."last_outbound_message_id" IS NULL;
