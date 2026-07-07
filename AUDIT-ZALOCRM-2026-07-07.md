# Audit mã nguồn ZaloCRM-CorepViet

> Báo cáo audit cấp staff engineer (Node.js/TypeScript · Prisma/PostgreSQL · Vue 3 · automation nhắn tin)
> Ngày: 2026-07-07 · Nhánh: `master` · Người thực hiện: audit tự động (đọc file thật, trích dẫn `path:dòng`)

## Nguyên tắc & phạm vi

- Mọi phát hiện đều dẫn `path:dòng` từ file đã đọc trực tiếp — không suy đoán.
- Phân mức: 🔴 Nghiêm trọng (mất dữ liệu / rò rỉ chéo org / spam-khoá nick) · 🟠 Cao (sai logic ảnh hưởng người dùng) · 🟡 Trung bình · ⚪ Nit/cải thiện.
- Ưu tiên độ sâu cho §B/§C/§D/§F (nhóm "cần soi kỹ nhất"). §E/§G/§H kiểm tra có trọng tâm — phần **chưa** kiểm chứng được ghi rõ, không bịa lỗi cho đủ.

**File đã đọc trực tiếp:**
`backend/src/app.ts`, `shared/tenant/tenant-context.ts`, `shared/tenant/tenant-guard.ts`, `shared/database/prisma-client.ts`, `config/index.ts`, `backend/.env.example`, `modules/broadcast/broadcast-cron.ts`, `modules/broadcast/broadcast-service.ts`, `modules/broadcast/broadcast-routes.ts`, `modules/broadcast/broadcast-report-routes.ts`, `modules/target/target-cron.ts`, `modules/target/target-routes.ts`, `modules/content-blocks/content-block-routes.ts`, `modules/campaign/campaign-service.ts`, `shared/zalo-operations.ts`, `modules/zalo/zalo-rate-limiter.ts`, `shared/crypto/session-crypto.ts`, `modules/api/public-api-routes.ts`, `modules/api/webhook-settings-routes.ts` (một phần), `frontend/src/views/marketing/TargetsView.vue`, `prisma/schema.prisma` (đoạn BroadcastJob/TargetJob/FriendshipAttempt/BroadcastRunItem/TargetRunItem), 2 migration mới nhất, `tests/chat-routes.test.ts`.

---

## §A. Kiến trúc & khởi động

| # | Mức | Vị trí | Mô tả lỗi + hậu quả | Tái hiện | Hướng khắc phục |
|---|---|---|---|---|---|
| A1 | ⚪ Nit | `app.ts:409-414` | `startBroadcastCron(io)` / `startTargetCron()` KHÔNG có guard `config.nodeEnv !== 'test'`, trong khi các worker cùng khối (dòng 397, 420-431, 445-448, 454-457) đều có. Đã xác minh `chat-routes.test.ts` dựng `Fastify()` riêng + `vi.mock`, KHÔNG import `app.ts` → `bootstrap()` không chạy trong vitest hiện tại → rủi ro thực tế thấp. | Chỉ xảy ra nếu về sau có test/e2e import `app.ts` trực tiếp. | Thêm `if (config.nodeEnv !== 'test')` quanh 2 dòng cho nhất quán, phòng khi có e2e test sau này. |

**Đã kiểm tra, không thấy lỗi** ở phần còn lại: mọi route (app.ts:261-347) đăng ký đúng 1 lần, không route "chết"; thứ tự khởi tạo Prisma → Socket.IO → zaloPool → registerSocketAuth → routes → cron hợp lý, không phụ thuộc vòng.

---

## §B. Đa tenant & phân quyền — 🔴 nhóm rủi ro cao nhất

