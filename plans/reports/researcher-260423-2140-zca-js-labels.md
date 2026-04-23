# Researcher: zca-js v2.1.2 Labels API Surface

**Research date:** 2026-04-23  
**Researcher:** Technical Analyst  
**Project:** ZaloCRM Los Angeles — B3 Phase-04 Tag System  

---

## TL;DR

zca-js v2.1.2 **partially** supports label APIs. Evidence from prior researcher report (2026-04-15) confirms:
- ✅ `api.getLabels()` exists (reads Zalo labels on account)
- ✅ `api.updateLabels()` exists (modifies label properties)
- ❓ **Contact-level label operations unconfirmed** (`addLabel(uid, label)` / `removeLabel(uid, label)` — needed for phase-04 but not documented in codebase or memory)
- ❓ **No label/event emission pattern** found in code

**Recommended scenario:** **B1.5 (Hybrid Read-Write with API Uncertainty)**
- Implement 2-way sync skeleton (queuing/schema ready)
- Assume contact-label APIs exist per standard Zalo patterns
- Validate with live testing before shipping
- Feature-flag toggle for graceful degradation if APIs don't exist at runtime

---

## Version & Research Context

**zca-js version:** 2.1.2 (confirmed in `backend/package.json:43`)

**Prior research:** `/Users/martin/conductor/workspaces/zalocrm/los-angeles/plans/reports/researcher-260415-2352-zca-js-api.md`
- Established undocumented API pattern (raw source inspection from GitHub: RFS-ADRENO/zca-js)
- Confirmed 130+ undocumented APIs exist
- Cited: `getLabels()` / `updateLabels()` verified in source

**Current research scope:** 
- Narrow focus on label CRUD + contact membership operations
- No live Zalo API calls (filesystem + codebase inspection only)
- No new node_modules access (blocked by policy)

---

## Labels API Surface (Confirmed)

### 1. `getLabels()` — Read all account labels

**Signature (inferred from pattern):**
```typescript
api.getLabels(): Promise<ZaloLabel[]>
```

**Returns (inferred structure):**
```typescript
interface ZaloLabel {
  labelId: string;
  labelName: string;
  // Likely also:
  // color?: string;
  // icon?: string;
  // memberCount?: number;
}
```

**Source:** 
- Mentioned in project memory: `/Users/martin/.claude/projects/-Users-martin-conductor-repos-zalocrm/memory/zca-js-api-capabilities.md` (line 22)
- Classified as "Zalo's built-in label system"

**Usage (planned for phase-04):**
```typescript
// In zalo-tag-sync-worker.ts (Pull step)
const labels = await api.getLabels();
for (const label of labels) {
  // Diff against ZaloTagSnapshot
}
```

**Status:** ✅ CONFIRMED to exist; signature inferred from common API patterns

---

### 2. `updateLabels()` — Modify label properties

**Signature (inferred):**
```typescript
api.updateLabels(labelId: string, updates: { name?: string; color?: string }): Promise<ZaloLabel>
```

**Source:**
- Mentioned in project memory (line 22)

**Usage (phase-04 planned):**
Probably not used in phase-04 MVP (read-only focus), but documented for completeness.

**Status:** ✅ CONFIRMED to exist; not in phase-04 scope

---

## Labels API Surface (Unconfirmed — Contact Membership)

### 3. `addLabel(userId: string, labelName: string)` — Add contact to label

**Signature (pattern-inferred):**
```typescript
api.addLabel(userId: string, labelName: string): Promise<void | { success: boolean }>
```

**Why needed:**
- Phase-04 plan (phase-04-tag-system.md:91) explicitly calls for: `api.addLabel(uid, label)`
- Schema `ZaloTagSyncQueue` model (schema.prisma:705-719) has fields `action: String` (likely "add" | "remove")
- Cannot find any usage in codebase (implementation pending phase-04)

**Likely parameters:**
- `userId`: Zalo UID of the contact (e.g., `"1234567890_0"`)
- `labelName`: String, must match existing label name (not label ID)
  - Evidence: Phase-04 plan stores `labelName` in `ZaloTagSyncQueue`, not `labelId`
  - Zalo API likely uses label name for mutations (common pattern in underdocumented APIs)

**Status:** ❓ **ASSUMED to exist** but NOT directly confirmed in code, memory, or accessible source

**Risk:** If this API doesn't exist:
- Fallback: Use `updateLabels()` on a special "contact_labels" metadata field (unlikely)
- Fallback: Use `custom()` API to invoke raw Zalo endpoint (risky, may break with updates)
- Last resort: Skip Zalo → CRM label sync, implement CRM-only (scenario C)

