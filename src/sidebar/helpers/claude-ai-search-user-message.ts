import type { SavedAnnotation } from '../../types/api';
import type { AnnotationsService } from '../services/annotations';
import type { AISearchNegativeExample } from '../store/modules/sidebar-panels';
import { isReply, isSaved, quote } from './annotation-metadata';

export type AiSearchQuoteItem = { text?: string };

const AI_USER_APPROVED = 'ai-user-approved';
const AI_PENDING = 'ai-pending';

export type TagQueryQuoteRow = {
  tag: string;
  query: string;
  quote: string;
};

export type TagSet = 'A' | 'B';

type CandidateRow = {
  annotation: SavedAnnotation;
  set: TagSet;
  tag: string;
  query: string;
  quote: string;
  index: number;
};

function norm(s: string): string {
  return s.trim();
}

function formatTagColumnForSetA(tags: string[]): string {
  return tags
    .filter(t => t !== AI_USER_APPROVED && t !== AI_PENDING)
    .join(', ');
}

function formatTagColumnForSetB(tags: string[]): string {
  return tags.join(', ');
}

function includeUserAuthoredRow(annotation: SavedAnnotation): boolean {
  const text = annotation.text ?? '';
  const tags = annotation.tags ?? [];
  if (text.trim().length > 0) {
    return true;
  }
  return tags.length > 0;
}

/**
 * Build candidate rows from Sets A and B (no dedupe).
 */
export function buildCandidateRows(
  annotations: SavedAnnotation[],
  documentUri: string,
): CandidateRow[] {
  const candidates: CandidateRow[] = [];
  let index = 0;

  for (const ann of annotations) {
    if (!isSaved(ann) || ann.uri !== documentUri) {
      continue;
    }

    const q = quote(ann);
    if (q == null || !q.trim()) {
      continue;
    }

    const tags = ann.tags ?? [];

    if (tags.includes(AI_USER_APPROVED)) {
      candidates.push({
        annotation: ann,
        set: 'A',
        tag: formatTagColumnForSetA(tags),
        query: ann.text ?? '',
        quote: q,
        index: index++,
      });
      continue;
    }

    if (tags.includes(AI_PENDING)) {
      continue;
    }

    if (isReply(ann)) {
      continue;
    }

    if (!includeUserAuthoredRow(ann)) {
      continue;
    }

    candidates.push({
      annotation: ann,
      set: 'B',
      tag: formatTagColumnForSetB(tags),
      query: ann.text ?? '',
      quote: q,
      index: index++,
    });
  }

  return candidates;
}

function pickKeeper(rows: CandidateRow[]): CandidateRow {
  const bs = rows
    .filter(r => r.set === 'B')
    .sort((a, b) => a.annotation.id!.localeCompare(b.annotation.id!));
  if (bs.length) {
    return bs[0]!;
  }
  return [...rows].sort((a, b) =>
    a.annotation.id!.localeCompare(b.annotation.id!),
  )[0]!;
}

/**
 * Dedupe candidates per plan (A-involved vs B+B), delete eliminated annotations.
 */
export async function dedupeTagQueryRows(
  candidates: CandidateRow[],
  annotationsService: AnnotationsService,
): Promise<CandidateRow[]> {
  const byTagQuote = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    const k = `${norm(row.tag)}\0${norm(row.quote)}`;
    let arr = byTagQuote.get(k);
    if (!arr) {
      arr = [];
      byTagQuote.set(k, arr);
    }
    arr.push(row);
  }

  const keep = new Set<string>();
  const toDelete: SavedAnnotation[] = [];

  for (const [, group] of byTagQuote) {
    if (group.length <= 1) {
      keep.add(group[0]!.annotation.id!);
      continue;
    }

    const hasA = group.some(r => r.set === 'A');

    if (hasA) {
      const keeper = pickKeeper(group);
      keep.add(keeper.annotation.id!);
      for (const r of group) {
        if (r.annotation.id !== keeper.annotation.id) {
          toDelete.push(r.annotation);
        }
      }
      console.warn('[AISearch] duplicate tag+quote (A-involved)', {
        tag: keeper.tag,
        quote: keeper.quote,
        ids: group.map(r => r.annotation.id),
        sets: group.map(r => r.set),
      });
      continue;
    }

    const byQuery = new Map<string, CandidateRow[]>();
    for (const r of group) {
      const qk = norm(r.query);
      let g = byQuery.get(qk);
      if (!g) {
        g = [];
        byQuery.set(qk, g);
      }
      g.push(r);
    }

    for (const [, sub] of byQuery) {
      if (sub.length <= 1) {
        keep.add(sub[0]!.annotation.id!);
        continue;
      }
      const keeper = pickKeeper(sub);
      keep.add(keeper.annotation.id!);
      for (const r of sub) {
        if (r.annotation.id !== keeper.annotation.id) {
          toDelete.push(r.annotation);
        }
      }
      console.warn('[AISearch] duplicate tag+quote+query (B+B)', {
        tag: keeper.tag,
        quote: keeper.quote,
        query: keeper.query,
        ids: sub.map(r => r.annotation.id),
      });
    }
  }

  for (const ann of toDelete) {
    await annotationsService.delete(ann);
  }

  const kept = candidates.filter(
    c => c.annotation.id && keep.has(c.annotation.id),
  );
  kept.sort((a, b) => a.index - b.index);
  return kept;
}

