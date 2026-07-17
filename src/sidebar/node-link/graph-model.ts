import {
  highlightRgbaFromString,
  rgbaStringToHexColorInput,
} from '../../shared/tag-color-from-string';
import type { Annotation } from '../../types/api';
import { contentTags, isNodeLinkStateAnnotation } from './graph-state';
import type { ManualTagEdge, NodeLinkSemanticState } from './graph-state';

export type NodeLinkDocument = {
  uri: string;
  label: string;
  quoteCount: number;
};

export type NodeLinkQuote = {
  id: string;
  annotation: Annotation;
  quote: string;
  tags: string[];
  documentUri: string;
  documentLabel: string;
  sourceUrl: string;
};

export type NodeLinkTagNode = {
  id: string;
  tag: string;
  quoteCount: number;
  documentCount: number;
  documentUris: string[];
  descriptive: boolean;
};

export type NodeLinkGraph = {
  tags: NodeLinkTagNode[];
  quotes: NodeLinkQuote[];
  documents: NodeLinkDocument[];
  manualEdges: ManualTagEdge[];
  annotationCount: number;
};

export type TagLayoutNode = NodeLinkTagNode & {
  x: number;
  y: number;
  color: string;
};

export type TagGraphLayout = {
  width: number;
  height: number;
  nodes: TagLayoutNode[];
};

const TAG_LAYOUT_NODE_WIDTH = 188;
const TAG_LAYOUT_NODE_HEIGHT = 62;
const TAG_LAYOUT_LAYER_GAP = 285;
const TAG_LAYOUT_ROW_GAP = 128;

function compactText(text: string, maxLength = 80) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

export function documentLabelFromUrl(uri: string) {
  try {
    const url = new URL(uri);
    const file = url.pathname.split('/').filter(Boolean).pop();
    if (file) {
      return decodeURIComponent(file).replace(/[-_]+/g, ' ');
    }
    return url.hostname;
  } catch {
    return uri || 'Untitled document';
  }
}

export function annotationDocumentLabel(annotation: Annotation) {
  const rawTitle = annotation.document?.title;
  const title = Array.isArray(rawTitle) ? rawTitle[0] : rawTitle;
  if (title && title !== annotation.uri) {
    return compactText(String(title), 54);
  }
  return compactText(documentLabelFromUrl(annotation.uri), 54);
}

export function annotationQuote(annotation: Annotation) {
  for (const target of annotation.target || []) {
    for (const selector of target.selector || []) {
      if (selector.type === 'TextQuoteSelector') {
        return compactText(selector.exact, 220);
      }
    }
    if (target.description) {
      return compactText(target.description, 220);
    }
  }
  return '';
}

function sourceUrl(annotation: Annotation) {
  return (
    annotation.links?.incontext || annotation.links?.html || annotation.uri
  );
}

function isEvidenceAnnotation(annotation: Annotation) {
  if (
    annotation.hidden ||
    annotation.references?.length ||
    isNodeLinkStateAnnotation(annotation)
  ) {
    return false;
  }
  return contentTags(annotation.tags || []).length > 0;
}

