import {
  INITIAL_AI_TAG_HIGHLIGHT_PALETTE,
  computeTagInventoryHighlightState,
  mergeVisibleTagHighlightPalette,
} from '../tag-palette';
import { mapHiddenAnnotationIdsToGuestTags } from '../hidden-annotation-guest-tags';

describe('sidebar/helpers/tag-palette', () => {
  it('keeps defaults and excludes tags from hidden-only rows', () => {
    const palette = mergeVisibleTagHighlightPalette(
      [{ schemaTag: 'topic-a', hidden: true }],
      { 'topic-a': 'rgba(10, 20, 30, 0.38)' },
    );

    assert.deepEqual(palette, INITIAL_AI_TAG_HIGHLIGHT_PALETTE);
  });

  it('includes a tag color if at least one row for it is visible', () => {
    const palette = mergeVisibleTagHighlightPalette(
      [
        { schemaTag: 'topic-a', hidden: true },
        { schemaTag: 'topic-a' },
      ],
      { 'topic-a': 'rgba(10, 20, 30, 0.38)' },
    );

    assert.deepEqual(palette, {
      ...INITIAL_AI_TAG_HIGHLIGHT_PALETTE,
      'topic-a': 'rgba(10, 20, 30, 0.38)',
    });
  });

  it('drops and restores schema-tag entries when rows are hidden/unhidden', () => {
    const schemaTagColors = { topic: 'rgba(10, 20, 30, 0.38)' };

    const hiddenPalette = mergeVisibleTagHighlightPalette(
      [{ schemaTag: 'topic', hidden: true }],
      schemaTagColors,
    );
    assert.notProperty(hiddenPalette, 'topic');

    const visiblePalette = mergeVisibleTagHighlightPalette(
      [{ schemaTag: 'topic', hidden: false }],
      schemaTagColors,
    );
    assert.propertyVal(visiblePalette, 'topic', 'rgba(10, 20, 30, 0.38)');
  });

  it('hides only annotations not on any visible row', () => {
    const state = computeTagInventoryHighlightState(
      [
        {
          id: 'r1',
          groupId: 'g1',
          schemaTag: 'topic',
          query: 'q1',
          annotationIds: ['ann-hidden-only'],
          hidden: true,
        },
        {
          id: 'r2',
          groupId: 'g1',
          schemaTag: 'topic',
          query: 'q2',
          annotationIds: ['ann-shared'],
          hidden: true,
        },
        {
          id: 'r3',
          groupId: 'g1',
          schemaTag: 'topic',
          query: 'q3',
          annotationIds: ['ann-shared', 'ann-visible-only'],
        },
      ],
      { focusedGroupId: 'g1', currentDocumentUri: null, documentUriAliases: [] },
    );

    assert.deepEqual(state.hiddenAnnotationIds, ['ann-hidden-only']);
  });

  it('maps server annotation ids to guest $tags', () => {
    const tags = mapHiddenAnnotationIdsToGuestTags(
      [
        { id: 'ann-1', $tag: 'tag-1' },
        { id: 'ann-2', $tag: 'tag-2' },
      ],
      ['ann-2', 'ann-missing'],
    );
    assert.deepEqual(tags, ['tag-2']);
  });
});
