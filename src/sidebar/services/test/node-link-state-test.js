import sinon from 'sinon';

import {
  NODE_LINK_STATE_KIND,
  NODE_LINK_STATE_SCHEMA_VERSION,
  NODE_LINK_STATE_TAG,
  NODE_LINK_STATE_VERSION_TAG,
  nodeLinkStateUri,
} from '../../node-link/graph-state';
import * as fixtures from '../../test/annotation-fixtures';
import { NodeLinkStateService } from '../node-link-state';

describe('NodeLinkStateService', () => {
  let fakeApi;
  let service;

  function statePayload(overrides = {}) {
    return {
      kind: NODE_LINK_STATE_KIND,
      schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
      groupId: 'group-a',
      stateUri: nodeLinkStateUri('group-a'),
      updatedAt: '2026-07-01T12:00:00.000Z',
      edits: {
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            id: 'edge-character-theme',
            sourceTag: 'Character',
            targetTag: 'Theme',
            connectionType: 'explains',
          },
        ],
      },
      ...overrides,
    };
  }

  function stateAnnotation(overrides = {}) {
    return {
      ...fixtures.defaultAnnotation(),
      id: 'state-annotation',
      group: 'group-a',
      uri: nodeLinkStateUri('group-a'),
      tags: [NODE_LINK_STATE_TAG, NODE_LINK_STATE_VERSION_TAG],
      text: JSON.stringify(statePayload()),
      updated: '2026-07-01T12:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    fakeApi = {
      annotation: {
        create: sinon.stub().resolves({
          id: 'created-state',
          updated: '2026-07-01T14:00:00.000Z',
        }),
        update: sinon.stub().resolves({
          id: 'updated-state',
          updated: '2026-07-01T14:00:00.000Z',
        }),
      },
      group: {
        annotations: {
          read: sinon.stub().resolves({ data: [] }),
        },
      },
      profile: {
        read: sinon.stub().resolves({ userid: 'acct:user@hypothes.is' }),
      },
      search: sinon.stub().resolves({ rows: [] }),
    };
    service = new NodeLinkStateService(fakeApi);
  });

  it('searches the selected group state URI', async () => {
    await service.loadState('group-a');

    assert.calledWith(
      fakeApi.search,
      sinon.match({
        group: 'group-a',
        uri: nodeLinkStateUri('group-a'),
        tag: NODE_LINK_STATE_TAG,
        limit: 10,
        sort: 'updated',
        order: 'desc',
      }),
    );
  });

  it('returns missing state when the group has not saved node-link state', async () => {
    const result = await service.loadState('group-a');

    assert.equal(result.status, 'missing');
    assert.equal(result.annotationId, null);
    assert.equal(result.state.selectedGroupId, 'group-a');
    assert.deepEqual(result.state.tagEdges, []);
  });

  it('loads the newest matching state annotation', async () => {
    fakeApi.search.resolves({
      rows: [
        {
          ...fixtures.defaultAnnotation(),
          id: 'normal-annotation',
          group: 'group-a',
          tags: ['Character'],
          text: 'not node-link state',
        },
        stateAnnotation({
          id: 'old-state',
          updated: '2026-07-01T10:00:00.000Z',
          text: JSON.stringify(
            statePayload({
              edits: {
                descriptiveTags: [{ id: 'desc-old', tag: 'Old theme' }],
                tagEdges: [],
              },
            }),
          ),
        }),
        stateAnnotation({
          id: 'new-state',
          updated: '2026-07-01T13:00:00.000Z',
        }),
      ],
    });

    const result = await service.loadState('group-a');

    assert.equal(result.status, 'loaded');
    assert.equal(result.annotationId, 'new-state');
    assert.deepEqual(
      result.state.descriptiveTags.map(tag => tag.tag),
      ['Theme'],
    );
    assert.deepEqual(
      result.state.tagEdges.map(edge => [
        edge.sourceTag,
        edge.connectionType,
        edge.targetTag,
      ]),
      [['Character', 'explains', 'Theme']],
    );
  });

  it('reports invalid state annotations without throwing', async () => {
    fakeApi.search.resolves({
      rows: [stateAnnotation({ text: 'not json' })],
    });

    const result = await service.loadState('group-a');

    assert.equal(result.status, 'invalid');
    assert.equal(result.annotationId, 'state-annotation');
    assert.equal(result.state.selectedGroupId, 'group-a');
    assert.match(result.message, /Unexpected token|JSON/);
  });

  it('fetches all group annotations and filters node-link state annotations', async () => {
    fakeApi.group.annotations.read.onFirstCall().resolves({
      data: [
        {
          ...fixtures.defaultAnnotation(),
          id: 'ann-1',
          group: 'group-a',
          tags: ['Character'],
          created: '2026-07-01T13:00:00.000Z',
        },
        stateAnnotation({
          id: 'state-ann',
          created: '2026-07-01T12:00:00.000Z',
        }),
      ],
    });

    const annotations = await service.fetchGroupAnnotations('group-a');

    assert.calledWith(
      fakeApi.group.annotations.read,
      sinon.match({
        pubid: 'group-a',
        'page[size]': 100,
      }),
    );
    assert.deepEqual(
      annotations.map(ann => ann.id),
      ['ann-1'],
    );
  });

  it('fetches Public-group annotations with search instead of the group annotations endpoint', async () => {
    fakeApi.search.resolves({
      rows: [
        {
          ...fixtures.defaultAnnotation(),
          id: 'public-ann',
          group: '__world__',
          uri: 'https://example.com/doc',
          tags: ['Character'],
        },
        stateAnnotation({
          id: 'state-ann',
          group: '__world__',
          uri: nodeLinkStateUri('__world__'),
        }),
      ],
      total: 2,
    });

    const annotations = await service.fetchGroupAnnotations(
      '__world__',
      undefined,
      { uri: 'https://example.com/doc' },
    );

    assert.calledWith(
      fakeApi.search,
      sinon.match({
        group: '__world__',
        uri: 'https://example.com/doc',
        limit: 100,
        offset: 0,
      }),
    );
    assert.notCalled(fakeApi.group.annotations.read);
    assert.deepEqual(
      annotations.map(ann => ann.id),
      ['public-ann'],
    );
  });

  it('does not fetch Public-group annotations without a document URI', async () => {
    const annotations = await service.fetchGroupAnnotations('__world__');

    assert.deepEqual(annotations, []);
    assert.notCalled(fakeApi.search);
    assert.notCalled(fakeApi.group.annotations.read);
  });

  it('creates a Hypothesis state annotation when none exists', async () => {
    const state = statePayload({
      edits: {
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            sourceTag: 'Character',
            targetTag: 'Theme',
            connectionType: 'explains',
          },
        ],
      },
    });

    const result = await service.saveState('group-a', {
      ...statePayload().edits,
      schemaVersion: 1,
      updatedAt: null,
      selectedGroupId: 'group-a',
      descriptiveTags: state.edits.descriptiveTags,
      tagEdges: state.edits.tagEdges,
    });

    assert.calledOnce(fakeApi.annotation.create);
    const body = fakeApi.annotation.create.firstCall.args[1];
    assert.equal(body.group, 'group-a');
    assert.equal(body.uri, nodeLinkStateUri('group-a'));
    assert.deepEqual(body.tags, [
      NODE_LINK_STATE_TAG,
      NODE_LINK_STATE_VERSION_TAG,
    ]);
    assert.deepEqual(body.permissions, {
      read: ['group:group-a'],
      update: ['acct:user@hypothes.is'],
      delete: ['acct:user@hypothes.is'],
    });
    assert.include(body.text, '"hypothesis-node-link-state"');
    assert.equal(result.annotationId, 'created-state');
  });

  it('updates an existing Hypothesis state annotation', async () => {
    fakeApi.search.resolves({ rows: [stateAnnotation({ id: 'existing' })] });

    await service.saveState(
      'group-a',
      {
        schemaVersion: 1,
        updatedAt: null,
        selectedGroupId: 'group-a',
        descriptiveTags: [],
        tagEdges: [],
      },
      { groupName: 'Test Group' },
    );

    assert.calledOnce(fakeApi.annotation.update);
    assert.calledWith(fakeApi.annotation.update, { id: 'existing' });
    const body = fakeApi.annotation.update.firstCall.args[1];
    assert.deepEqual(body.document, {
      title: 'Node Link state for Test Group',
    });
    assert.notCalled(fakeApi.annotation.create);
  });
});
