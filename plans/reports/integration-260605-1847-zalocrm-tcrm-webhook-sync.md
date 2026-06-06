# Integration Design: ZaloCRM ↔️ TCRM Real-time Message Sync

**Date:** 2026-06-05  
**Status:** DESIGN  
**User:** Loc Nguyen  

---

## Problem

- **Push direction (ZaloCRM → TCRM):** When a new message arrives at Zalo → automatically push to TCRM (webhook)
- **Pull direction (TCRM → ZaloCRM):** TCRM can fetch message history when needed
- **Mapping:** Match messages via ZaloAccount ID

---

## Solution Architecture

### 1️⃣ **Webhook Setup (Real-time Push)**

**Flow:**
```
Zalo → ZaloCRM → [Webhook] → TCRM API
```

**Step 1: Create Webhook in ZaloCRM** (admin setup, one-time)
```bash
POST /api/v1/webhook-settings

{
  "url": "https://tcrm.com/api/v1/webhooks/zalocrm-messages",
  "events": ["message.received"],
  "secret": "webhook-secret-key"
}
```

**Step 2: ZaloCRM sends webhook when message arrives**
```json
POST https://tcrm.com/api/v1/webhooks/zalocrm-messages

{
  "event": "message.received",
  "data": {
    "zaloAccountId": "acc-001",
    "conversationId": "conv-xyz",
    "senderId": "contact-123",
    "senderName": "Khách hàng A",
    "content": "Tôi quan tâm sản phẩm này",
    "timestamp": "2026-06-05T18:00:00Z",
    "attachments": []
  },
  "timestamp": "2026-06-05T18:00:00Z"
}
```

**Step 3: TCRM receives webhook**
- Verify webhook signature (use `secret`)
- Find TCRM conversation by: `zaloAccountId` (mapping table)
- Insert message: `POST /apiv2/chat/send`
  ```json
  {
    "conversation_id": 12345,
    "message": "Tôi quan tâm sản phẩm này",
    "type": "zalo_sync",
    "metadata": {
      "zaloAccountId": "acc-001",
      "zaloConversationId": "conv-xyz",
      "timestamp": "2026-06-05T18:00:00Z"
    }
  }
  ```

---

### 2️⃣ **Pull API (History Fetch on Demand)**

**Flow:**
```
TCRM [Pull] → ZaloCRM API → Get message history
```

**TCRM calls ZaloCRM when:**
- User opens conversation (fetch recent history)
- User scrolls to load older messages
- Initial sync after connecting Zalo account

**API Call (from TCRM to ZaloCRM):**
```
GET /api/v1/accounts/{zaloAccountId}/conversations/{conversationId}/messages

Query params:
  ?limit=50&offset=0&sort=desc

Response:
{
  "data": [
    {
      "id": "msg-001",
      "senderId": "contact-123",
      "senderName": "Khách hàng A",
      "content": "Tôi quan tâm sản phẩm này",
      "timestamp": "2026-06-05T18:00:00Z",
      "type": "text",
      "attachments": []
    }
  ],
  "total": 250,
  "page": 1,
  "limit": 50
}
```

---

## Mapping: ZaloAccountId → TCRM Conversation

**Need a lookup table in TCRM:**
```sql
CREATE TABLE zalo_account_mapping (
  id INT PRIMARY KEY,
  zalo_account_id VARCHAR(50) NOT NULL UNIQUE,
  tcrm_conversation_id INT NOT NULL,
  tcrm_employee_id INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Lookup flow:**
1. ZaloCRM webhook arrives with `zaloAccountId`
2. TCRM query: `SELECT tcrm_conversation_id FROM zalo_account_mapping WHERE zalo_account_id = 'acc-001'`
3. Use result to `POST /apiv2/chat/send`

**How to populate this table:**
- When Shiseido employee links their Zalo account → store mapping
- QR login creates mapping: `(zaloAccountId, tcrm_conversation_id, tcrm_employee_id)`

---

## Implementation Checklist

### ZaloCRM Side
- [ ] Create webhook endpoint handler
  - Accept POST to `/api/v1/webhook-settings`
  - Store webhook URL + events + secret
  - When `message.received` event fires → send webhook POST

### TCRM Side
- [ ] Create webhook receiver endpoint
  - `POST /api/v1/webhooks/zalocrm-messages`
  - Verify webhook signature (HMAC-SHA256)
  - Lookup `zaloAccountId` in mapping table
  - Call `POST /apiv2/chat/send` to insert message

- [ ] Create mapping table
  - Store `(zalo_account_id, tcrm_conversation_id, employee_id)`

- [ ] Update conversation UI
  - When user opens conversation → fetch history from ZaloCRM
  - Merge ZaloCRM messages + TCRM messages in UI
  - Show messages from both systems chronologically

### Testing
- [ ] Webhook delivery (send test message, verify arrives in TCRM)
- [ ] Message history fetch (scroll up, load older messages)
- [ ] Mapping accuracy (correct conversation matches)
- [ ] Signature verification (reject unsigned/invalid webhooks)

---

## Security Considerations

1. **Webhook Signature Verification**
   ```javascript
   const crypto = require('crypto');
   
   function verifyWebhookSignature(req, secret) {
     const signature = req.headers['x-webhook-signature'];
     const timestamp = req.headers['x-webhook-timestamp'];
     const body = JSON.stringify(req.body);
     
     const expected = crypto
       .createHmac('sha256', secret)
       .update(`${timestamp}.${body}`)
       .digest('hex');
     
     return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
   }
   ```

2. **Rate Limiting** — ZaloCRM: 500 req/min (global), TCRM: enforce per-user limits

3. **Token Storage** — Store ZaloCRM tokens in TCRM encrypted field

---

## Sequence Diagram

```
Zalo Message → ZaloCRM
                ↓
                [Queue/Process]
                ↓
                Webhook POST → TCRM /api/v1/webhooks/zalocrm-messages
                ↓
                [Verify signature]
                ↓
                [Lookup mapping: zaloAccountId → conversation_id]
                ↓
                POST /apiv2/chat/send
                ↓
                Message appears in TCRM conversation
```

---

## Phase 1: MVP (Week 1-2)
- ✅ Webhook receiver in TCRM (POST endpoint)
- ✅ Mapping table
- ✅ Insert message into TCRM conversation
- ❌ History fetch (defer to Phase 2)

## Phase 2: History Sync (Week 3)
- Message history fetch API
- Pagination + scroll loading
- Merge ZaloCRM + TCRM messages in UI

---

## Next Action

1. **Clarify ZaloCRM webhook payload** — What fields does ZaloCRM send when `message.received` fires? (Ask for example webhook payload)
2. **Confirm TCRM conversation structure** — How do conversations map to Shiseido employees/Zalo accounts?
3. **Start implementation** — Set up webhook receiver in TCRM, create mapping table

---

## Open Questions

1. Does ZaloCRM webhook include attachment data? (images, files, etc.)
2. What metadata should we store in TCRM for audit trail? (sender IP, webhook delivery time, etc.)
3. Should TCRM mark messages as "synced from Zalo" in UI? (badge, label, etc.)
4. What happens if mapping lookup fails? (create new conversation? reject message?)
