# PWA1 and Golden Design Patch Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Mobile PWA v1 and the modern golden redesign as committed Git history, a backup branch, and reusable patch files before core upgrades continue.

**Architecture:** Treat the completed work as two explicit layers: Mobile PWA v1 from commit `bef9c07`, and golden redesign from the current worktree changes. Commit only intentional source/config/spec changes, create a local backup branch at the complete snapshot, then export layered patch files plus a combined patch under `docs/superpowers/patches/` with a README explaining apply order and verification.

**Tech Stack:** Git, unified diff patch files, Markdown documentation, Vue 3/Vuetify frontend assets, Docker Compose configuration.

---

## File map

- Modify/commit existing changed files:
  - `docker-compose.dev.yml` — Postgres dev healthcheck uses the actual database name.
  - `docker-compose.yml` — full-stack Postgres healthcheck uses the actual database name.
  - `frontend/index.html` — PWA manifest URL and theme color match golden PWA metadata.
  - `frontend/public/manifest.json` — static manifest fallback uses golden/dark PWA colors.
  - `frontend/src/assets/main.css` — global golden theme styling and Vietnamese font stack.
  - `frontend/src/assets/tokens.css` — golden-dark and smax-light theme-aware tokens.
  - `frontend/src/components/BottomNav.vue` — mobile bottom navigation golden styling.
  - `frontend/src/components/MobileQuickActions.vue` — mobile quick action FAB golden styling.
  - `frontend/src/layouts/DefaultLayout.vue` — desktop shell golden redesign and theme toggle.
  - `frontend/src/layouts/MobileLayout.vue` — mobile shell golden redesign and theme toggle.
  - `frontend/src/plugins/vuetify.ts` — `golden-dark` default theme and `smax-light` compatibility.
  - `frontend/src/views/LoginView.vue` — visible setup-status error on login page.
  - `docs/superpowers/specs/2026-05-20-pwa-design-patch-preservation-design.md` — approved preservation spec.
- Create:
  - `docs/superpowers/patches/2026-05-20-pwa1-mobile.patch` — Mobile PWA v1 patch from `bef9c07`.
  - `docs/superpowers/patches/2026-05-20-golden-design.patch` — golden redesign patch from the new design commit.
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch` — full combined patch from upstream baseline to preserved snapshot.
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md` — patch source, apply order, and verification notes.
- Do not commit:
  - `.claude/` — local Claude/browser artifacts.

## Baseline assumptions

- Current branch is `worktree-modern-golden-redesign`.
- `bef9c07` is the Mobile PWA v1 commit.
- `5a47da9` is the upstream baseline before PWA1 and golden redesign.
- `0c13808` is the local merge commit that brought PWA1 into `main`/the redesign worktree history.
- The design changes listed above are currently uncommitted.

### Task 1: Verify preservation preconditions

**Files:**
- Inspect only: Git metadata and working tree state.

- [ ] **Step 1: Confirm branch and changed files**

Run:

```bash
git status --short --branch
```

Expected: current branch is `worktree-modern-golden-redesign`; changed files include the design/config files listed in the File map; `.claude/` may be untracked.

- [ ] **Step 2: Confirm required source commits exist**

Run:

```bash
git rev-parse --verify bef9c07^{commit}
git rev-parse --verify 5a47da9^{commit}
git rev-parse --verify 0c13808^{commit}
```

Expected: each command prints a commit SHA and exits successfully.

- [ ] **Step 3: Confirm PWA1 commit is reachable from current HEAD**

Run:

```bash
git merge-base --is-ancestor bef9c07 HEAD
```

Expected: command exits with status `0` and prints no output.

### Task 2: Commit the preservation spec and golden design snapshot

