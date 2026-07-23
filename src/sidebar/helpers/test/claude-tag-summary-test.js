import {
  buildClaudeTagSummaryPrompt,
  directRelationshipsForTag,
  MAX_TAG_SUMMARY_QUOTE_CHARS,
  MAX_TAG_SUMMARY_QUOTES,
  recentQuotesForTag,
  selectTagSummaryQuotes,
  tagSummarySourceFingerprint,
} from '../claude-tag-summary';

function quote({
  id,
  text,
  tags = ['Character'],
  updated = '2026-07-01T00:00:00Z',
}) {
  return {
    id,
    quote: text,
    tags,
    documentUri: `https://example.com/${id}`,
    documentLabel: `Document ${id}`,
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
      recentQuotesForTag(input, 'Character').map(item => item.id),
      ['newer-character', 'older-character'],
    );
    assert.include(prompt.prompt, 'Character motivates Action');
    assert.notInclude(prompt.prompt, 'Action supports Theme');
    assert.include(prompt.prompt, 'Newer complete Character quote.');
    assert.notInclude(prompt.prompt, 'Theme-only quote.');
  });

  it('selects recent whole quotes without truncating them', () => {
    const longText = 'x'.repeat(MAX_TAG_SUMMARY_QUOTE_CHARS + 100);
    const quotes = [
      quote({
        id: 'newest-long',
        text: longText,
        updated: '2026-07-03T00:00:00Z',
      }),
      quote({ id: 'older-short', text: 'Older short quote.' }),
    ];

    const selected = selectTagSummaryQuotes(quotes);

    assert.lengthOf(selected, 1);
    assert.equal(selected[0].quote, longText);
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

  it('caps the number of quotes using newest-first order', () => {
    const quotes = Array.from({ length: MAX_TAG_SUMMARY_QUOTES + 1 }, (_, i) =>
      quote({
        id: `quote-${i}`,
        text: `Quote ${i}`,
        updated: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      }),
    ).sort((a, b) => b.annotation.updated.localeCompare(a.annotation.updated));

    const selected = selectTagSummaryQuotes(quotes);

    assert.lengthOf(selected, MAX_TAG_SUMMARY_QUOTES);
    assert.equal(selected[0].id, `quote-${MAX_TAG_SUMMARY_QUOTES}`);
    assert.equal(selected.at(-1).id, 'quote-1');
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

    assert.equal(unrelated, original);
    assert.equal(unrelatedQuote, original);
    assert.notEqual(direct, original);
    assert.notEqual(taggedQuote, original);
  });
});
