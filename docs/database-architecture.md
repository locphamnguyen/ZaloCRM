# ZaloCRM — Sơ Đồ Kiến Trúc Database

**Cập nhật:** 2026-06-05
**ORM:** Prisma · **DB:** PostgreSQL
**Tổng:** 64 model · Schema: `backend/prisma/schema/schema.prisma`

---

## 1. Nguyên Tắc Thiết Kế

### 1.1 Multi-tenant theo `orgId`
**Mọi bảng nghiệp vụ đều gắn `orgId`** → `Organization` là gốc của toàn bộ dữ liệu.
Mỗi tổ chức (khách hàng) chỉ thấy dữ liệu của mình. Đây là khóa cô lập tenant.

### 1.2 Mô hình danh tính Zalo 3 lớp ⭐
Điểm đặc biệt nhất của schema — tách **nick Zalo**, **người thật**, và **quan hệ bạn bè**:

```mermaid
graph LR
    ZA["ZaloAccount<br/>(nick Zalo nhân viên)"] -->|N:N qua| FR["Friend<br/>(bảng nối per-nick)"]
    FR --> CT["Contact<br/>(khách hàng - người thật)"]

    style FR fill:#2d1a32,stroke:#ff00aa,color:#fff
```

- **`ZaloAccount`** = 1 nick Zalo cá nhân của nhân viên (đăng nhập QR)
- **`Contact`** = 1 khách hàng có thật trong CRM (gộp từ nhiều nguồn)
- **`Friend`** = bảng nối: 1 khách kết bạn với nick nào, trạng thái per-nick (score, alias, label riêng từng nick)

→ 1 khách (`Contact`) có thể là bạn của **nhiều nick** (`ZaloAccount`), mỗi quan hệ là 1 `Friend`.
Đây là cách giải bài toán "khách bị nhiều nhân viên chăm" → vẫn gom về 1 `Contact`.

### 1.3 Quy ước
- **PK:** `id` kiểu `String @default(uuid())`
- **snake_case** ở DB (`@map`), camelCase trong code
- **Soft state:** nhiều bảng có `archivedAt`, `isDeleted`, `purged`, `mergedInto`
- **Denormalized counters:** `Contact`/`Friend` lưu sẵn `totalInbound`, `leadScore`, `lastInteractionAt`... để tránh query nặng

---

## 2. ER Diagram — Lõi Trung Tâm (Core)

```mermaid
erDiagram
    Organization ||--o{ User : "có nhân viên"
    Organization ||--o{ ZaloAccount : "sở hữu nick"
    Organization ||--o{ Contact : "có khách hàng"
    Organization ||--o{ Conversation : "có hội thoại"
    Organization ||--o{ Team : "có đội"
    Organization ||--o{ Department : "có phòng ban"

    User ||--o{ ZaloAccount : "owner nick"
    User ||--o{ Contact : "được giao (assignedUser)"
    Team ||--o{ User : "gồm"

    ZaloAccount ||--o{ Conversation : "chứa hội thoại"
    ZaloAccount ||--o{ Friend : "kết bạn"

    Contact ||--o{ Friend : "là bạn qua các nick"
    Contact ||--o{ Conversation : "tham gia"
    Contact ||--o{ Contact : "parent/children"

    Conversation ||--o{ Message : "chứa tin nhắn"
    Message }o--o| User : "repliedBy"

    Status ||--o{ Contact : "phân loại"
    Status ||--o{ Friend : "phân loại per-nick"

    Organization {
        string id PK
        string name
        string timezone "default +07:00"
        datetime createdAt
    }
    User {
        string id PK
        string orgId FK
        string email UK
        string role "member/admin/owner"
        string permissionGroupId FK
        boolean isActive
    }
    ZaloAccount {
        string id PK
        string orgId FK
        string ownerUserId FK
        string zaloUid UK
        string phone
        string status "disconnected/connected"
        json sessionData "credential mã hóa"
        int dailyMessageCap "default 300"
    }
    Contact {
        string id PK
        string orgId FK
        string zaloUid
        string phoneNormalized
        string fullName
        string crmName
        string status "default new"
        string statusId FK
        string assignedUserId FK
        int leadScore
        string parentContactId FK
        string mergedInto
    }
    Friend {
        string id PK
        string orgId FK
        string contactId FK
        string zaloAccountId FK
        string zaloUidInNick
        string friendshipStatus "none/pending/friend"
        string aliasInNick
        int leadScore
        json zaloLabels
    }
    Conversation {
        string id PK
        string orgId FK
        string zaloAccountId FK
        string contactId FK
        string threadType "user/group"
        string externalThreadId
        int unreadCount
        boolean isReplied
        datetime lastMessageAt
    }
    Message {
        string id PK
        string conversationId FK
        string zaloMsgId
        string senderType
        string senderUid
        string content
        string contentType "default text"
        json attachments
        datetime sentAt
        string repliedByUserId FK
    }
    Status {
        string id PK
        string orgId FK
        string name
    }
```

