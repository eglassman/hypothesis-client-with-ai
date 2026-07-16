import {
  mockImportedComponents,
  mount,
  waitFor,
} from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { colorForTag } from '../../../node-link/graph-model';
import { emptyNodeLinkState } from '../../../node-link/graph-state';
import TagLegendPanel, { $imports } from '../TagLegendPanel';

describe('TagLegendPanel', () => {
  let fakeStore;
  let fakeNodeLinkState;
  const tagColors = {
    Character: 'rgba(140, 209, 125, 0.38)',
    Theme: 'rgba(78, 121, 167, 0.38)',
  };

  function createComponent() {
    return mount(<TagLegendPanel nodeLinkState={fakeNodeLinkState} />);
  }

  beforeEach(() => {
    fakeStore = {
      focusedGroup: sinon.stub().returns({ id: 'group-a', name: 'Test Group' }),
      focusedGroupId: sinon.stub().returns('group-a'),
      hasFetchedProfile: sinon.stub().returns(true),
      isLoggedIn: sinon.stub().returns(true),
      isSidebarPanelOpen: sinon.stub().withArgs('tagLegend').returns(true),
      tagInventorySchemaTagColors: sinon.stub().returns(tagColors),
      savedAnnotations: sinon.stub().returns([
        { group: 'group-a', tags: ['Character'] },
        { group: 'group-a', tags: ['Action'] },
        { group: 'group-b', tags: ['Other group'] },
      ]),
    };
    fakeNodeLinkState = {
      loadState: sinon.stub().resolves({
        status: 'loaded',
        state: emptyNodeLinkState({
          selectedGroupId: 'group-a',
          descriptiveTags: [{ id: 'desc-theme', tag: 'Theme' }],
          tagEdges: [
            {
              id: 'edge-character-theme',
              sourceTag: 'Character',
              targetTag: 'Theme',
              connectionType: 'explains',
            },
            {
              id: 'edge-action-character',
              sourceTag: 'Action',
              targetTag: 'Character',
              connectionType: 'reveals',
            },
          ],
        }),
        annotationId: 'state-annotation',
        stateUri: 'https://hypothesis-node-link.local/state/group/group-a',
      }),
    };

    $imports.$mock(mockImportedComponents());
    $imports.$mock({
      '../../store': { useSidebarStore: () => fakeStore },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  it('loads tag relationships for the focused group', async () => {
    const wrapper = createComponent();

    await waitFor(() => fakeNodeLinkState.loadState.called);

    assert.calledWith(fakeNodeLinkState.loadState, 'group-a');
    assert.include(wrapper.text(), 'Test Group');
    assert.include(wrapper.text(), 'Tag Reference');
  });

  it('shows outgoing and incoming relationships for the selected tag', async () => {
    const wrapper = createComponent();
    await waitFor(() => {
      wrapper.update();
      return wrapper.find('SearchableCombobox').exists();
    });

    wrapper.find('SearchableCombobox').props().onChange('Character');
    wrapper.update();

    assert.include(wrapper.text(), 'Character');
    assert.include(wrapper.text(), 'explains');
    assert.include(wrapper.text(), 'Theme');
    assert.include(wrapper.text(), 'Action');
    assert.include(wrapper.text(), 'reveals');
  });

  it('colors relationship badges with the tag inventory colors', async () => {
    const wrapper = createComponent();
    await waitFor(() => {
      wrapper.update();
      return wrapper.find('SearchableCombobox').exists();
    });

    wrapper.find('SearchableCombobox').props().onChange('Character');
    wrapper.update();

    const characterBadge = wrapper.find('span[title="Character"]').first();
    const themeBadge = wrapper.find('span[title="Theme"]').first();

    assert.equal(
      characterBadge.prop('style').backgroundColor,
      colorForTag('Character', tagColors),
    );
    assert.equal(
      themeBadge.prop('style').backgroundColor,
      colorForTag('Theme', tagColors),
    );
  });

  it('prompts logged-out users to log in', () => {
    fakeStore.isLoggedIn.returns(false);

    const wrapper = createComponent();

    assert.include(
      wrapper.text(),
      'Log in to load tag relationships for this group.',
    );
    assert.notCalled(fakeNodeLinkState.loadState);
  });
});
