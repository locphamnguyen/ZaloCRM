BEGIN;
ALTER TABLE automation_triggers ADD COLUMN welcome_message_template TEXT;
ALTER TABLE automation_triggers ADD COLUMN welcome_delay_seconds INTEGER NOT NULL DEFAULT 60;
COMMENT ON COLUMN automation_triggers.welcome_message_template IS 'Per-trigger welcome probe template (Wave 2). Vars: {gender}/{name}/{sale}. NULL = skip welcome step.';
COMMENT ON COLUMN automation_triggers.welcome_delay_seconds IS 'Delay after friend-request before sending welcome probe. Default 60s.';
-- Revert org column comment (only used for onboarding now)
COMMENT ON COLUMN organizations.welcome_message_template IS 'User onboarding template (HR system, double-brace vars). KHÔNG dùng cho friend-invite welcome.';
-- Drop friend_invite_welcome_template em vừa add nhầm
ALTER TABLE organizations DROP COLUMN IF EXISTS friend_invite_welcome_template;
COMMIT;