| # | Mức | Vị trí | Mô tả lỗi + hậu quả | Tái hiện | Hướng khắc phục |
|---|---|---|---|---|---|
| B1 | 🔴 Nghiêm trọng | `broadcast-routes.ts:211` (PATCH) + `broadcast-cron.ts:229-232` (`resolveJobContent`) | PATCH nhận `contentBlockIds` từ client và gán thẳng `data.contentBlockIds = b.contentBlockIds.filter(Boolean)` **không kiểm tra id thuộc org nào** (khác POST — dòng 138 có `contentBlock.count({where:{id:{in}, orgId}})`). Khi cron chạy, `resolveJobContent()` fetch `contentBlock.findMany({where:{id:{in: job.contentBlockIds}}})` — **không lọc `orgId`**. Hậu quả: admin org A PATCH `contentBlockIds` là id của `ContentBlock` org B → nội dung riêng org B bị cron gửi ra ngoài qua nick org A. | `PATCH /api/v1/broadcast-jobs/:id` body `{contentBlockIds:["<id-org-khác>"]}` → "chạy ngay" → log run item chứa nội dung org B. | (1) Thêm validate ownership giống POST vào nhánh PATCH trước khi gán. (2) Vá gốc: thêm `orgId: job.orgId` vào `where` của `resolveJobContent()` (defense-in-depth). |
| B2 | 🔴 Nghiêm trọng | `target-routes.ts:216-242` (PATCH) | `validateWelcome()` (dòng 40-50) return sớm `null` khi `!b.welcomeEnabled` → **bỏ qua kiểm tra ownership `welcomeBlockIds`**. Khai thác 2 bước: (a) PATCH `{welcomeEnabled:false, welcomeBlockIds:["<id-org-khác>"]}` → lưu thẳng DB không validate (dòng 221); (b) PATCH `{welcomeEnabled:true}` (không kèm `welcomeBlockIds`) → validateWelcome chạy với `blockIds=[]` nên pass, dòng 221 không ghi đè → giá trị bẩn từ bước (a) vẫn còn và giờ active. `target-cron.ts` → `processWelcome` → `resolveJobContent` (cùng lỗ hổng B1). | 2 PATCH liên tiếp như trên → có khách chấp nhận kết bạn → tin chào chứa nội dung org khác được gửi. | Cùng gốc B1: validate ownership `welcomeBlockIds` bất kể `welcomeEnabled`; thêm `orgId` filter vào `resolveJobContent`. |
| B3 | 🟠 Cao (kiến trúc) | `prisma-client.ts:113-153`, `tenant-guard.ts:27-43`, `config/index.ts:120-123,160`, `.env.example:69,76` | Phòng-thủ-lớp-2 cho tenant isolation **tắt mặc định**: `TENANT_GUARD_MODE=off`, `RLS_SET_CONFIG=false`. `tenant-rls.sql` nằm ở `prisma/rls/` — **ngoài** `prisma/migrations/` nên KHÔNG tự chạy qua `prisma migrate deploy`. Ngoài ra `checkTenantGuard()` chỉ kiểm tra "có tenant context hay không", KHÔNG kiểm `where.orgId` đúng org → dù bật `enforce` cũng **không** bắt được lỗi B1/B2 (context vẫn tồn tại vì chạy trong request đã auth). Kết luận: cách ly cross-org dựa 100% vào kỷ luật thủ công `where:{orgId}`. | B1/B2 chính là bằng chứng thiếu lưới an toàn. | (1) Bật `TENANT_GUARD_MODE=warn` trên staging để lộ call-site thiếu context. (2) Áp `tenant-rls.sql` + `RLS_SET_CONFIG=true` cho ít nhất bảng automation (broadcast/target/content-block). (3) Test/CI lint: mọi Prisma call trong 3 module này phải có `orgId` trong `where` hoặc dùng id đã pre-verify. |

**RBAC — đã kiểm tra, không thấy lỗi:** `requireBroadcastAdmin` (broadcast-routes.ts:44-51) và `requireTargetAdmin` (target-routes.ts:54-61) gate đúng create/patch/delete/run-now về `role in ('admin','owner')`. `content-block-routes.ts` cố ý mở cho mọi user (comment dòng 12-13 giải thích — khối nội dung không tự gửi gì) — hợp lý.

**Chưa kiểm tra:** owner-scope Tệp KH/báo cáo (`list-routes.ts` chưa đọc đầy đủ).

---

## §C. Worker/cron & concurrency

