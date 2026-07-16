import { mount } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { useRootThread, $imports } from '../use-root-thread';

describe('sidebar/components/hooks/use-root-thread', () => {
  let fakeStore;
  let fakeThreadAnnotations;
  let lastRootThread;

  beforeEach(() => {
    fakeStore = {
      allAnnotations: sinon.stub().returns(['1', '2']),
      filterQuery: sinon.stub().returns('itchy'),
      hasAppliedFilter: sinon.stub().returns(false),
      hasSelectedAnnotations: sinon.stub().returns(false),
      route: sinon.stub().returns('sidebar'),
      selectionState: sinon.stub().returns({ hi: 'there' }),
      getFilterValues: sinon.stub().returns({ user: 'hotspur' }),
      focusedGroupId: sinon.stub().returns('group-1'),
      tagInventoryRows: sinon.stub().returns([]),
      mainFrame: sinon.stub().returns({ uri: 'http://example.com/doc.pdf' }),
      searchUris: sinon.stub().returns(['http://example.com/doc.pdf']),
    };
    fakeThreadAnnotations = sinon.stub().returns({
      rootThread: {
        children: [],
      },
    });

    $imports.$mock({
      '../../store': { useSidebarStore: () => fakeStore },
      '../../helpers/thread-annotations': {
        threadAnnotations: fakeThreadAnnotations,
      },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  function DummyComponent() {
    lastRootThread = useRootThread();
  }

  it('should return results of `threadAnnotations` with current thread state', () => {
    mount(<DummyComponent />);

    const threadState = fakeThreadAnnotations.getCall(0).args[0];
    assert.deepEqual(threadState.annotations, ['1', '2']);
    assert.equal(threadState.selection.filterQuery, 'itchy');
    assert.equal(threadState.showTabs, true);
    assert.equal(threadState.selection.filters.user, 'hotspur');
    assert.deepEqual(threadState.hiddenAnnotationIds, new Set());
    assert.equal(lastRootThread, fakeThreadAnnotations());
  });

  it('passes hidden annotation IDs from hidden rows visible in the focused group', () => {
    fakeStore.tagInventoryRows.returns([
      {
        id: 'r1',
        groupId: 'group-1',
        schemaTag: 'methods',
        query: 'q',
        annotationIds: ['ann-hidden'],
        hidden: true,
      },
      {
        id: 'r2',
        groupId: 'group-2',
        schemaTag: 'other',
        query: '',
        annotationIds: ['ann-other'],
        hidden: true,
      },
    ]);

    mount(<DummyComponent />);

    const threadState = fakeThreadAnnotations.getCall(0).args[0];
    assert.deepEqual(threadState.hiddenAnnotationIds, new Set(['ann-hidden']));
  });

  [
    { route: 'sidebar', showTabs: true },
    { route: 'notebook', showTabs: false },
  ].forEach(({ route, showTabs }) => {
    it('filters by tab in the sidebar only', () => {
      fakeStore.route.returns(route);

      mount(<DummyComponent />);
      const threadState = fakeThreadAnnotations.getCall(0).args[0];

      assert.equal(threadState.showTabs, showTabs);
    });
  });
});
