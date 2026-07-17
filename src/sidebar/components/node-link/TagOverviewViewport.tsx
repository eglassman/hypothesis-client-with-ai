import { useMemo, useState } from 'preact/hooks';

import { spotlightNodeLinkGraph } from '../../node-link/graph-model';
import type { NodeLinkGraph, NodeLinkQuote } from '../../node-link/graph-model';
import type { ManualTagEdge } from '../../node-link/graph-state';
import { RelationshipSentence, TagBadge } from './RelationshipSentence';

const QUOTE_PREVIEW_LIMIT = 6;

type QuoteDocumentGroup = {
  key: string;
  label: string;
  quotes: NodeLinkQuote[];
};

function relationshipId(edge: ManualTagEdge) {
  return (
    edge.id || `${edge.sourceTag}\n${edge.connectionType}\n${edge.targetTag}`
  );
}

function groupQuotesByDocument(quotes: NodeLinkQuote[]) {
  const groups = new Map<string, QuoteDocumentGroup>();
  for (const quote of quotes) {
    const key = quote.documentUri || quote.documentLabel || quote.id;
    const group = groups.get(key) || {
      key,
      label: quote.documentLabel || 'Untitled document',
      quotes: [],
    };
    group.quotes.push(quote);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      quotes: [...group.quotes].sort((a, b) => a.quote.localeCompare(b.quote)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function TagQuotesByDocument({ quotes }: { quotes: NodeLinkQuote[] }) {
  const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(
    new Set(),
  );
  const groups = useMemo(() => groupQuotesByDocument(quotes), [quotes]);

  if (!groups.length) {
    return <p className="text-sm text-grey-6">No quote evidence.</p>;
  }

  const toggleExpandedDocument = (key: string) => {
    setExpandedDocuments(current => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {groups.map(group => {
        const expanded = expandedDocuments.has(group.key);
        const visibleQuotes = expanded
          ? group.quotes
          : group.quotes.slice(0, QUOTE_PREVIEW_LIMIT);
        const remaining = group.quotes.length - visibleQuotes.length;
        return (
          <details className="rounded border bg-white" key={group.key}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-bold hover:bg-grey-1 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand">
              <span className="min-w-0 truncate" title={group.label}>
                {group.label}
              </span>
              <span className="shrink-0 rounded-full bg-grey-2 px-2 py-0.5 text-xs text-grey-7">
                {group.quotes.length}{' '}
                {group.quotes.length === 1 ? 'quote' : 'quotes'}
              </span>
            </summary>
            <div className="space-y-2 border-t bg-grey-1/50 p-3">
              <ol className="space-y-2">
                {visibleQuotes.map(quote => (
                  <li className="rounded border bg-white p-3" key={quote.id}>
                    <blockquote className="text-sm leading-6 text-color-text">
                      &ldquo;{quote.quote}&rdquo;
                    </blockquote>
                    {quote.sourceUrl && (
                      <a
                        className="mt-2 inline-block text-xs font-bold text-brand hover:underline"
                        href={quote.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open source
                      </a>
                    )}
                  </li>
                ))}
              </ol>
              {(remaining > 0 || expanded) &&
                group.quotes.length > QUOTE_PREVIEW_LIMIT && (
                  <button
                    className="rounded px-2 py-1 text-xs font-bold text-brand hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-brand"
                    type="button"
                    onClick={() => toggleExpandedDocument(group.key)}
                  >
                    {expanded ? 'Show fewer' : `Show ${remaining} more`}
                  </button>
                )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function compareRelationshipsByTarget(a: ManualTagEdge, b: ManualTagEdge) {
  return (
    a.targetTag.localeCompare(b.targetTag) ||
    a.sourceTag.localeCompare(b.sourceTag) ||
    a.connectionType.localeCompare(b.connectionType) ||
    relationshipId(a).localeCompare(relationshipId(b))
  );
}

export type TagOverviewViewportProps = {
  graph: NodeLinkGraph;
  spotlightTag: string;
  tagColors: Record<string, string>;
};

export function TagOverviewViewport({
  graph,
  spotlightTag,
  tagColors,
}: TagOverviewViewportProps) {
  const visibleGraph = useMemo(
    () => spotlightNodeLinkGraph(graph, spotlightTag),
    [graph, spotlightTag],
  );
  const tags = useMemo(
    () => [...visibleGraph.tags].sort((a, b) => a.tag.localeCompare(b.tag)),
    [visibleGraph.tags],
  );
  const relationshipsByTag = useMemo(() => {
    const relationships = new Map(
      visibleGraph.tags.map(tag => [tag.tag, [] as ManualTagEdge[]]),
    );
    for (const edge of visibleGraph.manualEdges) {
      relationships.get(edge.sourceTag)?.push(edge);
      if (edge.targetTag !== edge.sourceTag) {
        relationships.get(edge.targetTag)?.push(edge);
      }
    }
    for (const tagRelationships of relationships.values()) {
      tagRelationships.sort(compareRelationshipsByTarget);
    }
    return relationships;
  }, [visibleGraph.manualEdges, visibleGraph.tags]);
  const quotesByTag = useMemo(() => {
    const quotes = new Map(
      visibleGraph.tags.map(tag => [tag.tag, [] as NodeLinkQuote[]]),
    );
    for (const quote of visibleGraph.quotes) {
      for (const tag of new Set(quote.tags)) {
        quotes.get(tag)?.push(quote);
      }
    }
    return quotes;
  }, [visibleGraph.quotes, visibleGraph.tags]);

  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded border bg-white"
      data-testid="tag-overview"
    >
      <header className="flex items-center justify-between gap-4 border-b bg-grey-1 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">Tag overview</h2>
          <p className="mt-0.5 text-xs text-grey-6">
            Relationships, quote evidence, and descriptions for every tag.
          </p>
        </div>
        <span className="shrink-0 text-xs font-bold text-grey-6">
          {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
        </span>
      </header>

      {tags.length ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1050px] table-fixed border-collapse">
            <thead className="sticky top-0 z-10 bg-white shadow-sm">
              <tr>
                <th
                  className="w-[38%] border-b px-4 py-3 text-left text-xs font-bold uppercase text-grey-6"
                  scope="col"
                >
                  <span className="block">Tag and relationships</span>
                  <span className="mt-0.5 block text-[11px] font-normal normal-case">
                    Sorted alphabetically by Tag B
                  </span>
                </th>
                <th
                  className="w-[42%] border-b px-4 py-3 text-left text-xs font-bold uppercase text-grey-6"
                  scope="col"
                >
                  Quotes by document
                </th>
                <th
                  className="w-[20%] border-b px-4 py-3 text-left text-xs font-bold uppercase text-grey-6"
                  scope="col"
                >
                  Description
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tags.map(tag => {
                const relationships = relationshipsByTag.get(tag.tag) || [];
                const quotes = quotesByTag.get(tag.tag) || [];
                return (
                  <tr
                    className="align-top even:bg-grey-1/40"
                    data-tag={tag.tag}
                    key={tag.id}
                  >
                    <td className="p-4">
                      <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
                        <TagBadge tag={tag.tag} tagColors={tagColors} />
                        <span className="shrink-0 text-xs font-bold text-grey-6">
                          {relationships.length}{' '}
                          {relationships.length === 1
                            ? 'relationship'
                            : 'relationships'}
                        </span>
                      </div>
                      {relationships.length ? (
                        <ol
                          className="space-y-2"
                          data-testid="tag-overview-relationships"
                        >
                          {relationships.map((edge, index) => (
                            <li
                              className="rounded border bg-white px-3 py-2 text-sm leading-6"
                              key={`${relationshipId(edge)}:${index}`}
                            >
                              <RelationshipSentence
                                edge={edge}
                                tagColors={tagColors}
                              />
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-sm text-grey-6">
                          No manual relationships.
                        </p>
                      )}
                    </td>
                    <td className="border-l p-4">
                      <TagQuotesByDocument quotes={quotes} />
                    </td>
                    <td className="border-l p-4">
                      <p
                        className="rounded border border-dashed bg-grey-1 p-3 text-sm leading-6 text-grey-7"
                        data-testid="tag-overview-summary"
                      >
                        AI generated summary here
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center p-8 text-sm text-grey-6">
          No tags are available for this view.
        </div>
      )}
    </section>
  );
}
