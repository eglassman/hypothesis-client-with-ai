import { useMemo } from 'preact/hooks';

export type RenderMode = 'underline' | 'highlight';

export interface LabeledSpan {
  text: string;
  label: number;
  start: number;
  end: number;
}

interface HighlightedSentenceProps {
  original: string;
  spans: LabeledSpan[];
  labelColors: Record<number, string>;
  labelNames: Record<number, string>;
  activeLabels?: Set<number>;
  mode?: RenderMode;
}

const SPACING = 7;
const LINE_THICKNESS = 2.5;
const HIGHLIGHT_ALPHA = '40';

interface SpanInfo {
  label: number;
  layer: number;
}

interface CharEntry {
  char: string;
  infos: SpanInfo[];
}

interface Run {
  text: string;
  infos: SpanInfo[];
}

interface WordToken {
  text: string;
  start: number;
  end: number;
  isWhitespace: boolean;
}

function mergeRegions(regions: { start: number; end: number }[]) {
  if (regions.length <= 1) return;
  regions.sort((a, b) => a.start - b.start);
  let w = 0;
  for (let r = 1; r < regions.length; r++) {
    if (regions[r].start <= regions[w].end) {
      regions[w].end = Math.max(regions[w].end, regions[r].end);
    } else {
      w++;
      regions[w] = regions[r];
    }
  }
  regions.length = w + 1;
}

function groupIntoRuns(entries: CharEntry[]): Run[] {
  if (entries.length === 0) return [];
  const same = (a: SpanInfo[], b: SpanInfo[]) =>
    a.length === b.length &&
    a.every((si, idx) => si.label === b[idx].label && si.layer === b[idx].layer);
  const runs: Run[] = [];
  let text = entries[0].char;
  let infos = entries[0].infos;
  for (let i = 1; i < entries.length; i++) {
    if (same(entries[i].infos, infos)) {
      text += entries[i].char;
    } else {
      runs.push({ text, infos });
      text = entries[i].char;
      infos = entries[i].infos;
    }
  }
  runs.push({ text, infos });
  return runs;
}

function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const regex = /(\S+|\s+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      isWhitespace: /^\s+$/.test(match[0]),
    });
  }
  return tokens;
}

function countLabelsForWord(
  wordStart: number,
  wordEnd: number,
  spans: LabeledSpan[],
  activeLabels?: Set<number>,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const span of spans) {
    if (span.label === -1) continue;
    if (activeLabels && !activeLabels.has(span.label)) continue;
    if (span.start < wordEnd && span.end > wordStart) {
      counts.set(span.label, (counts.get(span.label) || 0) + 1);
    }
  }
  return counts;
}

function topNLabels(counts: Map<number, number>, n: number): number[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label]) => label);
}

