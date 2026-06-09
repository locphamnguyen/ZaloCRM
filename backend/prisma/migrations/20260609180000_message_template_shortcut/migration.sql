-- Mẫu tin nhắn — thêm "Từ khóa gõ tắt" (shortcut). Anh chốt 2026-06-09.
-- Sale gõ "/giaEGV" → nhảy đúng mẫu. Idempotent.
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "shortcut" TEXT;
CREATE INDEX IF NOT EXISTS "message_templates_org_id_shortcut_idx" ON "message_templates" ("org_id", "shortcut");
