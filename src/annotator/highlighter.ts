import classnames from 'classnames';

import { highlightTagClass } from '../shared/highlight-tag-class';
import { generateHexString } from '../shared/random';
import type { ShapeAnchor } from '../types/annotator';
import type { HighlightCluster } from '../types/shared';
import { isInPlaceholder } from './anchoring/placeholder';
import { isNodeInRange } from './range-util';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

type HighlightProps = {
  // Associated SVG rect drawn to represent this highlight (in PDFs)
  svgHighlight?: SVGRectElement;
};

export type HighlightElement = HTMLElement & HighlightProps;

export const clusterValues: HighlightCluster[] = [
  'user-annotations',
  'user-highlights',
  'other-content',
];

/**
 * Manages a collection of highlights under a given root element.
 */
export class Highlighter {
  /** The root element within which all highlighted content and highlights live. */
  root: HTMLElement;

  constructor(root: HTMLElement = document.body) {
    this.root = root;
  }

  /**
   * Create highlights for an annotated region defined by a shape.
   */
  highlightShape(region: ShapeAnchor): HighlightElement[] {
    const { shape, anchor } = region;

    const highlightEl = document.createElement('hypothesis-highlight');

    // Should match the width used by the `hypothesis-shape-highlight` class.
    const highlightBorderWidth = 3;
    highlightEl.className = 'hypothesis-shape-highlight';

    // The highlight shape is positioned relative to the anchor element using
    // `calc` so that it stays in the same position if the anchor element is
    // resized, eg. as a result of zooming the page.
    if (shape.type === 'rect') {
      const width = shape.right - shape.left;
      const height = shape.bottom - shape.top;
      highlightEl.style.left = `${shape.left * 100}%`;
      highlightEl.style.top = `${shape.top * 100}%`;
      highlightEl.style.width = `calc(${width * 100}% - ${2 * highlightBorderWidth}px)`;
      highlightEl.style.height = `calc(${height * 100}% - ${2 * highlightBorderWidth}px)`;
    } else if (shape.type === 'point') {
      const radius = 7;
      highlightEl.style.left = `calc(${shape.x * 100}% - ${radius + highlightBorderWidth}px)`;
      highlightEl.style.top = `calc(${shape.y * 100}% - ${radius + highlightBorderWidth}px)`;
      highlightEl.style.width = `${radius * 2}px`;
      highlightEl.style.height = `${radius * 2}px`;
      highlightEl.style.borderRadius = '50%';
    }

    anchor.append(highlightEl);

    return [highlightEl];
  }

  /**
   * Wraps the DOM Nodes within the provided range with a highlight
   * element of the specified class and returns the highlight Elements.
   *
   * @param range - Range to be highlighted
   * @param [cssClass] - CSS class(es) to add to the highlight elements
   * @return Elements wrapping text in `normedRange` to add a highlight effect
   */
  highlightRange(
    range: Range,
    cssClass?: string,
    annotationTags: string[] = [],
  ): HighlightElement[] {
    const textNodes = wholeTextNodesInRange(range);

    // Check if this range refers to a placeholder for not-yet-rendered content in
    // a PDF. These highlights should be invisible.
    const inPlaceholder = textNodes.length > 0 && isInPlaceholder(textNodes[0]);

    // Group text nodes into spans of adjacent nodes. If a group of text nodes are
    // adjacent, we only need to create one highlight element for the group.
    let textNodeSpans: Text[][] = [];
    let prevNode: Node | null = null;
    let currentSpan = null;

    textNodes.forEach(node => {
      if (prevNode && prevNode.nextSibling === node) {
        currentSpan.push(node);
      } else {
        currentSpan = [node];
        textNodeSpans.push(currentSpan);
      }
      prevNode = node;
    });

    // Filter out text node spans that consist only of white space. This avoids
    // inserting highlight elements in places that can only contain a restricted
    // subset of nodes such as table rows and lists.
    const whitespace = /^\s*$/;
    textNodeSpans = textNodeSpans.filter(span => {
      const parentElement = span[0].parentElement;
      return (
        // Whitespace <span>s should be highlighted since they affect layout in
        // some code editors
        (parentElement?.childNodes.length === 1 &&
          parentElement?.tagName === 'SPAN') ||
        // Otherwise ignore white-space only Text node spans
        span.some(node => !whitespace.test(node.data))
      );
    });

    // Wrap each text node span with a `<hypothesis-highlight>` element.
    const highlights: HighlightElement[] = [];
    const tagClasses = annotationTags.map(highlightTagClass);
    textNodeSpans.forEach(nodes => {
      // A custom element name is used here rather than `<span>` to reduce the
      // likelihood of highlights being hidden by page styling.

      const highlightEl = document.createElement('hypothesis-highlight');
      highlightEl.className = classnames(
        'hypothesis-highlight',
        cssClass,
        ...tagClasses,
      );

      const parent = nodes[0].parentNode as ParentNode;
      parent.replaceChild(highlightEl, nodes[0]);
      nodes.forEach(node => highlightEl.appendChild(node));

      highlights.push(highlightEl);
    });

    // For PDF highlights, create the highlight effect by using an SVG placed
    // above the page's canvas rather than CSS `background-color` on the highlight
    // element. This enables more control over blending of the highlight with the
    // content below.
    //
    // Drawing these SVG highlights involves measuring the `<hypothesis-highlight>`
    // elements, so we create them only after those elements have all been created
    // to reduce the number of forced reflows. We also skip creating them for
    // unrendered pages for performance reasons.
    if (!inPlaceholder) {
      drawHighlightsAbovePDFCanvas(highlights, cssClass, tagClasses);
    }

    return highlights;
  }

