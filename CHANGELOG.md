# Changelog

Tất cả thay đổi đáng chú ý của ZaloCRM được ghi lại tại đây. Dự án dùng nhánh `main` làm dòng phát hành chính.

## v3.3.4 — 06/06/2026

> Bản phát hành tài liệu — không thay đổi code runtime. Bổ sung tài liệu kiến trúc, API và thiết kế tích hợp TCRM.

### Added

- **Tài liệu kiến trúc source code** (`docs/system-architecture.md`): sơ đồ tổng quan Frontend ↔ Backend ↔ dịch vụ ngoài, luồng khởi động `app.ts`, 20 module nghiệp vụ, kiến trúc Plugin Host (13 core plugin), `ZaloAccountPool`, webhook OUTGOING — kèm 8 sơ đồ Mermaid.
- **Tài liệu kiến trúc database** (`docs/database-architecture.md`): 64 model, mô hình danh tính Zalo 3 lớp (`ZaloAccount ↔ Friend ↔ Contact`), ER diagram lõi, phân nhóm 8 miền, vòng đời dữ liệu khi có tin nhắn.
- **Tài liệu API đầy đủ** (`docs/api-documentation.md` + bản tiếng Việt `docs/api-documentation-vi.md`): 19 nhóm endpoint, xác thực JWT, rate limit, webhook & WebSocket events.
- **Postman collection** (`postman-collection.json`): document chi tiết cho cả 19 nhóm; request **Login** tự lưu `token → {{TOKEN}}`, `orgId`, `userId`; hướng dẫn lấy `{{CONVERSATION_ID}}` và `{{ZALO_ACCOUNT_ID}}`.
- **Thiết kế tích hợp TCRM** (`plans/260605-2128-tcrm-webhook-receiver/`): nhận tin nhắn Zalo real-time qua webhook `message.received`, map qua `conversationId` + `senderUid`, idempotency theo `messageId`. Xác nhận ảnh/file đẩy được ngay MVP — URL media đã mirror sẵn vào `content` và public tải được (`docker-compose.yml` đặt bucket `anonymous download`).
- **Tài liệu hướng dẫn agent** (`CLAUDE.md`, `AGENTS.md`) và skill GitNexus (`.claude/skills/gitnexus/`).

## v3.3.3 — 28/05/2026

### Fixed

- **Tag Zalo Native không push qua Zalo SDK**: TagCrmBar khi user pick tag `managedBy='zalo_sync'` chỉ ghi vào `Contact.tags` qua `PUT /contacts/:id/tags` — không gọi Zalo SDK. Reload mất tag vì display logic chỉ lấy "🔵 X" từ `Friend.crmTagsPerNick`. Fix: route Zalo tags qua `POST /zalo-accounts/:id/labels/assign-thread` để push thật qua SDK, single-select per thread, null = unassign.
- **Filter tag Zalo Native trong sidebar lọc sai (0 kết quả)**: backend dùng pattern Prisma sai `zaloLabels: { path: ['$[*].name'], array_contains: [name] }` → silently trả 0 rows. Đổi sang `zaloLabels: { array_contains: [{ name }] }` (translates `jsonb @>` containment). Áp dụng cho cả filter `zaloLabels` riêng và filter `tags` thống nhất.
- **Tag Zalo Native không hiển thị trên conversation list + tag-crm-bar**: sync logic chỉ add mirror "🔵 X" cho `addedLabels` diff. Legacy data: friend có `zaloLabels` từ trước → sync lại thấy `addedLabels=[]` → không backfill mirror → 41/74 friends bị empty `crmTagsPerNick`. Fix: rebuild mirror from scratch mỗi sync — strip toàn bộ "🔵 ..." cũ, add lại cho TẤT CẢ labels hiện tại. Idempotent + self-healing. Kèm SQL backfill 74 friends.
- **Trang `/settings/rbac/users` thiếu nút "Thêm nhân viên"**: RBAC redesign vô tình bỏ nút tạo từ `UserManagement.vue` cũ. Khôi phục nút ở góc phải hero (owner/admin only) + dialog tạo nhân viên (họ tên, email, mật khẩu, vai trò). Dùng `useUsers().createUser` có sẵn.

## v3.3.2 — 28/05/2026

### Fixed
- **Ngắt kết nối nick Zalo không hiệu lực**: thêm `manuallyDisabled` Set trong `ZaloAccountPool` để chặn auto-reconnect sau khi user chủ động disconnect. `onDisconnected` callback và `autoReconnect` đều skip nếu account đã bị disable thủ công. Health check cron 5p + daily refresh + startup reconnect đều filter `status: 'disconnected'` và `archivedAt: null`.
- **Uptime 7d luôn 0%**: bảng `zalo_account_status_log` chưa được apply migration → tạo migration mới + backfill open record cho nick đang connected. Checkpoint cron 5p reconcile drift sau crash.
- **Tin nhắn của nick đã xoá vẫn hiển thị trong /chat**: filter `zaloAccount.archivedAt: null` trong conversations list + counts endpoints.
- **Drawer Chi tiết nick vẫn mở sau khi xoá nick**: tự đóng drawer sau khi xoá thành công.
- **AI Format button không hiện khi paste text**: tách button ra ngoài format toolbar (mặc định ẩn), luôn hiện ở góc phải trên editor khi có text.

