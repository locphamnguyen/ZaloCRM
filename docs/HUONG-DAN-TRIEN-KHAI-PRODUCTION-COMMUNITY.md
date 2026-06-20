# Hướng dẫn triển khai ZaloCRM lên Production (v3.4)

> Runbook **tự chứa** cho ZaloCRM (mã nguồn mở, **GPL-3.0**). Gồm 2 luồng: **cài mới từ đầu**
> và **nâng cấp** bản đang chạy lên v3.4. Mọi thao tác **idempotent + giữ dữ liệu**.
>
> Thay `sub.domain.com` / `file.domain.com` bằng domain thật của bạn. Hướng dẫn sử dụng:
> [`HUONG-DAN-NGUOI-DUNG.md`](./HUONG-DAN-NGUOI-DUNG.md).

## Tính năng chính
Chat đa nick Zalo (realtime Socket.IO), danh bạ/CRM + chấm điểm (lead scoring), lịch hẹn & nhắc hẹn,
media (ảnh/video/audio/file qua MinIO/S3/R2), cầu **Zalo ↔ Telegram**, RBAC + tổ chức + audit,
AI assistant (Anthropic/Gemini/OpenAI/Qwen/Kimi), analytics, PWA mobile + push.

---

## 1. Yêu cầu

- Docker + Docker Compose. VPS gợi ý **2–4 vCPU / 4 GB RAM / 80 GB SSD**.
- Domain HTTPS cho app (vd `sub.domain.com`) **và** một domain HTTPS cho ảnh/MinIO (vd `file.domain.com`) — xem §5.

---

## 2. Lấy source + tạo `.env`

```bash
git clone <repo-url> zalocrm && cd zalocrm
cp .env.example .env
```

Điền `.env` — **bắt buộc** với production:

| Biến | Ghi chú |
|---|---|
| `JWT_SECRET`, `ENCRYPTION_KEY` | `openssl rand -hex 32` mỗi cái (đổi `JWT_SECRET` sau = logout toàn bộ) |
| `DB_PASSWORD` | mật khẩu Postgres mạnh (KHỚP phần password trong `DATABASE_URL`) |
| `APP_URL`, `CRM_LOGIN_URL` | domain prod, vd `https://sub.domain.com` — CSP tự ghim `wss://` từ đây |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | đổi khác `minioadmin`; `S3_ACCESS_KEY`/`S3_SECRET_KEY` khớp tương ứng |
| `S3_PUBLIC_URL` | **URL HTTPS công khai** tới MinIO, vd `https://file.domain.com` (xem §5) |
| `TELEGRAM_BRIDGE_BOT_TOKEN` | (tuỳ chọn) bật cầu Zalo↔Telegram; để trống = cầu TẮT |
| `ANTHROPIC_AUTH_TOKEN` … | (tuỳ chọn) token AI nếu dùng |

Để **mặc định** (trỏ service nội bộ compose): `DATABASE_URL` (host `db`), `REDIS_URL` (`redis`),
`S3_ENDPOINT` (`http://minio:9000`).

> `.env` đã được `.gitignore` + `.dockerignore` — không commit, không lọt vào image.

Sinh nhanh secret:
```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "DB_PASSWORD=$(openssl rand -hex 16)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)"
```

---

## 3. Build + chạy + tạo DB

```bash
# clamav + backup là service tuỳ chọn (antivirus mặc định TẮT: MEDIA_AV_ENABLED=0)
# → chỉ chạy core services:
docker compose up -d --build app db redis minio minio-init     # ~3-8 phút lần đầu
docker compose ps                                              # app/db/redis/minio "Up"

# App KHÔNG tự migrate — chạy thủ công:
docker exec zalo-crm-app npx prisma migrate deploy            # → "All migrations ... applied"
docker compose restart app                                    # boot sạch sau khi có bảng
```

Kiểm tra nhanh:
```bash
curl -s -o /dev/null -w "root / -> %{http_code}\n" http://localhost:3080/        # 200
curl -s http://localhost:3080/api/v1/setup/status                               # {"needsSetup":true}
docker logs zalo-crm-app 2>&1 | grep -i "running on"                            # Zalo CRM running on ...
```

