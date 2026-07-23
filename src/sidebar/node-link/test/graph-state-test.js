import {
  NODE_LINK_STATE_KIND,
  NODE_LINK_STATE_SCHEMA_VERSION,
  NODE_LINK_STATE_TAG,
  NODE_LINK_STATE_TAGS,
  NODE_LINK_STATE_VERSION_TAG,
  contentTags,
  createNodeLinkStatePayload,
  emptyNodeLinkState,
  isNodeLinkStateAnnotation,
  parseNodeLinkStateText,
  relationshipsForTag,
  serializeNodeLinkState,
  stateFromNodeLinkPayload,
  tagLegendText,
  tagReferenceForNodeLinkState,
  tagsForNodeLinkState,
} from '../graph-state';

describe('node-link graph state helpers', () => {
  function statePayload(overrides = {}) {
    return {
      kind: NODE_LINK_STATE_KIND,
      schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
      groupId: 'group-a',
      stateUri: 'https://hypothesis-node-link.local/state/group/group-a',
      updatedAt: '2026-07-01T12:00:00.000Z',
      edits: {
        descriptiveTags: [],
        tagEdges: [],
        tagSummaries: [],
      },
      ...overrides,
    };
  }

  it('parses fenced JSON state annotations', () => {
    const payload = statePayload();
    const parsed = parseNodeLinkStateText(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
    );

    assert.deepEqual(parsed, payload);
  });

  it('rejects unsupported payloads', () => {
    assert.throws(
      () => parseNodeLinkStateText(JSON.stringify({ kind: 'other' })),
      /supported node-link state payload/,
    );
  });

  it('normalizes only the semantic state needed by the extension', () => {
    const state = stateFromNodeLinkPayload(
      statePayload({
        edits: {
          descriptiveTags: [
            { id: 'desc-1', tag: 'Theme' },
            { id: 'desc-duplicate', tag: 'Theme' },
            { id: 'desc-empty', tag: '' },
          ],
          tagEdges: [
            {
              id: 'edge-1',
              sourceTag: 'Character',
              targetTag: 'Theme',
              connectionType: 'explains',
            },
            {
              id: 'edge-duplicate',
              sourceTag: 'Character',
              targetTag: 'Theme',
              connectionType: 'duplicates',
            },
            {
              id: 'edge-invalid',
              sourceTag: '',
              targetTag: 'Theme',
              connectionType: 'ignored',
            },
          ],
          tagSummaries: [
            {
              tag: 'Character',
              summary: 'Line one.\nLine two.',
              generatedAt: '2026-07-01T11:00:00.000Z',
              sourceFingerprint: 'v1:abc12345',
              model: 'claude-test',
            },
            {
              tag: 'Character',
              summary: 'Duplicate ignored.',
              generatedAt: '2026-07-01T12:00:00.000Z',
              sourceFingerprint: 'v1:duplicate',
            },
            { tag: 'Theme', summary: '', generatedAt: '' },
          ],
          layout: { Character: { x: 1, y: 2 } },
          annotations: [{ id: 'already-in-hypothesis' }],
        },
      }),
    );

    assert.deepEqual(
      state.descriptiveTags.map(tag => tag.tag),
      ['Theme'],
    );
    assert.deepEqual(state.tagEdges, [
      {
        id: 'edge-1',
        sourceTag: 'Character',
        targetTag: 'Theme',
        connectionType: 'explains',
        label: 'explains',
        createdBy: 'human',
        createdFrom: 'manual',
      },
    ]);
    assert.deepEqual(state.tagSummaries, [
      {
        tag: 'Character',
        summary: 'Line one.\nLine two.',
        generatedAt: '2026-07-01T11:00:00.000Z',
        sourceFingerprint: 'v1:abc12345',
        model: 'claude-test',
      },
    ]);
    assert.notProperty(state, 'layout');
    assert.notProperty(state, 'annotations');
  });

  it('creates a portable Hypothesis state payload without layout or annotations', () => {
    const state = emptyNodeLinkState({
      selectedGroupId: 'group-a',
      descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
      tagEdges: [
        {
          sourceTag: 'Character',
          targetTag: 'Theme',
          connectionType: 'explains',
        },
      ],
      tagSummaries: [
        {
          tag: 'Character',
          summary: 'Line one.\nLine two.',
          generatedAt: '2026-07-01T11:00:00.000Z',
          sourceFingerprint: 'v1:abc12345',
        },
      ],
    });

    const payload = createNodeLinkStatePayload(state, {
      groupId: 'group-a',
      stateUri: 'https://hypothesis-node-link.local/state/group/group-a',
      updatedAt: '2026-07-01T12:00:00.000Z',
    });

    assert.equal(payload.kind, NODE_LINK_STATE_KIND);
    assert.equal(payload.schemaVersion, NODE_LINK_STATE_SCHEMA_VERSION);
    assert.equal(payload.groupId, 'group-a');
    assert.deepEqual(payload.edits.descriptiveTags, [
      {
        id: 'desc-theme',
        tag: 'Theme',
        createdBy: 'human',
      },
    ]);
    assert.deepEqual(payload.edits.tagEdges, [
      {
        sourceTag: 'Character',
        targetTag: 'Theme',
        connectionType: 'explains',
        label: 'explains',
        createdBy: 'human',
        createdFrom: 'manual',
      },
    ]);
    assert.deepEqual(payload.edits.tagSummaries, [
      {
        tag: 'Character',
        summary: 'Line one.\nLine two.',
        generatedAt: '2026-07-01T11:00:00.000Z',
        sourceFingerprint: 'v1:abc12345',
      },
    ]);
    assert.notProperty(payload.edits, 'layout');
    assert.notProperty(payload.edits, 'annotations');
    assert.deepEqual(NODE_LINK_STATE_TAGS, [
      NODE_LINK_STATE_TAG,
      NODE_LINK_STATE_VERSION_TAG,
    ]);
    assert.include(serializeNodeLinkState(payload), '"descriptiveTags"');
  });

  it('identifies node-link state annotations', () => {
    assert.isTrue(
      isNodeLinkStateAnnotation({
        tags: [NODE_LINK_STATE_VERSION_TAG],
        text: '',
      }),
    );
    assert.isTrue(
      isNodeLinkStateAnnotation({
        tags: [NODE_LINK_STATE_TAG],
        text: '',
      }),
    );
    assert.isFalse(
      isNodeLinkStateAnnotation({ tags: ['Character'], text: '' }),
    );
  });

  it('filters system tags from content tags', () => {
    assert.deepEqual(
      contentTags(['Character', 'ai-pending', 'Character', ' ', 'Theme']),
      ['Character', 'Theme'],
    );
  });

  it('combines annotation tags, descriptive tags and edge endpoints', () => {
    const state = emptyNodeLinkState({
      descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
      tagEdges: [
        {
          sourceTag: 'Character',
          targetTag: 'Theme',
          connectionType: 'explains',
        },
        {
          sourceTag: 'Method',
          targetTag: 'Theme',
          connectionType: 'supports',
        },
      ],
    });

    const tags = tagsForNodeLinkState(
      state,
      [
        { group: 'group-a', tags: ['Character', 'ai-user-approved'] },
        { group: 'group-b', tags: ['Other document only'] },
      ],
      'group-a',
    );

    assert.deepEqual(tags, ['Character', 'Method', 'Theme']);
  });

  it('returns outgoing relationships before incoming relationship details', () => {
    const state = emptyNodeLinkState({
      tagEdges: [
        {
          sourceTag: 'Character',
          targetTag: 'Theme',
          connectionType: 'explains',
        },
        {
          sourceTag: 'Action',
          targetTag: 'Character',
          connectionType: 'reveals',
        },
      ],
    });

    assert.deepEqual(relationshipsForTag(state, 'Character'), {
      outgoing: [
        {
          sourceTag: 'Character',
          targetTag: 'Theme',
          connectionType: 'explains',
          label: 'explains',
          createdBy: 'human',
          createdFrom: 'manual',
        },
      ],
      incoming: [
        {
          sourceTag: 'Action',
          targetTag: 'Character',
          connectionType: 'reveals',
          label: 'reveals',
          createdBy: 'human',
          createdFrom: 'manual',
        },
      ],
    });
  });

  it('builds prompt-ready tag reference data for relationship-linked tags', () => {
    const state = emptyNodeLinkState({
      descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
      tagEdges: [
        {
          sourceTag: 'Character',
          targetTag: 'Theme',
          connectionType: 'explains',
        },
        {
          sourceTag: 'Action',
          targetTag: 'Character',
          connectionType: 'reveals',
        },
      ],
    });

    const reference = tagReferenceForNodeLinkState(
      state,
      [
        { group: 'group-a', tags: ['Character', 'Character'] },
        { group: 'group-a', tags: ['Theme', 'ai-pending'] },
        { group: 'group-a', tags: ['QuoteOnly'] },
        { group: 'group-b', tags: ['Other'] },
      ],
      'group-a',
    );

    assert.deepEqual(reference, [
      {
        tag: 'Action',
        annotationCount: 0,
        descriptive: false,
        outgoingRelationships: [
          { relationship: 'reveals', targetTag: 'Character' },
        ],
        incomingRelationships: [],
      },
      {
        tag: 'Character',
        annotationCount: 1,
        descriptive: false,
        outgoingRelationships: [
          { relationship: 'explains', targetTag: 'Theme' },
        ],
        incomingRelationships: [
          { sourceTag: 'Action', relationship: 'reveals' },
        ],
      },
      {
        tag: 'Theme',
        annotationCount: 1,
        descriptive: true,
        outgoingRelationships: [],
        incomingRelationships: [
          { sourceTag: 'Character', relationship: 'explains' },
        ],
      },
    ]);
  });

  it('exports a readable legend for manual tag-tag relationships', () => {
    const legend = tagLegendText(
      emptyNodeLinkState({
        tagEdges: [
          {
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'explains',
          },
          {
            sourceTag: 'Theme',
            targetTag: 'Character',
            connectionType: 'frames',
          },
        ],
      }),
    );

    assert.equal(
      legend,
      [
        'Action',
        '   --- incoming relationships ---',
        '   Character explains Action',
        'Character',
        '   explains Action',
        '   --- incoming relationships ---',
        '   Theme frames Character',
        'Theme',
        '   frames Character',
        '',
      ].join('\n'),
    );
  });
});
