/**
 * In-memory lock and cancellation registry for Claude requests.
 * Claude features share this so expensive operations cannot overlap silently.
 */

type RunEntry = {
  controller: AbortController;
};

const runs = new Map<string, RunEntry>();

/** Register one Claude operation. Call `finish` in a `finally` block. */
export function registerClaudeRun(): {
  runId: string;
  signal: AbortSignal;
  abort: () => void;
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
  const abort = () => {
    controller.abort();
  };

  return { runId, signal: controller.signal, abort, finish };
}

/** Abort every in-flight Claude request and clear the registry. */
export function abortAllClaudeRuns() {
  for (const { controller } of runs.values()) {
    controller.abort();
  }
  runs.clear();
}

/** For tests and diagnostics. */
export function getActiveClaudeRunCount(): number {
  return runs.size;
}