  /**
   * Remove all highlights under a given root element.
   */
  removeAllHighlights() {
    const highlights = Array.from(
      this.root.querySelectorAll('hypothesis-highlight'),
    );
    this.removeHighlights(highlights as HighlightElement[]);
  }

  /**
   * Remove highlights from a range previously highlighted with `highlightRange`.
   */
  removeHighlights(highlights: HighlightElement[]) {
    // Explicitly un-focus highlights to be removed. This ensures associated
    // focused elements are removed from the document.
    setHighlightsFocused(highlights, false);
    for (const h of highlights) {
      if (h.parentNode) {
        const children = Array.from(h.childNodes);
        replaceWith(h, children);
      }
      if (h.svgHighlight) {
        removeAssociatedSVGHighlights(h.svgHighlight);
      }
    }
  }

  /**
   * Set whether the given highlight elements should appear "focused".
   *
   * A highlight can be displayed in a different ("focused") style to indicate
   * that it is current in some other context - for example the user has selected
   * the corresponding annotation in the sidebar.
   */
  setHighlightsFocused(highlights: HighlightElement[], focused: boolean) {
    highlights.forEach(h => {
      // In PDFs the visible highlight is created by an SVG element, so the focused
      // effect is applied to that. In other documents the effect is applied to the
      // `<hypothesis-highlight>` element.
      if (h.svgHighlight) {
        setSVGHighlightFocused(h.svgHighlight, focused);
      } else {
        h.classList.toggle('hypothesis-highlight-focused', focused);
      }
    });
  }

  /**
   * Set whether highlights under the given root element should be visible.
   */
  setHighlightsVisible(visible: boolean) {
    this.root.classList.toggle(showHighlightsClass, visible);
  }

  /**
   * Get the visible highlight elements at the given client coordinates.
   */
  getHighlightsFromPoint(x: number, y: number): HighlightElement[] {
    return getHighlightsFromPoint(x, y);
  }
}

/**
 * Return the canvas element underneath a highlight element in a PDF page's
 * text layer.
 *
 * Returns `null` if the highlight is not above a PDF canvas.
 */
function getPDFCanvas(highlightEl: HighlightElement): HTMLCanvasElement | null {
  // This code assumes that PDF.js renders pages with a structure like:
  //
  // <div class="page">
  //   <div class="canvasWrapper">
  //     <canvas></canvas> <!-- The rendered PDF page -->
  //   </div>
  //   <div class="textLayer">
  //      <!-- Transparent text layer with text spans used to enable text selection -->
  //   </div>
  // </div>
  //
  // It also assumes that the `highlightEl` element is somewhere under
  // the `.textLayer` div.

  const pageEl = highlightEl.closest('.page');
  if (!pageEl) {
    return null;
  }

  const canvasEl = pageEl.querySelector('.canvasWrapper > canvas');
  if (!canvasEl) {
    return null;
  }

  return canvasEl as HTMLCanvasElement;
}

/**
 * Draw highlights in an SVG layer overlaid on top of a PDF.js canvas.
 *
 * The created SVG elements are stored in the `svgHighlight` property of
 * each `HighlightElement`.
 *
 * @param highlightEls -
 *   An element that wraps the highlighted text in the transparent text layer
 *   above the PDF.
 * @param [cssClass] - CSS class(es) to add to the SVG highlight elements
 */
