import * as fixtures from '../../test/annotation-fixtures';
import {
  buildNodeLinkGraph,
  buildSpotlightGraphLayout,
  buildTagGraphLayout,
  colorForTag,
  distinctTagColors,
  documentLabelFromUrl,
  spotlightNodeLinkGraph,
} from '../graph-model';
import { emptyNodeLinkState, NODE_LINK_STATE_TAG } from '../graph-state';

function annotation(overrides = {}) {
  return {
    ...fixtures.defaultAnnotation(),
    id: 'ann-1',
    group: 'group-a',
    uri: 'http://example.com/doc-one.html',
    document: { title: 'Document One' },
    tags: ['Character'],
    target: [
      {
        source: 'http://example.com/doc-one.html',
        selector: [{ type: 'TextQuoteSelector', exact: 'A quoted sentence.' }],
      },
    ],
    links: { incontext: 'http://example.com/doc-one.html#annotations:ann-1' },
    references: [],
    hidden: false,
    ...overrides,
  };
}

describe('node-link graph model', () => {
  it('uses readable document labels from URLs', () => {
    assert.equal(
      documentLabelFromUrl('http://example.com/little-women-1.html'),
      'little women 1.html',
    );
  });

  it('uses tag inventory colors for node display colors', () => {
    assert.equal(
      colorForTag('Character', { Character: 'rgba(140, 209, 125, 0.38)' }),
      '#8cd17d',
    );
  });

  it('uses nearby light and dark shades for duplicate tag colors', () => {
    const baseColor = 'rgba(80, 160, 96, 0.38)';
    const resolved = distinctTagColors(['Theme', 'Character'], {
      Character: baseColor,
      Theme: baseColor,
    });
    const channelSum = color =>
      color
        .slice(1)
        .match(/.{2}/g)
        .reduce((sum, channel) => sum + parseInt(channel, 16), 0);
    const baseChannelSum = channelSum(
      colorForTag('Character', {
        Character: baseColor,
      }),
    );
    const resolvedChannelSums = Object.values(resolved).map(channelSum);

    assert.notEqual(resolved.Character, resolved.Theme);
    assert.isAbove(Math.max(...resolvedChannelSums), baseChannelSum);
    assert.isBelow(Math.min(...resolvedChannelSums), baseChannelSum);
    assert.deepEqual(
      distinctTagColors(['Character', 'Theme'], {
        Character: baseColor,
        Theme: baseColor,
      }),
      resolved,
    );
  });

  it('builds tags, documents and quote evidence from annotations', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation(),
        annotation({
          id: 'ann-2',
          uri: 'http://example.com/doc-two.html',
          document: { title: 'Document Two' },
          tags: ['Character', 'Action'],
          target: [
            {
              source: 'http://example.com/doc-two.html',
              selector: [
                {
                  type: 'TextQuoteSelector',
                  exact: 'Another quoted sentence.',
                },
              ],
            },
          ],
        }),
      ],
      emptyNodeLinkState(),
    );

    assert.deepEqual(
      graph.tags.map(tag => [tag.tag, tag.quoteCount, tag.documentCount]),
      [
        ['Character', 2, 2],
        ['Action', 1, 1],
      ],
    );
    assert.lengthOf(graph.documents, 2);
    assert.lengthOf(graph.quotes, 2);
  });

  it('filters internal node-link state annotations out of evidence', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation(),
        annotation({
          id: 'state-ann',
          tags: [NODE_LINK_STATE_TAG],
          text: '{"kind":"hypothesis-node-link-state"}',
        }),
      ],
      emptyNodeLinkState(),
    );

    assert.deepEqual(
      graph.tags.map(tag => tag.tag),
      ['Character'],
    );
  });

  it('adds descriptive tags and only visible manual edges', () => {
    const graph = buildNodeLinkGraph(
      [annotation()],
      emptyNodeLinkState({
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            sourceTag: 'Character',
            targetTag: 'Theme',
            connectionType: 'explains',
          },
          {
            sourceTag: 'Character',
            targetTag: 'Missing',
            connectionType: 'points to hidden',
          },
        ],
      }),
    );

    assert.deepEqual(
      graph.tags.map(tag => [tag.tag, tag.descriptive]),
      [
        ['Character', false],
        ['Theme', true],
      ],
    );
    assert.deepEqual(
      graph.manualEdges.map(edge => [
        edge.sourceTag,
        edge.connectionType,
        edge.targetTag,
      ]),
      [['Character', 'explains', 'Theme']],
    );
  });

  it('uses manual tag-tag edges to create a directed layered layout', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation({ tags: ['Character'] }),
        annotation({
          id: 'ann-2',
          tags: ['Action'],
        }),
      ],
      emptyNodeLinkState({
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'motivates',
          },
          {
            sourceTag: 'Action',
            targetTag: 'Theme',
            connectionType: 'supports',
          },
        ],
      }),
    );

    const layout = buildTagGraphLayout(graph);
    const byTag = new Map(layout.nodes.map(node => [node.tag, node]));

    assert.isBelow(byTag.get('Character').x, byTag.get('Action').x);
    assert.isBelow(byTag.get('Action').x, byTag.get('Theme').x);
  });

  it('keeps unlinked tags in the canvas when no manual edge uses them', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation({ tags: ['Character'] }),
        annotation({
          id: 'ann-2',
          tags: ['Setting'],
        }),
      ],
      emptyNodeLinkState({
        descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
        tagEdges: [
          {
            sourceTag: 'Character',
            targetTag: 'Theme',
            connectionType: 'explains',
          },
        ],
      }),
    );

    const layout = buildTagGraphLayout(graph);
    const setting = layout.nodes.find(node => node.tag === 'Setting');

    assert.isOk(setting);
    assert.isAtLeast(setting.x, 94);
    assert.isAtMost(setting.x, layout.width - 94);
    assert.isAtLeast(setting.y, 31);
    assert.isAtMost(setting.y, layout.height - 31);
  });

  it('spotlights only a tag and its directly connected neighborhood', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation({ tags: ['Character'] }),
        annotation({ id: 'ann-2', tags: ['Action'] }),
        annotation({ id: 'ann-3', tags: ['Theme'] }),
        annotation({ id: 'ann-4', tags: ['Setting'] }),
      ],
      emptyNodeLinkState({
        tagEdges: [
          {
            id: 'character-action',
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'motivates',
          },
          {
            id: 'theme-character',
            sourceTag: 'Theme',
            targetTag: 'Character',
            connectionType: 'shapes',
          },
          {
            id: 'action-setting',
            sourceTag: 'Action',
            targetTag: 'Setting',
            connectionType: 'occurs in',
          },
        ],
      }),
    );

    const spotlight = spotlightNodeLinkGraph(graph, 'Character');

    assert.sameMembers(
      spotlight.tags.map(tag => tag.tag),
      ['Character', 'Action', 'Theme'],
    );
    assert.deepEqual(
      spotlight.manualEdges.map(edge => edge.id),
      ['character-action', 'theme-character'],
    );
  });

  it('centers the spotlight tag between incoming and outgoing neighbors', () => {
    const graph = buildNodeLinkGraph(
      [
        annotation({ tags: ['Character'] }),
        annotation({ id: 'ann-2', tags: ['Action'] }),
        annotation({ id: 'ann-3', tags: ['Theme'] }),
      ],
      emptyNodeLinkState({
        tagEdges: [
          {
            sourceTag: 'Theme',
            targetTag: 'Character',
            connectionType: 'shapes',
          },
          {
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'motivates',
          },
        ],
      }),
    );
    const spotlight = spotlightNodeLinkGraph(graph, 'Character');
    const layout = buildSpotlightGraphLayout(spotlight, 'Character');
    const byTag = new Map(layout.nodes.map(node => [node.tag, node]));

    assert.equal(byTag.get('Character').x, layout.width / 2);
    assert.equal(byTag.get('Character').y, layout.height / 2);
    assert.isBelow(byTag.get('Theme').x, byTag.get('Character').x);
    assert.isAbove(byTag.get('Action').x, byTag.get('Character').x);
  });
});
