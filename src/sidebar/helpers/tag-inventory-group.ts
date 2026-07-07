import type { SavedAnnotation } from '../../types/api';
import {
  NODE_LINK_STATE_TAG,
  NODE_LINK_STATE_VERSION_TAG,
} from '../node-link/graph-state';
import type { TagInventoryRow } from '../store/modules/sidebar-panels';
import { isReply, isSaved } from './annotation-metadata';
import { documentUriMatches } from './document-uri';
import { PUBLIC_GROUP_ID } from './groups';

/**
 * AI search schema tag helpers.
 *
 * Annotations carry Hypothesis **tags**. Besides system tags (`ai-pending`,
 * `ai-user-approved`), **schema tags** drive the inventory table and Claude few-shot
 * examples:
 *
 * - **Positive schema tag** — e.g. `methods` (match / teach the model what to find)
 * - **Negative schema tag** — e.g. `methods-neg-example` (teach what not to find;
 *   created on deny or by manual tag edit)
 *
 * These helpers classify tag strings and filter annotation tag lists. They do not
 * read annotation bodies or quotes.
 */

/** Suffix for negative schema tags derived from a positive schema tag. */
export const NEG_EXAMPLE_SCHEMA_TAG_SUFFIX = '-neg-example';

const AI_USER_APPROVED = 'ai-user-approved';
const AI_PENDING = 'ai-pending';

const DESCRIPTOR_SEP = '\0';

/** One inventory row per `(schemaTag, query)` within a group — not per document. */
export type TagInventoryRowDescriptor = {
  schemaTag: string;
  query: string;
};

export type ScopedTagInventoryRow = TagInventoryRow & {
  groupId?: string;
};

function norm(value: string): string {
  return value.trim();
}

function isAiSearchSystemTag(tag: string): boolean {
  return (
    tag === AI_USER_APPROVED ||
    tag === AI_PENDING ||
    tag === NODE_LINK_STATE_TAG ||
    tag === NODE_LINK_STATE_VERSION_TAG
  );
}

/**
 * True when `tag` is a positive content tag that can be converted to
 * `{tag}-neg-example` (not a system tag, not already negative).
 */
export function isConvertiblePositiveContentTag(tag: string): boolean {
  return !isAiSearchSystemTag(tag) && !isNegativeSchemaTag(tag);
}

/** Positive schema tag name for a negative schema tag, or null if not negative. */
export function positiveSchemaTagForNegativeTag(
  negativeTag: string,
): string | null {
  if (!isNegativeSchemaTag(negativeTag)) {
    return null;
  }
  return negativeTag.slice(0, -NEG_EXAMPLE_SCHEMA_TAG_SUFFIX.length);
}

/**
 * Replace one positive content tag with its `-neg-example` variant; strip
 * AI search system tags. Returns null if the tag cannot be converted.
 */
export function retagOnePositiveSchemaTagAsNegative(
  tags: string[],
  positiveTag: string,
): string[] | null {
  if (!isConvertiblePositiveContentTag(positiveTag) || !tags.includes(positiveTag)) {
    return null;
  }
  const withoutClickedAndSystem = tags.filter(
    t => t !== positiveTag && !isAiSearchSystemTag(t),
  );
  return [
    ...withoutClickedAndSystem,
    negativeSchemaTagForPositiveTag(positiveTag),
  ];
}

/**
 * Replace one negative schema tag with its positive form. Returns null if the
 * tag is not a negative schema tag or is absent from `tags`.
 */
export function retagOneNegativeSchemaTagAsPositive(
  tags: string[],
  negativeTag: string,
): string[] | null {
  const positiveTag = positiveSchemaTagForNegativeTag(negativeTag);
  if (!positiveTag || !tags.includes(negativeTag)) {
    return null;
  }
  return tags.map(t => (t === negativeTag ? positiveTag : t));
}

/** Whether a pill may offer "mark as negative example" for `tag`. */
export function canMarkTagAsNegativeExample(
  annotationTags: string[],
  tag: string,
): boolean {
  return (
    !annotationTags.includes(AI_PENDING) &&
    isConvertiblePositiveContentTag(tag)
  );
}

/** Whether a pill may offer "revert to positive example" for `tag`. */
export function canRevertNegativeExampleTag(
  annotationTags: string[],
  tag: string,
): boolean {
  return (
    !annotationTags.includes(AI_PENDING) && isNegativeSchemaTag(tag)
  );
}

/**
 * Convert all positive schema tags to `-neg-example` variants; strip system
 * tags and positive schema tags from the retained set.
 */
export function retagAllPositiveSchemaTagsAsNegative(tags: string[]): string[] {
  const positives = positiveSchemaTags(tags);
  const negativeTags = positives.map(negativeSchemaTagForPositiveTag);
  const retainedTags = tags.filter(
    t =>
      !isAiSearchSystemTag(t) &&
      !positives.includes(t),
  );
  return [...new Set([...retainedTags, ...negativeTags])];
}

