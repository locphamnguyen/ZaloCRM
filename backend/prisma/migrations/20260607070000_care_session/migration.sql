-- CareSession (Phiên chăm sóc) — 2026-06-07
-- Tách lớp lắng nghe sự kiện khách + nhắc sale khỏi trigger/sequence engine.

-- AlterTable
ALTER TABLE "automation_triggers" ADD COLUMN     "close_conditions" JSONB;

-- CreateTable
CREATE TABLE "care_sessions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "nick_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "enrolled_by_user_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_trigger_id" TEXT,
    "source_sequence_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'active',
    "closed_reason" TEXT,
    "close_conditions" JSONB,
    "interest_window_until" TIMESTAMP(3) NOT NULL,
    "last_customer_activity_at" TIMESTAMP(3),
    "sequence_start_enqueued_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "care_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_session_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_session_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "care_sessions_org_id_contact_id_nick_id_state_idx" ON "care_sessions"("org_id", "contact_id", "nick_id", "state");

-- CreateIndex
CREATE INDEX "care_sessions_state_interest_window_until_idx" ON "care_sessions"("state", "interest_window_until");

-- CreateIndex
CREATE INDEX "care_sessions_source_trigger_id_state_idx" ON "care_sessions"("source_trigger_id", "state");

-- CreateIndex
CREATE INDEX "care_sessions_org_id_owner_user_id_state_idx" ON "care_sessions"("org_id", "owner_user_id", "state");

-- CreateIndex
CREATE INDEX "care_session_events_session_id_created_at_idx" ON "care_session_events"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "care_session_events_session_id_event_id_key" ON "care_session_events"("session_id", "event_id");

-- AddForeignKey
ALTER TABLE "care_sessions" ADD CONSTRAINT "care_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_sessions" ADD CONSTRAINT "care_sessions_source_trigger_id_fkey" FOREIGN KEY ("source_trigger_id") REFERENCES "automation_triggers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_session_events" ADD CONSTRAINT "care_session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "care_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

