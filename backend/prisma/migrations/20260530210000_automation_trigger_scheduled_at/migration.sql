BEGIN;
-- BE T4 2026-05-30 — Friend-invite trigger lên lịch hẹn giờ.
-- Cột riêng (KHÔNG nhét vào event_filter JSON) để cron pickup query
-- (state='draft' AND scheduled_at <= NOW()) có thể dùng index hiệu quả.
ALTER TABLE automation_triggers ADD COLUMN scheduled_at TIMESTAMP NULL;
COMMENT ON COLUMN automation_triggers.scheduled_at IS 'Friend-invite scheduled activation time (UTC). NULL = activate ngay. Set khi startMode=scheduled; cron sweep flip state=draft→active khi tới giờ.';

-- Index cho cron pickup: pick draft triggers có scheduled_at đến hạn.
CREATE INDEX automation_triggers_state_scheduled_at_idx ON automation_triggers (state, scheduled_at);
COMMIT;
