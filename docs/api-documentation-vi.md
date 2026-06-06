# Zalo CRM - Tài Liệu API

**Phiên bản:** 1.0.0  
**Cập nhật lần cuối:** 2026-06-05  
**URL Cơ sở:** `http://localhost:3000` (phát triển) | `https://api.zalocrm.com` (sản xuất)

---

## Mục Lục

1. [Xác Thực](#xác-thực)
2. [Thiết Lập Ban Đầu](#thiết-lập-ban-đầu)
3. [Quản Lý Tài Khoản Zalo](#quản-lý-tài-khoản-zalo)
4. [Chat & Tin Nhắn](#chat--tin-nhắn)
5. [Liên Hệ & CRM](#liên-hệ--crm)
6. [Tự Động Hóa & Marketing](#tự-động-hóa--marketing)
7. [Phân Tích & Báo Cáo](#phân-tích--báo-cáo)
8. [Đội & Tổ Chức](#đội--tổ-chức)
9. [Kiểm Soát Truy Cập Dựa Trên Vai Trò](#kiểm-soát-truy-cập-dựa-trên-vai-trò)
10. [Tìm Kiếm](#tìm-kiếm)
11. [Chấm Điểm & Quản Lý Lead](#chấm-điểm--quản-lý-lead)
12. [Sự Tham Gia](#sự-tham-gia)
13. [Hoạt Động & Dòng Thời Gian](#hoạt-động--dòng-thời-gian)
14. [Thông Báo](#thông-báo)
15. [Tích Hợp](#tích-hợp)
16. [AI & Trợ Lý](#ai--trợ-lý)
17. [Thương Hiệu](#thương-hiệu)
18. [Bảo Mật & Quyền Riêng Tư](#bảo-mật--quyền-riêng-tư)
19. [API Công Khai & Webhook](#api-công-khai--webhook)
20. [Hệ Thống](#hệ-thống)

---

## Hướng Dẫn Chung

### Xác Thực
- Tất cả các endpoint (ngoại trừ `/api/v1/setup/*` và `/api/v1/auth/login`) yêu cầu xác thực JWT
- Đưa token vào header yêu cầu: `Authorization: Bearer <token>`
- Token hết hạn trong 7 ngày
- Phản hồi xác thực thành công bao gồm đối tượng `token` và `user`

### Giới Hạn Tốc Độ
- **Giới hạn toàn cục:** 500 yêu cầu mỗi phút
- **Theo IP:** Áp dụng cho tất cả các route `/api/*`
- **Header phản hồi:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Phản Hồi Lỗi
```json
{
  "error": "Thông báo lỗi",
  "statusCode": 400
}
```

### Phân Trang
- **Giới hạn mặc định:** 50 mục
- **Giới hạn tối đa:** 100 mục
- **Tham số:** `page`, `limit`, `offset`
- **Phản hồi bao gồm:** `data`, `total`, `page`, `limit`

---

## 1. Xác Thực

### 1.1 Kiểm Tra Trạng Thái Thiết Lập
**GET** `/api/v1/setup/status`

Kiểm tra xem có cần thiết lập ban đầu hay không.

**Phản hồi:**
```json
{
  "setupRequired": true,
  "organizationCount": 0
}
```

---

### 1.2 Thiết Lập Ban Đầu
**POST** `/api/v1/setup`

Tạo tổ chức và tài khoản người dùng chủ sở hữu. Chỉ khả dụng khi hệ thống không có tổ chức nào.

**Thân Yêu Cầu:**
```json
{
  "orgName": "Công Ty Acme",
  "fullName": "Nguyễn Văn A",
  "email": "a@acme.com",
  "password": "MatKhauAn123"
}
```

**Phản hồi:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "a@acme.com",
    "fullName": "Nguyễn Văn A",
    "role": "owner",
    "orgId": "org-123"
  }
}
```

**Mã Trạng Thái:** 201, 400, 409 (nếu thiết lập đã hoàn tất)

---

### 1.3 Đăng Nhập
**POST** `/api/v1/auth/login`

Xác thực người dùng và nhận token JWT.

**Thân Yêu Cầu:**
```json
{
  "email": "a@acme.com",
  "password": "MatKhauAn123"
}
```

**Phản hồi:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "a@acme.com",
    "fullName": "Nguyễn Văn A",
    "role": "admin",
    "orgId": "org-123"
  }
}
```

**Mã Trạng Thái:** 200, 401 (thông tin đăng nhập không hợp lệ)

---

### 1.4 Lấy Hồ Sơ Hiện Tại
**GET** `/api/v1/profile`

Lấy hồ sơ của người dùng được xác thực.

**Header:**
```
Authorization: Bearer <token>
```

**Phản hồi:**
```json
{
  "id": "user-123",
  "email": "a@acme.com",
  "fullName": "Nguyễn Văn A",
  "role": "admin",
  "orgId": "org-123",
  "department": "Bán Hàng",
  "avatar": "https://...",
  "createdAt": "2026-01-15T10:30:00Z",
  "lastLogin": "2026-06-05T14:22:00Z"
}
```

**Mã Trạng Thái:** 200, 401

---

## 2. Thiết Lập Ban Đầu

### 2.1 Tạo Tổ Chức
**POST** `/api/v1/orgs`

Tạo tổ chức mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Công Ty Marketing",
  "industry": "Marketing",
  "website": "https://agency.com",
  "phone": "+84.9.xxxx.xxxx",
  "address": "123 Main St"
}
```

**Phản hồi:** 201
```json
{
  "id": "org-456",
  "name": "Công Ty Marketing",
  "createdAt": "2026-06-05T17:30:00Z"
}
```

---

## 3. Quản Lý Tài Khoản Zalo

### 3.1 Liệt Kê Tài Khoản Zalo
**GET** `/api/v1/zalo-accounts`

Liệt kê tất cả các tài khoản Zalo được kết nối với trạng thái trực tiếp.

**Tham Số Truy Vấn:**
- `status` - Lọc theo trạng thái: `qr_pending`, `connected`, `disconnected`
- `assignedTo` - Lọc theo chủ sở hữu tài khoản
- `search` - Tìm kiếm theo tên hiển thị hoặc số điện thoại

**Phản hồi:**
```json
[
  {
    "id": "acc-001",
    "zaloUid": "1234567890",
    "displayName": "Zalo Chính Thức",
    "avatarUrl": "https://...",
    "phone": "+84.9.xxxx.xxxx",
    "status": "connected",
    "liveStatus": {
      "state": "connected",
      "connectedAt": "2026-06-05T10:00:00Z",
      "lastHeartbeat": "2026-06-05T17:30:00Z"
    },
    "ownerUserId": "user-123",
    "owner": {
      "id": "user-123",
      "fullName": "Nguyễn Văn A",
      "email": "a@acme.com"
    },
    "hasProxy": false,
    "lastConnectedAt": "2026-06-05T10:00:00Z",
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 3.2 Tạo Tài Khoản Zalo
**POST** `/api/v1/zalo-accounts`

Tạo bản ghi tài khoản mới (trước khi đăng nhập QR).

**Thân Yêu Cầu:**
```json
{
  "displayName": "Tài Khoản Kinh Doanh Của Tôi",
  "proxyUrl": null
}
```

**Phản hồi:** 201
```json
{
  "id": "acc-002",
  "displayName": "Tài Khoản Kinh Doanh Của Tôi",
  "status": "qr_pending",
  "createdAt": "2026-06-05T17:30:00Z"
}
```

---

### 3.3 Bắt Đầu Đăng Nhập QR
**POST** `/api/v1/zalo-accounts/:id/login`

Bắt đầu quá trình đăng nhập mã QR. QR được gửi qua Socket.IO.

**Phòng Socket:** `account:{id}`

**Phản hồi:**
```json
{
  "message": "Đã bắt đầu đăng nhập QR — đăng ký phòng socket account:acc-001"
}
```

---

### 3.4 Kết Nối Lại Bắt Buộc
**POST** `/api/v1/zalo-accounts/:id/reconnect`

Kết nối lại bằng dữ liệu phiên được lưu.

**Phản hồi:**
```json
{
  "message": "Đã bắt đầu kết nối lại"
}
```

---

### 3.5 Xóa/Lưu Trữ Tài Khoản
**DELETE** `/api/v1/zalo-accounts/:id`

Lưu trữ tài khoản (xóa mềm). Sử dụng `?purge=true` để xóa dữ liệu phiên.

**Tham Số Truy Vấn:**
- `purge` - Boolean. Nếu true, xóa sessionData và zaloUid để kết nối lại mới

**Phản hồi:** 204 Không Có Nội Dung

---

### 3.6 Lấy Trạng Thái Tài Khoản
**GET** `/api/v1/zalo-accounts/:id/status`

Lấy trạng thái thời gian thực của tài khoản cụ thể.

**Phản hồi:**
```json
{
  "accountId": "acc-001",
  "liveStatus": {
    "state": "connected",
    "connectedAt": "2026-06-05T10:00:00Z",
    "lastHeartbeat": "2026-06-05T17:30:00Z"
  }
}
```

---

### 3.7 Cập Nhật Proxy
**PUT** `/api/v1/zalo-accounts/:id/proxy`

Cập nhật cấu hình proxy cho tài khoản.

**Thân Yêu Cầu:**
```json
{
  "proxyUrl": "http://user:pass@proxy.com:8080"
}
```

**Phản hồi:**
```json
{
  "message": "Proxy đã được cập nhật",
  "hasProxy": true
}
```

---

## 4. Chat & Tin Nhắn

### 4.1 Lấy Số Lượng Cuộc Trò Chuyện
**GET** `/api/v1/conversations/counts`

Lấy số lượng cuộc trò chuyện chưa đọc và chưa trả lời.

**Phản hồi:**
```json
{
  "total": 150,
  "unread": 25,
  "unreplied": 12,
  "archived": 8
}
```

---

### 4.2 Liệt Kê Cuộc Trò Chuyện
**GET** `/api/v1/conversations`

Liệt kê các cuộc trò chuyện/luồng với phân trang.

**Tham Số Truy Vấn:**
- `page` - Số trang (mặc định: 1)
- `limit` - Mục trên mỗi trang (mặc định: 50, tối đa: 100)
- `status` - Lọc: `active`, `archived`, `closed`
- `type` - Lọc: `user`, `group`
- `search` - Tìm kiếm theo tên liên hệ
- `sortBy` - Trường sắp xếp: `lastMessage`, `createdAt` (mặc định: `lastMessage`)
- `direction` - Hướng sắp xếp: `asc`, `desc`

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "conv-001",
      "contactId": "contact-123",
      "contactName": "Nguyễn Văn A",
      "contactAvatar": "https://...",
      "type": "user",
      "zaloAccountId": "acc-001",
      "messageCount": 45,
      "unreadCount": 3,
      "lastMessage": {
        "id": "msg-999",
        "content": "Xin chào!",
        "contentType": "text",
        "senderName": "Nguyễn Văn A",
        "sentAt": "2026-06-05T17:20:00Z"
      },
      "status": "active",
      "createdAt": "2026-03-10T08:00:00Z",
      "lastActivityAt": "2026-06-05T17:20:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 50,
    "pages": 3
  }
}
```

---

### 4.3 Lấy Chi Tiết Cuộc Trò Chuyện
**GET** `/api/v1/conversations/:id`

Lấy cuộc trò chuyện đầy đủ với các tin nhắn.

**Tham Số Truy Vấn:**
- `page` - Trang tin nhắn (mặc định: 1)
- `limit` - Tin nhắn mỗi trang (mặc định: 30)

**Phản hồi:**
```json
{
  "conversation": {
    "id": "conv-001",
    "contactId": "contact-123",
    "contactName": "Nguyễn Văn A",
    "type": "user",
    "zaloAccountId": "acc-001",
    "status": "active",
    "createdAt": "2026-03-10T08:00:00Z"
  },
  "messages": [
    {
      "id": "msg-001",
      "conversationId": "conv-001",
      "content": "Bạn khỏe không?",
      "contentType": "text",
      "senderUid": "1234567890",
      "senderName": "Nguyễn Văn A",
      "isFromZalo": true,
      "isRead": true,
      "isReplied": true,
      "sentAt": "2026-06-05T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "limit": 30
  }
}
```

---

### 4.4 Gửi Tin Nhắn
**POST** `/api/v1/conversations/:id/messages`

Gửi tin nhắn đến cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "content": "Cảm ơn vì đã liên hệ!",
  "contentType": "text",
  "attachments": []
}
```

**Phản hồi:** 201
```json
{
  "id": "msg-1000",
  "conversationId": "conv-001",
  "content": "Cảm ơn vì đã liên hệ!",
  "contentType": "text",
  "senderName": "Nguyễn Văn B",
  "sentAt": "2026-06-05T17:35:00Z",
  "status": "sent"
}
```

---

### 4.5 Lưu Trữ Cuộc Trò Chuyện
**POST** `/api/v1/conversations/:id/archive`

Lưu trữ cuộc trò chuyện.

**Phản hồi:**
```json
{
  "message": "Cuộc trò chuyện đã được lưu trữ"
}
```

---

### 4.6 Tạo Thư Mục Chat
**POST** `/api/v1/chat/folders`

Tạo thư mục để tổ chức các cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "name": "Lead Nóng",
  "color": "#FF5722"
}
```

**Phản hồi:** 201
```json
{
  "id": "folder-001",
  "name": "Lead Nóng",
  "color": "#FF5722",
  "conversationCount": 0,
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 4.7 Liệt Kê Cài Đặt Chat
**GET** `/api/v1/chat/presets`

Liệt kê các mẫu tin nhắn được lưu.

**Phản hồi:**
```json
[
  {
    "id": "preset-001",
    "name": "Lời Chào",
    "content": "Xin chào! Cảm ơn vì đã liên hệ với chúng tôi 👋",
    "category": "greetings",
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 4.8 Tải Lên Tệp Đính Kèm
**POST** `/api/v1/chat/attachments`

Tải lên tệp/hình ảnh/video để gửi.

**Yêu Cầu:** Form-data với trường `file`

**Phản hồi:** 201
```json
{
  "id": "attach-001",
  "filename": "document.pdf",
  "size": 1024000,
  "contentType": "application/pdf",
  "url": "https://api.zalocrm.com/attachments/attach-001",
  "uploadedAt": "2026-06-05T17:35:00Z"
}
```

---

## 5. Liên Hệ & CRM

### 5.1 Liệt Kê Liên Hệ
**GET** `/api/v1/contacts`

Liệt kê các liên hệ với bộ lọc nâng cao.

**Tham Số Truy Vấn:**
- `page` - Số trang (mặc định: 1)
- `limit` - Mục mỗi trang (mặc định: 50)
- `search` - Tìm kiếm theo tên, điện thoại, email
- `source` - Lọc theo nguồn: `zalo`, `facebook`, `manual`, v.v.
- `status` - Lọc theo trạng thái (ví dụ: `lead`, `customer`, `lost`)
- `statusId` - Lọc theo ID trạng thái tùy chỉnh
- `assignedUserId` - Lọc theo người dùng được gán
- `threadType` - Lọc theo loại cuộc trò chuyện: `user`, `group`
- `hasZalo` - Lọc theo kết nối Zalo: `true`, `false`, `unknown`
- `scoreMin` / `scoreMax` - Lọc theo phạm vi điểm số chứng chỉ
- `dateFrom` / `dateTo` - Lọc theo phạm vi ngày hoạt động
- `sortBy` - Trường sắp xếp: `lastActivity`, `createdAt`, `leadScore`
- `direction` - `asc` hoặc `desc`

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "contact-001",
      "name": "Nguyễn Văn A",
      "email": "a@example.com",
      "phone": "+84.9.xxxx.xxxx",
      "source": "zalo",
      "status": "lead",
      "statusId": "status-001",
      "assignedUserId": "user-123",
      "avatar": "https://...",
      "leadScore": 85,
      "hasZalo": true,
      "friends": [
        {
          "zaloUid": "1234567890",
          "displayName": "Nguyễn Văn A",
          "accountId": "acc-001"
        }
      ],
      "notes": "Quan tâm đến gói premium",
      "tags": ["lead-nóng", "vip"],
      "lastActivity": "2026-06-05T16:45:00Z",
      "createdAt": "2026-03-10T08:00:00Z"
    }
  ],
  "pagination": {
    "total": 500,
    "page": 1,
    "limit": 50,
    "pages": 10
  }
}
```

---

### 5.2 Lấy Chi Tiết Liên Hệ
**GET** `/api/v1/contacts/:id`

Lấy đầy đủ thông tin liên hệ.

**Phản hồi:**
```json
{
  "id": "contact-001",
  "name": "Nguyễn Văn A",
  "email": "a@example.com",
  "phone": "+84.9.xxxx.xxxx",
  "source": "zalo",
  "status": "lead",
  "statusId": "status-001",
  "assignedUserId": "user-123",
  "avatar": "https://...",
  "leadScore": 85,
  "hasZalo": true,
  "friends": [
    {
      "zaloUid": "1234567890",
      "displayName": "Nguyễn Văn A",
      "accountId": "acc-001"
    }
  ],
  "conversations": [
    {
      "id": "conv-001",
      "zaloAccountId": "acc-001",
      "messageCount": 45,
      "lastMessageAt": "2026-06-05T16:45:00Z"
    }
  ],
  "notes": [
    {
      "id": "note-001",
      "content": "Quan tâm đến gói premium",
      "createdBy": "user-123",
      "createdAt": "2026-06-01T10:00:00Z"
    }
  ],
  "tags": ["lead-nóng", "vip"],
  "appointments": [
    {
      "id": "apt-001",
      "title": "Cuộc Gọi Demo",
      "scheduledAt": "2026-06-10T14:00:00Z",
      "status": "scheduled"
    }
  ],
  "activities": [
    {
      "type": "message_received",
      "timestamp": "2026-06-05T16:45:00Z",
      "data": "Khách hàng gửi tin nhắn"
    }
  ],
  "createdAt": "2026-03-10T08:00:00Z",
  "updatedAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.3 Tạo Liên Hệ
**POST** `/api/v1/contacts`

Tạo liên hệ mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Trần Thị B",
  "email": "b@example.com",
  "phone": "+84.9.yyyy.yyyy",
  "source": "facebook",
  "status": "lead",
  "statusId": "status-001",
  "assignedUserId": "user-123",
  "notes": "Được giới thiệu bởi khách hàng hiện tại",
  "tags": ["giới-thiệu"]
}
```

**Phản hồi:** 201
```json
{
  "id": "contact-002",
  "name": "Trần Thị B",
  "email": "b@example.com",
  "phone": "+84.9.yyyy.yyyy",
  "source": "facebook",
  "status": "lead",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.4 Cập Nhật Liên Hệ
**PUT** `/api/v1/contacts/:id`

Cập nhật thông tin liên hệ.

**Thân Yêu Cầu:**
```json
{
  "name": "Trần Thị B",
  "email": "b.tran@example.com",
  "status": "customer",
  "assignedUserId": "user-124",
  "tags": ["vip", "giới-thiệu"]
}
```

**Phản hồi:** 200
```json
{
  "id": "contact-002",
  "name": "Trần Thị B",
  "email": "b.tran@example.com",
  "status": "customer",
  "updatedAt": "2026-06-05T17:40:00Z"
}
```

---

### 5.5 Xóa Liên Hệ
**DELETE** `/api/v1/contacts/:id`

Xóa liên hệ.

**Phản hồi:** 204 Không Có Nội Dung

---

### 5.6 Lấy Bạn Bè Liên Hệ
**GET** `/api/v1/contacts/:id/friends`

Lấy kết nối bạn bè Zalo cho liên hệ.

**Phản hồi:**
```json
[
  {
    "id": "friend-001",
    "zaloUid": "1234567890",
    "displayName": "Nguyễn Văn A",
    "accountId": "acc-001",
    "relationshipKind": "friend",
    "addedAt": "2026-03-10T08:00:00Z"
  }
]
```

---

### 5.7 Tạo Cuộc Hẹn
**POST** `/api/v1/appointments`

Lên lịch hẹn với liên hệ.

**Thân Yêu Cầu:**
```json
{
  "contactId": "contact-001",
  "title": "Demo Sản Phẩm",
  "description": "Giới thiệu các tính năng premium",
  "scheduledAt": "2026-06-10T14:00:00Z",
  "duration": 60,
  "type": "meeting",
  "location": "Cuộc Gọi Video",
  "assignedUserId": "user-123"
}
```

**Phản hồi:** 201
```json
{
  "id": "apt-001",
  "contactId": "contact-001",
  "title": "Demo Sản Phẩm",
  "scheduledAt": "2026-06-10T14:00:00Z",
  "status": "scheduled",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.8 Liệt Kê Cuộc Hẹn
**GET** `/api/v1/appointments`

Liệt kê tất cả các cuộc hẹn.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `status` - Lọc: `scheduled`, `completed`, `cancelled`
- `contactId` - Lọc theo liên hệ
- `dateFrom` / `dateTo` - Phạm vi ngày

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "apt-001",
      "contactId": "contact-001",
      "contactName": "Nguyễn Văn A",
      "title": "Demo Sản Phẩm",
      "scheduledAt": "2026-06-10T14:00:00Z",
      "status": "scheduled",
      "createdAt": "2026-06-05T17:35:00Z"
    }
  ],
  "pagination": { "total": 25, "page": 1, "limit": 50 }
}
```

---

### 5.9 Thêm Ghi Chú cho Liên Hệ
**POST** `/api/v1/contacts/:id/notes`

Thêm ghi chú/bình luận cho liên hệ.

**Thân Yêu Cầu:**
```json
{
  "content": "Khách hàng quan tâm đến gói hàng năm. Theo dõi vào tuần tới."
}
```

**Phản hồi:** 201
```json
{
  "id": "note-002",
  "contactId": "contact-001",
  "content": "Khách hàng quan tâm đến gói hàng năm...",
  "createdBy": "user-123",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 6. Tự Động Hóa & Marketing

### 6.1 Liệt Kê Quy Tắc Tự Động Hóa
**GET** `/api/v1/automation/rules`

Liệt kê các quy trình tự động hóa.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `status` - Lọc: `draft`, `active`, `paused`
- `type` - Lọc theo loại quy tắc

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "rule-001",
      "name": "Chào Mừng Lead Mới",
      "description": "Gửi tin nhắn chào mừng cho lead mới",
      "type": "sequence",
      "trigger": {
        "type": "contact_created",
        "conditions": [{ "field": "source", "operator": "equals", "value": "zalo" }]
      },
      "actions": [
        {
          "type": "send_message",
          "template": "welcome_message"
        }
      ],
      "status": "active",
      "createdAt": "2026-05-01T10:00:00Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 50 }
}
```

---

### 6.2 Tạo Quy Tắc Tự Động Hóa
**POST** `/api/v1/automation/rules`

Tạo quy trình tự động hóa mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Cảnh Báo Lead Giá Trị Cao",
  "description": "Thông báo cho đội khi lead có giá trị cao được tạo",
  "type": "sequence",
  "trigger": {
    "type": "contact_created",
    "conditions": [
      { "field": "leadScore", "operator": "gte", "value": 80 }
    ]
  },
  "actions": [
    {
      "type": "send_notification",
      "template": "high_value_alert"
    },
    {
      "type": "assign_user",
      "userId": "user-125"
    }
  ]
}
```

**Phản hồi:** 201
```json
{
  "id": "rule-002",
  "name": "Cảnh Báo Lead Giá Trị Cao",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.3 Liệt Kê Mẫu Tin Nhắn
**GET** `/api/v1/automation/templates`

Liệt kê các mẫu tin nhắn đã lưu.

**Phản hồi:**
```json
[
  {
    "id": "tpl-001",
    "name": "Tin Nhắn Chào Mừng",
    "content": "Xin chào {{contactName}}, chào mừng đến dịch vụ của chúng tôi!",
    "category": "greeting",
    "variables": ["contactName"],
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 6.4 Tạo Mẫu Tin Nhắn
**POST** `/api/v1/automation/templates`

Tạo mẫu tin nhắn mới với các biến.

**Thân Yêu Cầu:**
```json
{
  "name": "Ưu Đãi Đặc Biệt",
  "content": "Xin chào {{contactName}}, chúng tôi có ưu đãi đặc biệt cho bạn: {{offerDetails}}",
  "category": "offer",
  "variables": ["contactName", "offerDetails"]
}
```

**Phản hồi:** 201
```json
{
  "id": "tpl-002",
  "name": "Ưu Đãi Đặc Biệt",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.5 Liệt Kê Danh Sách Khách Hàng
**GET** `/api/v1/customer-lists`

Liệt kê các phân đoạn khán giả.

**Phản hồi:**
```json
[
  {
    "id": "list-001",
    "name": "Lead Nóng - Tháng 6",
    "description": "Lead có điểm > 80",
    "contactCount": 150,
    "status": "active",
    "createdAt": "2026-06-01T10:00:00Z"
  }
]
```

---

### 6.6 Tạo Danh Sách Khách Hàng
**POST** `/api/v1/customer-lists`

Tạo khán giả/phân đoạn mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Khách Hàng VIP",
  "description": "Khách hàng có lịch sử mua hàng > 5000 USD",
  "criteria": {
    "filters": [
      { "field": "status", "operator": "equals", "value": "customer" },
      { "field": "leadScore", "operator": "gte", "value": 85 }
    ]
  }
}
```

**Phản hồi:** 201
```json
{
  "id": "list-002",
  "name": "Khách Hàng VIP",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.7 Liệt Kê Chiến Dịch
**GET** `/api/v1/campaigns`

Liệt kê các chiến dịch marketing.

**Phản hồi:**
```json
[
  {
    "id": "campaign-001",
    "name": "Khuyến Mãi Mùa Hè",
    "type": "email",
    "status": "active",
    "contactCount": 500,
    "sentCount": 350,
    "openRate": 0.42,
    "createdAt": "2026-06-01T10:00:00Z"
  }
]
```

---

### 6.8 Tạo Chiến Dịch
**POST** `/api/v1/campaigns`

Tạo chiến dịch marketing mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Chiến Dịch Bán Hàng Tháng 7",
  "description": "Thông báo bán hàng tháng 7 cho tất cả khách hàng",
  "type": "broadcast",
  "listId": "list-001",
  "templateId": "tpl-001",
  "schedule": "2026-07-01T08:00:00Z",
  "variables": {
    "discount": "30%"
  }
}
```

**Phản hồi:** 201
```json
{
  "id": "campaign-002",
  "name": "Chiến Dịch Bán Hàng Tháng 7",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 7. Phân Tích & Báo Cáo

### 7.1 Lấy Ph漏斗 Chuyển Đổi
**GET** `/api/v1/analytics/conversion-funnel`

Lấy số liệu ph漏斗 chuyển đổi.

**Tham Số Truy Vấn:**
- `dateFrom` - Ngày bắt đầu
- `dateTo` - Ngày kết thúc
- `groupBy` - Nhóm theo: `day`, `week`, `month`

**Phản hồi:**
```json
{
  "period": {
    "from": "2026-06-01T00:00:00Z",
    "to": "2026-06-05T23:59:59Z"
  },
  "stages": [
    {
      "name": "Lead",
      "count": 500,
      "percentage": 100
    },
    {
      "name": "Đã Xác Thực",
      "count": 350,
      "percentage": 70
    },
    {
      "name": "Đề Xuất",
      "count": 100,
      "percentage": 20
    },
    {
      "name": "Khách Hàng",
      "count": 35,
      "percentage": 7
    }
  ],
  "conversionRate": 0.07
}
```

---

### 7.2 Lấy Hiệu Suất Đội
**GET** `/api/v1/analytics/team-performance`

Lấy số liệu và thống kê đội.

**Tham Số Truy Vấn:**
- `dateFrom` - Ngày bắt đầu
- `dateTo` - Ngày kết thúc
- `departmentId` - Lọc theo phòng ban (tùy chọn)

**Phản hồi:**
```json
{
  "period": { "from": "2026-06-01", "to": "2026-06-05" },
  "team": [
    {
      "userId": "user-123",
      "name": "Nguyễn Văn A",
      "contactsAssigned": 45,
      "messagesReplied": 120,
      "averageResponseTime": 3.5,
      "conversionRate": 0.11,
      "revenueGenerated": 12500
    }
  ],
  "teamTotal": {
    "contactsAssigned": 450,
    "messagesReplied": 1200,
    "conversionRate": 0.08,
    "revenueGenerated": 95000
  }
}
```

---

### 7.3 Lấy Phân Tích Thời Gian Phản Hồi
**GET** `/api/v1/analytics/response-time`

Lấy số liệu thời gian phản hồi.

**Phản hồi:**
```json
{
  "averageFirstResponseTime": 4.2,
  "averageResolutionTime": 24.5,
  "medianResponseTime": 3.1,
  "percentile95": 15.2,
  "percentile99": 45.0,
  "onTimeRate": 0.87
}
```

---

### 7.4 Tạo Báo Cáo Tùy Chỉnh
**POST** `/api/v1/analytics/custom`

Tạo báo cáo phân tích tùy chỉnh.

**Thân Yêu Cầu:**
```json
{
  "name": "Báo Cáo Bán Hàng Q2",
  "metrics": ["revenue", "lead_count", "conversion_rate"],
  "dimensions": ["source", "assignedUser"],
  "dateFrom": "2026-04-01T00:00:00Z",
  "dateTo": "2026-06-30T23:59:59Z",
  "filters": [
    { "field": "status", "operator": "equals", "value": "customer" }
  ]
}
```

**Phản hồi:** 201
```json
{
  "id": "report-001",
  "name": "Báo Cáo Bán Hàng Q2",
  "status": "generating",
  "createdAt": "2026-06-05T17:35:00Z",
  "downloadUrl": "https://api.zalocrm.com/reports/report-001"
}
```

---

## 8. Đội & Tổ Chức

### 8.1 Liệt Kê Người Dùng
**GET** `/api/v1/users`

Liệt kê người dùng tổ chức.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `role` - Lọc theo vai trò
- `department` - Lọc theo phòng ban
- `status` - Lọc: `active`, `inactive`

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "user-123",
      "email": "a@acme.com",
      "fullName": "Nguyễn Văn A",
      "role": "admin",
      "department": "Bán Hàng",
      "phone": "+84.9.xxxx.xxxx",
      "avatar": "https://...",
      "status": "active",
      "createdAt": "2026-01-15T10:30:00Z",
      "lastLogin": "2026-06-05T14:22:00Z"
    }
  ],
  "pagination": { "total": 15, "page": 1, "limit": 50 }
}
```

---

### 8.2 Tạo Người Dùng
**POST** `/api/v1/users`

Tạo thành viên đội mới.

**Thân Yêu Cầu:**
```json
{
  "email": "jane@acme.com",
  "fullName": "Jane Smith",
  "role": "agent",
  "department": "Hỗ Trợ",
  "phone": "+84.9.yyyy.yyyy"
}
```

**Phản hồi:** 201
```json
{
  "id": "user-126",
  "email": "jane@acme.com",
  "fullName": "Jane Smith",
  "role": "agent",
  "createdAt": "2026-06-05T17:35:00Z",
  "invitationSent": true
}
```

---

### 8.3 Cập Nhật Người Dùng
**PUT** `/api/v1/users/:id`

Cập nhật thông tin người dùng.

**Thân Yêu Cầu:**
```json
{
  "fullName": "Jane Smith",
  "role": "team_lead",
  "department": "Bán Hàng"
}
```

**Phản hồi:** 200

---

### 8.4 Xóa Người Dùng
**DELETE** `/api/v1/users/:id`

Vô hiệu hóa người dùng.

**Phản hồi:** 204 Không Có Nội Dung

---

### 8.5 Liệt Kê Đội
**GET** `/api/v1/teams`

Liệt kê các đội trong tổ chức.

**Phản hồi:**
```json
[
  {
    "id": "team-001",
    "name": "Đội Bán Hàng",
    "description": "Đội bán hàng trực tiếp",
    "memberCount": 5,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 8.6 Tạo Đội
**POST** `/api/v1/teams`

Tạo đội mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Bán Hàng Doanh Nghiệp",
  "description": "Đội bán hàng cho khách hàng doanh nghiệp",
  "memberIds": ["user-123", "user-124"]
}
```

**Phản hồi:** 201

---

## 9. Kiểm Soát Truy Cập Dựa Trên Vai Trò

### 9.1 Liệt Kê Phòng Ban
**GET** `/api/v1/departments`

Liệt kê các phòng ban tổ chức.

**Phản hồi:**
```json
[
  {
    "id": "dept-001",
    "name": "Bán Hàng",
    "description": "Phòng bán hàng",
    "memberCount": 8,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 9.2 Tạo Phòng Ban
**POST** `/api/v1/departments`

Tạo phòng ban mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Marketing",
  "description": "Phòng marketing và chiến dịch"
}
```

**Phản hồi:** 201

---

## 10. Tìm Kiếm

### 10.1 Tìm Kiếm Toàn Cục
**GET** `/api/v1/search`

Thực hiện tìm kiếm toàn văn bản trên các liên hệ, tin nhắn, ghi chú.

**Tham Số Truy Vấn:**
- `q` - Truy vấn tìm kiếm (bắt buộc)
- `type` - Lọc loại: `contacts`, `messages`, `notes` (tùy chọn)
- `limit` - Giới hạn kết quả (mặc định: 20)

**Phản hồi:**
```json
{
  "results": [
    {
      "id": "contact-001",
      "type": "contact",
      "title": "Nguyễn Văn A",
      "subtitle": "a@example.com",
      "url": "/contacts/contact-001"
    },
    {
      "id": "msg-001",
      "type": "message",
      "title": "Xin chào từ Nguyễn Văn A",
      "subtitle": "trong cuộc trò chuyện với Zalo Chính Thức",
      "timestamp": "2026-06-05T16:45:00Z"
    }
  ]
}
```

---

## 11. Chấm Điểm & Quản Lý Lead

### 11.1 Lấy Cấu Hình Chấm Điểm
**GET** `/api/v1/scoring/config`

Lấy cài đặt chấm điểm lead.

**Phản hồi:**
```json
{
  "orgId": "org-123",
  "scoringModel": "weighted",
  "baseScore": 0,
  "maxScore": 100,
  "rules": [
    {
      "id": "rule-001",
      "name": "Tham Gia Tin Nhắn",
      "weight": 0.3,
      "factor": 5
    }
  ],
  "decayRate": 0.01,
  "decayInterval": "daily"
}
```

---

### 11.2 Liệt Kê Quy Tắc Chấm Điểm
**GET** `/api/v1/scoring/rules`

Liệt kê tất cả các quy tắc chấm điểm.

**Phản hồi:**
```json
[
  {
    "id": "rule-001",
    "name": "Tin Nhắn Nhận Được",
    "condition": "message_received",
    "points": 5,
    "weight": 0.3,
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 11.3 Lấy Điểm Liên Hệ
**GET** `/api/v1/contacts/:id/scores`

Lấy phân tích điểm chi tiết cho liên hệ.

**Phản hồi:**
```json
{
  "contactId": "contact-001",
  "totalScore": 85,
  "breakdown": [
    {
      "ruleName": "Tham Gia Tin Nhắn",
      "points": 35,
      "weight": 0.3
    },
    {
      "ruleName": "Tham Dự Cuộc Hẹn",
      "points": 25,
      "weight": 0.25
    }
  ],
  "lastUpdated": "2026-06-05T17:30:00Z"
}
```

---

## 12. Sự Tham Gia

### 12.1 Lấy Bản Đồ Nhiệt Tham Gia
**GET** `/api/v1/engagement/heatmap`

Lấy bản đồ nhiệt tham gia của đội.

**Tham Số Truy Vấn:**
- `dateFrom` - Ngày bắt đầu
- `dateTo` - Ngày kết thúc

**Phản hồi:**
```json
{
  "heatmap": [
    [0, 1, 2, 1, 3, 2, 1],
    [5, 6, 7, 8, 9, 10, 5],
    [15, 16, 17, 18, 19, 20, 15]
  ],
  "metadata": {
    "rows": ["00:00-08:00", "08:00-16:00", "16:00-24:00"],
    "columns": ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"]
  }
}
```

---

## 13. Hoạt Động & Dòng Thời Gian

### 13.1 Lấy Dòng Thời Gian Hoạt Động
**GET** `/api/v1/timeline`

Lấy dòng thời gian hoạt động tổ chức.

**Tham Số Truy Vấn:**
- `limit` - Số hoạt động (mặc định: 50)
- `offset` - Phần bù phân trang
- `type` - Lọc theo loại hoạt động

**Phản hồi:**
```json
{
  "activities": [
    {
      "id": "activity-001",
      "type": "contact_created",
      "actor": {
        "id": "user-123",
        "name": "Nguyễn Văn A"
      },
      "resource": {
        "type": "contact",
        "id": "contact-001",
        "title": "Nguyễn Văn A"
      },
      "description": "Tạo liên hệ mới",
      "timestamp": "2026-06-05T17:35:00Z"
    }
  ],
  "pagination": { "total": 1500, "limit": 50, "offset": 0 }
}
```

---

## 14. Thông Báo

### 14.1 Liệt Kê Thông Báo
**GET** `/api/v1/notifications`

Lấy thông báo người dùng.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `unreadOnly` - Chỉ hiển thị chưa đọc (mặc định: false)

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "notif-001",
      "type": "high_value_lead",
      "title": "Lead Giá Trị Cao Được Tạo",
      "message": "Nguyễn Văn A - Điểm: 95",
      "resourceId": "contact-001",
      "read": false,
      "createdAt": "2026-06-05T17:35:00Z"
    }
  ],
  "unreadCount": 5
}
```

---

### 14.2 Đánh Dấu Thông Báo Là Đã Đọc
**POST** `/api/v1/notifications/:id/read`

Đánh dấu thông báo là đã đọc.

**Phản hồi:** 200
```json
{
  "message": "Thông báo được đánh dấu là đã đọc"
}
```

---

## 15. Tích Hợp

### 15.1 Liệt Kê Tích Hợp
**GET** `/api/v1/integrations`

Liệt kê các tích hợp có sẵn.

**Phản hồi:**
```json
[
  {
    "id": "int-001",
    "type": "facebook",
    "name": "Quảng Cáo Lead Facebook",
    "status": "connected",
    "config": {
      "pageId": "123456789",
      "formCount": 3
    },
    "lastSync": "2026-06-05T17:30:00Z"
  }
]
```

---

### 15.2 Facebook - Lấy Trang
**GET** `/api/v1/integrations/facebook/pages`

Liệt kê các trang Facebook được kết nối.

**Phản hồi:**
```json
[
  {
    "id": "page-001",
    "name": "Acme Business",
    "followers": 5000,
    "connected": true,
    "formCount": 2
  }
]
```

---

### 15.3 Facebook - Đồng Bộ Lead
**POST** `/api/v1/integrations/facebook/leads/sync`

Đồng bộ lead Facebook theo cách thủ công.

**Thân Yêu Cầu:**
```json
{
  "pageId": "page-001",
  "formId": "form-001"
}
```

**Phản hồi:** 202
```json
{
  "syncId": "sync-001",
  "status": "processing",
  "estimatedCount": 50
}
```

---

## 16. AI & Trợ Lý

### 16.1 Tạo Bản Nháp Phản Hồi
**POST** `/api/v1/ai/reply-draft`

Tạo phản hồi do AI hỗ trợ cho tin nhắn.

**Thân Yêu Cầu:**
```json
{
  "conversationId": "conv-001",
  "messageId": "msg-001",
  "tone": "professional"
}
```

**Phản hồi:**
```json
{
  "draft": "Cảm ơn bạn đã hỏi! Chúng tôi rất vui được giúp bạn với...",
  "confidence": 0.87
}
```

---

### 16.2 Tạo Tóm Tắt
**POST** `/api/v1/ai/summary`

Tạo tóm tắt AI cho cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "conversationId": "conv-001"
}
```

**Phản hồi:**
```json
{
  "summary": "Khách hàng hỏi về giá gói premium. Quan tâm đến so sánh tính năng với các đối thủ cạnh tranh.",
  "keyPoints": [
    "Quan tâm đến gói premium",
    "Muốn so sánh tính năng",
    "Ngân sách khoảng 500 USD/tháng"
  ]
}
```

---

### 16.3 Phân Tích Cảm Xúc
**POST** `/api/v1/ai/sentiment`

Phân tích cảm xúc của tin nhắn/cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "text": "Tôi thực sự hài lòng với dịch vụ của bạn! Đội hỗ trợ rất tuyệt vời."
}
```

**Phản hồi:**
```json
{
  "sentiment": "positive",
  "score": 0.92,
  "emotions": ["happy", "satisfied"]
}
```

---

## 17. Thương Hiệu

### 17.1 Lấy Cài Đặt Thương Hiệu
**GET** `/api/v1/branding`

Lấy cấu hình thương hiệu tổ chức.

**Phản hồi:**
```json
{
  "logo": "https://...",
  "faviconUrl": "https://...",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FFC107",
  "companyName": "Acme Corporation"
}
```

---

### 17.2 Cập Nhật Thương Hiệu
**PUT** `/api/v1/branding`

Cập nhật cài đặt thương hiệu.

**Thân Yêu Cầu:**
```json
{
  "primaryColor": "#FF5722",
  "secondaryColor": "#2196F3"
}
```

**Phản hồi:** 200

---

## 18. Bảo Mật & Quyền Riêng Tư

### 18.1 Đặt PIN Quyền Riêng Tư
**POST** `/api/v1/privacy/pin/set`

Đặt PIN quyền riêng tư để truy cập dữ liệu nhạy cảm.

**Thân Yêu Cầu:**
```json
{
  "pin": "123456"
}
```

**Phản hồi:**
```json
{
  "message": "PIN quyền riêng tư được đặt thành công"
}
```

---

### 18.2 Xác Minh PIN Quyền Riêng Tư
**POST** `/api/v1/privacy/pin/verify`

Xác minh PIN quyền riêng tư trước khi truy cập dữ liệu nhạy cảm.

**Thân Yêu Cầu:**
```json
{
  "pin": "123456"
}
```

**Phản hồi:**
```json
{
  "verified": true,
  "expiresIn": 3600
}
```

---

## 19. API Công Khai & Webhook

### 19.1 Liệt Kê Cài Đặt Webhook
**GET** `/api/v1/webhook-settings`

Liệt kê các webhook được cấu hình.

**Phản hồi:**
```json
[
  {
    "id": "webhook-001",
    "url": "https://your-app.com/webhooks/zalocrm",
    "events": ["contact.created", "message.received"],
    "active": true,
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 19.2 Tạo Webhook
**POST** `/api/v1/webhook-settings`

Tạo webhook mới.

**Thân Yêu Cầu:**
```json
{
  "url": "https://your-app.com/webhooks/contacts",
  "events": ["contact.created", "contact.updated"],
  "secret": "your-webhook-secret"
}
```

**Phản hồi:** 201
```json
{
  "id": "webhook-002",
  "url": "https://your-app.com/webhooks/contacts",
  "active": true,
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 20. Hệ Thống

### 20.1 Kiểm Tra Sức Khỏe
**GET** `/health`

Kiểm tra sức khỏe hệ thống.

**Phản hồi:**
```json
{
  "status": "ok",
  "db": "connected",
  "timestamp": "2026-06-05T17:35:00Z"
}
```

---

### 20.2 Trạng Thái API
**GET** `/api/v1/status`

Lấy phiên bản API và trạng thái.

**Phản hồi:**
```json
{
  "version": "1.0.0",
  "name": "Zalo CRM",
  "status": "operational"
}
```

---

## Sự Kiện WebSocket

### Kết Nối
```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Đã kết nối với máy chủ');
});
```

### Đăng Ký Phòng
```javascript
// Đăng ký sự kiện tài khoản
socket.emit('subscribe', { room: 'account:acc-001' });

// Nghe mã QR
socket.on('account:qr', (data) => {
  console.log('Mã QR:', data.qr);
  displayQRCode(data.qr);
});

// Nghe đăng nhập
socket.on('account:login', (data) => {
  console.log('Tài khoản đã đăng nhập:', data);
});
```

### Sự Kiện Tin Nhắn
```javascript
// Nghe tin nhắn mới
socket.on('message:received', (data) => {
  console.log('Tin nhắn mới:', data);
});

// Nghe chỉ báo đang nhập
socket.on('chat:typing', (data) => {
  console.log(data.senderName + ' đang nhập...');
});
```

---

## Mã Lỗi

| Mã | Ý Nghĩa |
|------|---------|
| 200 | OK |
| 201 | Đã Tạo |
| 202 | Đã Chấp Nhận |
| 204 | Không Có Nội Dung |
| 400 | Yêu Cầu Không Hợp Lệ |
| 401 | Chưa Xác Thực |
| 403 | Cấm Truy Cập |
| 404 | Không Tìm Thấy |
| 409 | Xung Đột |
| 422 | Không Thể Xử Lý Thực Thể |
| 429 | Quá Nhiều Yêu Cầu |
| 500 | Lỗi Máy Chủ Nội Bộ |
| 502 | Gateway Tồi |
| 503 | Dịch Vụ Không Khả Dụng |

---

## Liên Kết Hữu Ích

- **Kho GitHub:** https://github.com/locphamnguyen/zalo-crm
- **Theo Dõi Vấn Đề:** https://github.com/locphamnguyen/zalo-crm/issues
- **Thảo Luận:** https://github.com/locphamnguyen/zalo-crm/discussions

---

*Được tạo vào ngày 2026-06-05 | Phiên bản 1.0.0*
