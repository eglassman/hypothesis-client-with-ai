import {
  measureThreadListScrollMetrics,
  scrollTopForThreadViewportOffset,
} from '../thread-list-scroll-metrics';

describe('thread-list-scroll-metrics', () => {
  it('uses list-relative scroll metrics when content above list changes height', () => {
    let offsetAboveList = 180;
    let scrollTop = 0;

    const scrollContainer = {
      scrollTop: 0,
      clientHeight: 400,
      getBoundingClientRect: () => ({
        top: 100,
        left: 0,
        right: 320,
        bottom: 500,
        width: 320,
        height: 400,
      }),
    };
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: value => {
        scrollTop = value;
      },
    });

    const listRoot = {
      getBoundingClientRect: () => ({
        top: 100 + offsetAboveList - scrollTop,
        left: 0,
        right: 320,
        bottom: 300 + offsetAboveList - scrollTop,
        width: 320,
        height: 200,
      }),
    };

    scrollTop = 250;
    let metrics = measureThreadListScrollMetrics(scrollContainer, listRoot);
    assert.equal(metrics.scrollPosition, 50);
    assert.equal(metrics.viewportHeight, 400);

    // Simulate history widget above list growing taller.
    offsetAboveList = 260;
    scrollTop = 330;
    metrics = measureThreadListScrollMetrics(scrollContainer, listRoot);
    assert.equal(metrics.scrollPosition, 50);
    assert.equal(metrics.viewportHeight, 400);
  });

  it('computes scrollTop to preserve a thread viewport offset', () => {
    const threads = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const heights = new Map([
      ['a', 100],
      ['b', 150],
      ['c', 120],
    ]);
    assert.equal(
      scrollTopForThreadViewportOffset(1, threads, heights, 50, 30, 200),
      100 + 50 - 30,
    );
  });
});
