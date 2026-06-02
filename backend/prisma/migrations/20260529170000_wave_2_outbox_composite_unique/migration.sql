BEGIN;

ALTER TABLE friend_request_outbox DROP CONSTRAINT IF EXISTS friend_request_outbox_customer_list_entry_id_key;
DROP INDEX IF EXISTS friend_request_outbox_customer_list_entry_id_key;

CREATE UNIQUE INDEX friend_request_outbox_entry_kind_unique ON friend_request_outbox(customer_list_entry_id, kind);

DROP INDEX IF EXISTS idx_outbox_welcome_outcome;
DROP INDEX IF EXISTS idx_outbox_kind_send_status_run_at;

CREATE INDEX idx_outbox_welcome_poll ON friend_request_outbox(created_at) WHERE kind = 'WELCOME_PROBE' AND welcome_outcome IS NULL;

COMMIT;
