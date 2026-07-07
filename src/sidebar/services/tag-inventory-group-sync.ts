import type { Annotation, SavedAnnotation } from '../../types/api';
import { isSaved } from '../helpers/annotation-metadata';
import {
  currentDocumentUri,
  documentUriAliases,
  filterSavedAnnotationsForDocument,
  resolveDocumentUriFromCandidates,
} from '../helpers/document-uri';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { deriveTagInventoryRowDescriptors } from '../helpers/tag-inventory-group';
import type { SidebarStore } from '../store';
import { FetchError } from '../util/fetch';
import { watch } from '../util/watch';
import type { APIService } from './api';
import {
  applyDerivedTagInventoryRows,
  backfillPublicTagInventoryDocumentUris,
} from './tag-inventory-reconcile';

type FocusedGroupWatchValue = readonly [boolean, string | null];

/** Compare profile + group watch values without relying on array reference equality. */
function focusedGroupWatchValuesEqual(
  current: FocusedGroupWatchValue,
  previous: FocusedGroupWatchValue,
): boolean {
  return current[0] === previous[0] && current[1] === previous[1];
}

/** Max page size accepted by `GET /api/groups/{pubid}/annotations`. */
const GROUP_ANNOTATIONS_PAGE_SIZE = 100;

/** Page size for `/api/search` fallback when the moderator-only group endpoint 404s. */
const SEARCH_GROUP_ANNOTATIONS_PAGE_SIZE = 200;

/** Hard cap on pages to guard against a non-advancing cursor. */
const MAX_GROUP_ANNOTATION_PAGES = 1000;

export type SyncGroupInventoryOptions = {
  documentUris?: string[];
};

/** Saved annotations on the current document for Public-group few-shot examples. */
export function savedAnnotationsForCurrentDocument(
  savedAnnotations: SavedAnnotation[],
  groupId: string,
  aliases: readonly string[],
): SavedAnnotation[] {
  return filterSavedAnnotationsForDocument(savedAnnotations, groupId, aliases);
}

/**
 * Fetch every annotation in a group via `/api/search`.
 *
 * Used when `GET /api/groups/{pubid}/annotations` returns 404 for non-moderator
 * members (that endpoint requires `group:moderate`).
 */
async function fetchAllGroupAnnotationsViaSearch(
  api: APIService,
  groupId: string,
  signal: AbortSignal,
): Promise<SavedAnnotation[]> {
  const annotations: SavedAnnotation[] = [];
  let searchAfter: string | undefined;
  let expectedTotal: number | null = null;
  let fetchedCount = 0;

  for (let page = 0; page < MAX_GROUP_ANNOTATION_PAGES; page++) {
    if (signal.aborted) {
      break;
    }

    const searchQuery: Record<string, string | number | boolean> = {
      group: groupId,
      limit: SEARCH_GROUP_ANNOTATIONS_PAGE_SIZE,
      sort: 'created',
      order: 'desc',
      _separate_replies: false,
    };
    if (searchAfter) {
      searchQuery.search_after = searchAfter;
    }

    const result = await api.search(searchQuery, undefined, signal);
    if (expectedTotal === null) {
      expectedTotal = result.total;
    }

    const pageAnnotations = result.rows.concat(result.replies ?? []);
    for (const ann of pageAnnotations) {
      if (isSaved(ann)) {
        annotations.push(ann);
      }
    }
    fetchedCount += pageAnnotations.length;

    const expectMore =
      expectedTotal !== null &&
      (fetchedCount < expectedTotal || expectedTotal > 1000);

    let nextSearchAfter: string | undefined;
    if (pageAnnotations.length > 0 && expectMore) {
      nextSearchAfter = pageAnnotations[pageAnnotations.length - 1]?.created;
    }

    if (!nextSearchAfter || nextSearchAfter === searchAfter) {
      break;
    }
    searchAfter = nextSearchAfter;
  }

  return annotations;
}

/**
 * Fetch every annotation in a group via `GET /api/groups/{pubid}/annotations`.
 *
 * This endpoint paginates with `page[after]` (a date-time cursor, "older than
 * this date") + `page[size]` and returns `{ meta, data }`. It requires the
 * `group:moderate` permission, so non-moderator members receive 404.
 */
