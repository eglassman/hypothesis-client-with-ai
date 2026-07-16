import { useMemo } from 'preact/hooks';

import { resolveDocumentUriFromCandidates, documentUriAliases } from '../../helpers/document-uri';
import { computeTagInventoryHighlightState } from '../../helpers/tag-palette';
import { threadAnnotations } from '../../helpers/thread-annotations';
import type {
  ThreadAnnotationsResult,
  ThreadState,
} from '../../helpers/thread-annotations';
import { useSidebarStore } from '../../store';

/**
 * Gather together state relevant to building a root thread of annotations and
 * replies and return an updated root thread when changes occur.
 */
export function useRootThread(): ThreadAnnotationsResult {
  const store = useSidebarStore();
  const annotations = store.allAnnotations();
  const query = store.filterQuery();
  const route = store.route();
  const selectionState = store.selectionState();
  const filters = store.getFilterValues();
  const showTabs = route === 'sidebar';
  const focusedGroupId = store.focusedGroupId();
  const tagInventoryRows = store.tagInventoryRows();
  const uriAliases = documentUriAliases(store);
  const documentUri = resolveDocumentUriFromCandidates(store, [...uriAliases]);

  const threadState = useMemo((): ThreadState => {
    const selection = { ...selectionState, filterQuery: query, filters };
    const hiddenAnnotationIds = focusedGroupId
      ? new Set(
          computeTagInventoryHighlightState(tagInventoryRows, {
            focusedGroupId,
            currentDocumentUri: documentUri,
            documentUriAliases: uriAliases,
          }).hiddenAnnotationIds,
        )
      : new Set<string>();
    return {
      annotations,
      selection,
      showTabs,
      hiddenAnnotationIds,
    };
  }, [
    selectionState,
    query,
    filters,
    annotations,
    showTabs,
    focusedGroupId,
    tagInventoryRows,
    documentUri,
    uriAliases,
  ]);

  return threadAnnotations(threadState);
}
