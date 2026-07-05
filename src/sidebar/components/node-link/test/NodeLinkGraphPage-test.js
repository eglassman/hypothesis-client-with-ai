import { mount } from '@hypothesis/frontend-testing';
import sinon from 'sinon';

import { emptyNodeLinkState } from '../../../node-link/graph-state';
import { NodeLinkEditor } from '../NodeLinkGraphPage';

describe('NodeLinkEditor', () => {
  const tagColors = {};

  function tagNode(tag) {
    return {
      id: `tag:${tag}`,
      tag,
      quoteCount: 1,
      documentCount: 1,
      documentUris: ['https://example.com/doc'],
      descriptive: false,
    };
  }

  function createComponent({ semanticState, onSaveState = sinon.stub() } = {}) {
    const state =
      semanticState ||
      emptyNodeLinkState({
        tagEdges: [
          {
            id: 'edge-character-action',
            sourceTag: 'Character',
            targetTag: 'Action',
            connectionType: 'explains',
          },
        ],
      });
    const graph = {
      tags: [tagNode('Character'), tagNode('Action')],
      quotes: [],
      documents: [],
      manualEdges: state.tagEdges,
      annotationCount: 0,
    };

    return {
      onSaveState,
      wrapper: mount(
        <NodeLinkEditor
          graph={graph}
          selectedTag=""
          semanticState={state}
          tagColors={tagColors}
          onSaveState={onSaveState}
          saveStatus="idle"
          saveMessage=""
        />,
      ),
    };
  }

  function buttonByText(wrapper, text) {
    return wrapper
      .find('button')
      .filterWhere(button => button.text() === text)
      .first();
  }

  it('opens edge edits in a modal instead of reusing the add form', () => {
    const { wrapper } = createComponent();

    buttonByText(wrapper, 'Edit').props().onClick();
    wrapper.update();

    assert.isTrue(wrapper.find('[role="dialog"]').exists());
    assert.include(wrapper.find('[role="dialog"]').text(), 'Edit edge');
    assert.include(wrapper.text(), 'Add Edge');
    assert.notInclude(wrapper.text(), 'Update Edge');
  });

  it('requires confirmation before deleting an edge', () => {
    const { wrapper, onSaveState } = createComponent();

    buttonByText(wrapper, 'Delete').props().onClick();
    wrapper.update();

    assert.include(wrapper.text(), 'Confirm delete?');
    assert.notCalled(onSaveState);

    buttonByText(wrapper, 'No').props().onClick();
    wrapper.update();

    assert.notInclude(wrapper.text(), 'Confirm delete?');

    buttonByText(wrapper, 'Delete').props().onClick();
    wrapper.update();
    buttonByText(wrapper, 'Yes').props().onClick();

    assert.calledOnce(onSaveState);
    assert.lengthOf(onSaveState.firstCall.args[0].tagEdges, 0);
  });
});
