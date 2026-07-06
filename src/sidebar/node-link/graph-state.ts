import type { Annotation } from '../../types/api';

export const NODE_LINK_STATE_KIND = 'hypothesis-node-link-state';
export const NODE_LINK_STATE_SCHEMA_VERSION = 1;
export const NODE_LINK_STATE_TAG = 'node-link-state';
export const NODE_LINK_STATE_VERSION_TAG = 'node-link-state:v1';
export const NODE_LINK_STATE_TAGS = [
  NODE_LINK_STATE_TAG,
  NODE_LINK_STATE_VERSION_TAG,
];

const STATE_URI_PREFIX = 'https://hypothesis-node-link.local/state/group/';
const SYSTEM_TAGS = new Set(['ai-pending', 'ai-user-approved']);

export type DescriptiveTag = {
  id: string;
  tag: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
};

export type ManualTagEdge = {
  id?: string;
  sourceTag: string;
  targetTag: string;
  connectionType: string;
  label?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  createdFrom?: string;
};

export type NodeLinkSemanticState = {
  schemaVersion: 1;
  updatedAt: string | null;
  selectedGroupId: string | null;
  descriptiveTags: DescriptiveTag[];
  tagEdges: ManualTagEdge[];
};

export type NodeLinkStatePayloadV1 = {
  kind: typeof NODE_LINK_STATE_KIND;
  schemaVersion: typeof NODE_LINK_STATE_SCHEMA_VERSION;
  groupId: string;
  stateUri: string | null;
  updatedAt: string;
  edits: {
    descriptiveTags?: DescriptiveTag[];
    tagEdges?: ManualTagEdge[];
  };
};

export type TagRelationship = ManualTagEdge;

export type TagRelationships = {
  outgoing: TagRelationship[];
  incoming: TagRelationship[];
};

export type NodeLinkTagReferenceEntry = {
  tag: string;
  annotationCount: number;
  descriptive: boolean;
  outgoingRelationships: Array<{
    relationship: string;
    targetTag: string;
  }>;
  incomingRelationships: Array<{
    sourceTag: string;
    relationship: string;
  }>;
};

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function cleanStringOrNull(value: unknown) {
  const text = cleanString(value);
  return text || null;
}

function cleanDateString(value: unknown) {
  return cleanString(value) || new Date().toISOString();
}

function cleanDescriptiveTags(tags: unknown[] = []) {
  const seen = new Set<string>();
  const result: DescriptiveTag[] = [];

  for (const item of tags) {
    const tag = cleanString((item as DescriptiveTag | null)?.tag);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    const tagItem = item as DescriptiveTag;
    const descriptiveTag: DescriptiveTag = {
      id: cleanString(tagItem?.id) || `desc:${tag}`,
      tag,
      createdBy: cleanString(tagItem?.createdBy) || 'human',
    };
    if (tagItem?.createdAt) {
      descriptiveTag.createdAt = cleanDateString(tagItem.createdAt);
    }
    if (tagItem?.updatedAt) {
      descriptiveTag.updatedAt = cleanDateString(tagItem.updatedAt);
    }
    result.push(descriptiveTag);
  }

  return result;
}

