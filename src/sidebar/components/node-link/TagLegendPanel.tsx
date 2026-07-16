import { Button, Card, CloseButton } from '@hypothesis/frontend-shared';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import { colorForTag } from '../../node-link/graph-model';
import {
  emptyNodeLinkState,
  relationshipsForTag,
  tagsForNodeLinkState,
} from '../../node-link/graph-state';
import type {
  ManualTagEdge,
  NodeLinkSemanticState,
} from '../../node-link/graph-state';
import { withServices } from '../../service-context';
import type { NodeLinkStateService } from '../../services/node-link-state';
import { useSidebarStore } from '../../store';
import { SearchableCombobox } from '../SearchableCombobox';
import SidebarPanel from '../SidebarPanel';

type LoadStatus =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'missing'
  | 'invalid'
  | 'error';

export type TagLegendPanelProps = {
  nodeLinkState: NodeLinkStateService;
};

function TagBadge({
  tag,
  tagColors,
}: {
  tag: string;
  tagColors: Record<string, string>;
}) {
  return (
    <span
      className="max-w-full truncate rounded-full px-2.5 py-0.5 font-bold text-white"
      style={{ backgroundColor: colorForTag(tag, tagColors) }}
      title={tag}
    >
      {tag}
    </span>
  );
}

function RelationshipRow({
  edge,
  tagColors,
}: {
  edge: ManualTagEdge;
  tagColors: Record<string, string>;
}) {
  return (
    <li className="flex flex-wrap items-center justify-center gap-2 py-1.5 text-sm leading-6">
      <TagBadge tag={edge.sourceTag} tagColors={tagColors} />
      <strong className="min-w-0 shrink-0 px-0.5 text-color-text">
        {edge.connectionType}
      </strong>
      <TagBadge tag={edge.targetTag} tagColors={tagColors} />
    </li>
  );
}

function RelationshipSection({
  title,
  edges,
  emptyMessage,
  tagColors,
}: {
  title: string;
  edges: ManualTagEdge[];
  emptyMessage: string;
  tagColors: Record<string, string>;
}) {
  return (
    <section className="border-t border-grey-3 pt-4">
      <div className="mb-2 flex items-center justify-between gap-x-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-grey-6">
          {title}
        </h3>
        <span className="rounded-full bg-grey-2 px-2 py-0.5 text-xs font-medium text-grey-6">
          {edges.length}
        </span>
      </div>
      {edges.length ? (
        <ul>
          {edges.map(edge => (
            <RelationshipRow
              key={edge.id || `${edge.sourceTag}\n${edge.targetTag}`}
              edge={edge}
              tagColors={tagColors}
            />
          ))}
        </ul>
      ) : (
        <p className="py-1 text-sm leading-6 text-grey-6">{emptyMessage}</p>
      )}
    </section>
  );
}