function drawHighlightsAbovePDFCanvas(
  highlightEls: HighlightElement[],
  cssClass?: string,
  tagClasses: string[] = [],
) {
  if (highlightEls.length === 0) {
    return;
  }

  // Get the <canvas> for the PDF page containing the highlight. We assume all
  // the highlights are on the same page.
  const canvasEl = getPDFCanvas(highlightEls[0]);
  if (!canvasEl || !canvasEl.parentElement) {
    return;
  }

  const canvasParent = canvasEl.parentElement;
  let svgHighlightLayer =
    (canvasParent.querySelector(
      '.hypothesis-highlight-layer',
    ) as SVGSVGElement | null) ??
    (canvasParent.querySelector(
      '.hypothesis-tag-highlight-layer',
    ) as SVGSVGElement | null);

  if (!svgHighlightLayer) {
    svgHighlightLayer = document.createElementNS(SVG_NAMESPACE, 'svg');
    svgHighlightLayer.setAttribute('class', 'hypothesis-highlight-layer');
    canvasParent.appendChild(svgHighlightLayer);

    canvasParent.style.position = 'relative';

    const svgStyle = svgHighlightLayer.style;
    svgStyle.position = 'absolute';
    svgStyle.left = '0';
    svgStyle.top = '0';
    svgStyle.width = '100%';
    svgStyle.height = '100%';
  }

  // Standard alpha compositing is stable when differently-colored translucent
  // highlights overlap. `multiply` causes compositor flicker in those regions.
  svgHighlightLayer.style.mixBlendMode = 'normal';

  const canvasRect = canvasEl.getBoundingClientRect();
  const highlightRects = highlightEls.map(highlightEl => {
    const highlightRect = highlightEl.getBoundingClientRect();

    // Create SVG element for the current highlight element.
    const rect = document.createElementNS(SVG_NAMESPACE, 'rect');

    const x = (highlightRect.left - canvasRect.left) / canvasRect.width;
    const y = (highlightRect.top - canvasRect.top) / canvasRect.height;
    const width = highlightRect.width / canvasRect.width;
    const height = highlightRect.height / canvasRect.height;

    rect.setAttribute('x', `${x * 100}%`);
    rect.setAttribute('y', `${y * 100}%`);
    rect.setAttribute('width', `${width * 100}%`);
    rect.setAttribute('height', `${height * 100}%`);
    const highlightID = generateHexString(8);
    // TODO: Consider always rendering tag overlays (even for a single tag) so
    // PDF highlighting uses one unified overlay path instead of branching
    // between legacy single-tag and multi-tag behavior.
    // TODO: If overlay colors are temporarily unavailable, consider keeping the
    // base rect visible for multi-tag highlights until overlay colors are ready.
    const hasTagOverlays = tagClasses.length > 1;
    rect.setAttribute(
      'class',
      classnames(
        'hypothesis-svg-highlight',
        cssClass,
        ...(!hasTagOverlays ? tagClasses : []),
      ),
    );
    rect.setAttribute('data-highlight-id', highlightID);
    if (hasTagOverlays) {
      rect.setAttribute('data-has-tag-overlays', 'data-has-tag-overlays');
    }

    // Make the highlight in the text layer transparent.
    highlightEl.classList.add('is-transparent');

    // Associate SVG element with highlight for use by `removeHighlights`.
    highlightEl.svgHighlight = rect;

    const overlays = hasTagOverlays
      ? tagClasses.map(tagClass => {
          const overlayRect = rect.cloneNode() as SVGRectElement;
          overlayRect.setAttribute(
            'class',
            classnames('hypothesis-svg-highlight-overlay', tagClass),
          );
          return overlayRect;
        })
      : [];

    return [rect, ...overlays];
  });

  svgHighlightLayer.append(...highlightRects.flat());
}

/**
 * Return text nodes which are entirely inside `range`.
 *
 * If a range starts or ends part-way through a text node, the node is split
 * and the part inside the range is returned.
 */
