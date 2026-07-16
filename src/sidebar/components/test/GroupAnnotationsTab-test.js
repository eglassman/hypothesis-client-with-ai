import { mount, waitFor } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { GroupAnnotationsTab, $imports } from '../GroupAnnotationsTab';

describe('GroupAnnotationsTab', () => {
  let fakeStore;
  let tagInventoryGroupSync;

  beforeEach(() => {
    fakeStore = {
      focusedGroupId: sinon.stub().returns('group-1'),
      isSidebarFullWidth: sinon.stub().returns(false),
      savedAnnotations: sinon.stub().returns([]),
      searchUris: sinon.stub().returns([]),
    };
    tagInventoryGroupSync = {
      getGroupAnnotations: sinon.stub().resolves([
        {
          id: 'methods-1',
          group: 'group-1',
          uri: 'https://example.com/methods',
          tags: ['Methods'],
          target: [],
        },
        {
          id: 'findings-1',
          group: 'group-1',
          uri: 'https://example.com/findings',
          tags: ['Findings'],
          target: [],
        },
      ]),
    };
    $imports.$mock({
      '../store': { useSidebarStore: () => fakeStore },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  it('filters annotation sections by tag', async () => {
    const wrapper = mount(
      <GroupAnnotationsTab tagInventoryGroupSync={tagInventoryGroupSync} />,
    );

    await waitFor(() => {
      wrapper.update();
      return wrapper.find('SearchableCombobox').exists();
    });

    wrapper.find('SearchableCombobox').props().onChange('meth');
    wrapper.update();

    const sections = wrapper.find('[data-testid="group-annotations-section"]');
    assert.lengthOf(sections, 1);
    assert.equal(sections.prop('data-tag'), 'Methods');
  });
});
