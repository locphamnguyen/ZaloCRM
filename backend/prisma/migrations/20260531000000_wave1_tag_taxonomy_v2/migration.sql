-- Wave 1 — Tag Taxonomy v2 schema additive
-- /plan-eng-review M57 2026-05-31 (Issue 1A + 2A + 9A)
-- Big-Bang Refactor Slim — GIỮ NGUYÊN legacy cols (Contact.tags, Friend.*, CrmTag.*, CrmTagGroup.*).
-- Drop legacy ở Wave 5.

-- ═══════════════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TYPE "TagScope" AS ENUM ('friend', 'crm');

CREATE TYPE "TagSource" AS ENUM (
  'zalo_real',
  'manual_per_nick',
  'auto_detect',
  'auto_score',
  'auto_engagement',
  'manual_crm',
  'ai_suggest',
  'segment_rule',
  'status',
  'import'
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE "tag_groups" (
  "id"         TEXT NOT NULL,
  "org_id"     TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "scope"      "TagScope" NOT NULL,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tag_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tags" (
  "id"          TEXT NOT NULL,
  "org_id"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "color"       TEXT NOT NULL DEFAULT '#90A4AE',
  "emoji"       TEXT,
  "description" TEXT,
  "scope"       "TagScope" NOT NULL,
  "source"      "TagSource" NOT NULL,
  "priority"    INTEGER NOT NULL DEFAULT 99,
  "group_id"    TEXT,
  "zalo_account_id"       TEXT,
  "source_zalo_label_id"  INTEGER,
  "auto_rule"   TEXT,
  "archived_at" TIMESTAMP(3),
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "friend_tags" (
  "id"         TEXT NOT NULL,
  "friend_id"  TEXT NOT NULL,
  "tag_id"     TEXT NOT NULL,
  "added_by"   TEXT,
  "added_via"  "TagSource" NOT NULL,
  "added_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMP(3),
  "removed_by" TEXT,

  CONSTRAINT "friend_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_tags" (
  "id"         TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "tag_id"     TEXT NOT NULL,
  "added_by"   TEXT,
  "added_via"  "TagSource" NOT NULL,
  "added_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMP(3),
  "removed_by" TEXT,

  CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("id")
);

-- ═══════════════════════════════════════════════════════════════════════
-- CHECK constraint — Issue 1A: enforce scope+source invariant ở DB layer
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "tags" ADD CONSTRAINT "tags_scope_source_valid" CHECK (
  (scope = 'friend' AND source IN ('zalo_real', 'manual_per_nick', 'auto_detect', 'auto_score', 'auto_engagement'))
  OR
  (scope = 'crm' AND source IN ('manual_crm', 'ai_suggest', 'segment_rule', 'status', 'import'))
);

-- ═══════════════════════════════════════════════════════════════════════
-- Partial unique indexes — Issue 2A: zalo_account_id NULL vs NOT NULL tách biệt
-- ═══════════════════════════════════════════════════════════════════════

-- Tag manual_crm + manual_per_nick + auto_* có zalo_account_id=NULL → 1 row per (org, scope, slug)
CREATE UNIQUE INDEX "tags_org_scope_slug_uniq" ON "tags"("org_id", "scope", "slug")
  WHERE "zalo_account_id" IS NULL;

-- Tag zalo_real có zalo_account_id NOT NULL → unique theo (org, account, labelId)
CREATE UNIQUE INDEX "tags_org_account_label_uniq" ON "tags"("org_id", "zalo_account_id", "source_zalo_label_id")
  WHERE "zalo_account_id" IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- Standard indexes
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX "tags_org_id_scope_idx" ON "tags"("org_id", "scope");
CREATE INDEX "tags_org_id_group_id_idx" ON "tags"("org_id", "group_id");
CREATE INDEX "tags_archived_at_idx" ON "tags"("archived_at");

CREATE UNIQUE INDEX "tag_groups_org_id_scope_name_key" ON "tag_groups"("org_id", "scope", "name");
CREATE INDEX "tag_groups_org_id_scope_idx" ON "tag_groups"("org_id", "scope");

CREATE UNIQUE INDEX "friend_tags_friend_id_tag_id_key" ON "friend_tags"("friend_id", "tag_id");
CREATE INDEX "friend_tags_friend_id_removed_at_idx" ON "friend_tags"("friend_id", "removed_at");
CREATE INDEX "friend_tags_tag_id_removed_at_idx" ON "friend_tags"("tag_id", "removed_at");

CREATE UNIQUE INDEX "contact_tags_contact_id_tag_id_key" ON "contact_tags"("contact_id", "tag_id");
CREATE INDEX "contact_tags_contact_id_removed_at_idx" ON "contact_tags"("contact_id", "removed_at");
CREATE INDEX "contact_tags_tag_id_removed_at_idx" ON "contact_tags"("tag_id", "removed_at");

-- ═══════════════════════════════════════════════════════════════════════
-- Perf indexes Wave 1 — Issue 9A: derived query Stuck Dashboard + Contact.autoTags JOIN
-- Partial WHERE removed_at IS NULL / archived_at IS NULL — nhỏ + nhanh
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX "idx_friend_tags_friend_active" ON "friend_tags"("friend_id")
  WHERE "removed_at" IS NULL;

CREATE INDEX "idx_friend_tags_tag_active" ON "friend_tags"("tag_id")
  WHERE "removed_at" IS NULL;

CREATE INDEX "idx_tags_slug_source_active" ON "tags"("slug", "source")
  WHERE "archived_at" IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "tags" ADD CONSTRAINT "tags_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tags" ADD CONSTRAINT "tags_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "tag_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tag_groups" ADD CONSTRAINT "tag_groups_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friend_tags" ADD CONSTRAINT "friend_tags_friend_id_fkey"
  FOREIGN KEY ("friend_id") REFERENCES "friends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friend_tags" ADD CONSTRAINT "friend_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