**Files:**
- Modify/commit:
  - `docker-compose.dev.yml`
  - `docker-compose.yml`
  - `frontend/index.html`
  - `frontend/public/manifest.json`
  - `frontend/src/assets/main.css`
  - `frontend/src/assets/tokens.css`
  - `frontend/src/components/BottomNav.vue`
  - `frontend/src/components/MobileQuickActions.vue`
  - `frontend/src/layouts/DefaultLayout.vue`
  - `frontend/src/layouts/MobileLayout.vue`
  - `frontend/src/plugins/vuetify.ts`
  - `frontend/src/views/LoginView.vue`
  - `docs/superpowers/specs/2026-05-20-pwa-design-patch-preservation-design.md`
- Exclude:
  - `.claude/`

- [ ] **Step 1: Review the staged candidate diff**

Run:

```bash
git diff -- docker-compose.dev.yml docker-compose.yml frontend/index.html frontend/public/manifest.json frontend/src/assets/main.css frontend/src/assets/tokens.css frontend/src/components/BottomNav.vue frontend/src/components/MobileQuickActions.vue frontend/src/layouts/DefaultLayout.vue frontend/src/layouts/MobileLayout.vue frontend/src/plugins/vuetify.ts frontend/src/views/LoginView.vue docs/superpowers/specs/2026-05-20-pwa-design-patch-preservation-design.md
```

Expected: diff contains only golden redesign, PWA metadata, Docker healthcheck, login setup-status UX, and preservation spec changes.

- [ ] **Step 2: Stage only intentional files**

Run:

```bash
git add docker-compose.dev.yml docker-compose.yml frontend/index.html frontend/public/manifest.json frontend/src/assets/main.css frontend/src/assets/tokens.css frontend/src/components/BottomNav.vue frontend/src/components/MobileQuickActions.vue frontend/src/layouts/DefaultLayout.vue frontend/src/layouts/MobileLayout.vue frontend/src/plugins/vuetify.ts frontend/src/views/LoginView.vue docs/superpowers/specs/2026-05-20-pwa-design-patch-preservation-design.md
```

Expected: command exits successfully; `.claude/` remains untracked and unstaged.

- [ ] **Step 3: Confirm staged files exclude local artifacts**

Run:

```bash
git diff --cached --name-only
```

Expected output contains exactly these paths:

```text
docker-compose.dev.yml
docker-compose.yml
docs/superpowers/specs/2026-05-20-pwa-design-patch-preservation-design.md
frontend/index.html
frontend/public/manifest.json
frontend/src/assets/main.css
frontend/src/assets/tokens.css
frontend/src/components/BottomNav.vue
frontend/src/components/MobileQuickActions.vue
frontend/src/layouts/DefaultLayout.vue
frontend/src/layouts/MobileLayout.vue
frontend/src/plugins/vuetify.ts
frontend/src/views/LoginView.vue
```

- [ ] **Step 4: Commit golden design snapshot**

Run:

