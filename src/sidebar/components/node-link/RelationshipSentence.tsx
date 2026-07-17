import { colorForTag } from '../../node-link/graph-model';
import type { ManualTagEdge } from '../../node-link/graph-state';

export function TagBadge({
  tag,
  tagColors,
}: {
  tag: string;
  tagColors: Record<string, string>;
}) {
  return (
    <span
      className="inline-block max-w-full truncate rounded-full px-2.5 py-0.5 font-bold text-white"
      style={{ backgroundColor: colorForTag(tag, tagColors) }}
      title={tag}
    >
      {tag}
    </span>
  );
}

export function RelationshipSentence({
  edge,
  tagColors,
}: {
  edge: ManualTagEdge;
  tagColors: Record<string, string>;
}) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <TagBadge tag={edge.sourceTag} tagColors={tagColors} />
      <strong>{edge.connectionType}</strong>
      <TagBadge tag={edge.targetTag} tagColors={tagColors} />
    </span>
  );
}
