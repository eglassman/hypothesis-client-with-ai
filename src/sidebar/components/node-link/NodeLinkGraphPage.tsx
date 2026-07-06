import { Button, GraphIcon, RefreshIcon } from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { Annotation, Group } from '../../../types/api';
import {
  buildNodeLinkGraph,
  buildTagGraphLayout,
  colorForTag,
} from '../../node-link/graph-model';
import type { NodeLinkGraph, TagLayoutNode } from '../../node-link/graph-model';
import { emptyNodeLinkState, tagLegendText } from '../../node-link/graph-state';
import type {
  DescriptiveTag,
  ManualTagEdge,
  NodeLinkSemanticState,
} from '../../node-link/graph-state';
import { withServices } from '../../service-context';
import type { AuthService } from '../../services/auth';
import type { NodeLinkStateService } from '../../services/node-link-state';
import type { SessionService } from '../../services/session';
import type { ToastMessengerService } from '../../services/toast-messenger';
import { useSidebarStore } from '../../store';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type AddMode = 'edge' | 'tag';
type PendingDelete =
  | { type: 'edge'; id: string }
  | { type: 'tag'; id: string }
  | null;

export type NodeLinkGraphPageProps = {
  auth: AuthService;
  nodeLinkState: NodeLinkStateService;
  session: SessionService;
  toastMessenger: ToastMessengerService;
};

const NODE_WIDTH = 188;
const NODE_HEIGHT = 62;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.12;

type GraphPoint = {
  x: number;
  y: number;
};

