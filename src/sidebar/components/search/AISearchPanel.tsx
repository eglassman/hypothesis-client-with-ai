import {
  CancelIcon,
  Card,
  CardContent,
  confirm,
  Input,
  MenuCollapseIcon,
  MenuExpandIcon,
  RedoIcon,
  TrashIcon,
} from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useRef, useState } from 'preact/hooks';

import {
  hexColorInputToRgba,
  highlightRgbaFromString,
  rgbaStringToHexColorInput,
  TAG_HIGHLIGHT_ALPHA,
} from '../../../shared/tag-color-from-string';
import {
  buildClaudeAISearchUserMessage,
  collectTagQueryQuoteRows,
  countAiSearchQuotesSkippedAsDuplicates,
  countAISearchRowPendingAnnotations,
  countAISearchRowTotalAnnotations,
  deleteAllActionForAISearchRowMatch,
  expectedTagsForStrictAISearchPending,
  filterAiSearchQuotesAgainstExisting,
  listSavedAnnotationsMatchingAISearchRow,
  listStrictAISearchRowPendingAnnotations,
  tagsAfterRemovingAISearchRowSchemaTag,
} from '../../helpers/claude-ai-search-user-message';
import { mergeAISearchTagHighlightPalette } from '../../helpers/ai-search-tag-palette';
import { sharedPermissions } from '../../helpers/permissions';
import { withServices } from '../../service-context';
import { quote as annotationQuote } from '../../helpers/annotation-metadata';
import type { SavedAnnotation } from '../../../types/api';
import type { AnnotationsService } from '../../services/annotations';
import type { APIService } from '../../services/api';
import type { FrameSyncService } from '../../services/frame-sync';
// import type { ReductoService } from '../../services/reducto';
import type { ClaudeService } from '../../services/claude';
import type { ExperimentLogService } from '../../services/experiment-log';
import type { ToastMessengerService } from '../../services/toast-messenger';
import { useSidebarStore } from '../../store';
import type {
  AISearchNegativeExample,
  AISearchRow,
} from '../../store/modules/sidebar-panels';
import SidebarPanel from '../SidebarPanel';
import FilterControls from './FilterControls';
import SearchField from './SearchField';

type AISearchPanelProps = {
  annotationsService: AnnotationsService;
  experimentLog: ExperimentLogService;
  frameSync: FrameSyncService;
  // reducto: ReductoService;
  claude: ClaudeService;
  api: APIService;
  toastMessenger: ToastMessengerService;
};

