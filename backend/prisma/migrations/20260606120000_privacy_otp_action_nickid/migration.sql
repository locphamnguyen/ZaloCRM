-- Phase Privacy OTP 2026-06-06 — tách 2 luồng: gạt bật/tắt (no session) vs mở khoá xem (có session).
-- ADD COLUMN DEFAULT an toàn (token cũ tự nhận 'unlock' → chạy nguyên flow cũ, backward-compat).
ALTER TABLE "privacy_otp_tokens" ADD COLUMN "action" TEXT NOT NULL DEFAULT 'unlock';
ALTER TABLE "privacy_otp_tokens" ADD COLUMN "nick_id" TEXT;
