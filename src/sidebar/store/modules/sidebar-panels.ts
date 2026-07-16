/**
 * This module handles the state for `SidebarPanel` components used in the app.
 * It keeps track of the "active" `panelName` (simple string) and allows the
 * opening, closing or toggling of panels via their `panelName`. It merely
 * retains the `panelName` state as a string: it has no understanding nor
 * opinions about whether a given `panelName` corresponds to one or more
 * extant `SidebarPanel` components. Only one panel (as keyed by `panelName`)
 * may be "active" (open) at one time.
 *
 * Also holds tag inventory state for the AI search panel (`tagInventory`). Rows and colors are
 * hydrated from `localStorage` at startup and kept in sync across tabs by
 * `PersistedTagInventoryService`.
 */
import type { PanelName } from '../../../types/sidebar';
import { highlightRgbaFromString } from '../../../shared/tag-color-from-string';
import {
  pruneTagInventoryRowsToDescriptors,
  type TagInventoryRowDescriptor,
} from '../../helpers/tag-inventory-group';
import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import { createStoreModule, makeAction } from '../create-store';

function normalizedTagInventoryRowId(row: TagInventoryRow): string {
  if (row.groupId === PUBLIC_GROUP_ID && row.documentUri) {
    return tagInventoryRowId(
      row.schemaTag,
      row.query,
      row.groupId,
      row.documentUri,
    );
  }
  return tagInventoryRowId(row.schemaTag, row.query, row.groupId);
}

export type TagInventoryRow = {
  id: string;
  schemaTag: string;
  query: string;
  annotationIds: string[];
  /** Focused group when the row was created or synced. */
  groupId?: string;
  /**
   * Public group only: document URI this row was derived from.
   * Private groups omit this field and use the prune mechanism instead.
   */
  documentUri?: string;
  /** When true, row can be filtered out of the inventory table (see AISearchPanel). */
  hidden?: boolean;
};

/**
 * Stable, deterministic id for a tag inventory row.
 * For Public group rows, pass `documentUri` to make the id document-scoped
 * (replaces the separate publicGroupDocumentDescriptorKeys store slice).
 * For private group rows, omit `documentUri`; the prune mechanism handles
 * document-scoping there.
 */
export function tagInventoryRowId(
  schemaTag: string,
  query: string,
  groupId: string | undefined,
  documentUri?: string,
): string {
  const base = `${schemaTag.trim()}\0${query.trim()}\0${groupId ?? ''}`;
  return encodeURIComponent(
    documentUri !== undefined ? `${base}\0${documentUri}` : base,
  );
}

export type TagInventoryState = {
  rows: TagInventoryRow[];
  schemaTagColors: Record<string, string>;
};

/** Single-participant HCI experiment log (persisted via `PersistedTagInventoryService`). */
export type ExperimentEvent =
  | {
      type: 'search';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
      annotationIdsCreated: string[];
      /** Parallel to `annotationIdsCreated` (same length when present). Omitted in older logs. */
      quoteTexts?: string[];
    }
  | {
      type: 'accept';
      timestamp: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'reject';
      timestamp: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'rerun-search';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
    }
  | {
      type: 'delete-pending';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
    }
  | {
      type: 'delete-all';
      timestamp: string;
      documentUri: string;
      searchRowId: string;
      query: string;
      schemaTag: string;
    }
  | {
      type: 'annotation-deleted';
      timestamp: string;
      documentUri: string;
      annotationId: string;
      quoteText: string;
      schemaTag: string;
    }
  | {
      type: 'reclassify-as-manual';
      timestamp: string;
      documentUri: string;
      annotationId: string;
      schemaTag: string;
      originalQuery: string;
      newText: string;
      quoteText: string;
      reason: 'text-change' | 'schema-tag-removed';
      removedSchemaTags?: string[];
    };

export type ExperimentLogState = {
  version: 1;
  events: ExperimentEvent[];
};

