import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { SavedAnnotation } from '../../types/api';
import { quote as annotationQuote } from '../helpers/annotation-metadata';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import { isAiSearchSystemTag } from '../helpers/tag-inventory-group';
import { withServices } from '../service-context';
import {
  savedAnnotationsForCurrentDocument,
  type TagInventoryGroupSyncService,
} from '../services/tag-inventory-group-sync';
import { useSidebarStore } from '../store';
import HighlightedSentence, { type LabeledSpan, type RenderMode } from './HighlightedSentence';
import { SearchableCombobox } from './SearchableCombobox';

type GroupAnnotationsTabProps = {
  tagInventoryGroupSync: TagInventoryGroupSyncService;
};

type ApiSpan = {
  text: string;
  start: number;
  end: number;
  label: number;
};

type CategoryRow = {
  name: string;
  description: string;
};

// Returns true if `spans` contains each category in `categoryIds` in order.
function hasSequence(spans: ApiSpan[], categoryIds: number[]): boolean {
  let minPos = 0;
  for (const catId of categoryIds) {
    const span = spans
      .filter(s => s.label === catId && s.start >= minPos)
      .sort((a, b) => a.start - b.start)[0];
    if (!span) return false;
    minPos = span.end;
  }
  return true;
}

const DEFAULT_CATEGORY_ROWS: CategoryRow[] = [
  { name: 'Status Quo/Context (the particular context or existing work)', description: '' },
  { name: "Challenge/Problem/Obstacle (often starts with 'however', gaps in prior work)", description: '' },
  { name: 'Contribution (what the authors did)', description: '' },
  { name: 'Purpose/Goal/Focus (why the work was done)', description: '' },
  { name: 'Methodology (how the work was done)', description: '' },
  { name: 'Participants (who were involved)', description: '' },
  { name: 'System Description (of a system the authors developed or proposed)', description: '' },
  { name: 'Findings', description: '' },
  { name: 'Example', description: '' },
];

// Tableau 20 palette — primaries first, then their lighter pairs.
const LABEL_HEX_COLORS = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
  '#A0CBE8', '#FFBE7D', '#FF9D9A', '#86BCB6', '#8CD17D',
  '#F1CE63', '#D4A6C8', '#FABFD2', '#D7B5A6', '#B6992D',
];

const _measureCanvas = document.createElement('canvas');
function measureTextWidth(text: string): number {
  const ctx = _measureCanvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = 'italic 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
  return ctx.measureText(text).width;
}

function mergeAdjacentSpans(spans: ApiSpan[]): ApiSpan[] {
  if (spans.length === 0) return spans;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: ApiSpan[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === span.label && span.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, span.end);
      prev.text = prev.text + ' ' + span.text;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

async function fetchSuggestCategories(segments: string[]): Promise<CategoryRow[]> {
  const response = await fetch(
    'https://phrase-labeler.onrender.com/suggest-categories',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segments }) },
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Category suggestion error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const cats = (data.categories ?? []) as { label: string; description: string }[];
  return cats.map(c => ({ name: c.label, description: c.description }));
}

