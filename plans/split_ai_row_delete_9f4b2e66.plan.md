---
name: Split AI row delete
overview: "Replace the single history-row delete control with delete pending (strict, same as onRerunRow) and delete-all (conditional: remove row tag vs full delete by content-tag count; confirm). Centralize helpers; align Pending count with strict pending."
todos:
  - id: helpers-strict-pending
    content: Centralize strict pending + contentTags helper; update countAISearchRowPendingAnnotations; list helpers for strict pending and for total matches; helper(s) for delete-all decision (patch remove tag vs delete)
    status: completed
  - id: panel-ui-handlers
    content: "AISearchPanel: two buttons; onDeletePending; onDeleteAll with confirm text reflecting conditional behavior; PATCH vs DELETE via annotations service; store/row id cleanup"
    status: completed
  - id: tests
    content: claude-ai-search-user-message-test.js — strict pending; delete-all (multi-tag PATCH, single-tag delete, empty-schema always delete)
    status: completed
isProject: false
---

# Split AI search history row delete actions

## Current behavior

- `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`: one `CancelIcon` button calls `onDeleteRow`, which deletes annotations by iterating `**row.annotationIds` only**, then `removeAISearchRow(row.id)`.
- **Pending** / **Total** columns use `[countAISearchRowPendingAnnotations](src/sidebar/helpers/claude-ai-search-user-message.ts)` and `[countAISearchRowTotalAnnotations](src/sidebar/helpers/claude-ai-search-user-message.ts)`. Today, pending count uses `**savedAnnotationMatchesAISearchRow`** plus `ai-pending` in tags (looser than rerun).
- `**onRerunRow`** uses local helpers `[isPendingAISearchAnnotation](src/sidebar/components/search/AISearchPanel.tsx)` / `tagsMatchAISearchPending`: exact tag list `['ai-pending']` or `['ai-pending', schemaTag]` (fixed order and length), same document URI, body text equals query — **stricter**.

So the single delete is not guaranteed to match **Total** if some matching annotations were never stored in `row.annotationIds`.

## Target behavior

### Strict pending (same as rerun)

An annotation is “pending” for delete / count / rerun iff:

- `ann.uri === documentURL`, `(ann.text ?? '').trim() === queryTrimmed`, and
- tags match **exactly** `expectedTagsForAISearch(schemaTagTrimmed)` — i.e. `['ai-pending']` or `['ai-pending', schemaTag]` with no extra tags and correct order (same logic currently in `AISearchPanel`), where `schemaTagTrimmed` is `**row.schemaTag.trim()`** for that history row.


| Action                     | Effect                                                      | Row in history                                                      |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| **Delete pending**         | Delete every annotation in the **strict** pending set above | **Keep** the row; `removeAnnotationIdsFromAISearchRows(deletedIds)` |
| **Delete all** (rightmost) | See **Delete-all (conditional)** below                      | **Remove** this row after work completes; keep ids/store consistent |


**Pending column:** Update `[countAISearchRowPendingAnnotations](src/sidebar/helpers/claude-ai-search-user-message.ts)` to use this **strict** definition so the displayed number matches “delete pending” and rerun.

### Delete-all (conditional) — multi-tag safety

Define **content tags** on an annotation as: `tags.filter(t => t !== 'ai-user-approved' && t !== 'ai-pending')` (same idea as `[contentTags](src/sidebar/helpers/claude-ai-search-user-message.ts)` elsewhere).

For each annotation that **matches this row** for “delete all” (same predicate as **Total**: `[savedAnnotationMatchesAISearchRow](src/sidebar/helpers/claude-ai-search-user-message.ts)` for this row’s document URI, schema tag, and query):

1. **If the history row has a non-empty schema tag and the annotation has more than one content tag**
  Do **not** delete the annotation. **Remove only this row’s schema tag** from the annotation (`row.schemaTag` trimmed). Implementation: **PATCH/update** via the annotations API; leave other content tags untouched.
2. **Otherwise (single content tag, or empty-schema row — see below)**
  **Delete the entire annotation** via the existing delete path.