async function fetchAllGroupAnnotationsViaGroupEndpoint(
  api: APIService,
  groupId: string,
  signal: AbortSignal,
): Promise<SavedAnnotation[]> {
  const annotations: SavedAnnotation[] = [];
  let pageAfter: string | undefined;

  for (let page = 0; page < MAX_GROUP_ANNOTATION_PAGES; page++) {
    if (signal.aborted) {
      break;
    }

    const params: { pubid: string } & Record<string, string | number> = {
      pubid: groupId,
      'page[size]': GROUP_ANNOTATIONS_PAGE_SIZE,
    };
    if (pageAfter) {
      params['page[after]'] = pageAfter;
    }

    const result = await api.group.annotations.read(params, undefined, signal);
    const data = result.data ?? [];
    for (const ann of data) {
      if (isSaved(ann)) {
        annotations.push(ann);
      }
    }

    if (data.length < GROUP_ANNOTATIONS_PAGE_SIZE) {
      break;
    }

    const nextCursor = data[data.length - 1]?.created;
    if (!nextCursor || nextCursor === pageAfter) {
      break;
    }
    pageAfter = nextCursor;
  }

  return annotations;
}

async function fetchAllGroupAnnotations(
  api: APIService,
  groupId: string,
  signal: AbortSignal,
): Promise<SavedAnnotation[]> {
  try {
    return await fetchAllGroupAnnotationsViaGroupEndpoint(
      api,
      groupId,
      signal,
    );
  } catch (err) {
    const status =
      err instanceof FetchError ? err.response?.status ?? null : null;
    if (status !== 404) {
      throw err;
    }

    return fetchAllGroupAnnotationsViaSearch(api, groupId, signal);
  }
}

/**
 * Keeps tag inventory rows in sync and loads all group annotations for
 * private-group AI few-shot examples.
 */
// @inject
export class TagInventoryGroupSyncService {
  private _api: APIService;
  private _store: SidebarStore;
  private _syncing = false;
  private _initDone = false;
  private _groupAnnotationCache = new Map<string, SavedAnnotation[]>();
  private _groupAnnotationCacheLoaded = new Set<string>();
  private _activeSync: Promise<void> | null = null;
  private _syncOnStack = false;
  private _resyncAfterCurrent = false;
  private _groupFetchPromises = new Map<string, Promise<SavedAnnotation[]>>();
  private _groupFetchControllers = new Map<string, AbortController>();
  /** Suppresses per-annotation inventory sync during bulk mutations. */
  private _inventorySyncDeferDepth = 0;

  constructor(api: APIService, store: SidebarStore) {
    this._api = api;
    this._store = store;
  }

  init() {
    if (this._initDone) {
      return;
    }
    this._initDone = true;

    // Re-sync when the document URI becomes available after the frame
    // re-registers (e.g. sidebar opened by annotation creation before
    // documentInfoChanged arrives). This fires the first time currentDocumentUri
    // transitions from null to a real value, creating rows with the correct URI.
    watch(
      this._store.subscribe,
      () =>
        resolveDocumentUriFromCandidates(this._store, [
          ...documentUriAliases(this._store),
        ]),
      (docUri, prevDocUri) => {
        if (!docUri || docUri === prevDocUri) {
          return;
        }
        const groupId = this._store.focusedGroupId();
        if (groupId === PUBLIC_GROUP_ID) {
          backfillPublicTagInventoryDocumentUris(this._store);
          void this.applyStoreAnnotationsToInventory();
        }
      },
    );

    watch(
      this._store.subscribe,
      () => this._store.hasFetchedAnnotations(),
      (hasFetched, hadFetched) => {
        if (!hasFetched || hadFetched) {
          return;
        }
        const groupId = this._store.focusedGroupId();
        if (groupId === PUBLIC_GROUP_ID) {
          void this.applyStoreAnnotationsToInventory();
        }
      },
    );

    watch(
      this._store.subscribe,
      () =>
        [
          this._store.hasFetchedProfile(),
          this._store.focusedGroupId(),
        ] as const,
      ([hasProfile, groupId], [, prevGroupId]) => {
        if (!hasProfile || !groupId) {
          return;
        }
        if (prevGroupId && prevGroupId !== groupId) {
          this._clearGroupAnnotationCache();
        }
        queueMicrotask(() => {
          if (groupId === PUBLIC_GROUP_ID) {
            void this.applyStoreAnnotationsToInventory();
          } else {
            void this.getGroupAnnotations(groupId).catch(err => {
              console.warn(
                '[TagInventoryGroupSync] group annotations load failed',
                err,
              );
            });
          }
        });
      },
      focusedGroupWatchValuesEqual,
    );
  }

