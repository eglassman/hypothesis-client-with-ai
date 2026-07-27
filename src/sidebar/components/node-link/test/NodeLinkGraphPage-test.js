import { mount, waitFor } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { emptyNodeLinkState } from '../../../node-link/graph-state';
import {
  $imports,
  ManualEdgeViewport,
  NodeLinkEditor,
  NodeLinkGraphPage,
  routeGroupToApply,
} from '../NodeLinkGraphPage';

function tagNode(tag) {
  return {
    id: `tag:${tag}`,
    tag,
    quoteCount: 1,
    documentCount: 1,
    documentUris: ['https://example.com/doc'],
    descriptive: false,
  };
}

describe('NodeLinkEditor', () => {
  const tagColors = {};

  function createComponent({ semanticState, onSaveState = sinon.stub() } = {}) {
    const state =
      semanticState ||
      emptyNodeLinkState({
        tagEdges: [
          {
            id: 'edge-character-action',
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'explains',
          },
        ],
      });
    const graph = {
      tags: [tagNode('Character'), tagNode('Action')],
      quotes: [],
      documents: [],
      manualEdges: state.tagEdges,
      annotationCount: 0,
    };

    return {
      onSaveState,
      wrapper: mount(
        <NodeLinkEditor
          graph={graph}
          selectedTag=""
          semanticState={state}
          tagColors={tagColors}
          onSaveState={onSaveState}
          saveStatus="idle"
          saveMessage=""
        />,
      ),
    };
  }

  function buttonByText(wrapper, text) {
    return wrapper
      .find('button')
      .filterWhere(button => button.text() === text)
      .first();
  }

  it('opens edge edits in a modal instead of reusing the add form', () => {
    const { wrapper } = createComponent();

    buttonByText(wrapper, 'Edit').props().onClick();
    wrapper.update();

    assert.isTrue(wrapper.find('[role="dialog"]').exists());
    assert.include(wrapper.find('[role="dialog"]').text(), 'Edit edge');
    assert.include(wrapper.text(), 'Add Edge');
    assert.notInclude(wrapper.text(), 'Update Edge');
  });

  it('requires confirmation before deleting an edge', () => {
    const { wrapper, onSaveState } = createComponent();

    buttonByText(wrapper, 'Delete').props().onClick();
    wrapper.update();

    assert.include(wrapper.text(), 'Confirm delete?');
    assert.notCalled(onSaveState);

    buttonByText(wrapper, 'No').props().onClick();
    wrapper.update();

    assert.notInclude(wrapper.text(), 'Confirm delete?');

    buttonByText(wrapper, 'Delete').props().onClick();
    wrapper.update();
    buttonByText(wrapper, 'Yes').props().onClick();

    assert.calledOnce(onSaveState);
    assert.lengthOf(onSaveState.firstCall.args[0].tagEdges, 0);
  });

  it('uses searchable tag comboboxes when adding and editing edges', () => {
    const { wrapper } = createComponent();

    assert.lengthOf(wrapper.find('TagCombobox'), 2);

    buttonByText(wrapper, 'Edit').props().onClick();
    wrapper.update();

    assert.lengthOf(wrapper.find('[role="dialog"] TagCombobox'), 2);
  });

  it('suggests relationship types and filters the manual edge list', () => {
    const semanticState = emptyNodeLinkState({
      tagEdges: [
        {
          id: 'edge-character-action',
          sourceTag: 'Character',
          targetTag: 'Action',
          connectionType: 'explains',
        },
        {
          id: 'edge-action-character',
          sourceTag: 'Action',
          targetTag: 'Character',
          connectionType: 'supports',
        },
      ],
    });
    const { wrapper } = createComponent({ semanticState });
    const relationshipInput = wrapper
      .find('SearchableCombobox')
      .filterWhere(input => input.prop('id') === 'new-edge-relationship');
    const edgeFilter = wrapper
      .find('SearchableCombobox')
      .filterWhere(input => input.prop('id') === 'manual-edge-filter');

    assert.deepEqual(relationshipInput.prop('options'), [
      'explains',
      'supports',
    ]);

    edgeFilter.props().onChange('supports');
    wrapper.update();

    assert.include(
      wrapper.find('[data-testid="manual-edge-list"]').text(),
      'supports',
    );
    assert.notInclude(
      wrapper.find('[data-testid="manual-edge-list"]').text(),
      'explains',
    );
    assert.include(wrapper.text(), '1/2');
  });
});