function mergeHighlightTokens(
  tokens: { text: string; topLabels: number[] }[],
): { text: string; topLabels: number[] }[] {
  if (tokens.length === 0) return [];
  const sameLabels = (a: number[], b: number[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const merged: { text: string; topLabels: number[] }[] = [
    { text: tokens[0].text, topLabels: tokens[0].topLabels },
  ];
  for (let i = 1; i < tokens.length; i++) {
    const last = merged[merged.length - 1];
    if (sameLabels(tokens[i].topLabels, last.topLabels)) {
      last.text += tokens[i].text;
    } else {
      merged.push({ text: tokens[i].text, topLabels: tokens[i].topLabels });
    }
  }
  return merged;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function HighlightedSentence({
  original,
  spans,
  labelColors,
  labelNames,
  activeLabels,
  mode = 'underline',
}: HighlightedSentenceProps) {
  const { runs, layerCount } = useMemo(() => {
    if (mode !== 'underline' || !spans.length) return { runs: [], layerCount: 0 };

    const labeled = spans.filter(
      s => s.label !== -1 && (!activeLabels || activeLabels.has(s.label)),
    );

    const regionsByLabel = new Map<number, { start: number; end: number }[]>();
    for (const span of labeled) {
      if (!regionsByLabel.has(span.label)) regionsByLabel.set(span.label, []);
      regionsByLabel.get(span.label)!.push({ start: span.start, end: span.end });
    }
    for (const [, regions] of regionsByLabel) mergeRegions(regions);

    const labelMaxLen = Array.from(regionsByLabel.entries()).map(
      ([label, regions]) => ({
        label,
        maxLen: Math.max(...regions.map(r => r.end - r.start)),
      }),
    );
    labelMaxLen.sort((a, b) => a.maxLen - b.maxLen);

    const labelLayer = new Map<number, number>();
    labelMaxLen.forEach(({ label }, idx) => labelLayer.set(label, idx));
    const lc = labelMaxLen.length;

    const entries: CharEntry[] = Array.from(original, char => ({ char, infos: [] }));
    for (const [label, regions] of regionsByLabel) {
      const layer = labelLayer.get(label) ?? 0;
      for (const region of regions) {
        for (let i = region.start; i < region.end && i < original.length; i++) {
          if (!entries[i].infos.find(si => si.label === label)) {
            entries[i].infos.push({ label, layer });
          }
        }
      }
    }
    for (const entry of entries) entry.infos.sort((a, b) => a.layer - b.layer);

    return { runs: groupIntoRuns(entries), layerCount: lc };
  }, [original, spans, activeLabels, mode]);

  const highlightTokens = useMemo(() => {
    if (mode !== 'highlight' || !spans.length) return [];

    const tokens = tokenize(original);
    const result = tokens.map(token => {
      if (token.isWhitespace) {
        return { text: token.text, topLabels: [] as number[], isWhitespace: true };
      }
      const counts = countLabelsForWord(token.start, token.end, spans, activeLabels);
      return { text: token.text, topLabels: topNLabels(counts, 2), isWhitespace: false };
    });

    let lastLabels: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i].isWhitespace) {
        result[i].topLabels = lastLabels;
      } else {
        lastLabels = result[i].topLabels;
      }
    }

    return mergeHighlightTokens(result);
  }, [original, spans, activeLabels, mode]);

  const tooltip = (names: string, count?: number) => (
    <span
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: '4px',
        padding: '2px 8px',
        fontSize: '11px',
        color: 'white',
        backgroundColor: '#111827',
        borderRadius: '4px',
        opacity: 0,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 10,
      }}
      className="group-hover:opacity-100"
    >
      {names}
      {count && count > 1 && <span style={{ opacity: 0.75 }}> ({count} labels)</span>}
    </span>
  );

  if (mode === 'underline') {
    const basePadding = layerCount > 0 ? (layerCount + 1) * SPACING : 0;
    return (
      <span style={basePadding > 0 ? { lineHeight: `calc(1.6em + ${basePadding}px)` } : undefined}>
        {runs.map((run, i) => {
          if (run.infos.length === 0) {
            return (
              <span key={i} style={basePadding > 0 ? { paddingBottom: `${basePadding}px` } : undefined}>
                {run.text}
              </span>
            );
          }
          const allLabelNames = run.infos
            .map(si => labelNames[si.label] ?? `Label ${si.label}`)
            .join(', ');
          const gradients: string[] = [];
          const sizes: string[] = [];
          const positions: string[] = [];
          for (const si of run.infos) {
            const color = labelColors[si.label];
            if (!color) continue;
            gradients.push(`linear-gradient(${color}, ${color})`);
            sizes.push(`100% ${LINE_THICKNESS}px`);
            const fromBottom = (layerCount - si.layer) * SPACING;
            positions.push(`0 calc(100% - ${fromBottom}px)`);
          }
          return (
            <span
              key={i}
              className="relative group"
              style={{
                paddingBottom: `${basePadding}px`,
                backgroundImage: gradients.join(', ') || undefined,
                backgroundSize: sizes.join(', ') || undefined,
                backgroundPosition: positions.join(', ') || undefined,
                backgroundRepeat: 'no-repeat',
              }}
            >
              {run.text}
              {tooltip(allLabelNames, run.infos.length)}
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <span>
      {highlightTokens.map((token, i) => {
        if (token.topLabels.length === 0) {
          return <span key={i}>{token.text}</span>;
        }
        const names = token.topLabels.map(l => labelNames[l] ?? `Label ${l}`).join(', ');
        if (token.topLabels.length === 1) {
          const color = labelColors[token.topLabels[0]];
          return (
            <span
              key={i}
              className="relative group"
              style={{
                backgroundColor: color ? `${color}${HIGHLIGHT_ALPHA}` : undefined,
                borderRadius: '2px',
              }}
            >
              {token.text}
              {tooltip(names)}
            </span>
          );
        }
        const color1 = labelColors[token.topLabels[0]];
        const color2 = labelColors[token.topLabels[1]];
        const rgba1 = color1 ? hexToRgba(color1, 0.3) : 'transparent';
        const rgba2 = color2 ? hexToRgba(color2, 0.3) : 'transparent';
        return (
          <span
            key={i}
            className="relative group"
            style={{
              backgroundImage: `linear-gradient(to bottom, ${rgba1} 50%, ${rgba2} 50%)`,
              borderRadius: '2px',
            }}
          >
            {token.text}
            {tooltip(names)}
          </span>
        );
      })}
    </span>
  );
}
