import type { JSX } from 'preact';
import { useCallback } from 'preact/hooks';

import { useSidebarStore } from '../../store';
import TopBarToggleButton from '../TopBarToggleButton';

function NodeLinkIcon(props: JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M4.2 4.8 7.6 8m0 0 4.2-4.1M7.6 8l3.6 3.7M7.6 8l-3.4 3.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <circle cx="3.2" cy="3.9" r="2" fill="currentColor" />
      <circle cx="12.8" cy="3" r="2" fill="currentColor" />
      <circle cx="12.3" cy="12.8" r="2" fill="currentColor" />
      <circle cx="3.2" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

export function extensionNodeLinkUrl(href = window.location.href) {
  const url = new URL(href);
  if (url.protocol !== 'chrome-extension:') {
    return null;
  }
  const appUrl = new URL('app.html', url);
  appUrl.searchParams.set('route', 'nodeLink');
  return appUrl.toString();
}

export default function NodeLinkGraphIconButton() {
  const store = useSidebarStore();
  const groupId = store.focusedGroupId();
  const documentUri = store.searchUris()[0] || store.mainFrame()?.uri || '';
  const nodeLinkUrl = extensionNodeLinkUrl();

  const openGraph = useCallback(() => {
    if (!nodeLinkUrl) {
      return;
    }

    const url = new URL(nodeLinkUrl);
    if (groupId) {
      url.searchParams.set('group', groupId);
    }
    if (documentUri) {
      url.searchParams.set('uri', documentUri);
    }
    window.open(url.toString(), '_blank', 'noopener');
  }, [documentUri, groupId, nodeLinkUrl]);

  if (!nodeLinkUrl) {
    return null;
  }

  return (
    <TopBarToggleButton
      icon={NodeLinkIcon}
      expanded={false}
      pressed={false}
      onClick={openGraph}
      title="Open node-link graph in a new tab"
      data-testid="node-link-graph-icon-button"
    />
  );
}
