# Broadcast tự động (Community extension) — Tài liệu triển khai & Roadmap

> Ngày: 06/07/2026 · Người thực hiện: Huỳnh Ngọc Thuận (với Claude)
> Nền tảng: ZCRM v3.4 Community (AGPL-3.0) — tự code lại tính năng EE trên bản mã nguồn mở.

## Trạng thái triển khai

| Vòng | Commit GitHub | Nội dung | Server production |
|---|---|---|---|
| 1 | [`6660df8`](https://github.com/huynhthuan12321/ZaloCRM-CorepViet/commit/6660df8) | Broadcast tự động (CRUD job, cron gửi rải, modal tạo) | ✅ Đã deploy, test gửi thật thành công (06/07/2026) |
| 2 | [`c3b9880`](https://github.com/huynhthuan12321/ZaloCRM-CorepViet/commit/c3b9880) | RBAC + khung giờ 8h-21h + chọn ảnh Kho media + báo cáo thống kê | ✅ Đã deploy, test aggregation + time-window thành công (06/07/2026) |
| 3 | _(chưa commit)_ | Mục 3.1 roadmap — **Khối nội dung (Content Block)** + xoay vòng (spin content) trong Broadcast | ✅ Đã deploy lên server, test CRUD + tích hợp (07/07/2026). Test gửi thật xoay vòng cần chờ khung giờ 8h-21h |
| 4 | _(chưa commit)_ | Mục 3.2 roadmap — **Mục tiêu (auto kết bạn)** — model `TargetJob`/`TargetRunItem` mới, tái dùng `campaign-service.ts` có sẵn (trước đó là dead code, route không đăng ký) | ✅ Đã deploy lên server, **test gửi thật thành công** (07/07/2026, trong khung giờ 8h-21h) |
| 5 | _(chưa commit)_ | Mục tiêu — thêm nguồn target **Quét nhóm** (GroupMember) + `attemptFriendRequestByUid` (gửi thẳng bằng UID, không cần findUser SĐT) | ✅ Đã deploy, **test gửi thật thành công tới người lạ** (07/07/2026) — phát hiện + sửa 1 bug thật (tự kết bạn với chính mình) |
| 6 | _(chưa commit)_ | Mục tiêu — **Tin chào khi khách chấp nhận kết bạn** (welcome message): pass 2 trong target-cron đối chiếu `FriendshipAttempt.state='accepted'`, nội dung gõ tay hoặc xoay vòng Khối nội dung, bật/tắt được cả cho job đã chạy (backfill item cũ) | ⬜ Chưa deploy — cần build + migrate (`20260707120000_target_welcome_message`) |
| 7 | _(chưa commit)_ | Broadcast — **nguồn "Bạn bè đã kết bạn"**: gửi tới `Friend.friendshipStatus='accepted'` của nick (UID sẵn, vào thẳng hộp chat) thay vì tệp SĐT người lạ. Modal thêm 2 tab nguồn + cảnh báo gửi người lạ | ⬜ Chưa deploy — cần build + migrate (`20260707140000_broadcast_source_friends`) |

Repo: [huynhthuan12321/ZaloCRM-CorepViet](https://github.com/huynhthuan12321/ZaloCRM-CorepViet), nhánh `main`.
Server: `/opt/ZaloCRM-CorepViet` (Docker Compose) — khớp 100% với vòng 5 (chưa push code vòng 3+4+5 lên GitHub).

> **Kiểm tra chéo toàn bộ ZaloCRM (07/07/2026):** đã audit trực tiếp code (không suy đoán) để xác nhận
> tính năng nào thật sự có/thiếu trong bản Community. Xem mục **1b** bên dưới — phát hiện quan trọng:
> `campaign-service.ts` (Mục tiêu) là code THẬT, hoạt động được, nhưng route của nó **chưa từng được
> đăng ký** trong `app.ts` → hoàn toàn không gọi được trước khi mình sửa ở vòng 4.

---

## 1. Bối cảnh

Bản Community chỉ có 2 mục Marketing: **Quét nhóm** và **Tệp khách hàng** (broadcast thủ công).
Các tính năng EE (Mục tiêu, Phiên chăm sóc, Luồng kịch bản, Khối nội dung, Broadcast tự động, Bot Auto, Zalo Ads Lead Form) không có trong mã nguồn mở.

**Pháp lý:** code mới hoàn toàn trên nền AGPL-3.0 (không copy code EE) → hợp pháp.
Dùng nội bộ: không ràng buộc. Nếu phân phối/bán SaaS: phải công khai mã nguồn phần tự viết (AGPL §13) và không dùng thương hiệu "ZCRM".

---

## 1b. Kiểm tra chéo toàn bộ ZaloCRM (07/07/2026) — checklist đã/chưa triển khai

Audit trực tiếp code (đọc file, không suy đoán từ tên biến/model) để xác nhận trạng thái thật.
Kiến trúc gốc: `backend/src/_ee/` + `frontend/src/_ee/` (bundle EE) **không tồn tại** trong repo này —
mọi hook EE fallback về no-op (`shared/ee-registry/automation.ts`, `.../integrations.ts`), mọi route
EE fallback về mảng rỗng (`frontend/src/_ee-stubs/`). Schema Prisma vẫn giữ đủ model EE (vì migration
dùng chung DB) nên *trông* như đã có sẵn — nhưng code đọc/ghi ý nghĩa thì thường không có.

| Tính năng | Model DB | Backend | Frontend | Kết luận |
|---|---|---|---|---|
| Broadcast tự động | `BroadcastJob`/`Run`/`RunItem` | ✅ đầy đủ (tự viết) | ✅ đầy đủ (tự viết) | **Xong** (mục 2) |
| Khối nội dung | `ContentBlock` | ✅ đầy đủ (tự viết) | ✅ đầy đủ (tự viết) | **Xong** (mục 2c) |
| **Mục tiêu** (auto kết bạn) | `FriendshipAttempt` — đầy đủ | `campaign-service.ts` thật (gọi Zalo API thật) nhưng `campaign-routes.ts` **chưa từng đăng ký trong `app.ts`** → chết, gọi không được | Chỉ có nhãn tên trong `ROUTE_TITLES`, không route thật | Dead code → **đã tự triển khai lại** (mục 2d) |
| Phiên chăm sóc | `CareSession`/`CareSessionEvent` — đầy đủ | Chỉ bị đọc (`groupBy`) cho báo cáo/filter, không có engine tạo/đóng phiên | Không có trang | Nền có, chưa dùng — **chưa làm** |
| Luồng kịch bản | `AutomationSequence`/`SequenceStep` (không phải tên "Flow" như đoán ban đầu) — đầy đủ | Chỉ đọc cho báo cáo | Không có trang | Nền có, chưa dùng — **chưa làm** |
| Bot Auto (trả lời tự động) | Không có | 0 logic keyword/auto-reply; hook EE (`onCustomerReaction`, `sendStrangerFollowUp`) toàn no-op | Không có | **Chưa bắt đầu** |
| Zalo Ads Lead Form | Chỉ có type enum `LeadSource`, không có model | Không có file adapter nào — `providers/` chỉ có Google Sheets, Telegram bot/bridge, Zapier webhook chung | Chỉ có nhãn tên | **Chưa bắt đầu** |

**Đính chính so với ghi chú cũ:** mục 3.6 (Zalo Ads) từng ghi "repo đã có nền Multi-Source Lead Ads
(FB/TikTok) trong `list-import-service.ts`" — **không đúng**. File đó chỉ parse paste-text/CSV đã
tách cột sẵn (số điện thoại VN), không gọi API lead-ads nào của FB/TikTok/Zalo Ads/Google.

---

## 2. Đã triển khai: Broadcast tự động

Gửi tin hàng loạt tới **Tệp khách hàng** theo lịch, gửi rải chống block.

### Tính năng

| Hạng mục | Chi tiết |
|---|---|
| Lịch gửi | 1 lần (chọn ngày giờ) · Hàng ngày (giờ VN) · Hàng tuần (chọn thứ + giờ) |
| Nội dung | Text + biến `{{ten}}` (tên khách), `{{sdt}}` (SĐT) + ảnh kèm (URL từ Kho media) |
| Chống block | Giãn cách ngẫu nhiên 30–90s/tin (chỉnh được) · trần tin/lần chạy (mặc định 50, max 500) · tôn trọng trần tin/ngày của nick (SdkLimit) — nick chạm trần thì tự chờ, không tính lỗi |
| Người nhận | Entry trong tệp có `hasZalo=true`. UID resolve đúng theo nick gửi (cùng nick quét → dùng UID sẵn; khác nick → `findUser` theo SĐT) |
| Vận hành | Pause / Resume / Chạy ngay / Xoá · log từng người nhận (gửi/lỗi/bỏ qua) · UI tự refresh 15s khi đang gửi |
| Worker | Cron 30s/tick, mỗi run gửi tối đa 1 tin/tick (≈2 tin/phút) · job `once` xong tự chuyển `done` · `daily/weekly` tự tính lần chạy kế tiếp |

### File đã thêm / sửa

**Backend (Fastify + Prisma):**

| File | Vai trò |
|---|---|
| `backend/src/modules/broadcast/broadcast-service.ts` | Helpers thuần: render biến, tính lịch chạy kế tiếp (UTC+7), random delay |
| `backend/src/modules/broadcast/broadcast-cron.ts` | Worker cron 30s: kích job đến hạn, gửi rải tin, ghi log |
| `backend/src/modules/broadcast/broadcast-routes.ts` | REST API `/api/v1/broadcast-jobs` (CRUD + run-now + log items) |
| `backend/prisma/schema.prisma` | Thêm 3 model: `BroadcastJob`, `BroadcastRun`, `BroadcastRunItem` |
| `backend/prisma/migrations/20260706000000_broadcast_jobs/migration.sql` | Migration additive (chỉ thêm bảng mới, an toàn dữ liệu) |
| `backend/src/app.ts` | Đăng ký routes + start cron (2 chỗ, có comment `Community extension`) |

**Frontend (Vue 3 + Vuetify):**

| File | Vai trò |
|---|---|
| `frontend/src/views/marketing/BroadcastsView.vue` | Trang quản lý broadcast: danh sách job, modal tạo, modal log gửi |
| `frontend/src/router/index.ts` | Route `/marketing/broadcasts` (name `CE.Broadcasts`) |
| `frontend/src/views/marketing/CommunityMarketingShell.vue` | Thêm menu "Broadcast tự động" |

### API endpoints

```
GET    /api/v1/broadcast-jobs                          — danh sách job (org scope)
POST   /api/v1/broadcast-jobs                          — tạo job
GET    /api/v1/broadcast-jobs/:id                      — chi tiết + 10 run gần nhất
PATCH  /api/v1/broadcast-jobs/:id                      — sửa / pause / resume
POST   /api/v1/broadcast-jobs/:id/run-now              — chạy ngay
DELETE /api/v1/broadcast-jobs/:id                      — xoá (cascade log)
GET    /api/v1/broadcast-jobs/:id/runs/:runId/items    — log từng người nhận
```

### Triển khai lên server

```bash
cd /path/to/ZaloCRM
docker compose up -d --build app
docker exec zalo-crm-app npx prisma migrate deploy
docker compose restart app
# Verify: thấy "[broadcast-cron] scheduled every 30s"
docker logs zalo-crm-app --tail 20 | grep broadcast
```

### Lưu ý vận hành

- Test với tệp nhỏ (5–10 số) trước khi gửi tệp lớn.
- Gửi tới người **chưa kết bạn** có thể rơi vào hộp "người lạ" hoặc thất bại → nên chạy kết bạn trước (xem Mục tiêu bên dưới).
- Ảnh kèm: URL phải là link server truy cập được (S3_PUBLIC_URL của MinIO/R2).
- Nội dung nên cá nhân hoá (dùng `{{ten}}`) và đổi mẫu thường xuyên để giảm rủi ro Zalo đánh spam.

### Kết quả test gửi thật (06/07/2026)

Tạo tệp test 1 số an toàn (0363556463) → resolve UID qua `find-zalo` → tạo job `once` →
`run-now` → cron gửi thành công trong tick kế tiếp (`sentCount:1, failedCount:0`), job tự
chuyển `done`. Đã dọn dữ liệu test sau khi xác nhận.

---

## 2b. Hoàn thiện Broadcast: RBAC + khung giờ gửi + chọn ảnh + báo cáo (06/07/2026)

### RBAC — chỉ owner/admin quản lý broadcast
`backend/src/modules/broadcast/broadcast-routes.ts`: thêm `requireBroadcastAdmin()`,
áp cho POST/PATCH/DELETE/run-now (tạo/sửa/xoá/chạy). GET (xem danh sách/log) vẫn mở cho
mọi user đăng nhập trong org. Test: owner vẫn thao tác bình thường, không regression.

### Khung giờ gửi 8h–21h — tránh phiền khách ban đêm
`backend/src/modules/broadcast/broadcast-service.ts`: thêm `isWithinSendWindow(at)` (giờ VN,
UTC+7). Gate đặt trong `broadcast-cron.ts::processRun()` — ngoài khung giờ thì tick bỏ qua,
không gửi, không tính lỗi cho khách, tự thử lại tick sau. Test thật lúc 22:57 (ngoài giờ):
run được tạo nhưng `sentCount:0` — không tin nào rời hệ thống.

### Chọn ảnh từ Kho media trong modal
`frontend/src/views/marketing/BroadcastsView.vue`: thay ô dán URL bằng nút "Chọn từ Kho
media" → modal grid gọi `listMedia({ kind: 'image' })` từ `@/api/media`, click ảnh để chọn.

### Báo cáo thống kê Broadcast
Trang mới `/reports/broadcast` (tab "Broadcast" trong menu Báo cáo + `ReportsShell`):

| File | Vai trò |
|---|---|
| `backend/src/modules/broadcast/broadcast-report-routes.ts` | `GET /api/v1/reports/broadcast?from=&to=` — KPI tổng, breakdown theo nick, theo tệp, 20 run gần nhất |
| `frontend/src/views/reports/BroadcastReport.vue` | Trang báo cáo: KPI card + 2 bảng (theo nick/theo tệp) + bảng lịch sử run |
| `frontend/src/views/reports/ReportsShell.vue` | Thêm tab "Broadcast" |
| `frontend/src/router/index.ts` | Route `reports/broadcast` (name `Reports.Broadcast`) |
| `frontend/src/layouts/DefaultLayout.vue` | Thêm mục "Broadcast tự động" vào dropdown Báo cáo sidebar |

Chỉ owner/admin xem (khớp quyền quản lý broadcast). Test aggregation trên server: chèn 1
run giả (8 gửi/2 lỗi/1 bỏ qua) → API trả đúng `successRatePct: 80`, join tên nick + tên tệp
chính xác. Đã dọn dữ liệu test.

---

## 2c. Đã triển khai: Khối nội dung (Content Block) (07/07/2026)

Kho nội dung tái dùng (text + biến động + ảnh) cho Broadcast tự động — chọn nhiều khối
cho 1 job để **xoay vòng** (spin content) mỗi tin gửi, tránh gửi 1 mẫu giống hệt nhau.

> Model độc lập `ContentBlock` thay vì mở rộng `MessageTemplate` như dự tính ban đầu — vì
> khảo sát code thấy `MessageTemplate` (schema có sẵn: folder/shortcut/tags/usageCount) lại
> **không có route CRUD nào trong mã nguồn Community** (chỉ dùng nội bộ cho welcome-message/
> scoring), tức tính năng "gõ `/` chèn mẫu" thực chất là EE. Xây `ContentBlock` riêng, gọn,
> mở cho mọi user (không cần owner/admin) — giống MessageTemplate lẽ ra phải có.

### File đã thêm / sửa

| File | Vai trò |
|---|---|
| `backend/prisma/schema.prisma` | Model `ContentBlock` (name/messageText/imageUrl/usageCount) + `BroadcastJob.contentBlockIds String[]` |
| `backend/prisma/migrations/20260707000000_content_blocks/migration.sql` | Migration additive |
| `backend/src/modules/content-blocks/content-block-routes.ts` | CRUD `/api/v1/content-blocks` (mở cho mọi user đăng nhập) |
| `backend/src/modules/broadcast/broadcast-routes.ts` | Validate: `messageText` không bắt buộc nếu có `contentBlockIds`; join tên khối cho UI |
| `backend/src/modules/broadcast/broadcast-cron.ts` | `resolveJobContent()` — xoay vòng theo `processedCount % số khối`, giữ đúng thứ tự đã chọn; tăng `usageCount` khối khi gửi thành công |
| `frontend/src/views/marketing/ContentBlocksView.vue` | Trang quản lý khối: tạo/sửa/xoá, chọn ảnh Kho media |
| `frontend/src/views/marketing/BroadcastsView.vue` | Modal tạo broadcast: tab "Gõ tay" / "Khối nội dung (xoay vòng)" — multi-select có đánh số thứ tự |
| `frontend/src/router/index.ts`, `CommunityMarketingShell.vue` | Route + menu `/marketing/content-blocks` |

### Test đã chạy (07/07/2026)
- CRUD `/api/v1/content-blocks`: tạo 2 khối, list, auth guard (401 không token) — đúng.
- Tạo broadcast job chỉ với `contentBlockIds` (không `messageText`) → được chấp nhận, không lỗi validate.
- `GET /broadcast-jobs` trả `contentBlocks: [{id,name}]` đúng thứ tự đã chọn.
- **Chưa test được** gửi thật xoay vòng nhiều khối (lúc test là 07:11 VN, trước khung giờ 8h-21h) — logic xoay vòng (`resolveJobContent`) đã review kỹ, dùng cùng pipeline gửi đã test thành công ở vòng 1. Nên test lại bằng tay khi có nhu cầu gửi thật.
- Đã dọn toàn bộ dữ liệu test (2 khối, 1 tệp, 1 job).

---

## 2d. Đã triển khai: Mục tiêu (auto kết bạn) (07/07/2026)

Tự động gửi lời mời kết bạn tới **Tệp khách hàng** — chạy liên tục (không lịch định kỳ
như Broadcast) tới khi hết đối tượng hoặc chạm tổng tối đa. Tái dùng `campaign-service.ts`
có sẵn (`attemptFriendRequest` — vốn là dead code vì route chưa đăng ký) thay vì viết lại
từ đầu, để giữ đúng audit trail `FriendshipAttempt` + mirror `Friend` "Đã gửi lời mời" sẵn có.

> **Rủi ro kỹ thuật quan trọng đã xử lý:** `attemptFriendRequest()` tạo row `FriendshipAttempt`
> (unique theo nick+contact) **trước khi** gọi Zalo API. Nếu cron cứ gọi đều khi nick đã chạm
> trần `friend_action` (30/ngày mặc định), sẽ "đốt" vĩnh viễn từng contact thành lỗi — không
> thể thử lại contact đó với nick này nữa. Giải pháp: pre-check qua `zaloRateLimiter.checkLimits()`
> (đã có sẵn, không ghi nhận gì) trước khi thử — nick chạm trần thì bỏ qua cả tick, không đụng
> tới contact nào.

### File đã thêm / sửa

| File | Vai trò |
|---|---|
| `backend/prisma/schema.prisma` | Model `TargetJob` (tệp/nick/lời nhắn/tổng tối đa/giãn cách) + `TargetRunItem` (log) |
| `backend/prisma/migrations/20260707010000_target_jobs/migration.sql` | Migration additive |
| `backend/src/modules/target/target-routes.ts` | CRUD `/api/v1/target-jobs` (owner/admin only, giống Broadcast) |
| `backend/src/modules/target/target-cron.ts` | Worker 30s: pre-check rate-limit → resolve Contact (`resolveOrCreateContact` có sẵn) nếu entry chưa có → `attemptFriendRequest` (campaign-service có sẵn) → ghi log |
| `frontend/src/views/marketing/TargetsView.vue` | Trang quản lý: tạo/pause/resume/xoá, log kết quả từng đối tượng |
| `frontend/src/router/index.ts`, `CommunityMarketingShell.vue` | Route + menu `/marketing/targets` (đặt trước Broadcast trong menu — nên chạy trước) |

### Test đã chạy (07/07/2026, trong khung giờ 8h-21h)
- Auth guard đúng (401 không token).
- Tạo tệp test 1 số, `find-zalo` resolve UID thật.
- Tạo Target job → cron tick sau ~30s → **gọi Zalo API thật** (`sendFriendRequest`).
- Kết quả: số test đã là bạn của nick từ trước → Zalo trả lỗi hợp lệ "User đã là bạn bè" →
  ghi nhận đúng `failedCount:1`, log rõ lý do, job tự chuyển `done` sau khi hết đối tượng.
  Xác nhận toàn bộ pipeline (tạo Contact → FriendshipAttempt → gọi Zalo API → xử lý lỗi
  không crash) chạy đúng end-to-end. Chưa test được nhánh "sent" thành công (cần 1 số lạ
  chưa kết bạn — không có sẵn số test phù hợp).
- Đã dọn dữ liệu test.

### Còn thiếu (fast-follow) — ĐÃ XONG 2/2 (07/07/2026, xem mục 2e)
- [x] Nguồn target từ **Quét nhóm** (GroupMember)
- [x] Test nhánh "gửi thành công" thực tế
- Không thấy nghẽn nào ở phần "chạy TRƯỚC Broadcast" — chỉ là gợi ý vận hành (đặt trước
  Broadcast trong menu để nhắc thứ tự), không có ràng buộc kỹ thuật giữa 2 tính năng.

---

## 2e. Mở rộng Mục tiêu: nguồn Quét nhóm + test gửi thành công thật (07/07/2026)

### Nguồn target thứ 2: Quét nhóm (GroupMember)
`TargetJob.sourceType`: `'customer_list'` (như cũ, cần `findUser` qua SĐT) hoặc
`'group_scan'` — nguồn mới, dùng kết quả **Quét nhóm** (`GroupScan`/`GroupMember`).
Khác biệt quan trọng: `GroupMember` đã có sẵn `memberUid` (từ lúc quét), **không cần
`findUser`** — gửi thẳng lời mời. Thêm hàm mới `attemptFriendRequestByUid()` (nửa sau
của `attemptFriendRequest`, bỏ bước discovery) trong `campaign-service.ts`.

| File | Vai trò |
|---|---|
| `backend/prisma/migrations/20260707020000_target_group_scan_source/migration.sql` | Thêm `source_type`, `group_scan_id`; `customer_list_id` thành optional |
| `backend/src/modules/campaign/campaign-service.ts` | `attemptFriendRequestByUid()` — gửi thẳng bằng UID có sẵn |
| `backend/src/modules/target/target-cron.ts` | Tách `processCustomerListTarget()` / `processGroupScanTarget()` theo `sourceType` |
| `backend/src/modules/target/target-routes.ts` | Validate nguồn (nick gửi phải trùng nick đã quét); endpoint mới `GET /target-jobs/group-scans/:accountId` liệt kê scan khả dụng (kèm tên nhóm qua join `Conversation.groupName`) |
| `frontend/src/views/marketing/TargetsView.vue` | Tab chọn nguồn "Tệp khách hàng" / "Nhóm đã quét", dropdown scan hiện tên nhóm + số chưa kết bạn |

### Bug thật phát hiện + sửa khi test
`GroupMember` roster của 1 nhóm **luôn bao gồm chính nick đang quét** (nick là member
của group của chính nó). Query đầu tiên không loại trừ → `resolveOrCreateContact` tạo
**Contact trùng tên chính nick** ("Huỳnh Thuận Cờ Rếp Việt"), rồi `sendFriendRequest`
tới UID của chính mình → Zalo trả lỗi hợp lệ "User không hợp lệ". Sửa: query loại trừ
`memberUid = self.zaloUid` (lấy từ `ZaloAccount.zaloUid`) trước khi chọn target. Đã dọn
Contact/FriendshipAttempt lỗi bằng SQL trực tiếp trước khi deploy lại.

### Test đã chạy (07/07/2026, trong khung giờ 8h-21h)
- 2 scan có sẵn trên server (227 và 13 member chưa kết bạn) — endpoint liệt kê scan hoạt động đúng.
- Lần test đầu: dính bug tự kết bạn với chính mình (xem trên) → sửa → deploy lại.
- Lần test 2: tạo job `sourceType=group_scan`, `maxTotal=1` → cron tick → **gửi lời mời kết bạn
  thật thành công tới người lạ thật** ("Đào Văn Mong", UID thật) — `sentCount:1`, không lỗi.
  **Đây là bằng chứng đầu tiên xác nhận nhánh "sent" (gửi thành công) hoạt động đúng**
  (trước đó chỉ test được nhánh lỗi "đã là bạn bè" vì không có số lạ phù hợp).
- Đã xoá `TargetJob` test, **giữ nguyên** `Contact`/`FriendshipAttempt`/lời mời đã gửi vì đây
  là dữ liệu CRM thật (không phải rác test) — sales có thể theo dõi tiếp trong Friends/Contact.

---

## 2f. Đã code: Tin chào khi khách chấp nhận kết bạn (07/07/2026 — vòng 6, chưa deploy)

Hoàn thiện phễu EE: **KB gửi → Đồng ý → Chào**. Job Mục tiêu bật "Gửi tin chào khi khách
chấp nhận kết bạn" → mỗi lời mời gửi thành công được đánh `welcomeStatus='waiting'`; pass 2
của target-cron (mỗi 30s) join item waiting × `FriendshipAttempt.state='accepted'` (do
`friend-event-handler` cập nhật từ event Zalo thật) → gửi tin chào rải (delay của job,
khung giờ 8h–21h, né RATE_LIMITED không tính lỗi), tối đa 1 tin/job/tick.

Điểm đáng chú ý:

- Nội dung: gõ tay (`welcomeMsg`, biến `{{ten}}`/`{{sdt}}`) hoặc **xoay vòng Khối nội dung**
  (`welcomeBlockIds`, tái dùng `resolveJobContent` — giờ export từ broadcast-cron).
- Job `done` (hết lời mời) **vẫn tiếp tục chào** khách chấp nhận muộn; chỉ `paused` dừng cả hai.
- Bật chào cho job đã chạy (PATCH): backfill `contactId` cho item cũ từ FriendshipAttempt
  (khớp nick + `zaloUidFound`) rồi đánh `waiting` — item gửi trước vòng 6 cũng được chào.
- Card job hiển thị `🤝 N đã chào`; log item thêm cột Tin chào (Chờ chấp nhận / Đã chào / Chào lỗi).

File sửa: `backend/prisma/schema.prisma` (+6 cột TargetJob, +4 cột TargetRunItem),
migration `20260707120000_target_welcome_message`, `target/target-cron.ts` (pass 2),
`target/target-routes.ts` (validate + backfill), `broadcast/broadcast-cron.ts` (export
resolveJobContent), `frontend/.../TargetsView.vue` (toggle + tabs + cột log).

Deploy: như mọi vòng — `docker compose up -d --build app` → `npx prisma migrate deploy` →
restart → test: tạo mục tiêu bật chào với tệp nhỏ, dùng nick phụ chấp nhận lời mời, chờ ≤1
phút thấy tin chào + `🤝 1 đã chào`.

---

## 2g. Đã code: Broadcast gửi tới Bạn bè đã kết bạn (07/07/2026 — vòng 7, chưa deploy)

**Vấn đề phát hiện:** "Tệp khách hàng" là danh sách **SĐT** (import/paste/lead ads), KHÔNG phải
danh bạ bạn bè. Broadcast cũ gửi tới entry `hasZalo=true` — tức gửi cho **người lạ chưa kết bạn**.
Gửi tin Zalo cho người chưa kết bạn thường rơi vào hộp "tin nhắn người lạ" (khách ít thấy) hoặc
bị chặn, và dễ làm nick bị báo cáo spam. Đó là lý do trước đây "không chọn được tệp khách đã kết bạn".

**Giải pháp (giai đoạn 1):** Broadcast thêm nguồn người nhận thứ 2 — **Bạn bè đã kết bạn**:

- `BroadcastJob.sourceType`: `'customer_list'` (tệp SĐT, như cũ) hoặc `'friends'`.
- Nguồn `friends`: worker lấy `Friend.friendshipStatus='accepted'` của nick gửi, dùng `zaloUidInNick`
  có sẵn — **không cần findUser**, tin vào thẳng hộp chat. An toàn hơn hẳn.
- Modal tạo: 2 tab nguồn (mặc định **Bạn bè**), hiện số bạn bè của nick (endpoint
  `/broadcast-jobs/friend-count/:accountId`); tab Tệp KH có **cảnh báo** gửi người lạ + gợi ý chạy
  Mục tiêu kết bạn trước.

File sửa: `schema.prisma` (BroadcastJob +sourceType, customerListId nullable),
migration `20260707140000_broadcast_source_friends`, `broadcast/broadcast-cron.ts`
(`pickListRecipient` / `pickFriendRecipient`), `broadcast/broadcast-routes.ts` (validate + friend-count),
`frontend/.../BroadcastsView.vue` (2 tab nguồn).

**Giai đoạn 2 (chưa làm) — Tạo tệp từ bộ lọc CRM:** cho lọc Khách hàng/Bạn bè (đã kết bạn, tag,
pipeline stage, lead score…) rồi **lưu thành Tệp khách hàng** — dùng được cho cả Broadcast lẫn Mục
tiêu. Linh hoạt hơn nguồn "toàn bộ bạn bè". Xem mục 3 roadmap.

---

## 3. Cần triển khai tiếp (roadmap tự code các tính năng EE còn lại)

### 3.0. Tạo tệp khách hàng từ bộ lọc CRM — ~2-3 ngày (đề xuất ưu tiên)
Lọc danh sách Khách hàng/Bạn bè theo điều kiện (đã kết bạn với nick X, có tag Y, ở pipeline stage Z,
lead score ≥ N, nguồn lead…) → nút "Lưu thành Tệp khách hàng". Tệp này dùng làm nguồn cho Broadcast
(gửi đúng nhóm đã kết bạn + đúng phân khúc) và Mục tiêu. Đây là mảnh linh hoạt nhất còn thiếu để
"chọn đúng khách để gửi".


Thứ tự đề xuất từ dễ → khó, tái dùng nền móng có sẵn:

### 3.3. Luồng kịch bản (Flow/Drip automation) — ~2-4 tuần, khó nhất
- Model `Flow` + `FlowStep` (trigger → chờ X ngày → gửi block → rẽ nhánh theo phản hồi/tag).
- Model `FlowEnrollment`: theo dõi từng khách đang ở bước nào.
- Engine cron mỗi phút (theo mẫu `broadcast-cron.ts` vừa viết).
- Trigger gợi ý: khách vào tệp, gắn tag, kết bạn thành công, khách nhắn tin.

### 3.4. Phiên chăm sóc (Care session) — ~1 tuần (sau Flow)
- Thực chất = gán Flow cho 1 tệp khách + dashboard tiến độ (đã chăm bước mấy, tỉ lệ phản hồi).

### 3.5. Bot Auto (trả lời tự động) — ~1-2 tuần
- Hook vào `zalo-listener-factory.ts` (listener tin nhắn đến đã có sẵn).
- Rule keyword → trả lời mẫu; nâng cao: nối module AI có sẵn (Anthropic/OpenAI/Gemini) trả lời theo ngữ cảnh.

### 3.6. Zalo Ads Lead Form — ~3-5 ngày
- Webhook endpoint nhận lead từ Zalo OA/Ads → tạo `CustomerListEntry` theo `#mã` chiến dịch.
- Lưu ý: repo đã có nền Multi-Source Lead Ads (FB/TikTok) trong `list-import-service.ts` → làm theo mẫu đó.

### Việc nhỏ nên làm sớm — ĐÃ XONG 4/4 (06/07/2026)
- [x] Chạy build + test thực tế tính năng Broadcast trên server — gửi thật thành công tới số test 0363556463
- [x] Chọn ảnh từ Kho media trực tiếp trong modal (thay vì dán URL) — `BroadcastsView.vue` gọi `listMedia()`, grid chọn ảnh
- [x] Thêm RBAC: giới hạn quyền tạo broadcast theo nhóm quyền — POST/PATCH/DELETE/run-now chỉ owner/admin (`requireBroadcastAdmin` trong `broadcast-routes.ts`)
- [x] Thống kê broadcast vào trang Báo cáo (tỉ lệ gửi thành công theo nick/tệp) — trang `/reports/broadcast` (xem mục 2b)
- [x] Cửa sổ giờ gửi (không gửi ngoài 8h–21h) — tránh phiền khách ban đêm — `isWithinSendWindow()` trong `broadcast-service.ts`, gate trong `processRun()`, đã test thật lúc 22:57 (ngoài giờ) → run tạo nhưng sentCount=0

---

## 4. Nền móng có sẵn trong repo (tham khảo khi code tiếp)

| Thành phần | File | Dùng cho |
|---|---|---|
| Gửi tin/ảnh qua zca-js (đã gate rate-limit) | `backend/src/shared/zalo-operations.ts` (`zaloOps`) | Mọi tính năng gửi tin |
| Trần tin/ngày/nick + burst | `backend/src/modules/zalo/sdk-limit-service.ts` + `zalo-rate-limiter.ts` | Chống block |
| Mẫu worker cron + tenant | `backend/src/modules/broadcast/broadcast-cron.ts`, `engagement/engagement-cron.ts` | Flow engine, Mục tiêu |
| Dispatcher kết bạn | `backend/src/modules/campaign/campaign-service.ts` | Mục tiêu |
| Tệp KH + enrichment UID | `backend/src/modules/lists/` | Nguồn đối tượng mọi automation |
| Listener tin nhắn đến | `backend/src/modules/zalo/zalo-listener-factory.ts` | Bot Auto, trigger Flow |
| AI providers | `backend/src/modules/ai/` | Bot Auto thông minh |
| Import lead đa nguồn | `backend/src/modules/lists/list-import-service.ts` | Zalo Ads Lead Form |
