import * as fixtures from '../../test/annotation-fixtures';

import {
  buildCandidateRows,
  buildClaudeAISearchUserMessage,
  collectTagQueryQuoteRows,
  countAiSearchQuotesSkippedAsDuplicates,
  countAISearchRowPendingAnnotations,
  countAISearchRowTotalAnnotations,
  dedupeTagQueryRows,
  deleteAllActionForAISearchRowMatch,
  filterAiSearchQuotesAgainstExisting,
  listSavedAnnotationsMatchingAISearchRow,
  tagsAfterRemovingAISearchRowSchemaTag,
} from '../claude-ai-search-user-message';

describe('sidebar/helpers/claude-ai-search-user-message', () => {
  const pdf = 'http://example.com/paper.pdf';

  function textQuoteAnn(props) {
    const {
      id,
      uri = pdf,
      tags = [],
      text = '',
      exact = 'verbatim quote',
      references = [],
    } = props;
    return {
      ...fixtures.defaultAnnotation(),
      id,
      uri,
      tags,
      text,
      references,
      target: [
        {
          source: uri,
          selector: [{ type: 'TextQuoteSelector', exact }],
        },
      ],
    };
  }

  describe('buildClaudeAISearchUserMessage', () => {
    it('uses tag+query template when schemaTag is non-empty', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [{ tag: 't', query: 'q1', quote: 'v' }],
        schemaTag: 'schema',
        searchQuery: 'find this',
      });
      assert.include(
        out,
        'What retrieved verbatim quotes from the document would go with the tag "schema" and the query "find this"?',
      );
    });

    it('uses New query template when schemaTag is empty', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [],
        schemaTag: '',
        searchQuery: 'only the search',
      });
      assert.notInclude(out, 'Examples of tag-query-quote triples');
      assert.include(out, 'New query: only the search.');
    });

    it('renders empty tag and query as blank fields', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [{ tag: '', query: '', quote: 'x' }],
        schemaTag: 's',
        searchQuery: 'q',
      });
      assert.include(out, 'Examples of tag-query-quote triples');
      assert.include(out, 'tag: ');
      assert.include(out, 'query: ');
      assert.include(out, 'quote: x');
    });

    it('omits positive block when rows empty', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [],
        schemaTag: 's',
        searchQuery: 'q',
      });
      assert.notInclude(out, 'Examples of tag-query-quote triples');
      assert.include(
        out,
        'What retrieved verbatim quotes from the document would go with the tag "s" and the query "q"?',
      );
    });

    it('appends negative examples after positives when both present', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [{ tag: 't', query: 'q1', quote: 'v' }],
        schemaTag: 's',
        searchQuery: 'find',
        negativeExamples: [
          {
            id: 'n1',
            schemaTag: 'nt',
            query: 'nq',
            quote: 'bad',
            documentUri: 'http://x',
          },
        ],
      });
      const posIdx = out.indexOf('Examples of tag-query-quote triples');
      const negIdx = out.indexOf(
        'Negative examples of tag-query-quote triples:',
      );
      assert.isBelow(posIdx, negIdx);
      assert.include(
        out,
        '- tag: nt\n  query: nq\n  should not return\n  quote: bad\n',
      );
    });

    it('includes only negative block and question when no positives', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [],
        schemaTag: '',
        searchQuery: 'solo',
        negativeExamples: [
          {
            id: 'n1',
            schemaTag: 'a',
            query: 'b',
            quote: 'c',
            documentUri: 'http://x',
          },
        ],
      });
      assert.notInclude(out, 'Examples of tag-query-quote triples');
      assert.include(out, 'Negative examples of tag-query-quote triples:');
      assert.include(
        out,
        '- tag: a\n  query: b\n  should not return\n  quote: c\n',
      );
      assert.include(out, 'New query: solo.');
    });

    it('formats negative example with empty tag like positive triple lines', () => {
      const out = buildClaudeAISearchUserMessage({
        rows: [],
        schemaTag: 's',
        searchQuery: 'q',
        negativeExamples: [
          {
            id: 'n1',
            schemaTag: '',
            query: 'onlyq',
            quote: 'qt',
            documentUri: 'http://x',
          },
        ],
      });
      assert.include(
        out,
        '- tag: \n  query: onlyq\n  should not return\n  quote: qt\n',
      );
    });
  });

  describe('filterAiSearchQuotesAgainstExisting', () => {
    it('drops quote when ai-user-approved annotation has same tag and quote', () => {
      const saved = [
        textQuoteAnn({
          id: 'a1',
          tags: ['methods', 'ai-user-approved'],
          text: 'prior query',
          exact: 'same quote text',
        }),
      ];
      const raw = [{ text: 'same quote text' }, { text: 'new quote' }];
      const out = filterAiSearchQuotesAgainstExisting(
        raw,
        saved,
        pdf,
        'methods',
      );
      assert.deepEqual(out, [{ text: 'new quote' }]);
    });

    it('drops quote when ai-pending annotation has same tag and quote', () => {
      const saved = [
        textQuoteAnn({
          id: 'p1',
          tags: ['ai-pending', 'methods'],
          text: 'q',
          exact: 'overlap',
        }),
      ];
      const out = filterAiSearchQuotesAgainstExisting(
        [{ text: 'overlap' }],
        saved,
        pdf,
        'methods',
      );
      assert.deepEqual(out, []);
    });

    it('keeps quote when quote text differs', () => {
      const saved = [
        textQuoteAnn({
          id: 'a1',
          tags: ['t', 'ai-user-approved'],
          text: 'q',
          exact: 'only this',
        }),
      ];
      const out = filterAiSearchQuotesAgainstExisting(
        [{ text: 'different' }],
        saved,
        pdf,
        't',
      );
      assert.deepEqual(out, [{ text: 'different' }]);
    });

    it('keeps quote when schema tag differs from existing annotation', () => {
      const saved = [
        textQuoteAnn({
          id: 'a1',
          tags: ['other', 'ai-user-approved'],
          text: 'q',
          exact: 'shared',
        }),
      ];
      const out = filterAiSearchQuotesAgainstExisting(
        [{ text: 'shared' }],
        saved,
        pdf,
        'methods',
      );
      assert.deepEqual(out, [{ text: 'shared' }]);
    });

    it('empty schema: drops when only system tags and same quote', () => {
      const saved = [
        textQuoteAnn({
          id: 'a1',
          tags: ['ai-user-approved'],
          text: 'q',
          exact: 'bare',
        }),
      ];
      const out = filterAiSearchQuotesAgainstExisting(
        [{ text: 'bare' }],
        saved,
        pdf,
        '',
      );
      assert.deepEqual(out, []);
    });

    it('empty schema: keeps when existing has a content tag', () => {
      const saved = [
        textQuoteAnn({
          id: 'a1',
          tags: ['foo', 'ai-user-approved'],
          text: 'q',
          exact: 'x',
        }),
      ];
      const out = filterAiSearchQuotesAgainstExisting(
        [{ text: 'x' }],
        saved,
        pdf,
        '',
      );
      assert.deepEqual(out, [{ text: 'x' }]);
    });

    it('passes through empty quote entries', () => {
      const out = filterAiSearchQuotesAgainstExisting(
        [{ text: '' }, { text: '  ' }],
        [],
        pdf,
        't',
      );
      assert.deepEqual(out, [{ text: '' }, { text: '  ' }]);
    });

    it('countAiSearchQuotesSkippedAsDuplicates counts non-empty only', () => {
      const raw = [{ text: 'a' }, { text: 'b' }, { text: '' }];
      const filtered = [{ text: 'b' }, { text: '' }];
      assert.equal(
        countAiSearchQuotesSkippedAsDuplicates(raw, filtered),
        1,
      );
    });
  });

  describe('buildCandidateRows', () => {
    it('includes Set A on matching URI with quote', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'a1',
            tags: ['schema', 'ai-user-approved'],
            text: 'ai query',
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].set, 'A');
      assert.equal(rows[0].tag, 'schema');
      assert.equal(rows[0].query, 'ai query');
    });

    it('includes Set B when not ai-tagged', () => {
      const rows = buildCandidateRows(
        [textQuoteAnn({ id: 'b1', tags: ['foo'], text: 'note' })],
        pdf,
      );
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].set, 'B');
    });

    it('excludes wrong URI', () => {
      const rows = buildCandidateRows(
        [textQuoteAnn({ id: 'x', uri: 'http://other.com/x.pdf' })],
        pdf,
      );
      assert.lengthOf(rows, 0);
    });

    it('excludes replies', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'r1',
            tags: ['x'],
            text: 'reply',
            references: ['parent'],
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 0);
    });

    it('excludes ai-pending', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'p1',
            tags: ['ai-pending'],
            text: 'x',
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 0);
    });

    it('includes tagged highlight with no body text', () => {
      const rows = buildCandidateRows(
        [
          textQuoteAnn({
            id: 'h1',
            tags: ['marked'],
            text: '',
          }),
        ],
        pdf,
      );
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].query, '');
    });
  });

  describe('dedupeTagQuoteRows', () => {
    it('merges A+B on same tag+quote, keeps B, deletes A', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const a = textQuoteAnn({
        id: 'id-a',
        tags: ['t', 'ai-user-approved'],
        text: 'q1',
        exact: 'same',
      });
      const b = textQuoteAnn({
        id: 'id-b',
        tags: ['t'],
        text: 'q2',
        exact: 'same',
      });
      const candidates = buildCandidateRows([a, b], pdf);
      const out = await dedupeTagQueryRows(candidates, svc);
      assert.lengthOf(out, 1);
      assert.equal(out[0].annotation.id, 'id-b');
      assert.calledOnce(del);
      assert.calledWith(del, sinon.match({ id: 'id-a' }));
    });

    it('merges A+A and deletes one A', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const a1 = textQuoteAnn({
        id: 'a1',
        tags: ['t', 'ai-user-approved'],
        text: 'q',
        exact: 'e',
      });
      const a2 = textQuoteAnn({
        id: 'a2',
        tags: ['t', 'ai-user-approved'],
        text: 'q2',
        exact: 'e',
      });
      const candidates = buildCandidateRows([a1, a2], pdf);
      const out = await dedupeTagQueryRows(candidates, svc);
      assert.lengthOf(out, 1);
      assert.equal(out[0].annotation.id, 'a1');
      assert.calledOnce(del);
      assert.calledWith(del, sinon.match({ id: 'a2' }));
    });

    it('keeps two B rows when tag+quote match but query differs', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const b1 = textQuoteAnn({
        id: 'b1',
        tags: ['t'],
        text: 'q1',
        exact: 'e',
      });
      const b2 = textQuoteAnn({
        id: 'b2',
        tags: ['t'],
        text: 'q2',
        exact: 'e',
      });
      const candidates = buildCandidateRows([b1, b2], pdf);
      const out = await dedupeTagQueryRows(candidates, svc);
      assert.lengthOf(out, 2);
      assert.notCalled(del);
    });

    it('merges B+B on same tag+quote+query and deletes one B', async () => {
      const del = sinon.stub().resolves();
      const svc = { delete: del };
      const b1 = textQuoteAnn({
        id: 'b1',
        tags: ['t'],
        text: 'sameq',
        exact: 'e',
      });
      const b2 = textQuoteAnn({
        id: 'b2',
        tags: ['t'],
        text: 'sameq',
        exact: 'e',
      });
      const candidates = buildCandidateRows([b1, b2], pdf);
      const out = await dedupeTagQueryRows(candidates, svc);
      assert.lengthOf(out, 1);
      assert.equal(out[0].annotation.id, 'b1');
      assert.calledOnce(del);
      assert.calledWith(del, sinon.match({ id: 'b2' }));
    });
  });

  describe('collectTagQueryQuoteRows', () => {
    it('returns rows and logs timing', async () => {
      sinon.stub(console, 'log');
      const del = sinon.stub().resolves();
      const ann = textQuoteAnn({
        id: 'c1',
        tags: ['z', 'ai-user-approved'],
        text: 'qq',
      });
      const rows = await collectTagQueryQuoteRows([ann], pdf, {
        delete: del,
      });
      assert.lengthOf(rows, 1);
      assert.equal(rows[0].tag, 'z');
      const logCall = console.log.getCall(console.log.callCount - 1);
      assert.equal(logCall.args[0], '[AISearch] example triples construction');
      assert.property(logCall.args[1], 'elapsedMs');
      assert.isNumber(logCall.args[1].elapsedMs);
    });
  });

  describe('countAISearchRowPendingAnnotations / countAISearchRowTotalAnnotations', () => {
    it('counts pending only for strict ai-pending tag shape with matching query', () => {
      const pending = textQuoteAnn({
        id: 'p1',
        tags: ['ai-pending', 'schema'],
        text: 'find me',
      });
      const approved = textQuoteAnn({
        id: 'a1',
        tags: ['schema', 'ai-user-approved'],
        text: 'find me',
      });
      assert.equal(
        countAISearchRowPendingAnnotations([pending, approved], pdf, 'schema', 'find me'),
        1,
      );
      assert.equal(
        countAISearchRowTotalAnnotations([pending, approved], pdf, 'schema', 'find me'),
        2,
      );
    });

    it('does not count pending when ai-pending tag order does not match strict shape', () => {
      const wrongOrder = textQuoteAnn({
        id: 'w1',
        tags: ['schema', 'ai-pending'],
        text: 'find me',
      });
      assert.equal(
        countAISearchRowPendingAnnotations([wrongOrder], pdf, 'schema', 'find me'),
        0,
      );
      assert.equal(
        countAISearchRowTotalAnnotations([wrongOrder], pdf, 'schema', 'find me'),
        1,
      );
    });

    it('includes manual annotation with same tag and query as total', () => {
      const manual = textQuoteAnn({
        id: 'm1',
        tags: ['t1'],
        text: 'q',
      });
      assert.equal(countAISearchRowPendingAnnotations([manual], pdf, 't1', 'q'), 0);
      assert.equal(countAISearchRowTotalAnnotations([manual], pdf, 't1', 'q'), 1);
    });

    it('excludes replies and wrong uri', () => {
      const reply = textQuoteAnn({
        id: 'r1',
        tags: ['ai-pending', 'x'],
        text: 'q',
        references: ['parent'],
      });
      const other = textQuoteAnn({
        id: 'o1',
        uri: 'http://other/doc.pdf',
        tags: ['ai-pending', 'x'],
        text: 'q',
      });
      assert.equal(countAISearchRowTotalAnnotations([reply, other], pdf, 'x', 'q'), 0);
    });
  });

  describe('deleteAllActionForAISearchRowMatch / listSavedAnnotationsMatchingAISearchRow / tagsAfterRemovingAISearchRowSchemaTag', () => {
    it('deleteAll: empty schema row always deletes', () => {
      const ann = textQuoteAnn({
        id: 'e1',
        tags: ['ai-pending'],
        text: 'q',
      });
      assert.equal(deleteAllActionForAISearchRowMatch(ann, ''), 'deleteAnnotation');
    });

    it('deleteAll: multiple content tags yields removeRowTag', () => {
      const ann = textQuoteAnn({
        id: 'm1',
        tags: ['ai-pending', 'a', 'b'],
        text: 'q',
      });
      assert.equal(deleteAllActionForAISearchRowMatch(ann, 'a'), 'removeRowTag');
    });

    it('deleteAll: single content tag yields deleteAnnotation', () => {
      const ann = textQuoteAnn({
        id: 's1',
        tags: ['schema', 'ai-user-approved'],
        text: 'q',
      });
      assert.equal(deleteAllActionForAISearchRowMatch(ann, 'schema'), 'deleteAnnotation');
    });

    it('listSavedAnnotationsMatchingAISearchRow returns Total matches', () => {
      const a = textQuoteAnn({
        id: '1',
        tags: ['t', 'ai-user-approved'],
        text: 'qq',
      });
      const b = textQuoteAnn({
        id: '2',
        tags: ['other'],
        text: 'xx',
      });
      const list = listSavedAnnotationsMatchingAISearchRow([a, b], pdf, 't', 'qq');
      assert.lengthOf(list, 1);
      assert.equal(list[0].id, '1');
    });

    it('tagsAfterRemovingAISearchRowSchemaTag removes the schema tag', () => {
      assert.deepEqual(
        tagsAfterRemovingAISearchRowSchemaTag(['ai-pending', 'a', 'b'], 'a'),
        ['ai-pending', 'b'],
      );
    });
  });

});
