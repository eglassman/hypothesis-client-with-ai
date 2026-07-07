import sinon from 'sinon';

import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import { FetchError } from '../../util/fetch';
import { tagInventoryRowId } from '../../store/modules/sidebar-panels';
import {
  TagInventoryGroupSyncService,
  savedAnnotationsForCurrentDocument,
} from '../tag-inventory-group-sync';

describe('TagInventoryGroupSyncService', () => {
  let fakeApi;
  let fakeStore;
  let svc;
  let groupAnnotationsRead;

  beforeEach(() => {
    groupAnnotationsRead = sinon.stub().resolves({
      meta: { page: { total: 1 } },
      data: [
        {
          id: 'a1',
          group: 'private-group',
          uri: 'http://other.com',
          tags: ['methods', 'ai-user-approved'],
          text: 'find it',
          created: '2024-01-01T00:00:00Z',
        },
      ],
    });

    fakeApi = {
      search: sinon.stub().resolves({ total: 0, rows: [] }),
      group: {
        annotations: {
          read: groupAnnotationsRead,
        },
      },
    };

    fakeStore = {
      addTagInventoryRow: sinon.stub(),
      setTagInventoryRowAnnotationIds: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([]),
      focusedGroupId: sinon.stub().returns('private-group'),
      hasFetchedAnnotations: sinon.stub().returns(true),
      hasFetchedProfile: sinon.stub().returns(true),
      mainFrame: sinon.stub().returns({ uri: 'http://example.com' }),
      defaultContentFrame: sinon.stub().returns(null),
      pruneTagInventoryRowsForGroup: sinon.stub(),
      savedAnnotations: sinon.stub().returns([]),
      searchUris: sinon.stub().returns(['http://example.com']),
      subscribe: sinon.stub().returns(sinon.stub()),
    };

    svc = new TagInventoryGroupSyncService(fakeApi, fakeStore);
  });

  it('uses savedAnnotations only for Public group document sync', async () => {
    fakeStore.focusedGroupId.returns(PUBLIC_GROUP_ID);
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: PUBLIC_GROUP_ID,
        uri: 'http://example.com',
        tags: ['methods'],
      },
      {
        id: 'a2',
        group: 'other',
        uri: 'http://example.com',
        tags: ['ignored'],
      },
    ]);

    await svc.applyStoreAnnotationsToInventory();

    assert.notCalled(groupAnnotationsRead);
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId(
        'methods',
        '',
        PUBLIC_GROUP_ID,
        'http://example.com',
      ),
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
      documentUri: 'http://example.com',
    });
    assert.calledWith(
      fakeStore.setTagInventoryRowAnnotationIds,
      tagInventoryRowId('methods', '', PUBLIC_GROUP_ID, 'http://example.com'),
      ['a1'],
    );
  });

  it('prefers HTTP(S) over URN when resolving Public documentUri', async () => {
    fakeStore.focusedGroupId.returns(PUBLIC_GROUP_ID);
    fakeStore.mainFrame.returns(null);
    fakeStore.searchUris.returns([]);
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: PUBLIC_GROUP_ID,
        uri: 'https://example.com/paper.pdf',
        tags: ['methods'],
      },
    ]);

    await svc.applyStoreAnnotationsToInventory({
      documentUris: ['urn:x-pdf:abc', 'https://example.com/paper.pdf'],
    });

    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId(
        'methods',
        '',
        PUBLIC_GROUP_ID,
        'https://example.com/paper.pdf',
      ),
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
      documentUri: 'https://example.com/paper.pdf',
    });
    assert.calledWith(
      fakeStore.setTagInventoryRowAnnotationIds,
      tagInventoryRowId(
        'methods',
        '',
        PUBLIC_GROUP_ID,
        'https://example.com/paper.pdf',
      ),
      ['a1'],
    );
  });

  it('re-syncs Public inventory when currentDocumentUri changes', async () => {
    const subscribeCallbacks = [];
    fakeStore.subscribe = cb => {
      subscribeCallbacks.push(cb);
      return () => {};
    };
    fakeStore.focusedGroupId.returns(PUBLIC_GROUP_ID);
    fakeStore.removeTagInventoryRow = sinon.stub();
    fakeStore.tagInventoryRows = sinon.stub().returns([]);
    fakeStore.mainFrame.returns({ uri: 'https://example.com/old.pdf' });
    fakeStore.searchUris.returns(['https://example.com/old.pdf']);
    fakeStore.savedAnnotations.returns([
      {
        id: 'a1',
        group: PUBLIC_GROUP_ID,
        uri: 'https://example.com/new.pdf',
        tags: ['methods'],
      },
    ]);

    svc.init();
    fakeStore.addTagInventoryRow.resetHistory();

    fakeStore.mainFrame.returns({ uri: 'https://example.com/new.pdf' });
    fakeStore.searchUris.returns(['https://example.com/new.pdf']);
    for (const cb of subscribeCallbacks) {
      cb();
    }
    await Promise.resolve();

    assert.called(fakeStore.addTagInventoryRow);
  });

    it('fetches all group annotations via getGroupAnnotations', async () => {
      await svc.getGroupAnnotations('private-group');

      assert.calledOnce(groupAnnotationsRead);
      assert.calledWith(
        groupAnnotationsRead,
        sinon.match({ pubid: 'private-group', 'page[size]': 100 }),
      );

      assert.calledWith(fakeStore.addTagInventoryRow, {
        id: tagInventoryRowId('methods', 'find it', 'private-group'),
        groupId: 'private-group',
        schemaTag: 'methods',
        query: 'find it',
        annotationIds: [],
      });
      assert.calledWith(
        fakeStore.setTagInventoryRowAnnotationIds,
        tagInventoryRowId('methods', 'find it', 'private-group'),
        ['a1'],
      );
      assert.calledOnce(fakeStore.pruneTagInventoryRowsForGroup);
    });

    it('falls back to search when group.annotations returns 404', async () => {
      groupAnnotationsRead.rejects(
        new FetchError(
          'https://hypothes.is/api/groups/private-group/annotations',
          new Response('', { status: 404 }),
          'not authorized',
        ),
      );
      fakeApi.search.resolves({
        total: 1,
        rows: [
          {
            id: 'a1',
            group: 'private-group',
            uri: 'http://other.com',
            tags: ['methods', 'ai-user-approved'],
            text: 'find it',
            created: '2024-01-01T00:00:00Z',
          },
        ],
      });

      await svc.getGroupAnnotations('private-group');

      assert.calledOnce(groupAnnotationsRead);
      assert.calledOnce(fakeApi.search);
      assert.calledWith(
        fakeApi.search,
        sinon.match({
          group: 'private-group',
          limit: 200,
          sort: 'created',
          order: 'desc',
        }),
      );
      assert.calledWith(fakeStore.addTagInventoryRow, {
        id: tagInventoryRowId('methods', 'find it', 'private-group'),
        groupId: 'private-group',
        schemaTag: 'methods',
        query: 'find it',
        annotationIds: [],
      });
    });

  it('sets annotationIds on document-scoped private group sync', async () => {
    await svc.getGroupAnnotations('private-group');
    groupAnnotationsRead.resetHistory();

    fakeStore.savedAnnotations.returns([
      {
        id: 'doc-a1',
        group: 'private-group',
        uri: 'http://example.com',
        tags: ['methods'],
      },
    ]);

    await svc.applyStoreAnnotationsToInventory();

    assert.calledWith(
      fakeStore.setTagInventoryRowAnnotationIds,
      tagInventoryRowId('methods', '', 'private-group'),
      ['doc-a1'],
    );
  });

  it('returns null from cachedGroupAnnotations before a full fetch', () => {
    assert.isNull(svc.cachedGroupAnnotations('private-group'));
  });

  it('caches annotations after getGroupAnnotations', async () => {
    await svc.getGroupAnnotations('private-group');

    const cached = svc.cachedGroupAnnotations('private-group');
    assert.lengthOf(cached, 1);
    assert.equal(cached[0].id, 'a1');
  });

  it('does not populate cache for document-scoped sync', async () => {
    fakeStore.savedAnnotations.returns([
      {
        id: 'doc-a1',
        group: 'private-group',
        uri: 'http://example.com',
        tags: ['methods'],
      },
    ]);

    await svc.applyStoreAnnotationsToInventory();

    assert.isNull(svc.cachedGroupAnnotations('private-group'));
    assert.notCalled(groupAnnotationsRead);
    assert.notCalled(fakeStore.setTagInventoryRowAnnotationIds);
  });

  it('skips document-scoped private sync until group cache is loaded', async () => {
    fakeStore.savedAnnotations.returns([
      {
        id: 'doc-a1',
        group: 'private-group',
        uri: 'http://example.com',
        tags: ['methods'],
      },
    ]);

    await svc.applyStoreAnnotationsToInventory();

    assert.notCalled(fakeStore.setTagInventoryRowAnnotationIds);
    assert.notCalled(fakeStore.addTagInventoryRow);
  });

  it('savedAnnotationsForCurrentDocument filters by group and URIs', () => {
    const result = savedAnnotationsForCurrentDocument(
      [
        { id: '1', group: PUBLIC_GROUP_ID, uri: 'http://a.com', tags: [] },
        { id: '2', group: PUBLIC_GROUP_ID, uri: 'http://b.com', tags: [] },
        { id: '3', group: 'other', uri: 'http://a.com', tags: [] },
      ],
      PUBLIC_GROUP_ID,
      ['http://a.com'],
    );
    assert.lengthOf(result, 1);
    assert.equal(result[0].id, '1');
  });

  it('mergePendingUpdatesIntoCache upserts updates and removes deletions', async () => {
    await svc.getGroupAnnotations('private-group');

    svc.mergePendingUpdatesIntoCache(
      [
        {
          id: 'a2',
          group: 'private-group',
          uri: 'http://new.com',
          tags: ['results'],
          created: '2024-02-01T00:00:00Z',
        },
      ],
      ['a1'],
    );

    const cached = svc.cachedGroupAnnotations('private-group');
    assert.lengthOf(cached, 1);
    assert.equal(cached[0].id, 'a2');
  });

  it('mergePendingUpdatesIntoCache is a no-op before cache is loaded', () => {
    svc.mergePendingUpdatesIntoCache(
      [{ id: 'x', group: 'private-group', uri: 'http://x.com', tags: [] }],
      [],
    );
    assert.isNull(svc.cachedGroupAnnotations('private-group'));
  });

  it('init watch loads group annotations when profile and group become available', async () => {
    const subscribeCallbacks = [];
    fakeStore.subscribe = cb => {
      subscribeCallbacks.push(cb);
      return () => {};
    };
    fakeStore.hasFetchedProfile.returns(false);
    fakeStore.focusedGroupId.returns(null);

    svc.init();

    fakeStore.hasFetchedProfile.returns(true);
    fakeStore.focusedGroupId.returns('private-group');
    for (const cb of subscribeCallbacks) {
      cb();
    }
    await Promise.resolve();
    await Promise.resolve();

    assert.called(groupAnnotationsRead);
    groupAnnotationsRead.resetHistory();

    for (const cb of subscribeCallbacks) {
      cb();
    }
    await Promise.resolve();

    assert.notCalled(groupAnnotationsRead);
  });

  it('paginates with page[after] until a short page is returned', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: `a${i}`,
      group: 'private-group',
      uri: 'http://other.com',
      tags: ['methods'],
      created: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`,
    }));
    groupAnnotationsRead.onFirstCall().resolves({
      meta: { page: { total: 101 } },
      data: fullPage,
    });
    groupAnnotationsRead.onSecondCall().resolves({
      meta: { page: { total: 101 } },
      data: [
        {
          id: 'last',
          group: 'private-group',
          uri: 'http://other.com',
          tags: ['results'],
          created: '2024-01-02T00:00:00Z',
        },
      ],
    });

    await svc.getGroupAnnotations('private-group');

    assert.calledTwice(groupAnnotationsRead);
    assert.calledWith(
      groupAnnotationsRead.secondCall,
      sinon.match({
        pubid: 'private-group',
        'page[size]': 100,
        'page[after]': fullPage[99].created,
      }),
    );
  });

  describe('getGroupAnnotations', () => {
    it('returns cached annotations without calling the API again', async () => {
      await svc.getGroupAnnotations('private-group');
      groupAnnotationsRead.resetHistory();

      const result = await svc.getGroupAnnotations('private-group');

      assert.notCalled(groupAnnotationsRead);
      assert.lengthOf(result, 1);
      assert.equal(result[0].id, 'a1');
    });

    it('deduplicates concurrent fetches for the same group', async () => {
      let resolveFetch;
      groupAnnotationsRead.returns(
        new Promise(resolve => {
          resolveFetch = resolve;
        }),
      );

      const first = svc.getGroupAnnotations('private-group');
      const second = svc.getGroupAnnotations('private-group');

      resolveFetch({
        meta: {},
        data: [
          {
            id: 'a1',
            group: 'private-group',
            uri: 'http://other.com',
            tags: ['methods'],
            created: '2024-01-01T00:00:00Z',
          },
        ],
      });

      await Promise.all([first, second]);

      assert.calledOnce(groupAnnotationsRead);
    });

    it('propagates API errors', async () => {
      const err = new Error('group annotations unavailable');
      groupAnnotationsRead.rejects(err);

      await assert.rejects(
        svc.getGroupAnnotations('private-group'),
        'group annotations unavailable',
      );
      assert.isNull(svc.cachedGroupAnnotations('private-group'));
    });

    it('re-fetches from the API when force is true and no fetch is in flight', async () => {
      await svc.getGroupAnnotations('private-group');
      groupAnnotationsRead.resetHistory();

      await svc.getGroupAnnotations('private-group', { force: true });

      assert.calledOnce(groupAnnotationsRead);
    });

    it('joins an in-flight fetch rather than restarting when force is true', async () => {
      let resolveFetch;
      groupAnnotationsRead.returns(
        new Promise(resolve => {
          resolveFetch = resolve;
        }),
      );

      const first = svc.getGroupAnnotations('private-group');
      const forced = svc.getGroupAnnotations('private-group', { force: true });

      resolveFetch({ meta: {}, data: [] });
      await Promise.all([first, forced]);

      assert.calledOnce(groupAnnotationsRead);
    });
  });
});
