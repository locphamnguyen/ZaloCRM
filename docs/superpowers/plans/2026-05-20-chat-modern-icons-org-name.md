# Chat Modern Icons and Organization Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace remaining classic emoji/glyph icons in the Tin nhắn screen with modern Vuetify/MDI icons and correct the organization fallback name to `HUY TRAN`.

**Architecture:** Keep this as a focused chat UI polish pass. Use Vuetify `v-icon`/MDI icons for interactive controls and semantic UI markers, preserving existing labels and click behavior. Limit organization naming to `DefaultLayout.vue`, and limit chat icon modernization to visible chat-screen components rather than global refactors.

**Tech Stack:** Vue 3, Vuetify, Material Design Icons via `@mdi/font`, Vite, TypeScript, scoped CSS.

---

## File map

- Modify: `frontend/src/layouts/DefaultLayout.vue` — change workspace fallback from `Huy Tran` to uppercase organization name `HUY TRAN`.
- Modify: `frontend/src/components/chat/FilterRail.vue` — replace emoji filter icons and text glyph status markers with modern MDI icons.
- Modify: `frontend/src/components/chat/ConversationList.vue` — replace visible group/close glyphs and blue-dot Zalo tag marker with icon-based UI while preserving tag text.
- Modify: `frontend/src/components/chat/MessageThread.vue` — replace label/manage/status/media/action emoji glyphs with MDI icons or plain text where icons are not needed.
- Modify: `frontend/src/components/chat/ChatContactPanel.vue` — replace contact panel emoji/glyph icons with MDI icons while preserving content and buttons.
- Modify: `frontend/src/components/chat/AutomationCardList.vue` — replace automation card emoji icons with MDI icons.
- Modify: `frontend/src/components/chat/ChatAppointments.vue` — replace appointment header/fallback emoji icons with MDI icons.
- Modify: `frontend/src/components/chat/AppointmentQuickDialog.vue` — replace appointment dialog close/header/quick-pick emoji icons with MDI icons.
- Validate: `npm --prefix frontend run build`, Docker app rebuild, and Dockerized Playwright smoke test for `/chat`.

## Icon modernization rules

Use these mappings unless the existing component already has a more specific MDI pattern nearby:

```text
× -> mdi-close
+ -> mdi-plus
👥 -> mdi-account-group-outline
👤 -> mdi-account-outline
🏷 -> mdi-tag-outline
💬 -> mdi-chat-outline
🤝 -> mdi-handshake-outline
📅 -> mdi-calendar-outline
✓ -> mdi-check
✗ -> mdi-close
🚫 -> mdi-cancel
⚙ -> mdi-cog-outline
⚑ -> mdi-flag-outline
📤 -> mdi-send-outline
⏳ -> mdi-timer-sand
🚀 -> mdi-rocket-launch-outline
🔗 -> mdi-link-variant
🖼️ / 📷 -> mdi-image-outline
📎 -> mdi-paperclip
📞 -> mdi-phone-outline
✏ -> mdi-pencil-outline
⚧ -> mdi-gender-male-female
✉ -> mdi-email-outline
📍 -> mdi-map-marker-outline
💼 -> mdi-briefcase-outline
📥 -> mdi-inbox-arrow-down-outline
✂ -> mdi-content-cut
🔖 -> mdi-bookmark-outline
✨ -> mdi-sparkles
💗 -> mdi-heart-outline
🔔 -> mdi-bell-outline
☀️ -> mdi-weather-sunny
🌤 -> mdi-weather-partly-cloudy
🌇 / 🌆 -> mdi-weather-sunset
🔁 -> mdi-repeat
```

For statuses where an icon would clutter the row, plain text without emoji is acceptable if the label remains readable.

### Task 1: Correct organization fallback name