describe('ManualEdgeViewport', () => {
  function createComponent({ selectedTag = '' } = {}) {
    const graph = {
      tags: ['Action', 'Character', 'Theme', 'Setting'].map(tagNode),
      quotes: [],
      documents: [],
      manualEdges: [
        {
          id: 'setting-character',
          sourceTag: 'Setting',
          targetTag: 'Character',
          connectionType: 'contains',
        },
        {
          id: 'action-theme',
          sourceTag: 'Action',
          targetTag: 'Theme',
          connectionType: 'shapes',
        },
      ],
      annotationCount: 0,
    };
    return mount(
      <ManualEdgeViewport
        graph={graph}
        spotlightTag=""
        selectedTag={selectedTag}
        selectedEdgeId=""
        tagColors={{}}
        onSelectEdge={sinon.stub()}
      />,
    );
  }

  function listedEdgeIds(wrapper) {
    return wrapper
      .find('[data-testid="manual-edge-viewport-list"] li')
      .map(item => item.prop('data-edge-id'));
  }

  it('puts relationships connected to the selected tag first', () => {
    const wrapper = createComponent({ selectedTag: 'Character' });

    assert.deepEqual(listedEdgeIds(wrapper), [
      'setting-character',
      'action-theme',
    ]);
    assert.include(
      wrapper.find('li[data-edge-id="action-theme"] button').prop('className'),
      'opacity-50',
    );
  });

  it('filters and sorts manual relationships in the large viewport', () => {
    const wrapper = createComponent();
    const filter = wrapper
      .find('SearchableCombobox')
      .filterWhere(input => input.prop('id') === 'manual-edge-viewport-filter');

    filter.props().onChange('shapes');
    wrapper.update();
    assert.deepEqual(listedEdgeIds(wrapper), ['action-theme']);

    filter.props().onChange('');
    wrapper
      .find('select[aria-label="Sort manual relationships"]')
      .props()
      .onChange({ target: { value: 'target' } });
    wrapper.update();

    assert.deepEqual(listedEdgeIds(wrapper), [
      'setting-character',
      'action-theme',
    ]);
  });
});

describe('routeGroupToApply', () => {
  it('does not reapply a route group that already initialized the selection', () => {
    assert.equal(routeGroupToApply('__world__', '__world__'), '');
  });

  it('applies a route group when the URL changes to a new group', () => {
    assert.equal(
      routeGroupToApply('private-group', '__world__'),
      'private-group',
    );
  });
});

