import { createStoreModule, makeAction } from '../create-store';

export type State = {
  schemaTagInput: string;
  aiQueryInput: string | null;
  annotateManually: boolean;
};

const initialState: State = {
  schemaTagInput: '',
  aiQueryInput: null,
  annotateManually: false,
};

const reducers = {
  SET_AI_SEARCH_PANEL_SCHEMA_TAG_INPUT(
    state: State,
    action: { schemaTagInput: string },
  ) {
    const schemaTagInput = action.schemaTagInput;
    const annotateManually =
      schemaTagInput.trim().length === 0 ? false : state.annotateManually;
    return { schemaTagInput, annotateManually };
  },

  SET_AI_SEARCH_PANEL_QUERY_INPUT(
    _state: State,
    action: { aiQueryInput: string | null },
  ) {
    return { aiQueryInput: action.aiQueryInput };
  },

  SET_AI_SEARCH_PANEL_ANNOTATE_MANUALLY(
    _state: State,
    action: { annotateManually: boolean },
  ) {
    return { annotateManually: action.annotateManually };
  },
};

function setAISearchPanelSchemaTagInput(schemaTagInput: string) {
  return makeAction(reducers, 'SET_AI_SEARCH_PANEL_SCHEMA_TAG_INPUT', {
    schemaTagInput,
  });
}

function setAISearchPanelQueryInput(aiQueryInput: string | null) {
  return makeAction(reducers, 'SET_AI_SEARCH_PANEL_QUERY_INPUT', {
    aiQueryInput,
  });
}

function setAISearchPanelAnnotateManually(annotateManually: boolean) {
  return makeAction(reducers, 'SET_AI_SEARCH_PANEL_ANNOTATE_MANUALLY', {
    annotateManually,
  });
}

function aiSearchPanelSchemaTagInput(state: State) {
  return state.schemaTagInput;
}

function aiSearchPanelQueryInput(state: State) {
  return state.aiQueryInput;
}

function aiSearchPanelAnnotateManually(state: State) {
  return state.annotateManually;
}

export const aiSearchPanelUIModule = createStoreModule(initialState, {
  namespace: 'aiSearchPanelUi',
  reducers,
  actionCreators: {
    setAISearchPanelSchemaTagInput,
    setAISearchPanelQueryInput,
    setAISearchPanelAnnotateManually,
  },
  selectors: {
    aiSearchPanelSchemaTagInput,
    aiSearchPanelQueryInput,
    aiSearchPanelAnnotateManually,
  },
});
