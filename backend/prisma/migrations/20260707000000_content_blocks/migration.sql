-- Khối nội dung (Content Block — Community extension) 2026-07-07
-- Kho nội dung tái dùng cho Broadcast tự động — xoay vòng nhiều mẫu chống spam.

CREATE TABLE "content_blocks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "image_url" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_blocks_org_id_idx" ON "content_blocks"("org_id");

ALTER TABLE "broadcast_jobs" ADD COLUMN "content_block_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
