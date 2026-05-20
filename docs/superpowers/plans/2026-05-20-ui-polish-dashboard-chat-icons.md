# UI Polish Dashboard Chat Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the golden redesign by removing the dashboard marquee, updating menu branding, fixing chat tag contrast and preview readability, and replacing old/emoji-style icons with cleaner modern Material Design Icons.

**Architecture:** Keep this as a surgical frontend-only polish pass. Update the existing Vue components in place, centralizing the navigation icon choices in `DefaultLayout.vue` and limiting chat fixes to the existing tag bar and conversation list components. Validate with targeted text/grep checks, a frontend build, and a browser smoke test of Dashboard and Tin nhắn.

**Tech Stack:** Vue 3, Vuetify, Material Design Icons via Vuetify, Vite, TypeScript, CSS custom properties.

---

## File map

- Modify: `frontend/src/views/DashboardView.vue` — remove the visible dashboard marquee block and its unused marquee styles; modernize the dashboard title icon.
- Modify: `frontend/src/layouts/DefaultLayout.vue` — change workspace fallback text from `hsholding` to `Huy Tran`; replace older menu icons with cleaner outline/modern MDI names.
- Modify: `frontend/src/components/chat/TagCrmBar.vue` — fix `+ Thêm tag` button contrast in dark/golden theme so text is readable.
- Modify: `frontend/src/components/chat/ConversationList.vue` — increase left conversation preview font by 2px and remove emoji preview prefixes in favor of plain readable labels.
- Validate: `npm --prefix frontend run build` and browser smoke checks for `/` and `/chat`.

## Important constraint

`DashboardView.vue` currently contains an attribution banner comment that says the banner is required by Apache License NOTICE clause §4(d). Do not delete the legal attribution logic blindly. The requested user-facing fix is to remove `dashboard-marquee`, so preserve attribution availability in code while removing the marquee UI from Dashboard. If legal attribution must remain visible elsewhere, stop and ask before deleting the attribution feature entirely.

### Task 1: Remove Dashboard marquee UI and update Dashboard icon

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`

- [ ] **Step 1: Confirm the current marquee exists**

Run:

```bash
grep -n "dashboard-marquee\|contact-marquee\|marquee-track" frontend/src/views/DashboardView.vue
```

Expected: output includes the template block around `class="contact-marquee dashboard-marquee"` and the CSS selectors `.contact-marquee`, `.marquee-track`, and `@keyframes marquee`.

- [ ] **Step 2: Remove only the visible marquee anchor from the Dashboard template**

In `frontend/src/views/DashboardView.vue`, remove this block from the top of the template:

```vue
    <!--
      ATTRIBUTION BANNER — Required by Apache License 2.0 NOTICE clause §4(d).
      Source data is obfuscated in src/composables/use-attribution.ts; see that
      file + the NOTICE file at the repository root before modifying.
      Removing this element is a license violation unless you hold a commercial
      license from the maintainer (locnt@locnguyendata.com).
    -->
    <a
      v-if="attribution.enabled.value"
      class="contact-marquee dashboard-marquee"
      :href="attribution.href"
      target="_blank"
      rel="noopener"
      :title="attribution.text"
    >
      <span class="marquee-track">
        {{ attribution.text }}&nbsp;•&nbsp;{{ attribution.text }}&nbsp;•&nbsp;
      </span>
    </a>
```

Keep the rest of the Dashboard content intact.

- [ ] **Step 3: Remove the now-unused attribution import and variable if no longer referenced**

In the `<script setup>` block of `frontend/src/views/DashboardView.vue`, remove:

```ts
import { useAttribution } from '@/composables/use-attribution';
```

and remove:

```ts
const attribution = useAttribution();
```

Only do this if `attribution` is no longer referenced after Step 2.

- [ ] **Step 4: Remove unused marquee CSS selectors**

In `frontend/src/views/DashboardView.vue`, remove the CSS blocks for:

```css
.contact-marquee { ... }
.contact-marquee:hover { ... }
.marquee-track { ... }
@keyframes marquee { ... }
```

Expected: no `dashboard-marquee`, `contact-marquee`, `marquee-track`, or `@keyframes marquee` remains in this file.

- [ ] **Step 5: Replace the Dashboard title icon with a modern outline icon**

Change the title icon from:

```vue
<v-icon class="mr-2" style="color: #00F2FF;">mdi-view-dashboard</v-icon>
```

to:

```vue
<v-icon class="mr-2" color="primary">mdi-view-dashboard-outline</v-icon>
```

- [ ] **Step 6: Verify Dashboard marquee removal**

Run:

```bash
! grep -n "dashboard-marquee\|contact-marquee\|marquee-track\|@keyframes marquee" frontend/src/views/DashboardView.vue
grep -n "mdi-view-dashboard-outline" frontend/src/views/DashboardView.vue
```

Expected: first command exits successfully with no output; second command finds the new icon.

### Task 2: Update menu branding and modernize top navigation icons

**Files:**
- Modify: `frontend/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: Confirm current branding fallback and icon names**

