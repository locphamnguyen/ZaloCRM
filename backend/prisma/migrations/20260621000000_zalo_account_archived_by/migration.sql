-- T13: track ai bấm XÓA nick (cho tab "Nick đã xóa" của admin). Additive, IF NOT EXISTS → an toàn.
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "archived_by_id" TEXT;
