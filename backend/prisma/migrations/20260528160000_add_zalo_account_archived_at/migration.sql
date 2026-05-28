-- Soft-delete: archived nick is hidden from dashboard but data preserved.
-- Hard-delete: archived + purged → data wiped, re-connect creates fresh nick.
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "purged" BOOLEAN NOT NULL DEFAULT false;
