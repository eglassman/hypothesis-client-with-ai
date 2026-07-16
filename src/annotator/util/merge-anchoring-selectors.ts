import type { Selector, TextQuoteSelector } from '../../types/api';

function textQuoteSelector(
  selectors: Selector[] | undefined,
): TextQuoteSelector | undefined {
  return selectors?.find(s => s.type === 'TextQuoteSelector') as
    | TextQuoteSelector
    | undefined;
}

/**
 * True when the selector list is non-empty and every entry is a TextQuoteSelector
 * (no position, page, range, shape, etc.).
 */
export function isQuoteOnlySelectors(
  selectors: Selector[] | undefined,
): boolean {
  return (
    !!selectors &&
    selectors.length > 0 &&
    selectors.every(s => s.type === 'TextQuoteSelector')
  );
}

/**
 * Merge selectors produced by Integration.describe into an existing list.
 * Keeps the API's original quote; adds TextPositionSelector and PageSelector
 * from `fromDescribe` when missing. Ignores extra TextQuoteSelector entries
 * from `fromDescribe` so the stored quote stays stable.
 */
export function mergeAnchoringSelectors(
  existing: Selector[],
  fromDescribe: Selector[],
): Selector[] {
  const out = [...existing];
  const hasType = (t: Selector['type']) => out.some(s => s.type === t);

  for (const sel of fromDescribe) {
    if (sel.type === 'TextQuoteSelector') {
      continue;
    }
    if (sel.type === 'TextPositionSelector' && !hasType('TextPositionSelector')) {
      out.push(sel);
    } else if (sel.type === 'PageSelector' && !hasType('PageSelector')) {
      out.push(sel);
    }
  }

  return out;
}

/**
 * Return true if quote display metadata from a text layer describe() pass
 * should still be merged onto these selectors.
 */
export function needsQuoteDisplayEnrichment(
  selectors: Selector[] | undefined,
): boolean {
  const quote = textQuoteSelector(selectors);
  if (!quote) {
    return false;
  }
  return quote.displayExact === undefined && quote.pdfLineBreakHyphens === undefined;
}

/**
 * Copy displayExact and pdfLineBreakHyphens from describe() onto the existing
 * TextQuoteSelector without changing exact/prefix/suffix.
 */
export function mergeQuoteDisplayFromDescribe(
  existing: Selector[],
  fromDescribe: Selector[],
): Selector[] {
  const describedQuote = textQuoteSelector(fromDescribe);
  if (!describedQuote) {
    return existing;
  }

  return existing.map(sel => {
    if (sel.type !== 'TextQuoteSelector') {
      return sel;
    }
    const updated: TextQuoteSelector = { ...sel };
    if (describedQuote.displayExact !== undefined) {
      updated.displayExact = describedQuote.displayExact;
    }
    if (describedQuote.pdfLineBreakHyphens !== undefined) {
      updated.pdfLineBreakHyphens = describedQuote.pdfLineBreakHyphens;
    }
    return updated;
  });
}

/**
 * Return true if quote display fields changed between two annotation targets.
 */
export function quoteDisplayChanged(
  before: Selector[] | undefined,
  after: Selector[] | undefined,
): boolean {
  const beforeQuote = textQuoteSelector(before);
  const afterQuote = textQuoteSelector(after);
  if (!beforeQuote || !afterQuote) {
    return false;
  }

  const displayChanged =
    beforeQuote.displayExact !== afterQuote.displayExact &&
    afterQuote.displayExact !== undefined;

  const hyphensEqual =
    JSON.stringify(beforeQuote.pdfLineBreakHyphens ?? null) ===
    JSON.stringify(afterQuote.pdfLineBreakHyphens ?? null);
  const hyphensChanged =
    !hyphensEqual && afterQuote.pdfLineBreakHyphens !== undefined;

  return displayChanged || hyphensChanged;
}