function AISearchPanel({
  annotationsService,
  experimentLog,
  frameSync,
  // reducto,
  claude,
  api,
  toastMessenger,
}: AISearchPanelProps) {
  const store = useSidebarStore();
  const filterQuery = store.filterQuery();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const hasSelection = store.hasSelectedAnnotations();
  const [aiSearchBusy, setAiSearchBusy] = useState(false);
  // const [reductoAPIKey, setReductoAPIKey] = useState('');
  const [claudeAPIKey, setClaudeAPIKey] = useState('');
  const [schemaTag, setSchemaTag] = useState('');
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [rerunningRowId, setRerunningRowId] = useState<string | null>(null);
  const [userDeniedSectionOpen, setUserDeniedSectionOpen] = useState(false);

  const aiRows = store.aiSearchRows();
  const savedAnnotations = store.savedAnnotations();
  const schemaTagColors = store.aiSearchSchemaTagColors();
  const documentURL = claude.firstPDFURI(store.searchUris());
  const negativeExamplesForDoc: AISearchNegativeExample[] = documentURL
    ? store
        .aiSearchNegativeExamples()
        .filter(ex => ex.documentUri === documentURL)
    : [];

  const clearSearch = () => {
    store.closeSidebarPanel('aiSearchAnnotations');
  };

  async function runAISearch(
    schemaTagForRow: string,
    query: string,
    options?: { replaceRowId?: string },
  ) {
    try {
      const userid = store.profile().userid;
      const groupId = store.focusedGroupId();

      if (!userid || !groupId || !documentURL) {
        toastMessenger.error('Missing user, group, or PDF URL');
        return;
      }

      const tripleRows = await collectTagQueryQuoteRows(
        store.savedAnnotations(),
        documentURL,
        annotationsService,
      );
      const tagTrim = schemaTagForRow.trim();
      const fullUserMessage = buildClaudeAISearchUserMessage({
        rows: tripleRows,
        schemaTag: tagTrim,
        searchQuery: query,
        negativeExamples: negativeExamplesForDoc,
      });

      // eslint-disable-next-line new-cap -- AISearchDocument is a service method, not a constructor
      const claudeResult = await claude.AISearchDocument({
        query: fullUserMessage,
        candidateURIs: store.searchUris(),
        apiKey: claudeAPIKey,
      });
      console.log('claudeResult', claudeResult);

      const rawQuotes = ((claudeResult.answer as any).result?.[0]?.quotes ??
        []) as Array<{ text?: string }>;
      const quotes = filterAiSearchQuotesAgainstExisting(
        rawQuotes,
        store.savedAnnotations(),
        documentURL,
        tagTrim,
      );
      const skippedDuplicate = countAiSearchQuotesSkippedAsDuplicates(
        rawQuotes,
        quotes,
      );

      const tags = expectedTagsForStrictAISearchPending(tagTrim);

      const created = [];
      for (const quote of quotes) {
        if (!quote.text?.trim()) {
          continue;
        }
        const payload = {
          group: groupId,
          uri: documentURL,
          target: [
            {
              source: documentURL,
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

      const newIds = created
        .map(a => a.id)
        .filter((id): id is string => typeof id === 'string');

      const rowId = options?.replaceRowId ?? crypto.randomUUID();
      if (options?.replaceRowId) {
        store.setAISearchRowAnnotationIds(options.replaceRowId, newIds);
      } else {
        const row: AISearchRow = {
          id: rowId,
          schemaTag: schemaTagForRow,
          query,
          annotationIds: newIds,
        };
        store.addAISearchRow(row);
      }

      experimentLog.logSearch({
        query,
        schemaTag: schemaTagForRow,
        searchRowId: rowId,
        documentUri: documentURL,
        annotationIdsCreated: newIds,
        quoteTexts: created.map(a => annotationQuote(a) ?? ''),
      });

      let successMsg = `Created ${created.length} annotation(s) from AI results.`;
      if (skippedDuplicate > 0) {
        successMsg += ` Skipped ${skippedDuplicate} already covered.`;
      }
      toastMessenger.success(successMsg);
    } catch (error) {
      console.error('Error creating annotations from AI results:', error);
      toastMessenger.error('Failed to create annotations from AI results.');
    }
  }

  async function onAISearch(query: string) {
    setAiSearchBusy(true);
    try {
      const tagKey = schemaTag.trim();
      const queryKey = query.trim();
      const matchingRow = aiRows.find(
        r => r.schemaTag.trim() === tagKey && r.query.trim() === queryKey,
      );
      if (matchingRow) {
        await onRerunRow(matchingRow);
      } else {
        await runAISearch(schemaTag, query);
      }
    } finally {
      setAiSearchBusy(false);
    }
  }

  async function onRerunRow(row: AISearchRow) {
    const userid = store.profile().userid;
    const groupId = store.focusedGroupId();
    const documentURL = claude.firstPDFURI(store.searchUris());

    if (!userid || !groupId || !documentURL) {
      toastMessenger.error('Missing user, group, or PDF URL');
      return;
    }

    setRerunningRowId(row.id);
    try {
      store.mergeAISearchRowsWithSameTagQuery(row.id);

      const pending = listStrictAISearchRowPendingAnnotations(
        store.savedAnnotations() as SavedAnnotation[],
        documentURL,
        row.schemaTag,
        row.query,
      );

      const deletedIds: string[] = [];
      for (const ann of pending) {
        if (ann.id) {
          await annotationsService.delete(ann);
          deletedIds.push(ann.id);
        }
      }
      if (deletedIds.length) {
        store.removeAnnotationIdsFromAISearchRows(deletedIds);
      }

      experimentLog.logRerunSearch({
        searchRowId: row.id,
        query: row.query,
        schemaTag: row.schemaTag,
        documentUri: documentURL,
        deletedAnnotationIds: deletedIds,
      });

      await runAISearch(row.schemaTag, row.query, { replaceRowId: row.id });
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to rerun AI search.');
    } finally {
      setRerunningRowId(null);
    }
  }

  async function onDeletePending(row: AISearchRow) {
    if (!documentURL) {
      toastMessenger.error('Missing PDF URL');
      return;
    }

    setDeletingRowId(row.id);
    try {
      const pending = listStrictAISearchRowPendingAnnotations(
        savedAnnotations as SavedAnnotation[],
        documentURL,
        row.schemaTag,
        row.query,
      );
      const deletedIds: string[] = [];
      for (const ann of pending) {
        if (ann.id) {
          await annotationsService.delete(ann as SavedAnnotation);
          deletedIds.push(ann.id);
        }
      }
      if (deletedIds.length) {
        store.removeAnnotationIdsFromAISearchRows(deletedIds);
        toastMessenger.success(
          `Deleted ${deletedIds.length} pending annotation(s).`,
          { visuallyHidden: true },
        );
      }
      experimentLog.logDeletePending({
        searchRowId: row.id,
        query: row.query,
        schemaTag: row.schemaTag,
        documentUri: documentURL,
        deletedAnnotationIds: deletedIds,
      });
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to delete pending annotations.');
    } finally {
      setDeletingRowId(null);
    }
  }

  async function onDeleteAll(row: AISearchRow) {
    if (!documentURL) {
      toastMessenger.error('Missing PDF URL');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete all for this tag and query?',
      message:
        'This removes this row’s schema tag from annotations that still have other tags, or fully deletes annotations that only have this tag (plus ai-pending / ai-user-approved). For rows with no schema tag, matching annotations are deleted entirely. This affects pending, user-approved, and other matching annotations on this document.',
      confirmAction: 'Delete all',
    });
    if (!confirmed) {
      return;
    }

    setDeletingRowId(row.id);
    try {
      const matches = listSavedAnnotationsMatchingAISearchRow(
        savedAnnotations as SavedAnnotation[],
        documentURL,
        row.schemaTag,
        row.query,
      );
      const schemaTrim = row.schemaTag.trim();
      const touchedIds: string[] = [];
      const deletedIds: string[] = [];
      const untaggedIds: string[] = [];

      for (const ann of matches) {
        if (!ann.id) {
          continue;
        }
        const action = deleteAllActionForAISearchRowMatch(ann, schemaTrim);
        if (action === 'removeRowTag') {
          const newTags = tagsAfterRemovingAISearchRowSchemaTag(
            ann.tags,
            schemaTrim,
          );
          let updated = await api.annotation.update({ id: ann.id }, { tags: newTags });
          for (const [key, value] of Object.entries(ann)) {
            if (key.startsWith('$')) {
              updated = { ...updated, [key]: value };
            }
          }
          store.addAnnotations([updated]);
          touchedIds.push(ann.id);
          untaggedIds.push(ann.id);
        } else {
          await annotationsService.delete(ann as SavedAnnotation);
          touchedIds.push(ann.id);
          deletedIds.push(ann.id);
        }
      }

      if (touchedIds.length) {
        store.removeAnnotationIdsFromAISearchRows(touchedIds);
      }
      store.removeAISearchRow(row.id);

      experimentLog.logDeleteAll({
        searchRowId: row.id,
        query: row.query,
        schemaTag: row.schemaTag,
        documentUri: documentURL,
        deletedAnnotationIds: deletedIds,
        untaggedAnnotationIds: untaggedIds,
      });

      toastMessenger.success('AI search row removed.', { visuallyHidden: true });
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to complete delete all.');
    } finally {
      setDeletingRowId(null);
    }
  }

  function colorForRow(row: AISearchRow): string {
    const tag = row.schemaTag.trim();
    if (!tag) {
      return highlightRgbaFromString('');
    }
    return (
      schemaTagColors[tag] ?? highlightRgbaFromString(tag)
    );
  }

  return (
    <SidebarPanel
      panelName="aiSearchAnnotations"
      label="AI search panel"
      initialFocus={inputRef}
      onActiveChanged={active => {
        if (!active) {
          store.setFilterQuery(null);
        } else {
          frameSync.setTagHighlightPalette(
            mergeAISearchTagHighlightPalette(store.aiSearchSchemaTagColors()),
          );
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
              onInput={(e: Event) =>
                setClaudeAPIKey((e.target as HTMLInputElement).value)
              }
            />
            <Input
              aria-label="schema tag"
              classes="text-base touch:text-touch-base"
              data-testid="schema-tag-input"
              dir="auto"
              name="schema-tag"
              placeholder="Tag"
              type="text"
              value={schemaTag}
              onInput={(e: Event) =>
                setSchemaTag((e.target as HTMLInputElement).value)
              }
            />
            <SearchField
              inputRef={inputRef}
              classes="grow"
              fullWidthSubmitLabel="Ask the AI"
              multiline
              placeholder="ask AI to highlight…"
              rows={4}
              // Disable the input when there is a selection, as the selection
              // replaces any other filters.
              disabled={hasSelection || aiSearchBusy}
              query={filterQuery || null}
              onClearSearch={clearSearch}
              onSearch={onAISearch}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  clearSearch();
                }
              }}
            />
            {aiRows.length > 0 && (
              <div className="flex flex-col gap-y-1">
                <table className="w-full border-collapse text-left text-sm text-color-text">
                  <thead>
                    <tr className="border-b border-grey-3 text-color-text-light">
                      <th className="py-1 w-10" scope="col">
                        <span className="sr-only">Rerun</span>
                      </th>
                      <th className="py-1 pr-2 font-normal" scope="col">
                        Color
                      </th>
                      <th className="py-1 pr-2 font-normal" scope="col">
                        Tag
                      </th>
                      <th className="py-1 pr-2 font-normal" scope="col">
                        Query
                      </th>
                      <th
                        className="py-1 pr-2 text-right font-normal tabular-nums"
                        scope="col"
                        title="AI-generated pending annotations"
                      >
                        Pending
                      </th>
                      <th
                        className="py-1 pr-2 text-right font-normal tabular-nums"
                        scope="col"
                        title="All annotations matching this tag and query"
                      >
                        Total
                      </th>
                      <th className="py-1 w-10" scope="col">
                        <span className="sr-only">Delete pending</span>
                      </th>
                      <th className="py-1 w-10" scope="col">
                        <span className="sr-only">Delete all</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiRows.map(row => {
                      const tagKey = row.schemaTag.trim();
                      const rgba = colorForRow(row);
                      const hex = rgbaStringToHexColorInput(rgba);
                      const pendingCount = documentURL
                        ? countAISearchRowPendingAnnotations(
                            savedAnnotations,
                            documentURL,
                            row.schemaTag,
                            row.query,
                          )
                        : 0;
                      const totalCount = documentURL
                        ? countAISearchRowTotalAnnotations(
                            savedAnnotations,
                            documentURL,
                            row.schemaTag,
                            row.query,
                          )
                        : 0;
                      return (
                        <tr
                          key={row.id}
                          className="border-b border-grey-2 last:border-0"
                        >
                          <td className="py-1 pr-2 align-middle">
                            <button
                              type="button"
                              className={classnames(
                                'p-1 rounded text-grey-6 hover:text-color-text hover:bg-grey-2',
                                'transition-colors duration-200 focus-visible-ring',
                              )}
                              disabled={
                                aiSearchBusy ||
                                deletingRowId === row.id ||
                                rerunningRowId === row.id
                              }
                              title="Rerun search"
                              aria-label="Rerun search"
                              onClick={() => onRerunRow(row)}
                            >
                              <RedoIcon
                                className="w-em h-em"
                                title="Rerun search"
                              />
                            </button>
                          </td>
                          <td className="py-1 pr-2 align-middle">
                            <input
                              aria-label={`Highlight color for tag ${tagKey || '(empty)'}`}
                              className="h-8 w-10 cursor-pointer rounded border border-grey-3 bg-transparent p-0"
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
                                const v = (e.target as HTMLInputElement).value;
                                store.setAISearchSchemaTagColor(
                                  tagKey,
                                  hexColorInputToRgba(v, TAG_HIGHLIGHT_ALPHA),
                                );
                              }}
                            />
                          </td>
                          <td className="py-1 pr-2 align-middle break-all">
                            {row.schemaTag || (
                              <span className="text-color-text-light">—</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 align-middle break-all">
                            {row.query}
                          </td>
                          <td className="py-1 pr-2 text-right align-middle tabular-nums">
                            {documentURL
                              ? countAISearchRowPendingAnnotations(
                                  savedAnnotations,
                                  documentURL,
                                  row.schemaTag,
                                  row.query,
                                )
                              : 0}
                          </td>
                          <td className="py-1 pr-2 text-right align-middle tabular-nums">
                            {documentURL
                              ? countAISearchRowTotalAnnotations(
                                  savedAnnotations,
                                  documentURL,
                                  row.schemaTag,
                                  row.query,
                                )
                              : 0}
                          </td>
                          <td className="py-1 align-middle">
                            <button
                              type="button"
                              className={classnames(
                                'p-1 rounded text-grey-6 hover:text-color-text hover:bg-grey-2',
                                'transition-colors duration-200 focus-visible-ring',
                              )}
                              disabled={
                                aiSearchBusy ||
                                deletingRowId === row.id ||
                                rerunningRowId === row.id ||
                                !documentURL ||
                                pendingCount === 0
                              }
                              title="Delete pending AI annotations for this tag and query"
                              aria-label="Delete pending"
                              onClick={() => onDeletePending(row)}
                            >
                              <CancelIcon
                                className="w-em h-em"
                                title="Delete pending"
                              />
                            </button>
                          </td>
                          <td className="py-1 align-middle">
                            <button
                              type="button"
                              className={classnames(
                                'p-1 rounded text-grey-6 hover:text-color-text hover:bg-grey-2',
                                'transition-colors duration-200 focus-visible-ring',
                              )}
                              disabled={
                                aiSearchBusy ||
                                deletingRowId === row.id ||
                                rerunningRowId === row.id ||
                                !documentURL ||
                                totalCount === 0
                              }
                              title="Delete all matching annotations for this tag and query"
                              aria-label="Delete all"
                              onClick={() => onDeleteAll(row)}
                            >
                              <TrashIcon
                                className="w-em h-em"
                                title="Delete all"
                              />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-color-text-light text-xs leading-snug">
                  Highlight color is per tag; rows that share a tag share this
                  color. Pending counts strict ai-pending annotations for this tag
                  and query; Total includes approved, pending, and manual
                  annotations with the same tag and query on this document. Delete
                  all removes this row’s tag or deletes annotations when it is the
                  only content tag (see confirmation).
                </p>
              </div>
            )}
            {negativeExamplesForDoc.length > 0 && (
              <div className="flex flex-col border border-grey-3 rounded-md overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 py-2 px-2 text-left text-color-text hover:bg-grey-2 transition-colors duration-200 focus-visible-ring"
                  onClick={() => setUserDeniedSectionOpen(v => !v)}
                  aria-expanded={userDeniedSectionOpen}
                >
                  <span className="font-medium text-xs">
                    User-denied AI annotations
                  </span>
                  {userDeniedSectionOpen ? (
                    <MenuCollapseIcon className="w-em h-em shrink-0" />
                  ) : (
                    <MenuExpandIcon className="w-em h-em shrink-0" />
                  )}
                </button>
                {userDeniedSectionOpen && (
                  <div className="px-2 pb-2">
                    <table className="w-full border-collapse text-left text-xs text-color-text">
                      <thead>
                        <tr className="border-b border-grey-3 text-color-text-light">
                          <th className="py-1 pr-2 font-normal" scope="col">
                            Tag
                          </th>
                          <th className="py-1 pr-2 font-normal" scope="col">
                            Query
                          </th>
                          <th className="py-1 pr-2 font-normal" scope="col">
                            Quote
                          </th>
                          <th className="py-1 w-10" scope="col">
                            <span className="sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {negativeExamplesForDoc.map(ex => (
                          <tr
                            key={ex.id}
                            className="border-b border-grey-2 last:border-0"
                          >
                            <td className="py-1 pr-2 align-middle break-all max-w-[8rem]">
                              {ex.schemaTag || (
                                <span className="text-color-text-light">—</span>
                              )}
                            </td>
                            <td className="py-1 pr-2 align-middle break-all max-w-[10rem]">
                              {ex.query}
                            </td>
                            <td className="py-1 pr-2 align-middle break-all max-w-[12rem]">
                              {ex.quote}
                            </td>
                            <td className="py-1 align-middle">
                              <button
                                type="button"
                                className={classnames(
                                  'p-1 rounded text-grey-6 hover:text-color-text hover:bg-grey-2',
                                  'transition-colors duration-200 focus-visible-ring',
                                )}
                                title="Remove stored negative example"
                                aria-label="Remove stored negative example"
                                onClick={() =>
                                  store.removeAISearchNegativeExample(ex.id)
                                }
                              >
                                <CancelIcon
                                  className="w-em h-em"
                                  title="Remove"
                                />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
          <FilterControls />
          <div className="mt-2 flex gap-x-3">
            <button
              type="button"
              className="text-xs text-color-text-light hover:text-color-text underline"
              title="Download experiment log as JSON"
              onClick={() => experimentLog.downloadLog()}
            >
              Download experiment log
            </button>
            <button
              type="button"
              className="text-xs text-color-text-light hover:text-color-text underline"
              title="Clear experiment log"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Clear experiment log?',
                  message:
                    'This will permanently delete the experiment log. This cannot be undone.',
                  confirmAction: 'Clear log',
                });
                if (ok) {
                  experimentLog.clearLog();
                }
              }}
            >
              Clear log
            </button>
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
  // 'reducto',
  'claude',
  'api',
  'toastMessenger',
]);
