-- Phase 1 zca-js/ZaloCRM handoff support.
-- Keep existing Contact.status/Status pipeline intact; add canonical phase-1 stage
-- plus durable event, notification, and stage-history tables.

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "current_stage" TEXT NOT NULL DEFAULT 'new_lead';

ALTER TABLE "zalo_accounts"
  ADD COLUMN IF NOT EXISTS "external_account_id" TEXT;

-- Backfill existing accounts with their current internal id as an external alias.
-- This preserves any pre-existing bridge data while new zca-js syncs use scoped aliases.
UPDATE "zalo_accounts"
SET "external_account_id" = "id"
WHERE "external_account_id" IS NULL;

CREATE TABLE IF NOT EXISTS "conversation_events" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "external_account_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "message_id" TEXT,
  "contact_id" TEXT,
  "thread_id" TEXT NOT NULL,
  "thread_type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "message_text" TEXT,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "campaign_id" TEXT,
  "source_id" TEXT,
  "template_id" TEXT,
  "script_id" TEXT,
  "zalo_crm_thread_url" TEXT,
  "raw" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "message" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'sent',
  "event_id" TEXT,
  "owner_user_id" TEXT,
  "account_id" TEXT,
  "conversation_id" TEXT,
  "message_id" TEXT,
  "contact_id" TEXT,
  "thread_id" TEXT,
  "read_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_stage_history" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "old_stage" TEXT,
  "new_stage" TEXT NOT NULL,
  "reason" TEXT,
  "operator" TEXT,
  "operator_user_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_stage_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "conversation_events"
  ADD COLUMN IF NOT EXISTS "external_account_id" TEXT;

UPDATE "conversation_events" ce
SET "external_account_id" = za."external_account_id"
FROM "zalo_accounts" za
WHERE ce."account_id" = za."id"
  AND ce."external_account_id" IS NULL;

ALTER TABLE "conversation_events"
  ALTER COLUMN "external_account_id" SET NOT NULL;

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "event_id" TEXT;

UPDATE "notifications"
SET "event_id" = "metadata"->>'event_id'
WHERE "event_id" IS NULL
  AND "metadata" ? 'event_id';

DROP INDEX IF EXISTS "conversation_events_event_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "zalo_accounts_org_id_external_account_id_key"
  ON "zalo_accounts"("org_id", "external_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_events_org_id_event_id_key"
  ON "conversation_events"("org_id", "event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_events_message_id_key"
  ON "conversation_events"("message_id");
CREATE INDEX IF NOT EXISTS "conversation_events_org_id_occurred_at_idx"
  ON "conversation_events"("org_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "conversation_events_account_id_thread_id_occurred_at_idx"
  ON "conversation_events"("account_id", "thread_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "conversation_events_org_id_external_account_id_thread_id_occurred_at_idx"
  ON "conversation_events"("org_id", "external_account_id", "thread_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "conversation_events_conversation_id_occurred_at_idx"
  ON "conversation_events"("conversation_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "conversation_events_contact_id_occurred_at_idx"
  ON "conversation_events"("contact_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "conversation_events_campaign_id_idx"
  ON "conversation_events"("campaign_id");
CREATE INDEX IF NOT EXISTS "conversation_events_source_id_idx"
  ON "conversation_events"("source_id");

CREATE INDEX IF NOT EXISTS "notifications_org_id_status_created_at_idx"
  ON "notifications"("org_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_org_id_type_created_at_idx"
  ON "notifications"("org_id", "type", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_owner_user_id_status_created_at_idx"
  ON "notifications"("owner_user_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_conversation_id_idx"
  ON "notifications"("conversation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_org_id_event_id_key"
  ON "notifications"("org_id", "event_id");

CREATE INDEX IF NOT EXISTS "customer_stage_history_org_id_contact_id_created_at_idx"
  ON "customer_stage_history"("org_id", "contact_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_stage_history_org_id_new_stage_created_at_idx"
  ON "customer_stage_history"("org_id", "new_stage", "created_at");
CREATE INDEX IF NOT EXISTS "contacts_org_id_current_stage_last_activity_idx"
  ON "contacts"("org_id", "current_stage", "last_activity");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_events_org_id_fkey') THEN
    ALTER TABLE "conversation_events"
      ADD CONSTRAINT "conversation_events_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_events_account_id_fkey') THEN
    ALTER TABLE "conversation_events"
      ADD CONSTRAINT "conversation_events_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "zalo_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_events_conversation_id_fkey') THEN
    ALTER TABLE "conversation_events"
      ADD CONSTRAINT "conversation_events_conversation_id_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_events_message_id_fkey') THEN
    ALTER TABLE "conversation_events"
      ADD CONSTRAINT "conversation_events_message_id_fkey"
      FOREIGN KEY ("message_id") REFERENCES "messages"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_events_contact_id_fkey') THEN
    ALTER TABLE "conversation_events"
      ADD CONSTRAINT "conversation_events_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_org_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_owner_user_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_account_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "zalo_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_conversation_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_conversation_id_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_message_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_message_id_fkey"
      FOREIGN KEY ("message_id") REFERENCES "messages"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_contact_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_stage_history_org_id_fkey') THEN
    ALTER TABLE "customer_stage_history"
      ADD CONSTRAINT "customer_stage_history_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_stage_history_contact_id_fkey') THEN
    ALTER TABLE "customer_stage_history"
      ADD CONSTRAINT "customer_stage_history_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_stage_history_operator_user_id_fkey') THEN
    ALTER TABLE "customer_stage_history"
      ADD CONSTRAINT "customer_stage_history_operator_user_id_fkey"
      FOREIGN KEY ("operator_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
