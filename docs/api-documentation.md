# Zalo CRM - API Documentation

**Version:** 1.0.0  
**Last Updated:** 2026-06-05  
**Base URL:** `http://localhost:3000` (development) | `https://api.zalocrm.com` (production)

---

## Table of Contents

1. [Authentication](#authentication)
2. [Setup & Onboarding](#setup--onboarding)
3. [Zalo Account Management](#zalo-account-management)
4. [Chat & Messaging](#chat--messaging)
5. [Contacts & CRM](#contacts--crm)
6. [Automation & Marketing](#automation--marketing)
7. [Analytics & Reporting](#analytics--reporting)
8. [Team & Organization](#team--organization)
9. [RBAC & Permissions](#rbac--permissions)
10. [Search](#search)
11. [Scoring & Lead Management](#scoring--lead-management)
12. [Engagement](#engagement)
13. [Activity & Timeline](#activity--timeline)
14. [Notifications](#notifications)
15. [Integrations](#integrations)
16. [AI & Assistant](#ai--assistant)
17. [Branding](#branding)
18. [Privacy & Security](#privacy--security)
19. [Public API & Webhooks](#public-api--webhooks)
20. [System](#system)

---

## General Guidelines

### Authentication
- All endpoints (except `/api/v1/setup/*` and `/api/v1/auth/login`) require JWT authentication
- Include token in request header: `Authorization: Bearer <token>`
- Token expires in 7 days
- Response format for auth success includes `token` and `user` object

### Rate Limiting
- **Global limit:** 500 requests per minute
- **Per-IP:** Applied to all `/api/*` routes
- **Response headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Error Responses
```json
{
  "error": "Error message",
  "statusCode": 400
}
```

### Pagination
- **Default limit:** 50 items
- **Max limit:** 100 items
- **Parameters:** `page`, `limit`, `offset`
- **Response includes:** `data`, `total`, `page`, `limit`

---

## 1. Authentication

### 1.1 Check Setup Status
**GET** `/api/v1/setup/status`

Check if initial setup is required.

**Response:**
```json
{
  "setupRequired": true,
  "organizationCount": 0
}
```

---

### 1.2 Initial Setup
**POST** `/api/v1/setup`

Create organization and owner user account. Only available when system has no organizations.

**Request Body:**
```json
{
  "orgName": "Acme Corporation",
  "fullName": "John Doe",
  "email": "john@acme.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "john@acme.com",
    "fullName": "John Doe",
    "role": "owner",
    "orgId": "org-123"
  }
}
```

**Status Codes:** 201, 400, 409 (if setup already done)

---

### 1.3 Login
**POST** `/api/v1/auth/login`

Authenticate user and receive JWT token.

**Request Body:**
```json
{
  "email": "john@acme.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "john@acme.com",
    "fullName": "John Doe",
    "role": "admin",
    "orgId": "org-123"
  }
}
```

**Status Codes:** 200, 401 (invalid credentials)

---

### 1.4 Get Current Profile
**GET** `/api/v1/profile`

Get authenticated user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "user-123",
  "email": "john@acme.com",
  "fullName": "John Doe",
  "role": "admin",
  "orgId": "org-123",
  "department": "Sales",
  "avatar": "https://...",
  "createdAt": "2026-01-15T10:30:00Z",
  "lastLogin": "2026-06-05T14:22:00Z"
}
```

**Status Codes:** 200, 401

---

## 2. Setup & Onboarding

### 2.1 Create Organization
**POST** `/api/v1/orgs`

Create a new organization.

**Request Body:**
```json
{
  "name": "Marketing Agency",
  "industry": "Marketing",
  "website": "https://agency.com",
  "phone": "+84.9.xxxx.xxxx",
  "address": "123 Main St"
}
```

**Response:** 201
```json
{
  "id": "org-456",
  "name": "Marketing Agency",
  "createdAt": "2026-06-05T17:30:00Z"
}
```

---

## 3. Zalo Account Management

### 3.1 List Zalo Accounts
**GET** `/api/v1/zalo-accounts`

List all connected Zalo accounts with live status.

**Query Parameters:**
- `status` - Filter by status: `qr_pending`, `connected`, `disconnected`
- `assignedTo` - Filter by account owner user ID
- `search` - Search by display name or phone

**Response:**
```json
[
  {
    "id": "acc-001",
    "zaloUid": "1234567890",
    "displayName": "Zalo Official",
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
      "fullName": "John Doe",
      "email": "john@acme.com"
    },
    "hasProxy": false,
    "lastConnectedAt": "2026-06-05T10:00:00Z",
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 3.2 Create Zalo Account
**POST** `/api/v1/zalo-accounts`

Create new account record (before QR login).

**Request Body:**
```json
{
  "displayName": "My Business Account",
  "proxyUrl": null
}
```

**Response:** 201
```json
{
  "id": "acc-002",
  "displayName": "My Business Account",
  "status": "qr_pending",
  "createdAt": "2026-06-05T17:30:00Z"
}
```

---

### 3.3 Initiate QR Login
**POST** `/api/v1/zalo-accounts/:id/login`

Start QR code login process. QR delivered via Socket.IO.

**Socket Room:** `account:{id}`

**Response:**
```json
{
  "message": "QR login initiated — subscribe to account:acc-001 socket room"
}
```

---

### 3.4 Force Reconnect
**POST** `/api/v1/zalo-accounts/:id/reconnect`

Reconnect using saved session data.

**Response:**
```json
{
  "message": "Reconnect initiated"
}
```

---

### 3.5 Delete/Archive Account
**DELETE** `/api/v1/zalo-accounts/:id`

Archive account (soft delete). Use `?purge=true` to clear session data.

**Query Parameters:**
- `purge` - Boolean. If true, wipes sessionData and zaloUid for fresh reconnect

**Response:** 204 No Content

---

### 3.6 Get Account Status
**GET** `/api/v1/zalo-accounts/:id/status`

Get real-time status of specific account.

**Response:**
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

### 3.7 Update Proxy
**PUT** `/api/v1/zalo-accounts/:id/proxy`

Update proxy configuration for account.

**Request Body:**
```json
{
  "proxyUrl": "http://user:pass@proxy.com:8080"
}
```

**Response:**
```json
{
  "message": "Proxy updated",
  "hasProxy": true
}
```

---

## 4. Chat & Messaging

### 4.1 Get Conversation Counts
**GET** `/api/v1/conversations/counts`

Get count of unread and unreplied conversations.

**Response:**
```json
{
  "total": 150,
  "unread": 25,
  "unreplied": 12,
  "archived": 8
}
```

---

### 4.2 List Conversations
**GET** `/api/v1/conversations`

List conversations/threads with pagination.

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50, max: 100)
- `status` - Filter: `active`, `archived`, `closed`
- `type` - Filter: `user`, `group`
- `search` - Search by contact name
- `sortBy` - Sort field: `lastMessage`, `createdAt` (default: `lastMessage`)
- `direction` - Sort direction: `asc`, `desc`

**Response:**
```json
{
  "data": [
    {
      "id": "conv-001",
      "contactId": "contact-123",
      "contactName": "Nguyen Van A",
      "contactAvatar": "https://...",
      "type": "user",
      "zaloAccountId": "acc-001",
      "messageCount": 45,
      "unreadCount": 3,
      "lastMessage": {
        "id": "msg-999",
        "content": "Hello!",
        "contentType": "text",
        "senderName": "Nguyen Van A",
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

### 4.3 Get Conversation Details
**GET** `/api/v1/conversations/:id`

Get full conversation with messages.

**Query Parameters:**
- `page` - Message page (default: 1)
- `limit` - Messages per page (default: 30)

**Response:**
```json
{
  "conversation": {
    "id": "conv-001",
    "contactId": "contact-123",
    "contactName": "Nguyen Van A",
    "type": "user",
    "zaloAccountId": "acc-001",
    "status": "active",
    "createdAt": "2026-03-10T08:00:00Z"
  },
  "messages": [
    {
      "id": "msg-001",
      "conversationId": "conv-001",
      "content": "Hello, how are you?",
      "contentType": "text",
      "senderUid": "1234567890",
      "senderName": "Nguyen Van A",
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

### 4.4 Send Message
**POST** `/api/v1/conversations/:id/messages`

Send message to conversation.

**Request Body:**
```json
{
  "content": "Thanks for reaching out!",
  "contentType": "text",
  "attachments": []
}
```

**Response:** 201
```json
{
  "id": "msg-1000",
  "conversationId": "conv-001",
  "content": "Thanks for reaching out!",
  "contentType": "text",
  "senderName": "John Doe",
  "sentAt": "2026-06-05T17:35:00Z",
  "status": "sent"
}
```

---

### 4.5 Archive Conversation
**POST** `/api/v1/conversations/:id/archive`

Archive conversation.

**Response:**
```json
{
  "message": "Conversation archived"
}
```

---

### 4.6 Create Chat Folder
**POST** `/api/v1/chat/folders`

Create folder for organizing conversations.

**Request Body:**
```json
{
  "name": "Hot Leads",
  "color": "#FF5722"
}
```

**Response:** 201
```json
{
  "id": "folder-001",
  "name": "Hot Leads",
  "color": "#FF5722",
  "conversationCount": 0,
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 4.7 List Chat Presets
**GET** `/api/v1/chat/presets`

List saved message templates.

**Response:**
```json
[
  {
    "id": "preset-001",
    "name": "Greeting",
    "content": "Hi! Thanks for contacting us 👋",
    "category": "greetings",
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 4.8 Upload Attachment
**POST** `/api/v1/chat/attachments`

Upload file/image/video for sending.

**Request:** Form-data with `file` field

**Response:** 201
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

## 5. Contacts & CRM

### 5.1 List Contacts
**GET** `/api/v1/contacts`

List contacts with advanced filtering.

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50)
- `search` - Search by name, phone, email
- `source` - Filter by source: `zalo`, `facebook`, `manual`, etc.
- `status` - Filter by status (e.g., `lead`, `customer`, `lost`)
- `statusId` - Filter by custom status ID
- `assignedUserId` - Filter by assigned user
- `threadType` - Filter by conversation type: `user`, `group`
- `hasZalo` - Filter by Zalo connection: `true`, `false`, `unknown`
- `scoreMin` / `scoreMax` - Filter by lead score range
- `dateFrom` / `dateTo` - Filter by activity date range
- `sortBy` - Sort field: `lastActivity`, `createdAt`, `leadScore`
- `direction` - `asc` or `desc`

**Response:**
```json
{
  "data": [
    {
      "id": "contact-001",
      "name": "Nguyen Van A",
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
          "displayName": "Nguyen Van A",
          "accountId": "acc-001"
        }
      ],
      "notes": "Interested in premium plan",
      "tags": ["hot-lead", "vip"],
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

### 5.2 Get Contact Details
**GET** `/api/v1/contacts/:id`

Get full contact information.

**Response:**
```json
{
  "id": "contact-001",
  "name": "Nguyen Van A",
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
      "displayName": "Nguyen Van A",
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
      "content": "Interested in premium plan",
      "createdBy": "user-123",
      "createdAt": "2026-06-01T10:00:00Z"
    }
  ],
  "tags": ["hot-lead", "vip"],
  "appointments": [
    {
      "id": "apt-001",
      "title": "Demo Call",
      "scheduledAt": "2026-06-10T14:00:00Z",
      "status": "scheduled"
    }
  ],
  "activities": [
    {
      "type": "message_received",
      "timestamp": "2026-06-05T16:45:00Z",
      "data": "Customer sent message"
    }
  ],
  "createdAt": "2026-03-10T08:00:00Z",
  "updatedAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.3 Create Contact
**POST** `/api/v1/contacts`

Create new contact.

**Request Body:**
```json
{
  "name": "Tran Thi B",
  "email": "b@example.com",
  "phone": "+84.9.yyyy.yyyy",
  "source": "facebook",
  "status": "lead",
  "statusId": "status-001",
  "assignedUserId": "user-123",
  "notes": "Referred by existing customer",
  "tags": ["referral"]
}
```

**Response:** 201
```json
{
  "id": "contact-002",
  "name": "Tran Thi B",
  "email": "b@example.com",
  "phone": "+84.9.yyyy.yyyy",
  "source": "facebook",
  "status": "lead",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.4 Update Contact
**PUT** `/api/v1/contacts/:id`

Update contact information.

**Request Body:**
```json
{
  "name": "Tran Thi B",
  "email": "b.tran@example.com",
  "status": "customer",
  "assignedUserId": "user-124",
  "tags": ["vip", "referral"]
}
```

**Response:** 200
```json
{
  "id": "contact-002",
  "name": "Tran Thi B",
  "email": "b.tran@example.com",
  "status": "customer",
  "updatedAt": "2026-06-05T17:40:00Z"
}
```

---

### 5.5 Delete Contact
**DELETE** `/api/v1/contacts/:id`

Delete contact.

**Response:** 204 No Content

---

### 5.6 Get Contact Friends
**GET** `/api/v1/contacts/:id/friends`

Get Zalo friend connections for contact.

**Response:**
```json
[
  {
    "id": "friend-001",
    "zaloUid": "1234567890",
    "displayName": "Nguyen Van A",
    "accountId": "acc-001",
    "relationshipKind": "friend",
    "addedAt": "2026-03-10T08:00:00Z"
  }
]
```

---

### 5.7 Create Appointment
**POST** `/api/v1/appointments`

Schedule appointment with contact.

**Request Body:**
```json
{
  "contactId": "contact-001",
  "title": "Product Demo",
  "description": "Show premium features",
  "scheduledAt": "2026-06-10T14:00:00Z",
  "duration": 60,
  "type": "meeting",
  "location": "Video Call",
  "assignedUserId": "user-123"
}
```

**Response:** 201
```json
{
  "id": "apt-001",
  "contactId": "contact-001",
  "title": "Product Demo",
  "scheduledAt": "2026-06-10T14:00:00Z",
  "status": "scheduled",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.8 List Appointments
**GET** `/api/v1/appointments`

List all appointments.

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `status` - Filter: `scheduled`, `completed`, `cancelled`
- `contactId` - Filter by contact
- `dateFrom` / `dateTo` - Date range

**Response:**
```json
{
  "data": [
    {
      "id": "apt-001",
      "contactId": "contact-001",
      "contactName": "Nguyen Van A",
      "title": "Product Demo",
      "scheduledAt": "2026-06-10T14:00:00Z",
      "status": "scheduled",
      "createdAt": "2026-06-05T17:35:00Z"
    }
  ],
  "pagination": { "total": 25, "page": 1, "limit": 50 }
}
```

---

### 5.9 Add Note to Contact
**POST** `/api/v1/contacts/:id/notes`

Add note/comment to contact.

**Request Body:**
```json
{
  "content": "Customer interested in annual plan. Follow up next week."
}
```

**Response:** 201
```json
{
  "id": "note-002",
  "contactId": "contact-001",
  "content": "Customer interested in annual plan...",
  "createdBy": "user-123",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 6. Automation & Marketing

### 6.1 List Automation Rules
**GET** `/api/v1/automation/rules`

List automation workflows.

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `status` - Filter: `draft`, `active`, `paused`
- `type` - Filter by rule type

**Response:**
```json
{
  "data": [
    {
      "id": "rule-001",
      "name": "Welcome New Leads",
      "description": "Send welcome message to new leads",
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

### 6.2 Create Automation Rule
**POST** `/api/v1/automation/rules`

Create new automation workflow.

**Request Body:**
```json
{
  "name": "High-Value Lead Alert",
  "description": "Notify team when high-value lead is created",
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

**Response:** 201
```json
{
  "id": "rule-002",
  "name": "High-Value Lead Alert",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.3 List Message Templates
**GET** `/api/v1/automation/templates`

List saved message templates.

**Response:**
```json
[
  {
    "id": "tpl-001",
    "name": "Welcome Message",
    "content": "Hi {{contactName}}, welcome to our service!",
    "category": "greeting",
    "variables": ["contactName"],
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 6.4 Create Message Template
**POST** `/api/v1/automation/templates`

Create new message template with variables.

**Request Body:**
```json
{
  "name": "Special Offer",
  "content": "Hi {{contactName}}, we have a special offer just for you: {{offerDetails}}",
  "category": "offer",
  "variables": ["contactName", "offerDetails"]
}
```

**Response:** 201
```json
{
  "id": "tpl-002",
  "name": "Special Offer",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.5 List Customer Lists
**GET** `/api/v1/customer-lists`

List audience segments.

**Response:**
```json
[
  {
    "id": "list-001",
    "name": "Hot Leads - June",
    "description": "Leads with score > 80",
    "contactCount": 150,
    "status": "active",
    "createdAt": "2026-06-01T10:00:00Z"
  }
]
```

---

### 6.6 Create Customer List
**POST** `/api/v1/customer-lists`

Create new audience/segment.

**Request Body:**
```json
{
  "name": "VIP Customers",
  "description": "Customers with purchase history > $5000",
  "criteria": {
    "filters": [
      { "field": "status", "operator": "equals", "value": "customer" },
      { "field": "leadScore", "operator": "gte", "value": 85 }
    ]
  }
}
```

**Response:** 201
```json
{
  "id": "list-002",
  "name": "VIP Customers",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.7 Add Entry to Customer List
**POST** `/api/v1/customer-lists/:id/entries`

Add contact to customer list.

**Request Body:**
```json
{
  "contactId": "contact-001"
}
```

**Response:** 201
```json
{
  "id": "entry-001",
  "listId": "list-002",
  "contactId": "contact-001",
  "addedAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.8 List Campaigns
**GET** `/api/v1/campaigns`

List marketing campaigns.

**Response:**
```json
[
  {
    "id": "campaign-001",
    "name": "Summer Promotion",
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

### 6.9 Create Campaign
**POST** `/api/v1/campaigns`

Create new marketing campaign.

**Request Body:**
```json
{
  "name": "July Sale Campaign",
  "description": "Announce July sale to all customers",
  "type": "broadcast",
  "listId": "list-001",
  "templateId": "tpl-001",
  "schedule": "2026-07-01T08:00:00Z",
  "variables": {
    "discount": "30%"
  }
}
```

**Response:** 201
```json
{
  "id": "campaign-002",
  "name": "July Sale Campaign",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 7. Analytics & Reporting

### 7.1 Get Conversion Funnel
**GET** `/api/v1/analytics/conversion-funnel`

Get conversion funnel metrics.

**Query Parameters:**
- `dateFrom` - Start date
- `dateTo` - End date
- `groupBy` - Group by: `day`, `week`, `month`

**Response:**
```json
{
  "period": {
    "from": "2026-06-01T00:00:00Z",
    "to": "2026-06-05T23:59:59Z"
  },
  "stages": [
    {
      "name": "Leads",
      "count": 500,
      "percentage": 100
    },
    {
      "name": "Qualified",
      "count": 350,
      "percentage": 70
    },
    {
      "name": "Proposal",
      "count": 100,
      "percentage": 20
    },
    {
      "name": "Customers",
      "count": 35,
      "percentage": 7
    }
  ],
  "conversionRate": 0.07
}
```

---

### 7.2 Get Team Performance
**GET** `/api/v1/analytics/team-performance`

Get team metrics and statistics.

**Query Parameters:**
- `dateFrom` - Start date
- `dateTo` - End date
- `departmentId` - Filter by department (optional)

**Response:**
```json
{
  "period": { "from": "2026-06-01", "to": "2026-06-05" },
  "team": [
    {
      "userId": "user-123",
      "name": "John Doe",
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

### 7.3 Get Response Time Analytics
**GET** `/api/v1/analytics/response-time`

Get response time metrics.

**Response:**
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

### 7.4 Create Custom Report
**POST** `/api/v1/analytics/custom`

Generate custom analytics report.

**Request Body:**
```json
{
  "name": "Q2 Sales Report",
  "metrics": ["revenue", "lead_count", "conversion_rate"],
  "dimensions": ["source", "assignedUser"],
  "dateFrom": "2026-04-01T00:00:00Z",
  "dateTo": "2026-06-30T23:59:59Z",
  "filters": [
    { "field": "status", "operator": "equals", "value": "customer" }
  ]
}
```

**Response:** 201
```json
{
  "id": "report-001",
  "name": "Q2 Sales Report",
  "status": "generating",
  "createdAt": "2026-06-05T17:35:00Z",
  "downloadUrl": "https://api.zalocrm.com/reports/report-001"
}
```

---

## 8. Team & Organization

### 8.1 List Users
**GET** `/api/v1/users`

List organization users.

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `role` - Filter by role
- `department` - Filter by department
- `status` - Filter: `active`, `inactive`

**Response:**
```json
{
  "data": [
    {
      "id": "user-123",
      "email": "john@acme.com",
      "fullName": "John Doe",
      "role": "admin",
      "department": "Sales",
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

### 8.2 Create User
**POST** `/api/v1/users`

Create new team member.

**Request Body:**
```json
{
  "email": "jane@acme.com",
  "fullName": "Jane Smith",
  "role": "agent",
  "department": "Support",
  "phone": "+84.9.yyyy.yyyy"
}
```

**Response:** 201
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

### 8.3 Update User
**PUT** `/api/v1/users/:id`

Update user information.

**Request Body:**
```json
{
  "fullName": "Jane Smith",
  "role": "team_lead",
  "department": "Sales"
}
```

**Response:** 200

---

### 8.4 Delete User
**DELETE** `/api/v1/users/:id`

Deactivate user.

**Response:** 204 No Content

---

### 8.5 List Teams
**GET** `/api/v1/teams`

List teams in organization.

**Response:**
```json
[
  {
    "id": "team-001",
    "name": "Sales Team",
    "description": "Direct sales team",
    "memberCount": 5,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 8.6 Create Team
**POST** `/api/v1/teams`

Create new team.

**Request Body:**
```json
{
  "name": "Enterprise Sales",
  "description": "Enterprise customer sales team",
  "memberIds": ["user-123", "user-124"]
}
```

**Response:** 201

---

## 9. RBAC & Permissions

### 9.1 List Departments
**GET** `/api/v1/departments`

List organization departments.

**Response:**
```json
[
  {
    "id": "dept-001",
    "name": "Sales",
    "description": "Sales department",
    "memberCount": 8,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 9.2 Create Department
**POST** `/api/v1/departments`

Create new department.

**Request Body:**
```json
{
  "name": "Marketing",
  "description": "Marketing and campaigns department"
}
```

**Response:** 201

---

## 10. Search

### 10.1 Global Search
**GET** `/api/v1/search`

Perform full-text search across contacts, messages, notes.

**Query Parameters:**
- `q` - Search query (required)
- `type` - Filter type: `contacts`, `messages`, `notes` (optional)
- `limit` - Results limit (default: 20)

**Response:**
```json
{
  "results": [
    {
      "id": "contact-001",
      "type": "contact",
      "title": "Nguyen Van A",
      "subtitle": "a@example.com",
      "url": "/contacts/contact-001"
    },
    {
      "id": "msg-001",
      "type": "message",
      "title": "Hello from Nguyen Van A",
      "subtitle": "in conversation with Zalo Official",
      "timestamp": "2026-06-05T16:45:00Z"
    }
  ]
}
```

---

## 11. Scoring & Lead Management

### 11.1 Get Scoring Configuration
**GET** `/api/v1/scoring/config`

Get lead scoring settings.

**Response:**
```json
{
  "orgId": "org-123",
  "scoringModel": "weighted",
  "baseScore": 0,
  "maxScore": 100,
  "rules": [
    {
      "id": "rule-001",
      "name": "Message Engagement",
      "weight": 0.3,
      "factor": 5
    }
  ],
  "decayRate": 0.01,
  "decayInterval": "daily"
}
```

---

### 11.2 List Scoring Rules
**GET** `/api/v1/scoring/rules`

List all scoring rules.

**Response:**
```json
[
  {
    "id": "rule-001",
    "name": "Message Received",
    "condition": "message_received",
    "points": 5,
    "weight": 0.3,
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 11.3 Get Contact Score
**GET** `/api/v1/contacts/:id/scores`

Get detailed score breakdown for contact.

**Response:**
```json
{
  "contactId": "contact-001",
  "totalScore": 85,
  "breakdown": [
    {
      "ruleName": "Message Engagement",
      "points": 35,
      "weight": 0.3
    },
    {
      "ruleName": "Appointment Attendance",
      "points": 25,
      "weight": 0.25
    }
  ],
  "lastUpdated": "2026-06-05T17:30:00Z"
}
```

---

## 12. Engagement

### 12.1 Get Engagement Heatmap
**GET** `/api/v1/engagement/heatmap`

Get team engagement heatmap.

**Query Parameters:**
- `dateFrom` - Start date
- `dateTo` - End date

**Response:**
```json
{
  "heatmap": [
    [0, 1, 2, 1, 3, 2, 1],
    [5, 6, 7, 8, 9, 10, 5],
    [15, 16, 17, 18, 19, 20, 15]
  ],
  "metadata": {
    "rows": ["00:00-08:00", "08:00-16:00", "16:00-24:00"],
    "columns": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  }
}
```

---

## 13. Activity & Timeline

### 13.1 Get Activity Timeline
**GET** `/api/v1/timeline`

Get organization activity timeline.

**Query Parameters:**
- `limit` - Number of activities (default: 50)
- `offset` - Pagination offset
- `type` - Filter by activity type

**Response:**
```json
{
  "activities": [
    {
      "id": "activity-001",
      "type": "contact_created",
      "actor": {
        "id": "user-123",
        "name": "John Doe"
      },
      "resource": {
        "type": "contact",
        "id": "contact-001",
        "title": "Nguyen Van A"
      },
      "description": "Created new contact",
      "timestamp": "2026-06-05T17:35:00Z"
    }
  ],
  "pagination": { "total": 1500, "limit": 50, "offset": 0 }
}
```

---

## 14. Notifications

### 14.1 List Notifications
**GET** `/api/v1/notifications`

Get user notifications.

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `unreadOnly` - Show only unread (default: false)

**Response:**
```json
{
  "data": [
    {
      "id": "notif-001",
      "type": "high_value_lead",
      "title": "High-Value Lead Created",
      "message": "Nguyen Van A - Score: 95",
      "resourceId": "contact-001",
      "read": false,
      "createdAt": "2026-06-05T17:35:00Z"
    }
  ],
  "unreadCount": 5
}
```

---

### 14.2 Mark Notification as Read
**POST** `/api/v1/notifications/:id/read`

Mark notification as read.

**Response:** 200
```json
{
  "message": "Notification marked as read"
}
```

---

## 15. Integrations

### 15.1 List Integrations
**GET** `/api/v1/integrations`

List available integrations.

**Response:**
```json
[
  {
    "id": "int-001",
    "type": "facebook",
    "name": "Facebook Lead Ads",
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

### 15.2 Facebook - Get Pages
**GET** `/api/v1/integrations/facebook/pages`

List connected Facebook pages.

**Response:**
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

### 15.3 Facebook - Sync Leads
**POST** `/api/v1/integrations/facebook/leads/sync`

Manually sync Facebook leads.

**Request Body:**
```json
{
  "pageId": "page-001",
  "formId": "form-001"
}
```

**Response:** 202
```json
{
  "syncId": "sync-001",
  "status": "processing",
  "estimatedCount": 50
}
```

---

## 16. AI & Assistant

### 16.1 Generate Reply Draft
**POST** `/api/v1/ai/reply-draft`

Generate AI-powered reply to message.

**Request Body:**
```json
{
  "conversationId": "conv-001",
  "messageId": "msg-001",
  "tone": "professional"
}
```

**Response:**
```json
{
  "draft": "Thank you for your inquiry! We'd be happy to help you with...",
  "confidence": 0.87
}
```

---

### 16.2 Generate Summary
**POST** `/api/v1/ai/summary`

Generate AI summary of conversation.

**Request Body:**
```json
{
  "conversationId": "conv-001"
}
```

**Response:**
```json
{
  "summary": "Customer inquired about premium plan pricing. Interested in features comparison with competitors.",
  "keyPoints": [
    "Interest in premium plan",
    "Wants feature comparison",
    "Budget around $500/month"
  ]
}
```

---

### 16.3 Analyze Sentiment
**POST** `/api/v1/ai/sentiment`

Analyze sentiment of message/conversation.

**Request Body:**
```json
{
  "text": "I'm really happy with your service! Great support team."
}
```

**Response:**
```json
{
  "sentiment": "positive",
  "score": 0.92,
  "emotions": ["happy", "satisfied"]
}
```

---

## 17. Branding

### 17.1 Get Branding Settings
**GET** `/api/v1/branding`

Get organization branding configuration.

**Response:**
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

### 17.2 Update Branding
**PUT** `/api/v1/branding`

Update branding settings.

**Request Body:**
```json
{
  "primaryColor": "#FF5722",
  "secondaryColor": "#2196F3"
}
```

**Response:** 200

---

## 18. Privacy & Security

### 18.1 Set Privacy PIN
**POST** `/api/v1/privacy/pin/set`

Set privacy PIN for sensitive data access.

**Request Body:**
```json
{
  "pin": "123456"
}
```

**Response:**
```json
{
  "message": "Privacy PIN set successfully"
}
```

---

### 18.2 Verify Privacy PIN
**POST** `/api/v1/privacy/pin/verify`

Verify privacy PIN before accessing sensitive data.

**Request Body:**
```json
{
  "pin": "123456"
}
```

**Response:**
```json
{
  "verified": true,
  "expiresIn": 3600
}
```

---

## 19. Public API & Webhooks

### 19.1 List Webhook Settings
**GET** `/api/v1/webhook-settings`

List configured webhooks.

**Response:**
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

### 19.2 Create Webhook
**POST** `/api/v1/webhook-settings`

Create new webhook.

**Request Body:**
```json
{
  "url": "https://your-app.com/webhooks/contacts",
  "events": ["contact.created", "contact.updated"],
  "secret": "your-webhook-secret"
}
```

**Response:** 201
```json
{
  "id": "webhook-002",
  "url": "https://your-app.com/webhooks/contacts",
  "active": true,
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 20. System

### 20.1 Health Check
**GET** `/health`

System health check.

**Response:**
```json
{
  "status": "ok",
  "db": "connected",
  "timestamp": "2026-06-05T17:35:00Z"
}
```

---

### 20.2 API Status
**GET** `/api/v1/status`

Get API version and status.

**Response:**
```json
{
  "version": "1.0.0",
  "name": "Zalo CRM",
  "status": "operational"
}
```

---

## WebSocket Events

### Connection
```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to server');
});
```

### Room Subscription
```javascript
// Subscribe to account events
socket.emit('subscribe', { room: 'account:acc-001' });

// Listen for QR code
socket.on('account:qr', (data) => {
  console.log('QR Code:', data.qr);
  displayQRCode(data.qr);
});

// Listen for login
socket.on('account:login', (data) => {
  console.log('Account logged in:', data);
});
```

### Message Events
```javascript
// Listen for new messages
socket.on('message:received', (data) => {
  console.log('New message:', data);
});

// Listen for typing indicator
socket.on('chat:typing', (data) => {
  console.log(data.senderName + ' is typing...');
});
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 202 | Accepted |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Unprocessable Entity |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 502 | Bad Gateway |
| 503 | Service Unavailable |

---

## Useful Links

- **GitHub Repository:** https://github.com/locphamnguyen/zalo-crm
- **Issue Tracker:** https://github.com/locphamnguyen/zalo-crm/issues
- **Discussions:** https://github.com/locphamnguyen/zalo-crm/discussions

---

*Generated on 2026-06-05 | Version 1.0.0*
