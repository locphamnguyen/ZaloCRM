# PWA1 and Golden Design Patch Preservation Design

## Goal

Preserve the completed Mobile PWA v1 and modern golden redesign work as reusable patch artifacts plus a branch backup, so core upgrades can proceed without losing or entangling these updates.

## Context

Mobile PWA v1 is already represented by commit `bef9c07` and merged into the local `main` history through merge commit `0c13808`. The modern golden redesign is currently present as uncommitted work in `worktree-modern-golden-redesign`, covering theme tokens, Vuetify theme setup, desktop/mobile shell styling, PWA metadata, Docker healthchecks, and login setup-status error feedback.

The preservation workflow must not include local Claude artifacts such as `.claude/` in either commits or patch files.

## Approach

Use a two-layer preservation model:

1. **Git backup:** commit the golden redesign work on the existing `worktree-modern-golden-redesign` branch, then create a clearly named backup branch pointing at the complete PWA1 + golden redesign snapshot.
2. **Patch artifacts:** export separate patch files for PWA1 and golden redesign, plus a combined patch from the upstream baseline to the complete snapshot.

This gives two recovery paths. Git history supports normal cherry-pick, merge, and diff workflows. Patch files provide a portable fallback if the core upgrade happens on a separate branch, clone, or upstream release state.

## Patch layers

### Layer 1: Mobile PWA v1

Source commit: `bef9c07`.

This patch preserves the installable PWA shell, service worker registration, offline fallback route, mobile offline indicator, and queued mobile chat message behavior.

### Layer 2: Modern golden redesign

Source: the new commit created from the current uncommitted design changes.

This patch preserves the golden dark Vuetify theme, Smax light compatibility, theme-aware CSS tokens, global component styling, desktop and mobile shell redesign, mobile navigation/FAB styling, Vietnamese font stack, corrected PWA metadata, Docker Postgres healthchecks, and setup-status error feedback on the login screen.

### Combined patch

Source range: upstream baseline (`origin/main`/`upstream/main` at `5a47da9`) through the complete preserved snapshot.

This patch is for applying the full PWA1 + golden design bundle in one step when a layered apply is unnecessary.

## Artifact layout

Create patch artifacts under `docs/superpowers/patches/`:

- `2026-05-20-pwa1-mobile.patch`
- `2026-05-20-golden-design.patch`
- `2026-05-20-pwa1-golden-design-combined.patch`
- `2026-05-20-pwa1-golden-design-README.md`

The README explains source commits, apply order, verification commands, and known conflict expectations.

## Backup branch

Create a local branch named:

`backup/pwa1-golden-design-before-core-upgrade`

The branch points at the complete preserved snapshot after the golden redesign commit. It should not be pushed unless explicitly requested.

## Apply workflow after core upgrade

For a new core-upgrade branch:

1. Start from the target upgraded core baseline.
2. Apply `2026-05-20-pwa1-mobile.patch`.
3. Build and resolve conflicts if needed.
4. Apply `2026-05-20-golden-design.patch`.
5. Build and run Docker validation.
6. If the upgraded core is close to the current baseline, the combined patch can be used instead of the two-step apply.

## Verification

After creating the preservation artifacts:

- Confirm the working tree is clean except intentionally untracked local artifacts.
- Confirm the backup branch points at the preserved snapshot.
- Confirm patch files exist and are non-empty.
- Confirm `git apply --check` succeeds for patches against the intended baseline when practical.
- Run the frontend build or Docker build if dependencies and disk space allow.

## Non-goals

- Do not upgrade core in this workflow.
- Do not reset or rewrite existing history.
- Do not push branches or create PRs unless explicitly requested.
- Do not include `.claude/` artifacts in commits or patch files.
