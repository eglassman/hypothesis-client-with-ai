import { mount, waitFor } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { tagSummarySourceFingerprint } from '../../../helpers/claude-tag-summary';
import { emptyNodeLinkState } from '../../../node-link/graph-state';
import { abortAllClaudeRuns } from '../../../services/claude-runs';
import {
  $imports,
  useTagSummaryGeneration,
} from '../use-tag-summary-generation';

function tagNode(tag) {
  return {
    id: `tag:${tag}`,
    tag,
    quoteCount: 0,
    documentCount: 0,
    documentUris: [],
    descriptive: false,
  };
}

function HookHarness({ options, onChange }) {
  onChange(useTagSummaryGeneration(options));
  return null;
}

describe('useTagSummaryGeneration', () => {
  let confirm;

  beforeEach(() => {
    confirm = sinon.stub().resolves(true);
    $imports.$mock({
      '@hypothesis/frontend-shared': { confirm },
    });
  });

  afterEach(() => {
    abortAllClaudeRuns();
    $imports.$restore();
  });

  it('confirms the exact missing/stale count and generates sequentially', async () => {
    const graph = {
      tags: ['Action', 'Character', 'Theme'].map(tagNode),
      quotes: [],
      documents: [],
      manualEdges: [],
      annotationCount: 0,
    };
    const semanticState = emptyNodeLinkState({
      tagSummaries: [
        {
          tag: 'Action',
          summary: 'Existing line one.\nExisting line two.',
          generatedAt: '2026-07-22T12:00:00.000Z',
          sourceFingerprint: tagSummarySourceFingerprint(graph, 'Action'),
        },
      ],
    });
    let resolveFirst;
    const firstResult = new Promise(resolve => {
      resolveFirst = resolve;
    });
    const claude = {
      apiKey: sinon.stub().returns('test-key'),
      setApiKey: sinon.stub(),
      summarizeTag: sinon.stub(),
    };
    claude.summarizeTag.onFirstCall().returns(firstResult);
    claude.summarizeTag.onSecondCall().resolves({
      summary: 'Theme line one.\nTheme line two.',
      model: 'claude-test',
    });
    const saveState = sinon.stub().callsFake(state => Promise.resolve(state));
    const toastMessenger = {
      error: sinon.stub(),
      notice: sinon.stub(),
      success: sinon.stub(),
    };
    let summaryGeneration;
    mount(
      <HookHarness
        options={{
          claude,
          graph,
          semanticState,
          saveState,
          toastMessenger,
        }}
        onChange={value => {
          summaryGeneration = value;
        }}
      />,
    );

    const generation = summaryGeneration.generateAll();
    await waitFor(() => claude.summarizeTag.calledOnce);

    assert.calledWith(confirm, {
      title: 'Generate AI summaries for all tags?',
      message:
        'This operation could take a long time and be costly. We will be making 2 AI summary calls.',
      confirmAction: 'Generate summaries',
    });
    assert.calledOnce(claude.summarizeTag);

    resolveFirst({
      summary: 'Character line one.\nCharacter line two.',
      model: 'claude-test',
    });
    await waitFor(() => claude.summarizeTag.calledTwice);
    await generation;

    assert.include(claude.summarizeTag.firstCall.args[0].prompt, '"Character"');
    assert.include(claude.summarizeTag.secondCall.args[0].prompt, '"Theme"');
    assert.equal(claude.summarizeTag.firstCall.args[0].tag, 'Character');
    assert.equal(claude.summarizeTag.secondCall.args[0].tag, 'Theme');
    assert.calledTwice(saveState);
    assert.lengthOf(saveState.secondCall.args[0].tagSummaries, 3);
  });
});
