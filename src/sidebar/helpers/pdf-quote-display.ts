import {
  applyPdfLineBreakHyphenDecisions,
  fallbackPdfLineBreakHyphenDecisions,
} from '../../annotator/anchoring/pdf-line-break-hyphen';
import type { AnnotationData } from '../../types/annotator';
import type { TextQuoteSelector } from '../../types/api';
import type { ClaudeService } from '../services/claude';

function textQuoteSelector(
  annotation: AnnotationData,
): TextQuoteSelector | null {
  const target = annotation.target?.[0];
  const selector = target?.selector?.find(s => s.type === 'TextQuoteSelector');
  return (selector as TextQuoteSelector | undefined) ?? null;
}

/** True when a PDF quote has line-break hyphen cases pending Claude resolution. */
export function hasPendingPdfLineBreakHyphens(
  annotation: AnnotationData,
): boolean {
  const cases = textQuoteSelector(annotation)?.pdfLineBreakHyphens;
  return (cases?.length ?? 0) > 0;
}

/**
 * Normalize `displayExact` for PDF quotes with cross-line hyphens using Claude.
 * Strips client-only `pdfLineBreakHyphens` from the selector when done.
 */
export async function enrichPdfQuoteDisplayExact(
  annotation: AnnotationData,
  claude: ClaudeService,
): Promise<void> {
  const quoteSel = textQuoteSelector(annotation);
  const cases = quoteSel?.pdfLineBreakHyphens;
  if (!quoteSel || !cases?.length) {
    return;
  }

  const baseDisplay = quoteSel.displayExact ?? quoteSel.exact;
  const apiKey = claude.apiKey().trim();
  let decisions;
  if (apiKey) {
    try {
      decisions = await claude.resolvePdfLineBreakHyphens({
        apiKey,
        cases,
      });
    } catch {
      decisions = fallbackPdfLineBreakHyphenDecisions(cases);
    }
  } else {
    decisions = fallbackPdfLineBreakHyphenDecisions(cases);
  }

  const normalized = applyPdfLineBreakHyphenDecisions(baseDisplay, decisions);
  if (normalized !== quoteSel.exact) {
    quoteSel.displayExact = normalized;
  } else {
    delete quoteSel.displayExact;
  }
  delete quoteSel.pdfLineBreakHyphens;
}

/** Remove client-only PDF quote fields before persisting to the API. */
export function stripClientOnlyPdfQuoteFields(annotation: AnnotationData): void {
  const quoteSel = textQuoteSelector(annotation);
  if (quoteSel) {
    delete quoteSel.pdfLineBreakHyphens;
  }
}

/**
 * Copy `displayExact` from a locally enriched annotation onto the API response.
 * The Hypothesis API does not know this field and typically omits it from responses.
 */
export function preserveClientPdfQuoteDisplay(
  saved: AnnotationData,
  source: AnnotationData,
): void {
  const sourceQuote = textQuoteSelector(source);
  if (!sourceQuote?.displayExact) {
    return;
  }
  const savedQuote = textQuoteSelector(saved);
  if (!savedQuote) {
    return;
  }
  savedQuote.displayExact = sourceQuote.displayExact;
}
