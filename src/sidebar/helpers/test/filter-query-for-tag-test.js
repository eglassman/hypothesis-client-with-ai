import { parseFilterQuery } from '../query-parser';
import { formatSidebarTagFilter } from '../filter-query-for-tag';

describe('sidebar/helpers/filter-query-for-tag', () => {
  function tagTerms(query) {
    const parsed = parseFilterQuery(query);
    return parsed.tag?.terms ?? [];
  }

  it('round-trips simple tags', () => {
    const tag = 'my-schema';
    const q = formatSidebarTagFilter(tag);
    assert.equal(q, 'tag:my-schema');
    assert.deepEqual(tagTerms(q), [tag]);
  });

  it('round-trips tags with spaces via a quoted token', () => {
    const tag = 'my tag';
    const q = formatSidebarTagFilter(tag);
    assert.equal(q, '"tag:my tag"');
    assert.deepEqual(tagTerms(q), [tag]);
  });

  it('round-trips tags with a single quote using double-quoted token', () => {
    const tag = "o'reilly";
    const q = formatSidebarTagFilter(tag);
    assert.equal(q, `"tag:${tag}"`);
    assert.deepEqual(tagTerms(q), [tag]);
  });

  it('round-trips tags with double quotes using single-quoted token', () => {
    const tag = 'say "hi"';
    const q = formatSidebarTagFilter(tag);
    assert.equal(q, `'tag:${tag}'`);
    assert.deepEqual(tagTerms(q), [tag]);
  });

  it('returns empty string for whitespace-only input', () => {
    assert.equal(formatSidebarTagFilter('   '), '');
  });
});
