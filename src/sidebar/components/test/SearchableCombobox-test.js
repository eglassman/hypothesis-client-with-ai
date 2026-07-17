import { mount } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { SearchableCombobox } from '../SearchableCombobox';

describe('SearchableCombobox', () => {
  it('reports free-form input when custom values are allowed', () => {
    const onChange = sinon.stub();
    const wrapper = mount(
      <SearchableCombobox
        id="searchable-combobox"
        ariaLabel="Search values"
        options={['Explains', 'Supports']}
        value=""
        allowCustomValue
        onChange={onChange}
      />,
    );
    const input = wrapper.find('input');

    input.simulate('focus');
    input.instance().value = 'Contradicts';
    input.simulate('input');

    assert.calledWith(onChange, 'Contradicts');
  });
});
