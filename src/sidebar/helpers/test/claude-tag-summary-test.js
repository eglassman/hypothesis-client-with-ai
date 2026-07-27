import {
  buildClaudeTagSummaryPrompt,
  directRelationshipsForTag,
  quotesForTag,
  tagSummarySourceFingerprint,
} from '../claude-tag-summary';

function quote({
  id,
  text,
  tags = ['Character'],
  updated = '2026-07-01T00:00:00Z',
  documentLabel = `Document ${id}`,
}) {
  return {
    id,
    quote: text,
    tags,
    documentUri: `https://example.com/${id}`,
    documentLabel,
    sourceUrl: '',
    annotation: {
      id,
      created: updated,
      updated,
      target: [
        {
          selector: [{ type: 'TextQuoteSelector', exact: text }],
        },
      ],
    },
  };
}

function graph(overrides = {}) {
  return {
    tags: [],
    documents: [],
    annotationCount: 0,
    quotes: [
      quote({
        id: 'older-character',
        text: 'Older complete Character quote.',
        updated: '2026-07-01T00:00:00Z',
      }),
      quote({
        id: 'newer-character',
        text: 'Newer complete Character quote.',
        updated: '2026-07-02T00:00:00Z',
      }),
      quote({ id: 'theme', text: 'Theme-only quote.', tags: ['Theme'] }),
    ],
    manualEdges: [
      {
        id: 'character-action',
        sourceTag: 'Character',
        connectionType: 'motivates',
        targetTag: 'Action',
      },
      {
        id: 'action-theme',
        sourceTag: 'Action',
        connectionType: 'supports',
        targetTag: 'Theme',
      },
    ],
    ...overrides,
  };
}

describe('claude-tag-summary', () => {
  it('includes only direct relationships and quotes tagged with the tag', () => {
    const input = graph();
    const prompt = buildClaudeTagSummaryPrompt(input, 'Character');

    assert.deepEqual(
      directRelationshipsForTag(input, 'Character').map(edge => edge.id),
      ['character-action'],
    );
    assert.deepEqual(
      quotesForTag(input, 'Character').map(item => item.id),
      ['newer-character', 'older-character'],
    );
    assert.include(prompt.prompt, 'Character motivates Action');
    assert.notInclude(prompt.prompt, 'Action supports Theme');
    assert.include(prompt.prompt, 'Newer complete Character quote.');
    assert.notInclude(prompt.prompt, 'Theme-only quote.');
  });

  it('includes every matching quote without truncation or a prompt budget', () => {
    const quotes = Array.from({ length: 35 }, (_, index) =>
      quote({
        id: `quote-${index}`,
        text: `${'evidence '.repeat(80)}complete quote ${index}`,
      }),
    );

    const prompt = buildClaudeTagSummaryPrompt(graph({ quotes }), 'Character');

    assert.lengthOf(prompt.quotes, quotes.length);
    assert.include(prompt.prompt, 'Quotes tagged "Character" (35 total):');
    assert.include(
      prompt.prompt,
      'Consider the entire evidence set; do not privilege quotes based on their order.',
    );
    for (const item of quotes) {
      assert.include(
        prompt.prompt,
        item.annotation.target[0].selector[0].exact,
      );
    }
  });

  it('sends the complete annotation quote instead of its display preview', () => {
    const completeText = `Beginning ${'evidence '.repeat(40)}ending.`;
    const evidence = quote({ id: 'long-evidence', text: completeText });
    evidence.quote = `${completeText.slice(0, 217)}...`;

    const prompt = buildClaudeTagSummaryPrompt(
      graph({ quotes: [evidence] }),
      'Character',
    );

    assert.include(prompt.prompt, completeText);
    assert.notInclude(prompt.prompt, evidence.quote);
  });

  it('orders quotes by document rather than recency', () => {
    const quotes = [
      quote({
        id: 'newest',
        text: 'Newest quote.',
        updated: '2026-07-03T00:00:00Z',
        documentLabel: 'Zulu document',
      }),
      quote({
        id: 'oldest',
        text: 'Oldest quote.',
        updated: '2020-01-01T00:00:00Z',
        documentLabel: 'Alpha document',
      }),
    ];

    const prompt = buildClaudeTagSummaryPrompt(graph({ quotes }), 'Character');

    assert.deepEqual(
      prompt.quotes.map(item => item.id),
      ['oldest', 'newest'],
    );
    assert.isBelow(
      prompt.prompt.indexOf('Oldest quote.'),
      prompt.prompt.indexOf('Newest quote.'),
    );
    assert.notInclude(prompt.prompt, 'Updated:');
    assert.notInclude(prompt.prompt, 'newest first');
  });

  it('marks only changes to direct relationships or tagged quotes as stale', () => {
    const input = graph();
    const original = tagSummarySourceFingerprint(input, 'Character');
    const unrelated = tagSummarySourceFingerprint(
      graph({
        manualEdges: [
          ...input.manualEdges,
          {
            id: 'theme-setting',
            sourceTag: 'Theme',
            connectionType: 'frames',
            targetTag: 'Setting',
          },
        ],
      }),
      'Character',
    );
    const direct = tagSummarySourceFingerprint(
      graph({
        manualEdges: [
          ...input.manualEdges,
          {
            id: 'setting-character',
            sourceTag: 'Setting',
            connectionType: 'contains',
            targetTag: 'Character',
          },
        ],
      }),
      'Character',
    );
    const unrelatedQuote = tagSummarySourceFingerprint(
      graph({
        quotes: [
          ...input.quotes,
          quote({
            id: 'new-theme',
            text: 'New Theme evidence.',
            tags: ['Theme'],
          }),
        ],
      }),
      'Character',
    );
    const taggedQuote = tagSummarySourceFingerprint(
      graph({
        quotes: [
          ...input.quotes,
          quote({ id: 'new-character', text: 'New Character evidence.' }),
        ],
      }),
      'Character',
    );
    const retimestampedQuote = tagSummarySourceFingerprint(
      graph({
        quotes: input.quotes.map(item =>
          item.id === 'older-character'
            ? {
                ...item,
                annotation: {
                  ...item.annotation,
                  updated: '2027-01-01T00:00:00Z',
                },
              }
            : item,
        ),
      }),
      'Character',
    );

    assert.equal(unrelated, original);
    assert.equal(unrelatedQuote, original);
    assert.equal(retimestampedQuote, original);
    assert.notEqual(direct, original);
    assert.notEqual(taggedQuote, original);
  });
});
