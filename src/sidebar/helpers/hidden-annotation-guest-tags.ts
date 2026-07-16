/**
 * Map server annotation IDs from the sidebar store to guest `$tag` values.
 * Guest frames only receive `$tag` (see `formatAnnot`), not `id`.
 */
export function mapHiddenAnnotationIdsToGuestTags(
  annotations: Array<{ id?: string; $tag: string }>,
  hiddenAnnotationIds: string[],
): string[] {
  if (hiddenAnnotationIds.length === 0) {
    return [];
  }
  const idToTag = new Map<string, string>();
  for (const ann of annotations) {
    if (ann.id) {
      idToTag.set(ann.id, ann.$tag);
    }
  }
  const tags: string[] = [];
  for (const id of hiddenAnnotationIds) {
    const tag = idToTag.get(id);
    if (tag) {
      tags.push(tag);
    }
  }
  return tags.sort();
}
