import {
  resolveDocumentUriFromCandidates,
  documentUriAliases,
  filterSavedAnnotationsForDocument,
} from '../helpers/document-uri';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { isTagInventoryRowVisibleInScope } from '../helpers/tag-inventory-group';
import {
  computeTagInventoryHighlightState,
  mergeVisibleTagHighlightPalette,
} from '../helpers/tag-palette';
import type { SidebarStore } from '../store';
import type { TagInventoryRow } from '../store/modules/sidebar-panels';
import { watch } from '../util/watch';
import type { FrameSyncService } from './frame-sync';

const lastPalettePushSignatures = new WeakMap<FrameSyncService, string>();

function savedAnnotationSignature(
  store: Pick<SidebarStore, 'savedAnnotations'>,
): string {
  return store
    .savedAnnotations()
    .map(ann => ann.id ?? '')
    .join('\n');
}

export function pushTagPalette(
  frameSync: FrameSyncService,
  store: SidebarStore,
) {
  const tagInventory = store.getState().sidebarPanels.tagInventory;
  const focusedGroupId = store.focusedGroupId();
  const docUri = resolveDocumentUriFromCandidates(store, [
    ...documentUriAliases(store),
  ]);
  const uriAliases = documentUriAliases(store);
  const annotations =
    focusedGroupId === PUBLIC_GROUP_ID
      ? filterSavedAnnotationsForDocument(
          store.savedAnnotations(),
          focusedGroupId,
          uriAliases,
        )
      : focusedGroupId
        ? store.savedAnnotations().filter(ann => ann.group === focusedGroupId)
        : [];

  // Only the focused group's visible rows contribute highlight colors, so the
  // PDF palette matches the (group-scoped) inventory table.
  const visibleRows = focusedGroupId
    ? (tagInventory.rows as TagInventoryRow[]).filter((row: TagInventoryRow) =>
        isTagInventoryRowVisibleInScope(row, {
          focusedGroupId,
          currentDocumentUri: docUri,
          documentUriAliases: uriAliases,
        }),
      )
    : [];

  const scope = focusedGroupId
    ? {
        focusedGroupId,
        currentDocumentUri: docUri,
        documentUriAliases: [...uriAliases],
      }
    : { focusedGroupId: null };

  const { hiddenAnnotationIds } = computeTagInventoryHighlightState(
    tagInventory.rows as TagInventoryRow[],
    scope,
    annotations,
  );

  const palette = mergeVisibleTagHighlightPalette(
    visibleRows,
    tagInventory.schemaTagColors,
  );

  const signature = JSON.stringify({
    focusedGroupId,
    docUri,
    palette: Object.entries(palette).sort(([a], [b]) => a.localeCompare(b)),
    hidden: [...hiddenAnnotationIds].sort(),
    annSig: savedAnnotationSignature(store),
  });
  if (signature === lastPalettePushSignatures.get(frameSync)) {
    return;
  }
  lastPalettePushSignatures.set(frameSync, signature);

  frameSync.setTagHighlightPalette(palette, hiddenAnnotationIds);
}

export function setupTagPaletteSync(
  frameSync: FrameSyncService,
  store: SidebarStore,
) {
  watch(
    store.subscribe,
    () =>
      [
        store.getState().sidebarPanels.tagInventory,
        store.focusedGroupId(),
        resolveDocumentUriFromCandidates(store, [...documentUriAliases(store)]),
        documentUriAliases(store),
        savedAnnotationSignature(store),
      ] as const,
    () => {
      pushTagPalette(frameSync, store);
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );

  pushTagPalette(frameSync, store);
}
