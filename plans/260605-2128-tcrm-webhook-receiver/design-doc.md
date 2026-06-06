# Design Doc: TCRM Webhook Receiver — Nhận tin nhắn Zalo từ ZaloCRM

**Date:** 2026-06-05
**Status:** DESIGN
**Owner:** Loc Nguyen
**Bridge:** ZaloCRM (push) → TCRM (receive + display)

---

## A. KIẾN TRÚC CHI TIẾT

### A.1 Mục tiêu

Khi khách hàng nhắn tin qua Zalo cá nhân → ZaloCRM nhận → **tự động đẩy** tin nhắn
sang TCRM hiển thị trong conversation, không cần nhân viên mở ZaloCRM.

### A.2 Mapping dựa trên 2 field: `conversationId` + `senderUid`

ZaloCRM webhook `message.received` gửi payload (xác nhận từ code `message-handler.ts:484`):

```json
{
  "event": "message.received",
  "timestamp": "2026-06-05T21:00:00.000Z",
  "data": {
    "messageId": "msg-123",
    "conversationId": "conv-456",   // ← KHÓA CHÍNH để map
    "senderUid": "uid-789",         // ← ai gửi (khách hàng nào)
    "content": "Tôi muốn mua sản phẩm",
    "contentType": "text",
    "sentAt": "2026-06-05T21:00:00.000Z"
  }
}
```

| Field | Vai trò |
|---|---|
| `conversationId` | Map 1-1 với TCRM conversation (khóa chính) |
| `senderUid` | Xác định khách hàng + phân biệt khách (`message.received`) vs nhân viên (`message.sent`) |

### A.3 Mapping table (lưu ở TCRM)

```sql
CREATE TABLE zalo_conversation_mapping (
  id                   INT PRIMARY KEY AUTO_INCREMENT,
  zalo_conversation_id VARCHAR(100) NOT NULL UNIQUE,  -- conversationId từ webhook
  zalo_sender_uid      VARCHAR(100),                  -- senderUid (khách hàng)
  tcrm_conversation_id INT NOT NULL,                  -- conversation_id của TCRM
  tcrm_customer_id     INT,                           -- KH trong TCRM (optional)
  created_at           TIMESTAMP DEFAULT NOW(),
  INDEX idx_zalo_conv (zalo_conversation_id),
  INDEX idx_sender (zalo_sender_uid)
);
```

### A.4 Flow hoàn chỉnh

```
1. Khách nhắn Zalo
   ↓
2. ZaloCRM nhận → emitWebhook('message.received', {conversationId, senderUid, content...})
   ↓ (POST, ký HMAC-SHA256)
3. TCRM /api/v1/webhooks/zalocrm nhận
   ↓
4. Verify signature (X-Webhook-Signature)
   ↓
5. Tra mapping: conversationId → tcrm_conversation_id
   ├─ Có  → dùng luôn
   └─ Chưa → tạo conversation TCRM mới + lưu mapping (on-the-fly)
   ↓
6. POST https://support.trianh.vn/apiv2/chat/send
   ↓
7. Tin nhắn hiện trong TCRM
```

### A.5 Cấu hình webhook bên ZaloCRM

Mở **`/settings/dev/api`** (KHÔNG phải `/settings/channels/integrations`):
- Webhook URL: `https://tcrm.../api/v1/webhooks/zalocrm`
- Secret: chuỗi bí mật chung 2 bên (để ký HMAC)
- Bấm **Lưu** → **Test Webhook** để kiểm tra kết nối

> Code: `webhook-service.ts` ký payload bằng `HMAC-SHA256(secret)` rồi gửi header
> `X-Webhook-Signature`. TCRM phải verify đúng secret này.

### A.6 TCRM Webhook Receiver (logic)