```bash
git commit -m "feat(ui): preserve golden redesign snapshot" -m "Commit the modern golden theme, PWA metadata alignment, Docker healthcheck fixes, and login setup-status feedback so the work can be exported as a reusable patch before core upgrades continue.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: commit succeeds and creates a new commit on `worktree-modern-golden-redesign`.

### Task 3: Create backup branch

**Files:**
- Git refs only.

- [ ] **Step 1: Capture the preserved snapshot commit**

Run:

```bash
git rev-parse HEAD
```

Expected: prints the new golden design snapshot commit SHA.

- [ ] **Step 2: Create or update the local backup branch**

Run:

```bash
git branch -f backup/pwa1-golden-design-before-core-upgrade HEAD
```

Expected: local branch `backup/pwa1-golden-design-before-core-upgrade` points at current HEAD.

- [ ] **Step 3: Verify backup branch points at snapshot**

Run:

```bash
git rev-parse backup/pwa1-golden-design-before-core-upgrade
git rev-parse HEAD
```

Expected: both commands print the same commit SHA.

### Task 4: Create patch artifacts

**Files:**
- Create:
  - `docs/superpowers/patches/2026-05-20-pwa1-mobile.patch`
  - `docs/superpowers/patches/2026-05-20-golden-design.patch`
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch`
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md`

- [ ] **Step 1: Create patch directory**

Run:

```bash
mkdir -p docs/superpowers/patches
```

Expected: directory exists.

- [ ] **Step 2: Export Mobile PWA v1 patch**

Run:

```bash
git format-patch -1 bef9c07 --stdout > docs/superpowers/patches/2026-05-20-pwa1-mobile.patch
```

Expected: patch file exists and contains commit subject `feat(pwa): add mobile offline app shell`.

- [ ] **Step 3: Export golden design patch**

Run:

```bash
git format-patch -1 HEAD --stdout > docs/superpowers/patches/2026-05-20-golden-design.patch
```

Expected: patch file exists and contains commit subject `feat(ui): preserve golden redesign snapshot`.

- [ ] **Step 4: Export combined patch from upstream baseline**

Run:

```bash
git diff --binary 5a47da9..HEAD > docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch
```

Expected: combined patch exists and includes both PWA1 files and golden redesign files.

- [ ] **Step 5: Write patch README**

Create `docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md` with this exact content:

```markdown
# PWA1 + Golden Design Patch Bundle

## Purpose

This bundle preserves two completed ZaloCRM updates before core upgrade work continues:

1. Mobile PWA v1 from commit `bef9c07`.
2. Modern golden redesign from commit `backup/pwa1-golden-design-before-core-upgrade` at the time this bundle was created.

Use these patches when a core upgrade branch needs to re-apply the completed PWA and design work without depending on the original worktree.

## Files

- `2026-05-20-pwa1-mobile.patch` — one commit patch for Mobile PWA v1.
- `2026-05-20-golden-design.patch` — one commit patch for the golden redesign snapshot.
- `2026-05-20-pwa1-golden-design-combined.patch` — combined diff from upstream baseline `5a47da9` to the preserved snapshot.

## Recommended apply order

From a core-upgrade branch based on a newer upstream/core baseline:

```bash
git apply --check docs/superpowers/patches/2026-05-20-pwa1-mobile.patch
git am docs/superpowers/patches/2026-05-20-pwa1-mobile.patch

git apply --check docs/superpowers/patches/2026-05-20-golden-design.patch
git am docs/superpowers/patches/2026-05-20-golden-design.patch
```

If the upgraded branch is close to baseline `5a47da9`, the combined patch can be checked and applied instead:

```bash
git apply --check docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch
git apply docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch
```

## Verification after applying

Run the strongest available validation for the target branch:

```bash
npm --prefix frontend run build
docker compose build app
```

If Docker disk space is tight, run the frontend build first and defer Docker validation until space is available.

## Notes

