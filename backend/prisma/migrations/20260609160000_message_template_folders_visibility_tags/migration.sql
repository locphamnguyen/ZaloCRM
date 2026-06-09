-- Mẫu tin nhắn 2026-06-09 (Anh chốt): nâng cấp đồng bộ Khối.
-- Thêm MessageTemplateFolder + folder/visibility/tagIds/contentRich/tracking/archivedAt/createdById vào MessageTemplate.
-- Cơ chế quyền gộp 'block' + "là chủ HOẶC có grant". Mặc định visibility='private' (an toàn cho mẫu mới).
-- Idempotent (IF NOT EXISTS) vì DB lệch lịch sử migration (drift) — an toàn re-run.

-- ── MessageTemplateFolder (copy y BlockFolder) ──
CREATE TABLE IF NOT EXISTS "message_template_folders" (
  "id"            TEXT NOT NULL,
  "org_id"        TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "visibility"    TEXT NOT NULL DEFAULT 'public',
  "parent_id"     TEXT,
  "owner_user_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_template_folders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "message_template_folders_org_id_visibility_idx" ON "message_template_folders" ("org_id", "visibility");
CREATE INDEX IF NOT EXISTS "message_template_folders_org_id_owner_user_id_idx" ON "message_template_folders" ("org_id", "owner_user_id");
CREATE INDEX IF NOT EXISTS "message_template_folders_parent_id_idx" ON "message_template_folders" ("parent_id");

-- FK (drop-then-add an toàn re-run)
DO $$ BEGIN
  ALTER TABLE "message_template_folders" ADD CONSTRAINT "message_template_folders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "message_template_folders" ADD CONSTRAINT "message_template_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "message_template_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "message_template_folders" ADD CONSTRAINT "message_template_folders_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "message_template_folders" ADD CONSTRAINT "message_template_folders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── MessageTemplate: thêm cột mới ──
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "folder_id"          TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "visibility"         TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "content_rich"       JSONB;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "tag_ids"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "usage_count"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "last_used_at"       TIMESTAMP(3);
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "manual_send_count"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "last_manual_sent_at" TIMESTAMP(3);
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "archived_at"        TIMESTAMP(3);
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "created_by_id"      TEXT;

-- Backfill: mẫu cũ ownerUserId != null → 'private' (giữ chủ); ownerUserId IS NULL (team cũ) → 'public'.
UPDATE "message_templates" SET "visibility" = 'public'  WHERE "owner_user_id" IS NULL;
UPDATE "message_templates" SET "visibility" = 'private' WHERE "owner_user_id" IS NOT NULL;
-- Mẫu cũ có chủ → set created_by_id = owner_user_id để mô hình "là chủ" hoạt động.
UPDATE "message_templates" SET "created_by_id" = "owner_user_id" WHERE "created_by_id" IS NULL AND "owner_user_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "message_templates_org_id_folder_id_idx"  ON "message_templates" ("org_id", "folder_id");
CREATE INDEX IF NOT EXISTS "message_templates_org_id_visibility_idx" ON "message_templates" ("org_id", "visibility");
CREATE INDEX IF NOT EXISTS "message_templates_org_id_archived_at_idx" ON "message_templates" ("org_id", "archived_at");
CREATE INDEX IF NOT EXISTS "message_templates_tag_ids_idx" ON "message_templates" USING GIN ("tag_ids");

DO $$ BEGIN
  ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "message_template_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