function wholeTextNodesInRange(range: Range): Text[] {
  if (range.collapsed) {
    // Exit early for an empty range to avoid an edge case that breaks the algorithm
    // below. Splitting a text node at the start of an empty range can leave the
    // range ending in the left part rather than the right part.
    return [];
  }

  let root = range.commonAncestorContainer as Node | null;
  if (root && root.nodeType !== Node.ELEMENT_NODE) {
    // If the common ancestor is not an element, set it to the parent element to
    // ensure that the loop below visits any text nodes generated by splitting
    // the common ancestor.
    //
    // Note that `parentElement` may be `null`.
    root = root.parentElement;
  }
  if (!root) {
    // If there is no root element then we won't be able to insert highlights,
    // so exit here.
    return [];
  }

  const textNodes = [];
  const nodeIter = root!.ownerDocument!.createNodeIterator(
    root,
    NodeFilter.SHOW_TEXT, // Only return `Text` nodes.
  );
  let node;
  while ((node = nodeIter.nextNode())) {
    if (!isNodeInRange(range, node)) {
      continue;
    }
    const text = node as Text;

    if (text === range.startContainer && range.startOffset > 0) {
      // Split `text` where the range starts. The split will create a new `Text`
      // node which will be in the range and will be visited in the next loop iteration.
      text.splitText(range.startOffset);
      continue;
    }

    if (text === range.endContainer && range.endOffset < text.data.length) {
      // Split `text` where the range ends, leaving it as the part in the range.
      text.splitText(range.endOffset);
    }

    textNodes.push(text);
  }

  return textNodes;
}

/**
 * Replace a child `node` with `replacements`.
 *
 * nb. This is like `ChildNode.replaceWith` but it works in older browsers.
 */
function replaceWith(node: ChildNode, replacements: Node[]) {
  const parent = node.parentNode as ParentNode;
  replacements.forEach(r => parent.insertBefore(r, node));
  node.remove();
}

/**
 * Focus or un-focus an individual SVG highlight element.
 *
 * Focus styling is applied in-place via `data-is-focused` so SVG stacking
 * order stays stable. Visual emphasis uses CSS stroke (not fill) so overlap
 * regions do not flicker.
 */
function setSVGHighlightFocused(svgEl: SVGElement, focused: boolean) {
  const parent = svgEl.parentNode as SVGElement;
  const focusedId = svgEl.getAttribute('data-focused-id');

  const isFocused = Boolean(focusedId);
  if (isFocused === focused) {
    return;
  }

  if (focused) {
    const focusedID = generateHexString(8);
    const associatedHighlights = associatedSVGHighlights(svgEl);
    const sourceHighlights = associatedHighlights.filter(
      el => !el.classList.contains('hypothesis-svg-highlight-focus-tint'),
    );

    sourceHighlights.forEach(source => {
      source.setAttribute('data-focused-id', focusedID);
      source.setAttribute('data-is-focused', 'data-is-focused');
    });
  } else {
    if (!focusedId) {
      return;
    }
    parent.querySelectorAll(`[data-focused-id="${focusedId}"]`).forEach(el => {
      if (el.classList.contains('hypothesis-svg-highlight-focus-tint')) {
        el.remove();
      } else {
        el.removeAttribute('data-is-focused');
        el.removeAttribute('data-focused-id');
      }
    });
  }
}

function highlightID(svgEl: SVGElement): string | null {
  return svgEl.getAttribute('data-highlight-id');
}

function associatedSVGHighlights(svgEl: SVGElement): SVGElement[] {
  const id = highlightID(svgEl);
  if (!id) {
    return [svgEl];
  }
  return Array.from(
    (svgEl.parentNode as Element).querySelectorAll(
      `[data-highlight-id="${id}"]`,
    ),
  ) as SVGElement[];
}

function removeAssociatedSVGHighlights(svgEl: SVGElement) {
  associatedSVGHighlights(svgEl).forEach(highlight => highlight.remove());
}

function setHighlightsFocused(
  highlights: HighlightElement[],
  focused: boolean,
) {
  highlights.forEach(h => {
    if (h.svgHighlight) {
      setSVGHighlightFocused(h.svgHighlight, focused);
    } else {
      h.classList.toggle('hypothesis-highlight-focused', focused);
    }
  });
}

/**
 * Show or hide highlights (e.g. when a tag inventory row is hidden).
 *
 * On PDFs the visible fill is drawn in SVG, so `h-row-hidden` must be applied
 * to associated SVG elements as well as the text-layer wrappers.
 */
export function setHighlightsHidden(
  highlights: HighlightElement[],
  hidden: boolean,
) {
  for (const h of highlights) {
    h.classList.toggle('h-row-hidden', hidden);
    if (h.svgHighlight) {
      for (const svgEl of associatedSVGHighlights(h.svgHighlight)) {
        svgEl.classList.toggle('h-row-hidden', hidden);
      }
    }
  }
}