- `.claude/` local artifacts are intentionally excluded.
- The backup branch is local-only unless explicitly pushed: `backup/pwa1-golden-design-before-core-upgrade`.
- Prefer the two-layer apply order when upgrading across larger core changes because conflicts are easier to isolate.
```

Expected: README exists with source commits, apply commands, verification commands, and local artifact warning.

### Task 5: Validate patch artifacts

**Files:**
- Inspect:
  - `docs/superpowers/patches/2026-05-20-pwa1-mobile.patch`
  - `docs/superpowers/patches/2026-05-20-golden-design.patch`
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch`
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md`

- [ ] **Step 1: Confirm patch files are non-empty**

Run:

```bash
wc -c docs/superpowers/patches/2026-05-20-pwa1-mobile.patch docs/superpowers/patches/2026-05-20-golden-design.patch docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md
```

Expected: each file has size greater than `0` bytes.

- [ ] **Step 2: Confirm no `.claude/` paths are in patches**

Run:

```bash
! grep -R "\.claude/" docs/superpowers/patches/2026-05-20-pwa1-mobile.patch docs/superpowers/patches/2026-05-20-golden-design.patch docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch
```

Expected: command exits with status `0`, meaning no `.claude/` paths were found.

- [ ] **Step 3: Confirm patch subjects are correct**

Run:

```bash
grep -E "^Subject: \[PATCH\]" docs/superpowers/patches/2026-05-20-pwa1-mobile.patch docs/superpowers/patches/2026-05-20-golden-design.patch
```

Expected output includes:

```text
Subject: [PATCH] feat(pwa): add mobile offline app shell
Subject: [PATCH] feat(ui): preserve golden redesign snapshot
```

- [ ] **Step 4: Validate combined patch against upstream baseline in a temporary index**

Run:

```bash
git worktree add --detach /tmp/zalocrm-patch-check-2026-05-20 5a47da9
git -C /tmp/zalocrm-patch-check-2026-05-20 apply --check "$PWD/docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch"
git worktree remove /tmp/zalocrm-patch-check-2026-05-20
```

Expected: `git apply --check` succeeds and temporary worktree is removed.

### Task 6: Commit patch artifacts

**Files:**
- Commit:
  - `docs/superpowers/patches/2026-05-20-pwa1-mobile.patch`
  - `docs/superpowers/patches/2026-05-20-golden-design.patch`
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch`
  - `docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md`
  - `docs/superpowers/plans/2026-05-20-pwa-design-patch-preservation.md`

- [ ] **Step 1: Stage patch artifacts and this plan**

Run:

```bash
git add docs/superpowers/patches/2026-05-20-pwa1-mobile.patch docs/superpowers/patches/2026-05-20-golden-design.patch docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md docs/superpowers/plans/2026-05-20-pwa-design-patch-preservation.md
```

Expected: command exits successfully.

- [ ] **Step 2: Confirm staged artifact files**

Run:

```bash
git diff --cached --name-only
```

Expected output contains the four files under `docs/superpowers/patches/` and the plan file. It must not contain `.claude/`.

- [ ] **Step 3: Commit patch artifact bundle**

Run:

```bash
git commit -m "chore: add pwa and design patch bundle" -m "Store portable patch artifacts and apply instructions for preserving Mobile PWA v1 and the golden redesign during upcoming core upgrades.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: commit succeeds and records patch files plus the implementation plan.

### Task 7: Final verification and handoff

**Files:**
- Inspect Git state and refs only.

- [ ] **Step 1: Confirm backup branch still points at preserved design snapshot or later artifact commit**

Run:

```bash
git log --oneline --decorate -5

git rev-parse backup/pwa1-golden-design-before-core-upgrade
```

Expected: backup branch exists. If it points at the design snapshot commit instead of the later patch-artifact commit, that is acceptable because the spec defines it as the complete product snapshot. If desired, update it to current HEAD with:

```bash
git branch -f backup/pwa1-golden-design-before-core-upgrade HEAD
```

- [ ] **Step 2: Confirm final status excludes intentional local artifacts only**

Run:

```bash
git status --short --branch
```

Expected: no modified tracked files. `.claude/` may remain untracked.

- [ ] **Step 3: Report preservation outputs**

Report these paths and refs to the user:

```text
Backup branch: backup/pwa1-golden-design-before-core-upgrade
PWA1 patch: docs/superpowers/patches/2026-05-20-pwa1-mobile.patch
Golden design patch: docs/superpowers/patches/2026-05-20-golden-design.patch
Combined patch: docs/superpowers/patches/2026-05-20-pwa1-golden-design-combined.patch
README: docs/superpowers/patches/2026-05-20-pwa1-golden-design-README.md
```

Expected: user has clear recovery/apply instructions before core upgrade work begins.

## Self-review

- Spec coverage: The plan commits the design snapshot, creates the backup branch, exports PWA/design/combined patches, writes README instructions, excludes `.claude/`, validates patches, and does not upgrade core.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type/name consistency: Patch names, branch name, source commits, and file paths match the approved spec.
