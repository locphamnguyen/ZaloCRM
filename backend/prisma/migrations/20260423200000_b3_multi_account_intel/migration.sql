-- B3 Phase 01: Group Views, CRM Tags, Contact Tag Links, Auto-Tag Rules, Zalo Tag Snapshot, Zalo Tag Sync Queue
-- Additive only — no existing tables or columns modified

-- CreateTable: zalo_group_views
CREATE TABLE IF NOT EXISTS "zalo_group_views" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_ids" TEXT[] NOT NULL DEFAULT '{}',
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zalo_group_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable: crm_tags
CREATE TABLE IF NOT EXISTS "crm_tags" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#888',
    "icon" TEXT,
    "source" TEXT NOT NULL DEFAULT 'crm',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable: contact_tag_links
CREATE TABLE IF NOT EXISTS "contact_tag_links" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'crm',
    "applied_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tag_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable: auto_tag_rules
CREATE TABLE IF NOT EXISTS "auto_tag_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "tag_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_tag_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: zalo_tag_snapshots
CREATE TABLE IF NOT EXISTS "zalo_tag_snapshots" (
    "id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "contact_zalo_uid" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "label_name" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zalo_tag_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable: zalo_tag_sync_queue
CREATE TABLE IF NOT EXISTS "zalo_tag_sync_queue" (
    "id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "contact_zalo_uid" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "zalo_tag_sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: zalo_group_views
CREATE INDEX IF NOT EXISTS "zalo_group_views_org_id_user_id_idx" ON "zalo_group_views"("org_id", "user_id");

-- CreateIndex: crm_tags
CREATE UNIQUE INDEX IF NOT EXISTS "crm_tags_org_id_name_source_key" ON "crm_tags"("org_id", "name", "source");
CREATE INDEX IF NOT EXISTS "crm_tags_org_id_source_idx" ON "crm_tags"("org_id", "source");

-- CreateIndex: contact_tag_links
CREATE UNIQUE INDEX IF NOT EXISTS "contact_tag_links_contact_id_tag_id_key" ON "contact_tag_links"("contact_id", "tag_id");
CREATE INDEX IF NOT EXISTS "contact_tag_links_contact_id_idx" ON "contact_tag_links"("contact_id");
CREATE INDEX IF NOT EXISTS "contact_tag_links_tag_id_idx" ON "contact_tag_links"("tag_id");

-- CreateIndex: auto_tag_rules
CREATE INDEX IF NOT EXISTS "auto_tag_rules_org_id_event_enabled_idx" ON "auto_tag_rules"("org_id", "event", "enabled");

-- CreateIndex: zalo_tag_snapshots
CREATE UNIQUE INDEX IF NOT EXISTS "zalo_tag_snapshots_zalo_account_id_contact_zalo_uid_label_id_key" ON "zalo_tag_snapshots"("zalo_account_id", "contact_zalo_uid", "label_id");
CREATE INDEX IF NOT EXISTS "zalo_tag_snapshots_zalo_account_id_idx" ON "zalo_tag_snapshots"("zalo_account_id");

-- CreateIndex: zalo_tag_sync_queue
CREATE INDEX IF NOT EXISTS "zalo_tag_sync_queue_status_created_at_idx" ON "zalo_tag_sync_queue"("status", "created_at");

-- AddForeignKey: zalo_group_views
ALTER TABLE "zalo_group_views" ADD CONSTRAINT "zalo_group_views_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zalo_group_views" ADD CONSTRAINT "zalo_group_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: crm_tags
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: contact_tag_links
ALTER TABLE "contact_tag_links" ADD CONSTRAINT "contact_tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: auto_tag_rules
ALTER TABLE "auto_tag_rules" ADD CONSTRAINT "auto_tag_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auto_tag_rules" ADD CONSTRAINT "auto_tag_rules_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
