---
name: ""
overview: ""
todos: []
isProject: false
---

---

name: AI search recovery UX
overview: The best user recovery path combines an explicit in-app cancel control, honest feedback that work is still happening (compact **digits-only** elapsed time **to the left of the AI Search panel icon**; toast step text for delete loops and Claude/model phases — **no** spinner or "Working…" on the AI submit row; see layout constraint), and a clear last resort (reload). This aligns with how long Claude + annotation loops behave in the client.
todos:

- id: layout-constraint-submit-row
content: Do **not** add a spinner or 'Working…' next to 'Ask the AI' or on the multiline submit row in [AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx) — risks layout shift. Rely on Stop, compact elapsed-time display (see `elapsed-timer`), and toasts instead.
status: pending
- id: stop-control
content: Expose Stop that calls shared abort (AbortController) for Ask the AI, rerun, delete pending, delete all — e.g. top bar next to Clear log
status: pending
- id: copy-expectations
content: "Tooltip or short help: long PDFs / Claude latency; Stop ends client-side work; reload last resort"
status: pending
- id: elapsed-timer
content: When `aiSearchOpsBusy`, show **only** elapsed time (e.g. `2:15`) — **no** "Running" label. Place **immediately to the left of** [AISearchIconButton](src/sidebar/components/search/AISearchIconButton.tsx) in [TopBar.tsx](src/sidebar/components/TopBar.tsx) (flex row: timer, then icon). **Not** beside Ask the AI row; **not** in experiment-log controls.
status: pending
- id: toast-step-messages
content: "Delete loops: toastMessenger step text (e.g. Deleting pending… 12/40). Claude path: toast waiting on model, then further toasts for later phases when available until the run completes"
status: pending
isProject: false

---

# Recovering when AI search feels stuck

## What users need psychologically

1. **Agency** — A clear way to **end the wait** without guessing (browser kill / force-quit).
2. **Evidence of life** — Something that shows the app is **still working** (not frozen), so they do not abandon a healthy request.
3. **Honest limits** — Short copy that **large PDFs and Claude calls can take a long time**, and that "stop" may mean "stop waiting / stop creating annotations here," not necessarily instant server teardown.

**Layout constraint:** Do **not** place a spinner or "Working…" label **on or beside the Ask the AI / multiline submit row** in the AI search panel — it can **affect layout**. Use a **compact elapsed-time readout** (digits only — see below) **to the left of the AI Search top-bar icon** ([AISearchIconButton](src/sidebar/components/search/AISearchIconButton.tsx)), plus **Stop**, toasts, and disabled controls for "evidence of life" instead. **Do not** put the timer inside the experiment-log control cluster ([ExperimentLogTopBarControls](src/sidebar/components/ExperimentLogTopBarControls.tsx)); that area is unrelated.

## Best recovery hierarchy (recommended)


