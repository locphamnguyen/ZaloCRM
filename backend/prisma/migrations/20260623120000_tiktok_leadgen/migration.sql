-- CreateTable
CREATE TABLE "tiktok_app_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "app_id" TEXT,
    "app_secret_enc" TEXT,
    "webhook_verify_token" TEXT,
    "oauth_redirect_uri" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiktok_app_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiktok_advertiser_connections" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "advertiser_id" TEXT NOT NULL,
    "advertiser_name" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'connected',
    "last_error" TEXT,
    "last_webhook_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiktok_advertiser_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_app_configs_org_id_key" ON "tiktok_app_configs"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_advertiser_connections_org_id_advertiser_id_key" ON "tiktok_advertiser_connections"("org_id", "advertiser_id");

-- CreateIndex
CREATE INDEX "tiktok_advertiser_connections_advertiser_id_idx" ON "tiktok_advertiser_connections"("advertiser_id");
