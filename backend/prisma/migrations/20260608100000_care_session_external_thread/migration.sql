-- CareSession 2026-06-08 (anh chốt): neo phiên theo PER-NICK UID khách (góc nhìn nick sale).
-- external_thread_id = Conversation.external_thread_id = Friend.zalo_uid_in_nick.
-- Mục đích: 1 nick có 2 hội thoại cùng 1 Contact CHA vẫn tách phiên đúng (per-conversation).
-- NULLABLE: phiên cũ + phiên no-Zalo (virtual) để null → listener fallback "OR null".

-- Bước 1: thêm cột nullable (instant trên Postgres, không rewrite bảng).
ALTER TABLE care_sessions ADD COLUMN external_thread_id TEXT;

-- Bước 2: index thường cho lookup theo (nick, thread) — UI/SDK + per-conversation.
CREATE INDEX IF NOT EXISTS care_sessions_nick_thread_idx
ON care_sessions (nick_id, external_thread_id);

-- Bước 3: backfill phiên cũ từ conversations theo (nick, contact) thread 1-1.
-- Conversation unique (zalo_account_id, external_thread_id) → join theo contact_id an toàn 1-1
-- cho thread 'user'. Phiên không khớp conversation nào → giữ null (fallback lo).
UPDATE care_sessions cs
SET external_thread_id = c.external_thread_id
FROM conversations c
WHERE c.zalo_account_id = cs.nick_id
  AND c.contact_id = cs.contact_id
  AND c."threadType" = 'user'
  AND c.external_thread_id IS NOT NULL
  AND cs.external_thread_id IS NULL;
