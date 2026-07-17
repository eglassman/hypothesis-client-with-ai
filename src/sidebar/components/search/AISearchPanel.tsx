import {
  Button,
  CancelIcon,
  Card,
  CardContent,
  confirm,
  HideIcon,
  Input,
  RedoIcon,
  ShowIcon,
  TrashIcon,
} from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  hexColorInputToRgba,
  highlightRgbaFromString,
  rgbaStringToHexColorInput,
  TAG_HIGHLIGHT_ALPHA,
} from '../../../shared/tag-color-from-string';
import type { SavedAnnotation } from '../../../types/api';
import { quote as annotationQuote } from '../../helpers/annotation-metadata';
import {
  buildClaudeAISearchUserMessage,
  buildClaudeStep2UserMessage,
  collectNegativeExamplesFromAnnotations,
  collectPositiveExamplesFromAnnotations,
  countAiSearchQuotesSkippedAsDuplicates,
  countTagInventoryRowPendingAnnotations,
  deleteAllActionForTagInventoryRowMatch,
  expectedTagsForStrictAISearchPending,
  filterAiSearchQuotesAgainstExisting,
  listSavedAnnotationsMatchingTagInventoryRow,
  listStrictTagInventoryRowPendingAnnotations,
  tagsAfterRemovingTagInventoryRowSchemaTag,
} from '../../helpers/claude-ai-search-user-message';
import {
  claudeAccessibleDocumentUri,
  documentUriAliases,
  filterSavedAnnotationsForDocument,
  resolveDocumentUriFromCandidates,
} from '../../helpers/document-uri';
import { formatSidebarTagFilter } from '../../helpers/filter-query-for-tag';
import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import { sharedPermissions } from '../../helpers/permissions';
import {
  aiPrimaryTagMarker,
  countAnnotationsForTagInventoryRow,
  isNegativeSchemaTag,
  isTagInventoryRowVisibleInScope,
  listAnnotationsForTagInventoryRow,
  positiveSchemaTags,
  sortTagInventoryRows,
} from '../../helpers/tag-inventory-group';
import {
  emptyNodeLinkState,
  tagReferenceForNodeLinkState,
} from '../../node-link/graph-state';
import { withServices } from '../../service-context';
import type { AnnotationsService } from '../../services/annotations';
import type { APIService } from '../../services/api';
import {
  isClaudeDocumentDownloadError,
  type ClaudeSearchResult,
  type ClaudeService,
} from '../../services/claude';
import type { ExperimentLogService } from '../../services/experiment-log';
import type { FrameSyncService } from '../../services/frame-sync';
import type { NodeLinkStateService } from '../../services/node-link-state';
import type { PersistedTagInventoryService } from '../../services/persisted-tag-inventory';
import type { TagInventoryGroupSyncService } from '../../services/tag-inventory-group-sync';
import { savedAnnotationsForCurrentDocument } from '../../services/tag-inventory-group-sync';
import { pushTagPalette } from '../../services/tag-palette-sync';
import type { ToastMessengerService } from '../../services/toast-messenger';
import { useSidebarStore } from '../../store';
import {
  tagInventoryRowId,
  type TagInventoryRow,
} from '../../store/modules/sidebar-panels';
import {
  createRateLimitCoordinator,
  isRateLimitFetchError,
  retryOnRateLimit,
} from '../../util/retry-on-rate-limit';
import { SearchableCombobox } from '../SearchableCombobox';
import SidebarPanel from '../SidebarPanel';
import SearchField from './SearchField';
import { abortAllClaudeRuns, registerClaudeRun } from './ai-search-claude-runs';

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** At most one progress toast per second; always emit first and last index. */
function emitThrottledProgress(
  toastMessenger: ToastMessengerService,
  prefix: string,
  index: number,
  total: number,
  lastEmitMs: { current: number },
) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const now = Date.now();
  if (isFirst || isLast || now - lastEmitMs.current >= 5000) {
    lastEmitMs.current = now;
    toastMessenger.notice(`${prefix} ${index + 1}/${total}`);
  }
}

/**
 * Parallel H API delete/update requests during delete-all. Store updates are
 * deferred until API work finishes so frame-sync does not block the event loop.
 */
const DELETE_ALL_MAX_CONCURRENCY = 20;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function formatClaudeWaitElapsed(anchorMs: number, nowMs: number): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs - anchorMs) / 1000));
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const aiSearchHistoryActionButtonClass =
  'p-0.5 rounded text-grey-6 hover:text-color-text hover:bg-grey-2 transition-colors duration-200 focus-visible-ring';

/** Native title / aria-label for the history-table rerun (redo) control */
const aiSearchRerunButtonHelpText =
  'Delete all pending suggestions for this tag and query, then re-run the AI search using updated positive and negative annotation examples from all tags on this document.';

function deleteAllConfirmMessage(row: TagInventoryRow): string {
  const tag = row.schemaTag.trim();
  const query = row.query.trim();
  const patchNote =
    'Annotations with other tags keep those tags; annotations that only have this row’s tag (plus ai-pending / ai-user-approved) are deleted entirely.';

  if (tag && isNegativeSchemaTag(tag)) {
    return `Deletes or untags negative examples for ${tag} on this document (same set as the Total column). ${patchNote}`;
  }
  if (query) {
    return `Deletes or untags pending and approved AI annotations for this search query on this document (same set as the Total column). Manual highlights tagged ${tag} are not affected. ${patchNote}`;
  }
  if (tag) {
    return `Deletes or untags manual highlights tagged ${tag} on this document (same set as the Total column). AI pending/approved suggestions for specific queries are not affected. ${patchNote}`;
  }
  return `Matching annotations on this document are deleted entirely (same set as the Total column).`;
}