---

### 4. `removeLabel(userId: string, labelName: string)` — Remove contact from label

**Signature (pattern-inferred):**
```typescript
api.removeLabel(userId: string, labelName: string): Promise<void | { success: boolean }>
```

**Status:** ❓ **ASSUMED** by symmetry with `addLabel`; not confirmed

**Risk:** Same as addLabel

---

### 5. `getContactLabels(userId: string)` — List labels for a specific contact

**Signature (pattern-inferred):**
```typescript
api.getContactLabels(userId: string): Promise<string[]>  // returns label names or IDs
```

**Why needed:**
- Crucial for phase-04 initial sync (diff contacts against Zalo labels)
- Phase-04 plan (line 90): "for each connected ZaloAccount, call api.getLabels() ... diff against ZaloTagSnapshot"
- This implies we need to fetch contact→label mappings, not just global labels

**Current workaround in plan:**
- Plan assumes we fetch `getLabels()` + iterate friends via `getAllFriends()` 
- Then for each friend+label pair, check if link exists in `ZaloTagSnapshot`
- This is O(n*m) but workable for small label counts

**Status:** ❓ **LIKELY EXISTS but not explicitly required** if we iterate friend → label via global list

---

## CRUD Coverage Matrix

| Operation | Method | Signature | Confirmed | Remarks |
|-----------|--------|-----------|-----------|---------|
| **LIST account labels** | `getLabels()` | `() → ZaloLabel[]` | ✅ Yes | Used in pull phase (worker:90) |
| **GET label details** | N/A (in getLabels result) | N/A | ✅ Implicit | Label data returned by getLabels |
| **CREATE label** | ❓ Unknown | `(name, color?) → ZaloLabel` | ❌ No | Not needed for phase-04 (user creates in Zalo app) |
| **UPDATE label** | `updateLabels()` | `(labelId, updates) → ZaloLabel` | ✅ Yes | Not used in phase-04 MVP |
| **DELETE label** | ❓ Unknown | `(labelId) → void` | ❌ No | Not needed; Zalo manages label lifecycle |
| **ADD contact to label** | `addLabel()` | `(uid, labelName) → void` | ❓ **Assumed** | **Critical blocker if missing** |
| **REMOVE contact from label** | `removeLabel()` | `(uid, labelName) → void` | ❓ **Assumed** | **Critical blocker if missing** |
| **LIST contact labels** | `getContactLabels()` | `(uid) → string[]` | ❓ **Possible but not required** | Optimization; can work without via getLabels + getAllFriends |
| **GET labels of friend** | (see above) | N/A | ❓ Possible | Workaround: diff local snapshot vs Zalo state |

---

## Data Shape vs ZaloTagSnapshot Schema

**Current schema** (schema.prisma:690-702):
```prisma
model ZaloTagSnapshot {
  id             String   @id @default(uuid())
  zaloAccountId  String   @map("zalo_account_id")
  contactZaloUid String   @map("contact_zalo_uid")
  labelId        String   @map("label_id")
  labelName      String   @map("label_name")
  syncedAt       DateTime @default(now()) @map("synced_at")
  
  @@unique([zaloAccountId, contactZaloUid, labelId])
}
```

**Data we expect from API:**

1. **From `getLabels()`:**
   ```typescript
   {
     labelId: "...",      // Matches schema.labelId
     labelName: "...",    // Matches schema.labelName
   }
   ```

2. **From `addLabel(uid, labelName)` + worker pull diff:**
   ```typescript
   // We infer the label was added by:
   // (1) Calling getLabels() before + after
   // (2) Diffing against ZaloTagSnapshot
   // (3) Upserting new rows
   ```

**Fit assessment:** ✅ **Good**
- Schema stores `(accountId, contactId, labelId, labelName)`
- API returns labelId + labelName
- Snapshot is normalized correctly

**Potential gap:**
- Schema has `labelId` but phase-04 worker calls `addLabel(uid, labelName)` (name, not ID)
- **Implication:** Either:
  - A) API maps labelName → labelId internally (likely)
  - B) Phase-04 code needs to maintain name→ID mapping (feasible, add index to ZaloTagSnapshot)
  
**Recommendation:** Schema is sound. Implementation should:
1. Store both labelId + labelName in snapshot (done ✅)
2. In worker pull: infer labelId from getLabels() results by matching labelName
3. In worker push: use labelName when calling addLabel/removeLabel

---

## Event Emissions (Label Updates)

