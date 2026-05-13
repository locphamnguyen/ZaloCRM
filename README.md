# ZaloCRM v3.0 — Quản lý nhiều tài khoản Zalo cá nhân

Hệ thống quản lý tập trung nhiều tài khoản Zalo cá nhân trên 1 giao diện web. Chat real-time, gửi ảnh/video/file qua MinIO, AI assistant, workflow tự động, tích hợp đa nền tảng, analytics nâng cao, PWA mobile.

**GitHub:** [https://github.com/locphamnguyen/ZaloCRM](https://github.com/locphamnguyen/ZaloCRM)

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

## Nâng cấp từ v2.1 lên v3.0

> ⚠️ **Backup database trước khi nâng cấp.** Schema v3.0 thêm bảng `friends`, `friendship_attempts` và nhiều field aggregate.

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

## Dịch vụ & Hỗ trợ

Bạn cần triển khai ZaloCRM cho doanh nghiệp, custom thêm tính năng riêng, hoặc tích hợp với hệ thống có sẵn? Liên hệ trực tiếp tôi để được tư vấn:

- 🌐 **Website:** [https://locnguyendata.com](https://locnguyendata.com)
- 📧 **Email:** [locnt@locnguyendata.com](mailto:locnt@locnguyendata.com)
- 📱 **Điện thoại / Zalo:** [0945031039](tel:0945031039)

### Dịch vụ cung cấp
- **Setup & deploy** ZaloCRM trên server riêng (VPS / dedicated / cloud)
- **Customize** giao diện, workflow, AI prompt theo nghiệp vụ doanh nghiệp
- **Phát triển tính năng mới** theo yêu cầu (CRM module, AI agent, automation, dashboard riêng)
- **Tích hợp** với hệ thống có sẵn: ERP, CRM khác (HubSpot, Salesforce), payment gateway, kế toán
- **Đào tạo & support** team sử dụng, vận hành, troubleshoot
- **Mở rộng zca-js** — fix bug, thêm tính năng đặc thù, tối ưu chống block

## Giấy phép

MIT — Miễn phí sử dụng, chỉnh sửa, phân phối lại cho mọi mục đích cá nhân và thương mại. Xem [LICENSE](LICENSE).

---

## Lời cảm ơn

Xin chân thành cảm ơn:
- [vuongnguyenbinh/ZaloCRM](https://github.com/vuongnguyenbinh/ZaloCRM) — vì những ý tưởng và codebase nền tảng làm cốt lõi cho dự án này
- [darkamenosa/openzca](https://github.com/darkamenosa/openzca) — vì CLI tích hợp Zalo (zca-js wrapper) mà ZaloCRM dùng làm cầu nối tới các tài khoản Zalo

Trên cơ sở những đóng góp ý tưởng và code của các tác giả trên, tôi xây dựng tiếp và phát triển ZaloCRM thành phiên bản hiện tại.
