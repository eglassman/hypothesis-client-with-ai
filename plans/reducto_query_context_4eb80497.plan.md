---
name: Reducto query context
overview: Before calling Reducto in `onAISearch`, build an augmented query string by collecting saved annotations in the sidebar store that target the current PDF, belong to the focused group, include both the trimmed schema tag and `ai-user-approved`, and append their `text` (prior AI search queries) to the user’s query sent to Reducto.
todos:
  - id: helper-or-inline
    content: Add filtering/sorting logic (helper optional) for approved + schema tag + uri + group
    status: pending
  - id: aisearchpanel-wire
    content: "In onAISearch: build reductoQuery, pass to reducto; keep payload.text and AISearchRow.query as raw user query"
    status: pending
  - id: tests
    content: Add unit tests for helper if extracted
    status: pending
isProject: false
---

# Append approved same-schema context to Reducto query

## Context (current behavior)

- `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`: `onAISearch(query)` calls `reducto.AISearchDocument({ query, candidateURIs, apiKey })`. New AI annotations are created with `text: query` and `tags: ['ai-pending', ...(schemaTag trimmed ? [schemaTag] : [])]`.
- `[annotations.ts](src/sidebar/services/annotations.ts)` (moderation): when an `ai-pending` annotation is approved, tags become `ai-user-approved` plus the remaining tags (including the schema tag).
- `[reducto.ts](src/sidebar/services/reducto.ts)`: the Reducto `extract.run` call embeds the request `query` in `instructions.system_prompt` (`Extract ... matching this query ...: ${query}`). Passing a longer `query` from the panel is enough; no change strictly required inside `ReductoService` unless you want formatting only in the service layer.

## Matching rules (what to include)

From `store.allAnnotations()`, include an annotation if **all** of the following hold:

1. **Saved**: `isSaved(ann)` (from `[annotation-metadata](src/sidebar/helpers/annotation-metadata.ts)`) so `text`/`tags`/`uri`/`group` are reliable.
2. **Schema tag**: `schemaTag.trim()` is non-empty and `ann.tags` includes that exact string **and** `ai-user-approved`.
  - If the schema tag field is empty, **do not** append historical context (no “same schema” to match).
3. **Same document**: `ann.uri === documentURL` where `documentURL = reducto.firstPDFURI(store.searchUris())` (same as the PDF used for the Reducto call). This avoids pulling in approved AI notes from other URIs.
4. **Same group**: `ann.group === store.focusedGroupId()` so you only reuse context from the current group.

Use each matching annotation’s `**text`** field as the prior query text (that is what AI search stored originally).

**Ordering**: Sort by `created` ascending so “previous” reads chronologically (oldest first). **Deduping**: Optionally drop duplicate `text` values so repeated queries do not bloat the prompt.

## Augmented query format

Build a single string passed as `query` into `AISearchDocument`, e.g.:

- User query first, then a short delimiter and a labeled list of prior approved queries (plain text is fine for the `system_prompt` interpolation).

Exact wording is a product choice; keep it stable and readable for the model (e.g. two newlines + a header like “Previously approved searches for this tag:” + bullet or numbered lines).

**Important**: The **created annotations** for this run should still use the **original** user `query` for `payload.text` and for the `AISearchRow.query` record (lines 102–116, 113–120), not the augmented string—only the Reducto call should see the augmented text.

## Implementation placement

- Primary change: `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)` inside `onAISearch`, after you resolve `documentURL` / `groupId` (or before the Reducto call—same early validation you already have for post-Reducto steps).  
  - Compute `tagTrim = schemaTag.trim()`.  
  - If `tagTrim`, derive `priorQueries` from `store.allAnnotations()` with the filters above; build `reductoQuery` from `query` + formatted `priorQueries`; call `reducto.AISearchDocument({ query: reductoQuery, ... })`.  
  - If `!tagTrim`, call with `query` unchanged.
- Optional small helper: e.g. `collectApprovedSchemaQueriesForReducto(...)` in `[src/sidebar/helpers/](src/sidebar/helpers/)` (or next to the panel) to keep `onAISearch` readable and to unit-test filtering/sorting without mounting UI.

## Limitations (explicit)

- Only annotations **already loaded** in the client appear in `allAnnotations()`. If you need history that was never loaded, that would require an API `search` by `tag` + `uri`—out of scope unless you want to add a fetch step.

## Tests (recommended)

- Unit test the helper (if extracted): fixtures with tags `['myschema', 'ai-user-approved']`, wrong URI/group, missing schema tag, and ordering/dedupe behavior.

No change to `[ModerationControl.tsx](src/sidebar/components/moderation/ModerationControl.tsx)` or tag palette unless you discover a tagging inconsistency.