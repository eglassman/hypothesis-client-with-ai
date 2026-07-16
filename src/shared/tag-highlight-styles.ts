import { highlightTagClass } from './highlight-tag-class';

/**
 * Injected `<style>` for tag-based highlight colors (HTML + PDF SVG).
 *
 * Call {@link applyTagHighlightPalette} with the full map whenever it changes.
 */

const STYLE_ID = 'hypothesis-dynamic-tag-highlight-rules';

/**
 * Portion of `--highlight-color` mixed with black for `--highlight-color-focused`
 * (darker when selected / easier to see on light PDFs). Higher → closer to base;
 * lower → more black. ~70–82 is typical.
 * Uses CSS `color-mix()` (no JS color parsing). Requires modern browsers.
 */
const FOCUS_COLOR_MIX_PERCENT = 78;

/**
 * Replaces the injected stylesheet from this map only. Tags omitted from the map
 * are not overridden (cluster defaults from `highlights.scss` apply), as long as
 * you don’t add empty rules—here we only emit rules for each palette entry.
 */
export function applyTagHighlightPalette(
  targetDocument: Document,
  palette: Record<string, string>,
): void {
  let style = targetDocument.getElementById(
    STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!style) {
    style = targetDocument.createElement('style');
    style.id = STYLE_ID;
    targetDocument.head.appendChild(style);
  }

  const lines: string[] = [
    `.hypothesis-highlights-always-on .hypothesis-highlight.h-row-hidden,` +
      ` .hypothesis-highlights-always-on .hypothesis-svg-highlight.h-row-hidden,` +
      ` .hypothesis-highlights-always-on .hypothesis-svg-highlight-overlay.h-row-hidden` +
      ` { opacity: 0 !important; pointer-events: none !important; }`,
  ];
  for (const [rawTag, rgba] of Object.entries(palette).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const tag = rawTag.trim();
    if (!tag || !rgba?.trim()) {
      continue;
    }
    const cls = highlightTagClass(tag);
    const legacySelector = [
      `.hypothesis-highlights-always-on .hypothesis-highlight.${cls}`,
      `.hypothesis-highlights-always-on .hypothesis-svg-highlight.${cls}`,
    ].join(', ');
    const base = rgba.trim();
    lines.push(
      `${legacySelector} { --highlight-color: ${base}; --highlight-color-focused: color-mix(in srgb, var(--highlight-color) ${FOCUS_COLOR_MIX_PERCENT}%, black); }`,
    );
    lines.push(
      `.hypothesis-highlights-always-on .hypothesis-svg-highlight-overlay.${cls} { --highlight-overlay-color: ${base}; fill: var(--highlight-overlay-color); }`,
    );
  }
  const css = lines.join('\n');
  if (style.textContent === css) {
    return;
  }
  style.textContent = css;
}