function cleanTagEdges(edges: unknown[] = []) {
  const seen = new Set<string>();
  const result: ManualTagEdge[] = [];

  for (const item of edges) {
    const edge = item as ManualTagEdge | null;
    const sourceTag = cleanString(edge?.sourceTag);
    const targetTag = cleanString(edge?.targetTag);
    const relationship = cleanString(edge?.connectionType || edge?.label);
    if (!sourceTag || !targetTag || !relationship) {
      continue;
    }

    const key = `${sourceTag}\n${targetTag}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const cleanEdge: ManualTagEdge = {
      sourceTag,
      targetTag,
      connectionType: relationship,
      label: relationship,
      createdBy: cleanString(edge?.createdBy) || 'human',
      createdFrom: cleanString(edge?.createdFrom) || 'manual',
    };
    const id = cleanString(edge?.id);
    if (id) {
      cleanEdge.id = id;
    }
    if (edge?.createdAt) {
      cleanEdge.createdAt = cleanDateString(edge.createdAt);
    }
    if (edge?.updatedAt) {
      cleanEdge.updatedAt = cleanDateString(edge.updatedAt);
    }
    result.push(cleanEdge);
  }

  return result;
}

export function nodeLinkStateUri(groupId: string) {
  return new URL(encodeURIComponent(groupId), STATE_URI_PREFIX).toString();
}

export function emptyNodeLinkState(
  overrides: Partial<NodeLinkSemanticState> = {},
): NodeLinkSemanticState {
  return normalizeNodeLinkState({
    schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
    updatedAt: null,
    selectedGroupId: null,
    descriptiveTags: [],
    tagEdges: [],
    ...overrides,
  });
}

export function normalizeNodeLinkState(
  raw: Partial<NodeLinkSemanticState> = {},
  options: { groupId?: string; updatedAt?: string | null } = {},
): NodeLinkSemanticState {
  return {
    schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
    updatedAt:
      options.updatedAt === null
        ? null
        : cleanStringOrNull(options.updatedAt) ||
          cleanStringOrNull(raw.updatedAt),
    selectedGroupId:
      cleanStringOrNull(options.groupId) ||
      cleanStringOrNull(raw.selectedGroupId),
    descriptiveTags: cleanDescriptiveTags(raw.descriptiveTags),
    tagEdges: cleanTagEdges(raw.tagEdges),
  };
}

function unwrapFencedJson(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

export function parseNodeLinkStateText(text: string) {
  const payload = JSON.parse(unwrapFencedJson(text)) as NodeLinkStatePayloadV1;
  if (
    payload?.kind !== NODE_LINK_STATE_KIND ||
    payload?.schemaVersion !== NODE_LINK_STATE_SCHEMA_VERSION
  ) {
    throw new Error('Annotation is not a supported node-link state payload.');
  }
  return payload;
}

export function stateFromNodeLinkPayload(
  payload: NodeLinkStatePayloadV1,
  options: { groupId?: string } = {},
) {
  if (
    payload?.kind !== NODE_LINK_STATE_KIND ||
    payload?.schemaVersion !== NODE_LINK_STATE_SCHEMA_VERSION
  ) {
    throw new Error('Annotation is not a supported node-link state payload.');
  }

  return normalizeNodeLinkState(
    {
      descriptiveTags: payload.edits?.descriptiveTags || [],
      tagEdges: payload.edits?.tagEdges || [],
    },
    {
      groupId: options.groupId || payload.groupId,
      updatedAt: payload.updatedAt,
    },
  );
}

export function createNodeLinkStatePayload(
  state: NodeLinkSemanticState,
  options: { groupId: string; stateUri: string; updatedAt?: string },
): NodeLinkStatePayloadV1 {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const normalized = normalizeNodeLinkState(state, {
    groupId: options.groupId,
    updatedAt,
  });

  return {
    kind: NODE_LINK_STATE_KIND,
    schemaVersion: NODE_LINK_STATE_SCHEMA_VERSION,
    groupId: options.groupId,
    stateUri: options.stateUri,
    updatedAt,
    // Keep Hypothesis as the portable semantic store. Layout and fetched
    // annotations can be regenerated, so they do not belong in this payload.
    edits: {
      descriptiveTags: normalized.descriptiveTags,
      tagEdges: normalized.tagEdges,
    },
  };
}

export function serializeNodeLinkState(payload: NodeLinkStatePayloadV1) {
  return JSON.stringify(payload, null, 2);
}

export function isNodeLinkStateAnnotation(
  annotation: Pick<Annotation, 'tags' | 'text'>,
) {
  const tags = new Set(annotation.tags || []);
  return (
    tags.has(NODE_LINK_STATE_TAG) ||
    tags.has(NODE_LINK_STATE_VERSION_TAG) ||
    Boolean(annotation.text?.includes(`"kind": "${NODE_LINK_STATE_KIND}"`))
  );
}

export function contentTags(tags: string[] = []) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || SYSTEM_TAGS.has(tag) || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function tagsForNodeLinkState(
  state: NodeLinkSemanticState,
  annotations: Pick<Annotation, 'tags' | 'group'>[] = [],
  groupId?: string | null,
) {
  const tags = new Set<string>();

  for (const annotation of annotations) {
    if (groupId && annotation.group !== groupId) {
      continue;
    }
    for (const tag of contentTags(annotation.tags || [])) {
      tags.add(tag);
    }
  }
  for (const item of state.descriptiveTags) {
    tags.add(item.tag);
  }
  for (const edge of state.tagEdges) {
    tags.add(edge.sourceTag);
    tags.add(edge.targetTag);
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function relationshipsForTag(
  state: NodeLinkSemanticState,
  tag: string,
): TagRelationships {
  const outgoing = state.tagEdges
    .filter(edge => edge.sourceTag === tag)
    .sort((a, b) => a.targetTag.localeCompare(b.targetTag));
  const incoming = state.tagEdges
    .filter(edge => edge.targetTag === tag)
    .sort((a, b) => a.sourceTag.localeCompare(b.sourceTag));

  return { outgoing, incoming };
}

export function tagReferenceForNodeLinkState(
  state: NodeLinkSemanticState,
  annotations: Pick<Annotation, 'tags' | 'group'>[] = [],
  groupId?: string | null,
): NodeLinkTagReferenceEntry[] {
  const normalizedState = normalizeNodeLinkState(state);
  const annotationCounts = new Map<string, number>();

  for (const annotation of annotations) {
    if (groupId && annotation.group !== groupId) {
      continue;
    }
    for (const tag of contentTags(annotation.tags || [])) {
      annotationCounts.set(tag, (annotationCounts.get(tag) || 0) + 1);
    }
  }

  const descriptiveTags = new Set(
    normalizedState.descriptiveTags.map(item => item.tag),
  );

  return tagsForNodeLinkState(normalizedState, annotations, groupId).map(
    tag => {
      const relationships = relationshipsForTag(normalizedState, tag);
      return {
        tag,
        annotationCount: annotationCounts.get(tag) || 0,
        descriptive: descriptiveTags.has(tag),
        outgoingRelationships: relationships.outgoing.map(edge => ({
          relationship: edge.connectionType,
          targetTag: edge.targetTag,
        })),
        incomingRelationships: relationships.incoming.map(edge => ({
          sourceTag: edge.sourceTag,
          relationship: edge.connectionType,
        })),
      };
    },
  );
}

export function tagLegendText(state: Pick<NodeLinkSemanticState, 'tagEdges'>) {
  const outgoing = new Map<string, ManualTagEdge[]>();
  const incoming = new Map<string, ManualTagEdge[]>();
  const tags = new Set<string>();

  for (const edge of normalizeNodeLinkState(state).tagEdges) {
    tags.add(edge.sourceTag);
    tags.add(edge.targetTag);
    outgoing.set(edge.sourceTag, [
      ...(outgoing.get(edge.sourceTag) || []),
      edge,
    ]);
    incoming.set(edge.targetTag, [
      ...(incoming.get(edge.targetTag) || []),
      edge,
    ]);
  }

  if (!tags.size) {
    return 'No manual tag-tag relationships.';
  }

  const lines: string[] = [];
  for (const tag of [...tags].sort((a, b) => a.localeCompare(b))) {
    lines.push(tag);
    const outgoingEdges = (outgoing.get(tag) || []).sort((a, b) =>
      a.targetTag.localeCompare(b.targetTag),
    );
    for (const edge of outgoingEdges) {
      lines.push(`   ${edge.connectionType} ${edge.targetTag}`);
    }

    const incomingEdges = (incoming.get(tag) || []).sort((a, b) =>
      a.sourceTag.localeCompare(b.sourceTag),
    );
    if (incomingEdges.length) {
      lines.push('   --- incoming relationships ---');
      for (const edge of incomingEdges) {
        lines.push(
          `   ${edge.sourceTag} ${edge.connectionType} ${edge.targetTag}`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}
