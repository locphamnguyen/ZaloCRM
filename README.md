# ZaloCRM — hsholding Edition

> **Fork repository** của [locphamnguyen/ZaloCRM](https://github.com/locphamnguyen/ZaloCRM) — phát triển song song với upstream, thêm các module phục vụ nghiệp vụ nội bộ HS Holding (Lead Scoring, popup edit khách hàng nâng cao, fix performance chat).

**Fork:** [https://github.com/locphamnguyen/ZaloCRM](https://github.com/locphamnguyen/ZaloCRM)
**Upstream gốc:** [https://github.com/locphamnguyen/ZaloCRM](https://github.com/locphamnguyen/ZaloCRM)

---

## 📊 So sánh với upstream locphamnguyen

| | locphamnguyen (upstream) | hsholding (fork này) |
|---|---|---|
| **Latest release** | v3.1.2 (`5a47da9`, 2026-05-15) | v3.1.2 + 6 commit Phase 6 + flicker fix |
| **Stable tag** | `v3.1.2` | `stable-2026-05-18` |
| **Branch chính** | `main` | `feat/phase-6-lead-scoring` |
| **Lead Scoring** | ❌ Không có | ✅ Module đầy đủ (scoring engine + auto-tag + stuck detection) |
| **Popup edit KH** | Cơ bản | ✅ Header avatar + progress bar + tab Friends + webhook events |
| **Alias 2-way sync** | ❌ | ✅ Friend.aliasInNick sync Zalo Real ↔ CRM |
| **Flicker cột 2 chat** | Có | ✅ Đã fix triệt để (FLIP animation + 4 root cause) |
| **Tên cột "Tên gợi nhớ"** | "Tên CRM/Nick KH" | ✅ Đổi sang "Tên gợi nhớ" + reorder columns |
| **Tab "Ghi chú"** | Mix lẫn activity | ✅ Chỉ trả notes thuần |

### Đã đồng bộ từ upstream

Toàn bộ commits của locphamnguyen đến `v3.1.2` đều có trong fork này. Merge base = `5a47da9` (`release: v3.1.2 — timeline realtime, zalo-tag auto-sync, perf fixes`). Không có commit upstream nào fork thiếu.

---

## 🌳 Trạng thái branches

### Trên GitHub fork (`locphamnguyen/ZaloCRM`)

| Branch | Vai trò | Trạng thái vs `upstream-mirror` |
|---|---|---|
| **`main`** (default) | **Core stable** — production branch, deploy từ đây | +7 commits ahead |
| `upstream-mirror` | Read-only mirror locphamnguyen v3.1.2 (= `origin/main`) | = upstream |
| `feat/ui-phase5` | WIP popup edit + alias sync (chưa merge vào main) | +5 / -41 (cần rebase) |

### Tag stable để restore

```bash
# Khôi phục về bản chốt ổn định bất cứ lúc nào:
git remote add fork https://github.com/locphamnguyen/ZaloCRM.git
git fetch fork --tags
git checkout stable-2026-05-18
# hoặc tạo branch mới từ tag:
git checkout -b restore-2026-05-18 stable-2026-05-18
```

`stable-2026-05-18` = `main` HEAD = `01dc870` (locphamnguyen v3.1.2 + Lead Scoring + flicker fix + fork README).

---

## 🎯 Tính năng riêng của fork hsholding

### Phase 6 — Lead Scoring system (6 commits, ~5,917 dòng code)

**Backend** (`backend/src/modules/scoring/`):
- `score-engine.ts` — Signal detect + apply + decay
- `signal-detector.ts` — Phát hiện inbound/outbound/meeting signal
- `auto-tag.ts` — 7 auto tag (cold-lead / warm-lead / hot-lead / etc.) real-time + cron
- `stuck-detection.ts` — Cron phát hiện KH đình trệ
- `stage-promotion.ts` — Logic chuyển stage tự động
- `decay-cron.ts` — Auto decay điểm theo thời gian
- `scoring-routes.ts` — Admin API routes
- `seed-defaults.ts` — Config mặc định + types

**Frontend**:
- `ScoreBreakdownModal.vue` — Popup giải thích chi tiết điểm số (Explainability UI)
- `StuckLeadsView.vue` — Dashboard KH đình trệ
- `ScoringSettingsView.vue` — Cài đặt scoring (signal weights, thresholds, decay rate)
- `use-scoring.ts` — Composable
- Nav menu thêm 2 trang: `/scoring/settings`, `/scoring/stuck-leads`

### UI/UX improvements (branch `feat/ui-phase5`, chưa merge)

- **Popup edit khách hàng refactor** — Header avatar + chips + progress bar + action strip + tab Friends + Nâng cao toggle (incomeRange, social, preferredLang) + webhook outbound events
- **2-way alias sync** — `Friend.aliasInNick` sync Zalo Real ↔ CRM, polling từng đoạn pagination 200 friend/page
- **Tên cột Khách hàng** — Đổi "Tên CRM/Nick KH" → "Tên gợi nhớ" + reorder cột (Ảnh KH → Tên Zalo+UID → Tên gợi nhớ)
- **Auto-scroll selected conv** — Khi nav từ Contacts/Groups → tự scroll cột 2 tới conv đang chọn
- **Fix tab "Ghi chú"** — Chỉ trả notes thuần, không mix activity

### Performance fixes

- **Flicker cột 2 chat triệt để** (commit `8f50e1e`) — Fix 4 root cause:
  1. `behavior: smooth → auto` cho `scrollSelectedIntoView` (bỏ glide 200-500ms)
  2. Bỏ `watch(selectedIndex)` — reorder do socket không kéo auto-scroll
  3. Loading indicator guard — chỉ show "Đang tải…" khi list rỗng (initial), bỏ ±57px oscillation khi background re-fetch
  4. `<TransitionGroup>` + FLIP animation 0.25s — reorder do tin mới đến glide mượt thay vì instant jump
- Đo đạc: 5 phút quan sát sau fix → **0 layoutShift, 0 scrollHeight oscillation, 0 childList DOM remove/add**

- **Message order fix** (commit `891dd61`, có ở branch `feat/ui-phase5`) — `insertMessageSorted` binary search by sentAt, xử lý socket non-chronological delivery (old_messages backfill reverse)

---

## 🔄 Workflow phát triển song song với locphamnguyen

Mô hình 3-nhánh trên fork:

```
origin/main (locphamnguyen)     ← READ ONLY (upstream gốc)
        │
        │ git fetch + git merge --ff-only
        ▼
upstream-mirror                 ← Mirror sạch của locphamnguyen, để review trước khi merge
        │
        │ review diff + chọn lọc merge vào main
        ▼
main (= fork/main, default)     ← CORE STABLE — deploy từ đây
        │
        │ checkout làm việc
        ▼
feat/xxx                        ← Test riêng local, chỉ push khi ổn định
```

### Setup 2 remote (lần đầu)

```bash
git clone https://github.com/locphamnguyen/ZaloCRM.git
cd ZaloCRM
git remote rename origin fork                                       # đổi origin → fork cho rõ
git remote add origin https://github.com/locphamnguyen/ZaloCRM.git  # thêm upstream gốc
git remote -v   # verify
```

### Review upstream trước khi merge vào core

```bash
git fetch origin
git checkout upstream-mirror
git merge --ff-only origin/main          # Update mirror (chỉ fast-forward, an toàn)
git log main..upstream-mirror --oneline  # Xem commits mới
git diff main..upstream-mirror --stat    # Xem files thay đổi
# Đọc kỹ + quyết định khi nào sẵn sàng merge:
git checkout main
git merge upstream-mirror                # Merge cả batch (linear nếu main chưa diverge)
# HOẶC cherry-pick từng commit anh muốn:
git cherry-pick <hash1> <hash2>
git push fork main
git push fork upstream-mirror
```

### Phát triển feature riêng (test local trước, push sau)

```bash
git checkout main
git pull fork main                        # Lấy main mới nhất
git checkout -b feat/abc                  # Branch mới từ main
# code + commit local — test docker thoải mái:
docker compose up -d --build
# Khi ổn → merge vào main:
git checkout main
git merge feat/abc                        # hoặc squash merge nếu muốn linear
git push fork main
git branch -d feat/abc                    # Xoá branch sau khi merge
```

### Sync upstream-mirror khi locphamnguyen có release mới

```bash
git fetch origin
git checkout upstream-mirror
git merge --ff-only origin/main           # mirror = upstream latest
git push fork upstream-mirror
# Sau đó review + quyết định merge vào main như mục trên
```

---

## 🏷️ Tags & restore points

| Tag | Commit | Mô tả |
|---|---|---|
| `stable-2026-05-18` | `8f50e1e` | **Bản chốt hiện tại** — v3.1.2 + Phase 6 + flicker fix |
| `v3.1.2` | `5a47da9` | Upstream release từ locphamnguyen (2026-05-15) |
| `v3.1.1` | — | Upstream |
| `v3.1.0` | — | Upstream |
| `v3.0` / `v2.x` / `v1.0.0` | — | Upstream history |

---

## ⚠️ Nội dung phía dưới = README gốc của upstream locphamnguyen (giữ nguyên để tham khảo)

---

# ZaloCRM v3.0 — Quản lý nhiều tài khoản Zalo cá nhân

Hệ thống quản lý tập trung nhiều tài khoản Zalo cá nhân trên 1 giao diện web. Chat real-time, gửi ảnh/video/file qua MinIO, AI assistant, workflow tự động, tích hợp đa nền tảng, analytics nâng cao, PWA mobile.

**GitHub (upstream):** [https://github.com/locphamnguyen/ZaloCRM](https://github.com/locphamnguyen/ZaloCRM)

## Ảnh chụp giao diện

| Dashboard | Tin nhắn |
|---|---|
| ![Dashboard](docs/user-guide-images/02-dashboard.png) | ![Tin nhắn](docs/user-guide-images/03-chat.png) |

| Bạn bè | Khách hàng |
|---|---|
| ![Bạn bè](docs/user-guide-images/04-friends.png) | ![Khách hàng](docs/user-guide-images/05-contacts.png) |

> 📖 Xem hướng dẫn sử dụng đầy đủ tại [docs/HUONG-DAN-NGUOI-DUNG.md](docs/HUONG-DAN-NGUOI-DUNG.md).

## Tính năng

### Mới trong v3.0
- **📎 Chat attachments** — Gửi/nhận hình ảnh, video, file (PDF, Excel, Word, ZIP…) qua composer chat, mirror lên MinIO để hiển thị trong CRM
- **🎬 Video player inline** — Tin nhắn video render trực tiếp với controls trong bubble (không cần download)
- **🎨 UI refactor 3 trang** — Chat / Contacts / Friends thiết kế Smax style, layout cố định, badge số tin chưa đọc
- **👥 Friend model + aggregates** — Model `Friend` + `FriendshipAttempt` riêng, đếm nick CRM đang chăm khách (`chattingNicksCount`, `acceptedNicksCount`)
- **😀 Reaction multi-emoji** — Đổng bộ 2 chiều Zalo ↔ CRM, mỗi user 1 reaction/emoji
- **🎟️ Sticker animated** — Render sticker động Zalo qua proxy `getStickersDetail` + picker gửi sticker từ CRM
- **🏦 Bank/QR card render** — Hiển thị card chuyển khoản, QR theo style zinstant của Zalo, clickable
- **👤 Zalo user info popup** — Click vào avatar trong nhóm xem thông tin user
- **🔗 Contact merge by Zalo globalId** — Gộp khách hàng cha-con tự động, policy hard/soft merge
- **🌐 Proxy per-account UI** — Cấu hình proxy HTTP/SOCKS5 cho từng Zalo qua giao diện (mặc định: kết nối thẳng internet)
- **🗃️ MinIO/S3 storage** — Object storage tích hợp Docker Compose cho file attachment
- **🐛 Fix: Dup message** — Đúng shape `sendResult.message.msgId` của zca-js
- **🐛 Fix: Image preview rỗng** — Upload `uploadAttachment` lấy hdUrl thật trước khi lưu Message
- **🐛 Fix: Reply preview JSON** — Hiển thị `[Hình ảnh]`/`[Video]`/`[Tệp]` thay vì raw JSON khi reply attachment
- **🐛 Fix: @mention không bôi lố** — Mention tô đúng vùng, ellipsis tên nhóm dài
- **⚡ Performance** — Cải thiện độ trễ khi đổi hội thoại + nhóm

### v2.1 (16/04/2026)
- Tab "Khác": ẩn hội thoại không quan trọng, chuyển tab bằng chuột phải
- Tên KH 2 lớp: CRM Name + Zalo Name, ưu tiên CRM Name
- Bộ lọc hội thoại: chưa đọc, chưa trả lời, thời gian, tags
- Template nhanh: gõ `/` để chèn mẫu tin nhắn với biến động
- Tin nhắn đặc biệt: hiển thị sticker, ảnh, video, file, chuyển khoản, cuộc gọi
- Đồng bộ tin nhắn: lấy 50 tin cũ, selfListen dedup, tự tạo contact
- Fix: tên "Unknown", PWA setup, tin nhắn trùng lặp khi gửi

### v2.0 (31/03/2026)
- AI Assistant: gợi ý trả lời, tóm tắt, phân tích cảm xúc
- Workflow Automation: tự động gửi tin, phân loại khách
- Integration Hub: Google Sheets, Telegram, Facebook, Zapier
- Mobile PWA: offline, responsive, installable
- Contact Intelligence: gộp trùng, lead scoring, auto-tag
- Advanced Analytics: funnel, team perf, report builder
- Multi-Provider AI: Anthropic, OpenAI, Qwen, Kimi
- Proxy per-account: cấu hình proxy riêng cho từng Zalo
- Fix: loại bỏ tin nhắn hiển thị trùng

### Cốt lõi (v1.0)
- **Quản lý nhiều Zalo** — Đăng nhập QR, tự kết nối lại, lưu phiên đăng nhập
- **Chat real-time** — Gửi/nhận tin nhắn, ảnh, file, sticker, nhóm chat
- **Quản lý khách hàng** — Pipeline (Mới → Đã liên hệ → Quan tâm → Chuyển đổi → Mất)
- **Lịch hẹn** — Tạo, theo dõi, nhắc nhở tự động hàng ngày
- **Dashboard** — Biểu đồ tin nhắn, KPI, nguồn khách hàng, trạng thái pipeline
- **Báo cáo** — Xuất Excel, lọc theo thời gian
- **Phân quyền** — Owner / Admin / Member, quản lý đội nhóm, phân quyền Zalo
- **API công khai** — REST API với xác thực API key cho tích hợp bên ngoài
- **Webhook** — Nhận thông báo khi có tin nhắn mới, khách hàng mới, Zalo kết nối/ngắt
- **Chống block Zalo** — Giới hạn 200 tin/ngày, phát hiện gửi quá nhanh
- **Thông báo** — Tin chưa trả lời >30 phút, lịch hẹn sắp tới, Zalo mất kết nối
- **Tìm kiếm toàn hệ thống** — Tìm khách hàng, tin nhắn, lịch hẹn
- **Giao diện** — Theme tối/sáng, thiết kế Liquid Silicon

## Yêu cầu hệ thống

| Thành phần | Tối thiểu | Khuyến nghị |
|-----------|----------|------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Ổ cứng | 20 GB | 40 GB SSD |
| Hệ điều hành | Ubuntu 20.04+ | Ubuntu 22.04 LTS |
| Phần mềm | Docker + Docker Compose | Docker 24+ |

> v3.0 cần thêm MinIO container nên ổ cứng và RAM tăng so với v2.1.

## Cài đặt mới

```bash
git clone https://github.com/locphamnguyen/ZaloCRM.git
cd ZaloCRM
cp .env.example .env
# Sửa file .env — đặt JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD, MINIO_ROOT_PASSWORD
docker compose up -d --build
```

Truy cập **http://IP-server:3080** → Tạo tài khoản admin lần đầu.

### Tạo secret keys
```bash
# JWT_SECRET (32+ chars)
openssl rand -hex 32

# ENCRYPTION_KEY (32 bytes = 64 hex chars)
openssl rand -hex 32
```

## Nâng cấp từ v3.0 lên v3.1

> ⚠️ **Backup database trước khi nâng cấp.** Schema v3.1 thêm các bảng mới: `statuses`, `zalo_labels`, `notes`, `crm_tags` và một số field FK trên `contacts`, `friends`, `zalo_accounts`.

```bash
# 1. Backup database
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-v3.0-$(date +%Y%m%d-%H%M).sql

# 2. Pull code v3.1
cd /path/to/ZaloCRM
git fetch origin
git checkout main
git pull origin main

# 3. Rebuild + restart (Dockerfile entrypoint tự `prisma db push --accept-data-loss`)
docker compose up -d --build app

# 4. Verify
curl http://localhost:3080/                                                          # HTTP 200
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "\dt statuses zalo_labels notes crm_tags"
docker logs zalo-crm-app --tail 30 | grep -E "listener|backfill"
```

### Tính năng mới v3.1
| Tính năng | Mô tả |
|-----------|-------|
| **CrmTag system** | Quản lý tag riêng cho CRM, Settings tabs, optimistic UI |
| **Notes thread** | Ghi chú CRM-style trong tab Hồ Sơ, AI suggest lịch hẹn |
| **Zalo Labels 2-way sync** | Native dropdown, on-demand mode (5s cooldown) |
| **DM history backfill** | Endpoint `/sync-history` + UI button — port openzca CLI `db sync` |
| **AI parse fallback** | Rule-based khi Gemini quota 429 |
| **Phone normalization** | `phoneNormalized` canonical, resolve-by-keys |
| **DuplicateReviewDialog** | 3-column compare UX, filter, dismiss |

### Rollback về v3.0
```bash
docker compose down
git checkout v3.0
docker exec zalo-crm-db psql -U crmuser -d zalocrm < backup-v3.0-<datetime>.sql
docker compose up -d --build
```

## Nâng cấp từ v2.1 lên v3.0

> ⚠️ **Backup database trước khi nâng cấp.** Schema v3.0 thêm một số bảng và field aggregate mới.

```bash
# 1. Backup database
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-v2.1-$(date +%Y%m%d-%H%M).sql

# 2. Pull code v3.0
cd /path/to/ZaloCRM
git fetch origin
git checkout main
git pull origin main

# 3. Bổ sung biến môi trường mới vào .env (MinIO/S3)
#    Mở .env.example mới và copy block "Object Storage" + REDIS_URL vào .env
diff .env .env.example   # xem var nào thiếu

# Cần thêm vào .env:
cat >> .env <<'EOF'

# === v3.0 — MinIO/S3 storage ===
REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_URL=http://<DOMAIN-HOẶC-IP-SERVER>:9000
S3_BUCKET=zalocrm-attachments
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=<ĐẶT-MẬT-KHẨU-MẠNH>
EOF

# ⚠️ Quan trọng:
#   - S3_PUBLIC_URL phải là URL trình duyệt user truy cập được (không dùng localhost
#     nếu user khác máy server)
#   - S3_ACCESS_KEY/S3_SECRET_KEY phải khớp MINIO_ROOT_USER/MINIO_ROOT_PASSWORD

# 4. Rebuild + restart stack (Docker Compose sẽ tự tạo container minio + minio-init)
docker compose down
docker compose up -d --build

# 5. Apply schema mới
#    Dockerfile entrypoint tự chạy "prisma db push --accept-data-loss" khi container start
#    → bước này thường không cần làm thủ công. Nếu muốn force:
docker exec zalo-crm-app npx prisma db push --accept-data-loss

# 6. Verify
curl http://localhost:3080/                                              # HTTP 200
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "\dt friends"     # tồn tại
docker logs zalo-crm-app --tail 20                                       # listener OK
```

### Lưu ý khi nâng cấp
| Mục | Chi tiết |
|---|---|
| **`--accept-data-loss`** | v3.0 CHỈ THÊM bảng/field mới, không drop gì → an toàn. Nhưng PHẢI backup trước phòng rollback. |
| **`S3_PUBLIC_URL`** | URL browser dùng để hiển thị file attachment. Production: domain/IP server, không dùng `localhost`. |
| **Tin nhắn cũ** | Vẫn hiển thị bình thường. Chỉ file gửi từ thời điểm v3.0 trở đi mới đi qua MinIO. |
| **Recipient nhận file** | Không ảnh hưởng `S3_PUBLIC_URL` — file gửi trực tiếp qua Zalo CDN, độc lập với MinIO. |

### Rollback về v2.1
```bash
docker compose down
git checkout v2.1
docker compose up -d --build
docker exec zalo-crm-db psql -U crmuser -d zalocrm < backup-v2.1-<datetime>.sql
```

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|-----------|----------|
| Backend | Node.js 20 / Fastify 5 / Prisma 7 |
| Frontend | Vue 3 / Vuetify 3 / TipTap / Chart.js / Pinia |
| AI | Anthropic Claude / OpenAI / Gemini / Qwen / Kimi |
| Cơ sở dữ liệu | PostgreSQL 16 |
| Real-time | Socket.IO |
| Object Storage | MinIO (S3-compatible) |
| Cache / Event Buffer | Redis 7 |
| Zalo | zca-js 2.x |
| Mobile | PWA (Service Worker + Web App Manifest) |
| Triển khai | Docker Compose |

## API & Webhook

> Hướng dẫn chi tiết: [HUONG-DAN-SU-DUNG.md](HUONG-DAN-SU-DUNG.md)

### Xác thực API
```
Header: X-API-Key: your-api-key
```

### Endpoint chính
| Phương thức | Đường dẫn | Mô tả |
|------------|----------|-------|
| GET | `/api/public/contacts` | Danh sách khách hàng |
| POST | `/api/public/contacts` | Tạo khách hàng mới |
| POST | `/api/public/messages/send` | Gửi tin nhắn text |
| POST | `/api/v1/conversations/:id/attachments` | Gửi ảnh/video/file (multipart) |
| GET | `/api/public/appointments` | Danh sách lịch hẹn |
| PUT | `/api/v1/zalo-accounts/:id/proxy` | Cập nhật proxy |

### Sự kiện Webhook
| Sự kiện | Mô tả |
|---------|-------|
| `message.received` | Tin nhắn mới đến |
| `message.sent` | Tin nhắn gửi đi |
| `contact.created` | Khách hàng mới |
| `zalo.connected` | Zalo kết nối |
| `zalo.disconnected` | Zalo mất kết nối |

## Cộng đồng

Tham gia nhóm Telegram để trao đổi, hỏi đáp, nhận thông báo bản phát hành mới:

<p align="left">
  <a href="https://t.me/+KKJ3SJSx6PA3NDE1">
    <img src="docs/user-guide-images/qr-group-telegram.png" alt="Telegram Group QR" width="200" />
  </a>
</p>

- 📲 **Quét QR** ở trên bằng app Telegram, hoặc
- 💬 **Telegram:** [Tham gia group](https://t.me/+KKJ3SJSx6PA3NDE1)

## Dịch vụ & Hỗ trợ

Bạn cần triển khai ZaloCRM cho doanh nghiệp, custom thêm tính năng riêng, hoặc tích hợp với hệ thống có sẵn? Liên hệ trực tiếp tôi để được tư vấn:

- 🌐 **Website:** [https://locnguyendata.com](https://locnguyendata.com)
- 📧 **Email:** [locnt@locnguyendata.com](mailto:locnt@locnguyendata.com)
- 💬 **Telegram:** [Tham gia group](https://t.me/+KKJ3SJSx6PA3NDE1)

### Dịch vụ cung cấp
- **Setup & deploy** ZaloCRM trên server riêng (VPS / dedicated / cloud)
- **Customize** giao diện, workflow, AI prompt theo nghiệp vụ doanh nghiệp
- **Phát triển tính năng mới** theo yêu cầu (CRM module, AI agent, automation, dashboard riêng)
- **Tích hợp** với hệ thống có sẵn: ERP, CRM khác (HubSpot, Salesforce), payment gateway, kế toán
- **Đào tạo & support** team sử dụng, vận hành, troubleshoot
- **Mở rộng zca-js** — fix bug, thêm tính năng đặc thù, tối ưu chống block

## Miễn trừ trách nhiệm & Thông báo pháp lý

**ZaloCRM** là dự án mã nguồn mở độc lập, không chính thức, do bên thứ ba phát triển. Dự án **không** liên kết, không được tài trợ, không được chứng nhận và không có bất kỳ mối quan hệ nào với Zalo hoặc Công ty Cổ phần VNG.

"Zalo" là nhãn hiệu đã đăng ký của Công ty Cổ phần VNG. Mọi nhãn hiệu, nhãn hiệu dịch vụ và tên thương mại được nhắc tới trong dự án này thuộc sở hữu của chủ sở hữu tương ứng, được sử dụng duy nhất cho mục đích nhận diện và mô tả.

Phần mềm này được cung cấp **chỉ cho mục đích học tập, nghiên cứu cá nhân và tự động hoá cá nhân hợp pháp**. Đây là công cụ dành cho lập trình viên để khám phá API nhắn tin từ góc độ nghiên cứu.

ZaloCRM được xây dựng trên thư viện mã nguồn mở công khai `zca-js` (giấy phép MIT) thông qua cầu nối CLI `openzca`. **Không có mã nguồn độc quyền nào thuộc về Zalo hoặc VNG được sử dụng trong dự án này.**

Việc sử dụng công cụ tự động hoá **có thể vi phạm Điều khoản Dịch vụ của Zalo** và có thể dẫn tới việc tài khoản bị khoá hoặc hạn chế. Người dùng **chịu hoàn toàn trách nhiệm** đảm bảo việc sử dụng tuân thủ pháp luật hiện hành, các quy định liên quan, và Điều khoản Dịch vụ của Zalo.

Phần mềm được cung cấp **"nguyên trạng" (as is)**, không kèm bất kỳ bảo đảm nào, dù rõ ràng hay ngầm định. Tác giả và những người đóng góp **không chịu trách nhiệm** đối với bất kỳ thiệt hại nào phát sinh từ việc sử dụng phần mềm này.

Khi sử dụng ZaloCRM, bạn xác nhận rằng đã đọc, hiểu và chấp nhận các điều khoản trên, đồng thời tự chịu trách nhiệm và rủi ro khi sử dụng công cụ này.

---

### Disclaimer & Legal Notice (English)

**ZaloCRM** is an independent, unofficial, third-party open-source project. It is **not** affiliated with, endorsed by, sponsored by, or associated with Zalo or VNG Corporation in any way.

"Zalo" is a registered trademark of VNG Corporation. All trademarks, service marks, and trade names referenced herein are the property of their respective owners and are used solely for identification and descriptive purposes.

This software is provided **for educational purposes, personal research, and legitimate personal automation only**. It is intended as a developer tool for exploring messaging APIs from a research perspective.

ZaloCRM is built on the publicly available `zca-js` open-source library (MIT license) via the `openzca` CLI bridge. **No proprietary code belonging to Zalo or VNG Corporation is included in this project.**

Using automation tools **may violate Zalo's Terms of Service** and could result in account suspension or restrictions. Users are **solely responsible** for ensuring their use complies with all applicable laws, regulations, and Zalo's Terms of Service.

This software is provided **"as is"**, without warranty of any kind, express or implied. The authors and contributors **shall not be held liable** for any damages arising from the use of this software.

By using ZaloCRM, you acknowledge that you understand and accept these terms and that you use this tool **at your own risk and responsibility**.

## Giấy phép

**Apache License 2.0** — Miễn phí sử dụng, chỉnh sửa, phân phối lại cho mọi mục đích cá nhân và thương mại. Xem [LICENSE](LICENSE).

### Yêu cầu attribution (NOTICE)

Theo Apache 2.0 Section 4(d), khi phân phối lại (kể cả phiên bản chỉnh sửa hoặc deploy SaaS), bạn **bắt buộc** giữ file [NOTICE](NOTICE).

---

## Lời cảm ơn

Xin chân thành cảm ơn:
- [hsholding](https://github.com/hsholding) — vì những đóng góp ý tưởng, kinh nghiệm thực tế quý báu và codebase giúp đưa các logic và chức năng thiết thực vào sản phẩm
- [vuongnguyenbinh/ZaloCRM](https://github.com/vuongnguyenbinh/ZaloCRM) — vì những ý tưởng và codebase cho dự án này
- [darkamenosa/openzca](https://github.com/darkamenosa/openzca) — vì CLI tích hợp Zalo (zca-js wrapper) mà ZaloCRM dùng làm cầu nối tới các tài khoản Zalo


Trên cơ sở những đóng góp ý tưởng và code của các tác giả trên, tôi xây dựng tiếp và phát triển ZaloCRM thành phiên bản hiện tại.

> 📄 Bản gốc giấy phép MIT của 2 dự án source-fork (vuongnguyenbinh + darkamenosa) được lưu trong [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
