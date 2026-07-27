import { mount } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

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
  apiKey = 'test-key',
  summaryStatusByTag = new Map(),
  generatingTag = '',
  bulkProgress = null,
  onGenerateTag = sinon.stub(),
  onGenerateAll = sinon.stub(),
  onStopGeneration = sinon.stub(),
  onApiKeyChange = sinon.stub(),
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
      apiKey={apiKey}
      summaryStatusByTag={summaryStatusByTag}
      errorsByTag={{}}
      generatingTag={generatingTag}
      bulkProgress={bulkProgress}
      bulkTargetCount={graph.tags.length}
      onApiKeyChange={onApiKeyChange}
      onGenerateTag={onGenerateTag}
      onGenerateAll={onGenerateAll}
      onStopGeneration={onStopGeneration}
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
      'No AI summary yet.Generate now',
    );
  });

  it('generates one tag from the summary cell', () => {
    const onGenerateTag = sinon.stub();
    const wrapper = createComponent({ onGenerateTag });
    const characterRow = wrapper.find('tr[data-tag="Character"]');

    characterRow
      .find('button')
      .filterWhere(button => button.text() === 'Generate now')
      .props()
      .onClick();

    assert.calledWith(onGenerateTag, 'Character');
  });

  it('requests a shared Claude key when none is configured', () => {
    const onApiKeyChange = sinon.stub();
    const wrapper = createComponent({ apiKey: '', onApiKeyChange });
    const input = wrapper.find('[data-testid="tag-summary-api-key"]');

    assert.isTrue(input.exists());
    assert.isTrue(
      wrapper
        .find('button')
        .filterWhere(button => button.text() === 'Generate now')
        .first()
        .prop('disabled'),
    );

    input.props().onInput({ target: { value: 'sk-test' } });
    assert.calledWith(onApiKeyChange, 'sk-test');
  });

  it('shows a retained summary, generated date and stale status compactly', () => {
    const summaryStatusByTag = new Map([
      [
        'Character',
        {
          summary: {
            tag: 'Character',
            summary: 'Line one.\nLine two.',
            generatedAt: '2026-07-22T12:00:00.000Z',
            sourceFingerprint: 'v1:old',
          },
          stale: true,
        },
      ],
    ]);
    const wrapper = createComponent({ summaryStatusByTag });
    const characterSummary = wrapper.find(
      'tr[data-tag="Character"] [data-testid="tag-overview-summary"]',
    );

    assert.include(characterSummary.text(), 'Line one.\nLine two.');
    assert.include(characterSummary.text(), 'Generated at');
    assert.include(characterSummary.text(), 'Stale');
    assert.include(characterSummary.text(), 'Regenerate');
  });

  it('shows sequential bulk progress and a stop control', () => {
    const onStopGeneration = sinon.stub();
    const wrapper = createComponent({
      generatingTag: 'Character',
      bulkProgress: { completed: 1, total: 3, currentTag: 'Character' },
      onStopGeneration,
    });
    const progress = wrapper.find('[data-testid="tag-summary-bulk-progress"]');

    assert.include(progress.text(), 'Generating 2 of 3: Character');
    assert.equal(progress.find('progress').prop('value'), 1);
    progress
      .find('button')
      .filterWhere(button => button.text() === 'Stop')
      .props()
      .onClick();
    assert.calledOnce(onStopGeneration);
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