function TagLegendPanel({ nodeLinkState }: TagLegendPanelProps) {
  const store = useSidebarStore();
  const isOpen = store.isSidebarPanelOpen('tagLegend');
  const isLoggedIn = store.isLoggedIn();
  const hasFetchedProfile = store.hasFetchedProfile();
  const groupId = store.focusedGroupId();
  const focusedGroup = store.focusedGroup();
  const annotations = store.savedAnnotations();
  const tagColors = store.tagInventorySchemaTagColors();

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [message, setMessage] = useState('');
  const [state, setState] =
    useState<NodeLinkSemanticState>(emptyNodeLinkState());
  const [selectedTag, setSelectedTag] = useState('');

  const loadStateForGroup = useCallback(
    (currentGroupId: string, isCanceled: () => boolean = () => false) => {
      setStatus('loading');
      setMessage('');
      nodeLinkState
        .loadState(currentGroupId)
        .then(result => {
          if (isCanceled()) {
            return;
          }
          setState(result.state);
          setStatus(result.status);
          setMessage(result.message || '');
        })
        .catch(err => {
          if (isCanceled()) {
            return;
          }
          setStatus('error');
          setMessage(err instanceof Error ? err.message : String(err));
          setState(emptyNodeLinkState({ selectedGroupId: currentGroupId }));
        });
    },
    [nodeLinkState],
  );

  useEffect(() => {
    let canceled = false;

    if (!isOpen || !groupId || !isLoggedIn) {
      return undefined;
    }

    loadStateForGroup(groupId, () => canceled);

    return () => {
      canceled = true;
    };
  }, [groupId, isLoggedIn, isOpen, loadStateForGroup]);

  const tags = useMemo(
    () => tagsForNodeLinkState(state, annotations, groupId),
    [annotations, groupId, state],
  );

  useEffect(() => {
    if (!tags.length) {
      setSelectedTag('');
      return;
    }
    if (!selectedTag || !tags.includes(selectedTag)) {
      setSelectedTag(tags[0]);
    }
  }, [selectedTag, tags]);

  const relationships = useMemo(
    () => relationshipsForTag(state, selectedTag),
    [selectedTag, state],
  );

  const reload = () => {
    if (!groupId) {
      return;
    }
    loadStateForGroup(groupId);
  };

  let content;
  if (!hasFetchedProfile) {
    content = <p className="text-sm text-grey-6">Checking session...</p>;
  } else if (!isLoggedIn) {
    content = (
      <p className="text-sm text-grey-6">
        Log in to load tag relationships for this group.
      </p>
    );
  } else if (!groupId) {
    content = <p className="text-sm text-grey-6">Choose a group first.</p>;
  } else if (status === 'loading') {
    content = (
      <p className="text-sm text-grey-6">Loading tag relationships...</p>
    );
  } else if (status === 'invalid' || status === 'error') {
    content = (
      <div className="space-y-3">
        <p className="text-sm text-grey-6">
          Unable to load tag relationships{message ? `: ${message}` : '.'}
        </p>
        <Button onClick={reload}>Retry</Button>
      </div>
    );
  } else if (!tags.length || status === 'missing') {
    content = (
      <div className="space-y-3">
        <p className="text-sm text-grey-6">
          No tag relationships have been saved for this group yet.
        </p>
        <Button onClick={reload}>Refresh</Button>
      </div>
    );
  } else {
    content = (
      <div className="space-y-4">
        <label
          className="block text-sm font-medium text-color-text"
          htmlFor="tag-reference-selector"
        >
          <span className="mb-1 block">Tag</span>
          <SearchableCombobox
            id="tag-reference-selector"
            ariaLabel="Tag"
            options={tags}
            value={selectedTag}
            onChange={setSelectedTag}
            placeholder="Find a tag"
          />
        </label>
        <RelationshipSection
          title="Outgoing"
          edges={relationships.outgoing}
          emptyMessage="No manual relationships start from this tag."
          tagColors={tagColors}
        />
        <RelationshipSection
          title="Incoming"
          edges={relationships.incoming}
          emptyMessage="No manual relationships point to this tag."
          tagColors={tagColors}
        />
        <div className="flex justify-end">
          <Button onClick={reload}>Refresh</Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarPanel label="Tag reference panel" panelName="tagLegend">
      <div className="flex items-center justify-between gap-x-2 rounded-t-lg border-b border-grey-3 bg-white px-4 py-3">
        <div className="text-sm font-bold text-color-text">Tag Reference</div>
        <CloseButton
          classes="text-[16px] text-grey-6 hover:text-grey-7 hover:bg-grey-3/50"
          title="Close tag reference"
          variant="custom"
          size="sm"
        />
      </div>
      <Card classes="rounded-t-none">
        <div className="space-y-4 px-4 py-4">
          <div className="space-y-1 text-center">
            <h2 className="text-md font-bold text-color-text">
              {focusedGroup?.name || 'Tag relationships'}
            </h2>
            <p className="mx-auto max-w-[28rem] text-sm leading-6 text-grey-6">
              Manual tag-tag relationships synced through Hypothesis.
            </p>
          </div>
          {content}
        </div>
      </Card>
    </SidebarPanel>
  );
}

export default withServices(TagLegendPanel, ['nodeLinkState']);
