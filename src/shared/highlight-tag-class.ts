/**
 * Map an annotation tag string to a safe CSS class name (`h-tag-*`) for
 * highlights and injected tag styles.
 */
export function highlightTagClass(tag: string): string {
  return `h-tag-${tag.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
}
