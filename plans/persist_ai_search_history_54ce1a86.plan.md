---
name: Persist AI search history
overview: The AI search history table and per-tag colors live only in Redux (`sidebarPanels.aiSearch`), so each new browser tab starts with an empty table. Persist local edits with the same init + `watch()` pattern as PersistedDefaultsService; treat cross-tab updates using the repo’s only existing `storage` listener precedent—AuthService—plus tests modeled on auth-test.js.
todos:
  - id: reducer-hydrate
    content: Add HYDRATE/SET_AI_SEARCH_STATE reducer + action in sidebar-panels.ts
    status: completed
  - id: service-persist
    content: Implement PersistedAISearchService (init, watch persist, storage listener for cross-tab sync, payload dedupe)
    status: completed
  - id: wire-init
    content: Register service in injector and call init() in initServices before setupFrameSync
    status: completed
  - id: tests
    content: Extend sidebar-panels tests (hydrate); add persisted-ai-search tests modeled on auth-test.js storage events
    status: completed
isProject: false
---

# Persist AI search history across browser tabs

## What’s going wrong

- The “history widget” is the table in `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)` (columns: color picker, tag, query, `#`, remove). Row data and `schemaTagColors` come from Redux `[sidebarPanels.aiSearch](src/sidebar/store/modules/sidebar-panels.ts)`.
- The module comment already says this is **in-session** state only; there is no read/write to storage. Each **browser tab** loads a new sidebar bundle and a fresh store, so history is lost.
- Note: `reductoAPIKey` and the current schema tag **input** are `useState` in the same component and are also non-persistent; your question targets the **table + colors**, which is the right first fix. Persisting the API key would be a separate (sensitive) decision.

## Recommended approach

**Two layers** (Auth does **not** replace `watch()`): `[AuthService](src/sidebar/services/auth.ts)` persists OAuth tokens only at explicit save points and uses `storage` to invalidate cache when **another tab** writes the same key. Our `aiSearch` slice changes from many Redux actions, so we still need **subscribe → `setObject`** for local edits, same idea as `[PersistedDefaultsService](src/sidebar/services/persisted-defaults.ts)` + `watch()`. What Auth *does* supply is the **only in-repo precedent** for the `**storage` listener** and how to **test** it.

### Precedents in this repo

- **Read on startup + persist when Redux slice changes** — Model after `PersistedDefaultsService`: `init()` + `watch(store.subscribe, …)`; JSON-safe blob for the whole `aiSearch` slice.
- **When another tab writes the same key** — Model after `AuthService._listenForTokenStorageEvents`: `window.addEventListener('storage', ({ key }) => { … })`; only react when `key` matches our constant. Effect: re-load from `localStorage` into Redux via hydrate (Auth instead clears cache and reloads on next `getAccessToken()`).
- **Tests for cross-tab path** — Model after `[auth-test.js](src/sidebar/services/test/auth-test.js)` (*“when another client instance saves new tokens”*): synthetic `storage` `Event` with `key` set; assert hydrate runs and state matches. There are no equivalent tests for `PersistedDefaultsService` cross-tab (it does not listen for `storage`).

1. **Add a single “replace” reducer** on `[sidebar-panels.ts](src/sidebar/store/modules/sidebar-panels.ts)`, e.g. `HYDRATE_AI_SEARCH` / `SET_AI_SEARCH_STATE`, accepting a full `AISearchState`. Existing actions (`addAISearchRow`, etc.) stay as-is for normal edits; hydration is used for initial load **and** cross-tab updates.
2. **Add a small service** (e.g. `PersistedAISearchService` in `src/sidebar/services/persisted-ai-search.ts`) that:
  - Uses a stable key such as `hypothesis.aiSearch.history` (aligned with `hypothesis.privacy` / `hypothesis.groups.focus` in persisted defaults).
  - `**init()`**: `getObject` from `[LocalStorageService](src/sidebar/services/local-storage.ts)`, validate shape (rows: `id`, `schemaTag`, `query`, `annotationIds`; `schemaTagColors`: string record), then dispatch the hydrate action or fall back to empty state if corrupt.
  - `**watch()`** on `store.subscribe` for `() => store.getState().sidebarPanels.aiSearch` with `**JSON.stringify` comparison** (same idea as `[setupFrameSync](src/sidebar/index.tsx)` uses for `schemaTagColors`) so you only persist when the slice actually changes and avoid redundant writes.
  - **Cross-tab live sync (required)**: Register `storage` like Auth: in the service constructor or a dedicated private method, listen for `key === STORAGE_KEY`. On event, `getObject`, validate, dedupe against current Redux state, then dispatch hydrate. Handle `newValue === null` (key removed) if we ever clear storage.
  - **Deduplication (required)**: Before dispatching from a `storage` event, compare the incoming payload to the current Redux slice (e.g. `JSON.stringify` equality). If unchanged, skip dispatch to avoid redundant updates and churn (e.g. frame-sync palette pushes).
3. **Wire it in** `[initServices](src/sidebar/index.tsx)` next to `persistedDefaults.init()` so hydration runs **before** `setupFrameSync`, ensuring `pushAiSearchTagPalette()` sees restored colors when the sidebar connects to the host.

**Edge cases to accept or document**

- **Annotation IDs** in rows may not exist in a new tab until annotations load; the table still shows history; delete-row still tries to delete if IDs resolve (current behavior).
- **Sandboxed iframe**: `LocalStorageService` may fall back to in-memory storage; persistence would not survive reload in that environment (same limitation as other persisted defaults). Cross-tab sync also does not apply without shared `localStorage`.

## Tests

- Extend `[sidebar-panels-test.js](src/sidebar/store/modules/test/sidebar-panels-test.js)` for the new reducer (replace state; validate in service and only dispatch clean state).
- Optionally add a focused test for the persistence service if the project has similar patterns for `PersistedDefaultsService` (if not, reducer + manual QA is enough). Cross-tab behavior is often covered manually (two tabs).

## Out of scope (unless you want them later)

- Persisting `reductoAPIKey` (security / shared machine concerns).
- Scoping storage by `userid` (would avoid sharing history between accounts on one browser profile).