| # | Mức | Vị trí | Mô tả lỗi + hậu quả | Tái hiện | Hướng khắc phục |
|---|---|---|---|---|---|
| C1 | 🟠 Cao | `target-cron.ts:210` + `zalo-operations.ts:617-622` (`findUser`=`friend_lookup`) + `campaign-service.ts:88-96` | Comment file (target-cron.ts:13-17) nói pre-check để tránh "đốt" contact khi nick chạm trần. Nhưng pre-check dòng 210 **chỉ check `friend_action`**. Với nguồn `customer_list`, `attemptFriendRequest()` gọi `findUser` trước — category **`friend_lookup` tách biệt**. Nếu nick chạm trần `friend_lookup` (còn quota `friend_action`) → pre-check pass → tạo `FriendshipAttempt` (unique nick+contact) → `findUser` ném `RATE_LIMITED` → attempt `state='error'` → `TargetRunItem status='failed'` → contact bị loại vĩnh viễn khỏi job (không có retry). Đúng kịch bản "đốt contact" mà code cố tránh, chỉ khác category. | Set trần `friend_lookup` daily thấp, chạy Mục tiêu nguồn "Tệp khách hàng" → `TargetRunItem.errorCode` chứa `FIND_USER_FAILED`/`RATE_LIMITED` tăng dù `friend_action` còn dư. | Mở rộng pre-check dòng 210: với `sourceType==='customer_list'` check **cả** `friend_lookup` VÀ `friend_action`. (Nguồn group_scan dùng `attemptFriendRequestByUid`, không gọi findUser → không ảnh hưởng.) |
| C2 | 🟠 Cao | `broadcast-cron.ts:128-168` (`processRun`), `target-cron.ts:143-179` (`processWelcome`) | Thứ tự là **gửi Zalo trước, ghi DB sau** (`sendMessage/sendImage` → rồi `recordItem`/`markWelcome`), không đánh dấu "đang gửi" trước. Nếu tiến trình chết/DB lỗi đúng giữa lúc gửi thành công và transaction commit → item vẫn "chưa xử lý" → tick sau chọn lại recipient đó và **gửi lần 2**. Hậu quả: khách nhận trùng tin, tăng rủi ro report/khoá nick (at-least-once). | Khó tái hiện tay; mô phỏng bằng throw lỗi trong `recordItem`/`markWelcome` ngay sau khi mock `sendMessage` resolve. | Ghi row "pending" (unique run/job + entryId) TRƯỚC khi gọi Zalo, update 'sent' sau — biến duplicate-window thành constraint-violation thay vì gửi trùng. |
| C3 | 🟡 Trung bình | `broadcast-cron.ts:114-121,174-213`, `target-cron.ts:222-227,292-303` | Dedup bằng `findMany({where:{runId/jobId}})` rồi `notIn: doneIds` — mảng `doneIds` phình tuyến tính, đọc lại toàn bộ mỗi tick. Với tệp/nhóm vài nghìn+ recipient, `NOT IN` ngày càng lớn, chi phí mỗi tick (30s) tăng dần theo thời gian chạy job. | Job tệp ~5.000-10.000 dòng, theo dõi thời gian mỗi tick tăng dần qua vài giờ. | Dùng cursor theo `rowIndex`/`lastSeenAt`, hoặc đánh dấu trực tiếp trên `CustomerListEntry`/`GroupMember` (cột `processedByJobId`) thay vì tính lại `notIn`. |
| C4 | 🟡 Trung bình (phụ thuộc triển khai) | `broadcast-cron.ts:26-41`, `target-cron.ts:38-53`, `schema.prisma:4152-4169` | Cờ `running` là biến module-level trong **1 process** — không có lock phân tán. Docker-compose hiện tại 1 instance nên rủi ro hiện tại thấp, nhưng nếu scale ≥2 replica, 2 instance có thể cùng lấy 1 `BroadcastRun` running và gửi trùng — **không có unique constraint DB** chặn cho Broadcast (khác Target có `FriendshipAttempt @@unique([zaloAccountId, contactId])` làm lưới phụ). | Chạy 2 instance backend chung DB, cùng bật 1 broadcast job → `BroadcastRunItem` có 2 row cùng `entryId` trong cùng `runId`. | Thêm `@@unique([runId, entryId])` cho `BroadcastRunItem` + tài liệu hoá "không chạy >1 instance app trừ khi có distributed lock". |
| C5 | — | `broadcast-service.ts:46-95` | Rà biên `computeNextRunAt`/`randomDelayMs`/`isWithinSendWindow`: once quá khứ → null (đúng); daily/weekly qua nửa đêm/qua tuần dùng `Date.UTC(...,+addDays,...)` rollover tháng đúng; loop 0..7 luôn tìm được ngày hợp lệ; so sánh `<=` tránh trigger lặp tức thời; VN không DST nên offset +7h cố định không lỗi; `randomDelayMs` clamp min 5s kể cả input đảo/0. **Đã kiểm tra, không thấy lỗi.** | — | — |
| C6 | — | `broadcast-cron.ts:243-257`, `target-cron.ts:181-194` | Counter và item log ghi trong cùng `$transaction([...])` — atomic đúng. **Đã kiểm tra, không thấy lỗi.** | — | — |

