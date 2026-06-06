# Complete API Inventory - Zalo CRM

Generated: 2026-06-05 17:32

## Overview
This document contains a comprehensive list of all HTTP API endpoints available in the Zalo CRM system. The backend uses Fastify framework and is organized into modular route handlers.

---

## 1. Authentication & Setup APIs
**Module:** `backend/src/modules/auth/`

### Endpoints

| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/setup/status` | Check if first-run setup is needed | No |
| POST | `/api/v1/setup` | Create organization + owner user, return JWT | No |
| POST | `/api/v1/auth/login` | Verify credentials and return JWT token | No |
| GET | `/api/v1/profile` | Get current user profile | Yes |

---

## 2. Zalo Account Management APIs
**Module:** `backend/src/modules/zalo/`

### Zalo Accounts
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/zalo-accounts` | List all Zalo accounts with live status | Yes |
| POST | `/api/v1/zalo-accounts` | Create new Zalo account record | Yes |
| POST | `/api/v1/zalo-accounts/:id/login` | Initiate QR code login | Yes |
| POST | `/api/v1/zalo-accounts/:id/reconnect` | Force reconnect using saved session | Yes |
| DELETE | `/api/v1/zalo-accounts/:id` | Archive or purge Zalo account | Yes |
| GET | `/api/v1/zalo-accounts/:id/status` | Get live status of account | Yes |
| PUT | `/api/v1/zalo-accounts/:id/proxy` | Update proxy configuration | Yes |

### Zalo Sync
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| POST | `/api/v1/zalo-sync/friends/:id` | Sync friends list for account | Yes |
| POST | `/api/v1/zalo-sync/groups/:id` | Sync groups list for account | Yes |

### Zalo Dashboard
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/dashboard/zalo` | Get Zalo dashboard statistics | Yes |

### Zalo Labels
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/zalo-labels` | List all labels | Yes |
| POST | `/api/v1/zalo-labels` | Create new label | Yes |
| PUT | `/api/v1/zalo-labels/:id` | Update label | Yes |
| DELETE | `/api/v1/zalo-labels/:id` | Delete label | Yes |

### Zalo Access Control
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/zalo-access` | List account access permissions | Yes |
| POST | `/api/v1/zalo-access` | Grant access to account | Yes |
| PUT | `/api/v1/zalo-access/:id` | Update access permission | Yes |
| DELETE | `/api/v1/zalo-access/:id` | Revoke access | Yes |

### Friends Management
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/friends` | List friends for accounts | Yes |
| GET | `/api/v1/friends/:id` | Get friend details | Yes |

### Groups Management
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/groups` | List groups | Yes |
| GET | `/api/v1/groups/:id` | Get group details | Yes |

### Group Moderation
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| POST | `/api/v1/group-moderation/members/:id` | Manage group members | Yes |
| POST | `/api/v1/group-moderation/settings/:id` | Update group settings | Yes |

### Zalo Profile
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/profile/:id` | Get Zalo profile details | Yes |
| PUT | `/api/v1/profile/:id` | Update Zalo profile | Yes |

### Zalo Credentials
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/zalo-credentials` | List stored Zalo credentials | Yes |
| POST | `/api/v1/zalo-credentials` | Create new credential | Yes |
| DELETE | `/api/v1/zalo-credentials/:id` | Delete credential | Yes |

---

## 3. Chat & Messaging APIs
**Module:** `backend/src/modules/chat/`

### Messages
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/chat/messages` | List messages | Yes |
| POST | `/api/v1/chat/messages` | Send message | Yes |
| GET | `/api/v1/chat/messages/:id` | Get message details | Yes |
| PUT | `/api/v1/chat/messages/:id` | Update message | Yes |
| DELETE | `/api/v1/chat/messages/:id` | Delete message | Yes |

### Chat Threads
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/chat/threads` | List chat threads | Yes |
| POST | `/api/v1/chat/threads` | Create new thread | Yes |
| GET | `/api/v1/chat/threads/:id` | Get thread details | Yes |

### Chat Folders
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/chat/folders` | List chat folders | Yes |
| POST | `/api/v1/chat/folders` | Create folder | Yes |
| PUT | `/api/v1/chat/folders/:id` | Update folder | Yes |
| DELETE | `/api/v1/chat/folders/:id` | Delete folder | Yes |

