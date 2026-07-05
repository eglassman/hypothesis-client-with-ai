import { delay } from '@hypothesis/frontend-testing';

import { createStore } from '../../store/create-store';
import { framesModule } from '../../store/modules/frames';
import {
  sidebarPanelsModule,
  tagInventoryRowId,
} from '../../store/modules/sidebar-panels';
import {
  parseExperimentLogState,
  EXPERIMENT_LOG_STORAGE_KEY,
} from '../experiment-log';
import {
  TAG_INVENTORY_STORAGE_KEY,
  parseTagInventoryPersisted,
  PersistedTagInventoryService,
} from '../persisted-tag-inventory';

describe('parseTagInventoryPersisted', () => {
  it('returns null for non-objects', () => {
    assert.isNull(parseTagInventoryPersisted(null));
    assert.isNull(parseTagInventoryPersisted('x'));
  });

  it('returns null when revision is missing or not a non-negative integer', () => {
    assert.isNull(
      parseTagInventoryPersisted({
        rows: [],
        schemaTagColors: {},
      }),
    );
    assert.isNull(
      parseTagInventoryPersisted({
        revision: 1.5,
        rows: [],
        schemaTagColors: {},
      }),
    );
    assert.isNull(
      parseTagInventoryPersisted({
        revision: -1,
        rows: [],
        schemaTagColors: {},
      }),
    );
  });

  it('returns null when rows or schemaTagColors are invalid', () => {
    assert.isNull(
      parseTagInventoryPersisted({
        revision: 0,
        rows: 'nope',
        schemaTagColors: {},
      }),
    );
    assert.isNull(
      parseTagInventoryPersisted({
        revision: 0,
        rows: [],
        schemaTagColors: [],
      }),
    );
  });

  it('accepts a valid persisted envelope', () => {
    const tagInventory = {
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
    assert.deepEqual(
      parseTagInventoryPersisted({ revision: 2, ...tagInventory }),
      {
        revision: 2,
        tagInventory,
      },
    );
  });

  it('accepts rows with hidden true and omits hidden when false', () => {
    const withHidden = {
      rows: [
        {
          id: '1',
          schemaTag: 't',
          query: 'q',
          annotationIds: ['a'],
          hidden: true,
        },
      ],
      schemaTagColors: {},
    };
    assert.deepEqual(
      parseTagInventoryPersisted({ revision: 0, ...withHidden }),
      {
        revision: 0,
        tagInventory: withHidden,
      },
    );

    const withHiddenFalse = {
      rows: [
        {
          id: '1',
          schemaTag: 't',
          query: 'q',
          annotationIds: ['a'],
          hidden: false,
        },
      ],
      schemaTagColors: {},
    };
    assert.deepEqual(
      parseTagInventoryPersisted({ revision: 1, ...withHiddenFalse }),
      {
        revision: 1,
        tagInventory: {
          rows: [
            {
              id: '1',
              schemaTag: 't',
              query: 'q',
              annotationIds: ['a'],
            },
          ],
          schemaTagColors: {},
        },
      },
    );
  });

  it('returns null when hidden is not a boolean', () => {
    assert.isNull(
      parseTagInventoryPersisted({
        revision: 0,
        rows: [
          {
            id: '1',
            schemaTag: 't',
            query: 'q',
            annotationIds: [],
            hidden: 'yes',
          },
        ],
        schemaTagColors: {},
      }),
    );
  });

  it('round-trips documentUri on Public rows', () => {
    const tagInventory = {
      rows: [
        {
          id: '1',
          schemaTag: 'methods',
          query: 'q',
          annotationIds: [],
          groupId: '__world__',
          documentUri: 'https://example.com/paper.pdf',
        },
      ],
      schemaTagColors: {},
    };
    assert.deepEqual(
      parseTagInventoryPersisted({ revision: 0, ...tagInventory }),
      {
        revision: 0,
        tagInventory,
      },
    );
  });

  it('returns null when documentUri is not a string', () => {
    assert.isNull(
      parseTagInventoryPersisted({
        revision: 0,
        rows: [
          {
            id: '1',
            schemaTag: 't',
            query: 'q',
            annotationIds: [],
            documentUri: 42,
          },
        ],
        schemaTagColors: {},
      }),
    );
  });
});

describe('parseExperimentLogState', () => {
  it('returns null for non-objects or wrong version', () => {
    assert.isNull(parseExperimentLogState(null));
    assert.isNull(parseExperimentLogState({ version: 2, events: [] }));
  });

  it('returns null when events are invalid', () => {
    assert.isNull(parseExperimentLogState({ version: 1, events: {} }));
  });

  it('accepts a valid flat experiment log', () => {
    const log = {
      version: 1,
      events: [
        {
          type: 'search',
          timestamp: '2020-01-01T00:00:00.000Z',
          documentUri: 'http://d',
          searchRowId: 'r',
          query: 'q',
          schemaTag: 't',
          annotationIdsCreated: [],
          quoteTexts: [],
        },
      ],
    };
    assert.deepEqual(parseExperimentLogState(log), log);
  });
});

describe('PersistedTagInventoryService', () => {
  let fakeLocalStorage;
  let store;
  let fakeWindow;
  let fakeToastMessenger;
  /** @type {Record<string, Function[]>} */
  let listeners;

  function triggerStorage(key, newValue) {
    const storageEvent = new StorageEvent('storage', { key, newValue });
    (listeners.storage || []).forEach(fn => fn(storageEvent));
  }

  beforeEach(() => {
    listeners = {};
    fakeToastMessenger = {
      error: sinon.stub(),
      warning: sinon.stub(),
    };
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

    store = createStore([sidebarPanelsModule, framesModule]);

    fakeLocalStorage = {
      getObject: sinon.stub(),
      setObject: sinon.stub(),
      removeItem: sinon.stub(),
    };
  });

  function createService() {
    return new PersistedTagInventoryService(
      fakeLocalStorage,
      store,
      fakeWindow,
      fakeToastMessenger,
    );
  }

  describe('#init', () => {
    it('hydrates from localStorage when data is valid', () => {
      // HYDRATE_TAG_INVENTORY normalizes row ids; use the normalized form.
      const normalizedId = tagInventoryRowId('methods', 'q1', undefined);
      const tagInventory = {
        rows: [
          {
            id: normalizedId,
            schemaTag: 'methods',
            query: 'q1',
            annotationIds: ['a1'],
          },
        ],
        schemaTagColors: { methods: 'rgba(1,2,3,0.38)' },
      };
      const persisted = {
        revision: 4,
        rows: [
          {
            id: 'old-r1',
            schemaTag: 'methods',
            query: 'q1',
            annotationIds: ['a1'],
          },
        ],
        schemaTagColors: { methods: 'rgba(1,2,3,0.38)' },
      };
      fakeLocalStorage.getObject
        .withArgs(TAG_INVENTORY_STORAGE_KEY)
        .returns(persisted);

      createService().init();

      assert.deepEqual(
        store.getState().sidebarPanels.tagInventory,
        tagInventory,
      );
    });

    it('does not hydrate when stored data is invalid', () => {
      fakeLocalStorage.getObject.withArgs(TAG_INVENTORY_STORAGE_KEY).returns({
        revision: 0,
        rows: 'bad',
        schemaTagColors: {},
      });

      createService().init();

      assert.deepEqual(store.getState().sidebarPanels.tagInventory.rows, []);
    });

    it('persists when tagInventory changes after init', async () => {
      fakeLocalStorage.getObject
        .withArgs(TAG_INVENTORY_STORAGE_KEY)
        .returns(null);
      createService().init();

      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q',
        annotationIds: [],
      });

      await Promise.resolve();

      assert.calledWith(fakeLocalStorage.setObject, TAG_INVENTORY_STORAGE_KEY, {
        revision: 1,
        ...store.getState().sidebarPanels.tagInventory,
      });
    });

    it('coalesces rapid tagInventory updates into one persist write', async () => {
      fakeLocalStorage.getObject
        .withArgs(TAG_INVENTORY_STORAGE_KEY)
        .returns(null);
      createService().init();

      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 'a',
        query: 'q1',
        annotationIds: [],
      });
      store.addTagInventoryRow({
        id: 'r2',
        schemaTag: 'b',
        query: 'q2',
        annotationIds: [],
      });

      await Promise.resolve();

      assert.calledOnce(fakeLocalStorage.setObject);
    });

    it('registers a storage listener', () => {
      fakeLocalStorage.getObject.returns(null);
      createService().init();

      assert.calledWith(
        fakeWindow.addEventListener,
        'storage',
        sinon.match.func,
      );
    });

    it('hydrates experiment log from localStorage when data is valid', () => {
      fakeLocalStorage.getObject
        .withArgs(TAG_INVENTORY_STORAGE_KEY)
        .returns(null);
      const expLog = {
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      };
      fakeLocalStorage.getObject
        .withArgs(EXPERIMENT_LOG_STORAGE_KEY)
        .returns(expLog);

      createService().init();

      assert.deepEqual(store.getState().sidebarPanels.experimentLog, expLog);
    });

    it('persists when experimentLog changes after init', () => {
      fakeLocalStorage.getObject.returns(null);
      createService().init();

      const nextLog = {
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      };
      store.setExperimentLog(nextLog);

      assert.calledWith(
        fakeLocalStorage.setObject,
        EXPERIMENT_LOG_STORAGE_KEY,
        nextLog,
      );
    });

    it('surfaces QuotaExceededError when persisting experiment log', () => {
      fakeLocalStorage.getObject.returns(null);
      fakeLocalStorage.setObject.callsFake(key => {
        if (key === EXPERIMENT_LOG_STORAGE_KEY) {
          const err = new Error('Simulated quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
      });

      createService().init();

      store.setExperimentLog({
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      });

      assert.calledWith(
        fakeToastMessenger.error,
        'Could not save the experiment log: storage is full. Download or clear the log.',
      );
    });
  });

  describe('when another tab updates storage', () => {
    it('hydrates from storage event payload', async () => {
      fakeLocalStorage.getObject
        .withArgs(TAG_INVENTORY_STORAGE_KEY)
        .returns(null);

      createService().init();

      const normalizedId = tagInventoryRowId('remote', 'rq', undefined);
      const next = {
        revision: 1,
        rows: [
          { id: 'old-x', schemaTag: 'remote', query: 'rq', annotationIds: [] },
        ],
        schemaTagColors: { remote: 'rgba(9,9,9,0.38)' },
      };

      triggerStorage(TAG_INVENTORY_STORAGE_KEY, JSON.stringify(next));
      await delay(300);

      assert.deepEqual(store.getState().sidebarPanels.tagInventory, {
        rows: [
          {
            id: normalizedId,
            schemaTag: 'remote',
            query: 'rq',
            annotationIds: [],
          },
        ],
        schemaTagColors: { remote: 'rgba(9,9,9,0.38)' },
      });
    });

    it('hydrates experiment log from storage event payload', async () => {
      fakeLocalStorage.getObject.returns(null);

      createService().init();

      const next = {
        version: 1,
        events: [
          {
            type: 'rerun-search',
            timestamp: '2020-01-02T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
          },
        ],
      };

      triggerStorage(EXPERIMENT_LOG_STORAGE_KEY, JSON.stringify(next));
      await delay(300);

      assert.deepEqual(store.getState().sidebarPanels.experimentLog, next);
    });

    it('does not hydrate when payload matches current state', async () => {
      const initial = {
        revision: 0,
        rows: [],
        schemaTagColors: {},
      };
      fakeLocalStorage.getObject.returns(initial);

      createService().init();

      sinon.spy(store, 'hydrateTagInventory');

      triggerStorage(TAG_INVENTORY_STORAGE_KEY, JSON.stringify(initial));
      await delay(300);

      assert.notCalled(store.hydrateTagInventory);
    });

    it('hydrates empty state when key is removed', async () => {
      const persisted = {
        revision: 1,
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

      triggerStorage(TAG_INVENTORY_STORAGE_KEY, null);
      await delay(300);

      assert.deepEqual(store.getState().sidebarPanels.tagInventory, {
        rows: [],
        schemaTagColors: {},
      });
    });

    it('does not hydrate when storage revision is older than local', async () => {
      fakeLocalStorage.getObject
        .withArgs(TAG_INVENTORY_STORAGE_KEY)
        .returns(null);

      createService().init();

      store.addTagInventoryRow({
        id: 'r1',
        schemaTag: 't',
        query: 'q',
        annotationIds: [],
      });

      sinon.spy(store, 'hydrateTagInventory');

      const stale = {
        revision: 0,
        rows: [
          {
            id: 'stale',
            schemaTag: 'x',
            query: 'y',
            annotationIds: [],
          },
        ],
        schemaTagColors: {},
      };

      triggerStorage(TAG_INVENTORY_STORAGE_KEY, JSON.stringify(stale));
      await delay(300);

      assert.notCalled(store.hydrateTagInventory);
      assert.equal(
        store.getState().sidebarPanels.tagInventory.rows[0].id,
        'r1',
      );
    });

    it('hydrates when storage revision is newer than local', async () => {
      fakeLocalStorage.getObject
        .withArgs(TAG_INVENTORY_STORAGE_KEY)
        .returns(null);

      createService().init();

      store.addTagInventoryRow({
        id: tagInventoryRowId('t', 'q', undefined),
        schemaTag: 't',
        query: 'q',
        annotationIds: [],
      });

      const normalizedRemoteId = tagInventoryRowId('a', 'b', undefined);
      const remote = {
        revision: 5,
        rows: [
          {
            id: 'old-remote',
            schemaTag: 'a',
            query: 'b',
            annotationIds: ['z'],
          },
        ],
        schemaTagColors: { a: 'rgba(1,1,1,0.38)' },
      };

      triggerStorage(TAG_INVENTORY_STORAGE_KEY, JSON.stringify(remote));
      await delay(300);

      assert.deepEqual(store.getState().sidebarPanels.tagInventory, {
        rows: [
          {
            id: normalizedRemoteId,
            schemaTag: 'a',
            query: 'b',
            annotationIds: ['z'],
          },
        ],
        schemaTagColors: { a: 'rgba(1,1,1,0.38)' },
      });
    });

    it('hydrates empty experiment log when key is removed', async () => {
      const persisted = {
        version: 1,
        events: [
          {
            type: 'search',
            timestamp: '2020-01-01T00:00:00.000Z',
            documentUri: 'http://d',
            searchRowId: 'r',
            query: 'q',
            schemaTag: 't',
            annotationIdsCreated: [],
            quoteTexts: [],
          },
        ],
      };
      fakeLocalStorage.getObject.callsFake(key => {
        if (key === EXPERIMENT_LOG_STORAGE_KEY) {
          return persisted;
        }
        return null;
      });

      createService().init();

      triggerStorage(EXPERIMENT_LOG_STORAGE_KEY, null);
      await delay(300);

      assert.deepEqual(store.getState().sidebarPanels.experimentLog, {
        version: 1,
        events: [],
      });
    });
  });
});
