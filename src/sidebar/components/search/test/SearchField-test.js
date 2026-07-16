import {
  checkAccessibility,
  mockImportedComponents,
} from '@hypothesis/frontend-testing';
import { mount } from '@hypothesis/frontend-testing';

import SearchField, { $imports } from '../SearchField';

describe('SearchField', () => {
  let fakeStore;

  const createSearchField = (props = {}) => {
    return mount(<SearchField {...props} />, { connected: true });
  };

  function typeQuery(wrapper, query) {
    const input = wrapper.find('input');
    input.getDOMNode().value = query;
    input.simulate('input');
  }

  function typeQueryTextarea(wrapper, query) {
    const textarea = wrapper.find('textarea');
    textarea.getDOMNode().value = query;
    textarea.simulate('input');
  }

  function getClearButton(wrapper) {
    return wrapper.find('button[data-testid="clear-button"]');
  }

  beforeEach(() => {
    fakeStore = { isLoading: sinon.stub().returns(false) };

    $imports.$mock(mockImportedComponents());
    $imports.$mock({
      '../../store': { useSidebarStore: () => fakeStore },
    });
  });

  afterEach(() => {
    $imports.$restore();
  });

  it('displays the active query', () => {
    const wrapper = createSearchField({ query: 'foo' });
    assert.equal(wrapper.find('input').prop('value'), 'foo');
  });

  it('resets input field value to active query when active query changes', () => {
    const wrapper = createSearchField({ query: 'foo' });

    // Simulate user editing the pending query, but not committing it.
    typeQuery(wrapper, 'pending-query');

    // Check that the pending query is displayed.
    assert.equal(wrapper.find('input').prop('value'), 'pending-query');

    // Simulate active query being reset.
    wrapper.setProps({ query: '' });

    assert.equal(wrapper.find('input').prop('value'), '');
  });

  it('invokes `onSearch` with pending query when form is submitted', () => {
    const onSearch = sinon.stub();
    const wrapper = createSearchField({ query: 'foo', onSearch });
    typeQuery(wrapper, 'new-query');
    wrapper.find('form').simulate('submit');
    assert.calledWith(onSearch, 'new-query');
  });

  it('does not set an initial empty query when form is submitted', () => {
    // If the first query entered is empty, it will be ignored
    const onSearch = sinon.stub();
    const wrapper = createSearchField({ onSearch });
    typeQuery(wrapper, '');
    wrapper.find('form').simulate('submit');
    assert.notCalled(onSearch);
  });

  it('allows initial empty query submit when `allowSubmitWithJustTag` is true', () => {
    const onSearch = sinon.stub();
    const wrapper = createSearchField({
      onSearch,
      allowSubmitWithJustTag: true,
    });

    typeQuery(wrapper, '');
    wrapper.find('form').simulate('submit');

    assert.calledWith(onSearch, '');
  });

  it('sets subsequent empty queries if entered', () => {
    // If there has already been at least one query set, subsequent
    // empty queries will be honored
    const onSearch = sinon.stub();
    const wrapper = createSearchField({ query: 'foo', onSearch });
    typeQuery(wrapper, '');
    wrapper.find('form').simulate('submit');
    assert.calledWith(onSearch, '');
  });

  it('disables input when app is in a "loading" state', () => {
    fakeStore.isLoading.returns(true);

    const wrapper = createSearchField();
    const { placeholder, disabled } = wrapper.find('Input').props();

    assert.equal(placeholder, 'Loading…');
    assert.isTrue(disabled);
  });

  it('doesn\'t disable input when app is not in "loading" state', () => {
    fakeStore.isLoading.returns(false);

    const wrapper = createSearchField();
    const { placeholder, disabled } = wrapper.find('Input').props();

    assert.equal(placeholder, 'Search…');
    assert.isFalse(disabled);
  });

  it('focuses search input when "/" is pressed outside of the component element', () => {
    const wrapper = createSearchField();
    const searchInputEl = wrapper.find('input').getDOMNode();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: '/',
      }),
    );

    assert.equal(document.activeElement, searchInputEl);
  });

  it('displays clear button when there is a pending query', () => {
    const wrapper = createSearchField();
    assert.isFalse(getClearButton(wrapper).exists());

    typeQuery(wrapper, 'some query');
    assert.isTrue(getClearButton(wrapper).exists());

    typeQuery(wrapper, '');
    assert.isFalse(getClearButton(wrapper).exists());
  });

  it('clears search when clear button is clicked', () => {
    const onClearSearch = sinon.stub();
    const wrapper = createSearchField({ onClearSearch });

    typeQuery(wrapper, 'some query');
    getClearButton(wrapper).simulate('click');

    assert.calledOnce(onClearSearch);
  });

  [true, false].forEach(disabled => {
    it('disables controls if `disabled` prop is true', () => {
      // Set a non-empty query so that clear button is shown.
      const query = 'some query';
      const wrapper = createSearchField({ disabled, query });

      assert.equal(wrapper.find('input').prop('disabled'), disabled);

      // Both clear and search buttons should be disabled.
      assert.deepEqual(
        wrapper.find('button').map(btn => btn.prop('disabled')),
        [disabled, disabled],
      );
    });
  });

  it('renders a textarea and full-width submit when multiline and label are set', () => {
    const wrapper = createSearchField({
      multiline: true,
      fullWidthSubmitLabel: 'Ask AI for Annotations',
      query: null,
      onSearch: sinon.stub(),
      onClearSearch: sinon.stub(),
    });
    assert.isTrue(wrapper.find('textarea').exists());
    assert.isFalse(wrapper.find('input').exists());
    assert.equal(
      wrapper.find('[data-testid="search-submit-button"]').first().text(),
      'Ask AI for Annotations',
    );
  });

  it('renders leading content before submit button in AI layout', () => {
    const wrapper = createSearchField({
      multiline: true,
      fullWidthSubmitLabel: 'Ask AI for Annotations',
      fullWidthSubmitLeading: (
        <button data-testid="leading-control" type="button">
          Annotate Manually
        </button>
      ),
      query: null,
      onSearch: sinon.stub(),
      onClearSearch: sinon.stub(),
    });

    const row = wrapper.find('form > div').at(1);
    assert.equal(row.find('[data-testid="leading-control"]').exists(), true);
    assert.equal(
      row.find('[data-testid="search-submit-button"]').exists(),
      true,
    );
  });

  it('invokes `onSearch` on Enter in multiline field when Shift is not held', () => {
    const onSearch = sinon.stub();
    const wrapper = createSearchField({
      query: 'foo',
      onSearch,
      multiline: true,
      fullWidthSubmitLabel: 'Ask AI for Annotations',
      onClearSearch: sinon.stub(),
    });
    typeQueryTextarea(wrapper, 'new-query');
    wrapper.find('textarea').simulate('keydown', {
      key: 'Enter',
      shiftKey: false,
    });
    assert.calledWith(onSearch, 'new-query');
  });

  it('does not invoke `onSearch` on Shift+Enter in multiline field', () => {
    const onSearch = sinon.stub();
    const wrapper = createSearchField({
      query: 'foo',
      onSearch,
      multiline: true,
      fullWidthSubmitLabel: 'Ask AI for Annotations',
      onClearSearch: sinon.stub(),
    });
    typeQueryTextarea(wrapper, 'new-query');
    wrapper.find('textarea').simulate('keydown', {
      key: 'Enter',
      shiftKey: true,
    });
    assert.notCalled(onSearch);
  });

  it('disables textarea, clear, and full-width submit when `disabled` is true', () => {
    const query = 'some query';
    const wrapper = createSearchField({
      disabled: true,
      query,
      multiline: true,
      fullWidthSubmitLabel: 'Ask AI for Annotations',
      onSearch: sinon.stub(),
      onClearSearch: sinon.stub(),
    });
    assert.isTrue(wrapper.find('textarea').prop('disabled'));
    assert.deepEqual(
      wrapper.find('button').map(btn => btn.prop('disabled')),
      [true, true],
    );
    const submitClasses = wrapper
      .find('[data-testid="search-submit-button"]')
      .first()
      .prop('classes');
    assert.include(submitClasses, 'opacity-50');
    assert.include(submitClasses, 'cursor-not-allowed');
  });

  it(
    'should pass a11y checks',
    checkAccessibility([
      {
        content: () => createSearchField(),
      },
      {
        name: 'loading state',
        content: () => {
          fakeStore.isLoading.returns(true);
          return createSearchField();
        },
      },
      {
        name: 'multiline with full-width submit',
        content: () =>
          createSearchField({
            multiline: true,
            fullWidthSubmitLabel: 'Ask AI for Annotations',
            query: 'q',
            onSearch: sinon.stub(),
            onClearSearch: sinon.stub(),
          }),
      },
    ]),
  );
});