  /**
   * Annotations from the last successful full-group fetch for `groupId`.
   * Returns `null` if that group has not been fetched yet (distinct from `[]`).
   */
  cachedGroupAnnotations(groupId: string): SavedAnnotation[] | null {
    if (!this._groupAnnotationCacheLoaded.has(groupId)) {
      return null;
    }
    return this._groupAnnotationCache.get(groupId) ?? [];
  }

  /**
   * Load all annotations in a private group (cached; one in-flight fetch per
   * `groupId`). Updates inventory rows from the full group set.
   */
  async getGroupAnnotations(
    groupId: string,
    { force = false }: { force?: boolean } = {},
  ): Promise<SavedAnnotation[]> {
    if (groupId === PUBLIC_GROUP_ID) {
      return savedAnnotationsForCurrentDocument(
        this._store.savedAnnotations(),
        groupId,
        this._store.searchUris(),
      );
    }

    const inFlight = this._groupFetchPromises.get(groupId);
    if (inFlight) {
      return inFlight;
    }

    if (!force) {
      const cached = this.cachedGroupAnnotations(groupId);
      if (cached !== null) {
        return cached;
      }
    }

    const controller = new AbortController();
    this._groupFetchControllers.set(groupId, controller);

    const work = (async () => {
      try {
        const annotations = await fetchAllGroupAnnotations(
          this._api,
          groupId,
          controller.signal,
        );
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        this._setGroupAnnotationCache(groupId, annotations);
        this._applyFullGroupInventory(groupId, annotations);
        return annotations;
      } finally {
        this._groupFetchPromises.delete(groupId);
        this._groupFetchControllers.delete(groupId);
      }
    })();

    this._groupFetchPromises.set(groupId, work);
    return work;
  }

  /**
   * Run `work` without reconciling inventory after each store mutation; one sync
   * runs when the outermost deferred scope completes.
   */
  async runWithDeferredInventorySync(work: () => Promise<void>): Promise<void> {
    this._inventorySyncDeferDepth++;
    try {
      await work();
    } finally {
      this._inventorySyncDeferDepth--;
      if (this._inventorySyncDeferDepth === 0) {
        await this.applyStoreAnnotationsToInventory();
      }
    }
  }

  /**
   * Reconcile tag inventory rows from annotations already loaded for the
   * current document. No network requests.
   */
  async applyStoreAnnotationsToInventory(
    options: SyncGroupInventoryOptions = {},
  ) {
    if (this._inventorySyncDeferDepth > 0) {
      return;
    }
    if (this._syncOnStack) {
      this._resyncAfterCurrent = true;
      return this._activeSync ?? Promise.resolve();
    }

    const groupId = this._store.focusedGroupId();
    if (!groupId) {
      return;
    }

    const aliases = options.documentUris ?? documentUriAliases(this._store);
    this._syncing = true;
    this._syncOnStack = true;

    const syncWork = (async () => {
      try {
        if (groupId === PUBLIC_GROUP_ID) {
          const annotations = filterSavedAnnotationsForDocument(
            this._store.savedAnnotations(),
            groupId,
            aliases,
          );
          const resolvedUri = resolveDocumentUriFromCandidates(this._store, [
            ...aliases,
          ]);
          if (!resolvedUri) {
            return;
          }
          this._applyDocumentInventory(groupId, annotations, {
            documentUri: resolvedUri,
            documentUriAliases: aliases,
          });
        } else {
          // Private groups: avoid document-scoped partial sync before the full
          // group fetch completes (causes row/count flicker on panel open).
          if (!this._groupAnnotationCacheLoaded.has(groupId)) {
            return;
          }
          const annotations = this._store
            .savedAnnotations()
            .filter(ann => ann.group === groupId && isSaved(ann));
          this._applyDocumentInventory(groupId, annotations, {
            documentUriAliases: aliases,
          });
        }
      } catch (err) {
        console.warn('[TagInventoryGroupSync] document sync failed', err);
      } finally {
        this._syncing = false;
      }
    })();

    this._activeSync = syncWork;
    try {
      await syncWork;
    } finally {
      this._syncOnStack = false;
      if (this._activeSync === syncWork) {
        this._activeSync = null;
      }
      if (this._resyncAfterCurrent) {
        this._resyncAfterCurrent = false;
        void this.applyStoreAnnotationsToInventory(options);
      }
    }
  }