type AISearchPanelProps = {
  annotationsService: AnnotationsService;
  experimentLog: ExperimentLogService;
  frameSync: FrameSyncService;
  claude: ClaudeService;
  api: APIService;
  nodeLinkState: NodeLinkStateService;
  toastMessenger: ToastMessengerService;
  tagInventoryGroupSync: TagInventoryGroupSyncService;
  persistedTagInventory: PersistedTagInventoryService;
};

function AISearchPanel({
  annotationsService,
  experimentLog,
  frameSync,
  claude,
  api,
  nodeLinkState,
  toastMessenger,
  tagInventoryGroupSync,
  persistedTagInventory,
}: AISearchPanelProps) {
  const store = useSidebarStore();
  /** AI prompt text only; not the global sidebar filter query (see setFilterQuery). */
  const aiSearchFieldQuery = store.aiSearchPanelQueryInput();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [runAISearchInFlight, setRunAISearchInFlight] = useState(false);
  const [claudeAPIKey, setClaudeAPIKey] = useState('');
  const schemaTag = store.aiSearchPanelSchemaTagInput();
  const annotateManually = store.aiSearchPanelAnnotateManually();
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  /** Live Total column during delete-all without per-delete store dispatches. */
  const [deleteAllRemaining, setDeleteAllRemaining] = useState<{
    rowId: string;
    remaining: number;
  } | null>(null);
  const [rerunningRowId, setRerunningRowId] = useState<string | null>(null);
  const rerunLockRef = useRef(false);
  /** Synchronous guard against overlapping runAISearch calls (state updates are async). */
  const searchInFlightRef = useRef(false);
  /** Wall time when the current Claude API request started; drives panel timer + Stop. */
  const [claudeRunStartedAt, setClaudeRunStartedAt] = useState<number | null>(
    null,
  );
  const [claudeTimerTick, setClaudeTimerTick] = useState(0);
  /** When true, rows marked `hidden` are included in the history table. */
  const [showHiddenRows, setShowHiddenRows] = useState(true);
  /** True while a user-triggered "Refresh group tags" sync is in flight. */
  const [refreshingGroupTags, setRefreshingGroupTags] = useState(false);

  const aiRows = store.tagInventoryRows();
  const focusedGroupId = store.focusedGroupId();
  const savedAnnotations = store.savedAnnotations();
  const schemaTagColors = store.tagInventorySchemaTagColors();
  const uriAliases = documentUriAliases(store);
  const claudeDocumentUri = claudeAccessibleDocumentUri(store);
  /** Stable URI for inventory scope, counts, and palette (ignores stray frame URIs). */
  const documentUri = resolveDocumentUriFromCandidates(store, [...uriAliases]);

  const globalRowLock =
    runAISearchInFlight || rerunningRowId !== null || deletingRowId !== null;
  const canAnnotateManually = schemaTag.trim().length > 0;

  /** Rows visible in the focused group (before the hidden-row toggle). */
  const scopedRows = useMemo(() => {
    if (!focusedGroupId) {
      return [];
    }
    return aiRows.filter(row =>
      isTagInventoryRowVisibleInScope(row, {
        focusedGroupId,
        currentDocumentUri: documentUri,
        documentUriAliases: uriAliases,
      }),
    );
  }, [aiRows, focusedGroupId, documentUri, uriAliases]);
  const displayRows = useMemo(
    () =>
      sortTagInventoryRows(
        showHiddenRows ? scopedRows : scopedRows.filter(r => !r.hidden),
      ),
    [scopedRows, showHiddenRows],
  );
  const schemaTagOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(schemaTagColors),
          ...scopedRows.map(row => row.schemaTag.trim()).filter(Boolean),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [schemaTagColors, scopedRows],
  );
  const isPublicGroup = focusedGroupId === PUBLIC_GROUP_ID;
  const annotationsForInventoryCount = useMemo(() => {
    if (!focusedGroupId) {
      return savedAnnotations;
    }
    if (isPublicGroup) {
      return filterSavedAnnotationsForDocument(
        savedAnnotations,
        focusedGroupId,
        uriAliases,
      );
    }
    const cached = tagInventoryGroupSync.cachedGroupAnnotations(focusedGroupId);
    if (!cached) {
      return savedAnnotations;
    }
    const byId = new Map<string, SavedAnnotation>();
    for (const ann of savedAnnotations) {
      if (ann.id) {
        byId.set(ann.id, ann);
      }
    }
    for (const ann of cached) {
      if (ann.id && !byId.has(ann.id)) {
        byId.set(ann.id, ann);
      }
    }
    return [...byId.values()];
  }, [
    savedAnnotations,
    focusedGroupId,
    isPublicGroup,
    tagInventoryGroupSync,
    uriAliases,
  ]);
  const hasAnyHiddenRows = useMemo(
    () => scopedRows.some(r => r.hidden === true),
    [scopedRows],
  );

  /** Private groups can always refresh, even before any rows exist. */
  const canRefreshGroupTags = !isPublicGroup && !!focusedGroupId;
  const showHistorySection = scopedRows.length > 0;
  const emptyHistoryMessage =
    scopedRows.length === 0
      ? 'No AI search tags found in this group yet.'
      : 'All rows are hidden.';
  const hiddenRowsToggleDisabled = !hasAnyHiddenRows;
  const hiddenRowsToggleTitle = hiddenRowsToggleDisabled
    ? 'No un-rendered rows'
    : showHiddenRows
      ? 'Hide un-rendered rows from this list'
      : 'Show un-rendered rows in this list';

  useEffect(() => {
    if (claudeRunStartedAt === null) {
      return undefined;
    }
    const id = window.setInterval(() => setClaudeTimerTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [claudeRunStartedAt]);

  const claudeWaitElapsedLabel = useMemo(() => {
    if (claudeRunStartedAt === null) {
      return '';
    }
    return formatClaudeWaitElapsed(claudeRunStartedAt, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claudeTimerTick advances the clock display
  }, [claudeRunStartedAt, claudeTimerTick]);

  const closeAISearchPanel = () => {
    store.closeSidebarPanel('aiSearchAnnotations');
  };
  const clearQueryInput = () => {
    store.setAISearchPanelQueryInput(null);
  };

  /**
   * Re-fetch all annotations in the focused (private) group and re-derive
   * history rows. Disabled for Public (document-scoped) and while in flight.
   */
  const onRefreshGroupTags = async () => {
    if (isPublicGroup || refreshingGroupTags) {
      return;
    }
    const groupId = store.focusedGroupId();
    if (!groupId) {
      return;
    }
    setRefreshingGroupTags(true);
    try {
      await tagInventoryGroupSync.getGroupAnnotations(groupId, { force: true });
    } catch (error) {
      console.error('Failed to refresh group tags:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to refresh group tags.';
      toastMessenger.error(message);
    } finally {
      setRefreshingGroupTags(false);
    }
  };

  async function runAISearch(
    schemaTagForRow: string,
    query: string,
    options?: { isRerun?: boolean },
  ) {
    const ownedByRerun = searchInFlightRef.current && !!options?.isRerun;
    if (searchInFlightRef.current && !ownedByRerun) {
      return;
    }
    const acquiredLockHere = !searchInFlightRef.current;
    if (acquiredLockHere) {
      searchInFlightRef.current = true;
      setRunAISearchInFlight(true);
    }
    try {
      const userid = store.profile().userid;
      const groupId = store.focusedGroupId();

      if (!userid) {
        toastMessenger.error(
          'Not signed in — please sign in to use AI search.',
        );
        return;
      }
      if (!groupId) {
        toastMessenger.error('No group selected.');
        return;
      }
      if (!documentUri) {
        toastMessenger.error(
          'No document URL — Hypothesis may not be connected to this page.',
        );
        return;
      }
      if (!claudeDocumentUri) {
        toastMessenger.error(
          'No downloadable document URL found for AI search.',
        );
        return;
      }

      let fewShotAnnotations: SavedAnnotation[];
      if (groupId === PUBLIC_GROUP_ID) {
        fewShotAnnotations = savedAnnotationsForCurrentDocument(
          store.savedAnnotations(),
          groupId,
          store.searchUris(),
        );
      } else {
        try {
          fewShotAnnotations =
            await tagInventoryGroupSync.getGroupAnnotations(groupId);
        } catch (error) {
          console.error(
            'Failed to load group annotations for AI search:',
            error,
          );
          const detail =
            error instanceof Error ? error.message : 'Unknown error';
          toastMessenger.error(
            `Could not load group annotations for AI search: ${detail}`,
          );
          return;
        }
      }

      const positiveExamples = await collectPositiveExamplesFromAnnotations(
        fewShotAnnotations,
        annotationsService,
      );
      const negativeExamples =
        collectNegativeExamplesFromAnnotations(fewShotAnnotations);
      let nodeLinkSemanticState = emptyNodeLinkState({
        selectedGroupId: groupId,
      });
      try {
        nodeLinkSemanticState = (await nodeLinkState.loadState(groupId)).state;
      } catch (error) {
        console.warn(
          'Failed to load tag reference for AI search; continuing with annotation tags only:',
          error,
        );
      }
      const tagReference = tagReferenceForNodeLinkState(
        nodeLinkSemanticState,
        fewShotAnnotations,
        groupId,
      );
      const tagTrim = schemaTagForRow.trim();
      const fullUserMessage = buildClaudeAISearchUserMessage({
        positiveExamples,
        schemaTag: tagTrim,
        searchQuery: query,
        negativeExamples,
        tagReference,
      });

      console.log('[AISearch] Claude request', {
        schemaTag: tagTrim,
        searchQuery: query,
        tagReference,
        positiveExampleCount: positiveExamples.length,
        negativeExampleCount: negativeExamples.length,
        userMessage: fullUserMessage,
        documentUri: claudeDocumentUri,
      });

      const claudeRun = registerClaudeRun();
      if (!claudeRun) {
        toastMessenger.notice('AI search already in progress.');
        return;
      }
      const { signal, finish } = claudeRun;
      setClaudeRunStartedAt(Date.now());
      let claudeResult: ClaudeSearchResult;
      const isPdfDocument = uriAliases.some(u => u.startsWith('urn:x-pdf:'));
      try {
        const claudeRequestBase = {
          query: fullUserMessage,
          apiKey: claude.apiKey(),
          signal,
        };
        toastMessenger.notice('Waiting on model');
        try {
          // eslint-disable-next-line new-cap -- AISearchDocument is a service method, not a constructor
          claudeResult = await claude.AISearchDocument({
            ...claudeRequestBase,
            documentUri: claudeDocumentUri,
          });
        } catch (urlError) {
          if (!isClaudeDocumentDownloadError(urlError)) {
            throw urlError;
          }
          if (isPdfDocument) {
            toastMessenger.notice('Uploading PDF from browser…');
            let documentPdfBase64: string;
            try {
              documentPdfBase64 = await frameSync.getPdfBytes();
            } catch (bytesError) {
              console.warn(
                '[AISearch] Claude could not download URL and guest PDF read failed',
                bytesError,
              );
              throw urlError;
            }
            // eslint-disable-next-line new-cap -- AISearchDocument is a service method, not a constructor
            claudeResult = await claude.AISearchDocument({
              ...claudeRequestBase,
              documentPdfBase64,
            });
          } else {
            toastMessenger.notice('Uploading page text from browser…');
            let documentPlainText: string;
            try {
              documentPlainText = await frameSync.getDocumentText();
            } catch (textError) {
              console.warn(
                '[AISearch] Claude could not download URL and guest HTML text read failed',
                textError,
              );
              throw urlError;
            }
            // eslint-disable-next-line new-cap -- AISearchDocument is a service method, not a constructor
            claudeResult = await claude.AISearchDocument({
              ...claudeRequestBase,
              documentPlainText,
            });
          }
        }
      } finally {
        finish();
        setClaudeRunStartedAt(null);
      }

      if (signal.aborted) {
        return;
      }

      const rawQuotes = ((claudeResult.answer as any).result?.[0]?.quotes ??
        []) as Array<{ text?: string }>;
      const quotes = filterAiSearchQuotesAgainstExisting(
        rawQuotes,
        store.savedAnnotations(),
        documentUri,
        tagTrim,
        uriAliases,
      );
      const skippedDuplicate = countAiSearchQuotesSkippedAsDuplicates(
        rawQuotes,
        quotes,
      );

      const tags = expectedTagsForStrictAISearchPending(tagTrim);

      toastMessenger.notice('Creating annotations…');

      const created = [];
      for (const quote of quotes) {
        if (!quote.text?.trim()) {
          continue;
        }
        const payload = {
          group: groupId,
          uri: documentUri,
          target: [
            {
              source: documentUri,
              selector: [
                { type: 'TextQuoteSelector' as const, exact: quote.text },
              ],
            },
          ],
          text: query,
          tags,
          permissions: sharedPermissions(userid, groupId),
        };
        const ann = await api.annotation.create({}, payload);
        created.push(ann);
      }
      if (created.length) {
        store.addAnnotations(created);
      }

      // Step 2: for each returned quote, ask Claude which other tags apply.
      // Extra tags are added to the same annotation alongside the primary tag.
      // An `ai-primary-tag:<name>` system marker is added so the inventory
      // counts extra tags under "No query" rows, not the primary tag's query row.
      if (created.length > 0 && !signal.aborted) {
        // Build the allowed tag set from the live store so it includes tags
        // created during this session (not just those loaded at search start).
        const knownTagSet = new Set(
          store
            .savedAnnotations()
            .filter(a => a.group === groupId)
            .flatMap(a => positiveSchemaTags(a.tags ?? [])),
        );
        try {
          toastMessenger.notice('Identifying additional tags…');
          for (const ann of created) {
            if (signal.aborted) {
              break;
            }
            const quoteText = (annotationQuote(ann) ?? '').trim();
            if (!quoteText) {
              continue;
            }
            const step2Message = buildClaudeStep2UserMessage(
              {
                positiveExamples,
                negativeExamples,
                tagReference,
                schemaTag: tagTrim,
              },
              quoteText,
            );
            const otherTags = await claude.classifyQuoteForOtherTags({
              userMessage: step2Message,
              apiKey: claude.apiKey(),
              signal,
            });
            const extraTags = otherTags.filter(t => {
              const trimmed = t.trim();
              return (
                trimmed !== tagTrim &&
                knownTagSet.has(trimmed) &&
                !(ann.tags ?? []).includes(trimmed)
              );
            });
            console.log('[AISearch Step 2] quote:', quoteText);
            console.log('[AISearch Step 2] otherTags (raw from Claude):', otherTags);
            console.log('[AISearch Step 2] extraTags (after filtering):', extraTags);
            console.log('[AISearch Step 2] knownTagSet:', [...knownTagSet]);
            if (!extraTags.length) {
              continue;
            }
            const primaryMarker = aiPrimaryTagMarker(tagTrim);
            const newTags = [
              ...(ann.tags ?? []),
              primaryMarker,
              ...extraTags,
            ];
            let updated = await api.annotation.update(
              { id: ann.id },
              { tags: newTags },
            );
            for (const [key, value] of Object.entries(ann)) {
              if (key.startsWith('$')) {
                updated = { ...updated, [key]: value };
              }
            }
            store.addAnnotations([updated as SavedAnnotation]);
          }
        } catch (err) {
          if (!isAbortError(err)) {
            console.warn('[AISearch] Step 2 failed (non-fatal):', err);
          }
        }
      }

      const newIds = created
        .map(a => a.id)
        .filter((id): id is string => typeof id === 'string');

      const isPublicGroup = groupId === PUBLIC_GROUP_ID;
      const docUri = isPublicGroup ? documentUri : undefined;
      const rowId = tagInventoryRowId(schemaTagForRow, query, groupId, docUri);

      if (options?.isRerun) {
        store.setTagInventoryRowAnnotationIds(rowId, newIds);
        store.setTagInventoryRowHidden(rowId, false);
      } else {
        store.addTagInventoryRow({
          id: rowId,
          groupId,
          schemaTag: schemaTagForRow,
          query,
          annotationIds: newIds,
          ...(docUri !== undefined ? { documentUri: docUri } : {}),
        });
      }

      experimentLog.logSearch({
        query,
        schemaTag: schemaTagForRow,
        searchRowId: rowId,
        documentUri: documentUri,
        annotationIdsCreated: newIds,
        quoteTexts: created.map(a => annotationQuote(a) ?? ''),
      });

      void tagInventoryGroupSync.applyStoreAnnotationsToInventory();

      let successMsg = `Created ${created.length} annotation(s) from AI results.`;
      if (skippedDuplicate > 0) {
        successMsg += ` Skipped ${skippedDuplicate} already covered.`;
      }
      toastMessenger.success(successMsg);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      console.error('Error creating annotations from AI results:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to create annotations from AI results.';
      toastMessenger.error(message);
    } finally {
      if (acquiredLockHere) {
        searchInFlightRef.current = false;
        setRunAISearchInFlight(false);
      }
    }
  }

  async function onAISearch(query: string) {
    if (searchInFlightRef.current || rerunLockRef.current) {
      return;
    }
    const docUri = focusedGroupId === PUBLIC_GROUP_ID ? documentUri : undefined;
    const targetId = tagInventoryRowId(
      schemaTag,
      query,
      focusedGroupId ?? undefined,
      docUri ?? undefined,
    );
    const matchingRow = aiRows.find(r => r.id === targetId);
    if (matchingRow) {
      await onRerunRow(matchingRow);
    } else {
      await runAISearch(schemaTag, query);
    }
  }

  async function onRerunRow(row: TagInventoryRow) {
    if (rerunLockRef.current || searchInFlightRef.current) {
      return;
    }
    rerunLockRef.current = true;
    searchInFlightRef.current = true;
    setRunAISearchInFlight(true);
    try {
      const userid = store.profile().userid;
      const groupId = store.focusedGroupId();
      const documentUri = resolveDocumentUriFromCandidates(store, [
        ...documentUriAliases(store),
      ]);

      if (!userid) {
        toastMessenger.error(
          'Not signed in — please sign in to use AI search.',
        );
        return;
      }
      if (!groupId) {
        toastMessenger.error('No group selected.');
        return;
      }
      if (!documentUri) {
        toastMessenger.error(
          'No document URL — Hypothesis may not be connected to this page.',
        );
        return;
      }

      setRerunningRowId(row.id);
      try {
        const pending = listStrictTagInventoryRowPendingAnnotations(
          store.savedAnnotations() as SavedAnnotation[],
          documentUri,
          row.schemaTag,
          row.query,
          uriAliases,
        );

        const deletedIds: string[] = [];
        const progressEmit = { current: 0 };
        for (let i = 0; i < pending.length; i++) {
          const ann = pending[i];
          emitThrottledProgress(
            toastMessenger,
            'Deleting pending…',
            i,
            pending.length,
            progressEmit,
          );
          if (ann.id) {
            await annotationsService.delete(ann);
            deletedIds.push(ann.id);
          }
        }
        if (deletedIds.length) {
          store.removeAnnotationIdsFromTagInventoryRows(deletedIds);
        }

        experimentLog.logRerunSearch({
          searchRowId: row.id,
          query: row.query,
          schemaTag: row.schemaTag,
          documentUri: documentUri,
        });

        await runAISearch(row.schemaTag, row.query, { isRerun: true });
      } catch (err) {
        console.error(err);
        toastMessenger.error('Failed to rerun AI search.');
      } finally {
        setRerunningRowId(null);
      }
    } finally {
      rerunLockRef.current = false;
      searchInFlightRef.current = false;
      setRunAISearchInFlight(false);
    }
  }

  async function onDeletePending(row: TagInventoryRow) {
    if (!documentUri) {
      toastMessenger.error('Missing PDF URL');
      return;
    }

    setDeletingRowId(row.id);
    try {
      const pending = listStrictTagInventoryRowPendingAnnotations(
        savedAnnotations as SavedAnnotation[],
        documentUri,
        row.schemaTag,
        row.query,
        uriAliases,
      );
      const deletedIds: string[] = [];
      const progressEmit = { current: 0 };
      for (let i = 0; i < pending.length; i++) {
        const ann = pending[i];
        emitThrottledProgress(
          toastMessenger,
          'Deleting pending…',
          i,
          pending.length,
          progressEmit,
        );
        if (ann.id) {
          await annotationsService.delete(ann as SavedAnnotation);
          deletedIds.push(ann.id);
        }
      }
      if (deletedIds.length) {
        store.removeAnnotationIdsFromTagInventoryRows(deletedIds);
        experimentLog.logDeletePending({
          searchRowId: row.id,
          query: row.query,
          schemaTag: row.schemaTag,
          documentUri: documentUri,
        });
        toastMessenger.success(
          `Deleted ${deletedIds.length} pending annotation(s).`,
          { visuallyHidden: true },
        );
      }
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to delete pending annotations.');
    } finally {
      setDeletingRowId(null);
    }
  }

  async function onDeleteAll(row: TagInventoryRow) {
    if (!documentUri || !focusedGroupId) {
      toastMessenger.error('Missing PDF URL');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete all for this tag and query?',
      message: deleteAllConfirmMessage(row),
      confirmAction: 'Delete all',
    });
    if (!confirmed) {
      return;
    }

    const matches = listAnnotationsForTagInventoryRow(
      annotationsForInventoryCount,
      row,
      {
        focusedGroupId,
        documentUri,
        documentUriAliases: uriAliases,
      },
    );

    setDeletingRowId(row.id);
    setDeleteAllRemaining(null);
    try {
      const schemaTrim = row.schemaTag.trim();
      let skippedOrFailedCount = 0;
      let rateLimitedCount = 0;
      let deletedCount = 0;
      const expectedCount = matches.filter(m => m.id).length;
      const rateLimitCoordinator = createRateLimitCoordinator();
      const batchRemoved: SavedAnnotation[] = [];
      const batchUpdated: SavedAnnotation[] = [];
      const batchRowIds: string[] = [];

      if (expectedCount > 0) {
        setDeleteAllRemaining({ rowId: row.id, remaining: expectedCount });
      }

      const flushDeleteAllStoreBatch = () => {
        if (
          batchRemoved.length === 0 &&
          batchUpdated.length === 0 &&
          batchRowIds.length === 0
        ) {
          return;
        }
        if (batchUpdated.length) {
          store.addAnnotations(batchUpdated.splice(0));
        }
        if (batchRemoved.length) {
          store.removeAnnotations(batchRemoved.splice(0));
        }
        if (batchRowIds.length) {
          store.removeAnnotationIdsFromTagInventoryRows(batchRowIds.splice(0));
        }
      };

      if (matches.length > 0) {
        toastMessenger.notice(
          `Deleting ${matches.length} annotation${matches.length === 1 ? '' : 's'}…`,
        );
      }

      await persistedTagInventory.runWithDeferredPersist(() =>
        tagInventoryGroupSync.runWithDeferredInventorySync(async () => {
          await mapWithConcurrency(
            matches,
            Math.min(DELETE_ALL_MAX_CONCURRENCY, matches.length),
            async ann => {
              if (!ann.id) {
                return false;
              }
              const action = deleteAllActionForTagInventoryRowMatch(
                ann,
                schemaTrim,
              );
              const retryOpts = { coordinator: rateLimitCoordinator };
              try {
                if (action === 'removeRowTag') {
                  const newTags = tagsAfterRemovingTagInventoryRowSchemaTag(
                    ann.tags,
                    schemaTrim,
                  );
                  let updated = await retryOnRateLimit(
                    () =>
                      api.annotation.update({ id: ann.id }, { tags: newTags }),
                    retryOpts,
                  );
                  for (const [key, value] of Object.entries(ann)) {
                    if (key.startsWith('$')) {
                      updated = { ...updated, [key]: value };
                    }
                  }
                  batchUpdated.push(updated as SavedAnnotation);
                } else {
                  await retryOnRateLimit(
                    () => api.annotation.delete({ id: ann.id }),
                    retryOpts,
                  );
                  batchRemoved.push(ann as SavedAnnotation);
                }
                batchRowIds.push(ann.id);
                deletedCount += 1;
                const remaining = expectedCount - deletedCount;
                if (
                  deletedCount === 1 ||
                  deletedCount === expectedCount ||
                  deletedCount % 8 === 0
                ) {
                  setDeleteAllRemaining({ rowId: row.id, remaining });
                }
                return true;
              } catch (err) {
                if (isRateLimitFetchError(err)) {
                  rateLimitedCount += 1;
                } else {
                  skippedOrFailedCount += 1;
                }
                console.error(
                  'Failed to apply delete-all action for annotation:',
                  err,
                );
                return false;
              }
            },
          );

          flushDeleteAllStoreBatch();

          const allSucceeded = deletedCount === expectedCount;
          if (allSucceeded) {
            store.removeTagInventoryRow(row.id);
          }
        }),
      );

      const allSucceeded = deletedCount === expectedCount;

      if (allSucceeded) {
        experimentLog.logDeleteAll({
          searchRowId: row.id,
          query: row.query,
          schemaTag: row.schemaTag,
          documentUri: documentUri,
        });
      }

      if (rateLimitedCount > 0) {
        toastMessenger.error(
          'Rate limited — some annotations were not deleted. Wait a minute and try again.',
        );
        if (deletedCount > 0) {
          toastMessenger.notice(
            `Deleted ${deletedCount} of ${expectedCount} annotation(s). The row was kept.`,
          );
        }
      } else if (skippedOrFailedCount > 0) {
        toastMessenger.notice(
          `Deleted ${deletedCount} of ${expectedCount} annotation(s). ${skippedOrFailedCount} could not be modified. The row was kept.`,
        );
      } else {
        toastMessenger.success('AI search row removed.');
      }
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to complete delete all.');
    } finally {
      setDeletingRowId(null);
      setDeleteAllRemaining(null);
    }
  }

  function colorForRow(row: TagInventoryRow): string {
    const tag = row.schemaTag.trim();
    if (!tag) {
      return highlightRgbaFromString('');
    }
    return schemaTagColors[tag] ?? highlightRgbaFromString(tag);
  }

  return (
    <SidebarPanel
      panelName="aiSearchAnnotations"
      label="AI search panel"
      initialFocus={inputRef}
      onActiveChanged={active => {
        if (!active) {
          store.setFilterQuery(null);
          store.setAISearchPanelQueryInput(null);
        } else {
          pushTagPalette(frameSync, store);
        }
      }}
    >
      <Card>
        <CardContent>
          <div className="flex flex-col gap-y-3">
            <Input
              aria-label="Claude API key"
              classes="text-base touch:text-touch-base"
              data-testid="claude-api-key-input"
              dir="auto"
              name="claude-api-key"
              placeholder="CLAUDE_API_KEY"
              type="password"
              value={claudeAPIKey}
              onInput={(e: Event) => {
                const value = (e.target as HTMLInputElement).value;
                setClaudeAPIKey(value);
                claude.setApiKey(value);
              }}
            />
            <SearchableCombobox
              id="schema-tag-input"
              ariaLabel="Schema tag"
              options={schemaTagOptions}
              allowCustomValue
              inputClassName="h-10 text-base touch:text-touch-base"
              placeholder="Tag"
              value={schemaTag}
              onChange={value => store.setAISearchPanelSchemaTagInput(value)}
            />
            <SearchField
              inputRef={inputRef}
              classes="grow"
              fullWidthSubmitLabel="Ask AI for Annotations"
              fullWidthSubmitLeading={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-pressed={annotateManually ? 'true' : 'false'}
                  data-testid="ai-search-manual-annotate-toggle"
                  disabled={!canAnnotateManually}
                  title={
                    canAnnotateManually
                      ? annotateManually
                        ? 'Disable manual annotation tagging'
                        : 'Enable manual annotation tagging'
                      : 'Set a schema tag to enable manual annotation tagging'
                  }
                  classes={classnames(
                    'shrink-0',
                    annotateManually && 'bg-grey-3 text-color-text',
                  )}
                  onClick={() => {
                    store.setAISearchPanelAnnotateManually(!annotateManually);
                  }}
                >
                  Annotate Manually
                </Button>
              }
              fullWidthSubmitTrailing={
                <>
                  <span
                    className="min-w-[2.5rem] text-right tabular-nums text-xs text-color-text-light"
                    aria-live={claudeRunStartedAt !== null ? 'polite' : 'off'}
                    aria-atomic="true"
                  >
                    {claudeRunStartedAt !== null
                      ? claudeWaitElapsedLabel
                      : '0:00'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="ai-search-stop-button"
                    disabled={claudeRunStartedAt === null}
                    title={
                      claudeRunStartedAt === null
                        ? 'No AI search in progress'
                        : 'Stop AI search'
                    }
                    classes="shrink-0"
                    onClick={() => abortAllClaudeRuns()}
                  >
                    Stop
                  </Button>
                </>
              }
              multiline
              allowSubmitWithJustTag={schemaTag.trim().length > 0}
              placeholder="ask AI to highlight…"
              rows={4}
              disabled={globalRowLock}
              query={aiSearchFieldQuery}
              onQueryChange={value => store.setAISearchPanelQueryInput(value)}
              onClearSearch={clearQueryInput}
              onSearch={onAISearch}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  closeAISearchPanel();
                }
              }}
            />
            {canRefreshGroupTags && (
              <button
                type="button"
                data-testid="ai-search-refresh-group-tags"
                disabled={refreshingGroupTags}
                aria-disabled={refreshingGroupTags}
                title="Re-fetch tags and examples from all annotations in this group"
                aria-label="Refresh group tags &amp; examples"
                className={classnames(
                  'shrink-0 self-start text-xs rounded px-2 py-1 border border-grey-3',
                  'text-color-text hover:bg-grey-2 transition-colors duration-200 focus-visible-ring',
                  refreshingGroupTags && 'opacity-50 cursor-not-allowed',
                )}
                onClick={() => {
                  void onRefreshGroupTags();
                }}
              >
                {refreshingGroupTags
                  ? 'Refreshing group tags & examples…'
                  : 'Refresh group tags & examples'}
              </button>
            )}
            {showHistorySection && (
              <div className="flex flex-col gap-y-1">
                {displayRows.length === 0 ? (
                  <p className="text-color-text-light text-xs leading-snug m-0 py-1">
                    {emptyHistoryMessage}
                  </p>
                ) : (
                  <table className="w-full table-auto border-collapse text-left text-sm text-color-text">
                    <colgroup>
                      <col className="w-min" />
                      {/* min: short tags fit on one line; max: do not outgrow the query column */}
                      <col className="min-w-[7rem] max-w-[11rem]" />
                      <col className="w-full min-w-0" />
                      <col className="w-min" />
                      <col className="w-min" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-grey-3 text-color-text-light">
                        <th
                          className="py-0.5 pr-2 text-sm font-normal"
                          scope="col"
                        >
                          <span className="sr-only">Color</span>
                        </th>
                        <th
                          className="py-0.5 pr-2 text-sm font-normal"
                          scope="col"
                        >
                          Tag
                        </th>
                        <th
                          className="py-0.5 pr-2 text-sm font-normal"
                          scope="col"
                        >
                          Query
                        </th>
                        <th
                          className="py-0.5 pr-2 text-right text-sm font-normal tabular-nums"
                          scope="col"
                        >
                          <span className="sr-only">
                            Pending, confirmed in this doc, and total across all
                            docs matching annotations for this tag and query
                          </span>
                        </th>
                        <th
                          className="py-0.5 text-center text-sm font-normal"
                          scope="col"
                        >
                          <span className="sr-only">
                            Rerun AI search, delete pending, delete all
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map(row => {
                        const tagKey = row.schemaTag.trim();
                        const rgba = colorForRow(row);
                        const hex = rgbaStringToHexColorInput(rgba);
                        const pendingCount = documentUri
                          ? countTagInventoryRowPendingAnnotations(
                              savedAnnotations,
                              documentUri,
                              row.schemaTag,
                              row.query,
                              uriAliases,
                            )
                          : 0;
                        const totalInThisDocCount = documentUri
                          ? listSavedAnnotationsMatchingTagInventoryRow(
                              savedAnnotations,
                              documentUri,
                              row.schemaTag,
                              row.query,
                              uriAliases,
                            ).length
                          : 0;
                        const confirmedInThisDocCount = Math.max(
                          0,
                          totalInThisDocCount - pendingCount,
                        );
                        const totalAcrossAllDocsFromStore = focusedGroupId
                          ? countAnnotationsForTagInventoryRow(
                              annotationsForInventoryCount,
                              row,
                              {
                                focusedGroupId,
                                documentUri: documentUri,
                                documentUriAliases: uriAliases,
                              },
                            )
                          : 0;
                        const totalAcrossAllDocsCount =
                          deleteAllRemaining?.rowId === row.id
                            ? deleteAllRemaining.remaining
                            : totalAcrossAllDocsFromStore;
                        const rerunDisabled = globalRowLock || !documentUri;
                        const deletePendingDisabled =
                          globalRowLock || !documentUri || pendingCount === 0;
                        const deleteAllDisabled = globalRowLock || !documentUri;
                        return (
                          <tr
                            key={row.id}
                            className={classnames(
                              'border-b border-grey-2 last:border-0',
                              row.hidden && 'opacity-70',
                            )}
                          >
                            <td className="py-0.5 pr-2 align-middle whitespace-nowrap w-min">
                              <div className="flex flex-row items-center gap-1">
                                <button
                                  type="button"
                                  className={classnames(
                                    aiSearchHistoryActionButtonClass,
                                    'shrink-0',
                                  )}
                                  title={
                                    row.hidden
                                      ? 'Render this highlight in the PDF'
                                      : 'Hide this highlight from the PDF'
                                  }
                                  aria-label={
                                    row.hidden
                                      ? 'Render this highlight in the PDF'
                                      : 'Hide this highlight from the PDF'
                                  }
                                  onClick={() =>
                                    store.setTagInventoryRowHidden(
                                      row.id,
                                      !row.hidden,
                                    )
                                  }
                                >
                                  {row.hidden ? (
                                    <ShowIcon className="w-em h-em" />
                                  ) : (
                                    <HideIcon className="w-em h-em" />
                                  )}
                                </button>
                                <input
                                  aria-label={`Highlight color for tag ${tagKey || '(empty)'}`}
                                  className="h-6 w-8 cursor-pointer rounded border border-grey-3 bg-transparent p-0"
                                  disabled={!tagKey}
                                  title={
                                    tagKey
                                      ? undefined
                                      : 'Set a schema tag to customize color'
                                  }
                                  type="color"
                                  value={hex}
                                  onInput={(e: Event) => {
                                    if (!tagKey) {
                                      return;
                                    }
                                    const v = (e.target as HTMLInputElement)
                                      .value;
                                    const nextRgba = hexColorInputToRgba(
                                      v,
                                      TAG_HIGHLIGHT_ALPHA,
                                    );
                                    store.setTagInventorySchemaTagColor(
                                      tagKey,
                                      nextRgba,
                                    );
                                  }}
                                />
                              </div>
                            </td>
                            <td className="py-0.5 pr-2 align-middle break-words text-xs leading-snug">
                              {tagKey ? (
                                <button
                                  type="button"
                                  className={classnames(
                                    'm-0 w-full max-w-full min-w-0 border-0 bg-transparent p-0',
                                    'text-left font-inherit text-xs leading-snug text-color-text',
                                    'cursor-pointer break-words underline underline-offset-2',
                                    'hover:text-color-text',
                                    'rounded focus-visible-ring',
                                  )}
                                  title={`Show annotations with tag: ${tagKey}`}
                                  aria-label={`Filter sidebar to annotations tagged ${tagKey}`}
                                  onClick={() => {
                                    store.setFilterQuery(
                                      formatSidebarTagFilter(tagKey),
                                    );
                                  }}
                                >
                                  {row.schemaTag}
                                </button>
                              ) : (
                                <span className="text-color-text-light">—</span>
                              )}
                            </td>
                            <td className="py-0.5 pr-2 align-middle break-words text-xs leading-snug">
                              {row.query.trim() ? (
                                row.query
                              ) : (
                                <span className="text-color-text-light">
                                  No query - matches this tag across the
                                  document
                                </span>
                              )}
                            </td>
                            <td className="w-min py-0.5 pr-2 text-right align-middle tabular-nums whitespace-nowrap">
                              <span
                                title="Pending AI suggestions for this tag and query in this doc"
                                className="cursor-help tabular-nums"
                                aria-label={`${pendingCount} pending`}
                              >
                                {pendingCount}
                              </span>
                              <span
                                className="text-color-text-light"
                                aria-hidden="true"
                              >
                                {' '}
                                |{' '}
                              </span>
                              <span
                                title="Confirmed (non-pending) matching annotations for this tag and query in this doc"
                                className="cursor-help tabular-nums"
                                aria-label={`${confirmedInThisDocCount} confirmed in this doc`}
                              >
                                {confirmedInThisDocCount}
                              </span>
                              <span
                                className="text-color-text-light"
                                aria-hidden="true"
                              >
                                {' '}
                                |{' '}
                              </span>
                              <span
                                title="Total matching annotations for this tag and query across all docs"
                                className="cursor-help tabular-nums"
                                aria-label={`${totalAcrossAllDocsCount} total across all docs`}
                              >
                                {totalAcrossAllDocsCount}
                              </span>
                            </td>
                            <td className="w-min py-0.5 align-middle whitespace-nowrap">
                              <div className="flex w-min flex-row items-center gap-0.5">
                                <button
                                  type="button"
                                  aria-disabled={rerunDisabled}
                                  tabIndex={rerunDisabled ? -1 : undefined}
                                  className={classnames(
                                    aiSearchHistoryActionButtonClass,
                                    rerunDisabled &&
                                      'opacity-50 cursor-not-allowed',
                                  )}
                                  title={aiSearchRerunButtonHelpText}
                                  aria-label={aiSearchRerunButtonHelpText}
                                  onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (rerunDisabled) {
                                      return;
                                    }
                                    void onRerunRow(row);
                                  }}
                                >
                                  <RedoIcon className="w-em h-em" />
                                </button>
                                <button
                                  type="button"
                                  aria-disabled={deletePendingDisabled}
                                  tabIndex={
                                    deletePendingDisabled ? -1 : undefined
                                  }
                                  className={classnames(
                                    aiSearchHistoryActionButtonClass,
                                    deletePendingDisabled &&
                                      'opacity-50 cursor-not-allowed',
                                  )}
                                  title="Delete pending AI annotations for this tag and query"
                                  aria-label="Delete pending"
                                  onClick={e => {
                                    if (deletePendingDisabled) {
                                      e.preventDefault();
                                      return;
                                    }
                                    onDeletePending(row);
                                  }}
                                >
                                  <CancelIcon className="w-em h-em" />
                                </button>
                                <button
                                  type="button"
                                  aria-disabled={deleteAllDisabled}
                                  tabIndex={deleteAllDisabled ? -1 : undefined}
                                  className={classnames(
                                    aiSearchHistoryActionButtonClass,
                                    deleteAllDisabled &&
                                      'opacity-50 cursor-not-allowed',
                                  )}
                                  title="Delete all matching annotations for this tag and query"
                                  aria-label="Delete all"
                                  onClick={e => {
                                    if (deleteAllDisabled) {
                                      e.preventDefault();
                                      return;
                                    }
                                    onDeleteAll(row);
                                  }}
                                >
                                  <TrashIcon className="w-em h-em" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="text-color-text-light text-xs leading-snug m-0 grow min-w-[12rem]">
                    Highlight color is per tag (rows sharing a tag share the
                    color).
                  </p>
                  <div className="flex shrink-0 items-center gap-x-2">
                    <button
                      type="button"
                      disabled={hiddenRowsToggleDisabled}
                      title={hiddenRowsToggleTitle}
                      aria-label={hiddenRowsToggleTitle}
                      className={classnames(
                        'shrink-0 text-xs rounded px-2 py-1 border border-grey-3',
                        'text-color-text hover:bg-grey-2 transition-colors duration-200 focus-visible-ring',
                        hiddenRowsToggleDisabled &&
                          'opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => {
                        if (hiddenRowsToggleDisabled) {
                          return;
                        }
                        setShowHiddenRows(v => !v);
                      }}
                    >
                      {showHiddenRows
                        ? 'Hide un-rendered rows'
                        : 'Show un-rendered rows'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </SidebarPanel>
  );
}

export default withServices(AISearchPanel, [
  'annotationsService',
  'experimentLog',
  'frameSync',
  'claude',
  'api',
  'nodeLinkState',
  'toastMessenger',
  'tagInventoryGroupSync',
  'persistedTagInventory',
]);
