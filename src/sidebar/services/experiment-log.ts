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
      searchRowId: string;
      query: string;
      schemaTag: string;
      annotationIdsCreated: string[];
    }
  | {
      type: 'accept';
      timestamp: string;
      username: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'reject';
      timestamp: string;
      username: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'delete-search';
      timestamp: string;
      username: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
      annotationIds: string[];
    };

export type AnnotationStatus = {
  annotationId: string;
  username: string;
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

type ExperimentLog = {
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
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);
    const now = this._now();

    userLog.events.push({
      type: 'accept',
      timestamp: now,
      username: user,
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
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);
    const now = this._now();

    userLog.events.push({
      type: 'reject',
      timestamp: now,
      username: user,
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

  logDeleteSearch(params: {
    searchRowId: string;
    query: string;
    schemaTag: string;
    annotationIds: string[];
  }): void {
    const log = this._load();
    const user = this._username();
    const userLog = this._ensureUser(log, user);

    userLog.events.push({
      type: 'delete-search',
      timestamp: this._now(),
      username: user,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
      annotationIds: params.annotationIds,
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
