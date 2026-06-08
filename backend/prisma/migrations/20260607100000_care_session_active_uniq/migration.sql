-- CareSession 2026-06-07: chặn phiên active TRÙNG (race enroll I31 + self-heal I32).
-- Partial unique: 1 khách × 1 nick × 1 trigger CHỈ 1 phiên active.
CREATE UNIQUE INDEX IF NOT EXISTS care_sessions_active_uniq
ON care_sessions (contact_id, nick_id, source_trigger_id)
WHERE state = 'active' AND source_trigger_id IS NOT NULL;
