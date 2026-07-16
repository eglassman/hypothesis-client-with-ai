import type { SavedAnnotation } from '../../types/api';
import {
  isTagInventoryRowVisibleInScope,
  listAnnotationsForTagInventoryRow,
} from './tag-inventory-group';
import type { TagInventoryRow } from '../store/modules/sidebar-panels';

/**
 * Default tag → highlight map for AI flows; merged with per–schema-tag colors from Redux.
 */
export const INITIAL_AI_TAG_HIGHLIGHT_PALETTE: Record<string, string> = {
  'ai-pending': 'rgba(64, 169, 255, 0.38)',
  'ai-user-approved': 'rgba(255, 64, 223, 0.38)',
};

export type TagInventoryHighlightScope = {
  focusedGroupId: string;
  currentDocumentUri: string | null;
  documentUriAliases: string[];
};

export type TagInventoryHighlightState = {
  /** Hide only when the annotation is not on any visible (non-hidden) row. */
  hiddenAnnotationIds: string[];
};

export function computeTagInventoryHighlightState(
  rows: TagInventoryRow[],
  scope: TagInventoryHighlightScope | { focusedGroupId: null },
  annotations: SavedAnnotation[] = [],
): TagInventoryHighlightState {
  if (!scope.focusedGroupId) {
    return { hiddenAnnotationIds: [] };
  }

  const scopedRows = rows.filter(row =>
    isTagInventoryRowVisibleInScope(row, {
      focusedGroupId: scope.focusedGroupId,
      currentDocumentUri: scope.currentDocumentUri,
      documentUriAliases: scope.documentUriAliases,
    }),
  );

  const rowAnnotationIds = (row: TagInventoryRow): string[] => {
    if (annotations.length > 0) {
      return listAnnotationsForTagInventoryRow(annotations, row, {
        focusedGroupId: scope.focusedGroupId!,
        documentUri: scope.currentDocumentUri,
        documentUriAliases: scope.documentUriAliases,
      })
        .map(ann => ann.id)
        .filter((id): id is string => typeof id === 'string');
    }
    return row.annotationIds ?? [];
  };

  const visibleIdSet = new Set(
    scopedRows
      .filter(row => row.hidden !== true)
      .flatMap(row => rowAnnotationIds(row)),
  );

  const hiddenAnnotationIds = [
    ...new Set(
      scopedRows
        .filter(row => row.hidden === true)
        .flatMap(row => rowAnnotationIds(row))
        .filter(id => !visibleIdSet.has(id)),
    ),
  ].sort();

  return { hiddenAnnotationIds };
}

export function mergeTagHighlightPalette(
  schemaTagColors: Record<string, string>,
): Record<string, string> {
  return { ...INITIAL_AI_TAG_HIGHLIGHT_PALETTE, ...schemaTagColors };
}

type TagPaletteRow = {
  schemaTag: string;
  hidden?: boolean;
};

/**
 * Merge defaults with tag colors for schema tags that appear in at least one
 * visible (non-hidden) tag inventory row.
 */
export function mergeVisibleTagHighlightPalette(
  rows: TagPaletteRow[],
  schemaTagColors: Record<string, string>,
): Record<string, string> {
  const visibleTags = new Set(
    rows
      .filter(row => row.hidden !== true)
      .map(row => row.schemaTag.trim())
      .filter(tag => tag.length > 0),
  );

  const visibleSchemaTagColors = Object.fromEntries(
    Object.entries(schemaTagColors).filter(([tag]) => visibleTags.has(tag.trim())),
  );

  return mergeTagHighlightPalette(visibleSchemaTagColors);
}
