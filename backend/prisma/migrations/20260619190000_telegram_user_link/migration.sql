-- Phase 3.1 — gắn tài khoản Telegram ↔ user CRM (chỉ thêm 1 bảng).

-- CreateTable
CREATE TABLE "telegram_user_link" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_user_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_user_link_telegram_user_id_key" ON "telegram_user_link"("telegram_user_id");

-- CreateIndex
CREATE INDEX "telegram_user_link_org_id_idx" ON "telegram_user_link"("org_id");
