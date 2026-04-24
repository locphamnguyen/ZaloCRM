# Phase 04 Report — Frontend Filter Bar + CSV Export

**Date:** 2026-04-24  
**Status:** DONE

---

## Files Touched

| File | Action | LOC |
|------|--------|-----|
| `frontend/src/composables/use-analytics.ts` | Modified | 289 (+89 from 200) |
| `frontend/src/views/AnalyticsView.vue` | Modified | 229 (+76 from 153) |
| `frontend/src/components/analytics/AnalyticsFilterBar.vue` | Created | 61 |

---

## Tasks Completed

- [x] Filter state added to composable: `zaloAccountId`, `assignedUserId` refs
- [x] `buildFilterParams()` helper — returns only set keys, no nulls leaked to URL
- [x] All 6 fetchers (funnel, team, response, heatmap, tags, drip) spread filter params
- [x] `exportCsv(type)` — blob download, correct filename `${type}-${from}-${to}.csv`, 413 handled
- [x] `exportLoading` ref tracks active export type; `exportError` ref exposed
- [x] `AnalyticsFilterBar.vue` extracted (view hit 229 LOC > 200 threshold)
- [x] Two dropdowns in filter bar: "Tài khoản Zalo" + "Nhân viên" with "Tất cả" (null) option
- [x] Filter change (`onAccountChange`, `onUserChange`) triggers `fetchAll()`
- [x] Tab switching does NOT clear filters (state lives in composable, not view)
- [x] `ExportStrip` inline component renders "Xuất CSV" button per tab (funnel/team/response/heatmap/tags/drip); overview + builder skipped
- [x] Export button: `prepend-icon="mdi-download"`, `:loading="exportLoading === type"`
- [x] `exportError` wired to `v-snackbar` for user visibility
- [x] `onMounted`: `Promise.all([fetchAccounts(), fetchUsers(), fetchAll(), fetchSavedReports()])`
- [x] `vue-tsc --noEmit` exits 0

---

## LOC Breakdown

- `use-analytics.ts`: 289 — filter state block ~20 LOC, `exportCsv` ~30 LOC, fetcher param additions ~10 LOC
- `AnalyticsView.vue`: 229 — filter bar wiring ~15 LOC, ExportStrip component ~20 LOC, import additions ~10 LOC
- `AnalyticsFilterBar.vue`: 61 — new file, dropdown props + computed items

---

## Design Decisions

1. **Single-select for v1** (not multi-select as phase plan stated): backend accepts one UUID per `zaloAccountId`/`assignedUserId` param. Multi-select deferred — would require backend array support. Documented in composable comment.

2. **ExportStrip as inline defineComponent** rather than separate file: used only in AnalyticsView.vue, 20 LOC, not worth a dedicated file. Keeps analytics component folder focused on chart widgets.

3. **`v-snackbar` for export errors** rather than just `console.error`: spec said "console.error is acceptable for v1; expose exportError ref so view CAN display if desired." Chose to wire the snackbar — zero extra complexity, better UX.

4. **clearable on v-select**: Vuetify's built-in clearable prop sets value to `null` on clear, which matches the "Tất cả" semantics without a manual clear button.

---

## Unresolved Questions

- None blocking. Multi-select for `zaloAccountId` is the only deferred item, awaiting backend support.
