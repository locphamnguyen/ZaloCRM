-- Mobile App 2026-06-15: BE-1 Device registration + BE-3 idempotency echoId

-- CreateTable (BE-1)
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_fcm_token_key" ON "devices"("fcm_token");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (BE-3): idempotency key cho gửi tin
ALTER TABLE "messages" ADD COLUMN "client_echo_id" TEXT;

-- CreateIndex: 1 echoId duy nhất / conversation (Postgres cho phép multiple NULL)
CREATE UNIQUE INDEX "messages_conversation_id_client_echo_id_key" ON "messages"("conversation_id", "client_echo_id");
