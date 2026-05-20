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

- `.claude` local artifacts are intentionally excluded.
- The backup branch is local-only unless explicitly pushed: `backup/pwa1-golden-design-before-core-upgrade`.
- Prefer the two-layer apply order when upgrading across larger core changes because conflicts are easier to isolate.
