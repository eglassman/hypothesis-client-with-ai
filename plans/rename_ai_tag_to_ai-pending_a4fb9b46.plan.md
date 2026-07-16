---
name: Rename ai tag to ai-pending
overview: "Replace the Hypothesis annotation tag `ai` with `ai-pending` in the three places that define or document it: tag assignment on create, the default highlight palette key, and RPC type docs. No other code paths compare or filter on this string today."
todos:
  - id: update-aisearch-panel
    content: Change default tag array in AISearchPanel.tsx to 'ai-pending'
    status: completed
  - id: update-palette
    content: Rename palette key to 'ai-pending' in ai-search-tag-palette.ts
    status: completed
  - id: update-jsdoc
    content: Update port-rpc-calls.d.ts setTagHighlightPalette example to ai-pending
    status: completed
  - id: verify
    content: Run tests and spot-check AI search annotation creation + highlight color
    status: completed
isProject: false
---

# Rename `ai` tag to `ai-pending`

## Scope (confirmed by repo search)


| Location                                                                                           | Role                                                                                                     |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [src/sidebar/components/search/AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx) | Sets `tags` when creating annotations from AI search results (`const tags = ['ai', ...]`).               |
| [src/sidebar/helpers/ai-search-tag-palette.ts](src/sidebar/helpers/ai-search-tag-palette.ts)       | Default guest highlight map: key `ai` must match the persisted tag name for the blue highlight to apply. |
| [src/types/port-rpc-calls.d.ts](src/types/port-rpc-calls.d.ts)                                     | JSDoc on `setTagHighlightPalette` uses `ai` as an example tag name.                                      |


No tests, fixtures, or filters currently assert the literal `'ai'` tag (other hits like `aiSearch`, variable names `ai`, or schema tags like `'methods'` are unrelated and should **not** change).

## Implementation

1. **AISearchPanel** — Change the default tag in the array to `'ai-pending'`:
  `const tags = ['ai-pending', ...(tagTrim ? [tagTrim] : [])];`
2. **ai-search-tag-palette** — Rename the object property from `ai` to `'ai-pending'` (quoted property name because of the hyphen):

```ts
   'ai-pending': 'rgba(64, 169, 255, 0.38)',
   

```

1. **port-rpc-calls.d.ts** — Update the JSDoc example from `ai` to `ai-pending` so API docs stay accurate.

## Optional / follow-up (not required for the rename)

- **Existing data**: Annotations already saved with tag `ai` will no longer receive the default palette entry unless you keep **both** `ai` and `ai-pending` keys in `INITIAL_AI_TAG_HIGHLIGHT_PALETTE` temporarily or migrate stored tags server-side. If you only care about new annotations, a single `ai-pending` key is enough.
- **[src/shared/tag-color-from-string.ts](src/shared/tag-color-from-string.ts)** line 1 only references `INITIAL_AI_TAG_HIGHLIGHT_PALETTE` by constant name; no edit required unless you want the comment to mention the concrete tag string.

## Verification

- Run the existing test suite (e.g. `npm test` or the project’s usual command) to ensure nothing breaks.
- Manually: run AI search, create annotations, confirm highlights still use the expected color and the tag shows as `ai-pending` in the sidebar.

