import { Card, CardContent, Input } from '@hypothesis/frontend-shared';
import { useRef, useState } from 'preact/hooks';

import { useSidebarStore } from '../../store';
import SidebarPanel from '../SidebarPanel';
import FilterControls from './FilterControls';
import SearchField from './SearchField';

import { withServices } from '../../service-context';
import type { ClaudeService } from '../../services/claude';
import type { APIService } from '../../services/api';
import type { ToastMessengerService } from '../../services/toast-messenger';
import { sharedPermissions } from '../../helpers/permissions';

/* export type StreamViewProps = {
    // injected
    api: APIService;
    toastMessenger: ToastMessengerService;
}; */

type AISearchPanelProps = {
    // injected
    claude: ClaudeService;
    api: APIService;
    toastMessenger: ToastMessengerService;
};

function AISearchPanel({ claude, api, toastMessenger }: AISearchPanelProps) {
  const store = useSidebarStore();
  const filterQuery = store.filterQuery();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasSelection = store.hasSelectedAnnotations();
  const [claudeAPIKey, setClaudeAPIKey] = useState('');

  const clearSearch = () => {
    store.closeSidebarPanel('aiSearchAnnotations');
  };

  async function onAISearch(query: string) {
    try {
    const claudeResult = await claude.AISearchDocument({
        query,
        candidateURIs: store.searchUris(),
        apiKey: claudeAPIKey,
    });
    console.log('claudeResult', claudeResult);

    const userid = store.profile().userid;
    const groupId = store.focusedGroupId();
    const documentURL = claude.firstPDFURI(store.searchUris());

    console.log('userid, groupId, documentURL', userid, groupId, documentURL);

    if (!userid || !groupId || !documentURL) {
        toastMessenger.error('Missing user, group, or PDF URL');
        return;
    }

    const quotes = ((claudeResult.answer as any).result?.[0]?.quotes ?? []) as
      Array<{ text?: string }>;
    console.log('quotes', quotes);

    const created = [];
    for (const quote of quotes) {
      if (!quote.text?.trim()) {
        continue;
      }
      console.log('quote.text', quote.text);
      const payload = {
        group: groupId,
        uri: documentURL,
        target: [{ source: documentURL, selector: [{ type: 'TextQuoteSelector' as const, exact: quote.text }] }],
        text: query,
        tags: ['ai',],
        permissions: sharedPermissions(userid, groupId),
      };
      const ann = await api.annotation.create({}, payload);
      created.push(ann);
      console.log('created', created);
    }
    if (created.length) {
      store.addAnnotations(created);
    }
    toastMessenger.success(`Created ${created.length} annotation(s) from AI results.`);
    } catch (error) {
      console.error('Error creating annotations from AI results:', error);
      toastMessenger.error('Failed to create annotations from AI results.');
    }
  }

  return (
    <SidebarPanel
      panelName="aiSearchAnnotations"
      label="AI search panel"
      initialFocus={inputRef}
      onActiveChanged={active => {
        if (!active) {
          store.setFilterQuery(null);
        }
      }}
    >
      <Card>
        <CardContent>
          <div className="flex flex-col gap-y-3">
            <SearchField
              inputRef={inputRef}
              classes="grow"
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
            <Input
              aria-label="Claude API key"
              classes="text-base touch:text-touch-base"
              data-testid="claude-api-key-input"
              dir="auto"
              name="claude-api-key"
              placeholder="ANTHROPIC_API_KEY"
              type="password"
              value={claudeAPIKey}
              onInput={(e: Event) =>
                setClaudeAPIKey((e.target as HTMLInputElement).value)
              }
            />
          </div>
          <FilterControls />
        </CardContent>
      </Card>
    </SidebarPanel>
  );
}

export default withServices(AISearchPanel, ['claude', 'api', 'toastMessenger']);
