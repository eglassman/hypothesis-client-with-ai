---
name: Filter duplicate AI quotes
overview: Before creating Hypothesis annotations from Claude quote results, skip any quote whose text and schema tag already match a saved annotation on the same document URI—so reruns and repeat searches cannot add overlapping ai-pending copies next to existing approved (or other) highlights.
todos:
  - id: helper
    content: Add filterAiSearchQuotesAgainstExisting (or similar) in claude-ai-search-user-message.ts with tag+quote matching rules
    status: completed
  - id: panel
    content: Call helper in AISearchPanel runAISearch before api.annotation.create; success toast must mention skipped count when raw quotes > filtered (e.g. “Skipped N already covered”)
    status: completed
  - id: tests
    content: Unit tests in claude-ai-search-user-message-test.js for approved/pending/empty-schema cases
    status: completed
isProject: false
---

# Filter AI quotes that duplicate existing tag+quote

## Root cause

In `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`, `runAISearch` creates one API annotation per returned quote with no check against the store ([~157–178](src/sidebar/components/search/AISearchPanel.tsx)).

`[onRerunRow](src/sidebar/components/search/AISearchPanel.tsx)` only deletes `**ai-pending**` annotations that match tag+query (`[isPendingAISearchAnnotation](src/sidebar/components/search/AISearchPanel.tsx)`). `**ai-user-approved**` rows stay on the server. After reload, Claude often returns the same quotes again → **new `ai-pending`** annotations sit beside **unchanged approved** ones with the same `TextQuoteSelector.exact` and schema tag.

`[buildCandidateRows](src/sidebar/helpers/claude-ai-search-user-message.ts)` already **excludes** `ai-pending` from training triples (lines 83–85), so the model does not “see” pending as positives; that does not stop **creation** of duplicates.

## Approach

**Match key (same as your rule):** document URI + **normalized quote text** + **schema tag** alignment.

- **Quote:** use `[quote(ann)](src/sidebar/helpers/annotation-metadata.ts)` from `annotation-metadata` and compare to each AI quote `text` with the same trimming as elsewhere (`norm` / `.trim()`).
- **Schema tag:** derive “content” tags by stripping `ai-pending` and `ai-user-approved` (same idea as `[formatTagColumnForSetA](src/sidebar/helpers/claude-ai-search-user-message.ts)`). For the current search, `schemaTagTrim == tagTrim` is the schema tag string for this row (possibly empty).
  - **Non-empty `schemaTagTrim`:** treat as duplicate if an existing annotation on that URI has the same quote and **includes** `schemaTagTrim` in `tags` (covers both pending + schema and approved + schema).
  - **Empty `schemaTagTrim`:** treat as duplicate if quote matches and the annotation has **no** content tags (only system tags like `ai-pending` / `ai-user-approved`), matching `[expectedTagsForAISearch('')](src/sidebar/components/search/AISearchPanel.tsx)`.

**Scope:** consider all `**store.savedAnnotations()`** on `documentURL` where `quote(ann)` is non-null (skip replies if you want parity with triples—`[isReply](src/sidebar/helpers/annotation-metadata.ts)` optional).

**Where to implement**

1. **Add a small exported helper** (e.g. `filterAiSearchQuotesAgainstExisting` or `quotesNotDuplicatingExisting`) in `[claude-ai-search-user-message.ts](src/sidebar/helpers/claude-ai-search-user-message.ts)` next to existing AISearch helpers, taking `(quotes: { text?: string }[], savedAnnotations: SavedAnnotation[], documentUri: string, schemaTagTrim: string) => { text?: string }[]` so it can be unit-tested without the panel. Reuse `norm` and `quote` imports; keep `AI_PENDING` / `AI_USER_APPROVED` constants consistent.
2. **In `runAISearch`**, after `quotes` is built from `claudeResult` and **before** the create loop, set `quotes = filter...(quotes, store.savedAnnotations(), documentURL, tagTrim)` (or assign to a new variable). Keep the **raw** count vs **filtered** count so the success toast can report both created count and skips.
3. **Toast (required):** if any quotes were skipped because they duplicated existing tag+quote (`rawLength > filteredLength`), extend the success `toastMessenger.success` message to include that fact—e.g. append “Skipped N already covered.” (or equivalent copy) where `N = rawLength - filteredLength`. When `N === 0`, keep the existing success wording (e.g. only “Created M annotation(s)…”) without a skip line.

## Tests

- Add cases in `[claude-ai-search-user-message-test.js](src/sidebar/helpers/test/claude-ai-search-user-message-test.js)`: e.g. when a saved annotation has `ai-user-approved` + schema tag + matching `TextQuoteSelector`, AI quotes containing that exact text are dropped; when quote differs, kept; empty schema tag case if applicable.

## Out of scope (unless you want them later)

- Deduping **within** a single Claude response (identical quote strings repeated).
- **Query** mismatch: your rule is tag+quote only; two different queries with same quote+tag would still skip one creation (usually desirable).

