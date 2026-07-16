---
name: AI Search multiline + button
overview: Extend the shared SearchField with an optional multiline field plus a full-width "Ask the AI" submit button below the textarea for the AI panel, add busy state around `onAISearch` so the button, field, and table row actions (rerun/delete) disable during a top-level AI search, and preserve Enter-to-submit with a multiline-friendly key rule (Enter submits, Shift+Enter newline).
todos:
  - id: extend-search-field
    content: Add optional multiline textarea, full-width Ask-the-AI button below field, Enter/Shift+Enter, busy/disabled wiring in SearchField.tsx
    status: completed
  - id: aisearch-busy-state
    content: Add aiSearchBusy + try/finally in onAISearch; pass props from AISearchPanel; add || aiSearchBusy to row Rerun/Delete disabled; widen inputRef type
    status: completed
  - id: tests-search-field
    content: Update SearchField-test.js for multiline, submit button, and keyboard behavior
    status: completed
isProject: false
---

# AI Search: multiline field and "Ask the AI" button

## Current behavior

- `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)` renders the shared `[SearchField.tsx](src/sidebar/components/search/SearchField.tsx)` with `onSearch={onAISearch}`, `query={filterQuery}`, and `disabled={hasSelection}`. Submit is the left **search icon** (`type="submit"`) plus implicit form submit on Enter (single-line `<Input>`).
- Row **Rerun / Delete pending / Delete all** buttons disable while work is in flight via `rerunningRowId === row.id` or `deletingRowId === row.id` ([see disabled predicates](src/sidebar/components/search/AISearchPanel.tsx) around the rerun and delete buttons).
- There is **no** busy flag for a **new** search from the top field—only `onRerunRow` sets `rerunningRowId`.

## 1) Multiline query field

**Where:** Prefer extending `[SearchField.tsx](src/sidebar/components/search/SearchField.tsx)` with **optional** props so `[SearchPanel.tsx](src/sidebar/components/search/SearchPanel.tsx)` and `[StreamSearchInput.tsx](src/sidebar/components/search/StreamSearchInput.tsx)` stay unchanged.

**Suggested props (all optional, defaults preserve current UI):**

- `multiline?: boolean` — when `true`, render a `<textarea>` instead of `Input` (the shared `Input` component is used for single-line search elsewhere; a styled `<textarea>` matching existing typography/padding tokens is the straightforward path).
- `rows?: number` — e.g. default `4` when `multiline` is true so several lines of text are visible without scrolling.
- Widen `inputRef` / `onKeyDown` types to accept `HTMLTextAreaElement` where needed so `[SidebarPanel](src/sidebar/components/SidebarPanel.tsx)` `initialFocus` still works (it already accepts `HTMLElement`).

**Enter vs newline:** In a `<textarea>`, plain Enter inserts a newline by default. To keep **Enter = submit** (as today) **and** allow multi-line editing, implement the usual chat-style rule: **Enter** submits the form (call the same logic as `onSubmit`); **Shift+Enter** inserts a newline (`preventDefault` only for bare Enter). Compose this with the existing `onKeyDown` from `AISearchPanel` (Escape closes) via a wrapper that calls the consumer handler first, then handles Enter.

**Clear control:** Keep the clear (`CancelIcon`) behavior; adjust absolute positioning for multiline (e.g. pin to top-right of the textarea container instead of vertical center) so it stays usable.

## 2) "Ask the AI" button + same disable semantics as row actions

**Layout:** When the AI variant is enabled, stack **vertically**: the multiline query **textarea** is **full width** on the first row; the primary submit control labeled **"Ask the AI"** sits **below** the textarea and spans the **full width** of the form (e.g. `w-full` / block `Button`). Use `Button` from `@hypothesis/frontend-shared`, `type="submit"`. For this variant, **remove or hide the left magnifying-glass submit** so there is a single obvious primary action (avoids duplicate submit controls).

**Busy state:** Introduce something like `aiSearchBusy` (or `isAISearchSubmitting`) in `AISearchPanel`, set `true` at the start of `onAISearch` and `false` in `finally`. Pass `disabled={hasSelection || aiSearchBusy}` into `SearchField` (and merge with existing `store.isLoading()` behavior inside `SearchField` as today).

That gives you: **inactive "Ask the AI" button and non-editable/disabled field while the async `onAISearch` path runs**, analogous to row buttons being disabled when `deletingRowId` / `rerunningRowId` is set.

**Row actions during top-level search:** Add `|| aiSearchBusy` to every **table** row action `disabled` expression — **Rerun**, **Delete pending**, and **Delete all** — so users cannot start a rerun or delete while a search from the main field is in progress. This prevents overlapping operations.

## 3) Wire-up in `AISearchPanel`

- Update `inputRef` type to include `HTMLTextAreaElement`.
- Enable the new `SearchField` props: `multiline`, `rows`, and the flag that turns on the **"Ask the AI"** submit layout + hides the icon submit.
- Ensure `onAISearch` is wrapped with the busy `try`/`finally` as above (the body that calls `runAISearch` / `onRerunRow` stays the same).
- Add `|| aiSearchBusy` to each row button’s `disabled` predicate (rerun, delete pending, delete all).

## 4) Tests

- Extend `[SearchField-test.js](src/sidebar/components/search/test/SearchField-test.js)`: multiline path uses `textarea`; Enter submits; Shift+Enter does not submit but allows newline; when a `submitting`/busy prop is wired (or `disabled` reflects busy), the submit button is disabled; existing tests for default single-line behavior remain green.

## Files to touch


| File                                                                            | Change                                                                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `[SearchField.tsx](src/sidebar/components/search/SearchField.tsx)`              | Optional multiline textarea, full-width "Ask the AI" button below, Enter/Shift+Enter handling, ref/type tweaks |
| `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`          | `aiSearchBusy` state, wrap `onAISearch`, pass new props + ref type; `                                          |
| `[SearchField-test.js](src/sidebar/components/search/test/SearchField-test.js)` | Coverage for new behavior                                                                                      |


No changes required to `[SearchPanel.tsx](src/sidebar/components/search/SearchPanel.tsx)` or `[StreamSearchInput.tsx](src/sidebar/components/search/StreamSearchInput.tsx)` if new `SearchField` props are optional with safe defaults.