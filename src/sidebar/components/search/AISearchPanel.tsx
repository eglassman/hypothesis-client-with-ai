import {
  CancelIcon,
  Card,
  CardContent,
  Input,
} from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useRef, useState } from 'preact/hooks';

import {
  hexColorInputToRgba,
  highlightRgbaFromString,
  rgbaStringToHexColorInput,
  TAG_HIGHLIGHT_ALPHA,
} from '../../../shared/tag-color-from-string';
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
import type { AISearchRow } from '../../store/modules/sidebar-panels';
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasSelection = store.hasSelectedAnnotations();
  // const [reductoAPIKey, setReductoAPIKey] = useState('');
  const [claudeAPIKey, setClaudeAPIKey] = useState('');
  const [schemaTag, setSchemaTag] = useState('');
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  const aiRows = store.aiSearchRows();
  const schemaTagColors = store.aiSearchSchemaTagColors();

  const clearSearch = () => {
    store.closeSidebarPanel('aiSearchAnnotations');
  };

  async function onAISearch(query: string) {
    try {
      // Reducto SDK uses PascalCase for this method.
      // eslint-disable-next-line new-cap
      // const reductoResult = await reducto.AISearchDocument({
      //   query,
      //   candidateURIs: store.searchUris(),
      //   apiKey: reductoAPIKey,
      // });
      const claudeResult = await claude.AISearchDocument({
        query,
        candidateURIs: store.searchUris(),
        apiKey: claudeAPIKey,
      });
      console.log('claudeResult', claudeResult);

      const userid = store.profile().userid;
      const groupId = store.focusedGroupId();
      //const documentURL = reducto.firstPDFURI(store.searchUris());
      const documentURL = claude.firstPDFURI(store.searchUris()); // TODO: move this to a shared function

      if (!userid || !groupId || !documentURL) {
        toastMessenger.error('Missing user, group, or PDF URL');
        return;
      }

      // const quotes = ((reductoResult.answer as any).result?.[0]?.quotes ?? []) as
      //   Array<{ text?: string }>;
      const quotes = ((claudeResult.answer as any).result?.[0]?.quotes ?? []) as Array<{ text?: string }>;

      const tagTrim = schemaTag.trim();
      const tags = ['ai-pending', ...(tagTrim ? [tagTrim] : [])];

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

      const row: AISearchRow = {
        id: crypto.randomUUID(),
        schemaTag,
        query,
        annotationIds: created
          .map(a => a.id)
          .filter((id): id is string => typeof id === 'string'),
      };
      store.addAISearchRow(row);

      experimentLog.logSearch({
        query,
        schemaTag,
        searchRowId: row.id,
        annotationIdsCreated: row.annotationIds,
        quoteTexts: created.map(a => annotationQuote(a) ?? ''),
      });

      toastMessenger.success(
        `Created ${created.length} annotation(s) from AI results.`,
      );
    } catch (error) {
      console.error('Error creating annotations from AI results:', error);
      toastMessenger.error('Failed to create annotations from AI results.');
    }
  }

  async function onDeleteRow(row: AISearchRow) {
    setDeletingRowId(row.id);
    experimentLog.logDeleteSearch({
      searchRowId: row.id,
      query: row.query,
      schemaTag: row.schemaTag,
      annotationIds: row.annotationIds,
    });
    try {
      for (const id of row.annotationIds) {
        const ann = store.findAnnotationByID(id);
        if (ann?.id) {
          await annotationsService.delete(ann as SavedAnnotation);
        }
      }
      store.removeAISearchRow(row.id);
    } catch (err) {
      console.error(err);
      toastMessenger.error('Failed to remove one or more annotations.');
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
              placeholder="ask AI to highlight…"
              // Disable the input when there is a selection, as the selection
              // replaces any other filters.
              disabled={hasSelection}
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
                        className="py-1 pr-2 text-right font-normal w-10"
                        scope="col"
                      >
                        #
                      </th>
                      <th className="py-1 w-10" scope="col">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiRows.map(row => {
                      const tagKey = row.schemaTag.trim();
                      const rgba = colorForRow(row);
                      const hex = rgbaStringToHexColorInput(rgba);
                      return (
                        <tr
                          key={row.id}
                          className="border-b border-grey-2 last:border-0"
                        >
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
                            {row.annotationIds.length}
                          </td>
                          <td className="py-1 align-middle">
                            <button
                              type="button"
                              className={classnames(
                                'p-1 rounded text-grey-6 hover:text-color-text hover:bg-grey-2',
                                'transition-colors duration-200 focus-visible-ring',
                              )}
                              disabled={deletingRowId === row.id}
                              title="Remove row and delete matching annotations"
                              onClick={() => onDeleteRow(row)}
                            >
                              <CancelIcon
                                className="w-em h-em"
                                title="Remove"
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
                  color.
                </p>
              </div>
            )}
          </div>
          <FilterControls />
          <button
            type="button"
            className="mt-2 text-xs text-color-text-light hover:text-color-text underline"
            title="Download experiment log as JSON"
            onClick={() => experimentLog.downloadLog()}
          >
            Download experiment log
          </button>
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
