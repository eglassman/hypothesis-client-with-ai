import sinon from 'sinon';

import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import {
  applyDerivedTagInventoryRows,
  backfillPublicTagInventoryDocumentUris,
} from '../tag-inventory-reconcile';
import { tagInventoryRowId } from '../../store/modules/sidebar-panels';

const docUri = 'http://example.com';

function fakeReconcileStore(overrides = {}) {
  return {
    addTagInventoryRow: sinon.stub(),
    setTagInventoryRowAnnotationIds: sinon.stub(),
    tagInventoryRows: sinon.stub().returns([]),
    ...overrides,
  };
}

describe('applyDerivedTagInventoryRows', () => {
  it('adds rows for schema tags found in annotations', () => {
    const fakeStore = fakeReconcileStore();

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      documentUri: docUri,
      annotations: [
        { id: 'a1', group: 'group-a', uri: docUri, tags: ['methods'] },
        { id: 'a2', group: 'group-a', uri: docUri, tags: ['results'] },
      ],
    });

    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', '', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('results', '', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'results',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(
      fakeStore.setTagInventoryRowAnnotationIds,
      tagInventoryRowId('methods', '', 'group-a'),
      ['a1'],
    );
    assert.calledWith(
      fakeStore.setTagInventoryRowAnnotationIds,
      tagInventoryRowId('results', '', 'group-a'),
      ['a2'],
    );
  });

  it('uses query text from ai-user-approved annotations', () => {
    const fakeStore = fakeReconcileStore();

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      documentUri: docUri,
      annotations: [
        {
          id: 'a1',
          group: 'group-a',
          uri: docUri,
          tags: ['methods', 'ai-user-approved'],
          text: '  find methods  ',
        },
      ],
    });

    const rowId = tagInventoryRowId('methods', 'find methods', 'group-a');
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: rowId,
      groupId: 'group-a',
      schemaTag: 'methods',
      query: 'find methods',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.setTagInventoryRowAnnotationIds, rowId, ['a1']);
  });

  it('generates rows for ai-pending schema tags and manual tags', () => {
    const fakeStore = fakeReconcileStore();

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      documentUri: docUri,
      annotations: [
        {
          id: 'a3',
          group: 'group-a',
          uri: docUri,
          tags: ['methods', 'ai-pending'],
        },
        {
          id: 'a4',
          group: 'group-a',
          uri: docUri,
          tags: ['results'],
        },
      ],
    });

    assert.calledTwice(fakeStore.addTagInventoryRow);
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', '', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'methods',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('results', '', 'group-a'),
      groupId: 'group-a',
      schemaTag: 'results',
      query: '',
      annotationIds: [],
    });
    assert.calledWith(
      fakeStore.setTagInventoryRowAnnotationIds,
      tagInventoryRowId('methods', '', 'group-a'),
      ['a3'],
    );
    assert.calledWith(
      fakeStore.setTagInventoryRowAnnotationIds,
      tagInventoryRowId('results', '', 'group-a'),
      ['a4'],
    );
  });

  it('stores documentUri on Public group rows and includes it in the row id', () => {
    const fakeStore = fakeReconcileStore();

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: PUBLIC_GROUP_ID,
      documentUri: docUri,
      annotations: [
        {
          id: 'a1',
          group: PUBLIC_GROUP_ID,
          uri: docUri,
          tags: ['methods', 'ai-user-approved'],
          text: 'q1',
        },
      ],
    });

    const rowId = tagInventoryRowId('methods', 'q1', PUBLIC_GROUP_ID, docUri);
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: rowId,
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: 'q1',
      annotationIds: [],
      documentUri: docUri,
    });
    assert.calledWith(fakeStore.setTagInventoryRowAnnotationIds, rowId, ['a1']);
  });

  it('does not set documentUri on private group rows', () => {
    const fakeStore = fakeReconcileStore();

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      documentUri: docUri,
      annotations: [
        {
          id: 'a1',
          group: 'group-a',
          uri: docUri,
          tags: ['methods', 'ai-user-approved'],
          text: 'q1',
        },
      ],
    });

    const call = fakeStore.addTagInventoryRow.firstCall.args[0];
    assert.equal(call.id, tagInventoryRowId('methods', 'q1', 'group-a'));
    assert.isUndefined(call.documentUri);
  });

  it('clears stale annotationIds on in-scope rows with no matching descriptor', () => {
    const staleRowId = tagInventoryRowId('orphan', 'old q', 'group-a');
    const fakeStore = fakeReconcileStore({
      tagInventoryRows: sinon.stub().returns([
        {
          id: staleRowId,
          groupId: 'group-a',
          schemaTag: 'orphan',
          query: 'old q',
          annotationIds: ['stale-id'],
        },
      ]),
    });

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      documentUri: docUri,
      annotations: [
        { id: 'a1', group: 'group-a', uri: docUri, tags: ['methods'] },
      ],
    });

    assert.calledWith(fakeStore.setTagInventoryRowAnnotationIds, staleRowId, []);
  });

  it('is a no-op for Public group when documentUri is missing', () => {
    const fakeStore = fakeReconcileStore();

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: PUBLIC_GROUP_ID,
      annotations: [
        { id: 'a1', group: PUBLIC_GROUP_ID, uri: docUri, tags: ['methods'] },
      ],
    });

    assert.notCalled(fakeStore.addTagInventoryRow);
    assert.notCalled(fakeStore.setTagInventoryRowAnnotationIds);
  });

  it('creates rows for private group without documentUri', () => {
    const fakeStore = fakeReconcileStore();

    applyDerivedTagInventoryRows(fakeStore, {
      groupId: 'group-a',
      annotations: [
        { id: 'a1', group: 'group-a', uri: docUri, tags: ['methods'] },
      ],
    });

    assert.calledOnce(fakeStore.addTagInventoryRow);
    assert.calledOnce(fakeStore.setTagInventoryRowAnnotationIds);
  });
});

