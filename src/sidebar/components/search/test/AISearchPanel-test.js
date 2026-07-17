import { mockImportedComponents } from '@hypothesis/frontend-testing';
import { mount } from '@hypothesis/frontend-testing';

import AISearchPanel, { $imports } from '../AISearchPanel';

describe('AISearchPanel', () => {
  let fakeStore;
  let fakeTagInventoryGroupSync;
  let fakePersistedTagInventory;
  let fakeNodeLinkState;

  function nodeLinkState(overrides = {}) {
    return {
      schemaVersion: 1,
      updatedAt: null,
      selectedGroupId: 'group-1',
      descriptiveTags: [],
      tagEdges: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    fakeStore = {
      aiSearchPanelQueryInput: sinon.stub().returns('query text'),
      aiSearchPanelSchemaTagInput: sinon.stub().returns(''),
      aiSearchPanelAnnotateManually: sinon.stub().returns(false),
      tagInventoryRows: sinon.stub().returns([]),
      savedAnnotations: sinon.stub().returns([]),
      tagInventorySchemaTagColors: sinon.stub().returns({}),
      mainFrame: sinon.stub().returns(null),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon.stub().returns([]),
      focusedGroupId: sinon.stub().returns('group-1'),
      closeSidebarPanel: sinon.stub(),
      setAISearchPanelQueryInput: sinon.stub(),
      setFilterQuery: sinon.stub(),
      setAISearchPanelSchemaTagInput: sinon.stub(),
      setAISearchPanelAnnotateManually: sinon.stub(),
      setTagInventorySchemaTagColor: sinon.stub(),
      setTagInventoryRowHidden: sinon.stub(),
    };

    fakeTagInventoryGroupSync = {
      cachedGroupAnnotations: sinon.stub().returns(null),
      getGroupAnnotations: sinon.stub().resolves([]),
      runWithDeferredInventorySync: sinon.stub().callsFake(work => work()),
    };

    fakePersistedTagInventory = {
      runWithDeferredPersist: sinon.stub().callsFake(work => work()),
    };

    fakeNodeLinkState = {
      loadState: sinon.stub().resolves({ state: nodeLinkState() }),
    };

    $imports.$mock(mockImportedComponents());
    $imports.$mock({
      '../../store': {
        useSidebarStore: () => fakeStore,
      },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  function createAISearchPanel() {
    return mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={{ setTagHighlightPalette: sinon.stub() }}
        claude={{}}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={{}}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );
  }

  /** Tag labels of the rendered history rows, in DOM (display) order. */
  function renderedTagOrder(wrapper) {
    return wrapper
      .find('button')
      .filterWhere(n =>
        (n.prop('aria-label') || '').startsWith(
          'Filter sidebar to annotations tagged',
        ),
      )
      .map(n => n.text());
  }

  function refreshButton(wrapper) {
    return wrapper.find('button[data-testid="ai-search-refresh-group-tags"]');
  }

  it('clears query text without closing the panel when clear is clicked', () => {
    const wrapper = createAISearchPanel();

    wrapper.find('SearchField').props().onClearSearch();

    assert.calledWith(fakeStore.setAISearchPanelQueryInput, null);
    assert.notCalled(fakeStore.closeSidebarPanel);
  });

  it('suggests existing schema tags while allowing a new tag', () => {
    fakeStore.tagInventoryRows.returns([
      {
        id: 'methods',
        groupId: 'group-1',
        schemaTag: 'Methods',
        query: '',
        annotationIds: [],
      },
    ]);
    fakeStore.tagInventorySchemaTagColors.returns({ Findings: '#fff' });

    const wrapper = createAISearchPanel();
    const selector = wrapper.find('SearchableCombobox');

    assert.deepEqual(selector.prop('options'), ['Findings', 'Methods']);
    assert.isTrue(selector.prop('allowCustomValue'));

    selector.props().onChange('New tag');

    assert.calledWith(fakeStore.setAISearchPanelSchemaTagInput, 'New tag');
  });

  it('closes AI search panel when Escape is pressed in search field', () => {
    const wrapper = createAISearchPanel();

    wrapper
      .find('SearchField')
      .props()
      .onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    assert.calledWith(fakeStore.closeSidebarPanel, 'aiSearchAnnotations');
  });

  it('shows empty-query explanation for manual-mode-style rows', () => {
    fakeStore.tagInventoryRows.returns([
      {
        id: 'manual-save-a1-methods',
        groupId: 'group-1',
        schemaTag: 'methods',
        query: '',
        annotationIds: [],
      },
    ]);

    const wrapper = createAISearchPanel();

    assert.include(
      wrapper.text(),
      'No query - matches this tag across the document',
    );
  });

  it('sorts visible history rows alphabetically by tag', () => {
    fakeStore.tagInventoryRows.returns([
      {
        id: 'z',
        groupId: 'group-1',
        schemaTag: 'zeta',
        query: '',
        annotationIds: [],
      },
      {
        id: 'a',
        groupId: 'group-1',
        schemaTag: 'alpha',
        query: '',
        annotationIds: [],
      },
      {
        id: 'm',
        groupId: 'group-1',
        schemaTag: 'mu',
        query: '',
        annotationIds: [],
      },
    ]);

    const wrapper = createAISearchPanel();

    assert.deepEqual(renderedTagOrder(wrapper), ['alpha', 'mu', 'zeta']);
  });

  it('hides rows that belong to other groups', () => {
    fakeStore.tagInventoryRows.returns([
      {
        id: 'in',
        groupId: 'group-1',
        schemaTag: 'methods',
        query: '',
        annotationIds: [],
      },
      {
        id: 'out',
        groupId: 'group-2',
        schemaTag: 'results',
        query: '',
        annotationIds: [],
      },
    ]);

    const wrapper = createAISearchPanel();

    assert.deepEqual(renderedTagOrder(wrapper), ['methods']);
  });

  it('refreshes group tags when the refresh button is clicked', () => {
    const wrapper = createAISearchPanel();
    const button = refreshButton(wrapper);

    assert.isNotTrue(button.prop('disabled'));
    button.simulate('click');

    assert.calledWith(
      fakeTagInventoryGroupSync.getGroupAnnotations,
      'group-1',
      { force: true },
    );
  });

  it('shows a sign-in error when AI search is submitted while logged out', async () => {
    fakeStore.profile = sinon.stub().returns({});
    fakeStore.aiSearchPanelSchemaTagInput.returns('methods');
    const fakeToastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };
    const fakeClaude = {
      AISearchDocument: sinon.stub(),
    };

    const wrapper = mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={{ setTagHighlightPalette: sinon.stub() }}
        claude={fakeClaude}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={fakeToastMessenger}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );

    await wrapper.find('SearchField').props().onSearch('find methods');

    assert.calledWith(
      fakeToastMessenger.error,
      'Not signed in — please sign in to use AI search.',
    );
    assert.notCalled(fakeClaude.AISearchDocument);
  });

  it('passes the resolved document URL to Claude when search is submitted', async () => {
    fakeStore.profile = sinon
      .stub()
      .returns({ userid: 'acct:user@hypothes.is' });
    fakeStore.mainFrame = sinon.stub().returns({
      uri: 'urn:x-pdf:abc',
    });
    fakeStore.searchUris.returns([
      'urn:x-pdf:abc',
      'http://example.com/paper.pdf',
    ]);
    fakeStore.aiSearchPanelSchemaTagInput.returns('methods');
    const fakeClaude = {
      apiKey: sinon.stub().returns('test-key'),
      AISearchDocument: sinon.stub().rejects(new Error('stop after claude')),
    };
    const fakeToastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };

    const wrapper = mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={{ setTagHighlightPalette: sinon.stub() }}
        claude={fakeClaude}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={fakeToastMessenger}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );

    await wrapper.find('SearchField').props().onSearch('find methods');

    assert.calledWith(
      fakeClaude.AISearchDocument,
      sinon.match({ documentUri: 'http://example.com/paper.pdf' }),
    );
  });

  it('includes the selected group tag reference in the Claude prompt', async () => {
    fakeStore.profile = sinon
      .stub()
      .returns({ userid: 'acct:user@hypothes.is' });
    fakeStore.mainFrame = sinon.stub().returns({
      uri: 'urn:x-pdf:abc',
    });
    fakeStore.searchUris.returns([
      'urn:x-pdf:abc',
      'http://example.com/paper.pdf',
    ]);
    fakeStore.aiSearchPanelSchemaTagInput.returns('methods');
    fakeTagInventoryGroupSync.getGroupAnnotations.resolves([
      {
        id: 'ann-1',
        group: 'group-1',
        tags: ['Methods', 'Finding', 'QuoteOnly'],
        text: '',
        target: [],
      },
    ]);
    fakeNodeLinkState.loadState.resolves({
      state: nodeLinkState({
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            sourceTag: 'Methods',
            targetTag: 'Theme',
            connectionType: 'supports',
          },
          {
            sourceTag: 'Methods',
            targetTag: 'Finding',
            connectionType: 'shows',
          },
        ],
      }),
    });
    const fakeClaude = {
      apiKey: sinon.stub().returns('test-key'),
      AISearchDocument: sinon.stub().rejects(new Error('stop after claude')),
    };
    const fakeToastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };

    const wrapper = mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={{ setTagHighlightPalette: sinon.stub() }}
        claude={fakeClaude}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={fakeToastMessenger}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );

    await wrapper.find('SearchField').props().onSearch('find methods');

    const prompt = fakeClaude.AISearchDocument.firstCall.args[0].query;
    assert.calledWith(fakeNodeLinkState.loadState, 'group-1');
    assert.include(
      prompt,
      'These tags have the following relationships to each other:',
    );
    assert.notInclude(prompt, 'Tag relationships for the selected group:');
    assert.notInclude(
      prompt,
      'Descriptive tags are inter-tag relationship context only; do not tag any quotes with descriptive tags.',
    );
    assert.notInclude(prompt, '[descriptive]');
    assert.include(prompt, 'Tag: Methods');
    assert.include(prompt, 'Methods shows Finding');
    assert.include(prompt, 'Methods supports Theme');
    assert.lengthOf(prompt.match(/Methods shows Finding/g) || [], 1);
    assert.lengthOf(prompt.match(/Methods supports Theme/g) || [], 1);
    assert.notInclude(prompt, 'Tag: Theme');
    assert.notInclude(prompt, 'Tag: Finding');
    assert.notInclude(prompt, 'QuoteOnly');
    assert.notInclude(prompt, '<-');
    assert.notInclude(prompt, '->');
    assert.notInclude(prompt, 'count=');
    assert.notInclude(prompt, '"outgoingRelationships"');
  });

  it('retries with PDF bytes when Claude cannot download the document URL', async () => {
    fakeStore.profile = sinon
      .stub()
      .returns({ userid: 'acct:user@hypothes.is' });
    fakeStore.mainFrame = sinon.stub().returns({ uri: 'urn:x-pdf:abc' });
    fakeStore.searchUris = sinon
      .stub()
      .returns(['urn:x-pdf:abc', 'https://dl.acm.org/doi/pdf/10.1145/example']);
    fakeStore.aiSearchPanelSchemaTagInput.returns('methods');
    const downloadError = new Error(
      'Failed to extract quotes from document: 400 {"error":{"message":"Unable to download the file. Please verify the URL and try again."}}',
    );
    const fakeClaude = {
      apiKey: sinon.stub().returns('test-key'),
      AISearchDocument: sinon
        .stub()
        .onFirstCall()
        .rejects(downloadError)
        .onSecondCall()
        .rejects(new Error('stop after retry')),
    };
    const fakeFrameSync = {
      setTagHighlightPalette: sinon.stub(),
      getPdfBytes: sinon.stub().resolves('base64-pdf-bytes'),
    };
    const fakeToastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };

    const wrapper = mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={fakeFrameSync}
        claude={fakeClaude}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={fakeToastMessenger}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );

    await wrapper.find('SearchField').props().onSearch('find methods');

    assert.calledTwice(fakeClaude.AISearchDocument);
    assert.calledWith(
      fakeClaude.AISearchDocument.firstCall,
      sinon.match({
        documentUri: 'https://dl.acm.org/doi/pdf/10.1145/example',
      }),
    );
    assert.calledWith(
      fakeClaude.AISearchDocument.secondCall,
      sinon.match({ documentPdfBase64: 'base64-pdf-bytes' }),
    );
    assert.calledOnce(fakeFrameSync.getPdfBytes);
  });

  it('retries with HTML page text when Claude cannot download an HTML document URL', async () => {
    fakeStore.profile = sinon
      .stub()
      .returns({ userid: 'acct:user@hypothes.is' });
    fakeStore.mainFrame = sinon.stub().returns({
      uri: 'https://onlinelibrary.wiley.com/doi/10.1111/example',
    });
    fakeStore.searchUris = sinon
      .stub()
      .returns([
        'https://onlinelibrary.wiley.com/doi/10.1111/example',
        'doi:10.1111/example',
      ]);
    fakeStore.aiSearchPanelSchemaTagInput.returns('methods');
    const downloadError = new Error(
      'Failed to extract quotes from document: 400 {"error":{"message":"Unable to download the file. Please verify the URL and try again."}}',
    );
    const fakeClaude = {
      apiKey: sinon.stub().returns('test-key'),
      AISearchDocument: sinon
        .stub()
        .onFirstCall()
        .rejects(downloadError)
        .onSecondCall()
        .rejects(new Error('stop after retry')),
    };
    const fakeFrameSync = {
      setTagHighlightPalette: sinon.stub(),
      getDocumentText: sinon.stub().resolves('Article body text for Claude'),
    };
    const fakeToastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };

    const wrapper = mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={fakeFrameSync}
        claude={fakeClaude}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={fakeToastMessenger}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );

    await wrapper.find('SearchField').props().onSearch('find methods');

    assert.calledTwice(fakeClaude.AISearchDocument);
    assert.calledWith(
      fakeClaude.AISearchDocument.firstCall,
      sinon.match({
        documentUri: 'https://onlinelibrary.wiley.com/doi/10.1111/example',
      }),
    );
    assert.calledWith(
      fakeClaude.AISearchDocument.secondCall,
      sinon.match({ documentPlainText: 'Article body text for Claude' }),
    );
    assert.calledOnce(fakeFrameSync.getDocumentText);
  });

  it('passes the HTTPS PDF alias to Claude when the frame URI is a URN', async () => {
    fakeStore.profile = sinon
      .stub()
      .returns({ userid: 'acct:user@hypothes.is' });
    fakeStore.mainFrame = sinon.stub().returns({ uri: 'urn:x-pdf:abc' });
    fakeStore.searchUris = sinon
      .stub()
      .returns(['urn:x-pdf:abc', 'https://example.com/paper.pdf']);
    fakeStore.aiSearchPanelSchemaTagInput.returns('methods');
    const fakeClaude = {
      apiKey: sinon.stub().returns('test-key'),
      AISearchDocument: sinon.stub().rejects(new Error('stop after claude')),
    };
    const fakeToastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };

    const wrapper = mount(
      <AISearchPanel
        annotationsService={{}}
        experimentLog={{}}
        frameSync={{ setTagHighlightPalette: sinon.stub() }}
        claude={fakeClaude}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={fakeToastMessenger}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );

    await wrapper.find('SearchField').props().onSearch('find methods');

    assert.calledWith(
      fakeClaude.AISearchDocument,
      sinon.match({ documentUri: 'https://example.com/paper.pdf' }),
    );
  });

  it('calls getGroupAnnotations when rerun is triggered on a row', async () => {
    fakeStore.profile = sinon
      .stub()
      .returns({ userid: 'acct:user@hypothes.is' });
    fakeStore.focusedGroupId.returns('group-1');
    fakeStore.mainFrame = sinon.stub().returns({ uri: 'urn:x-pdf:abc' });
    fakeStore.searchUris.returns([
      'urn:x-pdf:abc',
      'http://example.com/doc.pdf',
    ]);
    fakeStore.tagInventoryRows.returns([
      {
        id: 'row-1',
        groupId: 'group-1',
        schemaTag: 'methods',
        query: 'find methods',
        annotationIds: [],
      },
    ]);
    fakeStore.removeAnnotationIdsFromTagInventoryRows = sinon.stub();

    const fakeClaude = {
      apiKey: sinon.stub().returns('test-key'),
      AISearchDocument: sinon.stub().rejects(new Error('stop after cache')),
    };
    const fakeAnnotationsService = {
      delete: sinon.stub().resolves(),
    };
    const fakeExperimentLog = {
      logRerunSearch: sinon.stub(),
    };
    const fakeToastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };

    const wrapper = mount(
      <AISearchPanel
        annotationsService={fakeAnnotationsService}
        experimentLog={fakeExperimentLog}
        frameSync={{ setTagHighlightPalette: sinon.stub() }}
        claude={fakeClaude}
        api={{}}
        nodeLinkState={fakeNodeLinkState}
        toastMessenger={fakeToastMessenger}
        tagInventoryGroupSync={fakeTagInventoryGroupSync}
        persistedTagInventory={fakePersistedTagInventory}
      />,
    );

    const rerunButton = wrapper
      .find('button')
      .filterWhere(n =>
        (n.prop('aria-label') || '').includes('re-run the AI search'),
      );

    rerunButton.simulate('click');
    await Promise.resolve();
    await Promise.resolve();

    assert.calledWith(fakeTagInventoryGroupSync.getGroupAnnotations, 'group-1');
  });

  it('shows the refresh button for a private group even with no rows', () => {
    fakeStore.tagInventoryRows.returns([]);

    const wrapper = createAISearchPanel();
    const button = refreshButton(wrapper);

    assert.isTrue(button.exists());
    assert.isNotTrue(button.prop('disabled'));
  });

  it('hides the refresh button for the public group', () => {
    fakeStore.focusedGroupId.returns('__world__');

    const wrapper = createAISearchPanel();

    assert.isFalse(refreshButton(wrapper).exists());
  });

  it('does not call getGroupAnnotations when refresh button is clicked in the public group', () => {
    fakeStore.focusedGroupId.returns('__world__');
    fakeStore.tagInventoryRows.returns([]);

    const wrapper = createAISearchPanel();

    assert.isFalse(refreshButton(wrapper).exists());
    assert.notCalled(fakeTagInventoryGroupSync.getGroupAnnotations);
  });
});
