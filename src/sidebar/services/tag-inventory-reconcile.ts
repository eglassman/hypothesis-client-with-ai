import type { SavedAnnotation } from '../../types/api';
import { resolveDocumentUriFromCandidates } from '../helpers/document-uri';
import {
  deriveTagInventoryRowDescriptors,
  isTagInventoryRowVisibleInScope,
  listAnnotationsForTagInventoryRow,
  countAnnotationsForTagInventoryRow,
} from '../helpers/tag-inventory-group';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { tagInventoryRowId } from '../store/modules/sidebar-panels';
import type { SidebarStore } from '../store';
import { isSaved } from '../helpers/annotation-metadata';

export type ApplyDerivedTagInventoryRowsOptions = {
  groupId: string;
  /** Annotations used to derive which rows exist. */
  annotations: SavedAnnotation[];
  /** Annotations used to compute `annotationIds` (defaults to `annotations`). */
  idSourceAnnotations?: SavedAnnotation[];
  /** Current document URI. Stored on Public group rows and included in their id. */
  documentUri?: string;
  documentUriAliases?: readonly string[];
};

function norm(value: string): string {
  return value.trim();
}

/**
 * Upsert inventory rows from derived descriptors and set authoritative
 * `annotationIds` per row via replace semantics.
 */
export function applyDerivedTagInventoryRows(
  store: Pick<
    SidebarStore,
    'addTagInventoryRow' | 'setTagInventoryRowAnnotationIds' | 'tagInventoryRows'
  >,
  {
    groupId,
    annotations,
    idSourceAnnotations,
    documentUri,
    documentUriAliases = [],
  }: ApplyDerivedTagInventoryRowsOptions,
) {
  const isPublic = groupId === PUBLIC_GROUP_ID;
  const docUri = isPublic ? documentUri : undefined;

  // Public group rows must be document-scoped. If the URI is unknown (e.g.
  // mainFrame hasn't re-registered after the sidebar opened), skip rather
  // than creating permanently-invisible rows with documentUri=''.
  if (isPublic && !docUri) {
    return;
  }

  const idSource = idSourceAnnotations ?? annotations;
  const aliases = documentUriAliases;
  const descriptors = deriveTagInventoryRowDescriptors(annotations);
  const descriptorKeys = new Set(
    descriptors.map(d => `${d.schemaTag}\0${d.query}`),
  );

  for (const { schemaTag, query } of descriptors) {
    const rowId = tagInventoryRowId(schemaTag, query, groupId, docUri);
    store.addTagInventoryRow({
      id: rowId,
      groupId,
      schemaTag,
      query,
      annotationIds: [],
      ...(docUri !== undefined ? { documentUri: docUri } : {}),
    });
    const rowRef = {
      schemaTag,
      query,
      groupId,
    };
    const scope = {
      focusedGroupId: groupId,
      documentUri: docUri ?? null,
      documentUriAliases: aliases,
    };
    const derivedIds = listAnnotationsForTagInventoryRow(idSource, rowRef, scope)
      .map(ann => ann.id)
      .filter((id): id is string => typeof id === 'string');
    store.setTagInventoryRowAnnotationIds(rowId, derivedIds);
  }

  // Clear stale IDs on in-scope rows that still exist but have no descriptor
  // (e.g. all annotations removed) or were not in this derive pass.
  for (const row of store.tagInventoryRows()) {
    if (row.groupId !== groupId) {
      continue;
    }
    if (
      !isTagInventoryRowVisibleInScope(row, {
        focusedGroupId: groupId,
        currentDocumentUri: docUri ?? documentUri,
        documentUriAliases: aliases,
      })
    ) {
      continue;
    }
    const key = `${row.schemaTag}\0${row.query}`;
    if (descriptorKeys.has(key)) {
      continue;
    }
    const liveCount = countAnnotationsForTagInventoryRow(idSource, row, {
      focusedGroupId: groupId,
      documentUri: docUri ?? null,
      documentUriAliases: aliases,
    });
    if (liveCount > 0) {
      continue;
    }
    store.setTagInventoryRowAnnotationIds(row.id, []);
  }
}

/**
 * Assign `documentUri` to legacy Public rows that predate document-scoped ids.
 * Re-keys rows via upsert + removes the old id when it changes.
 */
export function backfillPublicTagInventoryDocumentUris(
  store: Pick<
    SidebarStore,
    | 'addTagInventoryRow'
    | 'removeTagInventoryRow'
    | 'tagInventoryRows'
    | 'mainFrame'
    | 'defaultContentFrame'
    | 'searchUris'
  >,
) {
  const documentUri = resolveDocumentUriFromCandidates(store);
  if (!documentUri) {
    return;
  }

  for (const row of store.tagInventoryRows()) {
    if (row.groupId !== PUBLIC_GROUP_ID || row.documentUri) {
      continue;
    }
    const migratedId = tagInventoryRowId(
      row.schemaTag,
      row.query,
      row.groupId,
      documentUri,
    );
    store.addTagInventoryRow({
      ...row,
      id: migratedId,
      documentUri,
    });
    if (row.id !== migratedId) {
      store.removeTagInventoryRow(row.id);
    }
  }
}
