# Changelog

Tất cả thay đổi đáng chú ý của ZaloCRM được ghi lại tại đây. Dự án dùng nhánh `main` làm dòng phát hành chính.

## v3.3.0 — 25/05/2026

### Added
- Facebook Lead Ingestion: Meta OAuth, page connection, webhook verify/HMAC, lead queue, form auto-discovery.
- Tự tạo Customer List theo Facebook page/form và gán sale vòng tròn cho lead mới.
- Chuyển tiếp media trong chat: image, video, audio.
- Backfill/mirror ảnh/video inbound từ Zalo CDN sang MinIO/S3/R2.
- Cloudflare R2 config trong `.env.example`.
- Release screenshots tại `docs/release-images/v3.3/`.

### Changed
- Merge upstream `hsholding/main` qua branch `merge/hsholding-main-20260525`.
- Merge `feat/fb-lead-ingestion` vào `main`.
- Chat media pipeline dùng object storage nhất quán hơn cho preview và forward.
- `.env` parser xử lý secret/password có ký tự `#`.

### Fixed
- Fix issue #24: fallback JSON lỗi từ `getFriendOnlines`.
- Fix issue #25: nhận diện message type `webchat`.
- Fix thumbnail video không hiện.
- Fix kéo thả file/hình/video vào màn hình chat bị mất.
- Fix ảnh khách gửi đến còn lưu trực tiếp Zalo CDN thay vì mirror về object storage.

## v3.2.0 — 21/05/2026

### Added
- Bot-Auto framework: Blocks, Sequences, Triggers, Broadcasts, Customer Lists.
- Lead Scoring Phase 6: signal detector, auto-decay, auto tags, stuck lead dashboard.
- Customer Lists import CSV/Excel, column mapping, inline edit, undo delete.
- Scoring settings tại `/settings/crm/scoring`.
- Scripts hỗ trợ Phase 7 runner và setup test data.

### Changed
- Bot-Auto được đưa lên top-level navigation.
- Appointments, Friends, Zalo Accounts, Settings layout được redesign.
- Zalo Labels auto-sync khi connect/reconnect.
- Contact touch-profile endpoint bổ sung thông tin từ SDK khi mở conversation.

## v3.1.2 — 04/2026

### Fixed
- Sửa lỗi nhỏ sau v3.1 về đồng bộ, UI và ổn định listener.
- Cải thiện backfill DM history và xử lý duplicate contact.

## v3.1.1 — 04/2026

### Fixed
- Sửa lỗi phát sinh trong luồng tag/note/label.
- Cải thiện fallback AI parse khi quota provider bị giới hạn.

## v3.1.0 — 04/2026

### Added
- CRM Tag system riêng trong Settings.
- Notes thread trong hồ sơ khách hàng.
- Zalo Labels 2-way sync.
- DM history backfill endpoint và nút đồng bộ trong UI.
- DuplicateReviewDialog để rà soát/gộp khách hàng trùng.

### Changed
- Phone normalization theo `phoneNormalized`.
- Contact resolving ưu tiên key chuẩn hơn.

## v3.0.0 — 2026

### Added
- Chat attachments qua MinIO/S3: hình ảnh, video, file.
- Video player inline trong bubble.
- Friend model và FriendshipAttempt.
- Reaction multi-emoji đồng bộ hai chiều Zalo ↔ CRM.
- Sticker animated render qua proxy.
- Bank/QR card render theo style Zalo.
- Zalo user info popup.
- Contact merge theo Zalo globalId.
- Proxy per-account UI.

### Changed
- Redesign Chat, Contacts, Friends theo Smax style.
- Bổ sung Redis và object storage vào stack Docker.

### Fixed
- Fix duplicate message do shape `sendResult.message.msgId`.
- Fix image preview rỗng sau upload attachment.
- Fix reply preview attachment hiện raw JSON.
- Fix mention tô lố vùng text.

## v2.1 — 16/04/2026

### Added
- Tab "Khác" cho hội thoại không quan trọng.
- Tên khách hàng 2 lớp: CRM Name + Zalo Name.
- Bộ lọc hội thoại: chưa đọc, chưa trả lời, thời gian, tag.
- Quick template bằng phím `/`.
- Đồng bộ 50 tin nhắn cũ và selfListen dedup.

### Fixed
- Fix tên "Unknown".
- Fix PWA setup.
- Fix tin nhắn trùng khi gửi.

## v2.0.0 — 31/03/2026

### Added
- AI Assistant: gợi ý trả lời, tóm tắt, phân tích cảm xúc.
- Workflow Automation.
- Integration Hub: Google Sheets, Telegram, Facebook, Zapier.
- Mobile PWA.
- Contact Intelligence: gộp trùng, lead scoring, auto-tag.
- Advanced Analytics.
- Multi-provider AI: Anthropic, OpenAI, Gemini, Qwen, Kimi.
- Proxy per-account.

### Fixed
- Loại bỏ một số trường hợp tin nhắn hiển thị trùng.

## v1.0.0 — Khởi tạo

### Added
- Quản lý nhiều tài khoản Zalo cá nhân.
- Đăng nhập QR và tự reconnect.
- Chat real-time, gửi/nhận tin nhắn, ảnh, file, sticker, nhóm chat.
- Quản lý khách hàng theo pipeline.
- Lịch hẹn, dashboard, báo cáo Excel.
- Phân quyền Owner/Admin/Member.
- Public REST API và webhook.
- Chống block Zalo bằng giới hạn gửi và cảnh báo tốc độ.
- Tìm kiếm toàn hệ thống.
- Theme tối/sáng.