export function buildNodeLinkGraph(
  annotations: Annotation[],
  semanticState: NodeLinkSemanticState,
): NodeLinkGraph {
  const tagMap = new Map<
    string,
    {
      quoteCount: number;
      documentUris: Set<string>;
      descriptive: boolean;
    }
  >();
  const documentMap = new Map<string, NodeLinkDocument>();
  const quotes: NodeLinkQuote[] = [];

  for (const annotation of annotations.filter(isEvidenceAnnotation)) {
    const tags = contentTags(annotation.tags || []);
    const quote = annotationQuote(annotation);
    const documentUri = annotation.uri || '';
    const documentLabel = annotationDocumentLabel(annotation);

    if (quote && documentUri) {
      const documentItem = documentMap.get(documentUri) || {
        uri: documentUri,
        label: documentLabel,
        quoteCount: 0,
      };
      documentItem.quoteCount += 1;
      documentMap.set(documentUri, documentItem);
    }

    for (const tag of tags) {
      const item = tagMap.get(tag) || {
        quoteCount: 0,
        documentUris: new Set<string>(),
        descriptive: false,
      };
      if (quote) {
        item.quoteCount += 1;
      }
      if (documentUri) {
        item.documentUris.add(documentUri);
      }
      tagMap.set(tag, item);
    }

    if (quote) {
      quotes.push({
        id: `quote:${annotation.id || quotes.length}`,
        annotation,
        quote,
        tags,
        documentUri,
        documentLabel,
        sourceUrl: sourceUrl(annotation),
      });
    }
  }

  for (const item of semanticState.descriptiveTags) {
    if (!item.tag || tagMap.has(item.tag)) {
      continue;
    }
    tagMap.set(item.tag, {
      quoteCount: 0,
      documentUris: new Set(),
      descriptive: true,
    });
  }

  const tags = [...tagMap.entries()]
    .map(([tag, value]) => ({
      id: `tag:${tag}`,
      tag,
      quoteCount: value.quoteCount,
      documentCount: value.documentUris.size,
      documentUris: [...value.documentUris].sort((a, b) => a.localeCompare(b)),
      descriptive: value.descriptive,
    }))
    .sort(
      (a, b) =>
        b.quoteCount - a.quoteCount ||
        b.documentCount - a.documentCount ||
        a.tag.localeCompare(b.tag),
    );

  const visibleTags = new Set(tags.map(tag => tag.tag));
  const manualEdges = semanticState.tagEdges
    .filter(
      edge =>
        visibleTags.has(edge.sourceTag) && visibleTags.has(edge.targetTag),
    )
    .sort(
      (a, b) =>
        a.sourceTag.localeCompare(b.sourceTag) ||
        a.targetTag.localeCompare(b.targetTag),
    );

  return {
    tags,
    quotes: quotes.sort(
      (a, b) =>
        a.documentLabel.localeCompare(b.documentLabel) ||
        a.quote.localeCompare(b.quote),
    ),
    documents: [...documentMap.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    manualEdges,
    annotationCount: annotations.filter(isEvidenceAnnotation).length,
  };
}

export function colorForTag(
  tag: string,
  tagColors: Record<string, string> = {},
) {
  const normalizedTag = tag.trim();
  const color =
    tagColors[normalizedTag] ?? highlightRgbaFromString(normalizedTag);
  const hexMatch = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1].toLowerCase();
    return hex.length === 3
      ? `#${[...hex].map(channel => channel.repeat(2)).join('')}`
      : `#${hex}`;
  }
  return rgbaStringToHexColorInput(color);
}

