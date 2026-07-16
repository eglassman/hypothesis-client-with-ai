import { checkAccessibility } from '@hypothesis/frontend-testing';
import { mount } from '@hypothesis/frontend-testing';

import TagList from '../TagList';
import TagListItem from '../TagListItem';

describe('TagListItem', () => {
  const createComponent = props =>
    mount(<TagListItem tag="my tag" {...props} />);

  // Render TagListItems in a list to appease semantic requirements of
  // a11y tests
  const createComponentInList = () =>
    mount(
      <TagList>
        <TagListItem tag="my tag" href="http://www.example.com/my-tag" />
        <TagListItem tag="purple" />
      </TagList>,
    );

  it('renders the tag text', () => {
    const wrapper = createComponent();
    assert.equal(wrapper.text(), 'my tag');
  });

  it('links the tag to the provided `href`', () => {
    const wrapper = createComponent({ href: 'http:www.example.com/my-tag' });
    const link = wrapper.find('Link');
    assert.equal(link.props().href, 'http:www.example.com/my-tag');
  });

  it('renders a delete button if a removal callback is provided', () => {
    const onRemoveTag = sinon.stub();
    const wrapper = createComponent({ tag: 'banana', onRemoveTag });

    assert.isTrue(wrapper.find('button[title="Remove tag: banana"]').exists());
  });

  it('invokes the removal callback when the delete button is clicked', () => {
    const onRemoveTag = sinon.stub();
    const wrapper = createComponent({ onRemoveTag });

    wrapper.find('button[title="Remove tag: my tag"]').simulate('click');
    assert.calledOnce(onRemoveTag);
    assert.calledWith(onRemoveTag, 'my tag');
  });

  it('renders mark-negative button when callback provided', () => {
    const onMarkNegativeExample = sinon.stub();
    const wrapper = createComponent({
      tag: 'methods',
      onMarkNegativeExample,
    });

    assert.isTrue(
      wrapper
        .find('button[title="Mark as negative example: methods"]')
        .exists(),
    );
  });

  it('invokes mark-negative callback when clicked', () => {
    const onMarkNegativeExample = sinon.stub();
    const wrapper = createComponent({
      tag: 'methods',
      onMarkNegativeExample,
    });

    wrapper
      .find('button[title="Mark as negative example: methods"]')
      .simulate('click');
    assert.calledWith(onMarkNegativeExample, 'methods');
  });

  it('renders revert-positive button when callback provided', () => {
    const onRevertNegativeExample = sinon.stub();
    const wrapper = createComponent({
      tag: 'methods-neg-example',
      onRevertNegativeExample,
    });

    assert.isTrue(
      wrapper
        .find('button[title="Revert to positive example: methods-neg-example"]')
        .exists(),
    );
  });

  it('disables action buttons when `disabled` is true', () => {
    const onRemoveTag = sinon.stub();
    const wrapper = createComponent({ onRemoveTag, disabled: true });

    assert.isTrue(
      wrapper.find('button[title="Remove tag: my tag"]').props().disabled,
    );
  });

  it(
    'should pass a11y checks',
    checkAccessibility({
      content: () => createComponentInList(),
    }),
  );
});