describe('NodeLinkGraphPage', () => {
  let fakeStore;
  let fakeClaude;
  let fakeNodeLinkState;

  function evidenceAnnotation({ id, uri, exact, tags = ['Shared Tag'] }) {
    return {
      id,
      group: 'private-group',
      uri,
      tags,
      target: [
        {
          source: uri,
          selector: [{ type: 'TextQuoteSelector', exact }],
        },
      ],
    };
  }

  function createComponent() {
    return mount(
      <NodeLinkGraphPage
        auth={{ login: sinon.stub().resolves() }}
        claude={fakeClaude}
        nodeLinkState={fakeNodeLinkState}
        session={{ reload: sinon.stub().resolves() }}
        toastMessenger={{ error: sinon.stub() }}
      />,
    );
  }

  beforeEach(() => {
    fakeClaude = {
      apiKey: sinon.stub().returns('test-key'),
      setApiKey: sinon.stub(),
      summarizeTag: sinon.stub().resolves({
        summary: 'First summary line.\nSecond summary line.',
        model: 'claude-test',
      }),
    };
    fakeStore = {
      allGroups: sinon.stub().returns([
        {
          id: '__world__',
          name: 'Public',
          organization: { name: 'Hypothesis' },
        },
        { id: 'private-group', name: 'Private Group' },
      ]),
      focusedGroupId: sinon.stub().returns('__world__'),
      hasFetchedProfile: sinon.stub().returns(true),
      isLoggedIn: sinon.stub().returns(true),
      mainFrame: sinon.stub().returns(null),
      routeParams: sinon.stub().returns({
        group: '__world__',
        uri: 'https://example.com/doc',
      }),
      searchUris: sinon.stub().returns([]),
      tagInventorySchemaTagColors: sinon.stub().returns({}),
    };
    fakeNodeLinkState = {
      fetchGroupAnnotations: sinon.stub().resolves([]),
      loadState: sinon.stub().callsFake(groupId =>
        Promise.resolve({
          status: 'missing',
          state: emptyNodeLinkState({ selectedGroupId: groupId }),
          annotationId: null,
          stateUri: `https://hypothesis-node-link.local/state/group/${groupId}`,
        }),
      ),
      saveState: sinon.stub().callsFake((_groupId, state) =>
        Promise.resolve({
          status: 'saved',
          state,
        }),
      ),
    };

    $imports.$mock({
      '../../store': { useSidebarStore: () => fakeStore },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  it('keeps a group selected directly in node-link when the launch URL has a group', async () => {
    const wrapper = createComponent();

    await waitFor(() =>
      fakeNodeLinkState.fetchGroupAnnotations.calledWith('__world__'),
    );

    wrapper
      .find('select')
      .first()
      .props()
      .onChange({ target: { value: 'private-group' } });
    await waitFor(() =>
      fakeNodeLinkState.fetchGroupAnnotations.calledWith('private-group'),
    );
    wrapper.update();

    assert.equal(wrapper.find('select').first().prop('value'), 'private-group');
    assert.calledWith(fakeNodeLinkState.fetchGroupAnnotations, 'private-group');
  });

  it('loads the selected group graph across documents instead of the launch document only', async () => {
    fakeStore.focusedGroupId.returns('private-group');
    fakeStore.routeParams.returns({
      group: 'private-group',
      uri: 'https://example.com/launch-doc',
    });
    fakeNodeLinkState.fetchGroupAnnotations.resolves([
      evidenceAnnotation({
        id: 'ann-doc-a',
        uri: 'https://example.com/doc-a',
        exact: 'Evidence from document A',
      }),
      evidenceAnnotation({
        id: 'ann-doc-b',
        uri: 'https://example.com/doc-b',
        exact: 'Evidence from document B',
      }),
    ]);

    const wrapper = createComponent();

    await waitFor(() => {
      wrapper.update();
      return wrapper.text().includes('1 tags, 2 documents');
    });

    assert.lengthOf(fakeNodeLinkState.fetchGroupAnnotations.firstCall.args, 2);
    assert.calledWith(fakeNodeLinkState.fetchGroupAnnotations, 'private-group');
  });

  it('keeps graph editing in place when a tag is selected', async () => {
    fakeNodeLinkState.fetchGroupAnnotations.resolves([
      evidenceAnnotation({
        id: 'ann-character',
        uri: 'https://example.com/doc',
        exact: 'Character evidence',
        tags: ['Character'],
      }),
    ]);
    const wrapper = createComponent();

    await waitFor(() => {
      wrapper.update();
      return wrapper.find('g[role="button"]').length > 0;
    });

    const nodeFinder = wrapper
      .find('SearchableCombobox')
      .filterWhere(input => input.prop('id') === 'node-link-spotlight');
    assert.deepEqual(nodeFinder.prop('options'), ['Character']);

    wrapper.find('#node-link-editor-tab').props().onClick();
    wrapper.update();

    const relationshipInput = wrapper.find('input[placeholder="relationship"]');
    relationshipInput.props().onInput({
      currentTarget: { value: 'supports' },
      target: { value: 'supports' },
    });
    wrapper.update();

    const detailsPanel = wrapper.find('#node-link-details-panel').getDOMNode();
    detailsPanel.scrollTo = sinon.stub();
    const preventDefault = sinon.stub();

    wrapper.find('g[role="button"]').first().props().onKeyDown({
      key: 'Enter',
      preventDefault,
    });

    await waitFor(() => {
      wrapper.update();
      return wrapper
        .find('[data-testid="node-link-selection-summary"]')
        .text()
        .includes('Character');
    });

    assert.calledOnce(preventDefault);
    assert.isTrue(wrapper.find('#node-link-editor-tab').prop('aria-selected'));
    assert.isTrue(wrapper.find('#node-link-details-panel').prop('hidden'));
    assert.notCalled(detailsPanel.scrollTo);
    assert.equal(
      wrapper.find('input[placeholder="relationship"]').prop('value'),
      'supports',
    );

    wrapper
      .find('button')
      .filterWhere(button => button.text() === 'View details')
      .first()
      .props()
      .onClick();

    await waitFor(() => detailsPanel.scrollTo.called);
    wrapper.update();

    assert.isTrue(wrapper.find('#node-link-details-tab').prop('aria-selected'));
    assert.isFalse(wrapper.find('#node-link-details-panel').prop('hidden'));
    assert.include(
      wrapper.find('#node-link-details-panel').text(),
      'Character',
    );
    assert.calledWith(detailsPanel.scrollTo, { top: 0 });
  });

  it('isolates and centers a selected tag neighborhood', async () => {
    fakeNodeLinkState.fetchGroupAnnotations.resolves([
      evidenceAnnotation({
        id: 'ann-character',
        uri: 'https://example.com/doc',
        exact: 'Character evidence',
        tags: ['Character'],
      }),
      evidenceAnnotation({
        id: 'ann-action',
        uri: 'https://example.com/doc',
        exact: 'Action evidence',
        tags: ['Action'],
      }),
      evidenceAnnotation({
        id: 'ann-theme',
        uri: 'https://example.com/doc',
        exact: 'Theme evidence',
        tags: ['Theme'],
      }),
      evidenceAnnotation({
        id: 'ann-setting',
        uri: 'https://example.com/doc',
        exact: 'Setting evidence',
        tags: ['Setting'],
      }),
    ]);
    fakeNodeLinkState.loadState.resolves({
      status: 'loaded',
      state: emptyNodeLinkState({
        selectedGroupId: '__world__',
        tagEdges: [
          {
            id: 'character-action',
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'motivates',
          },
          {
            id: 'theme-character',
            sourceTag: 'Theme',
            targetTag: 'Character',
            connectionType: 'shapes',
          },
          {
            id: 'action-setting',
            sourceTag: 'Action',
            targetTag: 'Setting',
            connectionType: 'occurs in',
          },
        ],
      }),
      annotationId: 'state-ann',
      stateUri: 'https://hypothesis-node-link.local/state/group/__world__',
    });
    const wrapper = createComponent();

    await waitFor(() => {
      wrapper.update();
      return wrapper.find('g[role="button"]').length === 4;
    });

    const spotlight = wrapper
      .find('SearchableCombobox')
      .filterWhere(input => input.prop('id') === 'node-link-spotlight');
    spotlight.props().onChange('Character');

    await waitFor(() => {
      wrapper.update();
      return wrapper.find('g[role="button"]').length === 3;
    });

    assert.include(wrapper.text(), '3 of 4 tags shown around Character');

    wrapper
      .find('button')
      .filterWhere(button => button.text() === 'Clear spotlight')
      .props()
      .onClick();
    wrapper.update();

    assert.lengthOf(wrapper.find('g[role="button"]'), 4);
  });

  it('toggles the main viewport and auto-hides the sidebar for tag overview', async () => {
    fakeStore.tagInventorySchemaTagColors.returns({
      Action: 'rgba(80, 160, 96, 0.38)',
      Character: 'rgba(80, 160, 96, 0.38)',
    });
    fakeNodeLinkState.fetchGroupAnnotations.resolves([
      evidenceAnnotation({
        id: 'ann-character',
        uri: 'https://example.com/doc',
        exact: 'Character evidence',
        tags: ['Character'],
      }),
      evidenceAnnotation({
        id: 'ann-action',
        uri: 'https://example.com/doc',
        exact: 'Action evidence',
        tags: ['Action'],
      }),
    ]);
    fakeNodeLinkState.loadState.resolves({
      status: 'loaded',
      state: emptyNodeLinkState({
        selectedGroupId: '__world__',
        tagEdges: [
          {
            id: 'character-action',
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'motivates',
          },
        ],
      }),
      annotationId: 'state-ann',
      stateUri: 'https://hypothesis-node-link.local/state/group/__world__',
    });
    const wrapper = createComponent();

    await waitFor(() => {
      wrapper.update();
      return wrapper.find('g[role="button"]').length === 2;
    });

    const sidebar = () => wrapper.find('[data-testid="node-link-sidebar"]');
    const sidebarToggle = () =>
      wrapper.find('[data-testid="node-link-sidebar-toggle"]');
    const graphNodeColor = tag =>
      wrapper
        .find('g[role="button"]')
        .filterWhere(node => node.text().includes(tag))
        .first()
        .find('rect')
        .prop('fill');

    assert.isFalse(sidebar().prop('hidden'));
    assert.equal(sidebarToggle().text(), 'Hide sidebar');
    assert.notEqual(graphNodeColor('Action'), graphNodeColor('Character'));

    sidebarToggle().props().onClick();
    wrapper.update();

    assert.isTrue(sidebar().prop('hidden'));
    assert.equal(sidebarToggle().text(), 'Show sidebar');

    sidebarToggle().props().onClick();
    wrapper.update();

    assert.isFalse(sidebar().prop('hidden'));

    wrapper
      .find('button')
      .filterWhere(button => button.text() === 'Manual relationships')
      .props()
      .onClick();
    wrapper.update();

    assert.isTrue(
      wrapper.find('[data-testid="manual-edge-viewport-list"]').exists(),
    );
    assert.isFalse(
      wrapper.find('svg[aria-label="Tag relationship graph"]').exists(),
    );

    wrapper
      .find('button')
      .filterWhere(button => button.text() === 'Tag overview')
      .props()
      .onClick();
    wrapper.update();

    assert.isTrue(wrapper.find('[data-testid="tag-overview"]').exists());
    assert.lengthOf(wrapper.find('[data-testid="tag-overview"] tbody tr'), 2);
    assert.notEqual(
      wrapper
        .find('[data-testid="tag-overview"] span[title="Action"]')
        .first()
        .prop('style').backgroundColor,
      wrapper
        .find('[data-testid="tag-overview"] span[title="Character"]')
        .first()
        .prop('style').backgroundColor,
    );
    assert.isTrue(sidebar().prop('hidden'));
    assert.equal(sidebarToggle().text(), 'Show sidebar');

    sidebarToggle().props().onClick();
    wrapper.update();

    assert.isFalse(sidebar().prop('hidden'));

    wrapper
      .find('button')
      .filterWhere(button => button.text() === 'Graph')
      .props()
      .onClick();
    wrapper.update();

    assert.isFalse(sidebar().prop('hidden'));
  });

  it('generates and persists a summary for one tag', async () => {
    fakeNodeLinkState.fetchGroupAnnotations.resolves([
      evidenceAnnotation({
        id: 'ann-character',
        uri: 'https://example.com/doc',
        exact: 'Character quote evidence',
        tags: ['Character'],
      }),
    ]);
    const wrapper = createComponent();

    await waitFor(() => {
      wrapper.update();
      return wrapper.find('g[role="button"]').length === 1;
    });
    wrapper
      .find('button')
      .filterWhere(button => button.text() === 'Tag overview')
      .props()
      .onClick();
    wrapper.update();

    wrapper
      .find('tr[data-tag="Character"] button')
      .filterWhere(button => button.text() === 'Generate now')
      .props()
      .onClick();

    await waitFor(() => fakeNodeLinkState.saveState.calledOnce);
    wrapper.update();

    assert.calledOnce(fakeClaude.summarizeTag);
    assert.include(
      fakeClaude.summarizeTag.firstCall.args[0].prompt,
      'Character quote evidence',
    );
    const savedState = fakeNodeLinkState.saveState.firstCall.args[1];
    assert.deepInclude(savedState.tagSummaries[0], {
      tag: 'Character',
      summary: 'First summary line.\nSecond summary line.',
      model: 'claude-test',
    });
    assert.include(
      wrapper
        .find('tr[data-tag="Character"] [data-testid="tag-overview-summary"]')
        .text(),
      'First summary line.\nSecond summary line.',
    );
  });
});