/**
 * True when `tag` is a negative schema tag (`{name}-neg-example`).
 */
export function isNegativeSchemaTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (!trimmed.endsWith(NEG_EXAMPLE_SCHEMA_TAG_SUFFIX)) {
    return false;
  }
  return trimmed.length > NEG_EXAMPLE_SCHEMA_TAG_SUFFIX.length;
}

/**
 * Build the negative schema tag for a positive one (`methods` → `methods-neg-example`).
 */
export function negativeSchemaTagForPositiveTag(positiveSchemaTag: string): string {
  return `${norm(positiveSchemaTag)}${NEG_EXAMPLE_SCHEMA_TAG_SUFFIX}`;
}

/**
 * Positive schema tags on an annotation: non-empty, not system tags, not negative schema tags.
 */
export function positiveSchemaTags(annotationTags: string[]): string[] {
  return annotationTags.filter(
    tag => tag.trim() && !isAiSearchSystemTag(tag) && !isNegativeSchemaTag(tag),
  );
}

/**
 * Negative schema tags on an annotation (tags ending with `-neg-example`).
 */
export function negativeSchemaTags(annotationTags: string[]): string[] {
  return annotationTags.filter(isNegativeSchemaTag);
}

/** Stable key for an inventory row: `(schemaTag, query)` within one group. */
export function rowDescriptorKey(schemaTag: string, query: string): string {
  return `${norm(schemaTag)}${DESCRIPTOR_SEP}${norm(query)}`;
}

function schemaTagMatchesInventoryRow(
  schemaTagTrim: string,
  annTags: string[],
): boolean {
  if (schemaTagTrim) {
    return annTags.includes(schemaTagTrim);
  }
  return positiveSchemaTags(annTags).length === 0 && negativeSchemaTags(annTags).length === 0;
}

/**
 * Inventory row descriptors for a single annotation (may be multiple per tag).
 * Branch order: negative → ai-user-approved → ai-pending → manual.
 */
export function tagInventoryRowDescriptorsForAnnotation(
  ann: SavedAnnotation,
): TagInventoryRowDescriptor[] {
  if (!isSaved(ann) || isReply(ann)) {
    return [];
  }

  const tags = ann.tags ?? [];
  const textQuery = norm(ann.text ?? '');
  const out: TagInventoryRowDescriptor[] = [];

  const negativeTags = negativeSchemaTags(tags);
  if (negativeTags.length > 0) {
    for (const schemaTag of negativeTags) {
      out.push({ schemaTag, query: '' });
    }
    return out;
  }

  if (tags.includes(AI_USER_APPROVED)) {
    for (const schemaTag of positiveSchemaTags(tags)) {
      out.push({ schemaTag, query: textQuery });
    }
    return out;
  }

  if (tags.includes(AI_PENDING)) {
    for (const schemaTag of positiveSchemaTags(tags)) {
      out.push({ schemaTag, query: textQuery });
    }
    return out;
  }

  for (const schemaTag of positiveSchemaTags(tags)) {
    out.push({ schemaTag, query: '' });
  }

  return out;
}

/**
 * True when `ann` on `documentUri` belongs to the inventory row `(schemaTag, query)`
 * under derive-aligned membership rules.
 */
export function annotationBelongsToTagInventoryRow(
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

  const schemaTrim = norm(schemaTag);
  const queryTrim = norm(query);
  const annTags = ann.tags ?? [];

  if (!schemaTagMatchesInventoryRow(schemaTrim, annTags)) {
    return false;
  }

  const descriptors = tagInventoryRowDescriptorsForAnnotation(ann);
  if (
    descriptors.some(
      d => norm(d.schemaTag) === schemaTrim && norm(d.query) === queryTrim,
    )
  ) {
    return true;
  }

  // Empty-schema rows (not produced by per-annotation descriptors).
  if (!schemaTrim) {
    if (queryTrim !== '' && norm(ann.text ?? '') !== queryTrim) {
      return false;
    }
    return true;
  }

  return false;
}

/** Saved annotations belonging to an inventory row (derive-aligned membership). */
export function listAnnotationsBelongingToTagInventoryRow(
  annotations: SavedAnnotation[],
  documentUri: string,
  schemaTag: string,
  query: string,
  documentUriAliases: readonly string[] = [],
): SavedAnnotation[] {
  return annotations.filter(ann =>
    annotationBelongsToTagInventoryRow(
      ann,
      documentUri,
      schemaTag,
      query,
      documentUriAliases,
    ),
  );
}

/**
 * Saved annotations that belong to an inventory row under reconcile-aligned
 * membership rules (document-scoped for Public, group-wide for private).
 */