type DragState = {
  tag: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

function edgeKey(edge: Pick<ManualTagEdge, 'sourceTag' | 'targetTag'>) {
  return `${edge.sourceTag}\n${edge.targetTag}`;
}

function edgeId(edge: ManualTagEdge) {
  return edge.id || edgeKey(edge);
}

function newManualEdgeId() {
  return `manual-edge:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function newDescriptiveTagId() {
  return `descriptive-tag:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function tagOptions(graph: NodeLinkGraph) {
  return graph.tags.map(tag => tag.tag).sort((a, b) => a.localeCompare(b));
}

function routeGroupParam(params: Record<string, string | undefined>) {
  return params.group || params.groupId || '';
}

function groupLabel(group: Group) {
  return group.organization?.name
    ? `${group.name} (${group.organization.name})`
    : group.name;
}

function findGroupByIdentifier(groupId: string, groups: Group[]) {
  return groups.find(
    group => group.id === groupId || group.groupid === groupId,
  );
}

function canonicalGroupId(groupId: string, groups: Group[]) {
  return findGroupByIdentifier(groupId, groups)?.id || groupId;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nodeBoundaryPoint(from: TagLayoutNode, to: TagLayoutNode): GraphPoint {
  const dx = to.x - from.x || 0.01;
  const dy = to.y - from.y || 0.01;
  const halfWidth = NODE_WIDTH / 2;
  const halfHeight = NODE_HEIGHT / 2;

  if (Math.abs(dx) / halfWidth > Math.abs(dy) / halfHeight) {
    const scale = halfWidth / Math.abs(dx);
    return {
      x: from.x + Math.sign(dx) * halfWidth,
      y: from.y + dy * scale,
    };
  }

  const scale = halfHeight / Math.abs(dy);
  return {
    x: from.x + dx * scale,
    y: from.y + Math.sign(dy) * halfHeight,
  };
}

function edgePath(source: TagLayoutNode, target: TagLayoutNode, index = 0) {
  const start = nodeBoundaryPoint(source, target);
  const end = nodeBoundaryPoint(target, source);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const direction = index % 2 === 0 ? 1 : -1;
  const bow = clamp(distance * 0.15 + (index % 4) * 8, 26, 82);
  const c1x = start.x + dx * 0.38 + normalX * direction * bow;
  const c1y = start.y + dy * 0.38 + normalY * direction * bow;
  const c2x = end.x - dx * 0.38 + normalX * direction * bow;
  const c2y = end.y - dy * 0.38 + normalY * direction * bow;

  return `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
}

function edgeStroke(edge: ManualTagEdge) {
  const hue =
    hashString(`${edge.sourceTag}:${edge.connectionType}:${edge.targetTag}`) %
    360;
  return `hsl(${hue} 58% 34%)`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function splitTagLines(tag: string) {
  const words = tag.split(/\s+/).filter(Boolean);
  if (words.length <= 1 && tag.length <= 20) {
    return [tag];
  }

  const lines: string[] = [];
  let current = '';
  for (const word of words.length ? words : [tag]) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 20 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === 2) {
      break;
    }
  }
  if (current && lines.length < 2) {
    lines.push(current);
  }

  return lines.map((line, index) =>
    index === 1 && line.length > 22 ? `${line.slice(0, 19)}...` : line,
  );
}

function TagBadge({
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

function RelationshipSentence({
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

function EditorActionButton({
  children,
  disabled = false,
  title,
  variant = 'default',
  onClick,
}: {
  children: JSX.Element | string;
  disabled?: boolean;
  title?: string;
  variant?: 'default' | 'danger' | 'secondary';
  onClick: () => void;
}) {
  return (
    <button
      className={classnames(
        'rounded border px-2.5 py-1 text-xs font-bold transition',
        'hover:-translate-y-px hover:shadow-sm active:translate-y-0 active:shadow-none',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none',
        {
          'border-grey-4 bg-white text-brand hover:bg-grey-1 active:bg-grey-2':
            variant === 'default',
          'border-red-3 bg-white text-red-6 hover:bg-red-1 active:bg-red-2':
            variant === 'danger',
          'border-grey-4 bg-grey-1 text-grey-7 hover:bg-white active:bg-grey-2':
            variant === 'secondary',
        },
      )}
      disabled={disabled}
      title={title}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EditModal({
  children,
  title,
  onClose,
}: {
  children: JSX.Element;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-6 py-8"
      role="presentation"
    >
      <div
        aria-modal="true"
        className="w-full max-w-3xl rounded-lg bg-white p-5 shadow-2xl"
        role="dialog"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-color-text">{title}</h3>
          <EditorActionButton variant="secondary" onClick={onClose}>
            Close
          </EditorActionButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function TagNode({
  node,
  badgeCount,
  selected,
  emphasized,
  muted,
  onSelect,
  onPointerDown,
  dragging,
}: {
  node: TagLayoutNode;
  badgeCount: number;
  selected: boolean;
  emphasized: boolean;
  muted: boolean;
  onSelect: () => void;
  onPointerDown: (
    event: JSX.TargetedPointerEvent<SVGGElement>,
    node: TagLayoutNode,
  ) => void;
  dragging: boolean;
}) {
  const lines = splitTagLines(node.tag);

  return (
    <g
      className={classnames('cursor-grab transition-opacity', {
        'opacity-35': muted,
        'cursor-grabbing': dragging,
      })}
      transform={`translate(${node.x - NODE_WIDTH / 2}, ${
        node.y - NODE_HEIGHT / 2
      })`}
      onPointerDown={event => onPointerDown(event, node)}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx="7"
        fill={node.descriptive ? '#475569' : node.color}
        stroke={
          selected
            ? '#111827'
            : emphasized
              ? '#f8fafc'
              : 'rgba(255,255,255,.72)'
        }
        strokeWidth={selected || emphasized ? 3 : 1.5}
        strokeDasharray={node.descriptive ? '5 4' : undefined}
        filter={selected || emphasized ? 'url(#nodeShadow)' : undefined}
      />
      <text
        x="14"
        y="19"
        fill="rgba(255,255,255,.78)"
        fontSize="10"
        fontWeight="800"
      >
        TAG
      </text>
      <text
        x={NODE_WIDTH - 18}
        y="20"
        fill="#fff"
        fontSize="12"
        fontWeight="800"
        textAnchor="middle"
      >
        {badgeCount}
      </text>
      {lines.map((line, index) => (
        <text
          key={line}
          x="14"
          y={lines.length === 1 ? 42 : 38 + index * 15}
          fill="#fff"
          fontSize="14"
          fontWeight="760"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function GraphCanvas({
  graph,
  selectedTag,
  selectedEdgeId,
  tagColors,
  onSelectTag,
  onSelectEdge,
  onClearSelection,
}: {
  graph: NodeLinkGraph;
  selectedTag: string;
  selectedEdgeId: string;
  tagColors: Record<string, string>;
  onSelectTag: (tag: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onClearSelection: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draggingTag, setDraggingTag] = useState('');
  const [hoveredEdgeId, setHoveredEdgeId] = useState('');
  const [zoom, setZoom] = useState(0.92);
  const [userZoomed, setUserZoomed] = useState(false);
  const [nodePositions, setNodePositions] = useState<
    Record<string, GraphPoint>
  >({});
  const layout = useMemo(
    () => buildTagGraphLayout(graph, tagColors),
    [graph, tagColors],
  );
  const layoutNodes = useMemo(
    () =>
      layout.nodes.map(node => {
        const moved = nodePositions[node.tag];
        return moved ? { ...node, x: moved.x, y: moved.y } : node;
      }),
    [layout.nodes, nodePositions],
  );
  const nodeByTag = new Map(layoutNodes.map(node => [node.tag, node]));
  const relationshipCountByTag = useMemo(() => {
    const counts = new Map(graph.tags.map(node => [node.tag, 0]));
    for (const edge of graph.manualEdges) {
      counts.set(edge.sourceTag, (counts.get(edge.sourceTag) || 0) + 1);
      counts.set(edge.targetTag, (counts.get(edge.targetTag) || 0) + 1);
    }
    return counts;
  }, [graph.manualEdges, graph.tags]);
  const selectedEdge = selectedEdgeId
    ? graph.manualEdges.find(edge => edgeId(edge) === selectedEdgeId)
    : undefined;
  const relatedTags = new Set<string>();
  if (selectedEdge) {
    relatedTags.add(selectedEdge.sourceTag);
    relatedTags.add(selectedEdge.targetTag);
  } else if (selectedTag) {
    relatedTags.add(selectedTag);
    for (const edge of graph.manualEdges) {
      if (edge.sourceTag === selectedTag) {
        relatedTags.add(edge.targetTag);
      } else if (edge.targetTag === selectedTag) {
        relatedTags.add(edge.sourceTag);
      }
    }
  }

  useEffect(() => {
    setNodePositions(current => {
      const validTags = new Set(layout.nodes.map(node => node.tag));
      const next = Object.fromEntries(
        Object.entries(current).filter(([tag]) => validTags.has(tag)),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [layout.nodes]);

  useEffect(() => {
    if (userZoomed || !scrollRef.current) {
      return;
    }
    const availableWidth = Math.max(320, scrollRef.current.clientWidth - 36);
    setZoom(clamp(Math.min(1, availableWidth / layout.width), MIN_ZOOM, 1));
  }, [layout.width, userZoomed]);

  const graphPoint = (
    event: Pick<PointerEvent | WheelEvent, 'clientX' | 'clientY'>,
  ): GraphPoint => {
    // Convert screen coordinates through the rendered SVG bounds so dragging
    // stays aligned at every zoom level and display scale.
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: clamp(
        ((event.clientX - rect.left) / rect.width) * layout.width,
        NODE_WIDTH / 2 + 12,
        layout.width - NODE_WIDTH / 2 - 12,
      ),
      y: clamp(
        ((event.clientY - rect.top) / rect.height) * layout.height,
        NODE_HEIGHT / 2 + 12,
        layout.height - NODE_HEIGHT / 2 - 12,
      ),
    };
  };

  const setZoomLevel = (nextZoom: number) => {
    setUserZoomed(true);
    setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM));
  };

  const fitZoom = () => {
    const availableWidth = Math.max(
      320,
      (scrollRef.current?.clientWidth || 920) - 36,
    );
    setUserZoomed(false);
    setZoom(clamp(Math.min(1, availableWidth / layout.width), MIN_ZOOM, 1));
  };

  const startDrag = (
    event: JSX.TargetedPointerEvent<SVGGElement>,
    node: TagLayoutNode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const point = graphPoint(event);
    dragRef.current = {
      tag: node.tag,
      pointerId: event.pointerId,
      offsetX: point.x - node.x,
      offsetY: point.y - node.y,
      startX: point.x,
      startY: point.y,
      moved: false,
    };
    setDraggingTag(node.tag);
    (
      event.currentTarget as Element & {
        setPointerCapture?: (pointerId: number) => void;
      }
    ).setPointerCapture?.(event.pointerId);
  };

  const updateDrag = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    event.preventDefault();
    const point = graphPoint(event);
    const nextX = point.x - drag.offsetX;
    const nextY = point.y - drag.offsetY;
    const moved =
      drag.moved ||
      Math.abs(point.x - drag.startX) > 4 ||
      Math.abs(point.y - drag.startY) > 4;
    dragRef.current = { ...drag, moved };
    setNodePositions(current => ({
      ...current,
      [drag.tag]: {
        x: clamp(
          nextX,
          NODE_WIDTH / 2 + 12,
          layout.width - NODE_WIDTH / 2 - 12,
        ),
        y: clamp(
          nextY,
          NODE_HEIGHT / 2 + 12,
          layout.height - NODE_HEIGHT / 2 - 12,
        ),
      },
    }));
  };

  const stopDrag = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    event.preventDefault();
    dragRef.current = null;
    setDraggingTag('');
    if (!drag.moved) {
      onSelectTag(drag.tag === selectedTag ? '' : drag.tag);
    }
  };

  return (
    <div className="relative min-h-0 overflow-hidden rounded border bg-[#f7faf9]">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded border bg-white/95 p-1 shadow-sm">
        <button
          className="h-8 min-w-8 rounded px-2 text-sm font-bold hover:bg-grey-2"
          type="button"
          title="Zoom out"
          onClick={() => setZoomLevel(zoom - ZOOM_STEP)}
        >
          -
        </button>
        <button
          className="h-8 rounded px-2 text-xs font-bold hover:bg-grey-2"
          type="button"
          title="Fit graph to width"
          onClick={fitZoom}
        >
          Fit
        </button>
        <button
          className="h-8 min-w-8 rounded px-2 text-sm font-bold hover:bg-grey-2"
          type="button"
          title="Zoom in"
          onClick={() => setZoomLevel(zoom + ZOOM_STEP)}
        >
          +
        </button>
        <span className="min-w-[44px] text-center text-xs font-bold text-grey-6">
          {Math.round(zoom * 100)}%
        </span>
      </div>
      <div
        className="h-full min-h-0 overflow-auto"
        ref={scrollRef}
        onWheel={event => {
          if (!event.ctrlKey && !event.metaKey) {
            return;
          }
          event.preventDefault();
          setZoomLevel(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
        }}
      >
        <svg
          className="block min-h-full min-w-full"
          ref={svgRef}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{
            width: `${Math.round(layout.width * zoom)}px`,
            height: `${Math.round(layout.height * zoom)}px`,
          }}
          role="img"
          aria-label="Tag relationship graph"
          onPointerMove={updateDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <defs>
            <filter
              id="nodeShadow"
              x="-14%"
              y="-22%"
              width="128%"
              height="150%"
            >
              <feDropShadow
                dx="0"
                dy="7"
                stdDeviation="5"
                floodColor="#0f172a"
                floodOpacity="0.22"
              />
            </filter>
          </defs>
          <rect
            width={layout.width}
            height={layout.height}
            fill="#f7faf9"
            onClick={onClearSelection}
          />
          {graph.manualEdges.map((edge, index) => {
            const source = nodeByTag.get(edge.sourceTag);
            const target = nodeByTag.get(edge.targetTag);
            if (!source || !target) {
              return null;
            }
            const id = edgeId(edge);
            const selected = id === selectedEdgeId;
            const hovered = id === hoveredEdgeId;
            const active =
              selected ||
              (!selectedEdgeId &&
                (!selectedTag ||
                  edge.sourceTag === selectedTag ||
                  edge.targetTag === selectedTag));
            const path = edgePath(source, target, index);
            return (
              <g
                key={id}
                onMouseEnter={() => setHoveredEdgeId(id)}
                onMouseLeave={() => setHoveredEdgeId('')}
              >
                <path
                  d={path}
                  fill="none"
                  stroke={edgeStroke(edge)}
                  strokeWidth={
                    selected ? 3.8 : hovered ? 3.4 : active ? 2.8 : 1.8
                  }
                  strokeLinecap="round"
                  opacity={
                    selected ? 0.98 : hovered ? 0.92 : active ? 0.78 : 0.22
                  }
                  pointerEvents="none"
                />
                <path
                  className="cursor-pointer"
                  d={path}
                  fill="none"
                  stroke="rgba(15,23,42,0.001)"
                  strokeWidth="64"
                  strokeLinecap="round"
                  focusable="false"
                  pointerEvents="stroke"
                  onPointerDown={event => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={event => {
                    event.stopPropagation();
                    onSelectEdge(id);
                  }}
                />
              </g>
            );
          })}
          {layoutNodes.map(node => {
            const endpoint =
              selectedEdge &&
              (node.tag === selectedEdge.sourceTag ||
                node.tag === selectedEdge.targetTag);
            return (
              <TagNode
                key={node.id}
                node={node}
                badgeCount={
                  node.descriptive
                    ? relationshipCountByTag.get(node.tag) || 0
                    : node.quoteCount
                }
                selected={node.tag === selectedTag}
                emphasized={Boolean(endpoint)}
                muted={
                  (Boolean(selectedTag) || Boolean(selectedEdge)) &&
                  !relatedTags.has(node.tag)
                }
                onSelect={() =>
                  onSelectTag(node.tag === selectedTag ? '' : node.tag)
                }
                onPointerDown={startDrag}
                dragging={draggingTag === node.tag}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function EvidencePanel({
  graph,
  selectedTag,
  selectedEdge,
  tagColors,
  onSelectEdge,
}: {
  graph: NodeLinkGraph;
  selectedTag: string;
  selectedEdge: ManualTagEdge | null;
  tagColors: Record<string, string>;
  onSelectEdge: (edgeId: string) => void;
}) {
  if (selectedEdge) {
    return (
      <div className="space-y-4">
        <section className="rounded border bg-white p-4">
          <h3 className="mb-3 text-sm font-bold uppercase text-grey-6">
            Selected relationship
          </h3>
          <div className="text-sm leading-7">
            <RelationshipSentence edge={selectedEdge} tagColors={tagColors} />
          </div>
        </section>
        <p className="text-sm leading-6 text-grey-6">
          The connected source and destination tags are highlighted in the
          canvas.
        </p>
      </div>
    );
  }

  const quotes = selectedTag
    ? graph.quotes.filter(quote => quote.tags.includes(selectedTag))
    : [];
  const node = selectedTag
    ? graph.tags.find(tag => tag.tag === selectedTag)
    : null;
  const outgoing = selectedTag
    ? graph.manualEdges.filter(edge => edge.sourceTag === selectedTag)
    : [];
  const incoming = selectedTag
    ? graph.manualEdges.filter(edge => edge.targetTag === selectedTag)
    : [];

  if (!selectedTag) {
    return (
      <p className="text-sm leading-6 text-grey-6">
        Select a tag node to inspect its manual relationships and quote
        evidence.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded border bg-white p-4">
        <h3 className="mb-3 text-sm font-bold uppercase text-grey-6">
          Selected node
        </h3>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-bold uppercase text-grey-6">Tag</div>
            <div className="mt-1 text-lg font-bold text-color-text">
              {selectedTag}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded bg-grey-1 px-2 py-2">
              <div className="text-base font-bold text-color-text">
                {outgoing.length + incoming.length}
              </div>
              <div className="text-grey-6">relationships</div>
            </div>
            <div className="rounded bg-grey-1 px-2 py-2">
              <div className="text-base font-bold text-color-text">
                {node?.quoteCount || 0}
              </div>
              <div className="text-grey-6">quotes</div>
            </div>
            <div className="rounded bg-grey-1 px-2 py-2">
              <div className="text-base font-bold text-color-text">
                {node?.documentCount || 0}
              </div>
              <div className="text-grey-6">documents</div>
            </div>
          </div>
          {node?.descriptive && (
            <p className="rounded border border-grey-3 bg-grey-1 px-3 py-2 text-sm text-grey-6">
              This is a descriptive tag. It only connects to other tag nodes.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold uppercase text-grey-6">
            Outgoing relationships
          </h4>
          <span className="rounded-full bg-grey-2 px-2 py-0.5 text-xs font-bold text-grey-6">
            {outgoing.length}
          </span>
        </div>
        {outgoing.length ? (
          <ul className="space-y-2">
            {outgoing.map(edge => (
              <li key={edgeId(edge)}>
                <button
                  className="w-full rounded border bg-white px-3 py-2 text-left text-sm hover:border-brand hover:bg-brand/5 focus:outline-none focus:ring-2 focus:ring-brand"
                  type="button"
                  onClick={() => onSelectEdge(edgeId(edge))}
                >
                  <RelationshipSentence edge={edge} tagColors={tagColors} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">
            This tag does not point to another tag yet.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold uppercase text-grey-6">
            Incoming relationships
          </h4>
          <span className="rounded-full bg-grey-2 px-2 py-0.5 text-xs font-bold text-grey-6">
            {incoming.length}
          </span>
        </div>
        {incoming.length ? (
          <ul className="space-y-2">
            {incoming.map(edge => (
              <li key={edgeId(edge)}>
                <button
                  className="w-full rounded border bg-white px-3 py-2 text-left text-sm hover:border-brand hover:bg-brand/5 focus:outline-none focus:ring-2 focus:ring-brand"
                  type="button"
                  onClick={() => onSelectEdge(edgeId(edge))}
                >
                  <RelationshipSentence edge={edge} tagColors={tagColors} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">
            No manual relationships point to this tag yet.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase text-grey-6">Quotes</h4>
        {quotes.length ? (
          <ul className="max-h-[46vh] space-y-2 overflow-auto pr-1">
            {quotes.map(quote => (
              <li className="rounded border bg-[#fffaf0] p-3" key={quote.id}>
                <div className="mb-1 text-xs font-bold text-grey-6">
                  {quote.documentLabel}
                </div>
                <blockquote className="text-sm leading-5 text-color-text">
                  {quote.quote}
                </blockquote>
                <a
                  className="mt-2 text-sm font-bold"
                  href={quote.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">
            This tag is descriptive or has no quote selectors in the selected
            group.
          </p>
        )}
      </section>
    </div>
  );
}

export function NodeLinkEditor({
  graph,
  selectedTag,
  semanticState,
  tagColors,
  onSaveState,
  saveStatus,
  saveMessage,
}: {
  graph: NodeLinkGraph;
  selectedTag: string;
  semanticState: NodeLinkSemanticState;
  tagColors: Record<string, string>;
  onSaveState: (nextState: NodeLinkSemanticState) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
}) {
  const tags = tagOptions(graph);
  const [edgeSource, setEdgeSource] = useState('');
  const [edgeTarget, setEdgeTarget] = useState('');
  const [edgeRelationship, setEdgeRelationship] = useState('');
  const [editingEdgeId, setEditingEdgeId] = useState('');
  const [tagName, setTagName] = useState('');
  const [editEdgeSource, setEditEdgeSource] = useState('');
  const [editEdgeTarget, setEditEdgeTarget] = useState('');
  const [editEdgeRelationship, setEditEdgeRelationship] = useState('');
  const [editingTagId, setEditingTagId] = useState('');
  const [editTagName, setEditTagName] = useState('');
  const [addMode, setAddMode] = useState<AddMode>('edge');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [formMessage, setFormMessage] = useState('');

  useEffect(() => {
    if (!edgeSource && selectedTag && tags.includes(selectedTag)) {
      setEdgeSource(selectedTag);
    }
  }, [edgeSource, selectedTag, tags]);

  const resetEdgeForm = () => {
    setEdgeRelationship('');
    setEdgeTarget('');
    setFormMessage('');
  };

  const resetTagForm = () => {
    setTagName('');
    setFormMessage('');
  };

  const closeEditModal = () => {
    setEditingEdgeId('');
    setEditEdgeSource('');
    setEditEdgeRelationship('');
    setEditEdgeTarget('');
    setEditingTagId('');
    setEditTagName('');
    setFormMessage('');
  };

  const editEdge = (edge: ManualTagEdge) => {
    setEditingEdgeId(edgeId(edge));
    setEditEdgeSource(edge.sourceTag);
    setEditEdgeRelationship(edge.connectionType);
    setEditEdgeTarget(edge.targetTag);
    setFormMessage('');
  };

  const saveEdgeValues = ({
    edgeIdToUpdate = '',
    relationship,
    source,
    target,
  }: {
    edgeIdToUpdate?: string;
    relationship: string;
    source: string;
    target: string;
  }) => {
    const sourceTag = source.trim();
    const targetTag = target.trim();
    const connectionType = relationship.trim();
    if (!sourceTag || !targetTag || !connectionType) {
      setFormMessage('Choose source, relationship, and target.');
      return;
    }
    if (sourceTag === targetTag) {
      setFormMessage('Source and target must be different tags.');
      return;
    }

    const existingDuplicate = semanticState.tagEdges.find(
      edge =>
        edgeKey(edge) === edgeKey({ sourceTag, targetTag }) &&
        edgeId(edge) !== edgeIdToUpdate,
    );
    if (existingDuplicate) {
      setFormMessage('That source-target edge already exists.');
      return;
    }

    const now = new Date().toISOString();
    const nextEdge: ManualTagEdge = {
      id: edgeIdToUpdate || newManualEdgeId(),
      sourceTag,
      targetTag,
      connectionType,
      label: connectionType,
      createdBy: 'human',
      createdFrom: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    const nextEdges = edgeIdToUpdate
      ? semanticState.tagEdges.map(edge =>
          edgeId(edge) === edgeIdToUpdate
            ? {
                ...edge,
                sourceTag,
                targetTag,
                connectionType,
                label: connectionType,
                updatedAt: now,
              }
            : edge,
        )
      : [...semanticState.tagEdges, nextEdge];

    onSaveState({
      ...semanticState,
      tagEdges: nextEdges,
      updatedAt: now,
    });
    if (edgeIdToUpdate) {
      closeEditModal();
    } else {
      resetEdgeForm();
    }
  };

  const saveEdge = () => {
    saveEdgeValues({
      source: edgeSource,
      relationship: edgeRelationship,
      target: edgeTarget,
    });
  };

  const saveEditedEdge = () => {
    saveEdgeValues({
      edgeIdToUpdate: editingEdgeId,
      source: editEdgeSource,
      relationship: editEdgeRelationship,
      target: editEdgeTarget,
    });
  };

  const deleteEdge = (edge: ManualTagEdge) => {
    const now = new Date().toISOString();
    onSaveState({
      ...semanticState,
      tagEdges: semanticState.tagEdges.filter(
        item => edgeId(item) !== edgeId(edge),
      ),
      updatedAt: now,
    });
    if (editingEdgeId === edgeId(edge)) {
      closeEditModal();
    }
    setPendingDelete(null);
  };

  const saveDescriptiveTagValue = ({
    name,
    tagId = '',
  }: {
    name: string;
    tagId?: string;
  }) => {
    const tag = name.trim();
    if (!tag) {
      setFormMessage('Enter a descriptive tag.');
      return;
    }

    const currentTag = tagId
      ? semanticState.descriptiveTags.find(item => item.id === tagId)
      : null;
    const duplicateTag = graph.tags.find(
      item =>
        item.tag.toLocaleLowerCase() === tag.toLocaleLowerCase() &&
        item.tag.toLocaleLowerCase() !== currentTag?.tag.toLocaleLowerCase(),
    );
    const duplicateDescriptiveTag = semanticState.descriptiveTags.find(
      item =>
        item.tag.toLocaleLowerCase() === tag.toLocaleLowerCase() &&
        item.id !== tagId,
    );
    if (duplicateTag || duplicateDescriptiveTag) {
      setFormMessage('That tag already exists.');
      return;
    }

    const now = new Date().toISOString();
    let nextTags: DescriptiveTag[];
    let nextEdges = semanticState.tagEdges;
    if (tagId) {
      const previous = semanticState.descriptiveTags.find(
        item => item.id === tagId,
      );
      nextTags = semanticState.descriptiveTags.map(item =>
        item.id === tagId ? { ...item, tag, updatedAt: now } : item,
      );
      if (previous) {
        nextEdges = semanticState.tagEdges.map(edge => ({
          ...edge,
          sourceTag: edge.sourceTag === previous.tag ? tag : edge.sourceTag,
          targetTag: edge.targetTag === previous.tag ? tag : edge.targetTag,
          updatedAt:
            edge.sourceTag === previous.tag || edge.targetTag === previous.tag
              ? now
              : edge.updatedAt,
        }));
      }
    } else {
      nextTags = [
        ...semanticState.descriptiveTags,
        {
          id: newDescriptiveTagId(),
          tag,
          createdAt: now,
          updatedAt: now,
          createdBy: 'human',
        },
      ];
    }

    onSaveState({
      ...semanticState,
      descriptiveTags: nextTags,
      tagEdges: nextEdges,
      updatedAt: now,
    });
    if (tagId) {
      closeEditModal();
    } else {
      resetTagForm();
    }
  };

  const saveDescriptiveTag = () => {
    saveDescriptiveTagValue({ name: tagName });
  };

  const saveEditedDescriptiveTag = () => {
    saveDescriptiveTagValue({ name: editTagName, tagId: editingTagId });
  };

  const editDescriptiveTag = (tag: DescriptiveTag) => {
    setEditingTagId(tag.id);
    setEditTagName(tag.tag);
    setFormMessage('');
  };

  const deleteDescriptiveTag = (tag: DescriptiveTag) => {
    const hasEdges = semanticState.tagEdges.some(
      edge => edge.sourceTag === tag.tag || edge.targetTag === tag.tag,
    );
    if (hasEdges) {
      setFormMessage('Remove this tag from manual edges before deleting it.');
      return;
    }
    onSaveState({
      ...semanticState,
      descriptiveTags: semanticState.descriptiveTags.filter(
        item => item.id !== tag.id,
      ),
      updatedAt: new Date().toISOString(),
    });
    if (editingTagId === tag.id) {
      closeEditModal();
    }
    setPendingDelete(null);
  };

  const exportLegend = () => {
    const blob = new Blob([tagLegendText(semanticState)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tag-legend-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const canEdit = tags.length > 1;

  return (
    <div className="space-y-5 border-t pt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase text-grey-6">Edit graph</h3>
        <span
          className={classnames('rounded-full px-2 py-0.5 text-xs font-bold', {
            'bg-grey-2 text-grey-6': saveStatus === 'idle',
            'bg-yellow-2 text-yellow-7': saveStatus === 'saving',
            'bg-green-2 text-green-7': saveStatus === 'saved',
            'bg-red-2 text-red-7': saveStatus === 'error',
          })}
        >
          {saveStatus === 'saving'
            ? 'Saving'
            : saveStatus === 'saved'
              ? 'Saved'
              : saveStatus === 'error'
                ? 'Save failed'
                : 'Ready'}
        </span>
      </div>

      {(formMessage || saveMessage) && (
        <p className="rounded border bg-grey-1 px-3 py-2 text-sm text-grey-6">
          {formMessage || saveMessage}
        </p>
      )}

      <section className="space-y-3 rounded border bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold">Add New</h4>
          <div className="flex rounded border bg-grey-1 p-0.5 text-xs font-bold">
            <button
              className={classnames('rounded px-2.5 py-1', {
                'bg-white text-brand shadow-sm': addMode === 'edge',
                'text-grey-6 hover:text-color-text': addMode !== 'edge',
              })}
              type="button"
              onClick={() => {
                setAddMode('edge');
                resetTagForm();
              }}
            >
              Edge
            </button>
            <button
              className={classnames('rounded px-2.5 py-1', {
                'bg-white text-brand shadow-sm': addMode === 'tag',
                'text-grey-6 hover:text-color-text': addMode !== 'tag',
              })}
              type="button"
              onClick={() => {
                setAddMode('tag');
                resetEdgeForm();
              }}
            >
              Tag
            </button>
          </div>
        </div>

        {addMode === 'edge' ? (
          <div className="space-y-3">
            <div className="grid gap-2">
              <select
                className="h-9 rounded border bg-white px-2 text-sm"
                value={edgeSource}
                disabled={!canEdit}
                onChange={event =>
                  setEdgeSource((event.target as HTMLSelectElement).value)
                }
              >
                <option value="">Source tag</option>
                {tags.map(tag => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              <input
                className="h-9 rounded border px-2 text-sm"
                value={edgeRelationship}
                disabled={!canEdit}
                placeholder="relationship"
                onInput={event =>
                  setEdgeRelationship((event.target as HTMLInputElement).value)
                }
              />
              <select
                className="h-9 rounded border bg-white px-2 text-sm"
                value={edgeTarget}
                disabled={!canEdit}
                onChange={event =>
                  setEdgeTarget((event.target as HTMLSelectElement).value)
                }
              >
                <option value="">Target tag</option>
                {tags.map(tag => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={saveEdge}
                disabled={!canEdit || saveStatus === 'saving'}
              >
                Add Edge
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              className="h-9 w-full rounded border px-2 text-sm"
              value={tagName}
              placeholder="New descriptive tag"
              onInput={event =>
                setTagName((event.target as HTMLInputElement).value)
              }
            />
            <div className="flex gap-2">
              <Button
                onClick={saveDescriptiveTag}
                disabled={saveStatus === 'saving'}
              >
                Add Tag
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold">Manual edges</h4>
          <Button
            onClick={exportLegend}
            disabled={!semanticState.tagEdges.length}
            title="Export tag legend text"
          >
            Export
          </Button>
        </div>
        {semanticState.tagEdges.length ? (
          <ul className="max-h-52 space-y-2 overflow-auto pr-1">
            {semanticState.tagEdges.map(edge => {
              const id = edgeId(edge);
              const confirmingDelete =
                pendingDelete?.type === 'edge' && pendingDelete.id === id;
              return (
                <li className="rounded border px-3 py-2 text-sm" key={id}>
                  <div className="leading-6">
                    <RelationshipSentence edge={edge} tagColors={tagColors} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {confirmingDelete ? (
                      <>
                        <span className="text-xs font-bold text-red-6">
                          Confirm delete?
                        </span>
                        <EditorActionButton
                          variant="danger"
                          onClick={() => deleteEdge(edge)}
                        >
                          Yes
                        </EditorActionButton>
                        <EditorActionButton
                          variant="secondary"
                          onClick={() => setPendingDelete(null)}
                        >
                          No
                        </EditorActionButton>
                      </>
                    ) : (
                      <>
                        <EditorActionButton onClick={() => editEdge(edge)}>
                          Edit
                        </EditorActionButton>
                        <EditorActionButton
                          variant="danger"
                          onClick={() => setPendingDelete({ type: 'edge', id })}
                        >
                          Delete
                        </EditorActionButton>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">No manual tag-tag edges yet.</p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-bold">Descriptive tags</h4>
        {semanticState.descriptiveTags.length ? (
          <ul className="space-y-2">
            {semanticState.descriptiveTags.map(tag => {
              const hasEdges = semanticState.tagEdges.some(
                edge =>
                  edge.sourceTag === tag.tag || edge.targetTag === tag.tag,
              );
              const confirmingDelete =
                pendingDelete?.type === 'tag' && pendingDelete.id === tag.id;
              return (
                <li
                  className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                  key={tag.id}
                >
                  <span className="font-medium">{tag.tag}</span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {confirmingDelete ? (
                      <>
                        <span className="text-xs font-bold text-red-6">
                          Confirm delete?
                        </span>
                        <EditorActionButton
                          variant="danger"
                          onClick={() => deleteDescriptiveTag(tag)}
                        >
                          Yes
                        </EditorActionButton>
                        <EditorActionButton
                          variant="secondary"
                          onClick={() => setPendingDelete(null)}
                        >
                          No
                        </EditorActionButton>
                      </>
                    ) : (
                      <>
                        <EditorActionButton
                          onClick={() => editDescriptiveTag(tag)}
                        >
                          Edit
                        </EditorActionButton>
                        <EditorActionButton
                          disabled={hasEdges}
                          title={
                            hasEdges
                              ? 'Remove connected manual edges before deleting'
                              : 'Delete descriptive tag'
                          }
                          variant="danger"
                          onClick={() =>
                            setPendingDelete({ type: 'tag', id: tag.id })
                          }
                        >
                          Delete
                        </EditorActionButton>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-grey-6">No descriptive tags yet.</p>
        )}
      </section>

      {editingEdgeId && (
        <EditModal title="Edit edge" onClose={closeEditModal}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,1.2fr)_minmax(0,1fr)]">
              <label className="grid gap-1 text-xs font-bold uppercase text-grey-6">
                Source Tag
                <select
                  className="h-10 rounded border bg-white px-2 text-sm font-normal normal-case text-color-text"
                  value={editEdgeSource}
                  disabled={!canEdit}
                  onChange={event =>
                    setEditEdgeSource((event.target as HTMLSelectElement).value)
                  }
                >
                  <option value="">Source tag</option>
                  {tags.map(tag => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase text-grey-6">
                Relationship
                <input
                  className="h-10 rounded border px-2 text-sm font-normal normal-case text-color-text"
                  value={editEdgeRelationship}
                  disabled={!canEdit}
                  placeholder="relationship"
                  onInput={event =>
                    setEditEdgeRelationship(
                      (event.target as HTMLInputElement).value,
                    )
                  }
                />
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase text-grey-6">
                Target Tag
                <select
                  className="h-10 rounded border bg-white px-2 text-sm font-normal normal-case text-color-text"
                  value={editEdgeTarget}
                  disabled={!canEdit}
                  onChange={event =>
                    setEditEdgeTarget((event.target as HTMLSelectElement).value)
                  }
                >
                  <option value="">Target tag</option>
                  {tags.map(tag => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={closeEditModal}>Cancel</Button>
              <Button
                onClick={saveEditedEdge}
                disabled={!canEdit || saveStatus === 'saving'}
              >
                Save Changes
              </Button>
            </div>
          </div>
        </EditModal>
      )}

      {editingTagId && (
        <EditModal title="Edit descriptive tag" onClose={closeEditModal}>
          <div className="space-y-4">
            <label className="grid gap-1 text-xs font-bold uppercase text-grey-6">
              Tag
              <input
                className="h-10 rounded border px-2 text-sm font-normal normal-case text-color-text"
                value={editTagName}
                placeholder="Descriptive tag"
                onInput={event =>
                  setEditTagName((event.target as HTMLInputElement).value)
                }
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={closeEditModal}>Cancel</Button>
              <Button
                onClick={saveEditedDescriptiveTag}
                disabled={saveStatus === 'saving'}
              >
                Save Changes
              </Button>
            </div>
          </div>
        </EditModal>
      )}
    </div>
  );
}

function NodeLinkGraphPage({
  auth,
  nodeLinkState,
  session,
  toastMessenger,
}: NodeLinkGraphPageProps) {
  const store = useSidebarStore();
  const routeParams = store.routeParams();
  const groups = store.allGroups();
  const hasFetchedProfile = store.hasFetchedProfile();
  const isLoggedIn = store.isLoggedIn();
  const documentUri =
    routeParams.uri || store.searchUris()[0] || store.mainFrame()?.uri || '';
  const tagColors = store.tagInventorySchemaTagColors();
  const routeGroup = routeGroupParam(routeParams);
  const focusedGroupId = store.focusedGroupId() || '';
  const canonicalRouteGroup = routeGroup
    ? canonicalGroupId(routeGroup, groups)
    : '';
  const fallbackGroupId =
    (focusedGroupId ? canonicalGroupId(focusedGroupId, groups) : '') ||
    groups[0]?.id ||
    '';

  const [selectedGroupId, setSelectedGroupId] = useState(canonicalRouteGroup);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [message, setMessage] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [semanticState, setSemanticState] =
    useState<NodeLinkSemanticState>(emptyNodeLinkState());
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const activeLoadRef = useRef<{
    controller: AbortController;
    loadKey: string;
  } | null>(null);
  const loadedGraphRef = useRef('');

  useEffect(() => {
    if (canonicalRouteGroup && canonicalRouteGroup !== selectedGroupId) {
      setSelectedGroupId(canonicalRouteGroup);
    }
  }, [canonicalRouteGroup, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId && fallbackGroupId) {
      setSelectedGroupId(fallbackGroupId);
    }
  }, [fallbackGroupId, selectedGroupId]);

  const loadGraph = (force = false) => {
    const selectedGroup = findGroupByIdentifier(selectedGroupId, groups);
    const groupId = selectedGroup?.id || selectedGroupId;
    const loadKey = `${groupId}\0${documentUri}`;
    const waitingForGroups = Boolean(selectedGroupId) && groups.length === 0;
    const unresolvedGroupIdentifier =
      Boolean(selectedGroupId) && groups.length > 0 && !selectedGroup;
    if (
      !groupId ||
      !isLoggedIn ||
      waitingForGroups ||
      unresolvedGroupIdentifier
    ) {
      return undefined;
    }
    if (
      !force &&
      (activeLoadRef.current?.loadKey === loadKey ||
        loadedGraphRef.current === loadKey)
    ) {
      return undefined;
    }

    const controller = new AbortController();
    activeLoadRef.current?.controller.abort();
    activeLoadRef.current = { controller, loadKey };
    setStatus('loading');
    setMessage('');

    Promise.all([
      nodeLinkState.fetchGroupAnnotations(groupId, controller.signal, {
        uri: documentUri,
      }),
      nodeLinkState.loadState(groupId),
    ])
      .then(([fetchedAnnotations, loadedState]) => {
        if (activeLoadRef.current?.controller !== controller) {
          return;
        }
        setAnnotations(fetchedAnnotations);
        setSemanticState(loadedState.state);
        setStatus('loaded');
        setSaveStatus('idle');
        setSaveMessage('');
        loadedGraphRef.current = loadKey;
        activeLoadRef.current = null;
        setMessage(
          loadedState.status === 'invalid' ? loadedState.message || '' : '',
        );
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        if (activeLoadRef.current?.controller !== controller) {
          return;
        }
        activeLoadRef.current = null;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : String(err));
      });

    return () => {
      if (activeLoadRef.current?.controller === controller) {
        controller.abort();
        activeLoadRef.current = null;
      }
    };
  };

  useEffect(loadGraph, [
    documentUri,
    groups,
    groups.length,
    isLoggedIn,
    nodeLinkState,
    selectedGroupId,
  ]);

  const selectedGroup = findGroupByIdentifier(selectedGroupId, groups);
  const selectedGroupPubId = selectedGroup?.id || selectedGroupId;

  const saveSemanticState = (nextState: NodeLinkSemanticState) => {
    if (!selectedGroupPubId) {
      setSaveStatus('error');
      setSaveMessage('Choose a group before saving.');
      return;
    }

    setSemanticState(nextState);
    setSaveStatus('saving');
    setSaveMessage('');
    nodeLinkState
      .saveState(selectedGroupPubId, nextState, {
        groupName: selectedGroup?.name,
      })
      .then(result => {
        setSemanticState(result.state);
        setSaveStatus('saved');
        setSaveMessage('Saved to Hypothesis.');
      })
      .catch(err => {
        setSaveStatus('error');
        setSaveMessage(err instanceof Error ? err.message : String(err));
      });
  };

  const graph = useMemo(
    () => buildNodeLinkGraph(annotations, semanticState),
    [annotations, semanticState],
  );

  useEffect(() => {
    if (selectedTag && !graph.tags.some(tag => tag.tag === selectedTag)) {
      setSelectedTag('');
    }
  }, [graph.tags, selectedTag]);

  useEffect(() => {
    if (
      selectedEdgeId &&
      !graph.manualEdges.some(edge => edgeId(edge) === selectedEdgeId)
    ) {
      setSelectedEdgeId('');
    }
  }, [graph.manualEdges, selectedEdgeId]);

  const selectedEdge =
    graph.manualEdges.find(edge => edgeId(edge) === selectedEdgeId) || null;

  const selectTag = (tag: string) => {
    setSelectedTag(tag);
    setSelectedEdgeId('');
  };

  const selectEdge = (id: string) => {
    setSelectedEdgeId(current => (current === id ? '' : id));
    setSelectedTag('');
  };

  const login = async () => {
    try {
      await auth.login({ action: 'login' });
      session.reload();
    } catch (err) {
      toastMessenger.error(err.message);
    }
  };

  const canLoad = Boolean(isLoggedIn && selectedGroupPubId && groups.length);

  return (
    <div className="flex h-screen min-h-screen flex-col bg-grey-2 text-color-text">
      <header className="flex min-h-[64px] items-center justify-between gap-4 border-b bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded bg-brand text-white">
            <GraphIcon />
          </span>
          <div>
            <h1 className="text-xl font-bold">Node-Link Graph</h1>
            <p className="text-sm text-grey-6">
              Hypothesis tags, quote evidence, and manual tag relationships.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasFetchedProfile && !isLoggedIn && (
            <Button onClick={login}>Log in</Button>
          )}
          <Button
            onClick={() => {
              loadGraph(true);
            }}
            disabled={!canLoad || status === 'loading'}
            title="Refresh from Hypothesis"
          >
            <RefreshIcon className="mr-1 inline" /> Refresh
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="grid min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
          <section className="flex flex-wrap items-end gap-3 rounded border bg-white p-3">
            <label className="grid min-w-[280px] gap-1 text-sm font-medium">
              <span>Group</span>
              <select
                className="h-9 rounded border bg-white px-2"
                value={selectedGroupId}
                disabled={!isLoggedIn || !groups.length}
                onChange={event =>
                  setSelectedGroupId((event.target as HTMLSelectElement).value)
                }
              >
                {!groups.length && <option value="">No groups loaded</option>}
                {groups.map(group => (
                  <option key={group.id} value={group.id}>
                    {groupLabel(group)}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm text-grey-6">
              {status === 'loading'
                ? 'Loading graph data...'
                : selectedGroup
                  ? `${graph.tags.length} tags, ${graph.documents.length} documents, ${graph.manualEdges.length} manual tag-tag edges`
                  : 'Choose a group to load graph data.'}
            </div>
          </section>

          {message && (
            <div className="rounded border border-yellow-6 bg-yellow-2 px-3 py-2 text-sm">
              {message}
            </div>
          )}

          {!hasFetchedProfile ? (
            <div className="rounded border bg-white p-6 text-sm text-grey-6">
              Checking Hypothesis session...
            </div>
          ) : !isLoggedIn ? (
            <div className="rounded border bg-white p-6">
              <h2 className="mb-2 text-lg font-bold">Sign in required</h2>
              <p className="mb-4 text-sm text-grey-6">
                Log in to Hypothesis to load your group annotations and synced
                node-link state.
              </p>
              <Button onClick={login}>Log in</Button>
            </div>
          ) : status === 'error' ? (
            <div className="rounded border bg-white p-6">
              <h2 className="mb-2 text-lg font-bold">Graph failed to load</h2>
              <p className="mb-4 text-sm text-grey-6">{message}</p>
              <Button onClick={() => loadGraph(true)}>Retry</Button>
            </div>
          ) : (
            <GraphCanvas
              graph={graph}
              selectedTag={selectedTag}
              selectedEdgeId={selectedEdgeId}
              tagColors={tagColors}
              onSelectTag={selectTag}
              onSelectEdge={selectEdge}
              onClearSelection={() => {
                setSelectedTag('');
                setSelectedEdgeId('');
              }}
            />
          )}
        </main>

        <aside className="w-[390px] shrink-0 overflow-auto border-l bg-white p-4">
          <div className="space-y-5">
            <EvidencePanel
              graph={graph}
              selectedTag={selectedTag}
              selectedEdge={selectedEdge}
              tagColors={tagColors}
              onSelectEdge={selectEdge}
            />
            <NodeLinkEditor
              graph={graph}
              selectedTag={selectedTag}
              semanticState={semanticState}
              tagColors={tagColors}
              onSaveState={saveSemanticState}
              saveStatus={saveStatus}
              saveMessage={saveMessage}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default withServices(NodeLinkGraphPage, [
  'auth',
  'nodeLinkState',
  'session',
  'toastMessenger',
]);
