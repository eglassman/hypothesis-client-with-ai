---
name: Full quote in negative UI
overview: Stop truncating stored negative-example quotes in the AI search panel by rendering the full `ex.quote` text and dropping the redundant tooltip that existed only for truncated content.
todos:
  - id: ui-quote
    content: "In AISearchPanel negative-examples table: full ex.quote, remove title on Quote td"
    status: completed
isProject: false
---

# Show full quotes in User-denied AI annotations table

## Current behavior

In `[AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx)` (~537–544), the Quote cell renders:

- `ex.quote.slice(0, 80) + '…'` when length > 80
- `title={ex.quote}` so the full string appears on hover

## Change

1. **Render the full quote** — replace the conditional with `{ex.quote}` so nothing is cut off in the UI.
2. **Remove `title={ex.quote}`** on that `<td>` — it was mainly compensating for truncation; with full visible text it is redundant (long quotes still wrap via existing `break-all` and `max-w-[12rem]`).

No store, persistence, or helper changes. Optional follow-up (not required unless you ask): widen or drop `max-w-[12rem]` on the Quote column if you want fewer wrapped lines in narrow cells.