-- Per-entry personal note imported from CSV/Excel "Ghi chú" column.
-- Tên field cố ý KHÔNG là `notes` để phân biệt với Contact.notes (CRM internal notes).
ALTER TABLE "customer_list_entries"
  ADD COLUMN IF NOT EXISTS "personal_note" TEXT;
