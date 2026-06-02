BEGIN;
ALTER TABLE organizations ADD COLUMN friend_invite_welcome_template TEXT;
COMMENT ON COLUMN organizations.welcome_message_template IS 'User onboarding template (HR system, {{double-brace}} vars: orgName/fullName/password/loginUrl/etc)';
COMMENT ON COLUMN organizations.friend_invite_welcome_template IS 'Friend-invite welcome probe template (Wave 2, {single-brace} vars: gender/name/sale)';
COMMIT;