---

## §D. Rate-limit / chống block Zalo

| # | Mức | Vị trí | Mô tả lỗi + hậu quả | Tái hiện | Hướng khắc phục |
|---|---|---|---|---|---|
| D1 | 🟠 Cao (trade-off cần xác nhận lại) | `zalo-rate-limiter.ts:35-48` | `checkLimits()` bọc try/catch toàn bộ (kể cả lỗi từ `getEffectiveLimit()` — tức lỗi **Postgres**, không chỉ Redis) và **fail-open**: bất kỳ lỗi nào → `{allowed:true}`. Hậu quả: nếu Redis HOẶC Postgres chập chờn đúng lúc broadcast/target chạy hàng loạt, **toàn bộ rate-limit biến mất** → mọi tick vẫn gửi không giới hạn, rủi ro khoá nick hàng loạt đúng lúc hạ tầng đang sự cố. | Ngắt Redis (hoặc để `getEffectiveLimit` throw) lúc 1 broadcast job active → tin vẫn gửi liên tục không bị chặn trần. | Fail-**closed** riêng cho luồng automation hàng loạt (broadcast-cron/target-cron), giữ fail-open cho thao tác tương tác đơn lẻ của sale. |
| D2 | 🟡 Trung bình | `zalo-rate-limiter.ts:26-33,50-65` | Không có `REDIS_URL` → rate-limit rơi về `Map` in-memory **per-process**. Nếu scale ngang mà quên Redis → mỗi instance đếm trần riêng, tổng vượt trần × N. Hiện tại (1 instance, có Redis) không phải vấn đề nhưng không có guard cảnh báo. | — | Log cảnh báo lúc start nếu `NODE_ENV=production` mà Redis không kết nối được. |
| D3 | — | `zalo-operations.ts:32-45,617-622,649-652` | Category mapping đúng nhất quán: `findUser`→`friend_lookup`, `sendFriendRequest`→`friend_action`, `getAllFriends`→`contact_sync`, message/reaction/chat_action/group_*/profile/query gán khớp tên hàm. **Đã kiểm tra, không thấy lỗi** (gap ở C1 là lỗi thứ tự gọi, không phải mapping). | — | — |
| D4 | 🟡 Trung bình | `zalo-rate-limiter.ts:52,68,92,107` | Reset ngày dùng `new Date().toISOString().split('T')[0]` = **giờ UTC**, không phải giờ VN. Bộ đếm daily reset lúc 07:00 sáng VN (00:00 UTC), không phải nửa đêm VN — lệch với khung gửi 8h-21h VN. Không gây spam (vẫn giới hạn tổng theo ngày UTC) nhưng khác kỳ vọng "trần/ngày" của người vận hành đọc theo giờ VN. | Gửi lúc 06:50 VN rồi 07:10 VN → counter đã reset dù chưa qua nửa đêm VN. | Đổi key ngày sang UTC+7 giống `broadcast-service.ts`. |

---

## §E. Database / Prisma / migration (kiểm tra có trọng tâm)