```javascript
// TCRM: POST /api/v1/webhooks/zalocrm
app.post('/api/v1/webhooks/zalocrm', async (req, res) => {
  // 1. Verify signature
  const sig = req.headers['x-webhook-signature'];
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });

  // 2. Chỉ xử lý tin đến từ khách
  const { event, data } = req.body;
  if (event !== 'message.received') return res.json({ ignored: true });

  const { conversationId, senderUid, content, contentType, sentAt } = data;

  // 3. Map conversationId → TCRM conversation_id
  let mapping = await db.findOne(
    'SELECT tcrm_conversation_id FROM zalo_conversation_mapping WHERE zalo_conversation_id = ?',
    [conversationId]
  );

  // 4. Chưa có → tạo conversation TCRM mới
  if (!mapping) {
    const tcrmConv = await createTcrmConversation(senderUid);
    await db.insert('zalo_conversation_mapping', {
      zalo_conversation_id: conversationId,
      zalo_sender_uid: senderUid,
      tcrm_conversation_id: tcrmConv.id,
    });
    mapping = { tcrm_conversation_id: tcrmConv.id };
  }

  // 5. Gửi vào TCRM
  await axios.post('https://support.trianh.vn/apiv2/chat/send', {
    conversation_id: mapping.tcrm_conversation_id,
    message: content,
    type: contentType,
  }, { headers: { Authorization: `Bearer ${TCRM_TOKEN}` }});

  res.json({ success: true });
});
```

---

## B. LÀM RÕ CÁC ĐIỂM (clarifications)

### B.1 Tạo conversation TCRM lần đầu (`createTcrmConversation`)

Khi 1 khách mới nhắn lần đầu → chưa có mapping → cần tạo conversation TCRM.

**Vấn đề:** TCRM `/apiv2/chat/send` cần `conversation_id` có sẵn — nó KHÔNG tự tạo conversation.

**2 hướng giải quyết:**

- **B.1.a — Tạo conversation qua TCRM API (nếu TCRM có endpoint tạo hội thoại):**
  ```
  POST /apiv2/chat/conversation  (cần xác nhận TCRM có endpoint này)
  { "customer_phone": "...", "channel": "zalo" }
  → trả về conversation_id mới
  ```
  Cần map `senderUid` (Zalo) → customer trong TCRM. Nếu ZaloCRM có lưu phone của
  contact (xem `GET /api/v1/conversations/:id`), dùng phone để tìm/ tạo customer TCRM.

- **B.1.b — Pre-provision thủ công (MVP, 5 nhân viên):**
  Tạo sẵn mapping cho từng khách test trước khi chạy. Bảng `zalo_conversation_mapping`
  được seed tay. Không cần `createTcrmConversation` động → đơn giản nhất cho giai đoạn test.

> **Khuyến nghị MVP:** dùng **B.1.b** (seed tay 5 nhân viên + vài khách), bỏ qua tạo
> động. Khi greenlight rollout 200 nhân viên → chuyển sang **B.1.a**.

### B.2 Xử lý attachment / ảnh — ✅ XỬ LÝ ĐƯỢC NGAY MVP

> **Đính chính (đã kiểm tra code):** ảnh/file KHÔNG cần để Phase 2. URL ảnh **đã có sẵn
> trong `content`** và **public tải được không cần auth**. Chỉ cần parse + forward URL.

**Sự thật từ code:**

1. **Webhook KHÔNG có field `attachments` riêng** (`message-handler.ts:484` chỉ gửi 6 field:
   `messageId, conversationId, senderUid, content, contentType, sentAt`). Cột `Message.attachments`
   trong DB tồn tại nhưng KHÔNG được gửi đi.

2. **Với tin media** (`contentType` ∈ `image, video, file, gif, voice, audio`), ZaloCRM tự
   **mirror** file từ Zalo → upload lên storage riêng (MinIO/S3) → **bỏ URL vĩnh viễn vào `content`**
   (`mirrorInboundMediaContent` + `mirrorRemoteMediaUrl` + `uploadBuffer`). Nên:
   - **Đơn giản:** `content` = 1 URL string → `"https://files.zalocrm.../2026-06-06/uuid.jpg"`
   - **Phức tạp:** `content` = chuỗi JSON chứa nhiều URL đã mirror (`hdUrl`, `thumbUrl`, `fileUrl`...)

3. **URL là PUBLIC** (`docker-compose.yml:117` → `mc anonymous set download`): GET không cần auth,
   upload thì chỉ backend ghi được, key là UUID ngẫu nhiên (không enumerate được).