### Chat Attachments
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| POST | `/api/v1/chat/attachments` | Upload attachment | Yes |
| GET | `/api/v1/chat/attachments/:id` | Get attachment | Yes |
| DELETE | `/api/v1/chat/attachments/:id` | Delete attachment | Yes |

### Chat Presets
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/chat/presets` | List message presets | Yes |
| POST | `/api/v1/chat/presets` | Create preset | Yes |
| PUT | `/api/v1/chat/presets/:id` | Update preset | Yes |
| DELETE | `/api/v1/chat/presets/:id` | Delete preset | Yes |

### Chat Operations
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| POST | `/api/v1/chat/operations/read` | Mark message as read | Yes |
| POST | `/api/v1/chat/operations/archive` | Archive conversation | Yes |
| POST | `/api/v1/chat/operations/unarchive` | Restore conversation | Yes |

---

## 4. Contacts & CRM APIs
**Module:** `backend/src/modules/contacts/`

### Contacts
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/contacts` | List contacts | Yes |
| POST | `/api/v1/contacts` | Create new contact | Yes |
| GET | `/api/v1/contacts/:id` | Get contact details | Yes |
| PUT | `/api/v1/contacts/:id` | Update contact | Yes |
| DELETE | `/api/v1/contacts/:id` | Delete contact | Yes |

### Contact Sub-Resources
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/contacts/:id/friends` | Get contact's friends/connections | Yes |
| GET | `/api/v1/contacts/:id/parent-candidates` | Get parent candidate contacts | Yes |

### Appointments
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/appointments` | List appointments | Yes |
| POST | `/api/v1/appointments` | Create appointment | Yes |
| GET | `/api/v1/appointments/:id` | Get appointment details | Yes |
| PUT | `/api/v1/appointments/:id` | Update appointment | Yes |
| DELETE | `/api/v1/appointments/:id` | Delete appointment | Yes |

### Contact Status
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/contact-status` | List contact statuses | Yes |
| POST | `/api/v1/contact-status` | Create status | Yes |
| PUT | `/api/v1/contact-status/:id` | Update status | Yes |
| DELETE | `/api/v1/contact-status/:id` | Delete status | Yes |

### Contact Notes
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/contacts/:id/notes` | List contact notes | Yes |
| POST | `/api/v1/contacts/:id/notes` | Add note to contact | Yes |
| PUT | `/api/v1/contacts/:id/notes/:noteId` | Update note | Yes |
| DELETE | `/api/v1/contacts/:id/notes/:noteId` | Delete note | Yes |

### CRM Tags
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/crm-tags` | List tags | Yes |
| POST | `/api/v1/crm-tags` | Create tag | Yes |
| PUT | `/api/v1/crm-tags/:id` | Update tag | Yes |
| DELETE | `/api/v1/crm-tags/:id` | Delete tag | Yes |

### CRM Tag Groups
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/crm-tag-groups` | List tag groups | Yes |
| POST | `/api/v1/crm-tag-groups` | Create tag group | Yes |
| PUT | `/api/v1/crm-tag-groups/:id` | Update tag group | Yes |
| DELETE | `/api/v1/crm-tag-groups/:id` | Delete tag group | Yes |

### ZInstant Integration
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/zinstant/contacts` | Proxy ZInstant contacts | Yes |
| POST | `/api/v1/zinstant/sync` | Sync with ZInstant | Yes |

---

## 5. Automation & Marketing APIs
**Module:** `backend/src/modules/automation/`

### Automation Rules
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/rules` | List automation rules | Yes |
| POST | `/api/v1/automation/rules` | Create automation rule | Yes |
| PUT | `/api/v1/automation/rules/:id` | Update rule | Yes |
| DELETE | `/api/v1/automation/rules/:id` | Delete rule | Yes |

