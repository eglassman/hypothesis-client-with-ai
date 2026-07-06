import { addConfigFragment } from '../../../../shared/config-fragment';
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

  it('preserves the sidebar config fragment for the packaged node-link route', () => {
    const sidebarUrl = addConfigFragment(
      'chrome-extension://extension-id/client/app.html',
      {
        origin: 'chrome-extension://extension-id',
        version: '1.0.0-with-ai.5',
      },
    );

    const url = new URL(extensionNodeLinkUrl(sidebarUrl));

    assert.equal(url.searchParams.get('route'), 'nodeLink');
    assert.equal(url.hash, new URL(sidebarUrl).hash);
  });

  it('does not generate a fallback URL outside extension pages', () => {
    assert.isNull(extensionNodeLinkUrl('https://hypothes.is/app.html'));
  });
});
