-- M53 (2026-05-30): Virtual Chat cho KH no-Zalo + AI Trợ Lý
-- Memory M53 trong MEMORY-REVIEW-20260529.md
-- Branch: feat/virtual-chat-no-zalo
-- Anh chốt Approach A: sale có 1 chỗ duy nhất xem TẤT CẢ KH trong /chat

-- =====================================================
-- 1. Conversation.isVirtual — phân biệt chat ảo vs chat Zalo thật
-- =====================================================
ALTER TABLE "conversations"
  ADD COLUMN "is_virtual" BOOLEAN NOT NULL DEFAULT false;

-- =====================================================
-- 2. Message.isLocal + metadata — tin nhắn nội bộ + AI suggestion entities
-- =====================================================
ALTER TABLE "messages"
  ADD COLUMN "is_local" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "metadata" JSONB;

-- =====================================================
-- 3. AiConfig — 3 field cho AI Trợ Lý
-- =====================================================
ALTER TABLE "ai_configs"
  ADD COLUMN "ai_assistant_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ai_assistant_prompt_template" TEXT,
  ADD COLUMN "ai_assistant_skip_noise_pattern" TEXT NOT NULL
    DEFAULT '^(ok|oke|okay|uhm|um|ờ|à|ừ|a|o|yes|no|y|n|\.|\.\.|\.\.\.)\s*$';

-- =====================================================
-- 4. AiSuggestionApplied — audit log mỗi lần sale áp dụng AI suggestion
-- =====================================================
CREATE TABLE "ai_suggestions_applied" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "accepted_fields" JSONB NOT NULL,
    "rejected_fields" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_suggestions_applied_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_suggestions_applied_org_id_contact_id_idx"
  ON "ai_suggestions_applied"("org_id", "contact_id");

CREATE INDEX "ai_suggestions_applied_org_id_created_at_idx"
  ON "ai_suggestions_applied"("org_id", "created_at");

ALTER TABLE "ai_suggestions_applied"
  ADD CONSTRAINT "ai_suggestions_applied_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_suggestions_applied"
  ADD CONSTRAINT "ai_suggestions_applied_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_suggestions_applied"
  ADD CONSTRAINT "ai_suggestions_applied_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
