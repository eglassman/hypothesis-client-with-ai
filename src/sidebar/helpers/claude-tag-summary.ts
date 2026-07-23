import { annotationFullQuote } from '../node-link/graph-model';
import type { NodeLinkGraph, NodeLinkQuote } from '../node-link/graph-model';
import type { ManualTagEdge } from '../node-link/graph-state';

export const MAX_TAG_SUMMARY_QUOTES = 30;
export const MAX_TAG_SUMMARY_QUOTE_CHARS = 16_000;

export type ClaudeTagSummaryPrompt = {
  prompt: string;
  relationships: ManualTagEdge[];
  quotes: NodeLinkQuote[];
  totalQuoteCount: number;
  sourceFingerprint: string;
};

function compareRelationships(a: ManualTagEdge, b: ManualTagEdge) {
  return (
    a.sourceTag.localeCompare(b.sourceTag) ||
    a.connectionType.localeCompare(b.connectionType) ||
    a.targetTag.localeCompare(b.targetTag) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );
}

function quoteTimestamp(quote: NodeLinkQuote) {
  return quote.annotation.updated || quote.annotation.created || '';
}

function fullQuoteText(quote: NodeLinkQuote) {
  return annotationFullQuote(quote.annotation) || quote.quote;
}

function compareQuotesByRecency(a: NodeLinkQuote, b: NodeLinkQuote) {
  return (
    quoteTimestamp(b).localeCompare(quoteTimestamp(a)) ||
    a.id.localeCompare(b.id)
  );
}

/** Return only edges where `tag` is one of the two endpoints. */
export function directRelationshipsForTag(graph: NodeLinkGraph, tag: string) {
  return graph.manualEdges
    .filter(edge => edge.sourceTag === tag || edge.targetTag === tag)
    .sort(compareRelationships);
}

/** Return only quotes carrying `tag`, newest first. */
export function recentQuotesForTag(graph: NodeLinkGraph, tag: string) {
  return graph.quotes
    .filter(quote => quote.tags.includes(tag))
    .sort(compareQuotesByRecency);
}

/**
 * Keep a newest-first prefix of complete quotes within the prompt budget.
 * A single unusually long newest quote is still included whole.
 */
export function selectTagSummaryQuotes(quotes: NodeLinkQuote[]) {
  const selected: NodeLinkQuote[] = [];
  let selectedCharacters = 0;

  for (const quote of [...quotes].sort(compareQuotesByRecency)) {
    if (selected.length >= MAX_TAG_SUMMARY_QUOTES) {
      break;
    }
    const quoteCharacters =
      fullQuoteText(quote).length +
      quote.documentLabel.length +
      quoteTimestamp(quote).length;
    if (
      selected.length > 0 &&
      selectedCharacters + quoteCharacters > MAX_TAG_SUMMARY_QUOTE_CHARS
    ) {
      break;
    }
    selected.push(quote);
    selectedCharacters += quoteCharacters;
  }

  return selected;
}

function hashFNV1a(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Fingerprint every direct edge and tagged quote, not only prompt-selected quotes. */
export function tagSummarySourceFingerprint(graph: NodeLinkGraph, tag: string) {
  const relationships = directRelationshipsForTag(graph, tag).map(edge => ({
    sourceTag: edge.sourceTag,
    connectionType: edge.connectionType,
    targetTag: edge.targetTag,
  }));
  const quotes = recentQuotesForTag(graph, tag)
    .map(quote => ({
      id: quote.id,
      quote: fullQuoteText(quote),
      documentUri: quote.documentUri,
      updatedAt: quoteTimestamp(quote),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return `v1:${hashFNV1a(JSON.stringify({ tag, relationships, quotes }))}`;
}

export function buildClaudeTagSummaryPrompt(
  graph: NodeLinkGraph,
  tag: string,
): ClaudeTagSummaryPrompt {
  const relationships = directRelationshipsForTag(graph, tag);
  const allQuotes = recentQuotesForTag(graph, tag);
  const quotes = selectTagSummaryQuotes(allQuotes);
  const relationshipText = relationships.length
    ? relationships
        .map(
          (edge, index) =>
            `${index + 1}. ${edge.sourceTag} ${edge.connectionType} ${edge.targetTag}`,
        )
        .join('\n')
    : '(none)';
  const quoteText = quotes.length
    ? quotes
        .map(
          (quote, index) => `Quote ${index + 1}
Document: ${quote.documentLabel || 'Untitled document'}
Updated: ${quoteTimestamp(quote) || 'Unknown'}
Text: ${fullQuoteText(quote)}`,
        )
        .join('\n\n')
    : '(none)';

  return {
    relationships,
    quotes,
    totalQuoteCount: allQuotes.length,
    sourceFingerprint: tagSummarySourceFingerprint(graph, tag),
    prompt: `Summarize what the tag "${tag}" means in this collection using only the evidence below.

Every listed relationship directly includes "${tag}". Do not infer relationships from neighboring tags.

Direct relationships (${relationships.length}):
${relationshipText}

Quotes tagged "${tag}" (${quotes.length} of ${allQuotes.length}, newest first):
${quoteText}`,
  };
}
