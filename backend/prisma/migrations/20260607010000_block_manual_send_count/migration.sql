-- Block manual-send counter (riêng gửi tay từ chat, không tính automation) — 2026-06-07
ALTER TABLE "blocks" ADD COLUMN "manual_send_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "blocks" ADD COLUMN "last_manual_sent_at" TIMESTAMP(3);