describe('backfillPublicTagInventoryDocumentUris', () => {
  it('assigns documentUri and re-keys legacy Public rows', () => {
    const legacyId = tagInventoryRowId('methods', 'q', PUBLIC_GROUP_ID);
    const fakeStore = {
      addTagInventoryRow: sinon.stub(),
      removeTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([
        {
          id: legacyId,
          groupId: PUBLIC_GROUP_ID,
          schemaTag: 'methods',
          query: 'q',
          annotationIds: ['a1'],
        },
      ]),
      mainFrame: sinon.stub().returns({ uri: 'https://example.com/paper.pdf' }),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon.stub().returns(['https://example.com/paper.pdf']),
    };

    backfillPublicTagInventoryDocumentUris(fakeStore);

    const documentUri = 'https://example.com/paper.pdf';
    assert.calledWith(fakeStore.addTagInventoryRow, {
      id: tagInventoryRowId('methods', 'q', PUBLIC_GROUP_ID, documentUri),
      groupId: PUBLIC_GROUP_ID,
      schemaTag: 'methods',
      query: 'q',
      annotationIds: ['a1'],
      documentUri,
    });
    assert.calledWith(fakeStore.removeTagInventoryRow, legacyId);
  });

  it('is a no-op when document URI is unknown', () => {
    const fakeStore = {
      addTagInventoryRow: sinon.stub(),
      removeTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([
        {
          id: 'legacy',
          groupId: PUBLIC_GROUP_ID,
          schemaTag: 'methods',
          query: 'q',
          annotationIds: [],
        },
      ]),
      mainFrame: sinon.stub().returns(null),
      defaultContentFrame: sinon.stub().returns(null),
      searchUris: sinon.stub().returns([]),
    };

    backfillPublicTagInventoryDocumentUris(fakeStore);

    assert.notCalled(fakeStore.addTagInventoryRow);
    assert.notCalled(fakeStore.removeTagInventoryRow);
  });
});
