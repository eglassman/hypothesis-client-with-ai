import { createStore } from '../../store/create-store';
import { sidebarPanelsModule } from '../../store/modules/sidebar-panels';
import {
  AI_SEARCH_NEGATIVE_EXAMPLES_KEY,
  AI_SEARCH_STORAGE_KEY,
  parseAISearchNegativeExamplesState,
  parseAISearchState,
  PersistedAISearchService,
} from '../persisted-ai-search';

describe('parseAISearchState', () => {
  it('returns null for non-objects', () => {
    assert.isNull(parseAISearchState(null));
    assert.isNull(parseAISearchState('x'));
  });

  it('returns null when rows or schemaTagColors are invalid', () => {
    assert.isNull(parseAISearchState({ rows: 'nope', schemaTagColors: {} }));
    assert.isNull(parseAISearchState({ rows: [], schemaTagColors: [] }));
  });

  it('accepts a valid AISearchState shape', () => {
    const state = {
      rows: [
        {
          id: '1',
          schemaTag: 't',
          query: 'q',
          annotationIds: ['a'],
        },
      ],
      schemaTagColors: { t: 'rgba(0,0,0,0.38)' },
    };
    assert.deepEqual(parseAISearchState(state), state);
  });
});

describe('parseAISearchNegativeExamplesState', () => {
  it('returns null for non-arrays', () => {
    assert.isNull(parseAISearchNegativeExamplesState(null));
    assert.isNull(parseAISearchNegativeExamplesState({}));
  });

  it('accepts a valid array of negative examples', () => {
    const arr = [
      {
        id: '1',
        schemaTag: 't',
        query: 'q',
        quote: 'qt',
        documentUri: 'http://d',
      },
    ];
    assert.deepEqual(parseAISearchNegativeExamplesState(arr), arr);
  });

  it('returns null when an entry is invalid', () => {
    assert.isNull(
      parseAISearchNegativeExamplesState([{ id: '1', schemaTag: 2 }]),
    );
  });
});

