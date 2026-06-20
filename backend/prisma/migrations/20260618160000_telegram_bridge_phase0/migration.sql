-- Phase 0 — Cầu Zalo ↔ Telegram. Chỉ thêm 2 bảng + index + FK (không sửa cột cũ).

-- CreateTable
CREATE TABLE "telegram_bridge_config" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_bridge_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_topic_map" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "telegram_topic_id" INTEGER NOT NULL,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_topic_map_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bridge_config_zalo_account_id_key" ON "telegram_bridge_config"("zalo_account_id");

-- CreateIndex
CREATE INDEX "telegram_bridge_config_org_id_enabled_idx" ON "telegram_bridge_config"("org_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_topic_map_conversation_id_key" ON "telegram_topic_map"("conversation_id");

-- CreateIndex
CREATE INDEX "telegram_topic_map_telegram_chat_id_last_active_at_idx" ON "telegram_topic_map"("telegram_chat_id", "last_active_at");

-- AddForeignKey
ALTER TABLE "telegram_bridge_config" ADD CONSTRAINT "telegram_bridge_config_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_topic_map" ADD CONSTRAINT "telegram_topic_map_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
