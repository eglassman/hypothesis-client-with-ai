import type { SidebarStore } from '../store';
import type {
  AISearchNegativeExample,
  AISearchState,
} from '../store/modules/sidebar-panels';
import { watch } from '../util/watch';
import type { LocalStorageService } from './local-storage';

/** `localStorage` key for persisted AI search rows and tag colors. */
export const AI_SEARCH_STORAGE_KEY = 'hypothesis.aiSearch.history';

/** `localStorage` key for locally stored declined ai-pending snapshots. */
export const AI_SEARCH_NEGATIVE_EXAMPLES_KEY =
  'hypothesis.aiSearch.negativeExamples';

const emptyAiSearch = (): AISearchState => ({
  rows: [],
  schemaTagColors: {},
});

/**
 * Validate and return `AISearchState` from parsed JSON, or `null` if invalid.
 */
export function parseAISearchState(raw: unknown): AISearchState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.rows)) {
    return null;
  }
  if (
    !v.schemaTagColors ||
    typeof v.schemaTagColors !== 'object' ||
    Array.isArray(v.schemaTagColors)
  ) {
    return null;
  }
  const rows = [];
  for (const row of v.rows) {
    if (!row || typeof row !== 'object') {
      return null;
    }
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string') {
      return null;
    }
    if (typeof r.schemaTag !== 'string') {
      return null;
    }
    if (typeof r.query !== 'string') {
      return null;
    }
    if (!Array.isArray(r.annotationIds)) {
      return null;
    }
    if (!r.annotationIds.every((id: unknown) => typeof id === 'string')) {
      return null;
    }
    rows.push({
      id: r.id,
      schemaTag: r.schemaTag,
      query: r.query,
      annotationIds: r.annotationIds as string[],
    });
  }
  const schemaTagColors: Record<string, string> = {};
  for (const [k, c] of Object.entries(v.schemaTagColors as Record<string, unknown>)) {
    if (typeof c !== 'string') {
      return null;
    }
    schemaTagColors[k] = c;
  }
  return { rows, schemaTagColors };
}

/**
 * Validate and return persisted negative examples from parsed JSON, or `null`
 * if invalid.
 */
export function parseAISearchNegativeExamplesState(
  raw: unknown,
): AISearchNegativeExample[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: AISearchNegativeExample[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string') {
      return null;
    }
    if (typeof r.schemaTag !== 'string') {
      return null;
    }
    if (typeof r.query !== 'string') {
      return null;
    }
    if (typeof r.quote !== 'string') {
      return null;
    }
    if (typeof r.documentUri !== 'string') {
      return null;
    }
    out.push({
      id: r.id,
      schemaTag: r.schemaTag,
      query: r.query,
      quote: r.quote,
      documentUri: r.documentUri,
    });
  }
  return out;
}

type StorageSyncConfig<T> = {
  storageKey: string;
  parse: (raw: unknown) => T | null;
  empty: () => T;
  getCurrent: () => T;
  hydrate: (value: T) => void;
};

/**
 * Persists `sidebarPanels.aiSearch` and `sidebarPanels.aiSearchNegativeExamples`
 * to `localStorage`, restores on load, and applies updates from other browser
 * tabs via the `storage` event (see `AuthService` for the same pattern for
 * OAuth tokens).
 *
 * @inject
 */
export class PersistedAISearchService {
  private _storage: LocalStorageService;
  private _store: SidebarStore;
  private _window: Window;

  constructor(
    localStorage: LocalStorageService,
    store: SidebarStore,
    $window: Window,
  ) {
    this._storage = localStorage;
    this._store = store;
    this._window = $window;
  }

  private _syncFromLocalStorage<T>(
    config: StorageSyncConfig<T>,
    e?: StorageEvent,
  ) {
    const { storageKey, parse, empty, getCurrent, hydrate } = config;
    let raw: unknown;

    if (e) {
      if (e.key !== null && e.key !== storageKey) {
        return;
      }
      if (e.key === storageKey && e.newValue !== null) {
        try {
          raw = JSON.parse(e.newValue);
        } catch {
          return;
        }
      } else if (e.key === storageKey && e.newValue === null) {
        raw = null;
      } else {
        raw = this._storage.getObject<unknown>(storageKey);
      }
    } else {
      raw = this._storage.getObject<unknown>(storageKey);
    }

    if (raw === null) {
      const emp = empty();
      if (JSON.stringify(emp) !== JSON.stringify(getCurrent())) {
        hydrate(emp);
      }
      return;
    }
    const next = parse(raw);
    if (!next) {
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(getCurrent())) {
      return;
    }
    hydrate(next);
  }

  init() {
    const persisted = this._storage.getObject<unknown>(AI_SEARCH_STORAGE_KEY);
    const parsed = parseAISearchState(persisted);
    if (parsed) {
      this._store.hydrateAISearch(parsed);
    }

    const negRaw = this._storage.getObject<unknown>(
      AI_SEARCH_NEGATIVE_EXAMPLES_KEY,
    );
    const negParsed = parseAISearchNegativeExamplesState(negRaw);
    if (negParsed) {
      this._store.hydrateAISearchNegativeExamples(negParsed);
    }

    watch(
      this._store.subscribe,
      () => this._store.getState().sidebarPanels.aiSearch,
      current => {
        this._storage.setObject(AI_SEARCH_STORAGE_KEY, current);
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    watch(
      this._store.subscribe,
      () => this._store.getState().sidebarPanels.aiSearchNegativeExamples,
      current => {
        this._storage.setObject(AI_SEARCH_NEGATIVE_EXAMPLES_KEY, current);
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    const syncHistory = (e?: StorageEvent) =>
      this._syncFromLocalStorage(
        {
          storageKey: AI_SEARCH_STORAGE_KEY,
          parse: parseAISearchState,
          empty: emptyAiSearch,
          getCurrent: () => this._store.getState().sidebarPanels.aiSearch,
          hydrate: v => this._store.hydrateAISearch(v),
        },
        e,
      );

    const syncNegatives = (e?: StorageEvent) =>
      this._syncFromLocalStorage(
        {
          storageKey: AI_SEARCH_NEGATIVE_EXAMPLES_KEY,
          parse: parseAISearchNegativeExamplesState,
          empty: () => [],
          getCurrent: () =>
            this._store.getState().sidebarPanels.aiSearchNegativeExamples,
          hydrate: v => this._store.hydrateAISearchNegativeExamples(v),
        },
        e,
      );

    this._window.addEventListener('storage', (e: StorageEvent) => {
      syncHistory(e);
      syncNegatives(e);
    });

    this._window.document.addEventListener('visibilitychange', () => {
      if (this._window.document.visibilityState === 'visible') {
        syncHistory();
        syncNegatives();
      }
    });

    this._window.addEventListener('focus', () => {
      syncHistory();
      syncNegatives();
    });
  }
}