**Files:**
- Modify: `frontend/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: Confirm current fallback**

Run:

```bash
grep -n "Huy Tran\|HUY TRAN\|hsholding" frontend/src/layouts/DefaultLayout.vue
```

Expected: current code contains `Huy Tran` and does not contain `hsholding`.

- [ ] **Step 2: Change fallback to uppercase organization name**

In `frontend/src/layouts/DefaultLayout.vue`, change:

```ts
const workspaceName = computed(() => authStore.user?.fullName || 'Huy Tran');
```

to:

```ts
const workspaceName = computed(() => 'HUY TRAN');
```

Expected behavior: menu organization/workspace name always shows `HUY TRAN`, not the user's personal name and not typo variants such as `huy tTran`.

- [ ] **Step 3: Verify organization name**

Run:

```bash
! grep -n "Huy Tran\|huy tTran\|hsholding" frontend/src/layouts/DefaultLayout.vue
grep -n "HUY TRAN" frontend/src/layouts/DefaultLayout.vue
```

Expected: only `HUY TRAN` remains as the fallback organization label.

### Task 2: Modernize FilterRail icons

**Files:**
- Modify: `frontend/src/components/chat/FilterRail.vue`

- [ ] **Step 1: Confirm current emoji/glyph usage**

Run:

```bash
grep -n "👥\|👤\|🏷\|💬\|🤝\|📅\|✓\|✗\|🚫\|×" frontend/src/components/chat/FilterRail.vue
```

Expected: output includes emoji in filter icons and glyphs in close/status labels.

- [ ] **Step 2: Replace visible filter icon spans with `v-icon`**

In `frontend/src/components/chat/FilterRail.vue`, replace each visible icon-only span like:

```vue
<span class="icon">👥</span>
```

with the corresponding Vuetify icon:

```vue
<v-icon class="icon" size="18">mdi-account-group-outline</v-icon>
```

Apply these replacements in the template:

```text
👥 -> <v-icon class="icon" size="18">mdi-account-group-outline</v-icon>
👤 -> <v-icon class="icon" size="18">mdi-account-outline</v-icon>
🏷 -> <v-icon class="icon" size="18">mdi-tag-outline</v-icon>
💬 -> <v-icon class="icon" size="18">mdi-chat-outline</v-icon>
🤝 -> <v-icon class="icon" size="18">mdi-handshake-outline</v-icon>
📅 -> <v-icon class="icon" size="18">mdi-calendar-outline</v-icon>
```

- [ ] **Step 3: Replace close and status glyphs**

Replace visible close glyph text buttons:

```vue
×
```

with:

```vue
<v-icon size="16">mdi-close</v-icon>
```

For option labels, remove leading glyphs while preserving meaning:

```text
✓ Có Zalo -> Có Zalo
✗ Không có -> Không có
✓ Đã KB -> Đã KB
💬 Chat lạ -> Chat lạ
🚫 Ngắt -> Ngắt
```

If the row visually needs an icon, add a leading `<v-icon size="16">...</v-icon>` inside the row using the mapping table, but keep the text label glyph-free.

- [ ] **Step 4: Verify FilterRail has no classic chat glyphs**

Run:

```bash
! grep -n "👥\|👤\|🏷\|💬\|🤝\|📅\|✓\|✗\|🚫\|×" frontend/src/components/chat/FilterRail.vue
grep -n "mdi-account-group-outline\|mdi-tag-outline\|mdi-chat-outline\|mdi-close" frontend/src/components/chat/FilterRail.vue
```

Expected: no target emoji/glyphs remain; modern MDI names are present.

### Task 3: Modernize ConversationList residual icons

**Files:**
- Modify: `frontend/src/components/chat/ConversationList.vue`

- [ ] **Step 1: Confirm remaining visible glyphs**

Run:

```bash
grep -n "👥\|🔵\|×" frontend/src/components/chat/ConversationList.vue
```

Expected: output includes group icon, Zalo-managed tag marker, or close glyph if still present.

- [ ] **Step 2: Replace modal/sidebar close glyphs with MDI close icons**

Replace visible close button content:

```vue
×
```

with:

```vue
<v-icon size="16">mdi-close</v-icon>
```

Do not change click handlers or button classes.

- [ ] **Step 3: Replace group icon emoji**

Replace:

```vue
<span class="group-icon">👥</span>
```

with:

```vue
<v-icon class="group-icon" size="16">mdi-account-group-outline</v-icon>
```

Keep `.group-icon` styling compatible with an inline icon.

- [ ] **Step 4: Replace visible Zalo tag marker**

Where a visible managed Zalo tag prefix currently renders `🔵`, replace it with:

```vue
<v-icon class="zalo-tag-icon" size="12">mdi-circle</v-icon>
```

or, if the marker is produced in script text, remove the `🔵 ` prefix from the generated string and use CSS/class styling on the tag instead. Preserve tag names and filtering behavior.

Add CSS if needed:

```css
.zalo-tag-icon {
  color: #2563eb;
  flex: 0 0 auto;
}
```

- [ ] **Step 5: Verify ConversationList residual icons**

Run:

```bash
! grep -n "👥\|🔵\|×" frontend/src/components/chat/ConversationList.vue
grep -n "mdi-close\|mdi-account-group-outline\|mdi-circle" frontend/src/components/chat/ConversationList.vue
```

Expected: no target glyphs remain; modern MDI icons are present.

### Task 4: Modernize MessageThread icons and status glyphs

**Files:**
- Modify: `frontend/src/components/chat/MessageThread.vue`

- [ ] **Step 1: Confirm current classic icons**

Run:

```bash
grep -n "🏷\|⚑\|✓\|⚙\|📤\|⏳\|🚀\|🔗\|🖼️\|📅\|📷\|📎" frontend/src/components/chat/MessageThread.vue
```

Expected: output includes label dropdown, send/status, media, appointment, and toast icons.

- [ ] **Step 2: Replace label/manage glyphs with `v-icon`**

Replace visible spans/classes:

```text
zlbl-icon 🏷 -> <v-icon class="zlbl-icon" size="16">mdi-tag-outline</v-icon>
zlbl-flag ⚑ -> <v-icon class="zlbl-flag" size="14">mdi-flag-outline</v-icon>
zlbl-check ✓ -> <v-icon class="zlbl-check" size="14">mdi-check</v-icon>
manage-icon ⚙ -> <v-icon class="manage-icon" size="16">mdi-cog-outline</v-icon>
```

Keep dropdown/menu behavior unchanged.

- [ ] **Step 3: Replace message status/action glyphs**

Replace status/action display glyphs using MDI icons where they are rendered in template. For text composed in script/toast messages, remove emoji prefixes and keep plain Vietnamese text:

```text
✓ -> mdi-check or plain success text without glyph
📤 -> mdi-send-outline or plain "Đã gửi"
⏳ -> mdi-timer-sand or plain "Đang gửi"
🚀 -> mdi-rocket-launch-outline or plain action label
🔗 -> mdi-link-variant
🖼️ / 📷 -> mdi-image-outline or plain "Hình ảnh"
📅 -> mdi-calendar-outline or plain "Lịch hẹn"
📎 -> mdi-paperclip or plain "Tệp đính kèm"
```

- [ ] **Step 4: Verify MessageThread target glyphs removed**

Run:

```bash
! grep -n "🏷\|⚑\|✓\|⚙\|📤\|⏳\|🚀\|🔗\|🖼️\|📅\|📷\|📎" frontend/src/components/chat/MessageThread.vue
grep -n "mdi-tag-outline\|mdi-flag-outline\|mdi-check\|mdi-cog-outline\|mdi-send-outline\|mdi-image-outline\|mdi-calendar-outline\|mdi-paperclip" frontend/src/components/chat/MessageThread.vue
```

Expected: target glyphs are gone; appropriate MDI icons or plain labels are present.

### Task 5: Modernize ChatContactPanel icons

**Files:**
- Modify: `frontend/src/components/chat/ChatContactPanel.vue`

- [ ] **Step 1: Confirm current contact panel glyphs**

Run:

```bash
grep -n "×\|👤\|🔗\|📅\|📞\|✏\|⚧\|✉\|📍\|💼\|💬\|📥\|📤\|✂\|🔖\|🏷\|✨\|💗\|✓\|👥\|🚫" frontend/src/components/chat/ChatContactPanel.vue
```

Expected: output includes multiple visible emoji/glyph icons.

- [ ] **Step 2: Replace visible glyphs with MDI icons**

In the template, replace visible emoji/glyphs with `v-icon` equivalents from the mapping table. Examples:

```vue
<span class="panel-icon">👤</span>
```

becomes:

```vue
<v-icon class="panel-icon" size="18">mdi-account-outline</v-icon>
```

Use the mapping table for each visible glyph. Preserve existing classes where possible so styling remains stable.

- [ ] **Step 3: Replace toast/string glyph prefixes with plain text**

For script strings/toasts that include emoji/glyph prefixes, remove the prefix and keep the message. Examples:

```ts
'✓ Đã lưu'
```

becomes:

```ts
'Đã lưu'
```

Do this only for user-visible chat contact panel messages.

- [ ] **Step 4: Verify ChatContactPanel target glyphs removed**

Run:

```bash
! grep -n "×\|👤\|🔗\|📅\|📞\|✏\|⚧\|✉\|📍\|💼\|💬\|📥\|📤\|✂\|🔖\|🏷\|✨\|💗\|✓\|👥\|🚫" frontend/src/components/chat/ChatContactPanel.vue
grep -n "mdi-account-outline\|mdi-link-variant\|mdi-calendar-outline\|mdi-phone-outline\|mdi-pencil-outline\|mdi-email-outline\|mdi-map-marker-outline\|mdi-briefcase-outline\|mdi-chat-outline\|mdi-tag-outline\|mdi-heart-outline\|mdi-close" frontend/src/components/chat/ChatContactPanel.vue
```

Expected: target glyphs are gone; modern icons/plain labels are present.

### Task 6: Modernize secondary chat widgets

**Files:**
- Modify: `frontend/src/components/chat/AutomationCardList.vue`
- Modify: `frontend/src/components/chat/ChatAppointments.vue`
- Modify: `frontend/src/components/chat/AppointmentQuickDialog.vue`

- [ ] **Step 1: Confirm current secondary widget glyphs**

Run:

```bash
grep -n "⚡\|🕐\|✓\|📅\|🔔\|×\|☀️\|🌤\|🌇\|🌆\|📞\|💬\|🤝\|🔁\|📍" frontend/src/components/chat/AutomationCardList.vue frontend/src/components/chat/ChatAppointments.vue frontend/src/components/chat/AppointmentQuickDialog.vue
```

Expected: output includes automation, appointment, and dialog glyphs.

- [ ] **Step 2: Replace visible glyphs with MDI icons or plain labels**

Apply the mapping table:

```text
⚡ -> mdi-lightning-bolt-outline
🕐 -> mdi-clock-outline
✓ -> mdi-check
📅 -> mdi-calendar-outline
🔔 -> mdi-bell-outline
× -> mdi-close
☀️ -> mdi-weather-sunny
🌤 -> mdi-weather-partly-cloudy
🌇 / 🌆 -> mdi-weather-sunset
📞 -> mdi-phone-outline
💬 -> mdi-chat-outline
🤝 -> mdi-handshake-outline
🔁 -> mdi-repeat
📍 -> mdi-map-marker-outline
```

For script/toast strings, remove emoji prefixes and keep plain Vietnamese text.

- [ ] **Step 3: Verify secondary widgets target glyphs removed**

Run:

```bash
! grep -n "⚡\|🕐\|✓\|📅\|🔔\|×\|☀️\|🌤\|🌇\|🌆\|📞\|💬\|🤝\|🔁\|📍" frontend/src/components/chat/AutomationCardList.vue frontend/src/components/chat/ChatAppointments.vue frontend/src/components/chat/AppointmentQuickDialog.vue
grep -n "mdi-lightning-bolt-outline\|mdi-clock-outline\|mdi-check\|mdi-calendar-outline\|mdi-bell-outline\|mdi-close\|mdi-weather-sunny\|mdi-phone-outline\|mdi-chat-outline\|mdi-map-marker-outline" frontend/src/components/chat/AutomationCardList.vue frontend/src/components/chat/ChatAppointments.vue frontend/src/components/chat/AppointmentQuickDialog.vue
```

Expected: target glyphs are gone; modern icons/plain labels are present.

### Task 7: Build and Docker browser validation

**Files:**
- Validate only.

- [ ] **Step 1: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: build succeeds with no TypeScript/Vue errors.

- [ ] **Step 2: Rebuild app container**

Run:

```bash
docker compose up -d --build app
```

Expected: app image builds and `zalo-crm-app` starts.

- [ ] **Step 3: Run Dockerized Playwright smoke test**

Run a Playwright container against the local app:

```bash
docker run --rm --network host -v "$PWD/.claude/browser-artifacts:/artifacts" mcr.microsoft.com/playwright:v1.49.1-noble bash -lc 'cd /tmp && npm init -y >/dev/null 2>&1 && npm install playwright@1.49.1 >/dev/null 2>&1 && node <<"JS"
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const messages = [];
  page.on("console", msg => { if (["error", "warning"].includes(msg.type())) messages.push(`${msg.type()}: ${msg.text()}`); });
  page.on("pageerror", err => messages.push(`pageerror: ${err.message}`));
  await page.goto("http://127.0.0.1:3080/chat", { waitUntil: "networkidle", timeout: 30000 });
  await page.screenshot({ path: "/artifacts/chat-modern-icons.png", fullPage: true });
  const body = await page.locator("body").innerText();
  const result = {
    loaded: body.length > 0,
    loginScreen: body.includes("Đăng nhập"),
    containsHuyTranUpper: body.includes("HUY TRAN"),
    containsBadOrgName: body.includes("Huy Tran") || body.includes("huy tTran") || body.includes("hsholding"),
    containsClassicGlyph: /[👥👤🏷💬🤝📅✓✗🚫⚙⚑📤⏳🚀🔗🖼️📷📎📞✏⚧✉📍💼📥✂🔖✨💗🔔☀️🌤🌇🌆🔁]/u.test(body),
    iconCount: await page.locator(".mdi").count(),
    messages,
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
JS'
```

Expected: page loads. If unauthenticated, `loginScreen` may be true and protected chat DOM may not be visible; this is acceptable only if build and source grep validation pass. If authenticated test data is available, verify the chat page contains no classic glyphs and modern MDI icons render.

### Task 8: Commit chat modern icon pass

**Files:**
- Commit all modified files from Tasks 1-7 plus this plan.

- [ ] **Step 1: Review final status**

Run:

```bash
git status --short
```

Expected: intended frontend files and this plan are modified/untracked. `.claude/` artifacts must not be staged.

- [ ] **Step 2: Review final diff**

Run:

```bash
git diff -- frontend/src/layouts/DefaultLayout.vue frontend/src/components/chat/FilterRail.vue frontend/src/components/chat/ConversationList.vue frontend/src/components/chat/MessageThread.vue frontend/src/components/chat/ChatContactPanel.vue frontend/src/components/chat/AutomationCardList.vue frontend/src/components/chat/ChatAppointments.vue frontend/src/components/chat/AppointmentQuickDialog.vue docs/superpowers/plans/2026-05-20-chat-modern-icons-org-name.md
```

Expected: diff contains only organization name correction, chat icon modernization, and this plan.

- [ ] **Step 3: Stage only intended files**

Run:

```bash
git add frontend/src/layouts/DefaultLayout.vue frontend/src/components/chat/FilterRail.vue frontend/src/components/chat/ConversationList.vue frontend/src/components/chat/MessageThread.vue frontend/src/components/chat/ChatContactPanel.vue frontend/src/components/chat/AutomationCardList.vue frontend/src/components/chat/ChatAppointments.vue frontend/src/components/chat/AppointmentQuickDialog.vue docs/superpowers/plans/2026-05-20-chat-modern-icons-org-name.md
```

Expected: no `.claude/`, screenshots, backups, or unrelated docs are staged.

- [ ] **Step 4: Commit**

Run:

```bash
git commit -m "style(chat): modernize message icons and org name" -m "Replace remaining classic chat glyphs with modern MDI icons and correct the workspace organization label to HUY TRAN.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: commit succeeds.

## Self-review

- Spec coverage: The plan covers the user's two corrections: chat/message screen icons still look classic, and the organization name should be exactly `HUY TRAN`.
- Placeholder scan: No `TBD`, `TODO`, or unspecified steps remain.
- Type/name consistency: All replacements use existing Vuetify `v-icon`/MDI icon naming and preserve current component behavior.
