import type { SavedAnnotation } from '../../types/api';
import type { AnnotationsService } from '../services/annotations';
import { isReply, isSaved, quote } from './annotation-metadata';
import { documentUriMatches } from './document-uri';
import {
  negativeSchemaTags,
  positiveSchemaTagForNegativeTag,
  positiveSchemaTags,
} from './tag-inventory-group';

export type AiSearchQuoteItem = { text?: string };

const AI_USER_APPROVED = 'ai-user-approved';
const AI_PENDING = 'ai-pending';

export type FewShotExampleRow = {
  tag: string;
  query: string;
  quote: string;
};

export type TagReferencePromptEntry = {
  tag: string;
  annotationCount: number;
  descriptive: boolean;
  outgoingRelationships: Array<{
    relationship: string;
    targetTag: string;
  }>;
  incomingRelationships: Array<{
    sourceTag: string;
    relationship: string;
  }>;
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
  return positiveSchemaTags(tags).join(', ');
}

function formatTagColumnForSetB(tags: string[]): string {
  return positiveSchemaTags(tags).join(', ');
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
 * Caller passes an already-scoped annotation list (document or group).
 */
export function buildCandidateRows(
  annotations: SavedAnnotation[],
): CandidateRow[] {
  const candidates: CandidateRow[] = [];
  let index = 0;

  for (const ann of annotations) {
    if (!isSaved(ann)) {
      continue;
    }

    const q = quote(ann);
    if (q === null || q === undefined || !q.trim()) {
      continue;
    }

    const tags = ann.tags ?? [];

    if (tags.includes(AI_USER_APPROVED)) {
      const tagColumn = formatTagColumnForSetA(tags);
      if (!tagColumn) {
        continue;
      }
      candidates.push({
        annotation: ann,
        set: 'A',
        tag: tagColumn,
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

    const tagColumn = formatTagColumnForSetB(tags);
    if (!tagColumn) {
      continue;
    }

    candidates.push({
      annotation: ann,
      set: 'B',
      tag: tagColumn,
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
 * Collect and dedupe approved positive examples from saved annotations.
 */
export async function collectPositiveExamplesFromAnnotations(
  annotations: SavedAnnotation[],
  annotationsService: AnnotationsService,
): Promise<FewShotExampleRow[]> {
  const candidates = buildCandidateRows(annotations);
  const deduped = await dedupeTagQueryRows(candidates, annotationsService);
  return deduped.map(r => ({
    tag: r.tag,
    query: r.query,
    quote: r.quote,
  }));
}

/**
 * Map annotations with `-neg-example` tags to few-shot negative rows.
 */
export function collectNegativeExamplesFromAnnotations(
  annotations: SavedAnnotation[],
): FewShotExampleRow[] {
  const rows: FewShotExampleRow[] = [];

  for (const ann of annotations) {
    if (!isSaved(ann) || isReply(ann)) {
      continue;
    }
    const q = quote(ann);
    if (q === null || q === undefined || !norm(q)) {
      continue;
    }
    for (const tag of negativeSchemaTags(ann.tags ?? [])) {
      const baseTag = positiveSchemaTagForNegativeTag(tag) ?? tag;
      rows.push({
        tag: baseTag,
        query: ann.text ?? '',
        quote: q,
      });
    }
  }

  return rows;
}

/**
 * Tags other than ai-pending / ai-user-approved (schema and user tags).
 * Exported for AI search delete-all (content-tag count) and tests.
 */
export function aiSearchContentTags(tags: string[]): string[] {
  return tags.filter(t => t !== AI_USER_APPROVED && t !== AI_PENDING);
}

function contentTags(tags: string[]): string[] {
  return aiSearchContentTags(tags);
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
  documentUriAliases: readonly string[] = [],
): boolean {
  for (const ann of annotations) {
    if (
      !isSaved(ann) ||
      !documentUriMatches(ann.uri, documentUri, documentUriAliases)
    ) {
      continue;
    }
    if (isReply(ann)) {
      continue;
    }
    const q = quote(ann);
    if (q === null || q === undefined || !norm(q)) {
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
  documentUriAliases: readonly string[] = [],
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
      documentUriAliases,
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

/**
 * True if a saved annotation belongs to an AI search history row: same document,
 * body text equals the row query (trimmed), schema tag matches, not a reply.
 * Includes ai-pending, ai-user-approved, and manually authored rows with that tag+query.
 */
export function savedAnnotationMatchesTagInventoryRow(
  ann: SavedAnnotation,
  documentUri: string,
  schemaTag: string,
  query: string,
  documentUriAliases: readonly string[] = [],
): boolean {
  if (
    !isSaved(ann) ||
    !documentUriMatches(ann.uri, documentUri, documentUriAliases)
  ) {
    return false;
  }
  if (isReply(ann)) {
    return false;
  }
  const annText = norm(ann.text ?? '');
  const queryTrim = norm(query);
  if (queryTrim !== '' && annText !== queryTrim) {
    return false;
  }
  if (!schemaTagMatchesSearchRow(norm(schemaTag), ann.tags ?? [])) {
    return false;
  }
  return true;
}

/** Pick for a hidden AI search history row passed into thread-list filtering. */
export type HiddenTagInventoryRowMatch = {
  schemaTag: string;
  query: string;
};

/**
 * True when `ann` on `documentUri` matches any hidden history row (same tag+query
 * semantics as {@link savedAnnotationMatchesTagInventoryRow}).
 */
export function annotationMatchesHiddenTagInventoryRow(
  ann: SavedAnnotation,
  documentUri: string,
  hiddenRows: HiddenTagInventoryRowMatch[],
  documentUriAliases: readonly string[] = [],
): boolean {
  return hiddenRows.some(row =>
    savedAnnotationMatchesTagInventoryRow(
      ann,
      documentUri,
      row.schemaTag,
      row.query,
      documentUriAliases,
    ),
  );
}

/**
 * Expected tag list for AI-created pending annotations (strict match for rerun / delete pending).
 */
export function expectedTagsForStrictAISearchPending(
  schemaTagTrimmed: string,
): string[] {
  return schemaTagTrimmed ? [AI_PENDING, schemaTagTrimmed] : [AI_PENDING];
}

/**
 * True if tags are exactly `['ai-pending']` or `['ai-pending', schemaTag]` in order.
 */
export function tagsMatchStrictAISearchPending(
  tags: string[] | undefined,
  schemaTagTrimmed: string,
): boolean {
  const expected = expectedTagsForStrictAISearchPending(schemaTagTrimmed);
  const t = tags ?? [];
  if (t.length !== expected.length) {
    return false;
  }
  return expected.every((x, i) => t[i] === x);
}

/**
 * Strict AI pending: same document, query text, and exact pending tag shape as rerun.
 */
export function savedAnnotationIsStrictAISearchPending(
  ann: SavedAnnotation,
  documentUri: string,
  schemaTag: string,
  query: string,
  documentUriAliases: readonly string[] = [],
): boolean {
  if (
    !isSaved(ann) ||
    !documentUriMatches(ann.uri, documentUri, documentUriAliases)
  ) {
    return false;
  }
  const schemaTagTrim = norm(schemaTag);
  if (!tagsMatchStrictAISearchPending(ann.tags, schemaTagTrim)) {
    return false;
  }
  return norm(ann.text ?? '') === norm(query);
}

/**
 * Count of strict pending annotations for this row (matches delete pending / rerun).
 */
export function countTagInventoryRowPendingAnnotations(
  annotations: SavedAnnotation[],
  documentUri: string,
  schemaTag: string,
  query: string,
  documentUriAliases: readonly string[] = [],
): number {
  return countIf(annotations, ann =>
    savedAnnotationIsStrictAISearchPending(
      ann,
      documentUri,
      schemaTag,
      query,
      documentUriAliases,
    ),
  );
}

/**
 * All saved annotations matching this row's Total (tag + query + document).
 */
export function listSavedAnnotationsMatchingTagInventoryRow(
  annotations: SavedAnnotation[],
  documentUri: string,
  schemaTag: string,
  query: string,
  documentUriAliases: readonly string[] = [],
): SavedAnnotation[] {
  return annotations.filter(ann =>
    savedAnnotationMatchesTagInventoryRow(
      ann,
      documentUri,
      schemaTag,
      query,
      documentUriAliases,
    ),
  );
}

/**
 * Strict pending list for delete pending / rerun.
 */
export function listStrictTagInventoryRowPendingAnnotations(
  annotations: SavedAnnotation[],
  documentUri: string,
  schemaTag: string,
  query: string,
  documentUriAliases: readonly string[] = [],
): SavedAnnotation[] {
  return annotations.filter(ann =>
    savedAnnotationIsStrictAISearchPending(
      ann,
      documentUri,
      schemaTag,
      query,
      documentUriAliases,
    ),
  );
}

export type AISearchDeleteAllAction = 'removeRowTag' | 'deleteAnnotation';

/**
 * For an annotation that matches this row's Total, choose PATCH (remove schema tag) vs full delete.
 * Empty-schema rows always delete (no tag to strip).
 */
export function deleteAllActionForTagInventoryRowMatch(
  ann: SavedAnnotation,
  rowSchemaTagTrimmed: string,
): AISearchDeleteAllAction {
  if (!norm(rowSchemaTagTrimmed)) {
    return 'deleteAnnotation';
  }
  const ct = aiSearchContentTags(ann.tags ?? []);
  if (ct.length > 1) {
    return 'removeRowTag';
  }
  return 'deleteAnnotation';
}

/**
 * Tags after removing this row's schema tag (for PATCH). Removes all occurrences of `tagToRemove`.
 */
export function tagsAfterRemovingTagInventoryRowSchemaTag(
  tags: string[] | undefined,
  schemaTagTrimmed: string,
): string[] {
  const t = norm(schemaTagTrimmed);
  if (!t) {
    return tags ?? [];
  }
  return (tags ?? []).filter(tag => tag !== t);
}

/**
 * Total annotations for this row: pending, user-approved, or manual, matching tag+query.
 */
export function countTagInventoryRowTotalAnnotations(
  annotations: SavedAnnotation[],
  documentUri: string,
  schemaTag: string,
  query: string,
  documentUriAliases: readonly string[] = [],
): number {
  return countIf(annotations, ann =>
    savedAnnotationMatchesTagInventoryRow(
      ann,
      documentUri,
      schemaTag,
      query,
      documentUriAliases,
    ),
  );
}

function countIf<T>(items: T[], pred: (item: T) => boolean): number {
  let n = 0;
  for (const item of items) {
    if (pred(item)) {
      n++;
    }
  }
  return n;
}

const EXAMPLES_HEADER = 'Examples of tag-query-quote triples:\n\n';

const NEGATIVE_EXAMPLES_HEADER =
  'Negative examples of tag-query-quote triples:\n\n';

const RELATIONSHIPS_HEADER =
  'These tags have the following relationships to each other:\n';

export type FewShotExampleKind = 'positive' | 'negative';

export function formatFewShotExampleLine(
  row: FewShotExampleRow,
  { kind }: { kind: FewShotExampleKind },
): string {
  const tag = row.tag.trim();
  const query = row.query.trim();
  const quoteText = row.quote.trim();
  if (kind === 'negative') {
    return `- tag: ${tag}\n  query: ${query}\n  should not return\n  quote: ${quoteText}\n`;
  }
  return `- tag: ${tag}\n  query: ${query}\n  quote: ${quoteText}\n`;
}

function parseTagsFromExampleRow(row: FewShotExampleRow): string[] {
  const parts = row.tag.split(',').map(part => part.trim());
  if (parts.length === 1 && parts[0] === '') {
    return [''];
  }
  return parts.filter(Boolean);
}

function examplesForTag(
  examples: FewShotExampleRow[],
  tag: string,
): FewShotExampleRow[] {
  return examples.filter(row => parseTagsFromExampleRow(row).includes(tag));
}

function tagReferenceEntryForTag(
  entries: TagReferencePromptEntry[],
  tag: string,
): TagReferencePromptEntry | undefined {
  return entries.find(entry => entry.tag === tag);
}

function collectPromptTags(
  positiveExamples: FewShotExampleRow[],
  negativeExamples: FewShotExampleRow[],
  tagReference: TagReferencePromptEntry[],
): string[] {
  const tags = new Set<string>();

  for (const row of positiveExamples) {
    for (const tag of parseTagsFromExampleRow(row)) {
      tags.add(tag);
    }
  }
  for (const row of negativeExamples) {
    for (const tag of parseTagsFromExampleRow(row)) {
      tags.add(tag);
    }
  }
  for (const entry of tagReference) {
    if (entry.outgoingRelationships.length > 0) {
      tags.add(entry.tag);
    }
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

function formatTagSectionTitle(tag: string): string {
  return `Tag: ${tag}\n\n`;
}

function formatTagOutgoingRelationshipLines(
  entry: TagReferencePromptEntry,
): string {
  let lines = '';
  for (const rel of entry.outgoingRelationships) {
    lines += `${entry.tag} ${rel.relationship} ${rel.targetTag}\n`;
  }
  return lines;
}

export function buildClaudeAISearchUserMessage(params: {
  positiveExamples: FewShotExampleRow[];
  schemaTag: string;
  searchQuery: string;
  negativeExamples?: FewShotExampleRow[];
  tagReference?: TagReferencePromptEntry[];
}): string {
  const {
    positiveExamples,
    schemaTag,
    searchQuery,
    negativeExamples = [],
    tagReference = [],
  } = params;
  let body = '';

  for (const tag of collectPromptTags(
    positiveExamples,
    negativeExamples,
    tagReference,
  )) {
    const positiveForTag = examplesForTag(positiveExamples, tag);
    const negativeForTag = examplesForTag(negativeExamples, tag);
    const referenceEntry = tagReferenceEntryForTag(tagReference, tag);
    const hasOutgoingRelationships =
      (referenceEntry?.outgoingRelationships.length ?? 0) > 0;

    if (
      positiveForTag.length === 0 &&
      negativeForTag.length === 0 &&
      !hasOutgoingRelationships
    ) {
      continue;
    }

    body += formatTagSectionTitle(tag);

    if (positiveForTag.length > 0) {
      body += EXAMPLES_HEADER;
      for (const row of positiveForTag) {
        body += formatFewShotExampleLine(row, { kind: 'positive' });
      }
      body += '\n';
    }

    if (negativeForTag.length > 0) {
      body += NEGATIVE_EXAMPLES_HEADER;
      for (const row of negativeForTag) {
        body += `${formatFewShotExampleLine(row, { kind: 'negative' })}\n`;
      }
      body += '\n';
    }

    if (hasOutgoingRelationships && referenceEntry) {
      body += RELATIONSHIPS_HEADER;
      body += formatTagOutgoingRelationshipLines(referenceEntry);
      body += '\n';
    }
  }

  if (schemaTag.trim()) {
    body += `What retrieved verbatim quotes from the document would go with the tag "${schemaTag}" and the query "${searchQuery}"?`;
  } else {
    body += `New query: ${searchQuery}.`;
  }
  return body;
}