export type State = {
  /**
   * The `panelName` of the currently-active sidebar panel.
   * Only one `panelName` may be active at a time, but it is valid (though not
   * the standard use case) for multiple `SidebarPanel` components to share
   * the same `panelName`—`panelName` is not intended as a unique ID/key.
   *
   * e.g. If `activePanelName` were `foobar`, all `SidebarPanel` components
   * with `panelName` of `foobar` would be active, and thus visible.
   */
  activePanelName: PanelName | null;

  /** Table rows and per–schema-tag highlight colors for the AI search panel. */
  tagInventory: TagInventoryState;

  /** AI search experiment log; persisted under `hypothesis.aiSearch.experimentLog`. */
  experimentLog: ExperimentLogState;
};

const initialTagInventory: TagInventoryState = {
  rows: [],
  schemaTagColors: {},
};

export const emptyExperimentLog = (): ExperimentLogState => ({
  version: 1,
  events: [],
});

const initialState: State = {
  activePanelName: null,
  tagInventory: initialTagInventory,
  experimentLog: emptyExperimentLog(),
};

const reducers = {
  OPEN_SIDEBAR_PANEL(state: State, action: { panelName: PanelName }) {
    return { activePanelName: action.panelName };
  },

  CLOSE_SIDEBAR_PANEL(state: State, action: { panelName: PanelName }) {
    let activePanelName = state.activePanelName;
    if (action.panelName === activePanelName) {
      // `action.panelName` is indeed the currently-active panel; deactivate
      activePanelName = null;
    }
    // `action.panelName` is not the active panel; nothing to do here
    return {
      activePanelName,
    };
  },

  TOGGLE_SIDEBAR_PANEL(
    state: State,
    action: { panelName: PanelName; panelState?: boolean },
  ) {
    let activePanelName;
    // Is the panel in question currently the active panel?
    const panelIsActive = state.activePanelName === action.panelName;
    // What state should the panel in question move to next?
    const panelShouldBeActive =
      typeof action.panelState !== 'undefined'
        ? action.panelState
        : !panelIsActive;

    if (panelShouldBeActive) {
      // If the specified panel should be open (active), set it as active
      activePanelName = action.panelName;
    } else if (panelIsActive && !panelShouldBeActive) {
      // If the specified panel is currently open (active), but it shouldn't be anymore
      activePanelName = null;
    } else {
      // This panel is already inactive; do nothing
      activePanelName = state.activePanelName;
    }

    return {
      activePanelName,
    };
  },

  ADD_TAG_INVENTORY_ROW(state: State, action: { row: TagInventoryRow }) {
    const { row } = action;
    const existing = state.tagInventory.rows.find(r => r.id === row.id);
    if (existing) {
      const unionIds = [
        ...new Set([...(existing.annotationIds ?? []), ...(row.annotationIds ?? [])]),
      ];
      const existingIds = existing.annotationIds ?? [];
      if (
        unionIds.length === existingIds.length &&
        unionIds.every((id, i) => id === existingIds[i])
      ) {
        return state;
      }
      return {
        tagInventory: {
          ...state.tagInventory,
          rows: state.tagInventory.rows.map(r =>
            r.id === row.id ? { ...r, annotationIds: unionIds } : r,
          ),
        },
      };
    }
    let { schemaTagColors } = state.tagInventory;
    const tag = row.schemaTag.trim();
    if (tag && schemaTagColors[tag] === undefined) {
      schemaTagColors = {
        ...schemaTagColors,
        [tag]: highlightRgbaFromString(tag),
      };
    }
    return {
      tagInventory: { rows: [row, ...state.tagInventory.rows], schemaTagColors },
    };
  },

  SET_TAG_INVENTORY_ROW_HIDDEN(
    state: State,
    action: { rowId: string; hidden: boolean },
  ) {
    return {
      tagInventory: {
        ...state.tagInventory,
        rows: state.tagInventory.rows.map(r => {
          if (r.id !== action.rowId) {
            return r;
          }
          if (action.hidden) {
            return { ...r, hidden: true };
          }
          if (!('hidden' in r)) {
            return r;
          }
          const next = { ...r };
          delete next.hidden;
          return next;
        }),
      },
    };
  },

  REMOVE_TAG_INVENTORY_ROW(state: State, action: { rowId: string }) {
    const rows = state.tagInventory.rows.filter(r => r.id !== action.rowId);
    // Keep `schemaTagColors` untouched: a tag's color (including any user
    // override via SET_TAG_INVENTORY_SCHEMA_TAG_COLOR) is sticky, so if the tag
    // reappears later it reuses the same color instead of resetting.
    return {
      tagInventory: { ...state.tagInventory, rows },
    };
  },

  SET_TAG_INVENTORY_SCHEMA_TAG_COLOR(
    state: State,
    action: { schemaTag: string; rgba: string },
  ) {
    return {
      tagInventory: {
        ...state.tagInventory,
        schemaTagColors: {
          ...state.tagInventory.schemaTagColors,
          [action.schemaTag]: action.rgba,
        },
      },
    };
  },

  /**
   * Replace the full `tagInventory` slice (e.g. from `localStorage` on load or
   * when another tab updates storage). Normalizes row ids to the deterministic
   * format and merges any duplicates that may exist from a previous id scheme.
   */
  HYDRATE_TAG_INVENTORY(state: State, action: { tagInventory: TagInventoryState }) {
    const normalized = new Map<string, TagInventoryRow>();
    for (const row of action.tagInventory.rows) {
      const newId = normalizedTagInventoryRowId(row);
      const existing = normalized.get(newId);
      if (existing) {
        const unionIds = [
          ...new Set([...(existing.annotationIds ?? []), ...(row.annotationIds ?? [])]),
        ];
        normalized.set(newId, {
          ...row,
          ...existing,
          id: newId,
          documentUri: row.documentUri ?? existing.documentUri,
          annotationIds: unionIds,
        });
      } else {
        normalized.set(newId, { ...row, id: newId });
      }
    }
    return {
      tagInventory: {
        ...action.tagInventory,
        rows: [...normalized.values()],
      },
    };
  },

  SET_TAG_INVENTORY_ROW_ANNOTATION_IDS(
    state: State,
    action: { rowId: string; annotationIds: string[] },
  ) {
    const existing = state.tagInventory.rows.find(r => r.id === action.rowId);
    const existingIds = existing?.annotationIds ?? [];
    if (
      existingIds.length === action.annotationIds.length &&
      existingIds.every((id, i) => id === action.annotationIds[i])
    ) {
      return state;
    }
    return {
      tagInventory: {
        ...state.tagInventory,
        rows: state.tagInventory.rows.map(r =>
          r.id === action.rowId
            ? { ...r, annotationIds: action.annotationIds }
            : r,
        ),
      },
    };
  },

  REMOVE_TAG_INVENTORY_ANNOTATION_IDS(
    state: State,
    action: { annotationIds: string[] },
  ) {
    const idSet = new Set(action.annotationIds);
    return {
      tagInventory: {
        ...state.tagInventory,
        rows: state.tagInventory.rows.map(r => ({
          ...r,
          annotationIds: r.annotationIds.filter(id => !idSet.has(id)),
        })),
      },
    };
  },

  SET_EXPERIMENT_LOG(state: State, action: { experimentLog: ExperimentLogState }) {
    return {
      experimentLog: action.experimentLog,
    };
  },

  HYDRATE_EXPERIMENT_LOG(state: State, action: { experimentLog: ExperimentLogState }) {
    return {
      experimentLog: action.experimentLog,
    };
  },

  PRUNE_TAG_INVENTORY_ROWS_FOR_GROUP(
    state: State,
    action: { groupId: string; descriptors: TagInventoryRowDescriptor[] },
  ) {
    const rows = pruneTagInventoryRowsToDescriptors(
      state.tagInventory.rows,
      action.descriptors,
      action.groupId,
    );
    // Keep `schemaTagColors` untouched so colors stay stable when a tag is
    // pruned and later reappears (and so user overrides survive a re-sync).
    return {
      tagInventory: { ...state.tagInventory, rows },
    };
  },
};