---

## 3. Phân Nhóm 64 Model Theo Miền

```mermaid
graph TB
    subgraph Root["🏢 Tenant Root"]
        Organization
        AppSetting["AppSetting<br/>(webhook_url, secret...)"]
    end
    subgraph Identity["🔐 Identity & RBAC"]
        User
        Team
        Department
        DepartmentMember
        PermissionGroup
        UserPreference
        UserPrivacySession
    end
    subgraph ZaloLayer["💬 Zalo (3 lớp)"]
        ZaloAccount
        Friend
        Contact
        ZaloAccountAccess
        ZaloAccountStatusLog
        FriendshipAttempt
        ContactAccess
        ParentCandidate
        DuplicateGroup
    end
    subgraph Chat["📨 Chat"]
        Conversation
        Message
        MessageReaction
        PinnedConversation
        GroupPoll
        AccountFolder
        AccountFolderMember
    end
    subgraph CRM["📇 CRM"]
        Status
        Note
        NoteReaction
        Appointment
        CrmTag
        CrmTagGroup
        ZaloLabel
        SavedFilterPreset
    end
    subgraph Scoring["📊 Scoring & Engagement"]
        ScoringConfig
        ScoreSignalRule
        StageTransitionRule
        StuckThreshold
        NbaTemplate
        ContactEngagementDaily
        DailyMessageStat
        PhoneSearchEvent
    end
    subgraph Automation["🤖 Automation"]
        AutomationRule
        AutomationTrigger
        AutomationSequence
        AutomationBroadcast
        AutomationCampaign
        AutomationTask
        Block
        BlockFolder
        MessageTemplate
        CustomerList
        CustomerListEntry
        CustomerListSaleAssignment
        SaleAssignmentState
    end
    subgraph Misc["🧩 Khác"]
        Integration
        FacebookPageConnection
        FacebookFormMapping
        FacebookLeadEvent
        AiConfig
        AiSuggestion
        ActivityLog
        SavedReport
        SystemNotifyRecipient
    end

    Root --> Identity
    Root --> ZaloLayer
    ZaloLayer --> Chat
    ZaloLayer --> CRM
    CRM --> Scoring
    Root --> Automation
    Root --> Misc

    style ZaloLayer fill:#2d1a32,stroke:#ff00aa,color:#fff
```

| Miền | Số model | Vai trò chính |
|---|---|---|
| **Tenant Root** | 2 | `Organization` (gốc), `AppSetting` (config webhook/key) |
| **Identity & RBAC** | 7 | User, team, phòng ban, nhóm quyền, PIN session |
| **Zalo 3 lớp** ⭐ | 9 | Nick ↔ Friend ↔ Contact + access control + dedup |
| **Chat** | 7 | Hội thoại, tin nhắn, reaction, pin, folder nick |
| **CRM** | 8 | Status, note, lịch hẹn, tag, label |
| **Scoring & Engagement** | 8 | Chấm điểm, stage, stuck, heatmap, thống kê |
| **Automation** | 13 | Rule/trigger/sequence/broadcast/block/customer-list |
| **Khác** | 10 | Integration, Facebook, AI, activity log, report |

---

## 4. Quan Hệ Quan Trọng (Giải Thích Sâu)

### 4.1 Conversation = giao điểm Nick × Khách
```
Conversation {
  zaloAccountId  → nick nào đang chat
  contactId      → với khách nào (nullable: chat nhóm chưa map)
  externalThreadId → ID thread bên Zalo
  threadType     → "user" (1-1) hoặc "group"
}
```
Mỗi hội thoại neo vào **1 nick + 1 khách**. Tin nhắn (`Message`) thuộc về `Conversation`.

### 4.2 Message — đơn vị tin nhắn
```
Message {
  conversationId  → thuộc hội thoại nào
  senderType      → ai gửi (loại)
  senderUid       → Zalo UID người gửi  ⭐ (map khách trong webhook)
  content + contentType + attachments
  sentAt
  repliedByUserId → nhân viên nào trả lời (nếu là tin gửi đi)
  sentVia         → "user" / automation...
}
```
> ⭐ **Liên quan tích hợp TCRM:** webhook `message.received` lấy `conversationId` + `senderUid`
> từ chính bảng này. Xem `plans/260605-2128-tcrm-webhook-receiver/design-doc.md`.

