import sinon from 'sinon';

import { fakeReduxStore } from '../../test/fake-redux-store';
import { setupTagPaletteSync } from '../tag-palette-sync';

describe('setupTagPaletteSync', () => {
  function createStore(tagInventory, { focusedGroupId = 'group-1' } = {}) {
    return fakeReduxStore(
      {
        sidebarPanels: {
          tagInventory,
        },
      },
      {
        focusedGroupId: () => focusedGroupId,
        mainFrame: () => null,
        defaultContentFrame: () => null,
        searchUris: () => [],
        savedAnnotations: () => [],
      },
    );
  }

  it('pushes palette using visible rows only on setup', () => {
    const frameSync = {
      setTagHighlightPalette: sinon.stub(),
    };
    const store = createStore({
      rows: [
        {
          id: 'r1',
          groupId: 'group-1',
          schemaTag: 'topic',
          query: '',
          annotationIds: [],
        },
      ],
      schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
    });

    setupTagPaletteSync(frameSync, store);

    assert.calledOnce(frameSync.setTagHighlightPalette);
    assert.deepEqual(frameSync.setTagHighlightPalette.firstCall.args[0], {
      'ai-pending': 'rgba(64, 169, 255, 0.38)',
      'ai-user-approved': 'rgba(255, 64, 223, 0.38)',
      topic: 'rgba(1, 2, 3, 0.38)',
    });
    assert.deepEqual(frameSync.setTagHighlightPalette.firstCall.args[1], []);
  });

  it('re-pushes palette and hidden annotation IDs when a row is hidden or unhidden', () => {
    const frameSync = {
      setTagHighlightPalette: sinon.stub(),
    };
    const store = createStore({
      rows: [
        {
          id: 'r1',
          groupId: 'group-1',
          schemaTag: 'topic',
          query: '',
          annotationIds: ['ann-1'],
        },
      ],
      schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
    });

    setupTagPaletteSync(frameSync, store);

    store.setState({
      sidebarPanels: {
        tagInventory: {
          rows: [
            {
              id: 'r1',
              groupId: 'group-1',
              schemaTag: 'topic',
              query: '',
              annotationIds: ['ann-1'],
              hidden: true,
            },
          ],
          schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
        },
      },
    });
    store.setState({
      sidebarPanels: {
        tagInventory: {
          rows: [
            {
              id: 'r1',
              groupId: 'group-1',
              schemaTag: 'topic',
              query: '',
              annotationIds: ['ann-1'],
            },
          ],
          schemaTagColors: { topic: 'rgba(1, 2, 3, 0.38)' },
        },
      },
    });

    assert.equal(frameSync.setTagHighlightPalette.callCount, 3);
    assert.notProperty(
      frameSync.setTagHighlightPalette.getCall(1).args[0],
      'topic',
    );
    assert.deepEqual(frameSync.setTagHighlightPalette.getCall(1).args[1], [
      'ann-1',
    ]);
    assert.propertyVal(
      frameSync.setTagHighlightPalette.getCall(2).args[0],
      'topic',
      'rgba(1, 2, 3, 0.38)',
    );
    assert.deepEqual(frameSync.setTagHighlightPalette.getCall(2).args[1], []);
  });
});