| # | Mức | Vị trí | Mô tả | Hướng khắc phục |
|---|---|---|---|---|
| E1 | — | `broadcast-report-routes.ts:103,111,122`, `broadcast-cron.ts:178,194`, `target-cron.ts:225` | Mọi call site đã đọc đều guard null đúng cho `customerListId` (nullable từ migration `20260707140000`). **Đã kiểm tra, không thấy lỗi.** Chưa grep hết 10 file còn lại (list-import/enrichment-service…). | Audit riêng nếu muốn phủ 100%. |
| E2 | — | migration `broadcast_source_friends`, `target_welcome_message` | Thuần `ADD COLUMN`/`DROP NOT NULL` — additive, an toàn dữ liệu, không có `--accept-data-loss`/`DROP COLUMN`. **Đã kiểm tra, không thấy lỗi.** | — |
| E3 | 🟡 Trung bình | `schema.prisma:4152-4169` | `BroadcastRunItem` không có `@@unique([runId, entryId])` — gốc DB-level của C4. | Thêm unique index (trùng C4). |
| E4 | — | `broadcast-routes.ts:72-112`, `target-routes.ts:67-98` | GET list batch lookup list/nick/block qua `Promise.all` + `Map`, không N+1. **Đã kiểm tra, không thấy lỗi.** | — |

**Chưa kiểm tra:** index cho cron query nóng theo `status`/`nextRunAt` trên BroadcastJob/TargetJob (chạy mỗi 30s toàn hệ thống) — nên xác minh riêng.

---

## §F. Tích hợp Zalo (zca-js)

| # | Mức | Vị trí | Mô tả | Ghi chú |
|---|---|---|---|---|
| F1 | — | `campaign-service.ts:99-146` | Phân biệt đúng: `NOT_CONNECTED`/`RATE_LIMITED` từ findUser → "lỗi nick", KHÔNG đánh `no_zalo`, KHÔNG đụng `Contact.hasZalo`; lỗi khác (SĐT thật sự không Zalo) → mới `no_zalo`. **Đã kiểm tra, không thấy lỗi.** | Gap nằm ở C1 (pre-check thiếu category), không phải phân loại lỗi. |
| F2 | — | `zalo-operations.ts:166-273`, `broadcast-cron.ts:194` | UID luôn resolve theo `accountId` từng lệnh; broadcast-cron guard `entry.resolvedByNickId === job.zaloAccountId` trước khi tái dùng UID cũ → không dùng UID của nick khác. **Đã kiểm tra, không thấy lỗi.** | — |
| F3 | — | `session-crypto.ts` | AES-256-GCM, IV random mỗi lần, auth tag verify khi giải mã (sai key/hỏng → catch trả `null`, không crash), tương thích ngược session cũ. **Đã kiểm tra, không thấy lỗi.** | — |
| F4 | — | `zalo-operations.ts:213-242` | Retry tách rõ 2 loại: session-expired (reconnect + retry 1 lần) vs transient network (backoff 400/800ms, MAX 3). **Đã kiểm tra, không thấy lỗi.** | — |

**Chưa kiểm tra:** `downloadMediaToTemp` (cleanup/timeout/giới hạn kích thước) trong `chat-media-helpers.ts` — dùng bởi cả broadcast-cron & target-cron, chạy tự động không giám sát → đáng audit riêng.

---

## §G. Frontend (kiểm tra có trọng tâm — chỉ `TargetsView.vue`)

| # | Mức | Vị trí | Mô tả |
|---|---|---|---|
| G1 | — | `TargetsView.vue:219-409` | SFC hợp lệ (1 `<script setup>`, 1 `<style scoped>`, không thẻ đóng thừa). `onMounted` set `pollTimer=setInterval`, `onUnmounted` clear đúng (dòng 408) — không leak. Biến/hàm trong template đều khai báo. **Đã kiểm tra, không thấy lỗi.** |

**Chưa kiểm tra:** `BroadcastsView.vue`, `ContentBlocksView.vue`, `ListDetailView.vue`, `BroadcastReport.vue`. Không thể khẳng định "đã audit toàn bộ §G". Ưu tiên `ListDetailView.vue` (git log gần đây "fix: scroll + chọn số dòng/trang" — vùng mới sửa).

---

## §H. Bảo mật & vận hành (kiểm tra có trọng tâm)