Intended user story: the **first** delete-all (for one of several tags on the same annotation) **drops that tag**; when **only one** content tag remains, the delete-all for the row tied to **that** remaining tag **removes the whole annotation**.

### Empty schema tag row (resolved)

`[schemaTagMatchesSearchRow](src/sidebar/helpers/claude-ai-search-user-message.ts)` with an **empty** `schemaTagTrim` matches only annotations whose **content tags are empty** (only `ai-pending` / `ai-user-approved` may appear). So every Total match for an **empty-schema** row has **zero** content tags.

There is **no named schema tag to remove** via PATCH for that row. **Delete-all for an empty-schema row always DELETEs** each matching annotation (same as the “single content tag” outcome: nothing to strip incrementally).

**Note:** If a user later adds a content tag to such an annotation, it **stops matching** the empty-schema row, so it would not appear in that row’s Total anymore.

### Confirmation dialog

**Delete all** still uses `confirm` from `@hypothesis/frontend-shared`, but the **message** must describe the **conditional** behavior: removing this row’s tag when other content tags remain, **fully deleting** when only this row’s content tag remains (plus system tags), and **fully deleting** all matches for **empty-schema** rows (no tag to strip). Adjust **confirm** label accordingly. No separate confirmation for delete pending unless you add it later.

### Store / history rows after PATCH

When an annotation is **updated** (tag removed) instead of deleted:

- It may **fall out** of this row’s Total set — remove its id from `[removeAnnotationIdsFromAISearchRows](src/sidebar/store/modules/sidebar-panels.ts)` / any row that referenced it, and ensure other rows’ `annotationIds` stay accurate if the same id appeared on multiple rows.

When an annotation is **deleted**, same cleanup as today.

After processing, **remove the current history row** (`removeAISearchRow(row.id)`), matching the product goal that this row’s action is “done” for that tag+query slot.

## Implementation steps

### 1. Helpers

In `[claude-ai-search-user-message.ts](src/sidebar/helpers/claude-ai-search-user-message.ts)`:

- Centralize **strict pending** (move from `AISearchPanel`) and `**contentTags`** / **content tag count** for delete-all decisions.
- Export predicates/lists: strict pending list; list matching **Total** for a row.
- Export a small **pure** helper, e.g. `deleteAllActionForAISearchRowMatch(ann, rowSchemaTagTrimmed): 'removeRowTag' | 'deleteAnnotation'`, encoding: **empty schema or ≤1 content tag → delete**; **non-empty schema and >1 content tags → remove row tag** (PATCH).

### 2. Panel

- `**onRerunRow`**: use shared strict pending helper (drop duplicate locals).
- `**onDeletePending`**: strict list → delete each → `removeAnnotationIdsFromAISearchRows`.
- `**onDeleteAll**`: `await confirm(...)` → for each Total match, branch PATCH (remove row tag) vs DELETE → row/history cleanup → `removeAISearchRow`.

Use existing `[AnnotationsService](src/sidebar/services/annotations.ts)` patterns for update vs delete (follow how edits save tag changes elsewhere if present).

### 3. Tests

- Strict pending count/list; Total list.
- **Delete-all rules:** two content tags + non-empty row tag → `removeRowTag`; one content tag → `deleteAnnotation`; **empty-schema row** → always `deleteAnnotation` for matches (zero content tags).

## Files to touch

- `[src/sidebar/helpers/claude-ai-search-user-message.ts](src/sidebar/helpers/claude-ai-search-user-message.ts)` — strict pending, content-tag helpers, delete-all decision + lists.
- `[src/sidebar/components/search/AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)` — handlers, `confirm`, two buttons.
- `[src/sidebar/helpers/test/claude-ai-search-user-message-test.js](src/sidebar/helpers/test/claude-ai-search-user-message-test.js)` — coverage above.
- Possibly `[src/sidebar/services/annotations.ts](src/sidebar/services/annotations.ts)` only if a thin wrapper for “update tags only” is missing.

No change to `[persisted-ai-search.ts](src/sidebar/services/persisted-ai-search.ts)` unless row shape changes (unlikely).