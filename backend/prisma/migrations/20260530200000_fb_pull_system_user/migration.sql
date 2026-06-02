-- Phase FB Pull 2026-05-30 — System User token (chính chủ, không App Review) + form registry
-- Kéo lead chủ động từ leadgen form qua System User token (vĩnh viễn, leads_retrieval).

-- ============================================================================
-- AlterTable organizations — lưu System User token cấp Org + toggle pull
-- ============================================================================
ALTER TABLE "organizations"
  ADD COLUMN "encrypted_fb_system_user_token" TEXT,
  ADD COLUMN "fb_pull_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fb_system_user_id" TEXT;

-- ============================================================================
-- CreateTable facebook_leadgen_forms — registry form + checkpoint incremental pull
-- ============================================================================
CREATE TABLE "facebook_leadgen_forms" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "page_id" TEXT NOT NULL,
  "form_id" TEXT NOT NULL,
  "form_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_pulled_lead_created_time" TIMESTAMP(3),
  "last_pulled_cursor" TEXT,
  "last_pull_at" TIMESTAMP(3),
  "last_pull_lead_count" INTEGER NOT NULL DEFAULT 0,
  "last_pull_error" TEXT,
  "consecutive_errors" INTEGER NOT NULL DEFAULT 0,
  "history_backfilled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "facebook_leadgen_forms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "facebook_leadgen_forms_page_id_form_id_key"
  ON "facebook_leadgen_forms"("page_id", "form_id");
CREATE INDEX "facebook_leadgen_forms_org_id_status_idx"
  ON "facebook_leadgen_forms"("org_id", "status");
CREATE INDEX "facebook_leadgen_forms_status_last_pull_at_idx"
  ON "facebook_leadgen_forms"("status", "last_pull_at");

ALTER TABLE "facebook_leadgen_forms"
  ADD CONSTRAINT "facebook_leadgen_forms_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
