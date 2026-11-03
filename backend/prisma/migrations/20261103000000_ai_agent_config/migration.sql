-- AI Agent 24/7 (2026-11-03) — cấu hình tự trả lời khách trên nick Zalo cá nhân.
-- Bảng mới, additive. enabled mặc định FALSE → không đổi hành vi tới khi admin bật.
CREATE TABLE IF NOT EXISTS "ai_agent_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'off_hours',
    "zalo_account_ids" JSONB NOT NULL DEFAULT '[]',
    "work_start" TEXT NOT NULL DEFAULT '08:00',
    "work_end" TEXT NOT NULL DEFAULT '21:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "staff_grace_minutes" INTEGER NOT NULL DEFAULT 10,
    "staff_takeover_minutes" INTEGER NOT NULL DEFAULT 30,
    "min_delay_sec" INTEGER NOT NULL DEFAULT 8,
    "max_delay_sec" INTEGER NOT NULL DEFAULT 25,
    "max_per_nick_hour" INTEGER NOT NULL DEFAULT 15,
    "max_per_nick_day" INTEGER NOT NULL DEFAULT 120,
    "max_per_conversation_day" INTEGER NOT NULL DEFAULT 6,
    "knowledge_base" TEXT,
    "handoff_keywords" TEXT NOT NULL DEFAULT 'gặp người thật|nhân viên|tư vấn viên|khiếu nại|hoàn tiền|đổi trả|bị kích ứng|dị ứng',
    "handoff_message" TEXT NOT NULL DEFAULT 'Dạ em đã ghi nhận, em chuyển nhân viên tư vấn hỗ trợ mình ngay khi vào ca nhé ạ. Mình chờ em một chút nha 💚',
    "handoff_pause_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_agent_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_configs_org_id_key" ON "ai_agent_configs"("org_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_configs_org_id_fkey') THEN
    ALTER TABLE "ai_agent_configs" ADD CONSTRAINT "ai_agent_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
