import { FetchError } from './fetch';

export function isRateLimitFetchError(error: unknown): boolean {
  return (
    error instanceof FetchError &&
    error.response !== null &&
    error.response.status === 429
  );
}

/**
 * Delay before retrying a rate-limited request. Honors `Retry-After` when
 * present (seconds or HTTP-date); otherwise uses linear backoff.
 */
export function retryDelayMsFromRateLimitError(
  error: unknown,
  attempt: number,
  defaultBackoffMs = 1000,
): number {
  if (error instanceof FetchError && error.response) {
    const retryAfter = error.response.headers.get('Retry-After');
    if (retryAfter) {
      const asSeconds = Number(retryAfter);
      if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
        return asSeconds * 1000;
      }
      const asDate = Date.parse(retryAfter);
      if (!Number.isNaN(asDate)) {
        return Math.max(0, asDate - Date.now());
      }
    }
  }
  return defaultBackoffMs * attempt;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Shared pause gate so parallel workers do not each trigger separate 429 waits. */
export type RateLimitCoordinator = {
  awaitGate: () => Promise<void>;
  pauseFor: (
    error: unknown,
    attempt: number,
    defaultBackoffMs: number,
  ) => void;
};

export function createRateLimitCoordinator(): RateLimitCoordinator {
  let pauseUntil = 0;
  return {
    async awaitGate() {
      const wait = pauseUntil - Date.now();
      if (wait > 0) {
        await delay(wait);
      }
    },
    pauseFor(error: unknown, attempt: number, defaultBackoffMs: number) {
      const pauseMs = retryDelayMsFromRateLimitError(
        error,
        attempt,
        defaultBackoffMs,
      );
      pauseUntil = Math.max(pauseUntil, Date.now() + pauseMs);
    },
  };
}

/**
 * Retry `fn` when the H API responds with HTTP 429. Non-429 errors are not
 * retried.
 */
export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 5,
    defaultBackoffMs = 1000,
    coordinator,
  }: {
    maxAttempts?: number;
    defaultBackoffMs?: number;
    coordinator?: RateLimitCoordinator;
  } = {},
): Promise<T> {
  let attempt = 0;
  while (true) {
    if (coordinator) {
      await coordinator.awaitGate();
    }
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (!isRateLimitFetchError(err) || attempt >= maxAttempts) {
        throw err;
      }
      if (coordinator) {
        coordinator.pauseFor(err, attempt, defaultBackoffMs);
        await coordinator.awaitGate();
      } else {
        await delay(
          retryDelayMsFromRateLimitError(err, attempt, defaultBackoffMs),
        );
      }
    }
  }
}
