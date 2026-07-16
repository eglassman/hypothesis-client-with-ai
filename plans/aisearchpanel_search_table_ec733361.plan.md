---
name: AISearchPanel search table
overview: Extend AISearchPanel with a five-column results table backed by Redux state in sidebarPanels (survives panel close), sync tag highlight palette to guests, delete via the annotations service, and expose the live sidebar store on window.__sidebarStore in non-production for DevTools.
todos:
  - id: hash-util
    content: Add shared hash→rgba (and hex↔rgba for input type=color) helper with unit test
    status: completed
  - id: redux-panels
    content: "Extend sidebarPanels module: aiSearch sub-state (rows + schemaTagColors), actions, selectors"
    status: completed
  - id: palette-sync
    content: Push merged palette to frameSync on store changes (watch) and AI panel open; initial push after startup
    status: completed
  - id: on-search-row
    content: After onAISearch success, dispatch add row with annotation ids; handle empty created if desired
    status: completed
  - id: table-ui
    content: 5-column table (color, tag, query, count, delete); pickers via store tagColors; helper under table
    status: completed
  - id: delete-flow
    content: Dispatch remove row + prune tag color; annotationsService.delete
    status: completed
  - id: dev-window-store
    content: "Non-production only: assign window.__sidebarStore = store in sidebar/index.tsx"
    status: completed
isProject: false
---

# AISearchPanel five-column search results table

## Current behavior (baseline)

- `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`: `onAISearch` calls Reducto, creates Hypothesis annotations with `tags: ['ai', schemaTag]` and `text: query`, then `store.addAnnotations(created)`.
- Tag colors: `frameSync.setTagHighlightPalette(palette)` RPCs to guests; `[guest.ts](src/annotator/guest.ts)` stores `_tagHighlightPalette` and `[applyTagHighlightPalette](src/shared/tag-highlight-styles.ts)` emits CSS for `.hypothesis-highlight.h-tag-*` per palette key.
- Highlights get **one class per tag** on the same element (`[highlighter.ts](src/annotator/highlighter.ts)` maps `annotation.tags` through `[highlightTagClass](src/shared/highlight-tag-class.ts)`), so **two rows with the same schema tag cannot have different document colors**—they share `h-tag-<schemaTag>`. **UI:** keep a color picker in every row for the five-column layout, but each picker is **fully controlled** from shared `schemaTagColors[schemaTag]` in the store (see Data model). Duplicate tags show the same value; changing any one picker updates all rows with that tag and the guest palette together.

## Data model (Redux: `sidebarPanels`)

- Extend `[sidebar-panels.ts](src/sidebar/store/modules/sidebar-panels.ts)` with a sub-state property named `**aiSearch`** (not `aiSearchPanel`) so it is not confused with the `**AISearchPanel`** UI component. Shape: `{ rows: AISearchRow[]; schemaTagColors: Record<string, string> }`, initially `{ rows: [], schemaTagColors: {} }` (or equivalent).
- `**AISearchRow`** (type name): `{ id, schemaTag, query, annotationIds: string[] }` where `annotationIds` are Hypothesis `id`s from `api.annotation.create` for that run (precise deletes). The **count column** displays `annotationIds.length` at render time (`0` when none created).
- `**schemaTagColors`**: on new row for a tag not in the map, default with `hashStringToRgba(schemaTag)` via a dispatched action (or reducer logic). Color inputs read/write only through `schemaTagColors[schemaTag]`.
- **Actions** (illustrative names): add row after successful search; remove row (and prune color key if no row still references that tag); set schema tag color.
- **Palette pushed to guests**: `{ ...INITIAL_TAG_HIGHLIGHT_PALETTE, ...schemaTagColors }`. Call `frameSync.setTagHighlightPalette` whenever the merged map should change (see below).
- **Full Redux path**: `store.getState().sidebarPanels.aiSearch` (exact accessor follows existing `createStore` / selector conventions on `SidebarStore`).
- **Session scope**: `aiSearch` survives closing the AI `SidebarPanel` (Redux is not unmounted) but **does not** persist across full page reloads or extension restarts unless you add storage later.

## Inspecting the live Redux tree in DevTools