/** Class set on root element to make highlights visible. */
const showHighlightsClass = 'hypothesis-highlights-always-on';

/**
 * Get the visible highlight elements at the given client coordinates.
 */
export function getHighlightsFromPoint(
  x: number,
  y: number,
): HighlightElement[] {
  const showHighlightsSelector = `.${showHighlightsClass}`;

  // Text highlights can be found via `elementsFromPoint`.
  const textHighlights = document
    .elementsFromPoint(x, y)
    .filter(
      el =>
        el.localName === 'hypothesis-highlight' &&
        el.closest(showHighlightsSelector),
    ) as HighlightElement[];

  // Shape highlights have `pointer-events: none` so users can interact with
  // the content underneath. This makes them invisible to `elementsFromPoint`.
  // To handle this test each shape highlight individually.
  const shapeHighlights = [];
  for (const highlight of document.querySelectorAll(
    'hypothesis-highlight.hypothesis-shape-highlight',
  )) {
    if (!highlight.closest(showHighlightsSelector)) {
      continue;
    }

    // Approximate the shape by its bounding rect. This works for the shapes we
    // currently support, but won't work for more complex shapes (eg.
    // arbitrary polygons) that we might introduce in future.
    const rect = highlight.getBoundingClientRect();
    if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
      shapeHighlights.push(highlight as HighlightElement);
    }
  }

  // In PDFs, visible highlight color may be rendered by SVG <rect> overlays.
  // Those can be missed by `elementsFromPoint`, so include highlights whose
  // associated SVG rect(s) contain the point.
  const svgHighlights = Array.from(
    document.querySelectorAll('hypothesis-highlight'),
  )
    .filter(
      highlight =>
        highlight.closest(showHighlightsSelector) &&
        (highlight as HighlightElement).svgHighlight,
    )
    .filter(highlight => {
      const svgHighlight = (highlight as HighlightElement).svgHighlight;
      return (
        svgHighlight &&
        associatedSVGHighlights(svgHighlight).some(svgRect => {
          const rect = svgRect.getBoundingClientRect();
          return (
            x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
          );
        })
      );
    }) as HighlightElement[];

  return Array.from(
    new Set([...textHighlights, ...shapeHighlights, ...svgHighlights]),
  );
}

// Subset of `DOMRect` interface
type Rect = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

/**
 * Get the bounding client rectangle of a collection in viewport coordinates.
 * Unfortunately, Chrome has issues ([1]) with Range.getBoundingClient rect or we
 * could just use that.
 *
 * [1] https://bugs.chromium.org/p/chromium/issues/detail?id=324437
 */
export function getBoundingClientRect(collection: HTMLElement[]): Rect {
  // Reduce the client rectangles of the highlights to a bounding box
  const rects = collection.map(n => n.getBoundingClientRect() as Rect);
  return rects.reduce((acc, r) => ({
    top: Math.min(acc.top, r.top),
    left: Math.min(acc.left, r.left),
    bottom: Math.max(acc.bottom, r.bottom),
    right: Math.max(acc.right, r.right),
  }));
}

/**
 * Add metadata and manipulate ordering of all highlights in `element` to
 * allow styling of nested, clustered highlights.
 */
export function updateClusters(element: Element) {
  setNestingData(getHighlights(element));
  updateSVGHighlightOrdering(element);
}

/**
 * Is `el` a highlight element? Work around inconsistency between HTML documents
 * (`tagName` is upper-case) and XHTML documents (`tagName` is lower-case)
 */
const isHighlightElement = (el: Element): boolean =>
  el.tagName.toLowerCase() === 'hypothesis-highlight';

/**
 * Return the closest generation of HighlightElements to `element`.
 *
 * If `element` is itself a HighlightElement, return immediate children that
 * are also HighlightElements.
 *
 * Otherwise, return all HighlightElements that have no parent HighlightElement,
 * i.e. the outermost highlights within `element`.
 */
function getHighlights(element: Element) {
  let highlights;
  if (isHighlightElement(element)) {
    highlights = Array.from(element.children).filter(isHighlightElement);
  } else {
    highlights = Array.from(
      element.getElementsByTagName('hypothesis-highlight'),
    ).filter(
      highlight =>
        !highlight.parentElement ||
        !isHighlightElement(highlight.parentElement),
    );
  }
  return highlights as HighlightElement[];
}