/**
 * Collect, dedupe, and delete duplicate annotations per plan. Times and logs construction.
 */
export async function collectTagQueryQuoteRows(
  annotations: SavedAnnotation[],
  documentUri: string,
  annotationsService: AnnotationsService,
): Promise<TagQueryQuoteRow[]> {
  const t0 = performance.now();
  try {
    const candidates = buildCandidateRows(annotations, documentUri);
    const deduped = await dedupeTagQueryRows(candidates, annotationsService);
    return deduped.map(r => ({
      tag: r.tag,
      query: r.query,
      quote: r.quote,
    }));
  } finally {
    const elapsedMs = Math.round(performance.now() - t0);
    console.log('[AISearch] example triples construction', { elapsedMs });
  }
}

/**
 * Tags other than ai-pending / ai-user-approved (schema and user tags).
 */
function contentTags(tags: string[]): string[] {
  return tags.filter(t => t !== AI_USER_APPROVED && t !== AI_PENDING);
}

/**
 * True if `ann` uses the same schema tag as the current AI search row.
 * Empty `schemaTagTrim` matches annotations with no content tags (only system tags).
 */
function schemaTagMatchesSearchRow(
  schemaTagTrim: string,
  annTags: string[],
): boolean {
  if (schemaTagTrim) {
    return annTags.includes(schemaTagTrim);
  }
  return contentTags(annTags).length === 0;
}

/**
 * True if a saved annotation on `documentUri` already has the same quote text
 * and schema tag as an AI result quote (so creating a new ai-pending would duplicate).
 */
function existingAnnotationCoversAiQuote(
  annotations: SavedAnnotation[],
  documentUri: string,
  schemaTagTrim: string,
  normalizedQuoteText: string,
): boolean {
  for (const ann of annotations) {
    if (!isSaved(ann) || ann.uri !== documentUri) {
      continue;
    }
    if (isReply(ann)) {
      continue;
    }
    const q = quote(ann);
    if (q == null || !norm(q)) {
      continue;
    }
    if (norm(q) !== normalizedQuoteText) {
      continue;
    }
    if (!schemaTagMatchesSearchRow(schemaTagTrim, ann.tags ?? [])) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Drop AI quote items that would duplicate an existing annotation on the same
 * document with the same tag+quote (e.g. ai-user-approved after rerun).
 */
export function filterAiSearchQuotesAgainstExisting(
  quotes: AiSearchQuoteItem[],
  savedAnnotations: SavedAnnotation[],
  documentUri: string,
  schemaTagTrim: string,
): AiSearchQuoteItem[] {
  return quotes.filter(item => {
    const t = item.text?.trim();
    if (!t) {
      return true;
    }
    return !existingAnnotationCoversAiQuote(
      savedAnnotations,
      documentUri,
      schemaTagTrim,
      norm(t),
    );
  });
}

/**
 * Non-empty quotes in `raw` minus non-empty quotes in `filtered` (duplicate skips).
 */
export function countAiSearchQuotesSkippedAsDuplicates(
  raw: AiSearchQuoteItem[],
  filtered: AiSearchQuoteItem[],
): number {
  const nonEmptyRaw = raw.filter(q => q.text?.trim()).length;
  const nonEmptyFiltered = filtered.filter(q => q.text?.trim()).length;
  return nonEmptyRaw - nonEmptyFiltered;
}

const EXAMPLES_HEADER =
  'Examples of tag-query-quote triples:\n\n';

const NEGATIVE_EXAMPLES_HEADER =
  'Negative examples of tag-query-quote triples:\n\n';

function formatRowLine(row: TagQueryQuoteRow): string {
  return `- tag: ${row.tag}\n  query: ${row.query}\n  quote: ${row.quote}\n`;
}

function formatNegativeExampleLine(ex: AISearchNegativeExample): string {
  const tag = ex.schemaTag.trim();
  const query = ex.query.trim();
  const quoteText = ex.quote.trim();
  return `- tag: ${tag}\n  query: ${query}\n  should not return\n  quote: ${quoteText}\n`;
}

export function buildClaudeAISearchUserMessage(params: {
  rows: TagQueryQuoteRow[];
  schemaTag: string;
  searchQuery: string;
  negativeExamples?: AISearchNegativeExample[];
}): string {
  const { rows, schemaTag, searchQuery, negativeExamples } = params;
  let body = '';
  if (rows.length > 0) {
    body += EXAMPLES_HEADER;
    for (const row of rows) {
      body += formatRowLine(row);
    }
    body += '\n';
  }
  if (negativeExamples?.length) {
    body += NEGATIVE_EXAMPLES_HEADER;
    for (const ex of negativeExamples) {
      body += `${formatNegativeExampleLine(ex)}\n`;
    }
    body += '\n';
  }
  if (schemaTag.trim()) {
    body += `What retrieved verbatim quotes from the document would go with the tag "${schemaTag}" and the query "${searchQuery}"?`;
  } else {
    body += `New query: ${searchQuery}.`;
  }
  return body;
}
