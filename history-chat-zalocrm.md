# Lịch sử Chat — ZaloCRM Project

> Ngày: 28-29/03/2026
> Công cụ: Claude Code + gstack

---

## 1. Cài đặt và nâng cấp gstack

- Chạy `/gstack`, phát hiện đang dùng **v0.12.11.0**, có bản mới **v0.13.1.0**
- Nâng cấp thành công qua git (global-git install tại `~/.claude/skills/gstack`)
- Bật chế độ **proactive suggestions** (gstack tự gợi ý skill phù hợp khi làm việc)

### Những gì mới trong v0.13.1.0:
- Design binary (`$D`) — tạo UI mockup thật qua GPT Image API
- `/design-shotgun` — tạo nhiều design variants, so sánh trong browser
- Bảo mật: auth token, CORS, path validation, shell config
- Dọn 2,000+ dòng code chết
- Skill prefix tuỳ chọn (`/qa` hoặc `/gstack-qa`)
- Codex không còn lang thang vào file skill
- Sửa 38 glob patterns cho zsh

---

## 2. Hướng dẫn sử dụng conductor.json

### Conductor là gì?
- Ứng dụng riêng (từ [conductor.build](https://conductor.build)), không phải lệnh Claude Code
- Chạy nhiều Claude Code session song song
- Mỗi session trong git worktree tách biệt

### Cấu trúc conductor.json:
```json
{
  "scripts": {
    "setup": "bin/dev-setup",
    "archive": "bin/dev-teardown"
  }
}
```

Chỉ có 2 hook:
- **setup** — chạy khi Conductor tạo workspace mới
- **archive** — chạy khi dọn dẹp workspace

---

## 3. Tạo Conductor config cho ZaloCRM

Đã tạo 3 file tại `/root/0project/ZaloCRM/`:

### conductor.json
```json
{
  "scripts": {
    "setup": "bin/dev-setup",
    "archive": "bin/dev-teardown"
  }
}
```

### bin/dev-setup
- Copy `.env`, `backend/.env`, `frontend/.env` từ worktree chính sang workspace mới
- Chạy `npm install` cho cả backend và frontend nếu chưa có `node_modules`

### bin/dev-teardown
- Xoá `.env` files khỏi worktree khi đóng workspace (không leak secrets)

---

## 4. Sprint Structure theo gstack

gstack tổ chức mọi sprint theo **7 phase**:

### Think → Plan → Build → Review → Test → Ship → Reflect

| Phase | Skill | Vai trò |
|-------|-------|---------|
| 1. Think | `/office-hours` | Khám phá, đặt câu hỏi, reframe vấn đề |
| 2. Plan | `/plan-ceo-review` → `/plan-eng-review` → `/plan-design-review` | Scope → Kiến trúc → UI/UX |
| 3. Build | Claude Code | Triển khai theo plan đã lock |
| 4. Review | `/review` | Tìm bug mà CI bỏ sót |
| 5. Test | `/qa` | Mở browser thật, test user flow |
| 6. Ship | `/ship` + `/land-and-deploy` | Tạo PR, merge, verify production |
| 7. Reflect | `/retro` | Metrics, velocity, cải thiện |

---

## 5. Sprint Plan cho ZaloCRM

Đã tạo file `plans/sprint-plan.md` với **6 sprint song song**:

| Sprint | Tên | Độ ưu tiên | Nội dung chính |
|--------|-----|-----------|----------------|
| S1 | AI Assistant | Cao | Claude/Gemini gợi ý trả lời, tóm tắt hội thoại, phân tích cảm xúc |
| S2 | Workflow Automation | Cao | Rules engine tự động assign, gửi template, chuyển status |
| S3 | Advanced Analytics | Trung bình | Conversion funnel, team performance, response time |
| S4 | Contact Intelligence | Trung bình | Phát hiện trùng lặp, merge, lead scoring |
| S5 | Mobile PWA | Thấp | Progressive Web App, push notifications, offline |
| S6 | Integration Hub | Thấp | Google Sheets, Telegram, Facebook, Zapier |

### Mỗi sprint bao gồm:
- Database schema (Prisma models)
- Backend module structure và API endpoints
- Frontend components
- Test plan và review checklist

### Thứ tự merge khuyến nghị:
```
S4 (Contact Intelligence)  ← merge trước, không phụ thuộc gì
  ↓
S3 (Advanced Analytics)    ← dùng lead score từ S4
  ↓
S2 (Workflow Automation)   ← dùng templates, trigger analytics
  ↓
S1 (AI Assistant)          ← có thể dùng templates từ S2
  ↓
S5 (Mobile PWA)            ← cần tất cả features đã có
  ↓
S6 (Integration Hub)       ← cuối cùng, kết nối bên ngoài
```

---

## 6. Push lên GitHub

- Tạo repo private: **https://github.com/locphamnguyen/zalocrm**
- Đổi origin từ `vuongnguyenbinh/ZaloCRM` sang `locphamnguyen/zalocrm`
- Commit 4 file mới (conductor.json, bin/dev-setup, bin/dev-teardown, plans/sprint-plan.md)
- Push thành công lên branch `main`
- Git identity: **Nguyễn Tiến Lộc** (`locphamnguyen`)

---

## 7. Gán Workspace vào Sprint trên Conductor

Mỗi workspace cần paste prompt tương ứng:

### Workspace 1 — AI Assistant
```
Đọc file plans/sprint-plan.md, phần "Sprint S1: AI Assistant". Thực hiện đầy đủ theo 7 phase của gstack:

1. THINK — Phân tích và trả lời các câu hỏi trong Phase 1
2. PLAN — Tạo database schema (Prisma), backend module, frontend components theo plan
3. BUILD — Code toàn bộ tính năng AI suggest, summarize, sentiment analysis
4. REVIEW — Chạy /review kiểm tra code
5. TEST — Chạy /qa test tính năng
6. SHIP — Chạy /ship tạo PR
7. REFLECT — Ghi nhận kết quả

Tech stack: Fastify + Prisma + Vue 3 + Vuetify. Database: PostgreSQL.
Backend ở backend/, Frontend ở frontend/.
```

### Workspace 2 — Workflow Automation
```
Đọc file plans/sprint-plan.md, phần "Sprint S2: Workflow Automation". Thực hiện đầy đủ theo 7 phase của gstack:

1. THINK — Xác định các workflow phổ biến nhất cho CRM
2. PLAN — Tạo database schema (AutomationRule, MessageTemplate), backend rule engine, frontend rule builder
3. BUILD — Code toàn bộ: triggers, conditions, actions, template manager
4. REVIEW — Chạy /review kiểm tra code
5. TEST — Chạy /qa test các rule tự động
6. SHIP — Chạy /ship tạo PR
7. REFLECT — Ghi nhận kết quả

Tech stack: Fastify + Prisma + Vue 3 + Vuetify. Database: PostgreSQL.
Backend ở backend/, Frontend ở frontend/.
```

### Workspace 3 — Advanced Analytics
```
Đọc file plans/sprint-plan.md, phần "Sprint S3: Advanced Analytics". Thực hiện đầy đủ theo 7 phase của gstack:

1. THINK — Xác định metrics quan trọng nhất cho sales team
2. PLAN — Tạo database schema (SavedReport), backend analytics module, frontend charts
3. BUILD — Code toàn bộ: conversion funnel, team performance, response time, report builder
4. REVIEW — Chạy /review kiểm tra code
5. TEST — Chạy /qa test các báo cáo
6. SHIP — Chạy /ship tạo PR
7. REFLECT — Ghi nhận kết quả

Tech stack: Fastify + Prisma + Vue 3 + Vuetify + Chart.js. Database: PostgreSQL.
Backend ở backend/, Frontend ở frontend/.
```

### Workspace 4 — Contact Intelligence
```
Đọc file plans/sprint-plan.md, phần "Sprint S4: Contact Intelligence". Thực hiện đầy đủ theo 7 phase của gstack:

1. THINK — Xác định tiêu chí phát hiện trùng lặp và lead scoring
2. PLAN — Thêm trường leadScore, mergedInto vào Contact model, tạo DuplicateGroup model
3. BUILD — Code toàn bộ: duplicate detector, merge service, lead scoring, auto tagger
4. REVIEW — Chạy /review kiểm tra code
5. TEST — Chạy /qa test merge contacts và lead scoring
6. SHIP — Chạy /ship tạo PR
7. REFLECT — Ghi nhận kết quả

Tech stack: Fastify + Prisma + Vue 3 + Vuetify. Database: PostgreSQL.
Backend ở backend/, Frontend ở frontend/.
```

### Workspace 5 — Mobile PWA
```
Đọc file plans/sprint-plan.md, phần "Sprint S5: Mobile API + PWA". Thực hiện đầy đủ theo 7 phase của gstack:

1. THINK — Xác định tính năng ưu tiên cho mobile sales rep
2. PLAN — Thêm vite-plugin-pwa, tạo manifest.json, service worker, mobile views
3. BUILD — Code toàn bộ: MobileChatView, MobileContactView, BottomNav, offline support
4. REVIEW — Chạy /review kiểm tra code
5. TEST — Chạy /qa test responsive layouts
6. SHIP — Chạy /ship tạo PR
7. REFLECT — Ghi nhận kết quả

Tech stack: Fastify + Prisma + Vue 3 + Vuetify + vite-plugin-pwa. Database: PostgreSQL.
Backend ở backend/, Frontend ở frontend/.
```

### Workspace 6 — Integration Hub
```
Đọc file plans/sprint-plan.md, phần "Sprint S6: Integration Hub". Thực hiện đầy đủ theo 7 phase của gstack:

1. THINK — Xác định integration nào người dùng cần nhất
2. PLAN — Tạo database schema (Integration, SyncLog), backend providers, frontend config UI
3. BUILD — Code toàn bộ: Google Sheets sync, Telegram bot, Facebook import, Zapier webhooks
4. REVIEW — Chạy /review kiểm tra code
5. TEST — Chạy /qa test các integration
6. SHIP — Chạy /ship tạo PR
7. REFLECT — Ghi nhận kết quả

Tech stack: Fastify + Prisma + Vue 3 + Vuetify. Database: PostgreSQL.
Backend ở backend/, Frontend ở frontend/.
```

---

## Trạng thái hiện tại của ZaloCRM

### Đã hoàn thành (MVP):
- Multi-org CRM với role-based access (Owner/Admin/Member)
- Zalo multi-account integration với auto-reconnect
- Chat real-time với attachments (text, image, file, sticker, voice, video, link)
- Contact pipeline (Mới → Đã liên hệ → Quan tâm → Chuyển đổi → Mất)
- Appointment scheduling với daily reminders
- Dashboard 6 KPI + 4 charts
- Excel export (messages, contacts, appointments)
- Public REST API + API keys
- Webhook delivery (HMAC-SHA256 signed)
- Global search
- Real-time notifications

### Tech stack:
- **Backend:** Node.js 20, Fastify 5, TypeScript, Prisma 7, Socket.IO, zca-js
- **Frontend:** Vue 3, Vite 8, Vuetify 3, Pinia, Chart.js, Vue I18n
- **Database:** PostgreSQL 16
- **Deploy:** Docker Compose (app + PostgreSQL + automated backups)

### Repo:
- GitHub (private): https://github.com/locphamnguyen/zalocrm
- Git identity: Nguyễn Tiến Lộc (locphamnguyen)

---

## 8. Prompt tạo Sprint Plan cho dự án bất kỳ

Hướng dẫn cách viết prompt để Claude tự tạo sprint plan theo gstack 7-phase
cho bất kỳ dự án nào, với ý tưởng và chức năng mới.

### Prompt cơ bản (copy và thay phần trong ngoặc vuông)

```
Đọc toàn bộ codebase của dự án này. Phân tích:

1. Tech stack đang dùng (backend, frontend, database, deployment)
2. Những tính năng đã hoàn thành
3. Những tính năng chưa có nhưng nên có

Sau đó tạo Sprint Plan theo cấu trúc gstack 7-phase
(Think → Plan → Build → Review → Test → Ship → Reflect)
để chạy song song trên Conductor.

Yêu cầu cho mỗi sprint:
- Database schema (Prisma/SQL cụ thể)
- Backend module structure + API endpoints
- Frontend components + views
- Mỗi sprint phải độc lập, không sửa cùng file
- Ghi rõ thứ tự merge khuyến nghị

Ý tưởng tính năng mới tôi muốn thêm:
- [Tính năng 1: mô tả ngắn]
- [Tính năng 2: mô tả ngắn]
- [Tính năng 3: mô tả ngắn]

Lưu kết quả vào file plans/sprint-plan.md
```

### Prompt nâng cao (kiểm soát chi tiết hơn)

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase.

QUAN TRỌNG:
- Mỗi sprint PHẢI có đầy đủ 7 phase với skill tương ứng
  (/office-hours, /plan-ceo-review, /plan-eng-review,
  /plan-design-review, /review, /qa, /ship, /retro)
- Phase PLAN phải có database schema viết sẵn (Prisma hoặc SQL)
- Phase PLAN phải có cây thư mục backend + frontend cụ thể
- Phase PLAN phải liệt kê đầy đủ API endpoints
- Tối đa [6] sprint song song
- Ưu tiên: [Cao/Trung bình/Thấp] cho từng sprint
- Ghi rõ prompt cho từng Conductor workspace
- Ghi rõ thứ tự merge và lý do

Ý tưởng:
- [...]
- [...]

Lưu vào plans/sprint-plan.md
```

### Ví dụ cho dự án E-commerce

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase
để chạy song song trên Conductor.

Ý tưởng tính năng mới:
- Hệ thống voucher và mã giảm giá
- Chat real-time giữa buyer và seller
- Đánh giá sản phẩm với hình ảnh
- Gợi ý sản phẩm bằng AI
- Tích hợp thanh toán VNPay/Momo
- Push notification cho đơn hàng

Mỗi sprint cần: database schema, backend API, frontend components.
Lưu vào plans/sprint-plan.md
```

### Ví dụ cho dự án SaaS / Dashboard

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase
để chạy song song trên Conductor.

Ý tưởng tính năng mới:
- Multi-tenant với billing theo plan
- Role-based access control nâng cao
- Audit log và activity tracking
- Export PDF/Excel báo cáo tự động
- API rate limiting và usage analytics
- Webhook system cho third-party

Mỗi sprint cần: database schema, backend API, frontend components.
Lưu vào plans/sprint-plan.md
```

### Ví dụ 3: Dự án Giáo dục / LMS (Learning Management System)

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase
để chạy song song trên Conductor.

Ý tưởng tính năng mới:
- Hệ thống bài giảng video với progress tracking
- Quiz và bài kiểm tra tự chấm điểm
- Diễn đàn hỏi đáp giữa học viên và giảng viên
- Cấp chứng chỉ tự động khi hoàn thành khoá học
- Gamification: huy hiệu, bảng xếp hạng, streak học tập
- Thanh toán khoá học qua VNPay/Momo
- AI tạo đề thi và giải thích đáp án

Đối tượng: học viên online, giảng viên, admin trường.
Mỗi sprint cần: database schema, backend API, frontend components.
Lưu vào plans/sprint-plan.md
```

### Ví dụ 4: Dự án Quản lý Phòng khám / Bệnh viện

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase
để chạy song song trên Conductor.

Ý tưởng tính năng mới:
- Đặt lịch khám online với chọn bác sĩ và khung giờ
- Hồ sơ bệnh án điện tử (EMR) với lịch sử khám
- Kê đơn thuốc điện tử liên kết với nhà thuốc
- Thông báo nhắc lịch tái khám qua SMS/Zalo
- Dashboard thống kê: số lượt khám, doanh thu, tỷ lệ tái khám
- Quản lý kho thuốc và vật tư y tế
- Tích hợp bảo hiểm y tế (tra cứu BHYT)

Giới hạn: phải tuân thủ quy định bảo mật dữ liệu y tế Việt Nam.
Mỗi sprint cần: database schema, backend API, frontend components.
Lưu vào plans/sprint-plan.md
```

### Ví dụ 5: Dự án Quản lý Bất động sản

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase
để chạy song song trên Conductor.

Ý tưởng tính năng mới:
- Đăng tin bất động sản với bản đồ (Google Maps/Mapbox)
- Tìm kiếm nâng cao: lọc theo giá, diện tích, vị trí, loại BĐS
- So sánh nhiều bất động sản cạnh nhau
- Lịch hẹn xem nhà với nhắc nhở tự động
- Pipeline quản lý khách hàng tiềm năng (lead → xem nhà → đàm phán → chốt)
- Tính toán lãi suất vay ngân hàng
- Báo cáo thị trường theo khu vực (giá trung bình, xu hướng)
- Chia sẻ tin đăng qua Zalo/Facebook tự động

Đối tượng: môi giới BĐS, chủ nhà, khách mua/thuê.
Mỗi sprint cần: database schema, backend API, frontend components.
Lưu vào plans/sprint-plan.md
```

### Ví dụ 6: Dự án Food Delivery / Đặt đồ ăn

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase
để chạy song song trên Conductor.

Ý tưởng tính năng mới:
- Quản lý menu nhà hàng với hình ảnh và giá
- Giỏ hàng và đặt đơn real-time
- Theo dõi đơn hàng trên bản đồ (rider tracking)
- Hệ thống đánh giá nhà hàng và món ăn
- Mã khuyến mãi và chương trình tích điểm
- Quản lý đội ngũ shipper (assign, route tối ưu)
- Thông báo push khi đơn thay đổi trạng thái
- Dashboard doanh thu cho chủ nhà hàng

Giới hạn: chạy trên VPS 4GB RAM, không dùng Elasticsearch.
Đối tượng: khách hàng, nhà hàng, shipper, admin.
Mỗi sprint cần: database schema, backend API, frontend components.
Lưu vào plans/sprint-plan.md
```

### Ví dụ 7: Dự án HR / Quản lý Nhân sự

```
Đọc toàn bộ codebase. Tạo Sprint Plan theo gstack 7-phase
để chạy song song trên Conductor.

Ý tưởng tính năng mới:
- Chấm công bằng QR code / nhận diện khuôn mặt
- Quản lý đơn xin nghỉ phép (duyệt nhiều cấp)
- Bảng lương tự động tính theo ngày công, phụ cấp, thuế TNCN
- Quản lý hợp đồng lao động (nhắc gia hạn trước 30 ngày)
- Tuyển dụng: đăng tin, nhận CV, pipeline ứng viên
- Đánh giá KPI nhân viên theo quý
- Cây tổ chức công ty (org chart) trực quan
- Export báo cáo nhân sự cho cơ quan thuế

Đối tượng: nhân viên, quản lý, HR admin, kế toán.
Giới hạn: tuân thủ Luật Lao động Việt Nam.
Mỗi sprint cần: database schema, backend API, frontend components.
Lưu vào plans/sprint-plan.md
```

### Mẹo để có sprint plan tốt hơn

| Mẹo | Giải thích |
|-----|-----------|
| Mô tả rõ đối tượng sử dụng | "Cho sales rep" khác với "cho manager" |
| Nêu giới hạn kỹ thuật | "Không dùng Redis", "Phải chạy trên VPS 2GB RAM" |
| Nêu thứ tự ưu tiên | "Tính năng X quan trọng nhất, Y có thể làm sau" |
| Nêu tính năng KHÔNG muốn | "Không cần mobile app", "Chưa cần AI" |
| Cho context business | "Đang có 50 users, cần scale lên 500" |

### Quy trình đầy đủ

```
Bước 1: Paste prompt vào Claude Code (ở thư mục gốc dự án)
         ↓
Bước 2: Claude đọc code, phân tích, tạo plans/sprint-plan.md
         ↓
Bước 3: git add plans/sprint-plan.md && git commit && git push
         ↓
Bước 4: Mở Conductor, tạo N workspace
         ↓
Bước 5: Paste prompt từng workspace (lấy từ sprint plan)
         ↓
Bước 6: Start — N agent chạy song song
         ↓
Bước 7: Review và merge PR theo thứ tự khuyến nghị
```