### Automation Templates
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/templates` | List message templates | Yes |
| POST | `/api/v1/automation/templates` | Create template | Yes |
| PUT | `/api/v1/automation/templates/:id` | Update template | Yes |
| DELETE | `/api/v1/automation/templates/:id` | Delete template | Yes |

### Automation Blocks
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/blocks` | List automation blocks | Yes |
| POST | `/api/v1/automation/blocks` | Create block | Yes |
| GET | `/api/v1/automation/blocks/:id` | Get block details | Yes |
| PUT | `/api/v1/automation/blocks/:id` | Update block | Yes |
| DELETE | `/api/v1/automation/blocks/:id` | Delete block | Yes |

### Automation Block Folders
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/block-folders` | List block folders | Yes |
| POST | `/api/v1/automation/block-folders` | Create folder | Yes |
| PUT | `/api/v1/automation/block-folders/:id` | Update folder | Yes |
| DELETE | `/api/v1/automation/block-folders/:id` | Delete folder | Yes |

### Automation Sequences
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/sequences` | List sequences | Yes |
| POST | `/api/v1/automation/sequences` | Create sequence | Yes |
| GET | `/api/v1/automation/sequences/:id` | Get sequence details | Yes |
| PUT | `/api/v1/automation/sequences/:id` | Update sequence | Yes |
| DELETE | `/api/v1/automation/sequences/:id` | Delete sequence | Yes |

### Automation Triggers
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/triggers` | List triggers | Yes |
| POST | `/api/v1/automation/triggers` | Create trigger | Yes |
| GET | `/api/v1/automation/triggers/:id` | Get trigger details | Yes |
| PUT | `/api/v1/automation/triggers/:id` | Update trigger | Yes |
| DELETE | `/api/v1/automation/triggers/:id` | Delete trigger | Yes |

### Automation Broadcasts
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/broadcasts` | List broadcasts | Yes |
| POST | `/api/v1/automation/broadcasts` | Create broadcast | Yes |
| GET | `/api/v1/automation/broadcasts/:id` | Get broadcast details | Yes |
| PUT | `/api/v1/automation/broadcasts/:id` | Update broadcast | Yes |
| DELETE | `/api/v1/automation/broadcasts/:id` | Delete broadcast | Yes |

### Automation Webhooks
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/automation/webhooks` | List webhooks | Yes |
| POST | `/api/v1/automation/webhooks` | Create webhook | Yes |
| PUT | `/api/v1/automation/webhooks/:id` | Update webhook | Yes |
| DELETE | `/api/v1/automation/webhooks/:id` | Delete webhook | Yes |

### Customer Lists
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/customer-lists` | List customer lists | Yes |
| POST | `/api/v1/customer-lists` | Create customer list | Yes |
| GET | `/api/v1/customer-lists/:id` | Get list details | Yes |
| PUT | `/api/v1/customer-lists/:id` | Update list | Yes |
| DELETE | `/api/v1/customer-lists/:id` | Delete list | Yes |

### Customer List Entries
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/customer-lists/:id/entries` | List entries in customer list | Yes |
| POST | `/api/v1/customer-lists/:id/entries` | Add entry to list | Yes |
| DELETE | `/api/v1/customer-lists/:id/entries/:entryId` | Remove entry from list | Yes |

### Campaigns
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/campaigns` | List campaigns | Yes |
| POST | `/api/v1/campaigns` | Create campaign | Yes |
| GET | `/api/v1/campaigns/:id` | Get campaign details | Yes |
| PUT | `/api/v1/campaigns/:id` | Update campaign | Yes |
| DELETE | `/api/v1/campaigns/:id` | Delete campaign | Yes |

---

## 6. Analytics & Reporting APIs
**Module:** `backend/src/modules/analytics/`

### Analytics Reports
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/analytics/conversion-funnel` | Get conversion funnel report | Yes |
| GET | `/api/v1/analytics/team-performance` | Get team performance report | Yes |
| GET | `/api/v1/analytics/response-time` | Get response time analytics | Yes |
| POST | `/api/v1/analytics/custom` | Create custom analytics report | Yes |

### Saved Reports
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/saved-reports` | List saved reports | Yes |
| POST | `/api/v1/saved-reports` | Save report | Yes |
| GET | `/api/v1/saved-reports/:id` | Get saved report details | Yes |
| PUT | `/api/v1/saved-reports/:id` | Update saved report | Yes |
| DELETE | `/api/v1/saved-reports/:id` | Delete saved report | Yes |

