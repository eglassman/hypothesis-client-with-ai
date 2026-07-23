import {
  abortAllClaudeRuns,
  getActiveClaudeRunCount,
  registerClaudeRun,
} from '../claude-runs';

describe('claude-runs', () => {
  afterEach(() => {
    abortAllClaudeRuns();
  });

  it('registers one active run until it finishes', () => {
    const run = registerClaudeRun();

    assert.isNotNull(run);
    assert.equal(getActiveClaudeRunCount(), 1);
    assert.isNull(registerClaudeRun());

    run.finish();
    assert.equal(getActiveClaudeRunCount(), 0);
  });

  it('can abort only the registered run', () => {
    const run = registerClaudeRun();

    run.abort();

    assert.isTrue(run.signal.aborted);
    assert.equal(getActiveClaudeRunCount(), 1);
    run.finish();
    assert.equal(getActiveClaudeRunCount(), 0);
  });

  it('aborts and clears every active run', () => {
    const run = registerClaudeRun();

    abortAllClaudeRuns();

    assert.isTrue(run.signal.aborted);
    assert.equal(getActiveClaudeRunCount(), 0);
    run.finish();
  });
});
