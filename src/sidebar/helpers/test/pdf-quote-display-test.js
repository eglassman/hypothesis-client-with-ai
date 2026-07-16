import {
  enrichPdfQuoteDisplayExact,
  hasPendingPdfLineBreakHyphens,
  preserveClientPdfQuoteDisplay,
  stripClientOnlyPdfQuoteFields,
} from '../pdf-quote-display';

describe('pdf-quote-display', () => {
  const annotWithHyphenCase = () => ({
    $tag: 't1',
    target: [
      {
        selector: [
          {
            type: 'TextQuoteSelector',
            exact: 'analy-sis of',
            displayExact: 'analy-sis of',
            pdfLineBreakHyphens: [{ before: 'analy', after: 'sis' }],
          },
        ],
      },
    ],
  });

  describe('hasPendingPdfLineBreakHyphens', () => {
    it('returns true when pdfLineBreakHyphens is non-empty', () => {
      assert.isTrue(
        hasPendingPdfLineBreakHyphens({
          $tag: 't1',
          target: [
            {
              selector: [
                {
                  type: 'TextQuoteSelector',
                  exact: 'x',
                  pdfLineBreakHyphens: [{ before: 'a', after: 'b' }],
                },
              ],
            },
          ],
        }),
      );
    });
  });

  it('enrichPdfQuoteDisplayExact applies Claude decisions', async () => {
    const annot = annotWithHyphenCase();
    const claude = {
      apiKey: sinon.stub().returns('test-key'),
      resolvePdfLineBreakHyphens: sinon.stub().resolves([
        { before: 'analy', after: 'sis', action: 'drop' },
      ]),
    };

    await enrichPdfQuoteDisplayExact(annot, claude);

    const quote = annot.target[0].selector[0];
    assert.equal(quote.displayExact, 'analysis of');
    assert.isUndefined(quote.pdfLineBreakHyphens);
    assert.calledWith(claude.resolvePdfLineBreakHyphens, {
      apiKey: 'test-key',
      cases: [{ before: 'analy', after: 'sis' }],
    });
  });

  it('enrichPdfQuoteDisplayExact uses fallback when API key is empty', async () => {
    const annot = annotWithHyphenCase();
    const claude = {
      apiKey: sinon.stub().returns(''),
      resolvePdfLineBreakHyphens: sinon.stub(),
    };

    await enrichPdfQuoteDisplayExact(annot, claude);

    const quote = annot.target[0].selector[0];
    assert.equal(quote.displayExact, 'analysis of');
    assert.notCalled(claude.resolvePdfLineBreakHyphens);
  });

  it('stripClientOnlyPdfQuoteFields removes pdfLineBreakHyphens', () => {
    const annot = annotWithHyphenCase();
    stripClientOnlyPdfQuoteFields(annot);
    assert.isUndefined(annot.target[0].selector[0].pdfLineBreakHyphens);
  });

  it('preserveClientPdfQuoteDisplay copies displayExact onto API response', () => {
    const saved = {
      $tag: 't1',
      target: [
        {
          selector: [{ type: 'TextQuoteSelector', exact: 'analy-sis of' }],
        },
      ],
    };
    const source = {
      $tag: 't1',
      target: [
        {
          selector: [
            {
              type: 'TextQuoteSelector',
              exact: 'analy-sis of',
              displayExact: 'analysis of',
            },
          ],
        },
      ],
    };
    preserveClientPdfQuoteDisplay(saved, source);
    assert.equal(saved.target[0].selector[0].displayExact, 'analysis of');
  });
});
