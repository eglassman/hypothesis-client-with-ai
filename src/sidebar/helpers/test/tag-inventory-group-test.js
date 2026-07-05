import * as fixtures from '../../test/annotation-fixtures';
import { PUBLIC_GROUP_ID } from '../groups';
import {
  canMarkTagAsNegativeExample,
  canRevertNegativeExampleTag,
  deriveTagInventoryRowDescriptors,
  tagInventoryRowDescriptorsForAnnotation,
  annotationBelongsToTagInventoryRow,
  countAnnotationsForTagInventoryRow,
  listAnnotationsBelongingToTagInventoryRow,
  isTagInventoryRowVisibleInScope,
  isConvertiblePositiveContentTag,
  isNegativeSchemaTag,
  negativeSchemaTagForPositiveTag,
  negativeSchemaTags,
  positiveSchemaTagForNegativeTag,
  positiveSchemaTags,
  pruneTagInventoryRowsToDescriptors,
  retagAllPositiveSchemaTagsAsNegative,
  retagOneNegativeSchemaTagAsPositive,
  retagOnePositiveSchemaTagAsNegative,
  rowDescriptorKey,
  sortTagInventoryRows,
} from '../tag-inventory-group';

function publicScope(documentUri) {
  return {
    focusedGroupId: PUBLIC_GROUP_ID,
    currentDocumentUri: documentUri,
  };
}

function privateScope(groupId) {
  return { focusedGroupId: groupId };
}

