import {
  abortAllClaudeRuns,
  getActiveClaudeRunCount,
  registerClaudeRun,
} from '../ai-search-claude-runs';

describe('ai-search-claude-runs', () => {
  afterEach(() => {
    abortAllClaudeRuns();
  });

  it('registerClaudeRun adds an active run and finish removes it', () => {
    assert.equal(getActiveClaudeRunCount(), 0);

    const run = registerClaudeRun();
    assert.isNotNull(run);
    assert.equal(getActiveClaudeRunCount(), 1);
    assert.equal(run.signal.aborted, false);

    run.finish();
    assert.equal(getActiveClaudeRunCount(), 0);
  });

  it('registerClaudeRun returns null when a run is already active', () => {
    const first = registerClaudeRun();
    assert.isNotNull(first);

    const second = registerClaudeRun();
    assert.isNull(second);

    first.finish();
    assert.isNotNull(registerClaudeRun());
  });

  it('abortAllClaudeRuns aborts the signal and clears runs', () => {
    const run = registerClaudeRun();
    assert.equal(getActiveClaudeRunCount(), 1);

    abortAllClaudeRuns();

    assert.equal(run.signal.aborted, true);
    assert.equal(getActiveClaudeRunCount(), 0);
    run.finish(); // no-op if already cleared
  });
});