/**
 * Get all of the SVG highlights within `root`, grouped by layer. A PDF
 * document may have multiple layers of SVG highlights, typically one per page.
 *
 * @return a Map of layer Elements to all SVG highlights within that
 *   layer Element
 */
function getSVGHighlights(root?: Element): Map<Element, HighlightElement[]> {
  const svgHighlights: Map<Element, HighlightElement[]> = new Map();

  for (const layerClass of [
    'hypothesis-highlight-layer',
    'hypothesis-tag-highlight-layer',
  ]) {
    for (const layer of (root ?? document).getElementsByClassName(layerClass)) {
      svgHighlights.set(
        layer,
        Array.from(
          layer.querySelectorAll('.hypothesis-svg-highlight'),
        ) as HighlightElement[],
      );
    }
  }

  return svgHighlights;
}

/**
 * Walk a tree of <hypothesis-highlight> elements, adding `data-nesting-level`
 * and `data-cluster-level` data attributes to <hypothesis-highlight>s and
 * their associated SVG highlight (<rect>) elements.
 *
 * - `data-nesting-level` - generational depth of the applicable
 *   `<hypothesis-highlight>` relative to outermost `<hypothesis-highlight>`.
 * - `data-cluster-level` - number of `<hypothesis-highlight>` generations
 *   since the cluster value changed.
 *
 * @param highlightEls - A collection of sibling <hypothesis-highlight>
 * elements
 * @param parentCluster - The cluster value of the parent highlight to
 * `highlightEls`, if any
 * @param nestingLevel - The nesting "level", relative to the outermost
 * <hypothesis-highlight> element (0-based)
 * @param parentClusterLevel - The parent's nesting depth, per its cluster
 * value (`parentCluster`). i.e. How many levels since the cluster value
 * changed? This allows for nested styling of highlights of the same cluster
 * value.
 */
function setNestingData(
  highlightEls: HighlightElement[],
  parentCluster = '',
  nestingLevel = 0,
  parentClusterLevel = 0,
) {
  for (const hEl of highlightEls) {
    const elCluster =
      clusterValues.find(cv => hEl.classList.contains(cv)) ?? 'other-content';

    const elClusterLevel =
      parentCluster && elCluster === parentCluster ? parentClusterLevel + 1 : 0;

    hEl.setAttribute('data-nesting-level', `${nestingLevel}`);
    hEl.setAttribute('data-cluster-level', `${elClusterLevel}`);

    if (hEl.svgHighlight) {
      hEl.svgHighlight.setAttribute('data-nesting-level', `${nestingLevel}`);
      hEl.svgHighlight.setAttribute('data-cluster-level', `${elClusterLevel}`);
    }

    setNestingData(
      getHighlights(hEl),
      elCluster /* parentCluster */,
      nestingLevel + 1 /* nestingLevel */,
      elClusterLevel /* parentClusterLevel */,
    );
  }
}

/**
 * Get the highlight nesting level of `el`. This is typically set with the
 * `data-nesting-level` attribute on highlight elements. Focused SVG highlight
 * elements should always have the highest nesting level — they should always
 * come last when sorted, so as not to be obscured by any other highlights.
 * These elements are indicated by the presence of the `data-is-focused`
 * attribute.
 */
function nestingLevel(el: Element): number {
  if (el.getAttribute('data-is-focused')) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parseInt(el.getAttribute('data-nesting-level') ?? '0', 10);
}

/**
 * Ensure that SVG <rect> elements are ordered correctly: inner (nested)
 * highlights should be visible on top of outer highlights.
 *
 * All SVG <rect>s drawn for a PDF page are siblings. To ensure that the
 * <rect>s associated with outer highlights don't show up on top of (and thus
 * obscure) nested highlights, order the <rects> by their `data-nesting-level`
 * value if they are not already.
 */
function updateSVGHighlightOrdering(element: Element) {
  for (const [layer, layerHighlights] of getSVGHighlights(element)) {
    const correctlyOrdered = layerHighlights.every((svgEl, idx, allEls) => {
      if (idx === 0) {
        return true;
      }
      return nestingLevel(svgEl) >= nestingLevel(allEls[idx - 1]);
    });

    if (!correctlyOrdered) {
      layerHighlights.sort((a, b) => nestingLevel(a) - nestingLevel(b));
      layer.replaceChildren(...layerHighlights);
    }
  }
}