async function fetchSpansBatch(
  sentences: string[],
  categories?: string[],
  categoryDescriptions?: string[],
): Promise<ApiSpan[][]> {
  const body: Record<string, unknown> = { sentences };
  if (categories && categories.length > 0) {
    body.categories = categories;
    if (categoryDescriptions && categoryDescriptions.some(d => d.length > 0)) {
      body.category_descriptions = categoryDescriptions;
    }
  }
  const response = await fetch(
    'https://phrase-labeler.onrender.com/label-multi-batch',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Labeling service error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const results = (data.results ?? []) as { spans: ApiSpan[] }[];
  return results.map(r => mergeAdjacentSpans(r.spans ?? []));
}

type LabelIndex = {
  labelColors: Record<number, string>;
  labelNames: Record<number, string>;
};

function resolveSourceTitle(ann: SavedAnnotation): { title: string; year: string } {
  const rawTitle = ann.document?.title;
  const title = (Array.isArray(rawTitle) ? rawTitle[0] : rawTitle) || ann.uri || '';
  const year = ann.created ? String(new Date(ann.created).getFullYear()) : '';
  return { title, year };
}

function sourceLabel(ann: SavedAnnotation): string {
  const { title, year } = resolveSourceTitle(ann);
  const prefix = title.slice(0, 10) + '...';
  return year ? `${prefix}, ${year}` : prefix;
}

function sourceTooltip(ann: SavedAnnotation): string {
  const { title, year } = resolveSourceTitle(ann);
  return year ? `${title}, ${year}` : title;
}

function buildLabelIndex(allSpans: ApiSpan[][], categoryNames?: string[]): LabelIndex {
  const seenIds = new Set<number>();
  for (const spans of allSpans) for (const span of spans) {
    if (span.label !== -1) seenIds.add(span.label);
  }
  const labelColors: Record<number, string> = {};
  const labelNames: Record<number, string> = {};
  const sortedIds = [...seenIds].sort((a, b) => a - b);
  sortedIds.forEach((id, colorIndex) => {
    labelColors[id] = LABEL_HEX_COLORS[colorIndex % LABEL_HEX_COLORS.length];
    labelNames[id] = categoryNames?.[id] ?? `Label ${id}`;
  });
  return { labelColors, labelNames };
}

function toLabeled(spans: ApiSpan[]): LabeledSpan[] {
  return spans.map(s => ({ text: s.text ?? '', start: s.start, end: s.end, label: s.label }));
}

function splitAtTwoOffsets(
  original: string,
  spans: LabeledSpan[],
  leftEnd: number,
  rightStart: number,
): { left: { text: string; spans: LabeledSpan[] }; right: { text: string; spans: LabeledSpan[] } } {
  const rs = Math.max(leftEnd, rightStart);
  const leftSpans = spans.filter(s => s.start < leftEnd).map(s => ({ ...s, end: Math.min(s.end, leftEnd) }));
  const rightSpans = spans.filter(s => s.end > rs).map(s => ({
    ...s, start: Math.max(s.start, rs) - rs, end: s.end - rs,
    text: original.slice(Math.max(s.start, rs), s.end),
  }));
  return { left: { text: original.slice(0, leftEnd), spans: leftSpans }, right: { text: original.slice(rs), spans: rightSpans } };
}

function splitAtOffset(
  original: string,
  spans: LabeledSpan[],
  offset: number,
): { left: { text: string; spans: LabeledSpan[] }; right: { text: string; spans: LabeledSpan[] } } {
  const leftSpans = spans.filter(s => s.start < offset).map(s => ({ ...s, end: Math.min(s.end, offset) }));
  const rightSpans = spans.filter(s => s.end > offset).map(s => ({
    ...s, start: Math.max(s.start, offset) - offset, end: s.end - offset,
    text: original.slice(Math.max(s.start, offset), s.end),
  }));
  return { left: { text: original.slice(0, offset), spans: leftSpans }, right: { text: original.slice(offset), spans: rightSpans } };
}

// ─── Per-tag section ────────────────────────────────────────────────────────

type GroupSectionProps = {
  tag: string;
  annotations: SavedAnnotation[];
  groupId: string;
  isFullWidth: boolean;
};

function GroupSection({ tag, annotations, groupId, isFullWidth }: GroupSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isControlsExpanded, setIsControlsExpanded] = useState(false);

  const tagKey = tag || '__untagged__';
  const categoryRowsKey = `hypothesis-category-rows-${groupId}-${tagKey}`;
  const cacheKey = `hypothesis-highlights-${groupId}-${tagKey}`;

  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>(() => {
    try {
      const stored = localStorage.getItem(categoryRowsKey);
      if (stored) return JSON.parse(stored) as CategoryRow[];
    } catch {}
    return [];
  });

  useEffect(() => {
    try { localStorage.setItem(categoryRowsKey, JSON.stringify(categoryRows)); } catch {}
  }, [categoryRows, categoryRowsKey]);

  const [rawSpanMap, setRawSpanMap] = useState<Map<string, ApiSpan[]>>(new Map());
  const [labelIndex, setLabelIndex] = useState<LabelIndex>({ labelColors: {}, labelNames: {} });
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [isGeneratingLabels, setIsGeneratingLabels] = useState(false);
  const [generateLabelsError, setGenerateLabelsError] = useState<string | null>(null);
  const [highlightError, setHighlightError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>('highlight');
  const [activeLabels, setActiveLabels] = useState<Set<number> | undefined>(undefined);
  const [searchText, setSearchText] = useState('');
  const [searchCategoryIds, setSearchCategoryIds] = useState<number[]>([]);
  const [highlightedCategories, setHighlightedCategories] = useState<string[] | undefined>(undefined);
  const [highlightedDescriptions, setHighlightedDescriptions] = useState<string[] | undefined>(undefined);

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const alignCategory = searchCategoryIds.length >= 1 ? searchCategoryIds[0] : null;
  const contentRef = useRef<HTMLDivElement>(null);
  const alignedScrollRef = useRef<HTMLDivElement>(null);

  // Restore highlight cache on mount.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { rawSpans, categories: cats, categoryDescriptions: descs } = JSON.parse(cached) as {
          rawSpans: Record<string, ApiSpan[]>;
          categories: string[] | undefined;
          categoryDescriptions: string[] | undefined;
        };
        const restoredMap = new Map<string, ApiSpan[]>(
          Object.entries(rawSpans).map(([id, spans]) => [id, mergeAdjacentSpans(spans)]),
        );
        const index = buildLabelIndex([...restoredMap.values()], cats);
        setRawSpanMap(restoredMap);
        setLabelIndex(index);
        setActiveLabels(new Set(Object.keys(index.labelColors).map(Number)));
        setHighlightedCategories(cats ?? []);
        setHighlightedDescriptions(descs ?? []);
        return;
      }
    } catch {}
    setRawSpanMap(new Map());
    setLabelIndex({ labelColors: {}, labelNames: {} });
    setActiveLabels(undefined);
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll so the split column boundary is centered after aligned table renders.
  useEffect(() => {
    if (alignCategory === null && !searchText.trim()) return;
    if (!isFullWidth) return;
    const container = alignedScrollRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      const tds = container.querySelectorAll('tr:first-child td');
      const stickyTd = tds[0] as HTMLElement | null;
      const leftTd = tds[1] as HTMLElement | null;
      if (!leftTd) return;
      const stickyW = stickyTd?.offsetWidth ?? 0;
      container.scrollLeft = leftTd.offsetWidth - (container.clientWidth - stickyW) / 2;
    });
  }, [alignCategory, searchCategoryIds.length, isFullWidth, rawSpanMap, searchText]);

  const updateCategory = (i: number, field: 'name' | 'description', value: string) =>
    setCategoryRows(rows => { const u = [...rows]; u[i] = { ...u[i], [field]: value }; return u; });
  const addCategory = () => setCategoryRows(rows => [...rows, { name: '', description: '' }]);
  const removeCategory = (i: number) => setCategoryRows(rows => rows.filter((_, idx) => idx !== i));

  const toggleLabel = (labelId: number) => {
    setActiveLabels(prev => {
      const next = new Set(prev ?? Object.keys(labelIndex.labelColors).map(Number));
      if (next.has(labelId)) next.delete(labelId); else next.add(labelId);
      return next;
    });
  };

  // Memoize left-padding for single-category alignment (unused in table mode but kept for future).
  const _alignPaddings = useMemo<Map<string, number> | null>(() => {
    if (alignCategory === null || rawSpanMap.size === 0) return null;
    const containerWidth = contentRef.current?.offsetWidth ?? 300;
    const targetX = containerWidth / 2;
    const paddings = new Map<string, number>();
    for (const ann of annotations) {
      const original = (annotationQuote(ann) ?? '').trim();
      const firstSpan = (rawSpanMap.get(ann.id) ?? []).find(s => s.label === alignCategory);
      const prefixWidth = measureTextWidth(firstSpan ? original.slice(0, firstSpan.start) : '');
      paddings.set(ann.id, Math.max(0, targetX - prefixWidth));
    }
    return paddings;
  }, [alignCategory, annotations, rawSpanMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHighlight = async () => {
    setIsHighlighting(true);
    setHighlightError(null);
    try {
      let validRows = categoryRows.filter(r => r.name.trim().length > 0);

      if (validRows.length === 0) {
        const allSentences = annotations
          .map(ann => (annotationQuote(ann) ?? '').trim())
          .filter(s => s.length > 0);
        const suggested = await fetchSuggestCategories(allSentences);
        setCategoryRows(suggested);
        validRows = suggested;
      }

      const categories = validRows.length > 0 ? validRows.map(r => r.name.trim()) : undefined;
      const categoryDescriptions = validRows.length > 0 ? validRows.map(r => r.description.trim()) : undefined;

      const currentCats = categories ?? [];
      const currentDescs = categoryDescriptions ?? [];
      const catsDiffer = highlightedCategories === undefined ||
        highlightedCategories.length !== currentCats.length ||
        highlightedCategories.some((c, i) => c !== currentCats[i]) ||
        (highlightedDescriptions ?? []).length !== currentDescs.length ||
        (highlightedDescriptions ?? []).some((d, i) => d !== currentDescs[i]);
      const isFullRun = catsDiffer || rawSpanMap.size === 0;

      const allCandidates = annotations
        .map(ann => ({ ann, sentence: (annotationQuote(ann) ?? '').trim() }))
        .filter(({ sentence }) => sentence.length > 0);

      const toProcess = isFullRun
        ? allCandidates
        : allCandidates.filter(({ ann }) => !rawSpanMap.has(ann.id));

      if (toProcess.length === 0) return;

      const sentences = toProcess.map(({ sentence }) => sentence);
      const batchSpans = await fetchSpansBatch(sentences, categories, categoryDescriptions);

      const newRawSpanMap = new Map<string, ApiSpan[]>(isFullRun ? [] : rawSpanMap);
      for (let i = 0; i < toProcess.length; i++) {
        newRawSpanMap.set(toProcess[i].ann.id, batchSpans[i] ?? []);
      }

      const index = buildLabelIndex([...newRawSpanMap.values()], categories);
      setRawSpanMap(newRawSpanMap);
      setLabelIndex(index);
      setActiveLabels(new Set(Object.keys(index.labelColors).map(Number)));
      setHighlightedCategories(currentCats);
      setHighlightedDescriptions(currentDescs);

      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          rawSpans: Object.fromEntries(newRawSpanMap),
          categories,
          categoryDescriptions,
        }));
      } catch {}
    } catch (err) {
      setHighlightError(err instanceof Error ? err.message : 'Highlighting failed');
    } finally {
      setIsHighlighting(false);
    }
  };

  const handleGenerateLabels = async () => {
    setIsGeneratingLabels(true);
    setGenerateLabelsError(null);
    try {
      const sentences = annotations
        .map(ann => (annotationQuote(ann) ?? '').trim())
        .filter(s => s.length > 0);
      const suggested = await fetchSuggestCategories(sentences);
      setCategoryRows(prev => [...prev, ...suggested]);
    } catch (err) {
      setGenerateLabelsError(err instanceof Error ? err.message : 'Label generation failed');
    } finally {
      setIsGeneratingLabels(false);
    }
  };

  const hasHighlights = rawSpanMap.size > 0;
  const validCategories = categoryRows.filter(r => r.name.trim().length > 0).map(r => r.name.trim());
  const validDescriptions = categoryRows.filter(r => r.name.trim().length > 0).map(r => r.description.trim());
  const categoriesDiffer = hasHighlights &&
    highlightedCategories !== undefined &&
    (highlightedCategories.length !== validCategories.length ||
     highlightedCategories.some((c, i) => c !== validCategories[i]) ||
     (highlightedDescriptions ?? []).length !== validDescriptions.length ||
     (highlightedDescriptions ?? []).some((d, i) => d !== validDescriptions[i]));
  const legendEntries = Object.entries(labelIndex.labelColors).sort((a, b) => Number(a[0]) - Number(b[0]));
  const allLabelsActive = legendEntries.length > 0 && legendEntries.every(([id]) => activeLabels?.has(Number(id)) ?? true);

  const q = searchText.trim().toLowerCase();
  const visibleAnnotations = q
    ? annotations.filter(ann => (annotationQuote(ann) ?? '').toLowerCase().includes(q))
    : annotations;

  const sortedAnns = [...visibleAnnotations].sort((a, b) => {
    if (searchCategoryIds.length >= 2) {
      return (hasSequence(rawSpanMap.get(a.id) ?? [], searchCategoryIds) ? 0 : 1) -
             (hasSequence(rawSpanMap.get(b.id) ?? [], searchCategoryIds) ? 0 : 1);
    }
    if (alignCategory !== null) {
      return (rawSpanMap.get(a.id)?.some(s => s.label === alignCategory) ? 0 : 1) -
             (rawSpanMap.get(b.id)?.some(s => s.label === alignCategory) ? 0 : 1);
    }
    return 0;
  });

  return (
    <section
      ref={contentRef}
      className="border-b border-grey-3 last:border-b-0"
      data-testid="group-annotations-section"
      data-tag={tag || 'Untagged'}
    >
      {/* Header with expand/collapse */}
      <button
        className="w-full flex items-center justify-between font-bold text-color-text px-2 py-2 bg-grey-1 sticky top-[53px] z-[9]"
        style={{ fontSize: '16px' }}
        onClick={() => setIsExpanded(v => !v)}
      >
        <span>{tag || 'Untagged'}</span>
        <span className="text-color-text-light" style={{ fontSize: '10px' }}>{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-y-3 py-2">
          {/* Controls toggle */}
          <button
            className="text-xs text-left px-2 text-color-text-light hover:text-color-text flex items-center gap-x-1"
            onClick={() => setIsControlsExpanded(v => !v)}
          >
            <span style={{ fontSize: '8px' }}>{isControlsExpanded ? '▲' : '▼'}</span>
            {isControlsExpanded ? 'Hide controls' : 'Show controls'}
          </button>

          {isControlsExpanded && (<div className="flex flex-col gap-y-3">
          {/* Category editor */}
          <div className="flex flex-col gap-y-1 px-2">
            <p className="text-xs font-semibold text-color-text-light uppercase tracking-wide mb-1">
              Sub Tags
            </p>
            {categoryRows.map((row, i) => (
              <div key={i} className="flex gap-x-1 items-center">
                <input
                  type="text"
                  placeholder="Name"
                  value={row.name}
                  onChange={e => updateCategory(i, 'name', (e.target as HTMLInputElement).value)}
                  className="w-24 shrink-0 text-xs px-1.5 py-1 border border-grey-3 rounded bg-white"
                />
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={row.description}
                  onChange={e => updateCategory(i, 'description', (e.target as HTMLInputElement).value)}
                  className="flex-1 min-w-0 text-xs px-1.5 py-1 border border-grey-3 rounded bg-white"
                />
                <button
                  className="shrink-0 text-sm leading-none text-color-text-light hover:text-color-text px-1"
                  onClick={() => removeCategory(i)}
                  title="Remove row"
                >×</button>
              </div>
            ))}
            <div className="flex items-center gap-x-1 mt-0.5">
              <button className="text-xs text-color-text-light hover:text-color-text" onClick={addCategory}>
                + Add Subtag
              </button>
              <span className="text-xs text-color-text-light">|</span>
              <button
                className="text-xs text-color-text-light hover:text-color-text disabled:opacity-50"
                onClick={handleGenerateLabels}
                disabled={isGeneratingLabels}
              >
                {isGeneratingLabels ? 'Suggesting…' : 'Suggest Subtags'}
              </button>
              {generateLabelsError && <span className="text-xs ml-1" style={{ color: '#dc2626' }}>{generateLabelsError}</span>}
            </div>
          </div>
          </div>)} {/* end isControlsExpanded */}

          {/* Highlight toolbar */}
          <div className="flex items-center gap-x-2 px-2">
            <button
              className={`text-xs px-2 py-1 rounded border disabled:opacity-50 ${
                categoriesDiffer
                  ? 'border-yellow-400 bg-yellow-50 text-yellow-800 hover:bg-yellow-100'
                  : 'border-grey-3 bg-white hover:bg-grey-1'
              }`}
              onClick={handleHighlight}
              disabled={isHighlighting}
              title={categoriesDiffer ? 'Categories changed — clicking will re-highlight all annotations' : undefined}
            >
              {isHighlighting ? 'Highlighting…' : categoriesDiffer ? '⚠ Highlight' : 'Highlight'}
            </button>
            <div className="inline-flex rounded border border-grey-3 bg-white p-0.5 text-xs">
              <button
                onClick={() => setRenderMode('underline')}
                className={`px-2 py-0.5 rounded-sm ${renderMode === 'underline' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-color-text-light hover:text-color-text'}`}
              >Underline</button>
              <button
                onClick={() => setRenderMode('highlight')}
                className={`px-2 py-0.5 rounded-sm ${renderMode === 'highlight' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-color-text-light hover:text-color-text'}`}
              >Highlight</button>
            </div>
            {highlightError && <span className="text-xs" style={{ color: '#dc2626' }}>{highlightError}</span>}
          </div>

          {/* Search / align drop zone */}
          <div className="px-2">
            <div
              className="flex flex-wrap items-center gap-1 px-2 py-1 border border-grey-3 rounded bg-white min-h-[28px] cursor-text"
              onDragOver={(e: DragEvent) => { e.preventDefault(); (e as DragEvent).dataTransfer!.dropEffect = 'copy'; }}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                const raw = (e as DragEvent).dataTransfer?.getData('application/x-category-id');
                if (!raw) return;
                const id = Number(raw);
                setSearchCategoryIds(prev => prev.includes(id) ? prev : [...prev, id]);
              }}
            >
              {searchCategoryIds.map((id, idx) => {
                const color = labelIndex.labelColors[id];
                const fullName = labelIndex.labelNames[id] ?? `Label ${id}`;
                const displayName = fullName.length > 20 ? fullName.slice(0, 20) + '…' : fullName;
                return (
                  <div key={idx} className="relative group/searchchip">
                    <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: color, color: 'white' }}>
                      {displayName}
                      <button style={{ lineHeight: 1, opacity: 0.8 }} onClick={() => setSearchCategoryIds(prev => prev.filter((_, i) => i !== idx))}>×</button>
                    </span>
                    {fullName !== displayName && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-gray-800 text-white text-xs whitespace-nowrap opacity-0 group-hover/searchchip:opacity-100 transition-opacity z-50">
                        {fullName}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                      </div>
                    )}
                  </div>
                );
              })}
              <input
                type="text"
                value={searchText}
                onInput={(e: Event) => setSearchText((e.target as HTMLInputElement).value)}
                placeholder={searchCategoryIds.length === 0 ? 'Search or drop a category…' : ''}
                className="flex-1 min-w-[80px] text-xs outline-none bg-transparent text-color-text"
              />
            </div>
          </div>

          {/* Legend */}
          {hasHighlights && legendEntries.length > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-1 px-2 items-center">
              <button
                onClick={() => allLabelsActive ? setActiveLabels(new Set()) : setActiveLabels(new Set(legendEntries.map(([id]) => Number(id))))}
                className="text-xs px-2 py-0.5 rounded border border-grey-3 hover:bg-grey-1 text-color-text-light"
                style={{ backgroundColor: allLabelsActive ? '#ececec' : 'white' }}
              >{allLabelsActive ? 'None' : 'All'}</button>
              {legendEntries.map(([id, color]) => {
                const labelId = Number(id);
                const isActive = activeLabels?.has(labelId) ?? true;
                const fullName = labelIndex.labelNames[labelId] ?? `Label ${labelId}`;
                const displayName = fullName.length > 20 ? fullName.slice(0, 20) + '…' : fullName;
                return (
                  <div key={id} className="relative group/chip">
                    <button
                      draggable
                      onDragStart={(e: DragEvent) => {
                        e.dataTransfer!.setData('application/x-category-id', String(labelId));
                        e.dataTransfer!.effectAllowed = 'copy';
                      }}
                      onClick={() => toggleLabel(labelId)}
                      className="text-xs px-2 py-0.5 rounded border-2 font-medium transition-colors cursor-grab"
                      style={{
                        borderColor: color,
                        backgroundColor: isActive ? color : 'transparent',
                        color: isActive ? 'white' : '#374151',
                      }}
                    >{displayName}</button>
                    {fullName !== displayName && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-gray-800 text-white text-xs whitespace-nowrap opacity-0 group-hover/chip:opacity-100 transition-opacity z-50">
                        {fullName}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Annotations — aligned table or card list */}
          {(alignCategory !== null || q.length > 0) && isFullWidth ? (
            <div ref={alignedScrollRef} style={{ overflowX: 'auto', backgroundColor: 'white' }}>
              <table style={{ tableLayout: 'auto', borderCollapse: 'separate', borderSpacing: 0, backgroundColor: 'white' }}>
                <tbody>
                  {sortedAnns.flatMap(ann => {
                    const excerptText = annotationQuote(ann);
                    if (!excerptText) return [];
                    const rawSpans = rawSpanMap.get(ann.id);
                    const labeledSpans = rawSpans ? toLabeled(rawSpans) : [];
                    let left: { text: string; spans: LabeledSpan[] };
                    let right: { text: string; spans: LabeledSpan[] };
                    if (searchCategoryIds.length >= 2) {
                      const firstCat = rawSpans?.find(s => s.label === searchCategoryIds[0]);
                      const secondCat = rawSpans?.find(s => s.label === searchCategoryIds[1]);
                      ({ left, right } = splitAtTwoOffsets(excerptText, labeledSpans, firstCat?.end ?? 0, secondCat?.start ?? (firstCat?.end ?? 0)));
                    } else if (alignCategory !== null) {
                      const firstAlignSpan = rawSpans?.find(s => s.label === alignCategory);
                      ({ left, right } = splitAtOffset(excerptText, labeledSpans, firstAlignSpan?.start ?? 0));
                    } else {
                      const matchOffset = excerptText.toLowerCase().indexOf(q.toLowerCase());
                      ({ left, right } = splitAtOffset(excerptText, labeledSpans, matchOffset >= 0 ? matchOffset : 0));
                    }
                    return [(
                      <tr key={ann.id} style={{ backgroundColor: 'white', position: 'relative', zIndex: hoveredRowId === ann.id ? 50 : 0 }} onMouseEnter={() => setHoveredRowId(ann.id)} onMouseLeave={() => setHoveredRowId(null)}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 1, backgroundColor: 'white', padding: '4px 6px', whiteSpace: 'nowrap', fontSize: '10px', color: '#9ca3af', minWidth: '60px', maxWidth: '100px' }}>
                          <span title={sourceTooltip(ann)}>{sourceLabel(ann)}</span>
                        </td>
                        <td className="italic text-color-text-light text-xs" style={{ paddingRight: '4px', paddingTop: '4px', paddingBottom: '4px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {left.spans.length > 0 ? (
                            <HighlightedSentence original={left.text} spans={left.spans} labelColors={labelIndex.labelColors} labelNames={labelIndex.labelNames} activeLabels={activeLabels} mode={renderMode} />
                          ) : left.text}
                        </td>
                        <td className="italic text-color-text-light text-xs" style={{ paddingLeft: '4px', paddingTop: '4px', paddingBottom: '4px', whiteSpace: 'nowrap' }}>
                          {right.spans.length > 0 ? (
                            <HighlightedSentence original={right.text} spans={right.spans} labelColors={labelIndex.labelColors} labelNames={labelIndex.labelNames} activeLabels={activeLabels} mode={renderMode} />
                          ) : right.text}
                        </td>
                      </tr>
                    )];
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="flex flex-col gap-y-1 px-2">
              {visibleAnnotations.map(ann => {
                const excerptText = annotationQuote(ann);
                const rawSpans = rawSpanMap.get(ann.id);
                const labeledSpans = rawSpans ? toLabeled(rawSpans) : [];
                return (
                  <li key={ann.id} className="border border-grey-3 rounded p-2 text-sm bg-white">
                    <p className="text-xs text-color-text-light truncate mb-1">{ann.document?.title || ann.uri}</p>
                    {excerptText && (
                      <blockquote className="border-l-2 border-grey-4 pl-2 italic text-color-text-light text-xs mb-1">
                        {labeledSpans.length > 0 ? (
                          <HighlightedSentence original={excerptText} spans={labeledSpans} labelColors={labelIndex.labelColors} labelNames={labelIndex.labelNames} activeLabels={activeLabels} mode={renderMode} />
                        ) : excerptText}
                      </blockquote>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Main tab component ──────────────────────────────────────────────────────

export function GroupAnnotationsTab({ tagInventoryGroupSync }: GroupAnnotationsTabProps) {
  const store = useSidebarStore();
  const focusedGroupId = store.focusedGroupId();
  const isFullWidth = store.isSidebarFullWidth();

  const storeAnnotations = store.savedAnnotations();
  const searchUris = store.searchUris();
  const [fetchedAnnotations, setFetchedAnnotations] = useState<SavedAnnotation[]>([]);
  const annotations: SavedAnnotation[] = focusedGroupId === PUBLIC_GROUP_ID
    ? (savedAnnotationsForCurrentDocument(storeAnnotations, focusedGroupId, searchUris) as SavedAnnotation[])
    : fetchedAnnotations;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');

  useEffect(() => setTagFilter(''), [focusedGroupId]);

  useEffect(() => {
    if (!focusedGroupId || focusedGroupId === PUBLIC_GROUP_ID) return;
    setIsLoading(true);
    setError(null);
    const fetchAnnotations = async () => {
      try {
        const anns = await tagInventoryGroupSync.getGroupAnnotations(focusedGroupId);
        setFetchedAnnotations(anns);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load annotations');
      } finally {
        setIsLoading(false);
      }
    };
    void fetchAnnotations();
  }, [focusedGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className="text-center text-color-text-light p-4">Loading annotations…</p>;
  if (error) return <p className="text-center text-color-text-light p-4">{error}</p>;
  if (annotations.length === 0) return <p className="text-center text-color-text-light p-4">No annotations in this group.</p>;

  const tagMap = new Map<string, SavedAnnotation[]>();
  for (const ann of annotations) {
    const tags = ann.tags.length > 0 ? ann.tags : [''];
    for (const tag of tags) {
      if (isAiSearchSystemTag(tag)) {
        continue;
      }
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(ann);
    }
  }
  const sortedTags = [...tagMap.keys()].filter(t => t !== '' && !t.startsWith('node-link-state')).sort((a, b) => a.localeCompare(b));
  if (tagMap.has('')) sortedTags.push('');
  const normalizedTagFilter = tagFilter.trim().toLocaleLowerCase();
  const filteredTags = normalizedTagFilter
    ? sortedTags.filter(tag =>
        (tag || 'Untagged').toLocaleLowerCase().includes(normalizedTagFilter),
      )
    : sortedTags;
  const tagFilterOptions = sortedTags.map(tag => tag || 'Untagged');

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-grey-3 bg-grey-1 p-2">
        <div className="min-w-0 flex-1">
          <SearchableCombobox
            id="group-annotations-tag-filter"
            ariaLabel="Filter annotation sections by tag"
            options={tagFilterOptions}
            allowCustomValue
            value={tagFilter}
            placeholder="Filter tag sections"
            onChange={setTagFilter}
          />
        </div>
        {tagFilter && (
          <button
            className="rounded px-2 py-1 text-xs font-bold text-grey-6 hover:bg-grey-2 hover:text-color-text focus:outline-none focus:ring-2 focus:ring-brand"
            type="button"
            onClick={() => setTagFilter('')}
          >
            Clear
          </button>
        )}
      </div>
      {filteredTags.length ? (
        filteredTags.map(tag => (
          <GroupSection
            key={`${focusedGroupId}-${tag || '__untagged__'}`}
            tag={tag}
            annotations={tagMap.get(tag)!}
            groupId={focusedGroupId ?? ''}
            isFullWidth={isFullWidth}
          />
        ))
      ) : (
        <p className="p-4 text-center text-sm text-color-text-light">
          No tag sections match this filter.
        </p>
      )}
    </div>
  );
}

export default withServices(GroupAnnotationsTab, ['tagInventoryGroupSync']);
