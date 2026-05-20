# zca-js Phase 1 Integration

## Scope

ZaloCRM is the operator inbox and CRM surface for Phase 1. `zca-js` remains the Zalo adapter/executor for account sessions, listener events, scans, guarded actions, and handoff.

Implemented in this repo:

- zca-js conversation sync endpoint.
- Idempotent event/message ingest by `event_id`.
- Canonical customer stage field and stage history log.
- Durable `new_inbox` notifications.
- Placeholder-compatible fields for source, campaign, template/script, sales kit, quick replies, FAQ, and suggested reply workflows.

Not implemented yet:

- Full auto reply/AI agent.
- Persisted SLA overdue worker.
- Order/PayOS attribution write path.
- Full inbox UI stage action. Backend APIs are ready for frontend wiring.

## Run ZaloCRM

Docker production-style run:

```bash
cp .env.example .env
docker compose up -d --build
```

Default Docker access from the README is:

```text
http://localhost:3080
```

Backend dev run:

```bash
cd backend
npm install
DATABASE_URL=postgresql://crmuser:password@localhost:5432/zalocrm npm run dev
```

Backend defaults to:

```text
http://localhost:3000
```

Optional sync hardening:

```bash
ZALOCRM_SYNC_SECRET=change-me
```

When set, callers must send:

```text
X-ZaloCRM-Sync-Secret: change-me
```

Production sync must identify the organization with one of:

- `X-API-Key: <public-api-key>`
- `X-ZaloCRM-Org-Id: <org-id>`
- JSON body `org_id`

In development only, the sync route can fall back to the first organization to make local smoke tests easier.

## zca-js Env

In `/Users/jin/zca-js/server`:

```bash
ZALOCRM_BASE_URL=http://localhost:3000
ZALOCRM_SYNC_PATH=/api/zca-js/conversations/sync
```

For Docker-exposed ZaloCRM, use:

```bash
ZALOCRM_BASE_URL=http://localhost:3080
ZALOCRM_SYNC_PATH=/api/zca-js/conversations/sync
```

## API Contract

### Sync Conversation

```http
POST /api/zca-js/conversations/sync
Content-Type: application/json
```

Payload:

```json
{
  "event_id": "evt_xxx",
  "account_id": "A_INBOX_03",
  "thread_id": "123456",
  "thread_type": "user",
  "direction": "inbound",
  "message_text": "Cho mình xin giá combo",
  "attachments": [],
  "campaign_id": "C_DETOX_7D",
  "source_id": "G_OFFICE_Q1",
  "template_id": "tpl_intro_01",
  "script_id": "script_sales_01",
  "zalo_crm_thread_url": "http://localhost:3000/chat/...",
  "raw": {},
  "created_at": "2026-05-20T00:00:00.000Z"
}
```

Validation:

- `event_id`, `account_id`, `thread_id` are required.
- `thread_type` must be `user` or `group`.
- `direction` must be `inbound` or `outbound`.
- `created_at` must be an ISO datetime if supplied.

Behavior:

- Upserts `ZaloAccount` using `account_id` as `externalAccountId` scoped by organization. The internal `ZaloAccount.id` remains a CRM UUID.
- Upserts `Contact` for `thread_type=user`.
- Upserts group `Conversation` for `thread_type=group`.
- Upserts `Conversation` by `zaloAccountId + externalThreadId`.
- Claims `conversation_events` by unique `(org_id, event_id)` inside a transaction before message/contact/conversation side effects.
- Creates one `Message` and one `ConversationEvent` per `event_id`.
- Stores the full raw payload in `conversation_events.raw`.
- Creates at most one `notifications.type=new_inbox` per `(org_id, event_id)` for inbound messages.
- Returns duplicate responses without creating another message.

Response:

```json
{
  "ok": true,
  "data": {
    "duplicate": false,
    "account": { "id": "crm-account-uuid", "externalAccountId": "A_INBOX_03", "displayName": "A_INBOX_03" },
    "contact": { "id": "contact_id", "currentStage": "engaged", "source": "G_OFFICE_Q1" },
    "conversation": { "id": "conversation_id", "threadId": "123456", "threadType": "user" },
    "message": { "id": "message_id" },
    "event": { "eventId": "evt_xxx" },
    "notification": { "id": "notification_id", "type": "new_inbox" }
  }
}
```

### Update Customer Stage

Requires JWT auth.

```http
PATCH /api/customers/:id/stage
Authorization: Bearer <token>
Content-Type: application/json
```

Aliases:

- `PATCH /api/v1/customers/:id/stage`
- `PATCH /api/v1/contacts/:id/stage`

Body:

```json
{
  "stage": "sales_ready",
  "reason": "Customer asked for price",
  "operator": "SALE_A"
}
```

Every real stage change writes `customer_stage_history`.

### Notifications

Requires JWT auth.

```http
GET /api/v1/notifications
PATCH /api/v1/notifications/:id
```

Patch body:

```json
{ "read": true }
```

or:

```json
{ "resolved": true }
```

## Stage Mapping

Canonical `Contact.currentStage` values:

| Stage | Meaning |
| --- | --- |
| `new_lead` | New lead from scan/import, no real interaction yet |
| `engaged` | Replied, commented, or inboxed |
| `sales_ready` | Asked about price/combo/shipping or intent to buy |
| `ordered` | Order created, payment not confirmed |
| `paid` | Payment confirmed |
| `cskh` | Post-purchase support |
| `repeat` | Repurchase/membership/referral flow |
| `lost` | Long no-response or not a fit |
| `opt_out` | Does not want further outreach |

Existing `Contact.status` and dynamic `Status` rows are preserved for the current ZaloCRM UI. Phase 1 uses `currentStage` to avoid duplicating or breaking the existing status system.

## Curl Smoke Test

Set base URL:

```bash
export CRM=http://localhost:3000
```

Inbound event:

```bash
curl -s "$CRM/api/zca-js/conversations/sync" \
  -H 'Content-Type: application/json' \
  -d '{
    "event_id":"evt_smoke_in_001",
    "account_id":"A_INBOX_03",
    "thread_id":"123456",
    "thread_type":"user",
    "direction":"inbound",
    "message_text":"Cho mình xin giá combo 7 ngày",
    "attachments":[],
    "campaign_id":"C_DETOX_7D",
    "source_id":"G_OFFICE_Q1",
    "raw":{"msgType":"webchat"},
    "created_at":"2026-05-20T00:00:00.000Z"
  }'
```

Send the same command again. Expected: `duplicate: true`, no new message.

Outbound event:

```bash
curl -s "$CRM/api/zca-js/conversations/sync" \
  -H 'Content-Type: application/json' \
  -d '{
    "event_id":"evt_smoke_out_001",
    "account_id":"A_INBOX_03",
    "thread_id":"123456",
    "thread_type":"user",
    "direction":"outbound",
    "message_text":"Dạ em gửi chị combo phù hợp ạ",
    "attachments":[],
    "campaign_id":"C_DETOX_7D",
    "source_id":"G_OFFICE_Q1",
    "template_id":"tpl_price_01",
    "created_at":"2026-05-20T00:01:00.000Z"
  }'
```

Login and set token:

```bash
export TOKEN=<jwt-from-login>
export CONTACT_ID=<contact-id-from-sync-response>
```

Update stage:

```bash
curl -s -X PATCH "$CRM/api/customers/$CONTACT_ID/stage" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"stage":"sales_ready","reason":"asked for combo price","operator":"SALE_A"}'
```

List conversations:

```bash
curl -s "$CRM/api/v1/conversations?limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

List notifications:

```bash
curl -s "$CRM/api/v1/notifications" \
  -H "Authorization: Bearer $TOKEN"
```

Mark notification read:

```bash
curl -s -X PATCH "$CRM/api/v1/notifications/<notification-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"read":true}'
```