---

## 7. Dashboard APIs
**Module:** `backend/src/modules/dashboard/`

### Dashboard
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/dashboard` | Get main dashboard data | Yes |

### Dashboard Reports
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/dashboard/reports` | Get dashboard reports | Yes |
| POST | `/api/v1/dashboard/reports` | Create dashboard report | Yes |
| PUT | `/api/v1/dashboard/reports/:id` | Update dashboard report | Yes |
| DELETE | `/api/v1/dashboard/reports/:id` | Delete dashboard report | Yes |

---

## 8. Team & Organization APIs
**Module:** `backend/src/modules/auth/`

### Users
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/users` | List users in organization | Yes |
| POST | `/api/v1/users` | Create new user | Yes |
| GET | `/api/v1/users/:id` | Get user details | Yes |
| PUT | `/api/v1/users/:id` | Update user | Yes |
| DELETE | `/api/v1/users/:id` | Delete user | Yes |

### Teams
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/teams` | List teams | Yes |
| POST | `/api/v1/teams` | Create team | Yes |
| GET | `/api/v1/teams/:id` | Get team details | Yes |
| PUT | `/api/v1/teams/:id` | Update team | Yes |
| DELETE | `/api/v1/teams/:id` | Delete team | Yes |

### Organizations
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/orgs` | Get organization details | Yes |
| PUT | `/api/v1/orgs/:id` | Update organization | Yes |

### User Preferences
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/user-preferences` | Get user preferences | Yes |
| PUT | `/api/v1/user-preferences` | Update user preferences | Yes |

---

## 9. RBAC & Permissions APIs
**Module:** `backend/src/modules/rbac/`

### Departments
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/departments` | List departments | Yes |
| POST | `/api/v1/departments` | Create department | Yes |
| GET | `/api/v1/departments/:id` | Get department details | Yes |
| PUT | `/api/v1/departments/:id` | Update department | Yes |
| DELETE | `/api/v1/departments/:id` | Delete department | Yes |

### Permission Groups
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/permission-groups` | List permission groups | Yes |
| POST | `/api/v1/permission-groups` | Create permission group | Yes |
| PUT | `/api/v1/permission-groups/:id` | Update permission group | Yes |
| DELETE | `/api/v1/permission-groups/:id` | Delete permission group | Yes |

### User Assignments
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/user-assignments` | List user assignments | Yes |
| POST | `/api/v1/user-assignments` | Create user assignment | Yes |
| PUT | `/api/v1/user-assignments/:id` | Update assignment | Yes |
| DELETE | `/api/v1/user-assignments/:id` | Delete assignment | Yes |

---

## 10. Search APIs
**Module:** `backend/src/modules/search/`

### Global Search
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/search` | Global full-text search | Yes |
| POST | `/api/v1/search/index` | Reindex search database | Yes |

---

## 11. Scoring & Lead Scoring APIs
**Module:** `backend/src/modules/scoring/`

### Scoring Configuration
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/scoring/config` | Get scoring configuration | Yes |
| POST | `/api/v1/scoring/config` | Create/update scoring config | Yes |

### Scoring Rules
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/scoring/rules` | List scoring rules | Yes |
| POST | `/api/v1/scoring/rules` | Create scoring rule | Yes |
| PUT | `/api/v1/scoring/rules/:id` | Update scoring rule | Yes |
| DELETE | `/api/v1/scoring/rules/:id` | Delete scoring rule | Yes |

### Contact Scores
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/contacts/:id/scores` | Get contact's score | Yes |

---

## 12. Engagement APIs
**Module:** `backend/src/modules/engagement/`

### Engagement Heatmap
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/engagement/heatmap` | Get engagement heatmap | Yes |
| GET | `/api/v1/engagement/heatmap/:id` | Get contact engagement heatmap | Yes |

---

## 13. Activity Timeline APIs
**Module:** `backend/src/modules/activity/`

