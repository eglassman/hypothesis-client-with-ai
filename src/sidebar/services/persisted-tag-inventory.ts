import type { SidebarStore } from '../store';
import type {
  TagInventoryRow,
  TagInventoryState,
} from '../store/modules/sidebar-panels';
import { emptyExperimentLog } from '../store/modules/sidebar-panels';
import { watch } from '../util/watch';
import {
  EXPERIMENT_LOG_STORAGE_KEY,
  parseExperimentLogState,
} from './experiment-log';
import type { LocalStorageService } from './local-storage';
import type { ToastMessengerService } from './toast-messenger';
import { backfillPublicTagInventoryDocumentUris } from './tag-inventory-reconcile';

/** `localStorage` key for persisted tag inventory rows and tag colors. */
export const TAG_INVENTORY_STORAGE_KEY = 'hypothesis.tagInventory.rows';

export { EXPERIMENT_LOG_STORAGE_KEY } from './experiment-log';

const emptyTagInventory = (): TagInventoryState => ({
  rows: [],
  schemaTagColors: {},
});

/**
 * Validate `rows` and `schemaTagColors` on a persisted object (no `revision`).
 */
function parseTagInventoryStatePayload(v: Record<string, unknown>): TagInventoryState | null {
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
    if ('hidden' in r && typeof r.hidden !== 'boolean') {
      return null;
    }
    if ('groupId' in r && typeof r.groupId !== 'string') {
      return null;
    }
    if ('documentUri' in r && typeof r.documentUri !== 'string') {
      return null;
    }
    const parsed: TagInventoryRow = {
      id: r.id,
      schemaTag: r.schemaTag,
      query: r.query,
      annotationIds: r.annotationIds as string[],
    };
    if (typeof r.groupId === 'string') {
      parsed.groupId = r.groupId;
    }
    if (typeof r.documentUri === 'string') {
      parsed.documentUri = r.documentUri;
    }
    if (r.hidden === true) {
      parsed.hidden = true;
    }
    rows.push(parsed);
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

export type ParsedTagInventoryPersisted = {
  revision: number;
  tagInventory: TagInventoryState;
};

/**
 * Validate persisted tag inventory JSON `{ revision, rows, schemaTagColors }`.
 */
export function parseTagInventoryPersisted(raw: unknown): ParsedTagInventoryPersisted | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const v = raw as Record<string, unknown>;
  const rev = v.revision;
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) {
    return null;
  }
  const tagInventory = parseTagInventoryStatePayload(v);
  if (!tagInventory) {
    return null;
  }
  return { revision: rev, tagInventory };
}

function readTagInventoryRevisionFromStorageRaw(raw: unknown): number {
  if (!raw || typeof raw !== 'object') {
    return 0;
  }
  const r = (raw as Record<string, unknown>).revision;
  if (typeof r === 'number' && Number.isInteger(r) && r >= 0) {
    return r;
  }
  return 0;
}

type StorageSyncConfig<T> = {
  storageKey: string;
  parse: (raw: unknown) => T | null;
  empty: () => T;
  getCurrent: () => T;
  hydrate: (value: T) => void;
};

/**
 * Persists `sidebarPanels.tagInventory` (and the experiment log) to `localStorage`,
 * restores on load, and applies updates from other browser tabs via the
 * `storage` event (see `AuthService` for the same pattern for OAuth tokens).
 *
 * @inject
 */