Run:

```bash
grep -n "hsholding\|primaryTabs\|mdi-view-dashboard-outline\|mdi-chart-line\|mdi-file-chart-outline\|mdi-lightning-bolt-outline\|mdi-cog-outline" frontend/src/layouts/DefaultLayout.vue
```

Expected: output includes `hsholding` on the `workspaceName` fallback and existing navigation icon names.

- [ ] **Step 2: Change workspace fallback text**

In `frontend/src/layouts/DefaultLayout.vue`, change:

```ts
const workspaceName = computed(() => authStore.user?.fullName?.split(' ')[0] || 'hsholding');
```

to:

```ts
const workspaceName = computed(() => authStore.user?.fullName || 'Huy Tran');
```

Expected behavior: if the logged-in user has a full name, show it; otherwise show `Huy Tran` instead of `hsholding`.

- [ ] **Step 3: Replace primary tab icon names with cleaner modern outline icons**

Replace the `primaryTabs` array with this exact array:

```ts
const primaryTabs: NavTab[] = [
  { path: '/',             label: 'Dashboard',  icon: 'mdi-view-dashboard-outline', matchPrefix: '/$' },
  { path: '/chat',         label: 'Tin nhắn',   icon: 'mdi-chat-outline' },
  { path: '/friends',      label: 'Bạn bè',     icon: 'mdi-account-multiple-plus-outline' },
  { path: '/contacts',     label: 'Khách hàng', icon: 'mdi-card-account-details-outline' },
  { path: '/appointments', label: 'Lịch hẹn',   icon: 'mdi-calendar-month-outline' },
  { path: '/analytics',    label: 'Phân tích',  icon: 'mdi-chart-timeline-variant' },
  { path: '/reports',      label: 'Báo cáo',    icon: 'mdi-file-chart-outline' },
];
```

- [ ] **Step 4: Replace dropdown and action icons with modern outline choices**

In `frontend/src/layouts/DefaultLayout.vue`, make these replacements:

```text
mdi-lightning-bolt-outline -> mdi-creation-outline
mdi-chart-box-outline -> mdi-view-grid-outline
mdi-message-fast-outline -> mdi-send-clock-outline
mdi-radar -> mdi-target-account
mdi-cog-outline -> mdi-tune-variant
mdi-cellphone-link -> mdi-cellphone-cog
mdi-api -> mdi-cloud-braces
mdi-connection -> mdi-transit-connection-variant
mdi-account-cog-outline -> mdi-account-settings-outline
mdi-shield-account-outline -> mdi-shield-key-outline
mdi-account-group-outline -> mdi-account-group
mdi-account-circle-outline -> mdi-account-circle
mdi-weather-sunny -> mdi-white-balance-sunny
mdi-weather-night -> mdi-weather-night
mdi-logout -> mdi-logout-variant
```

Keep labels, routes, and menu behavior unchanged.

- [ ] **Step 5: Verify branding and icon text**

Run:

```bash
! grep -n "hsholding" frontend/src/layouts/DefaultLayout.vue
grep -n "Huy Tran\|mdi-chat-outline\|mdi-creation-outline\|mdi-tune-variant" frontend/src/layouts/DefaultLayout.vue
```

Expected: no `hsholding`; output includes `Huy Tran` and the new icon names.

### Task 3: Fix `+ Thêm tag` button contrast

**Files:**
- Modify: `frontend/src/components/chat/TagCrmBar.vue`

- [ ] **Step 1: Confirm current unreadable white button styling**

Run:

```bash
grep -n "tag-add-btn" frontend/src/components/chat/TagCrmBar.vue
```

Expected: output includes `.tag-add-btn` and `.tag-add-btn:hover`.

- [ ] **Step 2: Replace `.tag-add-btn` styling with golden-readable styles**

In `frontend/src/components/chat/TagCrmBar.vue`, replace the existing `.tag-add-btn` and `.tag-add-btn:hover` blocks with:

