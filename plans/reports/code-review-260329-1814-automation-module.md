# Code Review: CRM Automation Module

**Branch:** `locphamnguyen/crm-automation`
**Reviewer:** code-reviewer
**Date:** 2026-03-29

## Scope

- **Backend (new):** `backend/src/modules/automation/` (8 files)
- **Backend (modified):** `message-handler.ts`, `contact-routes.ts`, `app.ts`, `schema.prisma`
- **Frontend (new):** `frontend/src/components/automation/` (4 files), 2 composables, 1 view
- **Frontend (modified):** `router/index.ts`, `DefaultLayout.vue`
- **LOC added:** ~750
- **Focus:** Security, correctness, code quality, performance

## Overall Assessment

Solid first pass. Clean module structure, proper org-scoping, role-based access on write endpoints. However, several security and correctness issues need attention before merge, primarily around input validation, cross-org authorization gaps in action handlers, and an infinite-loop risk in the automation engine.

---

## Critical Issues

### C1. Infinite automation loop via `update_status` action
**File:** `backend/src/modules/automation/actions/update-status-action.ts:3-8`
**File:** `backend/src/modules/contacts/contact-routes.ts:231-248`

The `status_changed` trigger in `contact-routes.ts:236` fires `runAutomationRules` when a contact's status changes. The `updateStatusAction` directly updates the contact status via Prisma, bypassing the route handler -- so it won't re-trigger. **However**, if a future code path (e.g., webhook, another module) detects the DB change and fires `status_changed`, an infinite loop results. The `initiatedByAutomation` guard on line `automation-service.ts:33` exists but is **never set to `true`** by any caller. All three call sites (`message-handler.ts:114`, `contact-routes.ts:169`, `contact-routes.ts:236`) omit `initiatedByAutomation`.

**Impact:** Latent infinite loop risk. Currently safe only because actions write directly to DB without re-triggering. One refactor away from a production incident.

**Recommendation:** Always pass `initiatedByAutomation: true` when `runAutomationRules` could be triggered by an action's side effect -- or better, set it inside `executeAction` before calling sub-actions. Also add a max-recursion-depth guard.

### C2. No input validation on rule/template creation -- stored XSS and arbitrary JSON injection
**File:** `backend/src/modules/automation/automation-routes.ts:23-35`
**File:** `backend/src/modules/automation/template-routes.ts:23-33`

`body.name`, `body.description`, `body.content`, `body.trigger`, and the entire `conditions`/`actions` JSON arrays are stored without any validation or sanitization.

- `body.trigger` accepts any string -- not constrained to `message_received | contact_created | status_changed`. An attacker (admin-level) can store arbitrary trigger values that will never match but pollute the DB.
- `body.conditions` and `body.actions` are stored as raw JSON. Malformed structures (e.g., `{ "type": "send_template", "templateId": "../../etc" }`) pass through unchecked.
- `body.name` / `body.content` are stored raw. If rendered in admin UI without escaping, stored XSS is possible. Vue's `{{ }}` interpolation escapes by default, so the current frontend is safe, but API consumers or future `v-html` usage would be vulnerable.

**Impact:** No Fastify schema validation means the API accepts any shape of body. Could lead to runtime errors in the automation engine when malformed actions are executed.

**Recommendation:** Add Fastify JSON schema validation (`schema: { body: { ... } }`) for all POST/PUT routes. Validate `trigger` against an enum. Validate `conditions` and `actions` array items against discriminated union schemas. Sanitize `name`/`content` strings (max length, strip control characters).

### C3. Cross-org authorization bypass in `assignUserAction`
**File:** `backend/src/modules/automation/actions/assign-user-action.ts:3-8`

`assignUserAction(contactId, userId)` calls `prisma.contact.update({ where: { id: contactId }, data: { assignedUserId: userId } })` without verifying that `userId` belongs to the same org as the contact. An admin crafting a rule with `{ type: "assign_user", userId: "<user-from-another-org>" }` would succeed silently.

**Impact:** Cross-org data leak -- a contact could be assigned to a user in a different organization, making it visible in that user's assigned contacts list.

