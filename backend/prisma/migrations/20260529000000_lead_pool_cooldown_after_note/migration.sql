-- 2026-05-29 Phase Lead Pool v2.B — Cooldown sau note.
-- Sau khi sale note 1 lead, KH này KHÔNG vào pool chia tiếp trong N ngày.
-- Chống spam: 2 sale cùng nhận 1 KH; sale gốc tự xin lại chính KH mình vừa chăm.
-- Sale bấm "Trả lại pool" → bypass cooldown (release_reason IS NOT NULL).
ALTER TABLE "lead_pool_configs"
  ADD COLUMN "cooldown_after_note_days" INTEGER NOT NULL DEFAULT 30;
