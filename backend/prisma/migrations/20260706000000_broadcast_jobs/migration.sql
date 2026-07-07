-- Broadcast tự động (Community extension) 2026-07-06
-- Gửi tin hàng loạt tới Tệp khách hàng theo lịch once/daily/weekly.

CREATE TABLE "broadcast_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_list_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "image_url" TEXT,
    "schedule_type" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "time_of_day" TEXT,
    "days_of_week" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "max_per_run" INTEGER NOT NULL DEFAULT 50,
    "delay_sec_min" INTEGER NOT NULL DEFAULT 30,
    "delay_sec_max" INTEGER NOT NULL DEFAULT 90,
    "status" TEXT NOT NULL DEFAULT 'active',
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "broadcast_runs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "broadcast_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "broadcast_run_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "zalo_uid" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_run_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "broadcast_jobs_org_id_status_idx" ON "broadcast_jobs"("org_id", "status");
CREATE INDEX "broadcast_jobs_status_next_run_at_idx" ON "broadcast_jobs"("status", "next_run_at");
CREATE INDEX "broadcast_runs_job_id_idx" ON "broadcast_runs"("job_id");
CREATE INDEX "broadcast_runs_org_id_status_idx" ON "broadcast_runs"("org_id", "status");
CREATE INDEX "broadcast_run_items_run_id_entry_id_idx" ON "broadcast_run_items"("run_id", "entry_id");

ALTER TABLE "broadcast_runs" ADD CONSTRAINT "broadcast_runs_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "broadcast_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "broadcast_run_items" ADD CONSTRAINT "broadcast_run_items_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "broadcast_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
