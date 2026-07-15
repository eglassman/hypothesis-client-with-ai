import { mount } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { TagCombobox } from '../TagCombobox';

describe('TagCombobox', () => {
  function createComponent(overrides = {}) {
    const onChange = sinon.stub();
    const wrapper = mount(
      <TagCombobox
        id="test-tags"
        ariaLabel="Choose a tag"
        options={['Action', 'Character', 'Interaction']}
        value=""
        onChange={onChange}
        {...overrides}
      />,
    );
    return { onChange, wrapper };
  }

  it('filters tag options case-insensitively as the user types', () => {
    const { wrapper } = createComponent();
    const input = wrapper.find('input');

    input.simulate('focus');
    input.instance().value = 'TION';
    input.simulate('input');

    assert.deepEqual(wrapper.find('AutocompleteList').prop('list'), [
      'Action',
      'Interaction',
    ]);
    assert.isTrue(wrapper.find('AutocompleteList').prop('open'));
  });

  it('selects a filtered tag with the keyboard', () => {
    const { onChange, wrapper } = createComponent();
    const input = wrapper.find('input');

    input.simulate('focus');
    input.instance().value = 'char';
    input.simulate('input');
    wrapper.find('input').simulate('keydown', { key: 'ArrowDown' });
    wrapper.find('input').simulate('keydown', { key: 'Enter' });

    assert.calledWith(onChange, 'Character');
    assert.isFalse(wrapper.find('AutocompleteList').prop('open'));
  });
});
