---
name: AI search history dual counts
overview: "Replace the single per-row annotation count in the AI Search history table with two columns: **Pending** (only `ai-pending` highlights for that tag+query on the current PDF) and **Total** (all saved, non-reply annotations on that document whose body text and schema tag match the row, including user-approved and manual)."
todos:
  - id: verify-manual
    content: Manually verify Pending/Total in UI with pending, approved, and manual tag+query matches
    status: completed
  - id: run-tests
    content: Run yarn test (or CI) to confirm claude-ai-search-user-message tests pass
    status: completed
isProject: false
---

# Dual counts in AI Search history rows

## Goal

For each history row (tag + query), show:


| Column      | Meaning                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pending** | Count of annotations that are still **AI-generated and awaiting moderation** (`ai-pending` tag), same as the row’s tag and query, on the **current document**.                                                                                                |
| **Total**   | Count of **all** annotations that belong to that row’s identity: same trimmed **query** (body text), same **schema tag** rules as the row, on the **current PDF**—including `ai-pending`, `ai-user-approved`, and **manually** created highlights that match. |


Replies are excluded; matching uses the same document URI as `[claude.firstPDFURI(store.searchUris())](src/sidebar/services/claude.ts)` in `[AISearchPanel](src/sidebar/components/search/AISearchPanel.tsx)`.

## Row identity (how an annotation “belongs” to a row)

- **Document:** `ann.uri === documentURL` (current PDF).
- **Query:** `norm(ann.text) === norm(row.query)` — the AI search query is stored as annotation body text (same as existing pending-AI logic).
- **Schema tag:** Reuse `[schemaTagMatchesSearchRow](src/sidebar/helpers/claude-ai-search-user-message.ts)` (non-empty tag: annotation tags include that tag; empty tag: only “content” tags after stripping `ai-pending` / `ai-user-approved`).
- **Pending:** `savedAnnotationMatchesAISearchRow` **and** `tags` includes `ai-pending`.

This is **not** `row.annotationIds.length` alone: that list tracks IDs created by the AI run flow but does not include manual adds; totals are computed by scanning `[store.savedAnnotations()](src/sidebar/store/modules/annotations.ts)`.

## Implementation (current codebase)

Already implemented in-tree:

1. `**[src/sidebar/helpers/claude-ai-search-user-message.ts](src/sidebar/helpers/claude-ai-search-user-message.ts)`**
  - `savedAnnotationMatchesAISearchRow`  
  - `countAISearchRowPendingAnnotations`  
  - `countAISearchRowTotalAnnotations`  
  - Private helper `countIf`
2. `**[src/sidebar/components/search/AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`**
  - `savedAnnotations = store.savedAnnotations()`  
  - Table columns **Pending** / **Total** with `title` tooltips  
  - If `documentURL` is null, both counts show `0`  
  - Caption text under the table explains the two counts
3. `**[src/sidebar/helpers/test/claude-ai-search-user-message-test.js](src/sidebar/helpers/test/claude-ai-search-user-message-test.js)`**
  - Tests for pending vs total, manual-only, replies / wrong URI excluded

## Optional follow-ups (not required for the feature)

- Run full `yarn test` locally if the bundled test run was not completed in CI.
- Tweak copy: column headers vs. footnote if you want shorter labels.

