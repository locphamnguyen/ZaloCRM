-- Media module hậu-audit 2026-06-12:
--  1. Watermark per-ảnh (BẬT/TẮT + góc + độ mờ) lưu bền trên media_assets.
--  2. Bỏ media_upload_refs (dead model — zca-js không forward được media, luôn gửi lẻ).
--  3. Thêm media_usage_events (tách event type để aggregate đo hiệu quả + audit privacy).

-- 1) Watermark per-ảnh.
ALTER TABLE "media_assets"
  ADD COLUMN "watermark_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "watermark_position" TEXT NOT NULL DEFAULT 'bottom-right',
  ADD COLUMN "watermark_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.65;

-- 2) Bỏ bảng cache forward-ref (chưa từng có dữ liệu — model chết ngay từ đầu).
DROP TABLE IF EXISTS "media_upload_refs";

-- 3) Log từng lần dùng media (event type tách riêng).
CREATE TABLE "media_usage_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" TEXT,
    "conversation_id" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_usage_events_org_id_event_type_idx" ON "media_usage_events"("org_id", "event_type");
CREATE INDEX "media_usage_events_media_asset_id_idx" ON "media_usage_events"("media_asset_id");
CREATE INDEX "media_usage_events_org_id_created_at_idx" ON "media_usage_events"("org_id", "created_at");

ALTER TABLE "media_usage_events"
  ADD CONSTRAINT "media_usage_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "media_usage_events"
  ADD CONSTRAINT "media_usage_events_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
