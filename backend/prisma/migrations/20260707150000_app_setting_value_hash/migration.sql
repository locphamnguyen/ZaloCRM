-- P2 (H1) — API key public: lưu SHA-256 hash thay vì plaintext (Community 2026-07-07)
-- Additive: chỉ thêm cột + index. Backfill hash cho key cũ + redact value_plain được làm
-- ở startup bằng JS (api-key-backfill.ts) — tránh phụ thuộc pgcrypto/quyền CREATE EXTENSION.

ALTER TABLE "app_settings" ADD COLUMN "value_hash" TEXT;

CREATE INDEX IF NOT EXISTS "app_settings_setting_key_value_hash_idx"
    ON "app_settings"("setting_key", "value_hash");