**Flow ảnh (làm được ngay MVP):**
```javascript
if (['image','video','file','gif','voice','audio'].includes(contentType)) {
  // content = URL public (hoặc JSON chứa URL), tải trực tiếp, KHÔNG cần header auth
  const mediaUrl = isJsonString(content)
    ? (JSON.parse(content).hdUrl ?? JSON.parse(content).url ?? JSON.parse(content).fileUrl)
    : content;
  await axios.post('https://support.trianh.vn/apiv2/chat/send', {
    conversation_id: mapping.tcrm_conversation_id,
    message: contentType === 'image' ? '[Hình ảnh]' : `[${contentType}]`,
    type: contentType,
    attachment: mediaUrl,   // forward thẳng URL public
  }, { headers: { Authorization: `Bearer ${TCRM_TOKEN}` }});
}
```

> **MVP:** sync được CẢ text LẪN ảnh/file ngay từ đầu — không cần placeholder, không cần Phase 2.

**⚠️ 2 lưu ý production:**
1. **URL public = "security through obscurity":** ai có link đều xem được ảnh (kể cả người ngoài).
   Với dữ liệu nhạy cảm (CMND, hợp đồng khách Shiseido) → cân nhắc rủi ro lộ link.
2. **Nếu chuyển sang Cloudflare R2:** R2 private bucket mặc định → phải gắn custom domain/public
   access, nếu không URL trong `content` sẽ bị **403** và TCRM tải không được.

### B.3 Phân biệt khách vs nhân viên (2 chiều)

- `message.received` = khách gửi → hiển thị bên trái TCRM
- `message.sent` = nhân viên gửi (từ ZaloCRM) → hiển thị bên phải TCRM
- **MVP:** chỉ xử lý `message.received` (tin khách). Muốn đồng bộ 2 chiều → xử lý thêm
  `message.sent`, dùng `senderUid` để biết ai gửi.

### B.4 Idempotency (chống trùng tin)

Webhook có thể bị gửi lại (retry). Dùng `messageId` làm khóa chống trùng:
```sql
-- Trước khi insert, kiểm tra messageId đã xử lý chưa
SELECT 1 FROM synced_messages WHERE zalo_message_id = ?
```
Nếu đã có → bỏ qua, trả 200 (để ZaloCRM không retry tiếp).

---

## C. POSTMAN COLLECTION — đã cập nhật

File `postman-collection.json` đã được bổ sung (mục `1. Authentication & Setup`):

1. **Auto-save token:** request **Login** giờ có test script tự lưu `token → {{TOKEN}}`,
   `user.orgId → {{ORG_ID}}`, `user.id → {{USER_ID}}`. Không cần copy token tay.
2. **Hướng dẫn `{{CONVERSATION_ID}}`:** description nhóm 1 giải thích lấy conversationId
   từ (a) API `List Conversations`, (b) webhook `message.received`, (c) URL giao diện.

---

## D. CHECKLIST TRIỂN KHAI

### ZaloCRM (đã làm xong)
- [x] Webhook fire `message.received` — `message-handler.ts:484`
- [x] Ký HMAC-SHA256 — `webhook-service.ts`
- [x] UI cấu hình webhook — `/settings/dev/api`
- [ ] (Tùy chọn) Thêm `accountId` vào payload nếu cần map theo ZaloAccount

### TCRM (cần làm)
- [ ] Endpoint `POST /api/v1/webhooks/zalocrm` + verify signature
- [ ] Bảng `zalo_conversation_mapping`
- [ ] Logic map conversationId → tcrm_conversation_id
- [ ] Gọi `POST /apiv2/chat/send` (text)
- [ ] Parse + forward URL ảnh/file từ `content` (xem B.2 — làm được ngay MVP)
- [ ] Idempotency theo `messageId`

### Test (5 nhân viên)
- [ ] Seed mapping tay cho khách test (B.1.b)
- [ ] Cấu hình webhook URL + secret ở `/settings/dev/api` → Test Webhook
- [ ] Gửi tin Zalo thật → verify hiện trong TCRM
- [ ] Test signature sai → bị reject 401

---