> 🛑 **KHÔNG dùng `-v` khi rebuild — sẽ MẤT DATABASE.** Xem [§3a](#3a-an-toàn-dữ-liệu-khi-rebuild-đừng-mất-database).

---

## 3a. An toàn dữ liệu khi rebuild (ĐỪNG mất database)

> Triệu chứng khi làm sai: **rebuild xong đăng nhập lại bị đá về `/setup-password`** (hoặc `/setup`
> báo `needsSetup:true`). Đó KHÔNG phải bug — là do **database đã bị xoá**: tài khoản mất → app về
> first-run → owner tạo lại có `passwordChangedAt = null` → router guard ép đổi mật khẩu lần đầu.

Dữ liệu (Postgres, MinIO, Redis) nằm trong **Docker named volumes** (`zalocrm_pg_data`,
`zalocrm_minio_data`, `zalocrm_redis_data`, `zalocrm_file_storage`). Còn volume = còn dữ liệu.

| Lệnh | DB/tài khoản | Khi nào dùng |
|---|---|---|
| `docker compose up -d --build app` | ✅ GIỮ | **Rebuild thường (mặc định)** — đổi code, fix |
| `docker compose restart app` | ✅ GIỮ | Đọc lại `.env` sau khi sửa (không đổi code) |
| `docker compose down` | ✅ GIỮ | Tắt tạm; `up -d` lên lại còn nguyên dữ liệu |
| `docker compose down **-v**` | 🛑 **XOÁ SẠCH** | **CHỈ** khi cố ý reset từ đầu |

**Vì sao đôi khi vẫn phải `-v`?** Mật khẩu `DB_PASSWORD` / `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
được **"đóng băng" vào volume lúc khởi tạo lần đầu**. Đổi các mật khẩu này về sau → muốn áp được
**bắt buộc** `down -v` (và **mất dữ liệu**). → Hãy **chốt mật khẩu ngay từ đầu** (§2). Nếu buộc phải
đổi mà muốn giữ dữ liệu: backup trước rồi restore sau khi recreate.

```bash
# Backup trước mọi thao tác mạo hiểm:
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-$(date +%F-%H%M).sql
```

---

## 4. Tạo tài khoản chủ (owner) lần đầu

Mở `https://sub.domain.com` → trang **/setup** tự hiện → tạo tổ chức + owner. Kiểm tra:
```bash
curl -s https://sub.domain.com/api/v1/setup/status   # {"needsSetup":false} sau khi tạo
```
Sau đó **Cài đặt → Tài khoản Zalo → Thêm nick → quét QR** (KHÔNG mở Zalo Web cùng lúc).

---

## 5. HTTPS qua Cloudflare Tunnel (2 Public Hostname)

Nếu dùng `cloudflared` token (dashboard-managed) → vào **Zero Trust → Networks → Tunnels →
Public Hostname**, thêm:

| Public hostname | Service |
|---|---|
| `sub.domain.com` | `http://localhost:3080` |
| `file.domain.com` | `http://localhost:9000` |

- #1 = app (WebSocket tự đi qua). #2 = MinIO cho `S3_PUBLIC_URL`. Bỏ #2 thì ảnh/sticker/logo
  trong chat không hiển thị.
- `S3_PUBLIC_URL` phải là **HTTPS công khai, không port lạ** (đừng dùng `http://...:9000` —
  CF không proxy port 9000; trang https tải ảnh http bị chặn mixed-content).

Kiểm tra:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sub.domain.com/                 # 200
curl -sI https://file.domain.com/minio/health/live | head -1                     # 200
```
(App đã `trustProxy: true` → cookie `Secure` + `wss://` chạy đúng sau tunnel.)

> Phương án Caddy + Let's Encrypt trỏ thẳng IP VPS: tạo 2 A record (DNS only), cài `caddy`,
> `reverse_proxy 127.0.0.1:3080` (app) và `127.0.0.1:9000` (MinIO), mở 80/443.

---

## 6. Nâng cấp bản đang chạy lên **v3.4** (từ bản cũ → mới)

> **Idempotent + GIỮ dữ liệu.**

**Có gì mới ở v3.4:** cầu **Zalo ↔ Telegram** (2 chiều, media), media forward/mirror đầy đủ,
clamav image tag `1.4`, nhiều fix hiệu năng & UI. **Migration mới** (additive — an toàn):
`telegram_bridge_phase0` và một số migration phụ. **Biến `.env` mới (tuỳ chọn):**
`TELEGRAM_BRIDGE_BOT_TOKEN`.

```bash
# B1 — BACKUP DB trước (bắt buộc)
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-truoc-nang-cap-$(date +%F-%H%M).sql
ls -lh backup-truoc-nang-cap-*.sql        # phải > 0 byte

# B2 — Lấy code mới
git pull

# B3 — Kiểm .env: GIỮ NGUYÊN JWT_SECRET / ENCRYPTION_KEY / DB_PASSWORD / MinIO (đổi = mất phiên/dữ liệu).
#      (Tuỳ chọn) thêm TELEGRAM_BRIDGE_BOT_TOKEN để bật cầu Telegram.

# B4 — Build lại, GIỮ DB (KHÔNG -v — xem §3a)
docker compose up -d --build app

# B5 — Migrate DB (BẮT BUỘC — LUÔN deploy, KHÔNG "migrate dev")
docker exec zalo-crm-app npx prisma migrate deploy

# B6 — Cutover: ép mọi user đăng nhập lại 1 lần (đóng token cũ)
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "UPDATE users SET jwt_token_version = jwt_token_version + 1;"
docker compose restart app
```

> 🛑 **CHỈ `up -d --build app`, KHÔNG `down -v`** (down -v xoá DB → mất tài khoản → đăng nhập lại bị
> đá về `/setup-password`). Đổi `crmuser`/`zalocrm` nếu `.env` đặt `DB_USER`/`DB_NAME` khác.

**B7 — Kiểm tra sau nâng cấp:**
```bash
curl -s -o /dev/null -w "root → %{http_code}\n" http://localhost:3080/                 # 200
curl -sI http://localhost:3080/ | grep -i content-security-policy                       # có header CSP
docker exec zalo-crm-db psql -U crmuser -d zalocrm -tAc "SELECT count(*) FROM users;"   # >0 (DB còn nguyên)
```
> User cần **đăng nhập lại 1 lần** sau B6 (đúng, không phải lỗi). Đăng nhập xong vào thẳng dashboard.

**B8 — Siết bảo mật SAU vài ngày (không gấp):** `.env` `CSP_MODE=enforce` sau khi `report-only` sạch;
`SOCKET_REQUIRE_ACCESS_TYP=true` sau ~7 ngày → mỗi lần đổi chỉ cần `docker compose up -d app`.

### Đổi `S3_PUBLIC_URL` trên hệ đang chạy (2 việc hay quên)
```bash
docker compose up -d app   # a. restart KHÔNG đủ — phải recreate để đọc lại .env
# b. URL ảnh cũ lưu TUYỆT ĐỐI trong DB → rewrite:
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
  "UPDATE media_blobs SET public_url = replace(public_url, '<URL-CŨ>', '<URL-MỚI>') WHERE public_url LIKE '<URL-CŨ>%';"
```

### Rollback (nếu sự cố nặng)
```bash
git checkout <branch-hoặc-commit-cũ> && docker compose up -d --build app
# Migration additive (không drop dữ liệu) → thường KHÔNG cần rollback DB. Nếu cần:
cat backup-truoc-nang-cap-*.sql | docker exec -i zalo-crm-db psql -U crmuser zalocrm
```

---

## 7. Giấy phép — GPL-3.0

ZaloCRM phát hành theo **GNU General Public License v3.0 (GPL-3.0)** — xem [LICENSE](../LICENSE).
Copyleft: mọi bản **phân phối lại** (kể cả bản đã chỉnh sửa) **bắt buộc** phát hành dưới GPL-3.0 và
kèm **mã nguồn đầy đủ**. Muốn dùng theo điều khoản thương mại (không chịu ràng buộc copyleft) —
dual-license: liên hệ `locnt@locnguyendata.com`.

---

## 8. Sự cố thường gặp

| Triệu chứng | Xử lý |
|---|---|
| **Rebuild xong đăng nhập bị đá về `/setup-password`** | DB bị xoá do rebuild kèm **`down -v`**. Dùng `docker compose up -d --build app` (giữ volume). Xem [§3a](#3a-an-toàn-dữ-liệu-khi-rebuild-đừng-mất-database). |
| `migrate deploy` báo lỗi quan hệ/cột | DB thiếu bảng → chụp log gửi dev; KHÔNG `migrate dev` |
| Build fail `npm run build` | `cd backend && npx tsc` xem lỗi thật → vá rồi build lại |
| `clamav/clamav:1.x not found` khi `docker compose up` (không kèm tên service) | clamav/backup tuỳ chọn — chạy `docker compose up -d --build app db redis minio minio-init` |
| Boot đầu log lỗi liên quan bảng chưa tồn tại | transient trước `migrate deploy`; sau migrate + `restart app` hết |
| Ảnh chat không hiển thị | `S3_PUBLIC_URL` chưa HTTPS công khai / chưa thêm hostname `file.domain.com` (§5) |
| Mất kết nối Zalo | tự reconnect ~30s; không được → Tài khoản Zalo quét QR lại (KHÔNG mở Zalo Web) |