function nearbyShade(hex: string, variantIndex: number) {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const lighten = variantIndex % 2 === 0;
  const amount = Math.min(0.08 * (Math.floor(variantIndex / 2) + 1), 0.8);
  const target = lighten ? 255 : 0;
  const adjusted = channels.map(channel =>
    Math.round(channel + (target - channel) * amount),
  );
  return `#${adjusted
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Resolve tag colors so tags with the same display color get nearby shades.
 *
 * The result is stable regardless of input order and reserves all configured
 * colors before choosing variants, so a generated shade does not collide with
 * another tag's configured color.
 */
export function distinctTagColors(
  tags: readonly string[],
  tagColors: Record<string, string> = {},
) {
  const normalizedTags = [
    ...new Set(
      [...Object.keys(tagColors), ...tags]
        .map(tag => tag.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const baseColors = new Map(
    normalizedTags.map(tag => [tag, colorForTag(tag, tagColors)]),
  );
  const colorCounts = new Map<string, number>();
  for (const color of baseColors.values()) {
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
  }

  const usedColors = new Set(baseColors.values());
  const resolvedColors: Record<string, string> = {};
  for (const tag of normalizedTags) {
    const baseColor = baseColors.get(tag)!;
    if (colorCounts.get(baseColor) === 1) {
      resolvedColors[tag] = baseColor;
      continue;
    }

    for (let variantIndex = 0; variantIndex < 40; variantIndex++) {
      const candidate = nearbyShade(baseColor, variantIndex);
      if (!usedColors.has(candidate)) {
        resolvedColors[tag] = candidate;
        usedColors.add(candidate);
        break;
      }
    }
    resolvedColors[tag] ??= baseColor;
  }
  return resolvedColors;
}

/** Return the selected tag, its immediate neighbors and their connecting edges. */
export function spotlightNodeLinkGraph(
  graph: NodeLinkGraph,
  spotlightTag: string,
): NodeLinkGraph {
  if (!spotlightTag || !graph.tags.some(tag => tag.tag === spotlightTag)) {
    return graph;
  }

  const manualEdges = graph.manualEdges.filter(
    edge => edge.sourceTag === spotlightTag || edge.targetTag === spotlightTag,
  );
  const visibleTags = new Set([spotlightTag]);
  for (const edge of manualEdges) {
    visibleTags.add(edge.sourceTag);
    visibleTags.add(edge.targetTag);
  }
  const tags = graph.tags.filter(tag => visibleTags.has(tag.tag));
  const documentUris = new Set(tags.flatMap(tag => tag.documentUris));

  return {
    ...graph,
    tags,
    manualEdges,
    quotes: graph.quotes.filter(quote =>
      quote.tags.some(tag => visibleTags.has(tag)),
    ),
    documents: graph.documents.filter(document =>
      documentUris.has(document.uri),
    ),
  };
}

/** Arrange a one-hop neighborhood with the selected tag fixed at the center. */
export function buildSpotlightGraphLayout(
  graph: NodeLinkGraph,
  spotlightTag: string,
  tagColors: Record<string, string> = {},
): TagGraphLayout {
  const focusNode = graph.tags.find(tag => tag.tag === spotlightTag);
  if (!focusNode) {
    return buildTagGraphLayout(graph, tagColors);
  }

  const outgoingTags = new Set(
    graph.manualEdges
      .filter(
        edge =>
          edge.sourceTag === spotlightTag && edge.targetTag !== spotlightTag,
      )
      .map(edge => edge.targetTag),
  );
  const incomingTags = new Set(
    graph.manualEdges
      .filter(
        edge =>
          edge.targetTag === spotlightTag &&
          edge.sourceTag !== spotlightTag &&
          !outgoingTags.has(edge.sourceTag),
      )
      .map(edge => edge.sourceTag),
  );
  const remainingTags = graph.tags
    .map(tag => tag.tag)
    .filter(
      tag =>
        tag !== spotlightTag &&
        !outgoingTags.has(tag) &&
        !incomingTags.has(tag),
    );
  for (const tag of remainingTags) {
    outgoingTags.add(tag);
  }

  const leftTags = [...incomingTags].sort((a, b) => a.localeCompare(b));
  const rightTags = [...outgoingTags].sort((a, b) => a.localeCompare(b));
  const maxRows = Math.max(leftTags.length, rightTags.length, 1);
  const width = 1040;
  const height = Math.max(620, (maxRows - 1) * TAG_LAYOUT_ROW_GAP + 200);
  const centerX = width / 2;
  const centerY = height / 2;
  const tagByName = new Map(graph.tags.map(tag => [tag.tag, tag]));
  const nodes: TagLayoutNode[] = [
    {
      ...focusNode,
      x: centerX,
      y: centerY,
      color: colorForTag(focusNode.tag, tagColors),
    },
  ];

  const addSide = (tags: string[], x: number) => {
    const firstY = centerY - ((tags.length - 1) * TAG_LAYOUT_ROW_GAP) / 2;
    tags.forEach((tag, index) => {
      const tagNode = tagByName.get(tag);
      if (!tagNode) {
        return;
      }
      nodes.push({
        ...tagNode,
        x,
        y: Math.round(firstY + index * TAG_LAYOUT_ROW_GAP),
        color: colorForTag(tag, tagColors),
      });
    });
  };

  addSide(leftTags, 190);
  addSide(rightTags, width - 190);

  return { width, height, nodes };
}

/**
 * Arrange tag nodes from left to right using manual tag-tag edges as the
 * directed structure, while keeping unlinked tags visible in a separate grid.
 */
export function buildTagGraphLayout(
  graph: NodeLinkGraph,
  tagColors: Record<string, string> = {},
): TagGraphLayout {
  const tagByName = new Map(graph.tags.map(tag => [tag.tag, tag]));
  const validEdges = graph.manualEdges.filter(
    edge => tagByName.has(edge.sourceTag) && tagByName.has(edge.targetTag),
  );
  const linkedTags = new Set<string>();
  const neighbors = new Map<string, Set<string>>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const tag of graph.tags) {
    neighbors.set(tag.tag, new Set());
    outgoing.set(tag.tag, []);
    incoming.set(tag.tag, []);
  }
  for (const edge of validEdges) {
    linkedTags.add(edge.sourceTag);
    linkedTags.add(edge.targetTag);
    neighbors.get(edge.sourceTag)?.add(edge.targetTag);
    neighbors.get(edge.targetTag)?.add(edge.sourceTag);
    outgoing.get(edge.sourceTag)?.push(edge.targetTag);
    incoming.get(edge.targetTag)?.push(edge.sourceTag);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const tag of [...linkedTags].sort((a, b) => a.localeCompare(b))) {
    if (visited.has(tag)) {
      continue;
    }
    const queue = [tag];
    const component: string[] = [];
    visited.add(tag);
    while (queue.length) {
      const current = queue.shift() as string;
      component.push(current);
      for (const next of neighbors.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }

  const degree = (tag: string) =>
    (outgoing.get(tag)?.length || 0) + (incoming.get(tag)?.length || 0);
  components.sort(
    (a, b) =>
      Math.max(...b.map(degree)) - Math.max(...a.map(degree)) ||
      b.length - a.length ||
      a[0].localeCompare(b[0]),
  );

  const positionedNodes: TagLayoutNode[] = [];
  let canvasWidth = 920;
  let yOffset = 72;

  for (const component of components) {
    const componentSet = new Set(component);
    const roots = component
      .filter(
        tag => !(incoming.get(tag) || []).some(src => componentSet.has(src)),
      )
      .sort(
        (a, b) =>
          (outgoing.get(b)?.length || 0) - (outgoing.get(a)?.length || 0) ||
          a.localeCompare(b),
      );
    if (!roots.length) {
      roots.push(
        [...component].sort(
          (a, b) => degree(b) - degree(a) || a.localeCompare(b),
        )[0],
      );
    }

    const layerByTag = new Map<string, number>();
    const queue = roots.map(tag => ({ tag, layer: 0 }));
    for (const root of roots) {
      layerByTag.set(root, 0);
    }

    while (queue.length) {
      const { tag, layer } = queue.shift() as { tag: string; layer: number };
      for (const target of outgoing.get(tag) || []) {
        if (!componentSet.has(target) || layerByTag.has(target)) {
          continue;
        }
        layerByTag.set(target, layer + 1);
        queue.push({ tag: target, layer: layer + 1 });
      }
    }

    const unassigned = component.filter(tag => !layerByTag.has(tag));
    for (const tag of unassigned) {
      const connectedLayers = [...(neighbors.get(tag) || [])]
        .filter(neighbor => layerByTag.has(neighbor))
        .map(neighbor => layerByTag.get(neighbor) as number);
      layerByTag.set(
        tag,
        connectedLayers.length
          ? Math.max(0, Math.min(...connectedLayers) + 1)
          : 0,
      );
    }

    const layerCount = Math.max(...[...layerByTag.values()]) + 1;
    const layers: string[][] = Array.from({ length: layerCount }, () => []);
    for (const tag of component) {
      layers[layerByTag.get(tag) || 0].push(tag);
    }

    const sortLayer = (layer: string[], reference: Map<string, number>) =>
      layer.sort((a, b) => {
        const aNeighbors = [...(neighbors.get(a) || [])].filter(item =>
          reference.has(item),
        );
        const bNeighbors = [...(neighbors.get(b) || [])].filter(item =>
          reference.has(item),
        );
        const aAverage = aNeighbors.length
          ? aNeighbors.reduce(
              (sum, item) => sum + (reference.get(item) || 0),
              0,
            ) / aNeighbors.length
          : Number.MAX_SAFE_INTEGER;
        const bAverage = bNeighbors.length
          ? bNeighbors.reduce(
              (sum, item) => sum + (reference.get(item) || 0),
              0,
            ) / bNeighbors.length
          : Number.MAX_SAFE_INTEGER;
        return (
          aAverage - bAverage || degree(b) - degree(a) || a.localeCompare(b)
        );
      });

    for (let sweep = 0; sweep < 3; sweep += 1) {
      for (let index = 1; index < layers.length; index += 1) {
        sortLayer(
          layers[index],
          new Map(layers[index - 1].map((tag, order) => [tag, order])),
        );
      }
      for (let index = layers.length - 2; index >= 0; index -= 1) {
        sortLayer(
          layers[index],
          new Map(layers[index + 1].map((tag, order) => [tag, order])),
        );
      }
    }

    const maxRows = Math.max(...layers.map(layer => layer.length), 1);
    const componentHeight = Math.max(
      180,
      maxRows * TAG_LAYOUT_ROW_GAP + TAG_LAYOUT_NODE_HEIGHT + 34,
    );
    layers.forEach((layer, layerIndex) => {
      const layerTop =
        yOffset + (maxRows - layer.length) * (TAG_LAYOUT_ROW_GAP / 2);
      layer.forEach((tag, rowIndex) => {
        const tagNode = tagByName.get(tag);
        if (!tagNode) {
          return;
        }
        positionedNodes.push({
          ...tagNode,
          x: Math.round(130 + layerIndex * TAG_LAYOUT_LAYER_GAP),
          y: Math.round(layerTop + rowIndex * TAG_LAYOUT_ROW_GAP),
          color: colorForTag(tag, tagColors),
        });
      });
    });
    canvasWidth = Math.max(
      canvasWidth,
      260 + (layerCount - 1) * TAG_LAYOUT_LAYER_GAP + TAG_LAYOUT_NODE_WIDTH,
    );
    yOffset += componentHeight + 36;
  }

  const unlinkedTags = graph.tags
    .filter(tag => !linkedTags.has(tag.tag))
    .sort((a, b) => b.quoteCount - a.quoteCount || a.tag.localeCompare(b.tag));
  if (unlinkedTags.length) {
    const columns = Math.max(
      2,
      Math.min(4, Math.ceil(Math.sqrt(unlinkedTags.length))),
    );
    const gridTop = Math.max(yOffset, 108);
    unlinkedTags.forEach((tag, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      positionedNodes.push({
        ...tag,
        x: Math.round(130 + column * 245),
        y: Math.round(gridTop + row * 118),
        color: colorForTag(tag.tag, tagColors),
      });
    });
    canvasWidth = Math.max(
      canvasWidth,
      260 + (columns - 1) * 245 + TAG_LAYOUT_NODE_WIDTH,
    );
    yOffset = gridTop + Math.ceil(unlinkedTags.length / columns) * 118 + 72;
  }

  return {
    width: Math.max(920, Math.round(canvasWidth)),
    height: Math.max(620, Math.round(yOffset)),
    nodes: positionedNodes,
  };
}
