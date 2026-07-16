import {
  applyPdfLineBreakHyphenDecisions,
  fallbackPdfLineBreakHyphenAction,
  fallbackPdfLineBreakHyphenDecisions,
  pdfLineBreakHyphensInRange,
  wordFragmentBeforeLineBreakHyphen,
} from '../pdf-line-break-hyphen';

describe('pdf-line-break-hyphen', () => {
  describe('fallbackPdfLineBreakHyphenAction', () => {
    it('drops syllable hyphenation (analy-sis → analysis)', () => {
      assert.equal(fallbackPdfLineBreakHyphenAction('analy', 'sis'), 'drop');
    });

    it('keeps lexical compounds (Theory-based)', () => {
      assert.equal(fallbackPdfLineBreakHyphenAction('Theory', 'based'), 'keep');
    });

    it('keeps lexical compounds when the first part is lowercase', () => {
      assert.equal(fallbackPdfLineBreakHyphenAction('theory', 'based'), 'keep');
    });

    it('keeps labels/enumeration (ITEM A-ITEM B)', () => {
      assert.equal(fallbackPdfLineBreakHyphenAction('A', 'ITEM'), 'keep');
    });
  });

  describe('applyPdfLineBreakHyphenDecisions', () => {
    it('removes hyphens marked drop', () => {
      const result = applyPdfLineBreakHyphenDecisions('analy-sis of', [
        { before: 'analy', after: 'sis', action: 'drop' },
      ]);
      assert.equal(result, 'analysis of');
    });

    it('keeps hyphens marked keep', () => {
      const result = applyPdfLineBreakHyphenDecisions('Theory-based methods', [
        { before: 'Theory', after: 'based', action: 'keep' },
      ]);
      assert.equal(result, 'Theory-based methods');
    });
  });

  describe('pdfLineBreakHyphensInRange', () => {
    it('returns cases whose hyphen index falls in the range', () => {
      const cases = [
        { before: 'analy', after: 'sis', hyphenIndex: 5 },
        { before: 'foo', after: 'bar', hyphenIndex: 20 },
      ];
      assert.deepEqual(pdfLineBreakHyphensInRange(cases, 0, 10), [
        { before: 'analy', after: 'sis' },
      ]);
    });
  });

  describe('wordFragmentBeforeLineBreakHyphen', () => {
    it('extracts the broken word fragment', () => {
      assert.deepEqual(wordFragmentBeforeLineBreakHyphen('Theory-'), {
        prefix: '',
        fragment: 'Theory',
      });
      assert.deepEqual(wordFragmentBeforeLineBreakHyphen('ITEM A-'), {
        prefix: 'ITEM ',
        fragment: 'A',
      });
    });
  });

  describe('fallbackPdfLineBreakHyphenDecisions', () => {
    it('maps cases through the fallback action', () => {
      assert.deepEqual(
        fallbackPdfLineBreakHyphenDecisions([{ before: 'analy', after: 'sis' }]),
        [{ before: 'analy', after: 'sis', action: 'drop' }],
      );
    });
  });
});
