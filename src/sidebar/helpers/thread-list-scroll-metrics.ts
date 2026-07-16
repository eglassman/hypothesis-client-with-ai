// The precision of the `scrollPosition` value in pixels; values will be rounded
// down to the nearest multiple of this scale value
export const THREAD_LIST_SCROLL_PRECISION = 50;

export function roundThreadListScrollPosition(pos: number) {
  return Math.max(pos - (pos % THREAD_LIST_SCROLL_PRECISION), 0);
}

export type ThreadListScrollMetrics = {
  scrollPosition: number;
  viewportHeight: number;
  listTopOffset: number;
};

export type ThreadScrollAnchor = {
  id: string;
  /** Distance from the top of the scroll container viewport to the thread card top. */
  viewportOffset: number;
};

export function getThreadListScrollContainer(): HTMLElement {
  const container = document.querySelector('.js-thread-list-scroll-root');
  if (!container) {
    throw new Error('Scroll container is missing');
  }
  return container as HTMLElement;
}

export function threadViewportOffset(
  threadId: string,
  scrollContainer: HTMLElement = getThreadListScrollContainer(),
): number | null {
  const threadEl = document.getElementById(threadId);
  if (!threadEl) {
    return null;
  }
  return (
    threadEl.getBoundingClientRect().top -
    scrollContainer.getBoundingClientRect().top
  );
}

export function threadListYOffset(
  threadIndex: number,
  threads: Array<{ id: string }>,
  threadHeights: Map<string, number>,
  defaultHeight: number,
): number {
  if (threadIndex <= 0) {
    return 0;
  }
  return threads
    .slice(0, threadIndex)
    .reduce(
      (total, thread) => total + (threadHeights.get(thread.id) ?? defaultHeight),
      0,
    );
}

/**
 * `scrollTop` that places a thread's top edge `viewportOffset` px below the
 * scroll container's visible top (virtualization-safe; uses measured heights).
 */
export function scrollTopForThreadViewportOffset(
  threadIndex: number,
  threads: Array<{ id: string }>,
  threadHeights: Map<string, number>,
  listTopOffset: number,
  viewportOffset: number,
  defaultHeight: number,
): number {
  return (
    threadListYOffset(threadIndex, threads, threadHeights, defaultHeight) +
    listTopOffset -
    viewportOffset
  );
}

export function measureThreadListScrollMetrics(
  scrollContainer: Element,
  listRoot: Element | null,
): ThreadListScrollMetrics {
  const container = scrollContainer as HTMLElement;
  const rootScrollTop = container.scrollTop;
  const containerRect = container.getBoundingClientRect();
  const listTopWithinContainer =
    listRoot === null
      ? 0
      : listRoot.getBoundingClientRect().top - containerRect.top;
  const listTopOffset = Math.max(0, listTopWithinContainer + rootScrollTop);

  // For virtualization math, use list-relative scroll offsets. This keeps
  // visibility calculations stable when widgets above the list grow/shrink.
  const effectiveScrollPosition = Math.max(0, rootScrollTop - listTopOffset);
  const visibleHeight = Math.max(
    0,
    container.clientHeight - Math.max(0, listTopWithinContainer),
  );

  return {
    scrollPosition: roundThreadListScrollPosition(effectiveScrollPosition),
    viewportHeight: visibleHeight,
    listTopOffset,
  };
}
