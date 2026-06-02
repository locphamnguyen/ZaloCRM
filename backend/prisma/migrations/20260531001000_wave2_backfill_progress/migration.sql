-- Wave 2 backfill progress checkpoint table — Issue 10A + N10.
-- Cho phép restart backfill từ last_row_id nếu fail giữa chừng.

CREATE TABLE "tag_backfill_progress" (
  "id"               SERIAL PRIMARY KEY,
  "source_table"     TEXT NOT NULL UNIQUE,
  "last_row_id"      TEXT,
  "processed_count"  INTEGER NOT NULL DEFAULT 0,
  "completed_at"     TIMESTAMP(3),
  "started_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "idx_tag_backfill_progress_source" ON "tag_backfill_progress"("source_table");
