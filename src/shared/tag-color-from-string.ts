/** Alpha used for AI / schema tag highlights (matches `INITIAL_AI_TAG_HIGHLIGHT_PALETTE`). */
export const TAG_HIGHLIGHT_ALPHA = 0.38;

function hashStringFNV1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * HSL (h,s,l) all in [0,1]. Returns sRGB 0–255 per channel.
 */
function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  };
}

/**
 * Deterministic highlight color from an arbitrary string (e.g. schema tag).
 */
export function highlightRgbaFromString(s: string): string {
  const t = s.trim();
  if (!t) {
    return `rgba(128, 128, 128, ${TAG_HIGHLIGHT_ALPHA})`;
  }
  const hue = (hashStringFNV1a(t) % 360) / 360;
  const { r, g, b } = hslToRgb(hue, 0.55, 0.62);
  return `rgba(${r}, ${g}, ${b}, ${TAG_HIGHLIGHT_ALPHA})`;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Parse `rgba(r,g,b,a)` or `rgb(r,g,b)` and return `#rrggbb` for `<input type="color">`.
 */
export function rgbaStringToHexColorInput(rgba: string): string {
  const m = rgba.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (!m) {
    return '#808080';
  }
  const r = clampByte(parseInt(m[1], 10));
  const g = clampByte(parseInt(m[2], 10));
  const b = clampByte(parseInt(m[3], 10));
  const toHex = (x: number) => x.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * `#rgb` or `#rrggbb` to rgba with the given alpha (for tag highlight palette).
 */
export function hexColorInputToRgba(hex: string, alpha: number): string {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map(c => c + c)
      .join('');
  }
  if (h.length !== 6) {
    return `rgba(128, 128, 128, ${alpha})`;
  }
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) {
    return `rgba(128, 128, 128, ${alpha})`;
  }
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
