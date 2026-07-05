import { extensionNodeLinkUrl } from '../NodeLinkGraphIconButton';

describe('NodeLinkGraphIconButton', () => {
  it('uses the existing extension app shell for the node-link graph', () => {
    const url = extensionNodeLinkUrl(
      'chrome-extension://extension-id/client/app.html',
    );

    assert.equal(
      url,
      'chrome-extension://extension-id/client/app.html?route=nodeLink',
    );
  });

  it('does not generate a fallback URL outside extension pages', () => {
    assert.isNull(extensionNodeLinkUrl('https://hypothes.is/app.html'));
  });
});