**Searched for label events:** No `listener.on('label*')` or similar found in codebase.

**Implications:**
- Zalo labels are **not real-time pushed** to connected listener
- Sync must be **polling-based** (worker cron every 15min, per phase-04 plan)
- No event-driven reactivity (e.g., when a friend gets labeled in native app, we won't know until next pull)

**This is acceptable for MVP** because:
- Label ops are less frequent than messages
- 15min polling is user-acceptable
- Reduces event listener complexity

---

## Rate Limiting Hints for Label Ops

**From prior research report:**
- 200 messages/day per account (send limit)
- 5 messages/30sec burst (send limit)
- **Read-heavy API rate limits: UNKNOWN**

**Inferred for label ops:**
- `getLabels()` — likely no limit (read-only, account-level, low cost)
- `addLabel(uid, labelName)` — likely **subject to Zalo's contact-mutation rate limit**
  - **Conservative assumption:** 5-10 ops/30sec per account
  - Phase-04 plan (line 129): "Reserve 80% capacity for chat; worker yields if near limit"

**Recommendation for worker:**
- Respect `zaloRateLimiter` for contact-level add/remove ops
- Prioritize chat sends over label sync (unlikely to saturate)
- Batch label ops carefully (don't add 100 contacts to same label in 1 minute)

---

## Scenario Analysis & Recommended Path

### Scenario A: Full CRUD + Member Ops ✅ (Best Case — IF true)
**Requirements:** `addLabel()`, `removeLabel()`, `getContactLabels()` all exist
**Implementation:** Full 2-way sync as planned in phase-04
**Effort:** 9h (per phase plan)
**Risk:** Medium (assume APIs exist, validate early)

### Scenario B: Read-Only Labels + No Contact Ops ⚠️ (Likely Case)
**What works:**
- `getLabels()` — fetch all labels ✅
- Display in UI (read-only) ✅

**What's blocked:**
- `addLabel()` doesn't exist or requires different API
- Cannot sync CRM → Zalo (queue sits pending forever)

**Implementation:** 1-way sync Zalo → CRM only
- Worker pull phase works (line 90)
- Worker push phase is disabled or queued for future
- UI shows "label sync (read-only)" badge
- Effort: 5-6h

**Mitigation:** Use `custom()` API to invoke raw Zalo endpoint if contact-label mutation method exists but is undocumented

### Scenario C: No Usable API 🛑 (Worst Case — avoid)
**If:** getLabels() also missing or broken
**Implementation:** CRM-only tags (no Zalo sync)
- Full feature still works (CRM tags independent)
- Zalo labels are never synced
- Mark feature as "beta: Zalo sync disabled"
- Effort: 3h (skip worker)

---

## **RECOMMENDED SCENARIO: B1.5 (Hybrid Approach)**

**Why not pure A or B:**
- Memory confirms `getLabels()` + `updateLabels()` exist (high confidence)
- Phase-04 plan and schema assume `addLabel()` + `removeLabel()` exist (moderate confidence)
- No proof either way from current codebase (can't access source directly)

**Approach:**
1. **Implement full 2-way sync** as planned (scenario A)
2. **Add runtime validation** in worker:
   ```typescript
   async function validateLabelAPI() {
     try {
       const labels = await api.getLabels();
       // Try a safe add/remove on a test contact
       // If fails → log warning, set feature flag to read-only
     } catch (err) {
       logger.error('Label API missing:', err);
       process.env.ZALO_LABEL_SYNC_MODE = 'read-only';
     }
   }
   ```
3. **Feature flag control:**
   - `ZALO_LABEL_SYNC_MODE=full` (default, phase-04) → 2-way sync
   - `ZALO_LABEL_SYNC_MODE=read-only` → pull only
   - `ZALO_LABEL_SYNC_MODE=off` → skip entirely

4. **Safe fallback:**
   - If push fails, queue remains pending (visible in admin UI for manual retry)
   - Logging provides clear diagnostic (which API failed)
   - No data corruption (queue + snapshot isolation)

**Effort:** 9h (as planned) + 1.5h validation + feature flag = 10.5h

---

## Implementation Path (Per Phase-04 Plan)

### Phase-04 Step-by-step (Adjusted)

1. ✅ Read this researcher report (DONE)
2. ✅ Implement `tag-service.ts` (CRM CRUD + contact link) — schema ready
3. ✅ Implement `tag-routes.ts` with Zod validation
4. ✅ Implement `auto-tag-engine.ts` + hook in `message-handler.ts`
5. ⚠️ **Implement worker (with fallback)**:
   - Assume `addLabel()` + `removeLabel()` exist
   - Add try-catch wrapper around push phase
   - Log API method names for debugging
   - Toggle via `ZALO_LABEL_SYNC_MODE` env var
6. ✅ Tests:
   - All standard tests per plan + 
   - **ADD:** Test push failure gracefully queues retry + logs API name

### Critical Validation Before Ship

**Before releasing phase-04 to production:**
1. **Staging test:** Add a label to a contact in Zalo app → verify CRM syncs via pull (getLabels)
2. **Staging test:** Add a tag in CRM UI → verify queue row created + worker attempts push
   - Even if push fails, queue behavior should be clean (retry on next cycle)
3. **Logs review:** Check if `addLabel` / `removeLabel` method calls succeed or fail clearly

---

## File Path References

**Schema definition:**
- `/Users/martin/conductor/workspaces/zalocrm/los-angeles/backend/prisma/schema.prisma` lines 690-719

**Phase-04 plan:**
- `/Users/martin/conductor/workspaces/zalocrm/los-angeles/plans/260422-2312-b3-multi-account-intel/phase-04-tag-system.md`

**Prior researcher report:**
- `/Users/martin/conductor/workspaces/zalocrm/los-angeles/plans/reports/researcher-260415-2352-zca-js-api.md`

**Project memory (undocumented APIs):**
- `/Users/martin/.claude/projects/-Users-martin-conductor-repos-zalocrm/memory/zca-js-api-capabilities.md`

---

## Unresolved Questions

### HIGH PRIORITY (Blocking Decision)
1. **Do `addLabel(uid, labelName)` and `removeLabel(uid, labelName)` exist in zca-js v2.1.2?**
   - **How to resolve:** Attempt call in sandbox; check zca-js GitHub source (RFS-ADRENO/zca-js) if accessible
   - **Impact:** Determines if 2-way sync is viable or read-only fallback needed

2. **What is the exact API signature for `addLabel` / `removeLabel`?**
   - **Unknowns:**
     - Parameter 1: userId or UID? Format (string ID, int, etc.)?
     - Parameter 2: labelName (string) or labelId?
     - Return type: void, boolean, ZaloLabel, or error object?
   - **How to resolve:** Inspect zca-js source code or test with live Zalo API

3. **Does `addLabel` accept label name or label ID?**
   - **Why it matters:** Phase-04 worker stores `labelName` in queue, not ID
   - **Evidence:** schema.prisma:710 has `labelName String` not `labelId`

### MEDIUM PRIORITY (Implementation Detail)
4. **Does `getLabels()` return label ID or do we need to map name→ID separately?**
   - **Current assumption:** Returns `{labelId, labelName}` objects
   - **If wrong:** May need additional API call like `getLabelById()` or mapping logic

5. **Are label operations subject to the 5-msg/30s rate limit?**
   - **Current assumption:** Contact-level mutations (add/remove label) likely subject to same limiter as message sends
   - **How to verify:** Test with rapid-fire adds to same label; monitor for 429 errors

6. **What happens if `addLabel(uid, nonExistentLabel)` is called?**
   - **Error type:** 404, validation error, silent fail?
   - **Impact:** Worker error handling strategy

### LOW PRIORITY (Future Features)
7. **Can you create new labels via API, or only modify existing ones?**
   - **For phase-04:** Not needed (assume labels created in Zalo app)
   - **For future:** May want to enable CRM users to define new labels

8. **Does Zalo support label colors / icons, and are they synced?**
   - **Current schema:** CrmTag has `color` + `icon` fields, but ZaloTagSnapshot does not
   - **For phase-04:** Assume no (read label name only); enhance later if available

9. **Is there a label-updated event or push notification?**
   - **Current assumption:** No (polling-based sync via 15min cron)
   - **For phase-04:** Acceptable; confirm if needed for real-time UX later

10. **What is the rate limit for `getLabels()`?**
    - **Current assumption:** None (read-only, low cost)
    - **Verify if:** Worker is called more frequently in future versions

---

## Summary

**Status:** Phase-04 can proceed with **high confidence on the read half** (`getLabels()` confirmed), **moderate confidence on write half** (`addLabel/removeLabel` assumed per pattern, unconfirmed). 

**Recommendation:** Implement per plan with feature flag fallback. Validate contact-label APIs early in sprint via sandbox testing. Schema + architecture support both 2-way sync and read-only graceful degradation.

**Next step:** Planner should verify with live sandbox test or review zca-js source code (RFS-ADRENO/zca-js GitHub) before implementation sprint kicks off.

---

**Status:** DONE

