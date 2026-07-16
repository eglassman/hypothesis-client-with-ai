/**
 * Build a sidebar filter query token that matches annotations containing `tag`.
 *
 * The result is suitable for {@link parseFilterQuery}. Tags with whitespace or
 * quote characters are wrapped so tokenization stays a single `tag:` facet.
 */
export function formatSidebarTagFilter(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) {
    return '';
  }

  const hasSpace = /\s/.test(trimmed);
  const hasDouble = trimmed.includes('"');
  const hasSingle = trimmed.includes("'");

  if (!hasSpace && !hasDouble && !hasSingle) {
    return `tag:${trimmed}`;
  }
  if (!hasDouble) {
    return `"tag:${trimmed}"`;
  }
  if (!hasSingle) {
    return `'tag:${trimmed}'`;
  }
  // Cannot wrap a single token when the tag contains both quote characters.
  return `tag:${trimmed}`;
}