describe('PersistedAISearchService', () => {
  let fakeLocalStorage;
  let store;
  let fakeWindow;
  /** @type {Record<string, Function[]>} */
  let listeners;

  function triggerStorage(key, newValue) {
    const storageEvent = new Event('storage');
    storageEvent.key = key;
    storageEvent.newValue = newValue;
    (listeners.storage || []).forEach(fn => fn(storageEvent));
  }

  beforeEach(() => {
    listeners = {};
    fakeWindow = {
      document: {
        visibilityState: 'visible',
        addEventListener: sinon.spy((type, fn) => {
          listeners[`doc:${type}`] = listeners[`doc:${type}`] || [];
          listeners[`doc:${type}`].push(fn);
        }),
      },
      addEventListener: sinon.spy((type, fn) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      }),
    };

    store = createStore([sidebarPanelsModule]);

    fakeLocalStorage = {
      getObject: sinon.stub(),
      setObject: sinon.stub(),
    };
  });

  function createService() {
    return new PersistedAISearchService(fakeLocalStorage, store, fakeWindow);
  }

  describe('#init', () => {
    it('hydrates from localStorage when data is valid', () => {
      const persisted = {
        rows: [
          {
            id: 'r1',
            schemaTag: 'methods',
            query: 'q1',
            annotationIds: ['a1'],
          },
        ],
        schemaTagColors: { methods: 'rgba(1,2,3,0.38)' },
      };
      fakeLocalStorage.getObject
        .withArgs(AI_SEARCH_STORAGE_KEY)
        .returns(persisted);

      createService().init();

      assert.deepEqual(store.getState().sidebarPanels.aiSearch, persisted);
    });

    it('hydrates negative examples from localStorage when data is valid', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);
      const neg = [
        {
          id: 'n1',
          schemaTag: 't',
          query: 'q',
          quote: 'qt',
          documentUri: 'http://d',
        },
      ];
      fakeLocalStorage.getObject
        .withArgs(AI_SEARCH_NEGATIVE_EXAMPLES_KEY)
        .returns(neg);

      createService().init();

      assert.deepEqual(
        store.getState().sidebarPanels.aiSearchNegativeExamples,
        neg,
      );
    });

    it('does not hydrate when stored data is invalid', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns({
        rows: 'bad',
        schemaTagColors: {},
      });

      createService().init();

      assert.deepEqual(store.getState().sidebarPanels.aiSearch.rows, []);
    });

    it('persists when aiSearch changes after init', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);
      createService().init();

      store.addAISearchRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q',
        annotationIds: [],
      });

      assert.calledWith(
        fakeLocalStorage.setObject,
        AI_SEARCH_STORAGE_KEY,
        store.getState().sidebarPanels.aiSearch,
      );
    });

    it('persists when aiSearchNegativeExamples changes after init', () => {
      fakeLocalStorage.getObject.returns(null);
      createService().init();

      const neg = [
        {
          id: 'n1',
          schemaTag: 't',
          query: 'q',
          quote: 'qt',
          documentUri: 'http://d',
        },
      ];
      store.hydrateAISearchNegativeExamples(neg);

      assert.calledWith(
        fakeLocalStorage.setObject,
        AI_SEARCH_NEGATIVE_EXAMPLES_KEY,
        neg,
      );
    });

    it('registers a storage listener', () => {
      fakeLocalStorage.getObject.returns(null);
      createService().init();

      assert.calledWith(fakeWindow.addEventListener, 'storage', sinon.match.func);
    });
  });

  describe('when another tab updates storage', () => {
    it('hydrates from storage event payload', () => {
      fakeLocalStorage.getObject.withArgs(AI_SEARCH_STORAGE_KEY).returns(null);

      createService().init();

      const next = {
        rows: [
          {
            id: 'x',
            schemaTag: 'remote',
            query: 'rq',
            annotationIds: [],
          },
        ],
        schemaTagColors: { remote: 'rgba(9,9,9,0.38)' },
      };

      triggerStorage(
        AI_SEARCH_STORAGE_KEY,
        JSON.stringify(next),
      );

      assert.deepEqual(store.getState().sidebarPanels.aiSearch, next);
    });

    it('hydrates negative examples from storage event payload', () => {
      fakeLocalStorage.getObject.returns(null);

      createService().init();

      const next = [
        {
          id: 'n1',
          schemaTag: 'remote',
          query: 'rq',
          quote: 'qx',
          documentUri: 'http://r',
        },
      ];

      triggerStorage(
        AI_SEARCH_NEGATIVE_EXAMPLES_KEY,
        JSON.stringify(next),
      );

      assert.deepEqual(
        store.getState().sidebarPanels.aiSearchNegativeExamples,
        next,
      );
    });

    it('does not hydrate when payload matches current state', () => {
      const initial = {
        rows: [],
        schemaTagColors: {},
      };
      fakeLocalStorage.getObject.returns(initial);

      createService().init();

      sinon.spy(store, 'hydrateAISearch');

      triggerStorage(
        AI_SEARCH_STORAGE_KEY,
        JSON.stringify(initial),
      );

      assert.notCalled(store.hydrateAISearch);
    });

    it('hydrates empty state when key is removed', () => {
      const persisted = {
        rows: [
          {
            id: 'r1',
            schemaTag: 't',
            query: 'q',
            annotationIds: [],
          },
        ],
        schemaTagColors: { t: 'rgba(1,1,1,0.38)' },
      };
      fakeLocalStorage.getObject.returns(persisted);

      createService().init();

      triggerStorage(AI_SEARCH_STORAGE_KEY, null);

      assert.deepEqual(store.getState().sidebarPanels.aiSearch, {
        rows: [],
        schemaTagColors: {},
      });
    });
  });
});
