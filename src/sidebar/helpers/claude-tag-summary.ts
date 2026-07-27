import { annotationFullQuote } from '../node-link/graph-model';
import type { NodeLinkGraph, NodeLinkQuote } from '../node-link/graph-model';
import type { ManualTagEdge } from '../node-link/graph-state';

export type ClaudeTagSummaryPrompt = {
  prompt: string;
  relationships: ManualTagEdge[];
  quotes: NodeLinkQuote[];
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

function fullQuoteText(quote: NodeLinkQuote) {
  return annotationFullQuote(quote.annotation) || quote.quote;
}

function compareQuotes(a: NodeLinkQuote, b: NodeLinkQuote) {
  return (
    a.documentLabel.localeCompare(b.documentLabel) ||
    a.documentUri.localeCompare(b.documentUri) ||
    a.id.localeCompare(b.id)
  );
}

/** Return only edges where `tag` is one of the two endpoints. */
export function directRelationshipsForTag(graph: NodeLinkGraph, tag: string) {
  return graph.manualEdges
    .filter(edge => edge.sourceTag === tag || edge.targetTag === tag)
    .sort(compareRelationships);
}

/** Return every quote carrying `tag` in stable document order. */
export function quotesForTag(graph: NodeLinkGraph, tag: string) {
  return graph.quotes
    .filter(quote => quote.tags.includes(tag))
    .sort(compareQuotes);
}

function hashFNV1a(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Fingerprint every direct edge and tagged quote included in the prompt. */
export function tagSummarySourceFingerprint(graph: NodeLinkGraph, tag: string) {
  const relationships = directRelationshipsForTag(graph, tag).map(edge => ({
    sourceTag: edge.sourceTag,
    connectionType: edge.connectionType,
    targetTag: edge.targetTag,
  }));
  const quotes = quotesForTag(graph, tag)
    .map(quote => ({
      id: quote.id,
      quote: fullQuoteText(quote),
      documentUri: quote.documentUri,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return `v1:${hashFNV1a(JSON.stringify({ tag, relationships, quotes }))}`;
}

export function buildClaudeTagSummaryPrompt(
  graph: NodeLinkGraph,
  tag: string,
): ClaudeTagSummaryPrompt {
  const relationships = directRelationshipsForTag(graph, tag);
  const quotes = quotesForTag(graph, tag);
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
Text: ${fullQuoteText(quote)}`,
        )
        .join('\n\n')
    : '(none)';

  return {
    relationships,
    quotes,
    sourceFingerprint: tagSummarySourceFingerprint(graph, tag),
    prompt: `Summarize what the tag "${tag}" means in this collection using only the evidence below.

Every listed relationship directly includes "${tag}". Do not infer relationships from neighboring tags.

Direct relationships (${relationships.length}):
${relationshipText}

All quotes tagged "${tag}" are included below. Consider the entire evidence set; do not privilege quotes based on their order.

Quotes tagged "${tag}" (${quotes.length} total):
${quoteText}`,
  };
}
