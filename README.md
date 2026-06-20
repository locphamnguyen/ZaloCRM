# ZaloCRM v3.4 — Quản lý nhiều tài khoản Zalo cá nhân

Hệ thống quản lý tập trung nhiều tài khoản Zalo cá nhân trên 1 giao diện web. Chat real-time, gửi ảnh/video/audio/file qua MinIO/S3/R2, cầu **Zalo ↔ Telegram** 2 chiều, luồng bám đuổi tự động (follow-up sequence), bể lead, Facebook Lead Ingestion, AI assistant, tích hợp đa nền tảng, analytics nâng cao, PWA mobile.

**Mã nguồn mở:** [github.com/locphamnguyen/ZaloCRM](https://github.com/locphamnguyen/ZaloCRM) — phát hành theo **AGPL-3.0** (dual-license thương mại).

## Ảnh chụp giao diện

| Dashboard | Facebook Lead |
|---|---|
| ![Dashboard v3.3](docs/release-images/v3.3/01-dashboard-v33.png) | ![Facebook Lead Ingestion](docs/release-images/v3.3/02-facebook-lead-ingestion.png) |

| Zalo Accounts | Chat media |
|---|---|
| ![Zalo Accounts](docs/release-images/v3.3/03-zalo-accounts-redesign.png) | ![Chat media forward](docs/release-images/v3.3/07-chat-media-forward.png) |

| Privacy PIN | RBAC / Tệp khách hàng |
|---|---|
| ![Privacy PIN](docs/release-images/v3.3/04-privacy-pin.png) | ![Customer Lists](docs/release-images/v3.3/06-customer-lists.png) |

> 📖 Xem hướng dẫn sử dụng đầy đủ tại [docs/HUONG-DAN-NGUOI-DUNG.md](docs/HUONG-DAN-NGUOI-DUNG.md).
> 📣 Changelog đầy đủ (mọi phiên bản): [CHANGELOG.md](CHANGELOG.md).

## Tính năng

### Mới trong v3.4
- **Cầu Zalo ↔ Telegram** — Mirror tin nhắn **2 chiều** (vào/ra) giữa Zalo và Telegram, kèm **media** (ảnh/video/audio/file, giữ tên file gốc), realtime + badge chống lặp
- **Luồng bám đuổi (follow-up sequence) — recode toàn bộ** — 4 luật (giãn cách random + **jitter** từng bước, cooldown, pause/guard/resume), **Luật 4** tự giữ/hoãn theo giờ cấu hình khi khách trả lời, ETA timing 4 mốc, nút "gửi bước tiếp ngay"
- **Bể Lead (lead-pool) — rebuild** — chia lead round-robin + 2 ca làm việc + 4 màn quản trị + tab "Tổng quan v2" (phân tích sale, lọc lead rác)
- **Chuông "đang theo dõi"** sau tên khách trong chat + **Phạm vi làm việc** (scope thành điều kiện load hội thoại)
- **AI** — quản lý API key + model provider per-org ngay trên giao diện
- **Public REST API** (X-API-Key) + tài liệu API (vi/en) + Postman collection
- **Mã nguồn mở AGPL-3.0** — relicense sang AGPL-3.0 (copyleft + §13 SaaS), dual-license thương mại, kèm CONTRIBUTING + DCO

### Mới trong v3.3
- **Facebook Lead Ingestion** — Kết nối Meta OAuth/page, webhook verify + HMAC, queue lead, tự khám phá form và tự tạo Customer List theo page/form
- **Media forward đầy đủ** — Chuyển tiếp hình ảnh, video, audio trong chat thay vì chỉ chuyển tiếp text
- **Inbound media mirror** — Ảnh/video khách gửi đến được mirror/backfill từ Zalo CDN sang MinIO/S3/R2 để CRM kiểm soát file tốt hơn
- **Cloudflare R2 support** — `.env.example` có block R2, dùng chung cấu hình S3-compatible với MinIO/Amazon S3
- **Env parser chắc hơn** — Secret/password có ký tự `#` không còn bị hiểu nhầm là comment khi đọc `.env`
- **Video thumbnail + drag/drop** — Sửa thumbnail video và khôi phục kéo thả file/hình/video vào màn hình chat
- **Privacy/RBAC/Zalo redesign** — Privacy PIN V2, RBAC phòng ban, Zalo Accounts metrics/status, reaction/read receipt/typing dots
- **Fix issues #24/#25** — Fallback JSON lỗi từ `getFriendOnlines` và nhận diện message type `webchat`

### v3.2 (21/05/2026)
- **Bot-Auto framework** — Blocks, Sequences, Triggers, Broadcasts, Lists, engine gửi bằng Zalo SDK thật
- **Lead Scoring** — Signal detector, auto-decay, 7 auto tag, stuck lead dashboard, scoring settings
- **Customer Lists** — Import CSV/Excel, column mapping, inline edit, undo delete, 2-axis status
- **UI redesigns** — Appointments, Friends, Zalo Accounts, Settings layout, Bot-Auto top-level tab
- **Touch profile + alias sync** — Bổ sung thông tin khách từ SDK và đồng bộ alias Zalo Real ↔ CRM

### v3.1 (04/2026)
- **CrmTag system** — Quản lý tag riêng cho CRM, Settings tabs, optimistic UI
- **Notes thread** — Ghi chú CRM-style trong tab Hồ Sơ, AI suggest lịch hẹn
- **Zalo Labels 2-way sync** — Native dropdown, on-demand mode, auto-sync khi reconnect
- **DM history backfill** — Endpoint `/sync-history` + nút đồng bộ lịch sử DM
- **Duplicate review** — Dialog 3 cột để rà soát/gộp khách hàng trùng

### v3.0 (2026)
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

> v3.x dùng thêm Redis + object storage (MinIO/S3/R2) nên production nên có tối thiểu 4 GB RAM nếu chạy đủ service trên cùng VPS.

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

## Nâng cấp từ v3.x lên v3.3

> ⚠️ **Backup database trước khi nâng cấp.** v3.3 có thêm Facebook Lead Ingestion, Privacy/RBAC/Zalo UI, media forward và object storage mirror. Không commit `.env` thật lên git.

```bash
# 1. Backup database
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-v3.x-$(date +%Y%m%d-%H%M).sql

# 2. Pull code mới nhất
cd /path/to/ZaloCRM
git fetch origin
git checkout main
git pull origin main

# 3. Đồng bộ biến môi trường mới
#    Mở .env.example mới và copy các biến còn thiếu sang .env thật.
#    Nếu dùng Cloudflare R2, dùng endpoint/account/key của R2 trong block S3_*.
diff .env .env.example

# 4. Rebuild + restart app
docker compose up -d --build app

# 5. Verify
curl http://localhost:3080/
docker logs zalo-crm-app --tail 50 | grep -E "facebook|media|storage|listener|cron"
```

### Biến môi trường cần rà soát ở v3.3

| Nhóm | Biến cần kiểm tra | Ghi chú |
|---|---|---|
| Object storage | `S3_ENDPOINT`, `S3_PUBLIC_URL`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Dùng được cho MinIO, Amazon S3 hoặc Cloudflare R2 |
| MinIO local | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Chỉ dùng khi chạy service MinIO trong Docker Compose |
| Facebook Lead | Các biến Meta/Facebook trong `.env.example` nếu bật kênh Facebook | Cấu hình app id/secret/webhook theo Meta app |
| Security | `JWT_SECRET`, `ENCRYPTION_KEY`, `DB_PASSWORD` | Không để trống ở production |

### Cloudflare R2 example

```env
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_PUBLIC_URL=https://<public-r2-domain-or-custom-domain>
S3_BUCKET=zalocrm-attachments
S3_REGION=auto
S3_ACCESS_KEY=<r2-access-key-id>
S3_SECRET_KEY=<r2-secret-access-key>
```

`S3_PUBLIC_URL` phải là URL browser truy cập được để ảnh/video hiển thị trong CRM. Nếu bucket private, gắn custom domain/public access hoặc cơ chế signed URL phù hợp.

### Backfill media cũ từ Zalo CDN

Sau khi cấu hình storage đúng, chạy lại job/script backfill media của hệ thống nếu DB còn message có URL dạng `zpc.zdn.vn`. Mục tiêu là object mới xuất hiện trong MinIO/S3/R2 và message trong DB trỏ về URL storage mới.

### Rollback về bản v3.x cũ

```bash
docker compose down
git checkout <tag-v3.x-cu>
docker exec zalo-crm-db psql -U crmuser -d zalocrm < backup-v3.x-<datetime>.sql
docker compose up -d --build
```

---

## Nâng cấp từ v3.1 lên v3.2

> ⚠️ **Backup database trước khi nâng cấp.** Schema v3.2 thêm các bảng Phase 7 (Block, Sequence, Trigger, Broadcast, Campaign, Task, CustomerList) và Phase 6 (ScoringConfig, ScoreSignalRule, StageTransitionRule, StuckThreshold, NbaTemplate) + field `Organization.timezone`, `Contact.priorityScore/priorityUpdatedAt`.

```bash
# 1. Backup database
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-v3.1-$(date +%Y%m%d-%H%M).sql

# 2. Pull code v3.2
git pull origin main

# 3. Rebuild + restart (entrypoint tự `prisma db push --accept-data-loss`)
docker compose up -d --build app

# 4. Verify
curl http://localhost:3080/                                                              # HTTP 200
docker logs zalo-crm-app --tail 30 | grep -E "broadcast-scheduler|list-enrichment|cron-scheduler"
```

### Tính năng mới v3.2

#### 🤖 Bot-Auto framework (Phase 7) — top-level tab
| Module | Mô tả |
|--------|-------|
| **Blocks** | Reusable content blocks + folders, dùng chung cho sequence/broadcast |
| **Sequences** | Automated message sequences với cron + stop_on_accept gate |
| **Triggers** | Event-driven: cron, scheduled_cron, webhook (order_success), birthday, request_friend Zalo SDK |
| **Broadcasts** | CRUD + scheduler + UI, send batch tới audience |
| **Lists (Tệp khách hàng)** | Import CSV/Excel với column mapping, inline edit, undo delete, 2-axis status (lifecycle + system) |
| **Engine** | Action handlers, manual_run, block-bound trigger materializer, real Zalo SDK send |

#### 📊 Lead Scoring (Phase 6) — chấm điểm + phát hiện KH đình trệ
- Scoring engine: signal detect (inbound/outbound/meeting) + auto decay
- Auto-tag 7 tags: `cold-lead`, `warm-lead`, `hot-lead`, `champion`, `cooling`, `at-risk`, `dormant`
- Stuck detection cron + `/leads/stuck` dashboard riêng
- Stage promotion logic + breakdown modal explainability
- `/settings/crm/scoring` để cấu hình weights + thresholds

#### 🎨 UI redesigns lớn
- **AppointmentsView** redesign theo Airtable-design spec
- **FriendsView** flat per-pair table + kind tabs
- **ZaloAccountsView** dashboard 2-axis status
- **Settings layout** overhaul: nav nhóm Personal / Team / CRM / Channels / Dev
- **Bot-Auto** promoted to top-level primary tab (smax.ai parity)
- **Responsive overhaul** per Airtable breakpoints

#### ⚙️ Other
- ContactProfileView, CustomerActivityLogView
- Touch-profile endpoint: fill gender/phone/birthday/hasZalo từ SDK khi click conv
- Alias 2-way sync: `Friend.aliasInNick` Zalo Real ↔ CRM (pagination 200/page)
- Scripts mới: `deploy-local.sh`, `test-phase7-runner.sh`, `test-phase7-setup.sql`

### Rollback về v3.1
```bash
docker compose down
git checkout v3.1.2
docker exec zalo-crm-db psql -U crmuser -d zalocrm < backup-v3.1-<datetime>.sql
docker compose up -d --build
```

---

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

Copyright © 2026 **Nguyễn Tiến Lộc**.

ZaloCRM là **phần mềm tự do** phát hành theo **GNU Affero General Public License v3.0 (AGPL-3.0)** —
xem [LICENSE](LICENSE). Mã nguồn công khai: <https://github.com/locphamnguyen/ZaloCRM>.

### Copyleft + điều khoản mạng (AGPL §13) — bắt buộc
Mọi bản **phân phối lại HOẶC cung cấp dưới dạng dịch vụ qua mạng (SaaS)** — kể cả bản đã chỉnh sửa — **bắt buộc**:
- Phát hành dưới cùng **AGPL-3.0**.
- **Công khai mã nguồn đầy đủ** (kể cả phần bạn sửa) cho người dùng — gồm cả người dùng truy cập qua mạng.
- Giữ nguyên thông báo bản quyền + giấy phép.

→ Không ai có thể biến ZaloCRM thành sản phẩm **đóng/độc quyền** (kể cả host SaaS) mà không mở mã nguồn.

### Giấy phép thương mại (dual-license)
Nếu bạn muốn dùng ZaloCRM **không chịu ràng buộc copyleft của AGPL** (vd nhúng vào sản phẩm đóng,
phân phối bản tuỳ biến không công khai mã, hoặc cung cấp SaaS độc quyền) → mua **giấy phép thương mại**.
Liên hệ: **locnt@locnguyendata.com**.

### Thương hiệu (Trademark)
Tên **"ZaloCRM"**, logo và nhận diện thương hiệu **KHÔNG** được cấp theo AGPL (AGPL/GPL không cấp quyền
nhãn hiệu). Bạn được fork và phân phối lại mã nguồn theo AGPL, nhưng **không được dùng tên/logo "ZaloCRM"**
để đặt tên, quảng bá hay bán bản phái sinh nếu chưa được phép bằng văn bản. Hãy đổi tên thương hiệu cho bản fork của bạn.

---

## Lời cảm ơn

Xin chân thành cảm ơn:
- [hsholding](https://github.com/hsholding) — vì những đóng góp ý tưởng, kinh nghiệm thực tế quý báu và codebase giúp đưa các logic và chức năng thiết thực vào sản phẩm
- [vuongnguyenbinh/ZaloCRM](https://github.com/vuongnguyenbinh/ZaloCRM) — vì những ý tưởng và codebase cho dự án này
- [darkamenosa/openzca](https://github.com/darkamenosa/openzca) — vì CLI tích hợp Zalo (zca-js wrapper) mà ZaloCRM dùng làm cầu nối tới các tài khoản Zalo


Trên cơ sở những đóng góp ý tưởng và code của các tác giả trên, tôi xây dựng tiếp và phát triển ZaloCRM thành phiên bản hiện tại.

> 📄 Bản gốc giấy phép MIT của 2 dự án source-fork (vuongnguyenbinh + darkamenosa) được lưu trong [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