/**
 * Designate `panelName` as the currently-active panel name
 */
function openSidebarPanel(panelName: PanelName) {
  return makeAction(reducers, 'OPEN_SIDEBAR_PANEL', { panelName });
}

/**
 * `panelName` should not be the active panel
 */
function closeSidebarPanel(panelName: PanelName) {
  return makeAction(reducers, 'CLOSE_SIDEBAR_PANEL', { panelName });
}

/**
 * Toggle a sidebar panel from its current state, or set it to the
 * designated `panelState`.
 *
 * @param panelState -
 *   Should the panel be active? Omit this prop to simply toggle the value.
 */
function toggleSidebarPanel(panelName: PanelName, panelState?: boolean) {
  return makeAction(reducers, 'TOGGLE_SIDEBAR_PANEL', {
    panelName,
    panelState,
  });
}

function addTagInventoryRow(row: TagInventoryRow) {
  return makeAction(reducers, 'ADD_TAG_INVENTORY_ROW', { row });
}

function removeTagInventoryRow(rowId: string) {
  return makeAction(reducers, 'REMOVE_TAG_INVENTORY_ROW', { rowId });
}

function setTagInventoryRowHidden(rowId: string, hidden: boolean) {
  return makeAction(reducers, 'SET_TAG_INVENTORY_ROW_HIDDEN', { rowId, hidden });
}

