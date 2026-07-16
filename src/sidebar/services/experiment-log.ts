import type { SidebarStore } from '../store';
import type { ExperimentEvent, ExperimentLogState } from '../store/modules/sidebar-panels';
import { emptyExperimentLog } from '../store/modules/sidebar-panels';
import type { ToastMessengerService } from './toast-messenger';

export type { ExperimentEvent, ExperimentLogState } from '../store/modules/sidebar-panels';

/** Persisted with other AI search data; see `PersistedTagInventoryService`. */
export const EXPERIMENT_LOG_STORAGE_KEY = 'hypothesis.aiSearch.experimentLog';

/** Warn when serialized log exceeds this size (bytes, UTF-16 approximation). */
export const EXPERIMENT_LOG_SIZE_WARN_BYTES = 1_500_000;

const QUOTA_USAGE_WARN = 0.85;

let lastQuotaWarningAt = 0;
let lastSizeWarningAt = 0;

/**
 * Validate experiment log JSON from `localStorage`.
 */
export function parseExperimentLogState(raw: unknown): ExperimentLogState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const v = raw as Record<string, unknown>;
  if (v.version !== 1) {
    return null;
  }
  if (!Array.isArray(v.events)) {
    return null;
  }
  return {
    version: 1,
    events: v.events as ExperimentEvent[],
  };
}

/**
 * HCI experiment log: append-only events.
 * State lives in the store; `PersistedTagInventoryService` syncs to `localStorage`.
 *
 * @inject
 */
export class ExperimentLogService {
  private _store: SidebarStore;
  private _toastMessenger: ToastMessengerService;

  constructor(store: SidebarStore, toastMessenger: ToastMessengerService) {
    this._store = store;
    this._toastMessenger = toastMessenger;
  }

  private _now(): string {
    return new Date().toISOString();
  }

  private _log(): ExperimentLogState {
    return this._store.getState().sidebarPanels.experimentLog;
  }

  private _commit(next: ExperimentLogState): void {
    this._store.setExperimentLog(next);
    this._maybeWarnStoragePressure(next);
  }

  private _maybeWarnStoragePressure(log: ExperimentLogState): void {
    const now = Date.now();
    try {
      const repr = JSON.stringify(log);
      if (repr.length * 2 >= EXPERIMENT_LOG_SIZE_WARN_BYTES) {
        if (now - lastSizeWarningAt > 60_000) {
          lastSizeWarningAt = now;
          this._toastMessenger.error(
            'The experiment log is large. Download or clear it to avoid running out of storage.',
          );
        }
      }
    } catch {
      /* ignore */
    }

    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage.estimate().then(est => {
        if (!est.quota || est.quota <= 0) {
          return;
        }
        const ratio = (est.usage ?? 0) / est.quota;
        if (ratio >= QUOTA_USAGE_WARN && now - lastQuotaWarningAt > 60_000) {
          lastQuotaWarningAt = Date.now();
          this._toastMessenger.error(
            'Browser storage for this site is nearly full. Consider exporting or clearing the experiment log.',
          );
        }
      });
    }
  }

  logSearch(params: {
    query: string;
    schemaTag: string;
    searchRowId: string;
    documentUri: string;
    annotationIdsCreated: string[];
    quoteTexts: string[];
  }): void {
    const log = structuredClone(this._log());
    const now = this._now();

    log.events.push({
      type: 'search',
      timestamp: now,
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
      annotationIdsCreated: params.annotationIdsCreated,
      quoteTexts: params.quoteTexts,
    });

    this._commit(log);
  }

  logAccept(params: {
    annotationId: string;
    quoteText: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = structuredClone(this._log());
    const now = this._now();

    log.events.push({
      type: 'accept',
      timestamp: now,
      documentUri: params.documentUri,
      annotationId: params.annotationId,
      quoteText: params.quoteText,
      schemaTag: params.schemaTag,
    });

    this._commit(log);
  }

  logReject(params: {
    annotationId: string;
    quoteText: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = structuredClone(this._log());
    const now = this._now();

    log.events.push({
      type: 'reject',
      timestamp: now,
      documentUri: params.documentUri,
      annotationId: params.annotationId,
      quoteText: params.quoteText,
      schemaTag: params.schemaTag,
    });

    this._commit(log);
  }

  /**
   * Per-annotation deletion (canonical id log). Not used for reject flow.
   */
  logAnnotationDeleted(params: {
    annotationId: string;
    quoteText: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = structuredClone(this._log());
    log.events.push({
      type: 'annotation-deleted',
      timestamp: this._now(),
      documentUri: params.documentUri,
      annotationId: params.annotationId,
      quoteText: params.quoteText,
      schemaTag: params.schemaTag,
    });
    this._commit(log);
  }

  logReclassifyAsManual(params: {
    annotationId: string;
    documentUri: string;
    schemaTag: string;
    originalQuery: string;
    newText: string;
    quoteText: string;
    reason: 'text-change' | 'schema-tag-removed';
    removedSchemaTags?: string[];
  }): void {
    const log = structuredClone(this._log());
    const now = this._now();
    log.events.push({
      type: 'reclassify-as-manual',
      timestamp: now,
      documentUri: params.documentUri,
      annotationId: params.annotationId,
      schemaTag: params.schemaTag,
      originalQuery: params.originalQuery,
      newText: params.newText,
      quoteText: params.quoteText,
      reason: params.reason,
      ...(params.removedSchemaTags?.length
        ? { removedSchemaTags: params.removedSchemaTags }
        : {}),
    });
    this._commit(log);
  }

  /** Row-level only — no annotation id lists (see plan). */
  logRerunSearch(params: {
    searchRowId: string;
    query: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = structuredClone(this._log());
    log.events.push({
      type: 'rerun-search',
      timestamp: this._now(),
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
    });
    this._commit(log);
  }

  logDeletePending(params: {
    searchRowId: string;
    query: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = structuredClone(this._log());
    log.events.push({
      type: 'delete-pending',
      timestamp: this._now(),
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
    });
    this._commit(log);
  }

  logDeleteAll(params: {
    searchRowId: string;
    query: string;
    schemaTag: string;
    documentUri: string;
  }): void {
    const log = structuredClone(this._log());
    log.events.push({
      type: 'delete-all',
      timestamp: this._now(),
      documentUri: params.documentUri,
      searchRowId: params.searchRowId,
      query: params.query,
      schemaTag: params.schemaTag,
    });
    this._commit(log);
  }

  clearLog(): void {
    this._commit(emptyExperimentLog());
  }

  getLog(): ExperimentLogState {
    return structuredClone(this._log());
  }

  downloadLog(): void {
    const log = structuredClone(this._log());
    const exported: ExperimentLogState & { exportedAt?: string } = {
      ...log,
      exportedAt: this._now(),
    };

    const blob = new Blob([JSON.stringify(exported, null, 2)], {
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