describe('sidebar/helpers/tag-inventory-group', () => {
  const pdf = 'http://example.com/paper.pdf';
  const pdfB = 'http://example.com/other.pdf';
  const groupA = 'group-a-id';

  function savedAnn(props) {
    const base = fixtures.defaultAnnotation();
    const {
      id,
      uri = pdf,
      group = base.group,
      tags = [],
      text = '',
      references = [],
    } = props;
    return {
      ...base,
      id,
      uri,
      group,
      tags,
      text,
      references,
    };
  }

  describe('schema tag classification', () => {
    it('isNegativeSchemaTag matches suffix tags with non-empty prefix', () => {
      assert.isTrue(isNegativeSchemaTag('methods-neg-example'));
      assert.isFalse(isNegativeSchemaTag('methods'));
      assert.isFalse(isNegativeSchemaTag('-neg-example'));
    });

    it('negativeSchemaTagForPositiveTag appends suffix', () => {
      assert.equal(
        negativeSchemaTagForPositiveTag('methods'),
        'methods-neg-example',
      );
    });

    it('positiveSchemaTags excludes system and negative schema tags', () => {
      assert.deepEqual(
        positiveSchemaTags([
          'methods',
          'methods-neg-example',
          'ai-pending',
          'ai-user-approved',
        ]),
        ['methods'],
      );
    });

    it('negativeSchemaTags returns only negative schema tags', () => {
      assert.deepEqual(negativeSchemaTags(['methods', 'methods-neg-example']), [
        'methods-neg-example',
      ]);
    });
  });

  describe('tag pill retag helpers', () => {
    it('isConvertiblePositiveContentTag excludes system and negative tags', () => {
      assert.isTrue(isConvertiblePositiveContentTag('methods'));
      assert.isFalse(isConvertiblePositiveContentTag('methods-neg-example'));
      assert.isFalse(isConvertiblePositiveContentTag('ai-pending'));
    });

    it('positiveSchemaTagForNegativeTag strips suffix', () => {
      assert.equal(
        positiveSchemaTagForNegativeTag('methods-neg-example'),
        'methods',
      );
      assert.isNull(positiveSchemaTagForNegativeTag('methods'));
    });

    it('retagOnePositiveSchemaTagAsNegative converts one positive tag', () => {
      assert.deepEqual(
        retagOnePositiveSchemaTagAsNegative(['methods'], 'methods'),
        ['methods-neg-example'],
      );
      assert.deepEqual(
        retagOnePositiveSchemaTagAsNegative(
          ['methods', 'ai-user-approved'],
          'methods',
        ),
        ['methods-neg-example'],
      );
      assert.deepEqual(
        retagOnePositiveSchemaTagAsNegative(['methods', 'other'], 'methods'),
        ['other', 'methods-neg-example'],
      );
      assert.isNull(
        retagOnePositiveSchemaTagAsNegative(['methods-neg-example'], 'methods'),
      );
    });

    it('retagOneNegativeSchemaTagAsPositive reverts one negative tag', () => {
      assert.deepEqual(
        retagOneNegativeSchemaTagAsPositive(
          ['methods-neg-example'],
          'methods-neg-example',
        ),
        ['methods'],
      );
      assert.deepEqual(
        retagOneNegativeSchemaTagAsPositive(
          ['methods-neg-example', 'other'],
          'methods-neg-example',
        ),
        ['methods', 'other'],
      );
      assert.isNull(
        retagOneNegativeSchemaTagAsPositive(['methods'], 'methods-neg-example'),
      );
    });

    it('canMarkTagAsNegativeExample requires no ai-pending', () => {
      assert.isTrue(canMarkTagAsNegativeExample(['methods'], 'methods'));
      assert.isFalse(
        canMarkTagAsNegativeExample(['ai-pending', 'methods'], 'methods'),
      );
    });

    it('retagAllPositiveSchemaTagsAsNegative strips AI system tags', () => {
      assert.deepEqual(
        retagAllPositiveSchemaTagsAsNegative(['ai-pending', 'methods']),
        ['methods-neg-example'],
      );
      assert.deepEqual(
        retagAllPositiveSchemaTagsAsNegative(['ai-user-approved', 'methods']),
        ['methods-neg-example'],
      );
    });

    it('canRevertNegativeExampleTag requires negative tag and no ai-pending', () => {
      assert.isTrue(
        canRevertNegativeExampleTag(
          ['methods-neg-example'],
          'methods-neg-example',
        ),
      );
      assert.isFalse(
        canRevertNegativeExampleTag(
          ['ai-pending', 'methods-neg-example'],
          'methods-neg-example',
        ),
      );
    });
  });

  describe('deriveTagInventoryRowDescriptors', () => {
    it('ai-user-approved on methods yields row with query from text', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
        savedAnn({
          id: 'a1',
          tags: ['methods', 'ai-user-approved'],
          text: '  stats query  ',
        }),
      ]);
      assert.deepEqual(descriptors, [
        { schemaTag: 'methods', query: 'stats query' },
      ]);
    });

    it('neg-example tag yields neg row with empty query', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
        savedAnn({
          id: 'n1',
          tags: ['methods-neg-example'],
          text: 'declined q',
        }),
      ]);
      assert.deepEqual(descriptors, [
        { schemaTag: 'methods-neg-example', query: '' },
      ]);
    });

    it('two neg annotations with different text dedupe to one descriptor', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
        savedAnn({
          id: 'n1',
          tags: ['methods-neg-example'],
          text: 'first body',
        }),
        savedAnn({
          id: 'n2',
          tags: ['methods-neg-example'],
          text: 'second body',
        }),
      ]);
      assert.deepEqual(descriptors, [
        { schemaTag: 'methods-neg-example', query: '' },
      ]);
    });

    it('regular annotations create rows with empty query', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
        savedAnn({ id: 'm1', tags: ['methods'], text: 'ignored' }),
      ]);
      assert.deepEqual(descriptors, [{ schemaTag: 'methods', query: '' }]);
    });

    it('ignores replies and system-tag-only annotations', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
        savedAnn({
          id: 'r1',
          tags: ['methods'],
          references: ['parent'],
        }),
        savedAnn({
          id: 's1',
          tags: ['ai-user-approved'],
          text: 'q',
        }),
      ]);
      assert.lengthOf(descriptors, 0);
    });

    it('dedupes same tag+query across different document URIs', () => {
      const descriptors = deriveTagInventoryRowDescriptors([
        savedAnn({
          id: 'a1',
          uri: pdf,
          tags: ['methods', 'ai-user-approved'],
          text: 'regression',
        }),
        savedAnn({
          id: 'a2',
          uri: pdfB,
          tags: ['methods', 'ai-user-approved'],
          text: 'regression',
        }),
      ]);
      assert.deepEqual(descriptors, [
        { schemaTag: 'methods', query: 'regression' },
      ]);
    });
  });

  describe('tagInventoryRowDescriptorsForAnnotation', () => {
    it('classifies manual, ai-pending, ai-user-approved, and negative annotations', () => {
      assert.deepEqual(
        tagInventoryRowDescriptorsForAnnotation(
          savedAnn({ id: 'm', tags: ['methods'], text: 'ignored' }),
        ),
        [{ schemaTag: 'methods', query: '' }],
      );
      assert.deepEqual(
        tagInventoryRowDescriptorsForAnnotation(
          savedAnn({
            id: 'p',
            tags: ['methods', 'ai-pending'],
            text: 'find stats',
          }),
        ),
        [{ schemaTag: 'methods', query: 'find stats' }],
      );
      assert.deepEqual(
        tagInventoryRowDescriptorsForAnnotation(
          savedAnn({
            id: 'a',
            tags: ['methods', 'ai-user-approved'],
            text: 'find stats',
          }),
        ),
        [{ schemaTag: 'methods', query: 'find stats' }],
      );
      assert.deepEqual(
        tagInventoryRowDescriptorsForAnnotation(
          savedAnn({
            id: 'n',
            tags: ['methods-neg-example'],
            text: 'any text',
          }),
        ),
        [{ schemaTag: 'methods-neg-example', query: '' }],
      );
    });
  });

  describe('annotationBelongsToTagInventoryRow / listAnnotationsBelongingToTagInventoryRow', () => {
    const query = 'find stats';

    it('query row includes pending and approved, excludes manual', () => {
      const pending = savedAnn({
        id: 'p1',
        tags: ['methods', 'ai-pending'],
        text: query,
      });
      const approved = savedAnn({
        id: 'a1',
        tags: ['methods', 'ai-user-approved'],
        text: query,
      });
      const manual = savedAnn({
        id: 'm1',
        tags: ['methods'],
        text: query,
      });
      const annotations = [pending, approved, manual];

      for (const ann of [pending, approved]) {
        assert.isTrue(
          annotationBelongsToTagInventoryRow(ann, pdf, 'methods', query),
        );
      }
      assert.isFalse(
        annotationBelongsToTagInventoryRow(manual, pdf, 'methods', query),
      );

      const matches = listAnnotationsBelongingToTagInventoryRow(
        annotations,
        pdf,
        'methods',
        query,
      );
      assert.sameMembers(
        matches.map(a => a.id),
        ['p1', 'a1'],
      );
    });

    it('empty-query row includes manual only, excludes AI-tagged', () => {
      const pending = savedAnn({
        id: 'p1',
        tags: ['methods', 'ai-pending'],
        text: 'any',
      });
      const manual = savedAnn({
        id: 'm1',
        tags: ['methods'],
        text: 'any',
      });
      const annotations = [pending, manual];

      assert.isTrue(
        annotationBelongsToTagInventoryRow(manual, pdf, 'methods', ''),
      );
      assert.isFalse(
        annotationBelongsToTagInventoryRow(pending, pdf, 'methods', ''),
      );

      const matches = listAnnotationsBelongingToTagInventoryRow(
        annotations,
        pdf,
        'methods',
        '',
      );
      assert.deepEqual(
        matches.map(a => a.id),
        ['m1'],
      );
    });
  });

  describe('countAnnotationsForTagInventoryRow', () => {
    it('public row counts document-scoped pending and approved only', () => {
      const query = 'find stats';
      const pending = savedAnn({
        id: 'p1',
        group: PUBLIC_GROUP_ID,
        tags: ['methods', 'ai-pending'],
        text: query,
      });
      const manual = savedAnn({
        id: 'm1',
        group: PUBLIC_GROUP_ID,
        tags: ['methods'],
        text: query,
      });
      const row = {
        schemaTag: 'methods',
        query,
        groupId: PUBLIC_GROUP_ID,
      };
      assert.equal(
        countAnnotationsForTagInventoryRow([pending, manual], row, {
          focusedGroupId: PUBLIC_GROUP_ID,
          documentUri: pdf,
        }),
        1,
      );
    });

    it('private row counts group-wide without document filter', () => {
      const manual = savedAnn({
        id: 'm1',
        group: groupA,
        uri: 'http://other/doc.pdf',
        tags: ['methods'],
        text: '',
      });
      const row = {
        schemaTag: 'methods',
        query: '',
        groupId: groupA,
      };
      assert.equal(
        countAnnotationsForTagInventoryRow([manual], row, {
          focusedGroupId: groupA,
        }),
        1,
      );
    });
  });

  describe('rowDescriptorKey / prune / sort', () => {
    it('rowDescriptorKey encodes tag and query only', () => {
      assert.equal(
        rowDescriptorKey('methods', 'q'),
        rowDescriptorKey('methods', 'q'),
      );
      assert.notEqual(
        rowDescriptorKey('methods', 'q'),
        rowDescriptorKey('methods', 'other'),
      );
    });

    it('pruneTagInventoryRowsToDescriptors keeps other groups and drops stale rows', () => {
      const rows = [
        {
          id: '1',
          schemaTag: 'methods',
          query: 'q',
          annotationIds: [],
          groupId: groupA,
        },
        {
          id: '2',
          schemaTag: 'old',
          query: '',
          annotationIds: [],
          groupId: groupA,
        },
        {
          id: '3',
          schemaTag: 'other',
          query: '',
          annotationIds: [],
          groupId: 'other-group',
        },
      ];
      const pruned = pruneTagInventoryRowsToDescriptors(
        rows,
        [{ schemaTag: 'methods', query: 'q' }],
        groupA,
      );
      assert.deepEqual(
        pruned.map(r => r.id),
        ['1', '3'],
      );
    });

    it('sortTagInventoryRows orders by schemaTag then query', () => {
      const sorted = sortTagInventoryRows([
        { id: 'b', schemaTag: 'zebra', query: 'a', annotationIds: [] },
        { id: 'a', schemaTag: 'methods', query: 'z', annotationIds: [] },
        { id: 'c', schemaTag: 'methods', query: 'a', annotationIds: [] },
      ]);
      assert.deepEqual(
        sorted.map(r => r.id),
        ['c', 'a', 'b'],
      );
    });
  });

  describe('isTagInventoryRowVisibleInScope', () => {
    const baseRow = {
      id: 'r1',
      schemaTag: 'methods',
      query: 'q',
      annotationIds: [],
      groupId: groupA,
    };

    it('private group: visible when groupId matches', () => {
      assert.isTrue(
        isTagInventoryRowVisibleInScope(baseRow, privateScope(groupA)),
      );
      assert.isFalse(
        isTagInventoryRowVisibleInScope(baseRow, privateScope('other')),
      );
    });

    it('public group: visible only when row.documentUri matches currentDocumentUri', () => {
      const publicRow = {
        ...baseRow,
        groupId: PUBLIC_GROUP_ID,
        documentUri: pdf,
      };
      assert.isTrue(
        isTagInventoryRowVisibleInScope(publicRow, publicScope(pdf)),
      );
      assert.isFalse(
        isTagInventoryRowVisibleInScope(publicRow, publicScope(pdfB)),
      );
      assert.isTrue(
        isTagInventoryRowVisibleInScope(publicRow, {
          focusedGroupId: PUBLIC_GROUP_ID,
          currentDocumentUri: null,
          documentUriAliases: [pdf],
        }),
        'stays visible while frame URI is resolving when row URI is in aliases',
      );
      assert.isFalse(
        isTagInventoryRowVisibleInScope(publicRow, {
          focusedGroupId: PUBLIC_GROUP_ID,
          currentDocumentUri: null,
          documentUriAliases: [],
        }),
      );
      assert.isFalse(
        isTagInventoryRowVisibleInScope(
          { ...baseRow, groupId: PUBLIC_GROUP_ID },
          publicScope(pdf),
        ),
        'row without documentUri is not visible',
      );
    });

    it('public group: visible when row URN and canonical HTTPS share alias set', () => {
      const urn = 'urn:x-pdf:abc';
      const https = 'https://example.com/paper.pdf';
      const aliases = [urn, https];
      const publicRow = {
        ...baseRow,
        groupId: PUBLIC_GROUP_ID,
        documentUri: urn,
      };
      assert.isTrue(
        isTagInventoryRowVisibleInScope(publicRow, {
          focusedGroupId: PUBLIC_GROUP_ID,
          currentDocumentUri: https,
          documentUriAliases: aliases,
        }),
      );
    });

    it('hides rows missing groupId', () => {
      assert.isFalse(
        isTagInventoryRowVisibleInScope(
          { ...baseRow, groupId: undefined },
          privateScope(groupA),
        ),
      );
    });
  });
});
