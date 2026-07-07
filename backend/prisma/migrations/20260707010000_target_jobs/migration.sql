-- Mục tiêu (Target — auto kết bạn, Community extension) 2026-07-07
-- Gửi lời mời kết bạn liên tục tới hết Tệp khách hàng hoặc chạm maxTotal.

CREATE TABLE "target_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_list_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "request_msg" TEXT NOT NULL,
    "max_total" INTEGER NOT NULL DEFAULT 200,
    "delay_sec_min" INTEGER NOT NULL DEFAULT 60,
    "delay_sec_max" INTEGER NOT NULL DEFAULT 180,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "no_zalo_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "target_run_items" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "zalo_uid" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_run_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "target_jobs_org_id_status_idx" ON "target_jobs"("org_id", "status");
CREATE INDEX "target_run_items_job_id_entry_id_idx" ON "target_run_items"("job_id", "entry_id");

ALTER TABLE "target_run_items" ADD CONSTRAINT "target_run_items_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "target_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