| # | Mức | Vị trí | Mô tả lỗi + hậu quả | Tái hiện | Hướng khắc phục |
|---|---|---|---|---|---|
| H1 | 🟠 Cao | `public-api-routes.ts:14-24`, `webhook-settings-routes.ts:83` | API key public (`X-Api-Key`) lưu **plaintext** trong `AppSetting.valuePlain`, so khớp trực tiếp qua DB `findFirst({where:{settingKey:'public_api_key', valuePlain: apiKey}})`, không hash. DB lộ (backup rò rỉ, log lỗi, SQLi nơi khác) → toàn bộ API key mọi org lộ và dùng được ngay. | `SELECT value_plain FROM app_settings WHERE setting_key='public_api_key'` trên 1 backup → có key dùng được. | Lưu hash (SHA-256) key, so khớp bằng hash; hiển thị key gốc 1 lần lúc tạo. |
| H2 | — | `session-crypto.ts` | Mã hoá session Zalo at-rest ổn (xem F3). **Đã kiểm tra, không thấy lỗi.** | — | — |

**Chưa kiểm tra:** toàn bộ `webhook-service.ts` (auth/rate-limit/validate webhook ngoài), JWT verify + refresh rotation chi tiết (`refresh-token-service.ts`), giới hạn upload/ClamAV. `renderMessage()` (broadcast-service.ts:24-30) chỉ regex-replace text thuần → rủi ro injection thấp, nhưng chưa xác minh frontend hiển thị lại nội dung có dùng `v-html` hay không.

---

## Top 5 việc cần sửa ngay (ưu tiên rủi ro × công sức)

| # | Việc | Vì sao | Công sức |
|---|---|---|---|
| 1 | **B1 + B2** — validate ownership `contentBlockIds`/`welcomeBlockIds` trong PATCH broadcast/target + thêm `orgId` filter vào `resolveJobContent()` | Rò rỉ dữ liệu chéo org **thật**, khai thác được qua API hiện có | Thấp (~30 phút) |
| 2 | **H1** — hash API key public thay vì plaintext | Một lần DB leak = mất toàn bộ API key mọi org | Thấp-Trung bình |
| 3 | **C1** — mở rộng pre-check target-cron sang cả `friend_lookup` | Đang âm thầm "đốt" contact dù code chủ đích tránh | Thấp (thêm 1 lệnh check) |
| 4 | **C2** — giảm rủi ro gửi trùng tin (send-before-record) | Spam khách/report — rủi ro nghiêm trọng nhất của hệ automation | Trung bình |
| 5 | **B3** — kế hoạch bật `TENANT_GUARD_MODE=warn` staging + áp `tenant-rls.sql` cho bảng automation | Lưới an toàn duy nhất còn thiếu cho toàn hệ multi-tenant | Cao (rollout có kiểm soát) |

---

## Đánh giá sức khoẻ codebase: **6.5/10**

**Vì sao không thấp hơn:** Code trong `broadcast/`, `target/`, `content-blocks/` viết có kỷ luật hiếm thấy cho extension 1 tuần tuổi — comment giải thích rõ *lý do* mọi quyết định (kể cả phần chưa hoàn thiện), phân loại lỗi Zalo cẩn thận (F1), atomic transaction đúng chỗ (C6), null-guard nhất quán cho field vừa nullable-hoá (E1), migration sạch tuyệt đối additive (E2), mã hoá session đúng chuẩn (F3). Dấu hiệu của team hiểu rõ rủi ro domain (spam/khoá nick/rò rỉ tenant).

**Vì sao không cao hơn:** 2 lỗ hổng rò rỉ chéo org (B1/B2) là loại nghiêm trọng nhất theo tiêu chí đặt ra, và nằm ở đúng module mới nhất/ít test nhất. Toàn hệ thống không có lưới an toàn tự động cho tenant isolation (B3) — mọi thứ dựa vào con người nhớ viết `where:{orgId}`, và B1/B2 chứng minh đã từng quên. API key plaintext (H1) là smell bảo mật cơ bản. Không thấy file `*.test.ts` nào trong 3 thư mục broadcast/target/content-blocks → các lỗi trên không có lưới test bắt trước khi lên production.