### 4.3 Contact — hồ sơ khách 360°
`Contact` rất "béo" (~80 cột): thông tin cá nhân, địa chỉ, social, consent (GDPR-style),
denormalized counters (`totalInbound/Outbound`, `leadScore`, `lastInboundAt`...),
và **self-relation**:
- `parentContactId` → quan hệ cha/con (vd: hộ gia đình, công ty/nhân viên)
- `mergedInto` → gộp trùng (dedup); `DuplicateGroup`/`ParentCandidate` hỗ trợ phát hiện trùng

### 4.4 Friend — trạng thái per-nick
1 `Contact` ↔ nhiều `Friend` (mỗi nick 1 dòng). Lưu riêng từng nick:
`friendshipStatus`, `aliasInNick` (tên khách đặt trong nick đó), `leadScore`, `zaloLabels`.
→ Cho phép cùng 1 khách có điểm/nhãn khác nhau ở từng nick nhân viên.

### 4.5 Access control 2 tầng
- `ZaloAccountAccess` — nhân viên nào được dùng nick nào
- `ContactAccess` — nhân viên nào xem được khách nào
→ Kết hợp `PermissionGroup` + `Department` cho RBAC chi tiết.

---

## 5. Cách Webhook Đọc Dữ Liệu (cho TCRM)

```mermaid
graph LR
    M[Message mới] -->|trigger| H[message-handler]
    H -->|đọc| C[Conversation]
    H --> P["payload<br/>conversationId + senderUid<br/>content + contentType + sentAt"]
    P -->|emitWebhook| TCRM[TCRM]

    style P fill:#322a1a,stroke:#ffaa00,color:#fff
```

Webhook KHÔNG gửi cả hàng DB — chỉ chọn field cần: `messageId`, `conversationId`,
`senderUid`, `content`, `contentType`, `sentAt`. TCRM map `conversationId` → conversation
của mình (xem design doc).

---

## 6. Lưu Trữ & Kiểu Dữ Liệu Đáng Chú Ý

| Pattern | Ví dụ | Ghi chú |
|---|---|---|
| **Json column** | `Message.attachments`, `Contact.tags`, `Friend.zaloLabels` | Linh hoạt, không cần bảng phụ |
| **BigInt** | `Message.zaloMsgIdNum` | ID tin Zalo lớn → cần `BigInt.toJSON` patch ở `app.ts` |
| **Encrypted** | `ZaloAccount.sessionData` | Credential nick, mã hóa qua `shared/crypto` |
| **Soft delete** | `Message.isDeleted`, `ZaloAccount.purged` | Giữ lịch sử, không xóa cứng |
| **Denormalized** | `Contact.totalInbound`, `leadScore` | Tăng tốc đọc, cập nhật qua cron/handler |
| **Timezone** | `Organization.timezone` default `+07:00` | Hiển thị giờ theo org |

---

## 7. Sơ Đồ Vòng Đời Dữ Liệu Khi Có Tin Nhắn

```mermaid
sequenceDiagram
    participant Zalo
    participant Pool as ZaloAccountPool
    participant H as message-handler
    participant DB as PostgreSQL

    Zalo->>Pool: tin nhắn mới (zca-js)
    Pool->>H: forward event
    H->>DB: tìm/tạo Conversation (zaloAccountId + externalThreadId)
    H->>DB: tìm/tạo Contact (qua senderUid → Friend → Contact)
    H->>DB: INSERT Message (conversationId, senderUid, content...)
    H->>DB: UPDATE Conversation (lastMessageAt, unreadCount++, isReplied=false)
    H->>DB: UPDATE Contact (lastInboundAt, totalInbound++, lastInboundPreview)
    H->>DB: UPDATE Friend (lastInboundAt, totalInbound++)
    Note over H: rồi emit Socket.IO + webhook
```

→ 1 tin nhắn đến cập nhật đồng thời **5 bảng**: `Message` (insert) + `Conversation`,
`Contact`, `Friend` (update counters). Đây là lý do dùng denormalized counter.

---

## 8. Câu Hỏi Chưa Giải Quyết

1. Có partition/retention cho bảng `Message` không? (tin nhắn tăng nhanh nhất)
2. `ContactEngagementDaily` / `DailyMessageStat` giữ bao lâu? (bảng thống kê theo ngày)
3. Chiến lược index cho truy vấn hot: `Conversation(zaloAccountId, lastMessageAt)`, `Message(conversationId, sentAt)` đã có chưa?
4. `sessionData` mã hóa bằng thuật toán/khóa nào (key rotation)?