export class PersistedTagInventoryService {
  private _storage: LocalStorageService;
  private _store: SidebarStore;
  private _window: Window;
  private _toastMessenger: ToastMessengerService;
  /** Monotonic revision for `TAG_INVENTORY_STORAGE_KEY`; ignores stale sync reads. */
  private _tagInventoryRevision = 0;
  /** True while applying inventory from localStorage (skip persist echo). */
  private _applyingRemoteTagInventorySync = false;
  /** Coalesces rapid store updates into a single localStorage write. */
  private _pendingTagInventoryPersist: TagInventoryState | null = null;
  private _tagInventoryPersistScheduled = false;
  /** Suppresses localStorage writes during bulk store mutations. */
  private _persistDeferDepth = 0;
  private _storageSyncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    localStorage: LocalStorageService,
    store: SidebarStore,
    $window: Window,
    toastMessenger: ToastMessengerService,
  ) {
    this._storage = localStorage;
    this._store = store;
    this._window = $window;
    this._toastMessenger = toastMessenger;
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

  private _syncTagInventoryFromLocalStorage(e?: StorageEvent) {
    const storageKey = TAG_INVENTORY_STORAGE_KEY;
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

    const empty = emptyTagInventory();
    const getCurrent = () => this._store.getState().sidebarPanels.tagInventory;

    if (raw === null) {
      this._tagInventoryRevision = 0;
      if (JSON.stringify(empty) !== JSON.stringify(getCurrent())) {
        this._applyRemoteTagInventory(empty, 0);
      }
      return;
    }

    const parsed = parseTagInventoryPersisted(raw);
    if (!parsed) {
      return;
    }

    const { revision: incomingRevision, tagInventory } = parsed;

    if (incomingRevision <= this._tagInventoryRevision) {
      return;
    }

    if (JSON.stringify(tagInventory) === JSON.stringify(getCurrent())) {
      this._tagInventoryRevision = Math.max(
        this._tagInventoryRevision,
        incomingRevision,
      );
      return;
    }

    this._applyRemoteTagInventory(tagInventory, incomingRevision);
  }

  /** Apply tag inventory from localStorage without echoing back to storage. */
  private _applyRemoteTagInventory(
    tagInventory: TagInventoryState,
    revision: number,
  ) {
    this._applyingRemoteTagInventorySync = true;
    try {
      this._store.hydrateTagInventory(tagInventory);
      this._tagInventoryRevision = revision;
      backfillPublicTagInventoryDocumentUris(this._store);
    } finally {
      this._applyingRemoteTagInventorySync = false;
    }
  }

  private _persistTagInventoryToLocalStorage(current: TagInventoryState) {
    const lsRaw = this._storage.getObject<unknown>(TAG_INVENTORY_STORAGE_KEY);
    const readRev = readTagInventoryRevisionFromStorageRaw(lsRaw);
    this._tagInventoryRevision = Math.max(this._tagInventoryRevision, readRev) + 1;
    this._storage.setObject(TAG_INVENTORY_STORAGE_KEY, {
      revision: this._tagInventoryRevision,
      ...current,
    });
  }

  /**
   * Run `work` without writing tag inventory to localStorage until the
   * outermost deferred scope completes (one coalesced write at the end).
   */
  async runWithDeferredPersist(work: () => Promise<void>): Promise<void> {
    this._persistDeferDepth++;
    try {
      await work();
    } finally {
      this._persistDeferDepth--;
      if (this._persistDeferDepth === 0) {
        const pending = this._pendingTagInventoryPersist;
        this._pendingTagInventoryPersist = null;
        if (pending && !this._applyingRemoteTagInventorySync) {
          this._persistTagInventoryToLocalStorage(pending);
        }
      }
    }
  }

  private _scheduleTagInventoryPersist(current: TagInventoryState) {
    if (this._applyingRemoteTagInventorySync) {
      return;
    }
    this._pendingTagInventoryPersist = current;
    if (this._persistDeferDepth > 0) {
      return;
    }
    if (this._tagInventoryPersistScheduled) {
      return;
    }
    this._tagInventoryPersistScheduled = true;
    queueMicrotask(() => {
      this._tagInventoryPersistScheduled = false;
      if (this._applyingRemoteTagInventorySync) {
        this._pendingTagInventoryPersist = null;
        return;
      }
      const pending = this._pendingTagInventoryPersist;
      this._pendingTagInventoryPersist = null;
      if (!pending) {
        return;
      }
      this._persistTagInventoryToLocalStorage(pending);
    });
  }

  init() {
    const persisted = this._storage.getObject<unknown>(TAG_INVENTORY_STORAGE_KEY);
    const parsed = parseTagInventoryPersisted(persisted);
    if (parsed) {
      this._applyRemoteTagInventory(parsed.tagInventory, parsed.revision);
    } else {
      this._tagInventoryRevision = 0;
    }

    const expRaw = this._storage.getObject<unknown>(EXPERIMENT_LOG_STORAGE_KEY);
    const expParsed = parseExperimentLogState(expRaw);
    if (expParsed) {
      this._store.hydrateExperimentLog(expParsed);
    }

    watch(
      this._store.subscribe,
      () => this._store.getState().sidebarPanels.tagInventory,
      current => {
        this._scheduleTagInventoryPersist(current);
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    watch(
      this._store.subscribe,
      () => this._store.getState().sidebarPanels.experimentLog,
      current => {
        try {
          this._storage.setObject(EXPERIMENT_LOG_STORAGE_KEY, current);
        } catch (e: unknown) {
          const name = e instanceof DOMException ? e.name : (e as Error)?.name;
          if (name === 'QuotaExceededError') {
            this._toastMessenger.error(
              'Could not save the experiment log: storage is full. Download or clear the log.',
            );
          } else {
            console.warn('[experimentLog] Failed to persist', e);
          }
        }
      },
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );

    const syncHistory = (e?: StorageEvent) => this._syncTagInventoryFromLocalStorage(e);

    const syncExperimentLog = (e?: StorageEvent) =>
      this._syncFromLocalStorage(
        {
          storageKey: EXPERIMENT_LOG_STORAGE_KEY,
          parse: parseExperimentLogState,
          empty: emptyExperimentLog,
          getCurrent: () =>
            this._store.getState().sidebarPanels.experimentLog,
          hydrate: v => this._store.hydrateExperimentLog(v),
        },
        e,
      );

    this._window.addEventListener('storage', (e: StorageEvent) => {
      if (this._storageSyncTimer !== null) {
        clearTimeout(this._storageSyncTimer);
      }
      this._storageSyncTimer = setTimeout(() => {
        this._storageSyncTimer = null;
        syncHistory(e);
        syncExperimentLog(e);
      }, 250);
    });

    this._window.document.addEventListener('visibilitychange', () => {
      if (this._window.document.visibilityState === 'visible') {
        syncHistory();
        syncExperimentLog();
      }
    });

    this._window.addEventListener('focus', () => {
      syncHistory();
      syncExperimentLog();
    });
  }
}
