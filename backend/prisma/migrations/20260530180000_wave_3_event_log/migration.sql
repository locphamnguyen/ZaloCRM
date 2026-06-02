-- Wave 3 Event Log 2026-05-30 — append-only feed cho mọi automation event
-- Đọc bởi Mục tiêu Detail timeline + Monitor live view (poll 5s defer WS).
-- Retention 30 ngày (cron daily 06:00 VN xoá row cũ).
BEGIN;

CREATE TABLE IF NOT EXISTS automation_event_log (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id          TEXT NOT NULL,
  trigger_id      TEXT NOT NULL,
  task_id         TEXT NULL,
  contact_id      TEXT NULL,
  nick_id         TEXT NULL,
  event_type      TEXT NOT NULL,
  event_priority  TEXT NOT NULL DEFAULT 'info',
  summary         TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE automation_event_log IS
  'Append-only event feed cho Mục tiêu (Wave 3). Retention 30 ngày. Sự kiện: friend_sent / friend_accepted / friend_rejected / welcome_sent / welcome_blocked / sequence_step_sent / customer_reply / customer_block / nick_disconnected / nick_resume / validate_done / sweeper_action.';
COMMENT ON COLUMN automation_event_log.event_priority IS 'info | warning | urgent (UI tô màu theo priority)';
COMMENT ON COLUMN automation_event_log.summary IS 'Câu mô tả ngắn tiếng Việt cho hiển thị, vd "Nick Thành HS gửi kết bạn tới Chị Mai (row #47)"';
COMMENT ON COLUMN automation_event_log.metadata IS 'JSON tự do — row_index / step_idx / message_id / error_code / leadgen_id / outbox_id ...';

CREATE INDEX IF NOT EXISTS idx_event_log_trigger_time
  ON automation_event_log (trigger_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_org_time
  ON automation_event_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_type
  ON automation_event_log (event_type)
  WHERE event_type IS NOT NULL;

COMMIT;