function setTagInventorySchemaTagColor(schemaTag: string, rgba: string) {
  return makeAction(reducers, 'SET_TAG_INVENTORY_SCHEMA_TAG_COLOR', {
    schemaTag,
    rgba,
  });
}

function hydrateTagInventory(tagInventory: TagInventoryState) {
  return makeAction(reducers, 'HYDRATE_TAG_INVENTORY', { tagInventory });
}

function setTagInventoryRowAnnotationIds(rowId: string, annotationIds: string[]) {
  return makeAction(reducers, 'SET_TAG_INVENTORY_ROW_ANNOTATION_IDS', {
    rowId,
    annotationIds,
  });
}

function removeAnnotationIdsFromTagInventoryRows(annotationIds: string[]) {
  return makeAction(reducers, 'REMOVE_TAG_INVENTORY_ANNOTATION_IDS', {
    annotationIds,
  });
}

function setExperimentLog(experimentLog: ExperimentLogState) {
  return makeAction(reducers, 'SET_EXPERIMENT_LOG', { experimentLog });
}

function hydrateExperimentLog(experimentLog: ExperimentLogState) {
  return makeAction(reducers, 'HYDRATE_EXPERIMENT_LOG', { experimentLog });
}

function pruneTagInventoryRowsForGroup(
  groupId: string,
  descriptors: TagInventoryRowDescriptor[],
) {
  return makeAction(reducers, 'PRUNE_TAG_INVENTORY_ROWS_FOR_GROUP', {
    groupId,
    descriptors,
  });
}

/**
 * Is the panel indicated by `panelName` currently active (open)?
 */
function isSidebarPanelOpen(state: State, panelName: PanelName) {
  return state.activePanelName === panelName;
}

function tagInventoryRows(state: State) {
  return state.tagInventory.rows;
}

function tagInventorySchemaTagColors(state: State) {
  return state.tagInventory.schemaTagColors;
}

function experimentLog(state: State) {
  return state.experimentLog;
}

export const sidebarPanelsModule = createStoreModule(initialState, {
  namespace: 'sidebarPanels',
  reducers,

  actionCreators: {
    openSidebarPanel,
    closeSidebarPanel,
    toggleSidebarPanel,
    addTagInventoryRow,
    removeTagInventoryRow,
    setTagInventoryRowHidden,
    setTagInventorySchemaTagColor,
    hydrateTagInventory,
    setTagInventoryRowAnnotationIds,
    removeAnnotationIdsFromTagInventoryRows,
    setExperimentLog,
    hydrateExperimentLog,
    pruneTagInventoryRowsForGroup,
  },

  selectors: {
    isSidebarPanelOpen,
    tagInventoryRows,
    tagInventorySchemaTagColors,
    experimentLog,
  },
});
