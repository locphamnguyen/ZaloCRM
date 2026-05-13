# Hướng dẫn sử dụng ZaloCRM v3.0

Tài liệu này hướng dẫn người dùng cuối cách sử dụng các chức năng chính của ZaloCRM v3.0 — từ đăng nhập, kết nối Zalo, chat khách hàng, đến quản lý lịch hẹn, báo cáo và automation.

> 📦 **Cài đặt:** [HUONG-DAN-CAI-DAT.md](../HUONG-DAN-CAI-DAT.md) — dành cho admin/dev triển khai trên server.

## Mục lục

1. [Đăng nhập](#1-đăng-nhập)
2. [Dashboard — Tổng quan](#2-dashboard--tổng-quan)
3. [Chat với khách hàng](#3-chat-với-khách-hàng)
4. [Bạn bè & cặp nick × khách hàng](#4-bạn-bè--cặp-nick--khách-hàng)
5. [Khách hàng](#5-khách-hàng)
6. [Lịch hẹn](#6-lịch-hẹn)
7. [Phân tích nâng cao](#7-phân-tích-nâng-cao)
8. [Báo cáo](#8-báo-cáo)
9. [Workflow Automation](#9-workflow-automation)
10. [Tài khoản Zalo & Proxy](#10-tài-khoản-zalo--proxy)
11. [Câu hỏi thường gặp](#11-câu-hỏi-thường-gặp)

---

## 1. Đăng nhập

Truy cập địa chỉ hệ thống (mặc định `http://localhost:3080` cho cài đặt local, hoặc domain riêng do admin cung cấp). Điền email + mật khẩu được cấp.

![Đăng nhập](user-guide-images/01-login.png)

> 💡 Tài khoản đầu tiên đăng ký sẽ tự động trở thành Owner. Các tài khoản tiếp theo do Owner/Admin tạo qua trang Cài đặt → Người dùng.

---

## 2. Dashboard — Tổng quan

Sau khi đăng nhập thành công, hệ thống đưa bạn vào trang Dashboard. Toàn bộ chỉ số quan trọng hiển thị dạng card + biểu đồ.

![Dashboard](user-guide-images/02-dashboard.png)

**Các chỉ số chính:**
| Card | Ý nghĩa |
|---|---|
| 💬 Tin nhắn hôm nay | Tổng số tin nhắn gửi/nhận trong ngày |
| ⚠️ Chưa trả lời | Hội thoại có tin khách gửi mà chưa được phản hồi |
| 📧 Chưa đọc | Hội thoại còn tin chưa được đánh dấu đã đọc |
| 📅 Lịch hẹn hôm nay | Lịch hẹn có ngày = hôm nay |
| 👤 KH mới tuần này | Khách hàng tạo mới trong 7 ngày |
| 👥 Tổng khách hàng | Toàn bộ khách hàng trong hệ thống |

**Biểu đồ:**
- **Tin nhắn theo ngày** — cột xanh "Đã gửi" + cột xanh lá "Đã nhận", cho phép phát hiện ngày tăng/giảm bất thường
- **Pipeline khách hàng** — phân bố khách theo trạng thái Mới → Đã liên hệ → Quan tâm → Chuyển đổi → Mất
- **Nguồn khách hàng** — kênh tiếp cận (Facebook, Zalo, Web, Cá nhân…)
- **Trạng thái lịch hẹn** — Sắp tới / Đã hoàn thành / Đã hủy

---

## 3. Chat với khách hàng

Trang Tin nhắn là nơi làm việc chính cho sale. Hiển thị 3 cột: Bộ lọc (trái), Danh sách hội thoại (giữa), Khung chat (phải).

![Chat](user-guide-images/03-chat.png)

### 3.1. Bộ lọc (cột trái)
- **Show tin nhắn của nick** — chọn nick Zalo nào để xem hội thoại (multi-account)
- **Gom inbox** — hợp nhất hội thoại từ nhiều nick
- **Loại hội thoại** — Tin nhắn nhóm / Tin nhắn user (1-1)
- **Đọc / trả lời** — Chỉ chưa đọc / Hội thoại chưa trả lời / Đưa chưa đọc lên đầu
- **Theo thuộc tính** — Lọc theo nhãn / theo thời gian

### 3.2. Danh sách hội thoại (cột giữa)
- Tab **Chính** + **Khác** (ẩn hội thoại không quan trọng — chuột phải để chuyển tab)
- Thanh tìm kiếm theo tên / SĐT / nội dung tin nhắn
- Chip tag: `cold-lead`, `warm-lead`, `hot-lead`, etc.
- Mỗi item: avatar + tên + preview tin cuối + thời gian + badge số tin chưa đọc

### 3.3. Khung chat (cột phải)
Chọn 1 hội thoại để mở. Khung chat hỗ trợ:

- **Gửi text** — soạn ở composer, Enter để gửi
- **Rich text** — bold / italic / strike / heading / list / code / color qua toolbar TipTap
- **Mention** — gõ `@` để mention thành viên nhóm
- **Template nhanh** — gõ `/` để chèn mẫu tin có biến động (tên KH, ngày, trạng thái…)
- **📎 Đính kèm file** — click icon paperclip hoặc paste/drag ảnh trực tiếp
  - Hỗ trợ: ảnh (JPG/PNG/WebP/GIF, ≤100 MB), video (MP4/MOV/WebM, ≤500 MB), file (PDF/Excel/Word/PPT/ZIP/RAR, ≤1 GB)
  - File tự động upload lên MinIO và gửi qua Zalo
- **🎬 Video player inline** — bubble video render trực tiếp với controls, không cần download
- **😀 Reaction** — click icon emoji bên tin nhắn để thả reaction (đồng bộ Zalo)
- **↩️ Reply** — hover vào tin → click "Reply" để trả lời với quote
- **✏️ Edit / Delete** — chỉ áp dụng tin do mình gửi, trong cửa sổ thời gian Zalo cho phép
- **Sticker animated** — picker sticker bên cạnh composer
- **Tin nhắn đặc biệt** — hiển thị riêng card cho chuyển khoản / QR / cuộc gọi / nhắc hẹn

### 3.4. Panel khách hàng (cột thứ 4 — khi chọn hội thoại 1-1)
Hiển thị thông tin chi tiết khách: tên CRM + tên Zalo, SĐT, giới tính, nhãn, lịch sử mua hàng, ghi chú, tags. Edit trực tiếp tại đây.

---

## 4. Bạn bè & cặp nick × khách hàng

Trang này quản lý mỗi cặp `(nick × khách hàng)` riêng biệt — dùng cho mô hình sale có nhiều nick chăm cùng 1 khách.

![Bạn bè](user-guide-images/04-friends.png)

**Cột chính:**
- **NICK CÓ LOG** — số nick CRM đang chăm khách này
- **NICK ZALO (SALE)** — nick đang giao tiếp với khách
- **TÊN CRM / NICK (KH)** — tên hiển thị trong CRM
- **TRẠNG THÁI KB** — Đã KB / Đã gửi mời / Đang nhắn (lạ) / Đã ngắt
- **TRẠNG THÁI KH** — Mới / Có tương tác / Quan tâm / Đàm phán / Chuyển đổi / Mất
- **NHÃN CRM** — tag tự chọn (cold/warm/hot/…)
- **KH NHẮN CUỐI / SALE NHẮN CUỐI** — timestamp + nội dung tin gần nhất
- **TIN (IN/OUT)** — số tin nhận / số tin gửi
- **LÀ BẠN TỪ** — ngày kết bạn

**Bộ lọc nhanh tab:** Tất cả / Đã kết bạn / Đã gửi mời / Đang nhắn (lạ) / Đã ngắt

**Action:**
- Click button **Đồng bộ Zalo** (phải trên) để pull danh bạ mới nhất từ Zalo về
- **Xuất CSV** để mang dữ liệu sang Excel/Sheets

---

## 5. Khách hàng

Trang Khách hàng tổng hợp toàn bộ KH đã kết bạn / đã gửi mời / đang nhắn tin / import vào hệ thống. Key chính là **SĐT**. Click `▶` để xem chi tiết các nick chăm KH này.

![Khách hàng](user-guide-images/05-contacts.png)

**Header counters:**
- Tổng KH / Có nick chăm / Multi-claim ≥3 / Revoked / No Zalo

**Cột chính:**
- **TÊN CRM / ZALO (KH)** — tên hiển thị, ưu tiên CRM Name
- **SĐT, GIỚI TÍNH, TỈNH/QUẬN, NGUỒN**
- **TRẠNG THÁI KH** — Mới / Quan tâm / Đàm phán / Chuyển đổi / Mất
- **SCORE** — lead score (0-100) tự tính bởi Contact Intelligence
- **NICK CHĂM** — chip 4 màu (xanh = đã KB, vàng = đã mời, xanh dương = đang nhắn lạ, xám = đã ngắt)
- **SALE CHÍNH** — nick được chỉ định là owner
- **KH NHẮN CUỐI / SALE NHẮN CUỐI** — tin/timestamp gần nhất
- **TIN (IN/OUT)** — count tin
- **TAGS CRM** — chip tag (cold/warm/hot/…)
- **CÓ ZALO?** — đã kết bạn Zalo chưa

**Action toolbar:**
- **+ Thêm KH** — tạo khách thủ công
- **Xuất** — xuất Excel
- **Trùng lặp** — phát hiện KH trùng (cùng SĐT / cùng Zalo UID) để gộp

---

## 6. Lịch hẹn

Quản lý lịch hẹn với khách hàng — tạo, theo dõi, nhắc nhở tự động.

![Lịch hẹn](user-guide-images/06-appointments.png)

**Tab:** Hôm nay / Sắp tới / Tất cả

**Lọc nguồn:** Tất cả / Zalo (đồng bộ từ Zalo reminder) / Thủ công (tạo trong CRM)

**Cột:** Nguồn — Ngày — Giờ — Khách hàng — Loại — Trạng thái — Ghi chú

**Tự động:**
- 1h trước giờ hẹn — nhắc trong app
- 24h trước — gửi email/push notification
- Hết hạn → tự động chuyển trạng thái "Quá hạn" nếu chưa đánh dấu hoàn thành

---

## 7. Phân tích nâng cao

Báo cáo chi tiết hiệu suất sale với 5 tab phân tích.

![Phân tích](user-guide-images/07-analytics.png)

**Tab:**
1. **Tổng quan** — Phễu chuyển đổi (funnel) + Thời gian trả lời trung bình
2. **Phễu khách hàng** — Chuyển đổi qua từng stage pipeline
3. **Đội nhóm** — Hiệu suất từng nhân viên (tin gửi, tỉ lệ phản hồi, conversion)
4. **Thời gian trả lời** — Heatmap thời gian phản hồi, phát hiện điểm nghẽn
5. **Báo cáo tùy chỉnh** — Tự build report theo metric/dimension mong muốn

Chọn khoảng thời gian "Từ ngày → Đến ngày" để filter dữ liệu.

---

## 8. Báo cáo

Báo cáo thô theo ngày — phù hợp xuất Excel để gửi sếp.

![Báo cáo](user-guide-images/08-reports.png)

**Tab:** Tin nhắn / Khách hàng / Lịch hẹn

**Cột mẫu (tab Tin nhắn):** Ngày — Đã gửi — Đã nhận

**Action:**
- **Xem** — apply filter ngày
- **Xuất Excel** — download `.xlsx`

---

## 9. Workflow Automation

Tự động hóa nghiệp vụ — tạo rule theo trigger + condition + action.

![Automation](user-guide-images/09-automation.png)

**Tab:** Rules / Templates

**Mỗi rule có:**
- Tên rule
- Trigger (vd: khách mới chat lần đầu / không trả lời >30 phút / đến hạn lịch hẹn)
- Ưu tiên (1-10)
- Đã chạy: số lần đã trigger
- Lần chạy gần nhất
- Bật/Tắt

**Ví dụ rule phổ biến:**
- Khách mới → auto gửi tin chào + assign cho sale phụ trách
- Không trả lời >2h → reminder cho sale
- Hết lịch hẹn → tự cập nhật trạng thái + log activity

Click **+ Thêm rule** để tạo. Dùng tab **Templates** để xem rule mẫu cài sẵn.

---

## 10. Tài khoản Zalo & Proxy

Vào **Cài đặt → Tài khoản Zalo** để quản lý các nick Zalo cá nhân kết nối với hệ thống.

![Tài khoản Zalo](user-guide-images/10-zalo-accounts.png)

**Cột:** Tên — Zalo UID — SĐT — Trạng thái (Đã kết nối / Ngắt kết nối / Chờ QR) — **Proxy** — Hành động

### 10.1. Thêm tài khoản Zalo mới

Click **+ Thêm Zalo** → mở dialog:

![Thêm Zalo](user-guide-images/11-add-zalo-dialog.png)

**Field:**
- **Tên hiển thị** — gợi nhớ trong CRM (VD: "Zalo Sale Hương")
- **Proxy URL (tùy chọn)** — nếu cần kết nối Zalo qua proxy, điền URL dạng:
  - `http://user:pass@host:port`
  - `socks5://host:port`
  - **Để trống** = kết nối Zalo trực tiếp qua internet (mặc định)

Click **Thêm** → hệ thống hiển thị mã QR → mở Zalo trên điện thoại → quét QR → xác nhận. Sau khi kết nối thành công, status đổi sang "Đã kết nối".

### 10.2. Cấu hình Proxy cho tài khoản đã tồn tại

Trong list, click icon **🛡️ Cấu hình Proxy** (màu cam) ở cột Hành động.

![Cấu hình Proxy](user-guide-images/12-proxy-config-dialog.png)

**Use case:**
- **Đặt proxy mới**: nhập Proxy URL → **Lưu**
- **Đổi proxy**: nhập URL mới → **Lưu**
- **Xóa proxy**: bỏ trống → **Lưu**, hoặc click button **Xóa proxy** (nếu đang có)

> 🔐 Sau khi lưu, credentials trong URL sẽ được ẩn (mask) khi hiển thị lại — chỉ thấy `***`.

### 10.3. Các nút hành động khác

| Icon | Chức năng |
|---|---|
| 🛡️ Cyan | Phân quyền truy cập tài khoản (Admin) |
| 🛡️ Cam | Cấu hình Proxy |
| 👤 Xanh lá | Đồng bộ danh bạ Zalo |
| 🔄 Xanh dương | Kết nối lại (sau khi mất kết nối) |
| 📱 QR | Đăng nhập QR (chưa kết nối) |
| 🗑️ Đỏ | Xóa tài khoản |

---

## 11. Câu hỏi thường gặp

### Gửi ảnh/video bị lỗi?
- Kiểm tra MinIO container chạy: `docker ps | grep minio`
- File quá lớn? Giới hạn: ảnh 100MB, video 500MB, file 1GB
- Định dạng có nằm trong whitelist không (JPG/PNG/WebP/GIF, MP4/MOV/WebM, PDF/DOCX/XLSX/PPT/ZIP/RAR…)?

### Recipient trên Zalo có nhận được attachment không nếu MinIO chạy local?
- ✅ Có. File được gửi trực tiếp qua Zalo CDN, độc lập với MinIO. MinIO chỉ dùng cho CRM hiển thị nội bộ.

### Tài khoản Zalo bị disconnect liên tục?
- Có thể bị Zalo block do gửi quá nhanh. Bật proxy riêng cho nick này (xem mục 10.2).
- Giới hạn mặc định: 200 tin/ngày/nick.

### Khách thấy ảnh hỏng trong CRM dù gửi thành công?
- Browser của khách (sale viewer) không reach được MinIO.
- Đổi `S3_PUBLIC_URL` trong `.env` thành domain/IP server browser truy cập được. Restart app.

### Quên mật khẩu admin?
- Reset qua SQL: `UPDATE users SET password = '<bcrypt-hash>' WHERE email = 'admin@example.com';`
- Hoặc xóa user + tạo lại qua API.

---

## Cộng đồng & Hỗ trợ

### Tham gia nhóm Telegram

Trao đổi, hỏi đáp, nhận thông báo bản phát hành mới:

<p align="left">
  <a href="https://t.me/+KKJ3SJSx6PA3NDE1">
    <img src="user-guide-images/qr-group-telegram.png" alt="Telegram Group QR" width="200" />
  </a>
</p>

- 📲 Quét QR bằng Telegram, hoặc
- 🔗 Click link: [https://t.me/+KKJ3SJSx6PA3NDE1](https://t.me/+KKJ3SJSx6PA3NDE1)

### Liên hệ trực tiếp

Cần tư vấn, custom thêm tính năng, hoặc triển khai ZaloCRM cho doanh nghiệp:

- 🌐 [https://locnguyendata.com](https://locnguyendata.com)
- 📧 [locnt@locnguyendata.com](mailto:locnt@locnguyendata.com)
- 📱 Zalo: 0945031039