**Recommendation:** Either validate `userId` belongs to `context.orgId` inside the action, or validate at rule-creation time in the route handler.

### C4. Cross-org template access in `sendTemplateAction`
**File:** `backend/src/modules/automation/actions/send-template-action.ts:21-24`

`prisma.messageTemplate.findUnique({ where: { id: input.templateId } })` does not filter by `orgId`. If a rule is crafted with a `templateId` from another org (UUIDs are guessable if sequential or leaked), it will render and send that org's template content.

**Impact:** Cross-org information disclosure -- template content from another organization could be sent to a contact.

**Recommendation:** Add `orgId` to the template lookup query, either by passing it through from the automation context or by joining with the rule's org.

---

## High Priority

### H1. Fire-and-forget automation with no error visibility
**File:** `backend/src/modules/chat/message-handler.ts:114`
**File:** `backend/src/modules/contacts/contact-routes.ts:169,236`

All three call sites use `void runAutomationRules(...)` -- fire-and-forget with no error propagation. Combined with the generic `logger.error` in `automation-service.ts:55`, there's no way for users to know if their rules are failing.

**Recommendation:** Log failed rule executions to an `automation_execution_log` table or at minimum include `rule.id` and `rule.name` in the error log. Consider adding a `lastError` / `lastErrorAt` field to `AutomationRule`.

### H2. `runCount` increment races under concurrent messages
**File:** `backend/src/modules/automation/automation-service.ts:50-53`

When multiple messages arrive simultaneously for the same org, the same rule may execute concurrently. The `runCount: { increment: 1 }` is safe at the Prisma/Postgres level (atomic increment), but `lastRunAt` could be set out-of-order. Acceptable for now but worth documenting.

### H3. No pagination on `GET /api/v1/automation/rules` and `GET /api/v1/automation/templates`
**File:** `backend/src/modules/automation/automation-routes.ts:13-17`
**File:** `backend/src/modules/automation/template-routes.ts:13-17`

Both endpoints return all records for an org with no pagination. For orgs with hundreds of rules/templates, this becomes a performance issue.

**Recommendation:** Add `take`/`skip` or cursor pagination, consistent with how `contact-routes.ts` handles it.

### H4. Missing `name` required validation on frontend form
**File:** `frontend/src/components/automation/RuleBuilder.vue:94-105`

The `submit` function emits the payload without validating that `localRule.name` is non-empty. The backend also doesn't validate, so empty-named rules can be created.

**File:** `frontend/src/components/automation/TemplateManager.vue:83-91`

Same issue -- `form.name` and `form.content` are not validated before emit.

**Recommendation:** Add `:rules` validation to `v-text-field` for required fields, and add backend schema validation.

---

## Medium Priority

### M1. `body as Record<string, any>` pattern bypasses TypeScript safety
**File:** `backend/src/modules/automation/automation-routes.ts:23`
**File:** `backend/src/modules/automation/template-routes.ts:23,44`

Every route handler casts `request.body as Record<string, any>`, losing all type safety. This is consistent with existing codebase patterns (`contact-routes.ts:144`) but is a tech-debt multiplier.

**Recommendation:** Define typed body interfaces and use Fastify schema validation to enforce them at runtime.

### M2. Template renderer silently swallows unknown variables
**File:** `backend/src/modules/automation/template-renderer.ts:16-19`

`{{ unknownVar }}` is replaced with empty string silently. Users won't know they made a typo in a template variable.

**Recommendation:** Consider logging a warning or returning the original token `{{ unknownVar }}` so the user sees it in the sent message and can correct the template.

### M3. Shallow copy of conditions/actions in RuleBuilder watch
**File:** `frontend/src/components/automation/RuleBuilder.vue:88-89`