export function listAnnotationsForTagInventoryRow(
  annotations: SavedAnnotation[],
  row: Pick<TagInventoryRow, 'schemaTag' | 'query' | 'groupId'>,
  {
    focusedGroupId,
    documentUri,
    documentUriAliases = [],
  }: {
    focusedGroupId: string;
    documentUri?: string | null;
    documentUriAliases?: readonly string[];
  },
): SavedAnnotation[] {
  const groupId = row.groupId ?? focusedGroupId;
  if (groupId === PUBLIC_GROUP_ID) {
    if (!documentUri) {
      return [];
    }
    return listAnnotationsBelongingToTagInventoryRow(
      annotations.filter(ann => ann.group === groupId),
      documentUri,
      row.schemaTag,
      row.query,
      documentUriAliases,
    );
  }

  const schemaTrim = norm(row.schemaTag);
  const queryTrim = norm(row.query);
  return annotations.filter(ann => {
    if (!isSaved(ann) || isReply(ann) || ann.group !== groupId) {
      return false;
    }
    return tagInventoryRowDescriptorsForAnnotation(ann).some(
      d => norm(d.schemaTag) === schemaTrim && norm(d.query) === queryTrim,
    );
  });
}

/**
 * Count annotations for an inventory row using the same membership rules as
 * reconcile (`annotationIds`). Public rows are document-scoped; private rows
 * are group-wide (no document filter).
 */
export function countAnnotationsForTagInventoryRow(
  annotations: SavedAnnotation[],
  row: Pick<TagInventoryRow, 'schemaTag' | 'query' | 'groupId'>,
  scope: {
    focusedGroupId: string;
    documentUri?: string | null;
    documentUriAliases?: readonly string[];
  },
): number {
  return listAnnotationsForTagInventoryRow(annotations, row, scope).length;
}

/**
 * Derive inventory row descriptors from annotations (positive + negative schema tags).
 * Dedupes by `(schemaTag, query)` across all input annotations (including cross-URL
 * in a private group).
 */
export function deriveTagInventoryRowDescriptors(
  annotations: SavedAnnotation[],
): TagInventoryRowDescriptor[] {
  const seen = new Set<string>();
  const out: TagInventoryRowDescriptor[] = [];

  const push = (descriptor: TagInventoryRowDescriptor) => {
    const key = rowDescriptorKey(descriptor.schemaTag, descriptor.query);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(descriptor);
  };

  for (const ann of annotations) {
    for (const descriptor of tagInventoryRowDescriptorsForAnnotation(ann)) {
      push(descriptor);
    }
  }

  return out;
}

/** Inventory table visibility for the focused group. */
export function isTagInventoryRowVisibleInScope(
  row: ScopedTagInventoryRow,
  scope: {
    focusedGroupId: string;
    /**
     * Public group only: URI of the current document. Public group rows carry a
     * `documentUri` field and are only shown when it matches this value (or an
     * alias in `documentUriAliases`).
     * Private groups omit this; they use the prune mechanism instead.
     */
    currentDocumentUri?: string | null;
    /** Public group only: URIs equivalent to the current document (e.g. URN + HTTPS). */
    documentUriAliases?: readonly string[];
  },
): boolean {
  if (row.groupId !== scope.focusedGroupId) {
    return false;
  }
  if (scope.focusedGroupId === PUBLIC_GROUP_ID) {
    if (!scope.currentDocumentUri) {
      const aliases = scope.documentUriAliases ?? [];
      if (row.documentUri && aliases.includes(row.documentUri)) {
        return true;
      }
      return false;
    }
    return documentUriMatches(
      row.documentUri ?? '',
      scope.currentDocumentUri,
      scope.documentUriAliases ?? [],
    );
  }
  return true;
}

/**
 * Keep rows for other groups; for `groupId`, drop rows whose `(schemaTag, query)`
 * no longer appears in the derived set (annotation deleted on server).
 */
export function pruneTagInventoryRowsToDescriptors(
  rows: ScopedTagInventoryRow[],
  descriptors: TagInventoryRowDescriptor[],
  groupId: string,
): ScopedTagInventoryRow[] {
  const allowed = new Set(
    descriptors.map(d => rowDescriptorKey(d.schemaTag, d.query)),
  );

  return rows.filter(row => {
    if (row.groupId !== groupId) {
      return true;
    }
    return allowed.has(rowDescriptorKey(row.schemaTag, row.query));
  });
}

export function sortTagInventoryRows<T extends TagInventoryRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const tagCmp = norm(a.schemaTag).localeCompare(norm(b.schemaTag), undefined, {
      sensitivity: 'base',
    });
    if (tagCmp !== 0) {
      return tagCmp;
    }
    return norm(a.query).localeCompare(norm(b.query), undefined, {
      sensitivity: 'base',
    });
  });
}
