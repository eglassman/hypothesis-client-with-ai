import { mount } from '@hypothesis/frontend-testing';

import { TagOverviewViewport } from '../TagOverviewViewport';

function tagNode(tag) {
  return {
    id: `tag:${tag}`,
    tag,
    quoteCount: 1,
    documentCount: 1,
    documentUris: ['https://example.com/doc'],
    descriptive: false,
  };
}

function quote({ id, tag, documentLabel, documentUri }) {
  return {
    id,
    annotation: { id },
    quote: `Quote ${id}`,
    tags: [tag],
    documentLabel,
    documentUri,
    sourceUrl: `${documentUri}#annotations:${id}`,
  };
}

function createComponent({
  graph: graphOverrides = {},
  spotlightTag = '',
} = {}) {
  const graph = {
    tags: ['Theme', 'Character', 'Action'].map(tagNode),
    quotes: [
      quote({
        id: 'character-b',
        tag: 'Character',
        documentLabel: 'Document B',
        documentUri: 'https://example.com/b',
      }),
      quote({
        id: 'character-a',
        tag: 'Character',
        documentLabel: 'Document A',
        documentUri: 'https://example.com/a',
      }),
    ],
    documents: [],
    manualEdges: [
      {
        id: 'character-theme',
        sourceTag: 'Character',
        targetTag: 'Theme',
        connectionType: 'shapes',
      },
      {
        id: 'character-action',
        sourceTag: 'Character',
        targetTag: 'Action',
        connectionType: 'motivates',
      },
      {
        id: 'action-character',
        sourceTag: 'Action',
        targetTag: 'Character',
        connectionType: 'supports',
      },
    ],
    annotationCount: 0,
    ...graphOverrides,
  };
  return mount(
    <TagOverviewViewport
      graph={graph}
      spotlightTag={spotlightTag}
      tagColors={{}}
    />,
  );
}

describe('TagOverviewViewport', () => {
  it('shows one alphabetical row per tag with relationships sorted by Tag B', () => {
    const wrapper = createComponent();
    const rows = wrapper.find('tbody tr');
    const characterRow = wrapper.find('tr[data-tag="Character"]');
    const relationships = characterRow.find(
      '[data-testid="tag-overview-relationships"] li',
    );

    assert.deepEqual(
      rows.map(row => row.prop('data-tag')),
      ['Action', 'Character', 'Theme'],
    );
    assert.include(relationships.at(0).text(), 'Action');
    assert.include(relationships.at(1).text(), 'supports');
    assert.include(relationships.at(2).text(), 'Theme');
    assert.equal(
      wrapper.find('[data-testid="tag-overview-summary"]').first().text(),
      'AI generated summary here',
    );
  });

  it('groups quotes by document in alphabetical collapsible sections', () => {
    const wrapper = createComponent();
    const characterRow = wrapper.find('tr[data-tag="Character"]');

    assert.deepEqual(
      characterRow.find('details summary').map(summary => summary.text()),
      ['Document A1 quote', 'Document B1 quote'],
    );
  });

  it('previews large document groups before offering all quotes', () => {
    const quotes = Array.from({ length: 8 }, (_, index) =>
      quote({
        id: `character-${index}`,
        tag: 'Character',
        documentLabel: 'Document A',
        documentUri: 'https://example.com/a',
      }),
    );
    const wrapper = createComponent({ graph: { quotes } });
    const characterRow = wrapper.find('tr[data-tag="Character"]');

    assert.lengthOf(characterRow.find('blockquote'), 6);

    characterRow
      .find('button')
      .filterWhere(button => button.text() === 'Show 2 more')
      .props()
      .onClick();
    wrapper.update();

    assert.lengthOf(wrapper.find('tr[data-tag="Character"] blockquote'), 8);
  });

  it('respects the selected spotlight neighborhood', () => {
    const wrapper = createComponent({
      graph: {
        tags: ['Theme', 'Setting', 'Character', 'Action'].map(tagNode),
      },
      spotlightTag: 'Character',
    });

    assert.deepEqual(
      wrapper.find('tbody tr').map(row => row.prop('data-tag')),
      ['Action', 'Character', 'Theme'],
    );
  });
});