```css
.tag-add-btn {
  background: rgba(214, 168, 79, 0.14);
  border: 1.4px dashed rgba(214, 168, 79, 0.72);
  color: var(--gold-primary, #d6a84f);
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  height: 28px;
  flex-shrink: 0;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}
.tag-add-btn:hover {
  background: var(--gold-primary, #d6a84f);
  color: var(--gold-on-primary, #070a12);
  border-color: var(--gold-primary, #d6a84f);
}
```

Expected: in dark/golden mode, the button text is gold on a dark-gold translucent background; on hover it becomes dark text on gold.

- [ ] **Step 3: Verify tag button CSS no longer uses white background**

Run:

```bash
! grep -n "tag-add-btn" -A18 frontend/src/components/chat/TagCrmBar.vue | grep "background: #fff"
grep -n "rgba(214, 168, 79, 0.14)\|gold-on-primary" frontend/src/components/chat/TagCrmBar.vue
```

Expected: first command exits successfully; second command finds the new readable colors.

### Task 4: Increase conversation preview readability and remove emoji-style preview icons

**Files:**
- Modify: `frontend/src/components/chat/ConversationList.vue`

- [ ] **Step 1: Confirm current preview font and emoji prefixes**

Run:

```bash
grep -n "ci-preview\|📹\|📞\|🖼️\|🎥\|🎤\|🎞️\|📎\|🔗\|🏦\|📱\|📅\|📊" frontend/src/components/chat/ConversationList.vue
```

Expected: output includes `.ci-preview { font-size: 12px; ... }` and emoji prefixes inside `lastMessagePreview`.

- [ ] **Step 2: Increase preview font size by exactly 2px**

In `frontend/src/components/chat/ConversationList.vue`, change:

```css
.ci-preview {
  font-size: 12px; color: var(--smax-grey-700);
```

to:

```css
.ci-preview {
  font-size: 14px; color: var(--smax-grey-700);
```

Keep the rest of the `.ci-preview` CSS unchanged.

- [ ] **Step 3: Replace emoji media labels with plain modern text labels**

In `lastMessagePreview`, replace the call branch:

```ts
    const icon = isVideo ? '📹' : '📞';
    if (isMissed) return prefix + `${icon} Cuộc gọi nhỡ`;
```

with:

```ts
    const callLabel = isVideo ? 'Video call' : 'Cuộc gọi';
    if (isMissed) return prefix + `${callLabel} nhỡ`;
```

Then replace these switch cases:

```ts
    case 'photo': return prefix + '🖼️ Hình ảnh';
    case 'video': return prefix + '🎥 Video';
    case 'voice': return prefix + '🎤 Voice';
    case 'gif': return prefix + '🎞️ GIF';
    case 'file': return prefix + '📎 ' + (titleText ? truncate(titleText, 40) : 'Tệp đính kèm');
    case 'link': return prefix + '🔗 ' + (titleText ? truncate(titleText, 40) : 'Liên kết');
    case 'bank_transfer': return prefix + '🏦 Tài khoản ngân hàng';
    case 'call': return prefix + '📞 Cuộc gọi';
    case 'qr_code': return prefix + '📱 Mã QR';
    case 'reminder': return prefix + '📅 ' + (titleText ? truncate(titleText, 40) : 'Nhắc hẹn');
    case 'poll': return prefix + '📊 ' + (titleText ? truncate(titleText, 40) : 'Bình chọn');
```

with:

```ts
    case 'photo': return prefix + 'Hình ảnh';
    case 'video': return prefix + 'Video';
    case 'voice': return prefix + 'Tin nhắn thoại';
    case 'gif': return prefix + 'GIF';
    case 'file': return prefix + (titleText ? truncate(titleText, 40) : 'Tệp đính kèm');
    case 'link': return prefix + (titleText ? truncate(titleText, 40) : 'Liên kết');
    case 'bank_transfer': return prefix + 'Tài khoản ngân hàng';
    case 'call': return prefix + 'Cuộc gọi';
    case 'qr_code': return prefix + 'Mã QR';
    case 'reminder': return prefix + (titleText ? truncate(titleText, 40) : 'Nhắc hẹn');
    case 'poll': return prefix + (titleText ? truncate(titleText, 40) : 'Bình chọn');
```

- [ ] **Step 4: Modernize directly visible ConversationList icons**

In `frontend/src/components/chat/ConversationList.vue`, replace:

```vue
<v-icon size="18">mdi-message-plus</v-icon>
```

