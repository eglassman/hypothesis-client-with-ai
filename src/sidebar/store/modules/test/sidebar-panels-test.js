import { createStore } from '../../create-store';
import { sidebarPanelsModule } from '../sidebar-panels';

describe('sidebar/store/modules/sidebar-panels', () => {
  let store;

  const getSidebarPanelsState = () => {
    return store.getState().sidebarPanels;
  };

  beforeEach(() => {
    store = createStore([sidebarPanelsModule]);
  });

  describe('#initialState', () => {
    it('sets initial `activePanelName` to `null`', () => {
      assert.equal(getSidebarPanelsState().activePanelName, null);
    });

    it('sets initial `aiSearch` rows and colors empty', () => {
      const ai = getSidebarPanelsState().aiSearch;
      assert.deepEqual(ai.rows, []);
      assert.deepEqual(ai.schemaTagColors, {});
    });

    it('sets initial `aiSearchNegativeExamples` empty', () => {
      assert.deepEqual(
        getSidebarPanelsState().aiSearchNegativeExamples,
        [],
      );
    });
  });

  describe('reducers', () => {
    describe('#OPEN_SIDEBAR_PANEL', () => {
      it('replaces `activePanelName` with passed `panelName`', () => {
        store.openSidebarPanel('foobar');

        assert.equal(getSidebarPanelsState().activePanelName, 'foobar');
      });
    });

    describe('#CLOSE_SIDEBAR_PANEL', () => {
      it('sets the active panel `null` if passed `panelName` is active panel', () => {
        store.openSidebarPanel('dingdong');
        store.closeSidebarPanel('dingdong');
        assert.equal(getSidebarPanelsState().activePanelName, null);
      });
      it('does not change the active panel if passed `panelName` is not the active panel', () => {
        store.openSidebarPanel('dingdong');
        store.closeSidebarPanel('somethingelse');
        assert.equal(getSidebarPanelsState().activePanelName, 'dingdong');
      });
    });

    describe('#TOGGLE_SIDEBAR_PANEL', () => {
      it('sets active panel to passed `panelName` if that panel is not the active panel already', () => {
        store.toggleSidebarPanel('dingdong');
        assert.equal(getSidebarPanelsState().activePanelName, 'dingdong');
      });

      it('sets active panel to `null` if passed `panelName` is the active panel already', () => {
        store.openSidebarPanel('dingdong');
        store.toggleSidebarPanel('dingdong');
        assert.equal(getSidebarPanelsState().activePanelName, null);
      });

      it('activates the given `panelName` if `activeState` is `true`', () => {
        store.openSidebarPanel('dingdong');
        store.toggleSidebarPanel('dingdong', true);
        assert.equal(getSidebarPanelsState().activePanelName, 'dingdong');
      });

      it('deactivates the given `panelName` if `activeState` is `false` and panel is active', () => {
        store.openSidebarPanel('dingdong');
        store.toggleSidebarPanel('dingdong', false);
        assert.equal(getSidebarPanelsState().activePanelName, null);
      });

      it('does not change active panel if `panelName` is not active and `activeState` is false', () => {
        store.openSidebarPanel('doodledoo');
        store.toggleSidebarPanel('dingdong', false);
        assert.equal(getSidebarPanelsState().activePanelName, 'doodledoo');
      });
    });
  });

  describe('aiSearch reducers', () => {
    it('adds a row and assigns a default color for a new schema tag', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 'methods',
        query: 'q1',
        annotationIds: ['a1'],
      });
      const ai = getSidebarPanelsState().aiSearch;
      assert.lengthOf(ai.rows, 1);
      assert.equal(ai.rows[0].schemaTag, 'methods');
      assert.include(ai.schemaTagColors.methods, 'rgba(');
    });

    it('does not duplicate default color when adding another row for the same tag', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q1',
        annotationIds: [],
      });
      const first = getSidebarPanelsState().aiSearch.schemaTagColors.t;
      store.addAISearchRow({
        id: 'r2',
        schemaTag: 't',
        query: 'q2',
        annotationIds: [],
      });
      assert.equal(
        getSidebarPanelsState().aiSearch.schemaTagColors.t,
        first,
      );
    });

    it('removes a row and prunes color when no rows use that tag', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 'x',
        query: 'q',
        annotationIds: [],
      });
      assert.property(getSidebarPanelsState().aiSearch.schemaTagColors, 'x');
      store.removeAISearchRow('r1');
      assert.notProperty(getSidebarPanelsState().aiSearch.schemaTagColors, 'x');
    });

    it('updates schema tag color', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 'z',
        query: 'q',
        annotationIds: [],
      });
      store.setAISearchSchemaTagColor('z', 'rgba(1, 2, 3, 0.38)');
      assert.equal(
        getSidebarPanelsState().aiSearch.schemaTagColors.z,
        'rgba(1, 2, 3, 0.38)',
      );
    });

    it('merges duplicate tag+query rows into keep row and unions annotation ids', () => {
      store.addAISearchRow({
        id: 'keep',
        schemaTag: 't',
        query: 'q1',
        annotationIds: ['a1'],
      });
      store.addAISearchRow({
        id: 'dup',
        schemaTag: 't',
        query: 'q1',
        annotationIds: ['a2', 'a1'],
      });
      store.addAISearchRow({
        id: 'other',
        schemaTag: 'u',
        query: 'q2',
        annotationIds: ['x'],
      });
      store.mergeAISearchRowsWithSameTagQuery('keep');
      const ai = getSidebarPanelsState().aiSearch;
      assert.lengthOf(ai.rows, 2);
      const merged = ai.rows.find(r => r.id === 'keep');
      assert.deepEqual(merged.annotationIds, ['a1', 'a2']);
      assert.isTrue(ai.rows.some(r => r.id === 'other'));
    });

    it('merge with trim-equivalent tag and query still merges', () => {
      store.addAISearchRow({
        id: 'k',
        schemaTag: ' tag ',
        query: ' q ',
        annotationIds: ['1'],
      });
      store.addAISearchRow({
        id: 'd',
        schemaTag: 'tag',
        query: 'q',
        annotationIds: ['2'],
      });
      store.mergeAISearchRowsWithSameTagQuery('k');
      assert.lengthOf(getSidebarPanelsState().aiSearch.rows, 1);
    });

    it('sets annotation ids on a single row', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 's',
        query: 'q',
        annotationIds: ['old'],
      });
      store.setAISearchRowAnnotationIds('r1', ['n1', 'n2']);
      assert.deepEqual(
        getSidebarPanelsState().aiSearch.rows[0].annotationIds,
        ['n1', 'n2'],
      );
    });

    it('removes annotation ids from all rows', () => {
      store.addAISearchRow({
        id: 'r1',
        schemaTag: 'a',
        query: 'q1',
        annotationIds: ['x', 'y'],
      });
      store.addAISearchRow({
        id: 'r2',
        schemaTag: 'b',
        query: 'q2',
        annotationIds: ['y', 'z'],
      });
      store.removeAnnotationIdsFromAISearchRows(['y']);
      const rows = getSidebarPanelsState().aiSearch.rows;
      assert.deepEqual(
        rows.find(r => r.id === 'r1').annotationIds,
        ['x'],
      );
      assert.deepEqual(
        rows.find(r => r.id === 'r2').annotationIds,
        ['z'],
      );
    });

    describe('#HYDRATE_AI_SEARCH', () => {
      it('replaces the full aiSearch slice', () => {
        store.addAISearchRow({
          id: 'r1',
          schemaTag: 'tag',
          query: 'q',
          annotationIds: [],
        });
        const replacement = {
          rows: [
            {
              id: 'x',
              schemaTag: 'a',
              query: 'b',
              annotationIds: ['id1'],
            },
          ],
          schemaTagColors: { a: 'rgba(1,1,1,0.38)' },
        };
        store.hydrateAISearch(replacement);
        assert.deepEqual(getSidebarPanelsState().aiSearch, replacement);
      });

      it('does not change activePanelName', () => {
        store.openSidebarPanel('aiSearchAnnotations');
        store.hydrateAISearch({
          rows: [],
          schemaTagColors: {},
        });
        assert.equal(
          getSidebarPanelsState().activePanelName,
          'aiSearchAnnotations',
        );
      });
    });
  });

  describe('aiSearchNegativeExamples reducers', () => {
    it('adds a negative example', () => {
      store.addAISearchNegativeExample({
        id: 'n1',
        schemaTag: 't',
        query: 'q',
        quote: 'qt',
        documentUri: 'http://x',
      });
      assert.lengthOf(store.aiSearchNegativeExamples(), 1);
      assert.equal(store.aiSearchNegativeExamples()[0].id, 'n1');
    });

    it('dedupes identical documentUri+tag+query+quote', () => {
      const ex = {
        id: 'n1',
        schemaTag: 't',
        query: 'q',
        quote: 'qt',
        documentUri: 'http://x',
      };
      store.addAISearchNegativeExample(ex);
      store.addAISearchNegativeExample({ ...ex, id: 'n2' });
      assert.lengthOf(store.aiSearchNegativeExamples(), 1);
    });

    it('removes by id', () => {
      store.addAISearchNegativeExample({
        id: 'n1',
        schemaTag: 't',
        query: 'q',
        quote: 'qt',
        documentUri: 'http://x',
      });
      store.removeAISearchNegativeExample('n1');
      assert.lengthOf(store.aiSearchNegativeExamples(), 0);
    });

    it('hydrate replaces the list', () => {
      store.addAISearchNegativeExample({
        id: 'n1',
        schemaTag: 't',
        query: 'q',
        quote: 'qt',
        documentUri: 'http://x',
      });
      store.hydrateAISearchNegativeExamples([]);
      assert.lengthOf(store.aiSearchNegativeExamples(), 0);
    });
  });

  describe('selectors', () => {
    describe('#isSidebarPanelOpen', () => {
      it('returns `true` if `panelName` is the current active panel', () => {
        store.openSidebarPanel('dingdong');
        assert.isTrue(store.isSidebarPanelOpen('dingdong'));
      });

      it('returns `false` if `panelName` is not the current active panel', () => {
        store.openSidebarPanel('dingdong');
        assert.isFalse(store.isSidebarPanelOpen('broomstick'));
      });
    });

    describe('#aiSearchRows and #aiSearchSchemaTagColors', () => {
      it('returns current aiSearch slice fields', () => {
        store.addAISearchRow({
          id: 'id1',
          schemaTag: 's',
          query: 'qq',
          annotationIds: ['id'],
        });
        assert.lengthOf(store.aiSearchRows(), 1);
        assert.property(store.aiSearchSchemaTagColors(), 's');
      });
    });
  });
});