- **Dev-only `window` assignment**: In `[sidebar/index.tsx](src/sidebar/index.tsx)`, immediately after the sidebar store is created (same place other startup uses it), assign the live store in **non-production builds only**, e.g. `if (process.env.NODE_ENV !== 'production') { (window as Window & { __sidebarStore?: SidebarStore }).__sidebarStore = store; }` using the property name `**__sidebarStore`**. Production bundles should omit this via dead-code elimination (same `NODE_ENV` pattern as `[create-store.ts](src/sidebar/store/create-store.ts)` immutable state checks).
- **TypeScript**: add a minimal `Window` augmentation (e.g. in a small `.d.ts` next to the sidebar entry or under `src/types/`) declaring `__sidebarStore?: SidebarStore` on `Window`, or use a narrow cast at the assignment site—keep surface area tiny.
- **Console usage** (open DevTools on the **sidebar** document / iframe, not only the host page): `__sidebarStore.getState().sidebarPanels.aiSearch` for the new slice; `__sidebarStore.getState()` for the full combined reducer tree. Dispatch is available if the wrapped store exposes `dispatch` (standard Redux store does).
- **Security note**: exposing the store on `window` is appropriate **only** for dev builds; do not enable in production (tokens/session-like data can live in the tree).
- **Redux DevTools extension**: Still **not** required for this plan; the assignment above is for the Console / breakpoints. Adding the official DevTools enhancer remains optional later.
- **React DevTools**: useful for component updates; complements but does not replace `getState()`.

## Palette sync vs panel unmount

- `[SidebarPanel](src/sidebar/components/SidebarPanel.tsx)` still unmounts **panel UI** on close, but **rows and colors live in Redux** under `sidebarPanels.aiSearch`, so they survive for the lifetime of the sidebar app session.
- Because the panel unmounts, **palette updates cannot rely only on AISearchPanel effects**. Use a `**watch`** on `store.subscribe` in `[sidebar/index.tsx](src/sidebar/index.tsx)` (or a tiny injected helper initialized there) that selects `sidebarPanels.aiSearch.schemaTagColors` (or the merged palette object), compares to previous, and calls `frameSync.setTagHighlightPalette(merged)` when it changes—so guests stay in sync even when the AI panel is closed. Run an **initial push** once after the store and `FrameSyncService` exist. **Also** keep `onActiveChanged` on the AI panel to push merged palette when the panel opens (covers edge cases / guest reconnect).

## When to add a row

- After `onAISearch` finishes successfully: **dispatch** add-row with submitted `schemaTag`, `query`, and `annotationIds` from `created` (may be empty per product choice).

## Hash → default color

- Add a small pure helper (e.g. `[src/shared/tag-color-from-string.ts](src/shared/tag-color-from-string.ts)`): hash string to a stable hue, map to HSL with fixed S/L, return `rgba(..., ~0.38)` aligned with `INITIAL_TAG_HIGHLIGHT_PALETTE`.
- **Color picker**: native `<input type="color">` (hex); convert hex ↔ rgba in that module or adjacent helpers.

## Delete row + annotations

- Inject `annotations` (`[AnnotationsService.delete](src/sidebar/services/annotations.ts)`) via `withServices`.
- On row delete: delete annotations by id (resolve full `SavedAnnotation` from store if required by `delete`); **dispatch** remove-row and prune `schemaTagColors[schemaTag]` when no remaining row uses that tag.

## UI

- Five columns, in order: (1) color (`<input type="color">` bound to store `schemaTagColors[row.schemaTag]`), (2) schema tag, (3) query, (4) count `annotationIds.length`, (5) delete (`x` / `CancelIcon`).
- Under the table: **"Highlight color is per tag; rows that share a tag share this color."** (muted small text).
- Tailwind patterns consistent with `[SearchPanel.tsx](src/sidebar/components/search/SearchPanel.tsx)`.

## Tests

- Unit: hash → rgba stability.
- Reducers/selectors for new `sidebarPanels` actions.

## Files to touch


| Area               | File                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Hash + rgba/hex    | New `src/shared/tag-color-from-string.ts` (or similar)                                                                                |
| Redux              | `[src/sidebar/store/modules/sidebar-panels.ts](src/sidebar/store/modules/sidebar-panels.ts)`                                          |
| Palette sync + dev | `[src/sidebar/index.tsx](src/sidebar/index.tsx)` — `watch` + `frameSync.setTagHighlightPalette`; **non-prod** `window.__sidebarStore` |
| UI + dispatch      | `[src/sidebar/components/search/AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)`                                  |
| Delete             | `withServices(..., ['annotations'])`                                                                                                  |


No RPC or port type changes; palette shape remains `Record<string, string>`.