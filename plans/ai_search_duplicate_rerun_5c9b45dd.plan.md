---
name: AI search duplicate rerun
overview: When the user submits the same trimmed tag + query as an existing history row from the AI Search Panel, delegate to the existing `onRerunRow` path so behavior matches the per-row refresh button (merge duplicates, delete pending annotations, replace row IDs).
todos:
  - id: dedupe-onAISearch
    content: "In AISearchPanel.tsx, async onAISearch: match trimmed tag+query to aiRows, call onRerunRow if found else runAISearch"
    status: completed
  - id: types-onSearch
    content: "Widen SearchField onSearch to (value: string) => void | Promise<void>"
    status: completed
  - id: followup-merge-reducer
    content: "If confirmed unused: consider removing mergeAISearchRowsWithSameTagQuery (see Follow-up in plan body)"
    status: cancelled
isProject: false
---

# Deduplicate AI Search submit vs history row

## Current behavior

- `[onAISearch](src/sidebar/components/search/AISearchPanel.tsx)` always calls `runAISearch(schemaTag, query)` with no `replaceRowId`, which **appends a new history row** via `store.addAISearchRow`.
- The history **refresh** control calls `[onRerunRow](src/sidebar/components/search/AISearchPanel.tsx)`, which: `mergeAISearchRowsWithSameTagQuery`, deletes pending `ai-pending` annotations for that tag+query on the current document, `removeAnnotationIdsFromAISearchRows`, then `runAISearch(..., { replaceRowId })`.

Row identity for merge/dedup is already defined in `[MERGE_AI_SEARCH_ROWS_SAME_TAG_QUERY](src/sidebar/store/modules/sidebar-panels.ts)`: `schemaTag.trim()` and `query.trim()` must match.

## Implementation

**File:** `[src/sidebar/components/search/AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`

1. Change `onAISearch` from a thin wrapper into an `async` function that:
  - Computes `tagKey = schemaTag.trim()` and `queryKey = query.trim()` (same normalization as the store).
  - Finds `matchingRow` in `aiRows` (`store.aiSearchRows()`) where `r.schemaTag.trim() === tagKey && r.query.trim() === queryKey`.
  - If `matchingRow` exists: `await onRerunRow(matchingRow)` and return.
  - Otherwise: `await runAISearch(schemaTag, query)` (existing behavior).
2. **Which row if multiple matches?** The merge reducer already unions rows with the same tag+query. `onRerunRow` begins with `mergeAISearchRowsWithSameTagQuery(row.id)`, so using `**find` / first match** is sufficient; any surviving row id works.

**File:** `[src/sidebar/components/search/SearchField.tsx](src/sidebar/components/search/SearchField.tsx)`

1. **Types:** `onAISearch` will be `async`, so `onSearch` must accept async handlers. Update `SearchFieldProps['onSearch']` to `(value: string) => void | Promise<void>`. No change to `onSubmit` is required (`SearchField` still does not `await` the callback; callers that return a `Promise` are fine).

## Tests

No `AISearchPanel` tests were found in-repo. Optional follow-up: add a small unit test around a extracted pure helper `matchesAiSearchRow(tag: string, query: string, row: AISearchRow): boolean` if you want coverage without mounting the panel; otherwise manual verification is enough for this small branch.

## Out of scope

- Changing merge semantics, persistence, or `runAISearch` / `onRerunRow` internals — not required.

## Follow-up (tech debt)

`onRerunRow` starts with `store.mergeAISearchRowsWithSameTagQuery(row.id)` to collapse duplicate history rows that share the same trimmed tag + query. After this plan is implemented, new duplicate rows from the search field should no longer be created, but duplicates could still exist from **persisted state**, **older behavior**, or **other code paths** that add rows.

**TODO:** Once the change has been in use, confirm whether `mergeAISearchRowsWithSameTagQuery` / `MERGE_AI_SEARCH_ROWS_SAME_TAG_QUERY` in `[sidebar-panels.ts](src/sidebar/store/modules/sidebar-panels.ts)` ever runs meaningfully. If it is effectively dead, consider removing that action and its call site in `onRerunRow` to reduce surface area.