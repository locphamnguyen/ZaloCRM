-- P2 Wave 4 2026-06-03 — Tạm dừng có thời hạn (TTL pause).
--
-- Bối cảnh: UI hiện có button "⏸ Tạm dừng 24h" + "⏹ Dừng hẳn" nhưng BE chỉ có
-- /pause vô hạn (state='paused' bất biến tới khi user bấm "Tiếp tục"). Spec M13
-- yêu cầu tạm dừng có thời hạn → cần TTL + sweeper auto-resume.
--
-- Design:
--   - paused_until NULL  → pause vô hạn (legacy + nút "Dừng vĩnh viễn").
--   - paused_until SET   → cron sweep mỗi 1 phút flip 'paused'→'active' khi <= NOW().
--   - Tách khỏi scheduled_at (semantic khác: scheduled_at = draft→active first time;
--     paused_until = active↔paused recurring) → 2 cột riêng, 2 sweeper riêng.

ALTER TABLE "automation_triggers" ADD COLUMN "paused_until" TIMESTAMP NULL;
COMMENT ON COLUMN "automation_triggers"."paused_until" IS 'TTL pause expiry (UTC). NULL = pause vô hạn. Cron auto-resume khi <= NOW().';

-- Index cho sweeper: pick paused triggers có paused_until đến hạn.
CREATE INDEX "automation_triggers_state_paused_until_idx" ON "automation_triggers" ("state", "paused_until");