| Priority | Action                   | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | **In-app Stop / Cancel** | Fails fast in the UI; matches user mental model. Implementation-wise, this means cooperative cancellation (`AbortSignal` + checks between annotation API calls, and not awaiting Claude forever if you race on abort — as in the earlier design for [AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx) + a top-bar control).                                                                                                                                                                                              |
| 2        | **Visible busy state**   | The panel already disables the field and actions while work runs. **Do not** add a spinner or "Working…" on the **Ask the AI / submit row** — that can **change layout**. Instead: **digits-only elapsed time** to the **left of the AI Search panel toggle** in the top bar ([AISearchIconButton](src/sidebar/components/search/AISearchIconButton.tsx)), **toast step messages**, and disabled controls provide feedback without shifting the search field.                                                                               |
| 3        | **Step progress**        | Use **toastMessenger** for phase text: **delete loops** (pending delete, delete-all tag removal, rerun's pending sweep) show counts where applicable, e.g. **"Deleting pending… 12/40"**. **Claude / `AISearchDocument`:** show **"Waiting on model"** (or equivalent) while the request is in flight; then, as subsequent client-side steps run (e.g. creating annotations from quotes), emit additional toasts **when those steps exist** until the operation completes. Throttle or batch updates if per-iteration toasts are too noisy. |
| 4        | **Last resort: reload**  | Document implicitly: **refresh the tab** if the UI is wedged. Risk: in-flight work may be partial; local history state may need to stay consistent (your store already tracks rows).                                                                                                                                                                                                                                                                                                                                                        |


## Caveat to set expectations

- **Stopping** cooperative work is reliable for **loops you control** (annotation create/delete/update).
- The **Claude HTTP request** may still run until the browser finishes or errors; the client can **stop waiting** and skip follow-up work (e.g. `Promise.race`), but users should not expect the remote model to "instantly die." A one-line note in the Stop tooltip or help text avoids mistrust.

### New query while the first model call is still in flight

- **While the first run is active** (`aiSearchBusy` / `aiSearchOpsBusy`), the UI **disables** Ask the AI and row actions, so the user **cannot** start another AI query through the normal path until the operation **finishes** or the user **Stops** (busy flags clear in `finally`).
- **After Stop**, the client **no longer awaits** the first request and **must not** run post-Claude work (create annotations, update rows) for that cancelled operation — the in-flight HTTP call may still complete in the background, but **discarded** promise results should not mutate app state. Implementation must ensure the "aborted" path does not attach follow-up logic to the still-pending Claude promise.
- **If the user then submits a new query**, that starts a **second, independent** `AISearchDocument` call. **Two** HTTP requests may briefly overlap (first finishing "silently," second active). That is usually acceptable (extra network/API usage) but can stress rate limits or billing; **ordering** is defined by whichever run's client-side completion runs last — avoid relying on arrival order unless explicitly serialized.
- **Without Stop**, overlapping queries are **not** expected from the UI because of the busy gate.

## Elapsed timer (planned)

- **What:** While any AI search panel operation is in progress (same window as `aiSearchBusy` / row delete / rerun / shared `aiSearchOpsBusy`), show **only** the elapsed duration — e.g. `2:15` or `1:02:15` (`m:ss` or `h:mm:ss`). **No** "Running" or other prefix (tight horizontal space); context makes the meaning clear.
- **How:** Start a `performance.now()` or `Date` baseline when busy flips true; update every second with `requestAnimationFrame` or `setInterval` until busy false; clear on unmount.
- **Where:** **Immediately to the left of** the icon that opens the AI Search panel — i.e. the **[AISearchIconButton](src/sidebar/components/search/AISearchIconButton.tsx)** instance in [TopBar.tsx](src/sidebar/components/TopBar.tsx) (wrap both in a flex container: `elapsed text` → `toggle button`). **Not** beside "Ask the AI" or inside the multiline submit block — **layout constraint** (see todo `layout-constraint-submit-row`). **Not** in **[ExperimentLogTopBarControls](src/sidebar/components/ExperimentLogTopBarControls.tsx)**. Show the timer whenever `aiSearchOpsBusy` is true (panel may be closed or open). **Stop** remains elsewhere (e.g. near Clear log), not required next to the timer.

## Toast step messages (planned)

- **Delete loops** ([AISearchPanel.tsx](src/sidebar/components/search/AISearchPanel.tsx) — `onDeletePending`, `onDeleteAll`, and the pending-deletion segment of `onRerunRow`): use **toastMessenger** to show **incremental step text** with counts, e.g. **"Deleting pending… 12/40"**, updating as the loop advances (same pattern for delete-all when iterating matches). Prefer **notice** (or the project's non-error transient API) so it reads as status, not failure. If the API allows, **replace or dedupe** successive messages to avoid flooding; otherwise **throttle** (e.g. every N items or every 500ms).
- **Claude / model call** ([ClaudeService](src/sidebar/services/claude.ts) call site inside `runAISearch`): show a toast such as **"Waiting on model"** immediately before or when `AISearchDocument` starts. After the model returns and **further steps** run in the client (e.g. filtering quotes, creating annotations in a loop), emit **additional toasts for those phases** when they are meaningfully distinct, until **all steps complete** (success or abort). If a phase has no natural sub-steps, **"Waiting on model"** plus a single **"Creating annotations…"** (or per-batch counts) is enough.

## Optional product polish (if you invest more)

- **Non-modal banner** in the AI panel: "Large documents can take several minutes. You can Stop anytime."
- **Keyboard**: ensure Stop is focusable and documented (accessibility).

## Summary

**Best single answer for users:** give them a **prominent Stop** that always works for in-panel work, pair it with **obvious busy feedback** without resizing the submit area (**compact digits-only elapsed time** to the **left of the AI Search top-bar icon**, **toast** steps, disabled controls — **no** submit-row spinner / "Working…"), add **toast-based step text** for delete loops and Claude/model + follow-on steps, and treat **reload** as the documented escape hatch if something truly hangs outside those paths.