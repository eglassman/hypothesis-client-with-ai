/**
 * PDF line-break hyphen handling for space-aware quote text.
 *
 * Cross-line hyphens may be syllabification (analy- / sis → analysis) or lexical
 * compounds split at the break (Theory- / based → Theory-based). Resolution of
 * which case applies is delegated to Claude in the sidebar; the annotator only
 * collects cases and applies decisions.
 */

/** Second halves of obvious hyphenated compounds — fast path when Claude is unavailable. */
const HYPHENATED_COMPOUND_SUFFIXES = new Set([
  'based',
  'driven',
  'oriented',
  'aware',
  'like',
  'wide',
  'free',
  'level',
  'made',
  'scale',
  'sized',
  'handed',
  'going',
  'looking',
  'bearing',
  'worthy',
  'related',
  'dependent',
  'independent',
  'specific',
  'sensitive',
  'centric',
]);

export type PdfLineBreakHyphenCase = {
  before: string;
  after: string;
  /** Index of `-` in the space-aware layer text. */
  hyphenIndex: number;
};

export type PdfLineBreakHyphenDecision = {
  before: string;
  after: string;
  action: 'drop' | 'keep';
};

/** Split a span ending in `-` into text before the broken word and the fragment. */
export function wordFragmentBeforeLineBreakHyphen(spanText: string): {
  prefix: string;
  fragment: string;
} | null {
  const trimmed = spanText.trimEnd();
  const match = trimmed.match(/^(.*?)(\S+)-$/);
  if (!match) {
    return null;
  }
  return { prefix: match[1], fragment: match[2] };
}

/** First word in a span and any trailing text. */
export function firstWordOfSpan(spanText: string): {
  word: string;
  rest: string;
} | null {
  const match = spanText.trimStart().match(/^(\S+)([\s\S]*)$/);
  if (!match) {
    return null;
  }
  return { word: match[1], rest: match[2] };
}

/** Cases whose hyphen falls within `[start, end)` of space-aware layer text. */
export function pdfLineBreakHyphensInRange(
  cases: PdfLineBreakHyphenCase[],
  start: number,
  end: number,
): Array<{ before: string; after: string }> {
  return cases
    .filter(c => c.hyphenIndex >= start && c.hyphenIndex < end)
    .map(({ before, after }) => ({ before, after }));
}

/** Fallback when Claude is unavailable (no API key or request failed). */
export function fallbackPdfLineBreakHyphenDecisions(
  cases: Array<{ before: string; after: string }>,
): PdfLineBreakHyphenDecision[] {
  return cases.map(({ before, after }) => ({
    before,
    after,
    action: fallbackPdfLineBreakHyphenAction(before, after),
  }));
}

/** Exported for unit tests. */
export function fallbackPdfLineBreakHyphenAction(
  before: string,
  after: string,
): 'drop' | 'keep' {
  const afterWord = after.trim();
  const beforeFragment = before.trim();
  if (HYPHENATED_COMPOUND_SUFFIXES.has(afterWord.toLowerCase())) {
    return 'keep';
  }
  // Labels/enumeration (e.g. ITEM A-ITEM B) usually continue with an uppercase token.
  if (/^[A-Z]/.test(afterWord)) {
    return 'keep';
  }
  // Lowercase syllable continuations (e.g. analy-sis) are usually layout hyphens.
  if (/^[a-z]/.test(afterWord) && /[a-z]$/.test(beforeFragment)) {
    return 'drop';
  }
  return 'keep';
}

/** Apply Claude (or fallback) decisions to a display quote string. */
export function applyPdfLineBreakHyphenDecisions(
  displayExact: string,
  decisions: PdfLineBreakHyphenDecision[],
): string {
  let result = displayExact;
  for (const { before, after, action } of decisions) {
    if (action !== 'drop') {
      continue;
    }
    const pattern = `${before}-${after}`;
    const replacement = `${before}${after}`;
    const index = result.indexOf(pattern);
    if (index !== -1) {
      result =
        result.slice(0, index) + replacement + result.slice(index + pattern.length);
    }
  }
  return result;
}
