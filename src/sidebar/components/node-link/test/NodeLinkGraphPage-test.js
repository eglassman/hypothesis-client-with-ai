import { mount, waitFor } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { emptyNodeLinkState } from '../../../node-link/graph-state';
import {
  $imports,
  NodeLinkEditor,
  NodeLinkGraphPage,
  routeGroupToApply,
} from '../NodeLinkGraphPage';

describe('NodeLinkEditor', () => {
  const tagColors = {};

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
        nodeLinkState={fakeNodeLinkState}
        session={{ reload: sinon.stub().resolves() }}
        toastMessenger={{ error: sinon.stub() }}
      />,
    );
  }

  beforeEach(() => {
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
    await new Promise(resolve => setTimeout(resolve, 0));
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

  it('filters the rendered graph to one document without refetching group annotations', async () => {
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
        tags: ['Character'],
      }),
      evidenceAnnotation({
        id: 'ann-doc-b',
        uri: 'https://example.com/doc-b',
        exact: 'Evidence from document B',
        tags: ['Action'],
      }),
      {
        ...evidenceAnnotation({
          id: 'hidden-ann-doc-a',
          uri: 'https://example.com/doc-a',
          exact: 'Hidden evidence from document A',
          tags: ['Hidden Tag'],
        }),
        hidden: true,
      },
    ]);
    fakeNodeLinkState.loadState.callsFake(groupId =>
      Promise.resolve({
        status: 'missing',
        state: emptyNodeLinkState({
          selectedGroupId: groupId,
          descriptiveTags: [{ id: 'desc-hidden', tag: 'Hidden Description' }],
          tagEdges: [
            {
              sourceTag: 'Hidden Tag',
              targetTag: 'Hidden Description',
              connectionType: 'explains',
            },
          ],
        }),
        annotationId: null,
        stateUri: `https://hypothesis-node-link.local/state/group/${groupId}`,
      }),
    );

    const wrapper = createComponent();

    await waitFor(() => {
      wrapper.update();
      return wrapper.text().includes('3 tags, 2 documents');
    });

    const documentSelect = wrapper.find('select').at(1);
    assert.equal(documentSelect.prop('value'), '');
    assert.include(documentSelect.text(), 'All');

    documentSelect.props().onChange({
      target: { value: 'https://example.com/doc-a' },
    });

    await waitFor(() => {
      wrapper.update();
      return wrapper.text().includes('1 tags, 1 documents');
    });

    assert.notInclude(wrapper.find('main').text(), 'Hidden Tag');
    assert.notInclude(wrapper.find('main').text(), 'Hidden Description');
    assert.calledOnce(fakeNodeLinkState.fetchGroupAnnotations);
  });
});