with:

```vue
<v-icon size="18">mdi-message-plus-outline</v-icon>
```

Replace context menu prepend icons:

```text
mdi-archive-arrow-down-outline -> mdi-tray-arrow-down
mdi-archive-arrow-up-outline -> mdi-tray-arrow-up
```

- [ ] **Step 5: Verify preview readability and emoji removal**

Run:

```bash
grep -n "font-size: 14px; color: var(--smax-grey-700)" frontend/src/components/chat/ConversationList.vue
! grep -n "📹\|📞\|🖼️\|🎥\|🎤\|🎞️\|📎\|🔗\|🏦\|📱\|📅\|📊" frontend/src/components/chat/ConversationList.vue
grep -n "mdi-message-plus-outline\|mdi-tray-arrow-down\|mdi-tray-arrow-up" frontend/src/components/chat/ConversationList.vue
```

Expected: preview font is 14px; no emoji preview prefixes remain; new icon names are present.

### Task 5: Build and browser smoke test

**Files:**
- Validate only: frontend build output and served UI.

- [ ] **Step 1: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: Vite build succeeds with no TypeScript or CSS errors.

- [ ] **Step 2: Start or reuse the Docker/app preview**

If the app is not already running locally on port `3080`, run:

```bash
docker compose up -d --build app
```

Expected: `zalo-crm-app` is `Up` and serves `http://localhost:3080/`.

- [ ] **Step 3: Verify Dashboard visually in browser**

Open `http://localhost:3080/` in the browser and verify:

```text
- No dashboard marquee is visible.
- Dashboard title still renders.
- Dashboard icon is the modern outline dashboard icon in primary/gold color.
- The top menu shows Huy Tran if there is no logged-in full name fallback.
- Top navigation icons look cleaner and consistent.
```

- [ ] **Step 4: Verify Tin nhắn visually in browser**

Open `http://localhost:3080/chat` in the browser and verify:

```text
- The + Thêm tag button has readable contrast in dark/golden theme.
- Conversation preview text in the left list is visibly larger than before.
- Message preview labels no longer show emoji-style prefixes.
- New-message and context menu icons render correctly.
```

- [ ] **Step 5: Check console for frontend errors**

In the browser devtools console, confirm there are no new Vue/Vuetify icon warnings or runtime errors caused by missing icon names.

### Task 6: Commit UI polish changes

**Files:**
- Commit:
  - `frontend/src/views/DashboardView.vue`
  - `frontend/src/layouts/DefaultLayout.vue`
  - `frontend/src/components/chat/TagCrmBar.vue`
  - `frontend/src/components/chat/ConversationList.vue`
  - `docs/superpowers/plans/2026-05-20-ui-polish-dashboard-chat-icons.md`

- [ ] **Step 1: Confirm changed files**

Run:

```bash
git status --short
```

Expected: modified frontend files and this plan file are visible. `.claude/` local artifacts may remain untracked and must not be staged.

- [ ] **Step 2: Review final diff**

Run:

```bash
git diff -- frontend/src/views/DashboardView.vue frontend/src/layouts/DefaultLayout.vue frontend/src/components/chat/TagCrmBar.vue frontend/src/components/chat/ConversationList.vue docs/superpowers/plans/2026-05-20-ui-polish-dashboard-chat-icons.md
```

Expected: diff contains only the requested UI polish and this plan.

- [ ] **Step 3: Stage only intended files**

Run:

```bash
git add frontend/src/views/DashboardView.vue frontend/src/layouts/DefaultLayout.vue frontend/src/components/chat/TagCrmBar.vue frontend/src/components/chat/ConversationList.vue docs/superpowers/plans/2026-05-20-ui-polish-dashboard-chat-icons.md
```

Expected: `.claude/`, deployment backups, screenshots, and unrelated files are not staged.

- [ ] **Step 4: Commit**

Run:

```bash
git commit -m "style(ui): polish dashboard and chat visuals" -m "Remove the dashboard marquee, update menu branding, fix chat tag contrast, improve conversation preview readability, and refresh visible icons for the golden redesign.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: commit succeeds.

## Self-review

- Spec coverage: The plan covers all requested changes: remove `dashboard-marquee`, replace `hsholding` with `Huy Tran`, fix unreadable `Thêm Tag`, increase chat conversation preview by 2px, and modernize visible icons in the affected navigation/chat/dashboard areas.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type/name consistency: All icon names are MDI strings used through existing Vuetify icon rendering; all file paths match the current frontend structure.
