import { username } from '../helpers/account-id';
import type { SidebarStore } from '../store';
import type { LocalStorageService } from './local-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperimentEvent =
  | {
      type: 'search';
      timestamp: string;
      username: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
      annotationIdsCreated: string[];
    }
  | {
      type: 'accept';
      timestamp: string;
      username: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'reject';
      timestamp: string;
      username: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'rerun-search';
      timestamp: string;
      username: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
      deletedAnnotationIds: string[];
    }
  | {
      type: 'delete-pending';
      timestamp: string;
      username: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
      deletedAnnotationIds: string[];
    }
  | {
      type: 'delete-all';
      timestamp: string;
      username: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
      deletedAnnotationIds: string[];
      untaggedAnnotationIds: string[];
    };

export type AnnotationStatus = {
  annotationId: string;
  username: string;
  documentUri: string;
  schemaTag: string;
  quoteText: string;
  searchRowId: string;
  query: string;
  status: 'suggested' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
};

type UserLog = {
  events: ExperimentEvent[];
  annotationStatuses: Record<string, AnnotationStatus>;
};

export type ExperimentLog = {
  version: 1;
  exportedAt?: string;
  users: Record<string, UserLog>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'hypothesis.experimentLog';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Logs user interactions with the AI search feature for HCI experiment
 * analysis. Data is persisted to localStorage and can be downloaded as JSON.
 *
 * Cross-tab sync: since `_load()` reads from localStorage on every call,
 * events written by other tabs are automatically included. The browser's
 * `storage` event is not needed for correctness here — each tab appends
 * to the shared localStorage key and reads the latest state before writing.
 *
 * @inject
 */
export class ExperimentLogService {
  private _storage: LocalStorageService;
  private _store: SidebarStore;

  constructor(localStorage: LocalStorageService, store: SidebarStore) {
    this._storage = localStorage;
    this._store = store;
  }

  private _username(): string {
    return username(this._store.profile().userid) || 'anonymous';
  }

  private _now(): string {
    return new Date().toISOString();
  }

  private _load(): ExperimentLog {
    const raw = this._storage.getObject<ExperimentLog>(STORAGE_KEY);
    if (raw && raw.version === 1 && raw.users) {
      return raw;
    }
    return { version: 1, users: {} };
  }

  private _save(log: ExperimentLog): void {
    try {
      this._storage.setObject(STORAGE_KEY, log);
    } catch (e) {
      console.warn('[ExperimentLog] Failed to persist log to localStorage', e);
    }
  }

  private _ensureUser(log: ExperimentLog, user: string): UserLog {
    if (!log.users[user]) {
      log.users[user] = { events: [], annotationStatuses: {} };
    }
    return log.users[user];
  }

  // -------------------------------------------------------------------------
  // Public logging methods
  // -------------------------------------------------------------------------

  logSearch(params: {
    query: string;
    schemaTag: string;
    searchRowId: string;
    documentUri: string;
    annotationIdsCreated: string[];
    quoteTexts: string[];
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);
    const now = this._now();

    userLog.events.push({
      type: 'search',
      timestamp: now,
      username: user,
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
      annotationIdsCreated: params.annotationIdsCreated,
    });

    // Initialize annotation status records for each created annotation.
    for (let i = 0; i < params.annotationIdsCreated.length; i++) {
      const annId = params.annotationIdsCreated[i];
      userLog.annotationStatuses[annId] = {
        annotationId: annId,
        username: user,
        documentUri: params.documentUri,
        schemaTag: params.schemaTag,
        quoteText: params.quoteTexts[i] ?? '',
        searchRowId: params.searchRowId,
        query: params.query,
        status: 'suggested',
        createdAt: now,
        resolvedAt: null,
      };
    }

    this._save(log);
  }

  logAccept(params: {
    annotationId: string;
    quoteText: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);
    const now = this._now();

    userLog.events.push({
      type: 'accept',
      timestamp: now,
      username: user,
      documentUri: params.documentUri,
      annotationId: params.annotationId,
      quoteText: params.quoteText,
      schemaTag: params.schemaTag,
    });

    const status = userLog.annotationStatuses[params.annotationId];
    if (status) {
      status.status = 'accepted';
      status.resolvedAt = now;
    }

    this._save(log);
  }

  logReject(params: {
    annotationId: string;
    quoteText: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);
    const now = this._now();

    userLog.events.push({
      type: 'reject',
      timestamp: now,
      username: user,
      documentUri: params.documentUri,
      annotationId: params.annotationId,
      quoteText: params.quoteText,
      schemaTag: params.schemaTag,
    });

    const status = userLog.annotationStatuses[params.annotationId];
    if (status) {
      status.status = 'rejected';
      status.resolvedAt = now;
    }

    this._save(log);
  }

  logRerunSearch(params: {
    searchRowId: string;
    query: string;
    schemaTag: string;
    documentUri: string;
    deletedAnnotationIds: string[];
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);

    userLog.events.push({
      type: 'rerun-search',
      timestamp: this._now(),
      username: user,
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
      deletedAnnotationIds: params.deletedAnnotationIds,
    });

    this._save(log);
  }

  logDeletePending(params: {
    searchRowId: string;
    query: string;
    schemaTag: string;
    documentUri: string;
    deletedAnnotationIds: string[];
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);

    userLog.events.push({
      type: 'delete-pending',
      timestamp: this._now(),
      username: user,
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
      deletedAnnotationIds: params.deletedAnnotationIds,
    });

    this._save(log);
  }

  logDeleteAll(params: {
    searchRowId: string;
    query: string;
    schemaTag: string;
    documentUri: string;
    deletedAnnotationIds: string[];
    untaggedAnnotationIds: string[];
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);

    userLog.events.push({
      type: 'delete-all',
      timestamp: this._now(),
      username: user,
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
      deletedAnnotationIds: params.deletedAnnotationIds,
      untaggedAnnotationIds: params.untaggedAnnotationIds,
    });

    this._save(log);
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  getLog(): ExperimentLog {
    return this._load();
  }

  downloadLog(): void {
    const log = this._load();
    log.exportedAt = this._now();

    const blob = new Blob([JSON.stringify(log, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `experiment-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
