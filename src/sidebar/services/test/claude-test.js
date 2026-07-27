import {
  ClaudeService,
  isClaudeContextLimitError,
  isClaudeDocumentDownloadError,
} from '../claude';

describe('ClaudeService', () => {
  it('stores the user API key in memory only', () => {
    const claude = new ClaudeService();
    assert.equal(claude.apiKey(), '');
    claude.setApiKey('sk-test');
    assert.equal(claude.apiKey(), 'sk-test');
  });

  it('throws when documentUri is empty', async () => {
    const claude = new ClaudeService();

    await assert.rejects(
      // eslint-disable-next-line new-cap -- AISearchDocument is a service method, not a constructor
      claude.AISearchDocument({
        documentUri: '',
        query: 'find methods',
        apiKey: 'test-key',
      }),
      /No document URL provided/,
    );
  });

  it('isClaudeDocumentDownloadError matches URL download failures', () => {
    assert.isTrue(
      isClaudeDocumentDownloadError(
        new Error(
          'Failed to extract quotes from document: 400 {"error":{"message":"Unable to download the file. Please verify the URL and try again."}}',
        ),
      ),
    );
    assert.isFalse(
      isClaudeDocumentDownloadError(new Error('Claude rate limit exceeded')),
    );
  });

  it('isClaudeContextLimitError matches oversized requests', () => {
    assert.isTrue(
      isClaudeContextLimitError(
        new Error('prompt is too long for the model context window'),
      ),
    );
    assert.isTrue(isClaudeContextLimitError({ status: 413 }));
    assert.isFalse(
      isClaudeContextLimitError(new Error('Claude rate limit exceeded')),
    );
  });
});
