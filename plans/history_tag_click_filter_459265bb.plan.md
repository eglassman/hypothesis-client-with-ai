---
name: History tag click filter
overview: Wire the AI search history table’s Tag column so a click sets the sidebar filter query to match that schema tag, reusing the existing `tag:` filter syntax and `store.setFilterQuery` pipeline that already drives `useRootThread` / `filterAnnotations`.
todos:
  - id: helper-tag-query
    content: Add filter-query-for-tag.ts helper under helpers/ + colocated tests
    status: completed
  - id: ui-tag-click
    content: Make AISearchPanel history Tag column call setFilterQuery for non-empty tags
    status: completed
  - id: verify-tests
    content: Run relevant unit tests
    status: completed
isProject: false
---

# Click tag in AI history to filter by tag

## Context

- The **history table** is the `<table>` inside `[src/sidebar/components/search/AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)` (rows from `aiRows`). The **Tag** column currently renders plain text only:

```703:707:src/sidebar/components/search/AISearchPanel.tsx
                          <td className="py-1 pr-2 align-middle break-all min-w-0 text-xs leading-snug">
                            {row.schemaTag || (
                              <span className="text-color-text-light">—</span>
                            )}
                          </td>
```

- Sidebar filtering is already centralized: `[useRootThread](src/sidebar/components/hooks/use-root-thread.ts)` passes `store.filterQuery()` into `[threadAnnotations](src/sidebar/helpers/thread-annotations.ts)`, which calls `[parseFilterQuery](src/sidebar/helpers/query-parser.ts)` and `[filterAnnotations](src/sidebar/helpers/filter-annotations.ts)`. The `**tag**` facet matches annotation tags (substring match on normalized strings per `stringFieldMatcher`).
- The store action `**store.setFilterQuery(query)**` (`[filters.ts](src/sidebar/store/modules/filters.ts)`) is the correct API; tests already use `setFilterQuery('tag:foo')` (`[selection-test.js](src/sidebar/store/modules/test/selection-test.js)`).

## Implementation

### 1. Build a safe filter string for an arbitrary tag

Introduce a **small dedicated module** under `[src/sidebar/helpers/](src/sidebar/helpers/)` (e.g. `filter-query-for-tag.ts`) with one exported function (e.g. `formatSidebarTagFilter`) that maps a tag string to a **single token** that `tokenize` + `parseFilterQuery` accept. Keep `query-parser.ts` unchanged; the helper can import `parseFilterQuery` only in tests for round-trip assertions.

- **Simple tags** (no whitespace, no ambiguity): `tag:${trimmed}` — matches existing tests (`tag:foo tag:bar`).
- **Tags with spaces or characters that break naive tokenization**: wrap the **entire** `tag:…` value in double quotes so the tokenizer treats it as one token (same idea as `parseHypothesisSearchQuery('user:"Dan Whaley"')` in `[query-parser-test.js](src/sidebar/helpers/test/query-parser-test.js)`). Concretely, prefer the pattern `**"tag:…"`** as one quoted token so the inner `tag:…` survives `removeSurroundingQuotes` and parses as a `tag` facet with the full value (including spaces). Escape embedded `"` in the tag if needed, or document that exotic tags are best-effort.

Add **unit tests** colocated as `[src/sidebar/helpers/test/filter-query-for-tag-test.js](src/sidebar/helpers/test/filter-query-for-tag-test.js)` (or matching name) that assert `parseFilterQuery(helper(tag)).tag.terms` equals the original tag for a few cases: simple, with spaces, optional edge case.

### 2. Make the Tag cell clickable in `AISearchPanel`

In the Tag `<td>` for each row:

- If `tagKey` is empty (the `—` row), keep non-interactive display.
- If `tagKey` is non-empty, render a **button** (`type="button"`) or focusable control with:
  - `onClick`: `store.setFilterQuery(formatSidebarTagFilter(tagKey))` (name as you choose).
  - **Styling**: `cursor-pointer`, hover state consistent with other subtle interactive text in the sidebar (e.g. `hover:underline` or `hover:text-color-text`), and `title` / `aria-label` like “Show annotations with tag …”.
  - **No** `event.preventDefault` needed unless wrapping a link; avoid navigation.

This only updates global filter state; the `[SearchField](src/sidebar/components/search/SearchField.tsx)` in the same panel already binds `query={filterQuery || null}`, so the field will reflect the new query immediately.

### 3. Panel close and filter state (accepted)

`[onActiveChanged](src/sidebar/components/search/AISearchPanel.tsx)` clears `setFilterQuery(null)` when the AI panel **closes**, so a tag-driven filter is cleared when the user dismisses the panel—same as typed queries in that field. **No change:** persist filter after close is out of scope; current behavior is intentional.

## Verification

- Manually: open AI search panel, ensure a row has a non-empty tag, click tag text → sidebar list shows only annotations whose tags match (per `filterAnnotations` semantics).
- Run existing tests plus new helper tests: `yarn test` (or project’s test command) for the touched areas.

## Files to touch (expected)


| File                                                                                                                        | Change                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `[src/sidebar/helpers/filter-query-for-tag.ts](src/sidebar/helpers/filter-query-for-tag.ts)` (name TBD)                     | New helper module + export                        |
| `[src/sidebar/helpers/test/filter-query-for-tag-test.js](src/sidebar/helpers/test/filter-query-for-tag-test.js)` (name TBD) | Round-trip tests with `parseFilterQuery`          |
| `[src/sidebar/components/search/AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`                        | Clickable Tag cell calling `store.setFilterQuery` |


No changes to `filter-annotations.ts` or the store are required if the query string is formed correctly.