### Added
- **Soft-delete nick CRM với 2 mode**:
  - TH1 (không check): chỉ ẩn nick khỏi quản lý, giữ session+zaloUid+data. Quét QR lại → auto-restore nick cũ với toàn bộ chat history.
  - TH2 (check "Xoá toàn bộ dữ liệu..."): clear session+zaloUid, quét QR lại tạo nick CRM mới.
  - Migration `20260528160000_add_zalo_account_archived_at` thêm cột `archived_at` + `purged`.
- **Auto-restore archived account** trên `loginQR`: khi `zaloUid` trùng với nick archived (purged=false) → unarchive + xoá nick tạm + chuyển pool instance.
- **Realtime status refresh**: thêm `onStatusChange` callback trong `use-zalo-accounts` để dashboard `fetchStats()+fetchEnriched()` ngay khi `zalo:connected/disconnected/error/reconnect-failed`.
- **Nick row actions trong chat folder picker**: 4 nút SVG (Sync danh bạ, Sync lịch sử chat, Reconnect, Đăng nhập QR) bên cạnh mỗi nick. Disable theo trạng thái live.
- **Toast notifications thống nhất**: `ToastContainer` chuyển sang góc trên phải, nền trắng + viền trái màu, icon + nút đóng (success/error/warning/info). Áp dụng cho sync danh bạ, sync lịch sử, xoá nick, mọi action errors.

### Changed
- Disable button theo trạng thái nick:
  - Reconnect + Đăng nhập QR: mờ khi `connected`
  - Ngắt kết nối: mờ khi không `connected`
  - Sync lịch sử chat: mờ khi không `connected`
- Backend `DELETE /api/v1/zalo-accounts/:id?purge=true|false` thay vì hard-delete.
- `zalo-scope.ts` filter `archivedAt: null` → nick archived ẩn khỏi mọi dashboard query (org admin + member).

### Dependencies
- Thêm `exceljs` vào frontend (fix build error sau khi remove `xlsx` từ v3.3.1).

## v3.3.1 — 28/05/2026

### Security

- **CRITICAL** Sửa SQL injection trong custom analytics report — `filters.source`/`filters.userId` từ request body bị concat thẳng vào `$queryRawUnsafe`, cho phép UNION-based extraction cross-tenant. Chuyển sang `prisma.$queryRaw` tagged template + `Prisma.sql` bound parameters.
- **CRITICAL** Nâng cấp `fast-jwt` lên 6.2.4 (vá CVE crit-header bypass) và 18 dependency backend khác qua `npm audit fix`. Frontend audit giảm từ 7 → 2 vuln.
- **HIGH** Bắt buộc xác thực trên các endpoint Zalo PII (`/api/v1/zalo-user-info/batch`, `/api/v1/zalo-user-info/:uid`, `/api/v1/zalo-sticker-list`) — trước đây không cần token, cho phép liệt kê số điện thoại/ngày sinh hàng loạt. Giới hạn batch từ 200 → 50 UID.
- **HIGH** Thêm SSRF guard cho webhook URL do org admin cấu hình (`modules/api/webhook-service.ts`) — chặn loopback, RFC1918, link-local (169.254/16), IPv6 ULA/link-local, non-HTTPS. Shared util `ssrf-guard.ts` cũng thay thế regex inline trong `zapier-webhook.ts`.
- **HIGH** Sửa IDOR và email enumeration oracle trong user-routes — member có thể tự đổi `email`/`teamId` của mình để chiếm password-reset. Thêm per-role field allowlist: member chỉ sửa `fullName`; admin thêm `email`+`teamId` (không tự sửa email); owner thêm `role`+`isActive`. Lỗi unique constraint trả về message chung, không lộ email tồn tại.
- **HIGH** Thay thế `xlsx` (SheetJS community, GHSA-4r6h-8v6p-xvw6 prototype pollution + ReDoS, không có bản vá) bằng `exceljs` trong modal import danh sách khách hàng. Lazy-import để giữ bundle nhỏ.
- **HIGH** MinIO: hard-fail khi thiếu `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` trong `.env` thay vì fallback về `minioadmin/minioadmin`.

### Hygiene

- Thêm `.env.bak*` và `.env.*.bak` vào `.gitignore` — ngăn commit nhầm file backup env.
- Bổ sung biến Facebook integration (`FB_GRAPH_API_VERSION`, `FB_APP_ID`, `FB_APP_SECRET`, `FB_WEBHOOK_VERIFY_TOKEN`, `FB_TOKEN_ENC_KEY`, `FB_OAUTH_REDIRECT_URI`) vào `.env.example` kèm hướng dẫn tạo.

### Upgrade notes

Thêm vào `.env` trước khi `docker compose up`:
```
MINIO_ROOT_USER=<admin-user>
MINIO_ROOT_PASSWORD=<strong-password>
```

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