`[...rule.conditions]` creates a shallow copy. If condition objects are later mutated in-place (they shouldn't be with the current immutable update pattern in ConditionEditor), this could cause unexpected bugs.

### M4. `TemplateManager` emits `update` with positional args
**File:** `frontend/src/components/automation/TemplateManager.vue:86`

`emit('update', form.id, payload)` passes two arguments. The parent `AutomationView.vue:44` binds `@update="updateTemplate"` which calls `api.put(\`/automation/templates/${id}\`, payload)`. This works but is fragile -- if the composable signature changes, it will silently break. Prefer emitting a single object `{ id, ...payload }`.

### M5. No delete confirmation dialog
**File:** `frontend/src/views/AutomationView.vue:30,140-142`
**File:** `frontend/src/components/automation/TemplateManager.vue:17,93-95`

Delete buttons trigger immediate deletion with no confirmation. A misclick deletes a rule/template permanently.

---

## Low Priority

### L1. Inconsistent `id` generation pattern
**File:** `backend/src/modules/automation/automation-routes.ts:26`

`id: randomUUID()` is manually generated in the route handler. The Prisma schema has `@default(uuid())`, so this is redundant. Not harmful, but inconsistent -- other models (e.g., `Contact` in `contact-routes.ts:146`) rely on Prisma's default.

### L2. `contact-routes.ts:226` ternary is redundant
**File:** `backend/src/modules/chat/message-handler.ts:226`

`contactId: msg.threadType === 'user' ? contactId : contactId` -- both branches return the same value.

### L3. Missing `@@map` for some fields in new models
**File:** `backend/prisma/schema.prisma:263`

`enabled`, `priority`, `name`, `content`, `category` fields lack `@map()` annotations for snake_case DB column names. The existing codebase uses `@map` consistently for multi-word fields but not single-word ones, so this is consistent. Just noting for awareness.

### L4. `ActionEditor` hardcodes status values
**File:** `frontend/src/components/automation/ActionEditor.vue:94-100`

Status items (`new`, `contacted`, `interested`, `converted`, `lost`) are duplicated here and implicitly in the backend. Should be a shared constant.

---

## Positive Observations

1. **Proper org scoping** -- All route queries filter by `user.orgId`, preventing cross-org data access at the API level
2. **Role-based access** -- Write endpoints correctly use `requireRole('owner', 'admin')`
3. **Clean module structure** -- Actions are separated into individual files, single responsibility
4. **Good Prisma indexing** -- Composite index `@@index([orgId, trigger, enabled, priority])` on `AutomationRule` matches the query pattern
5. **Rate limiter check** in `sendTemplateAction` prevents Zalo API abuse
6. **Template variable system** is extensible and safe (regex-based, whitelist approach)
7. **Frontend composables** follow Vue 3 composition API patterns cleanly, with proper loading/saving states

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Add `orgId` filter to `sendTemplateAction` template lookup (C4)
2. **[CRITICAL]** Add `orgId` validation to `assignUserAction` -- verify userId belongs to same org (C3)
3. **[CRITICAL]** Add Fastify body schema validation for all POST/PUT automation endpoints (C2)
4. **[CRITICAL]** Wire up `initiatedByAutomation` flag or add recursion-depth guard (C1)
5. **[HIGH]** Add execution logging or `lastError` field for rule debugging (H1)
6. **[HIGH]** Add required field validation on frontend forms (H4)
7. **[MEDIUM]** Add pagination to list endpoints (H3)
8. **[MEDIUM]** Add delete confirmation dialogs (M5)

---

## Metrics

- **Type Coverage:** Moderate -- action handlers are typed but route bodies use `Record<string, any>`
- **Test Coverage:** 0% -- no tests for the automation module
- **Linting Issues:** Unable to run linter (Bash not available), but no obvious syntax errors on visual inspection
- **Schema Validation:** None -- no Fastify JSON schema on any automation endpoint

---

## Unresolved Questions

1. Should `status_changed` also fire when automation itself changes a contact's status? If yes, C1 becomes a blocking bug. If no, the current design is intentionally safe but fragile.
2. Is there a plan for automation execution history/audit log? Currently there is no way for admins to see what rules ran, when, or if they failed.
3. Should the `GET /api/v1/automation/rules` endpoint be accessible to `member` role, or should it be restricted to `owner`/`admin`? Currently any authenticated user can list all rules in their org.
