# Phase 7 — Test Report (Overnight Run 2026-05-21)

Anh giao em chạy đêm: fix 7 bug + build send_image/video/file + test full automation
end-to-end với 4 nick Zalo + ghi log lại để anh check sáng mai.

**Resource anh cung cấp:**
- Nick Zalo 1: Thành HS Holding · `0904808000`
- Nick Zalo 2: Thành Phạm · `0908278807`
- Nick Zalo 3: Evo Sport · `0901101808`
- Test Contact (nick phụ chưa login): Phạm Chí Thành "Trợ Lý" · `0931536109`

**Em sẽ test 7 luồng:**
1. Kết bạn (friend request)
2. Gửi text message
3. Gửi block (sequence multi-step)
4. Gửi HTML / rich text
5. Gửi ảnh
6. Gửi video
7. Gửi file

---

## Tóm tắt nhanh (anh đọc trước)

> Em sẽ update mục này khi xong toàn bộ. Hiện đang chạy...

| Item | Status |
|---|---|
| Fix 7 critical bug (5 P1 codex + 2 OH) | ⏳ Đang chạy |
| Build send_image/video/file action types | ⏳ Pending |
| Test data setup | ⏳ Pending |
| 7 scenario test STUB + REAL | ⏳ Pending |
| Auto-fix loop iterations | ⏳ Pending |

---

## Phần I — Bug fixes (Approach A)

Codex review flagged 5 P1 + 3 P2. Office-hours flagged 3 thêm. Tổng 7 bug em fix
ưu tiên (sort theo blast radius):

| # | Bug | Source | Status |
|---|---|---|---|
| A1 | SegmentSpec cross-tenant injection | Codex P1 | ⏳ |
| A2 | JWT_SECRET dev-fallback in prod | Codex P1 | ⏳ |
| A3 | Broadcast double-fire race | Codex P1 | ⏳ |
| A4 | Worker outcome handling (no_zalo/already_friend) | Codex P1 | ⏳ |
| A5 | send_message permissive friendship status | Codex P1 + OH | ⏳ |
| A6 | Worker stale task feedback loop | OH Q5 | ⏳ |
| A7 | Worker lockedUntil lease | OH CC1 | ⏳ |

(Section này sẽ fill chi tiết khi xong từng bug)

---

## Phần II — Media action types (send_image / send_video / send_file)

(Sẽ fill khi build xong)

---

## Phần III — Test data setup

(Sẽ fill khi import 4 nick + create contact)

---

## Phần IV — 7 luồng test

### Luồng 1: Kết bạn (request_friend)

(Sẽ fill log + verify steps)

### Luồng 2: Gửi text message

### Luồng 3: Gửi block (sequence multi-step)

### Luồng 4: Gửi HTML / rich text

### Luồng 5: Gửi ảnh

### Luồng 6: Gửi video

### Luồng 7: Gửi file

---

## Phần V — Auto-fix loop log

(Iterations qua /codex hoặc /office-hours nếu lỗi)

---

## Phần VI — Visible verification cho anh

Mỗi luồng REAL test em sẽ ghi:
- Timestamp em trigger
- Nick gửi
- Contact nhận (uid + phone)
- Payload (block content / image URL / etc)
- DB state sau khi worker chạy
- **Anh verify trên Zalo:** mở Zalo nick gửi → tab chat KH "Phạm Chí Thành Trợ Lý" → thấy gì