### Timeline
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/timeline` | Get activity timeline | Yes |
| GET | `/api/v1/timeline/:id` | Get resource activity timeline | Yes |

---

## 14. Notifications APIs
**Module:** `backend/src/modules/notifications/`

### Notifications
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/notifications` | List notifications | Yes |
| POST | `/api/v1/notifications/:id/read` | Mark notification as read | Yes |
| DELETE | `/api/v1/notifications/:id` | Delete notification | Yes |

---

## 15. Integrations APIs
**Module:** `backend/src/modules/integrations/`

### Integrations
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/integrations` | List integrations | Yes |
| POST | `/api/v1/integrations` | Create integration | Yes |
| GET | `/api/v1/integrations/:id` | Get integration details | Yes |
| PUT | `/api/v1/integrations/:id` | Update integration | Yes |
| DELETE | `/api/v1/integrations/:id` | Delete integration | Yes |

### Facebook Integration
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/integrations/facebook/pages` | List Facebook pages | Yes |
| GET | `/api/v1/integrations/facebook/forms` | List Facebook forms | Yes |
| POST | `/api/v1/integrations/facebook/leads` | Sync Facebook leads | Yes |
| POST | `/api/v1/integrations/facebook/connect` | Connect Facebook account | Yes |

---

## 16. AI & Assistant APIs
**Module:** `backend/src/modules/ai/`

### AI Services
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| POST | `/api/v1/ai/reply-draft` | Generate AI reply draft | Yes |
| POST | `/api/v1/ai/summary` | Generate AI summary | Yes |
| POST | `/api/v1/ai/sentiment` | Analyze sentiment | Yes |

---

## 17. Branding APIs
**Module:** `backend/src/modules/branding/`

### Branding
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/branding` | Get branding configuration | Yes |
| PUT | `/api/v1/branding` | Update branding | Yes |

---

## 18. Privacy & Security APIs
**Module:** `backend/src/modules/privacy/`

### Privacy PIN
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| POST | `/api/v1/privacy/pin/verify` | Verify privacy PIN | Yes |
| POST | `/api/v1/privacy/pin/set` | Set privacy PIN | Yes |
| DELETE | `/api/v1/privacy/pin` | Remove privacy PIN | Yes |

---

## 19. Public API & Webhooks
**Module:** `backend/src/modules/api/`

### Public API
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/public/contacts` | Public contacts API | API Key |
| POST | `/api/v1/public/contacts` | Public create contact | API Key |

### Webhook Settings
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/webhook-settings` | Get webhook settings | Yes |
| POST | `/api/v1/webhook-settings` | Create webhook | Yes |
| PUT | `/api/v1/webhook-settings/:id` | Update webhook | Yes |
| DELETE | `/api/v1/webhook-settings/:id` | Delete webhook | Yes |

---

## 20. System APIs

### Health Check
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/health` | Health check endpoint | No |

### API Status
| Method | Path | Description | Auth Required |
|--------|------|-------------|---|
| GET | `/api/v1/status` | Get API version and status | No |

---

## Socket.IO Events

The system uses Socket.IO for real-time communication. Key event handlers:

### Zalo Events
- `account:qr` - QR code generated
- `account:login` - Account login event
- `account:disconnect` - Account disconnected
- `message:received` - New message received
- `friend:updated` - Friend profile updated
- `group:message` - Group message received

### Chat Events
- `chat:message` - New chat message
- `chat:read` - Message read
- `chat:typing` - User typing indicator

---

## Rate Limiting

- **Global Rate Limit:** 500 requests per minute
- **Exclusions:** Static assets (not rate-limited)
- **API routes:** All `/api/*` routes subject to rate limiting

---

## Authentication

- **JWT-based authentication** with Bearer token in Authorization header
- **Token expiration:** 7 days
- **Optional auth:** Routes without auth middleware return 401 if user not provided
- **Global auth hook:** Automatic JWT verification on all requests

---

## Error Handling

- **401 Unauthorized** - Missing or invalid authentication
- **403 Forbidden** - Insufficient permissions
- **404 Not Found** - Resource not found
- **400 Bad Request** - Invalid request payload
- **500 Internal Server Error** - Server error

---

## Total API Count
- **Total Endpoints:** 200+
- **Authentication-required:** 190+
- **Public Endpoints:** 10-15

---

*Last Updated: 2026-06-05*
