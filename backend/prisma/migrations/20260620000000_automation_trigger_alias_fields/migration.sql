-- Fix schema drift trên nhánh feat/open-core-split:
-- commit b584930 thêm 3 field vào model AutomationTrigger (autoAliasEnabled /
-- aliasTemplate / projectAbbr) NHƯNG thiếu migration tương ứng → automationTrigger.findMany
-- fail "ColumnNotFound", hot-loop ở automation engine (campaign-materializer).
-- Additive, idempotent. Khớp đúng kiểu trong schema.prisma.
ALTER TABLE "automation_triggers"
  ADD COLUMN IF NOT EXISTS "auto_alias_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "alias_template" TEXT,
  ADD COLUMN IF NOT EXISTS "project_abbr" TEXT;