  /**
   * Upsert realtime updates into the private-group cache and drop deletions.
   * No-op when the cache has not been populated yet.
   */
  mergePendingUpdatesIntoCache(updates: Annotation[], deletedIds: string[]) {
    const groupId = this._store.focusedGroupId();
    if (!groupId || groupId === PUBLIC_GROUP_ID) {
      return;
    }
    if (!this._groupAnnotationCacheLoaded.has(groupId)) {
      return;
    }

    const deletionSet = new Set(deletedIds);
    const cached = (this._groupAnnotationCache.get(groupId) ?? []).filter(
      ann => !ann.id || !deletionSet.has(ann.id),
    );

    for (const ann of updates) {
      if (!isSaved(ann) || ann.group !== groupId) {
        continue;
      }
      const idx = cached.findIndex(a => a.id === ann.id);
      if (idx >= 0) {
        cached[idx] = ann;
      } else {
        cached.push(ann);
      }
    }

    this._setGroupAnnotationCache(groupId, cached);
  }

  private _applyDocumentInventory(
    groupId: string,
    annotations: SavedAnnotation[],
    options?: {
      documentUri?: string;
      documentUriAliases?: readonly string[];
      idSourceAnnotations?: SavedAnnotation[];
    },
  ) {
    const aliases =
      options?.documentUriAliases ?? documentUriAliases(this._store);
    const documentUri =
      options?.documentUri ??
      resolveDocumentUriFromCandidates(this._store, [...aliases]) ??
      undefined;
    applyDerivedTagInventoryRows(this._store, {
      groupId,
      annotations,
      idSourceAnnotations: options?.idSourceAnnotations,
      documentUri,
      documentUriAliases: aliases,
    });
  }

  private _applyFullGroupInventory(
    groupId: string,
    annotations: SavedAnnotation[],
  ) {
    const aliases = documentUriAliases(this._store);
    if (groupId === PUBLIC_GROUP_ID) {
      const documentUri = currentDocumentUri(this._store);
      const idSourceAnnotations = documentUri
        ? filterSavedAnnotationsForDocument(annotations, groupId, aliases)
        : [];
      this._applyDocumentInventory(groupId, annotations, {
        documentUri: documentUri ?? undefined,
        idSourceAnnotations,
        documentUriAliases: aliases,
      });
    } else {
      this._applyDocumentInventory(groupId, annotations, {
        documentUriAliases: aliases,
      });
      const descriptors = deriveTagInventoryRowDescriptors(annotations);
      this._store.pruneTagInventoryRowsForGroup(groupId, descriptors);
    }
  }

  private _clearGroupAnnotationCache() {
    for (const controller of this._groupFetchControllers.values()) {
      controller.abort();
    }
    this._groupFetchControllers.clear();
    this._groupFetchPromises.clear();
    this._groupAnnotationCache.clear();
    this._groupAnnotationCacheLoaded.clear();
  }

  private _setGroupAnnotationCache(
    groupId: string,
    annotations: SavedAnnotation[],
  ) {
    this._groupAnnotationCache.set(groupId, annotations);
    this._groupAnnotationCacheLoaded.add(groupId);
  }
}
