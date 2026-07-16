import { ClaudeService, isClaudeDocumentDownloadError } from '../claude';

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
});
