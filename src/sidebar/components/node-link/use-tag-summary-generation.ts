import { confirm } from '@hypothesis/frontend-shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  buildClaudeTagSummaryPrompt,
  tagSummarySourceFingerprint,
} from '../../helpers/claude-tag-summary';
import type { NodeLinkGraph } from '../../node-link/graph-model';
import type {
  NodeLinkSemanticState,
  TagSummary,
} from '../../node-link/graph-state';
import type { ClaudeService } from '../../services/claude';
import { registerClaudeRun } from '../../services/claude-runs';
import type { ToastMessengerService } from '../../services/toast-messenger';

export type TagSummaryStatus = {
  summary: TagSummary | null;
  stale: boolean;
};

export type TagSummaryProgress = {
  completed: number;
  total: number;
  currentTag: string;
};

type ActiveClaudeRun = NonNullable<ReturnType<typeof registerClaudeRun>>;

export type UseTagSummaryGenerationOptions = {
  claude: ClaudeService;
  graph: NodeLinkGraph;
  semanticState: NodeLinkSemanticState;
  saveState: (state: NodeLinkSemanticState) => Promise<NodeLinkSemanticState>;
  toastMessenger: ToastMessengerService;
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useTagSummaryGeneration({
  claude,
  graph,
  semanticState,
  saveState,
  toastMessenger,
}: UseTagSummaryGenerationOptions) {
  const [apiKey, setApiKeyState] = useState(() => claude.apiKey());
  const [generatingTag, setGeneratingTag] = useState('');
  const [bulkProgress, setBulkProgress] = useState<TagSummaryProgress | null>(
    null,
  );
  const [errorsByTag, setErrorsByTag] = useState<Record<string, string>>({});
  const activeRunRef = useRef<ActiveClaudeRun | null>(null);

  useEffect(
    () => () => {
      activeRunRef.current?.abort();
    },
    [],
  );

  const statusByTag = useMemo(() => {
    const summaries = new Map(
      semanticState.tagSummaries.map(summary => [summary.tag, summary]),
    );
    return new Map<string, TagSummaryStatus>(
      graph.tags.map(({ tag }) => {
        const summary = summaries.get(tag) || null;
        const stale = summary
          ? summary.sourceFingerprint !==
            tagSummarySourceFingerprint(graph, tag)
          : false;
        return [
          tag,
          {
            summary,
            stale,
          },
        ];
      }),
    );
  }, [graph, semanticState.tagSummaries]);
  const bulkTags = useMemo(
    () =>
      graph.tags
        .map(({ tag }) => tag)
        .filter(tag => {
          const status = statusByTag.get(tag);
          return !status?.summary || status.stale;
        })
        .sort((a, b) => a.localeCompare(b)),
    [graph.tags, statusByTag],
  );

  const setApiKey = (value: string) => {
    setApiKeyState(value);
    claude.setApiKey(value);
  };

  const saveGeneratedSummary = async (
    tag: string,
    state: NodeLinkSemanticState,
    signal: AbortSignal,
  ) => {
    const context = buildClaudeTagSummaryPrompt(graph, tag);
    const result = await claude.summarizeTag({
      apiKey: claude.apiKey(),
      prompt: context.prompt,
      tag,
      signal,
    });
    if (signal.aborted) {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const generatedAt = new Date().toISOString();
    const nextState: NodeLinkSemanticState = {
      ...state,
      updatedAt: generatedAt,
      tagSummaries: [
        ...state.tagSummaries.filter(summary => summary.tag !== tag),
        {
          tag,
          summary: result.summary,
          generatedAt,
          sourceFingerprint: context.sourceFingerprint,
          model: result.model,
        },
      ],
    };
    return saveState(nextState);
  };

  const generateTag = async (tag: string) => {
    if (activeRunRef.current) {
      return;
    }
    if (!claude.apiKey().trim()) {
      toastMessenger.error('Enter a Claude API key to generate summaries.');
      return;
    }

    const run = registerClaudeRun();
    if (!run) {
      toastMessenger.notice('Another Claude operation is already in progress.');
      return;
    }
    activeRunRef.current = run;
    setGeneratingTag(tag);
    setErrorsByTag(current => ({ ...current, [tag]: '' }));
    try {
      await saveGeneratedSummary(tag, semanticState, run.signal);
      toastMessenger.success(`Generated summary for ${tag}.`);
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        const message = errorMessage(error);
        setErrorsByTag(current => ({ ...current, [tag]: message }));
        toastMessenger.error(message);
      }
    } finally {
      run.finish();
      activeRunRef.current = null;
      setGeneratingTag('');
    }
  };

  const generateAll = async () => {
    if (activeRunRef.current) {
      return;
    }
    if (!claude.apiKey().trim()) {
      toastMessenger.error('Enter a Claude API key to generate summaries.');
      return;
    }
    if (!bulkTags.length) {
      toastMessenger.notice('All tag summaries are up to date.');
      return;
    }

    const confirmed = await confirm({
      title: 'Generate AI summaries for all tags?',
      message: `This operation could take a long time and be costly. We will be making ${bulkTags.length} AI summary calls.`,
      confirmAction: 'Generate summaries',
    });
    if (!confirmed) {
      return;
    }

    const run = registerClaudeRun();
    if (!run) {
      toastMessenger.notice('Another Claude operation is already in progress.');
      return;
    }
    activeRunRef.current = run;
    let completed = 0;
    let currentTag = '';
    let workingState = semanticState;
    try {
      for (const tag of bulkTags) {
        currentTag = tag;
        setGeneratingTag(tag);
        setBulkProgress({ completed, total: bulkTags.length, currentTag: tag });
        setErrorsByTag(current => ({ ...current, [tag]: '' }));
        workingState = await saveGeneratedSummary(
          tag,
          workingState,
          run.signal,
        );
        completed++;
        setBulkProgress({ completed, total: bulkTags.length, currentTag: tag });
      }
      toastMessenger.success(
        `Generated ${completed} ${completed === 1 ? 'summary' : 'summaries'}.`,
      );
    } catch (error: unknown) {
      if (isAbortError(error)) {
        toastMessenger.notice(
          `Summary generation stopped after ${completed} of ${bulkTags.length}.`,
        );
      } else {
        const message = errorMessage(error);
        if (currentTag) {
          setErrorsByTag(current => ({ ...current, [currentTag]: message }));
        }
        toastMessenger.error(message);
      }
    } finally {
      run.finish();
      activeRunRef.current = null;
      setGeneratingTag('');
      setBulkProgress(null);
    }
  };

  return {
    apiKey,
    setApiKey,
    statusByTag,
    errorsByTag,
    generatingTag,
    bulkProgress,
    bulkTargetCount: bulkTags.length,
    isRunning: Boolean(generatingTag),
    generateTag,
    generateAll,
    stopGeneration: () => activeRunRef.current?.abort(),
  };
}
