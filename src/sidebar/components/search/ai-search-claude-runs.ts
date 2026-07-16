/**
 * In-memory registry for in-flight Claude `AISearchDocument` calls only.
 * Used for AbortSignal and Stop — UI (timer) lives in AISearchPanel.
 */

type RunEntry = {
  controller: AbortController;
};

const runs = new Map<string, RunEntry>();

/**
 * Register a Claude run immediately before AISearchDocument; call `finish` in `finally` after await.
 *
 * Returns `null` when another Claude request is already in flight.
 */
export function registerClaudeRun(): {
  runId: string;
  signal: AbortSignal;
  finish: () => void;
} | null {
  if (runs.size > 0) {
    return null;
  }

  const runId = crypto.randomUUID();
  const controller = new AbortController();
  runs.set(runId, { controller });

  const finish = () => {
    runs.delete(runId);
  };

  return { runId, signal: controller.signal, finish };
}

/** Abort every in-flight Claude request and clear the registry. */
export function abortAllClaudeRuns() {
  for (const { controller } of runs.values()) {
    controller.abort();
  }
  runs.clear();
}

/** For tests / debugging. */
export function getActiveClaudeRunCount(): number {
  return runs.size;
}
