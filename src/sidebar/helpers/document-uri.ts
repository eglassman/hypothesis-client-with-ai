import type { SavedAnnotation } from '../../types/api';
import type { SidebarStore } from '../store';

/**
 * URI reported by the guest content frame (main or first frame).
 * Used for group API calls that must wait for frame registration.
 */
export function contentFrameUri(
  store: Pick<SidebarStore, 'mainFrame' | 'defaultContentFrame'>,
): string | null {
  return store.mainFrame()?.uri ?? store.defaultContentFrame()?.uri ?? null;
}

function preferredHttpUri(uris: string[]): string | null {
  return (
    uris.find(u => u.startsWith('http://') || u.startsWith('https://')) ??
    uris[0] ??
    null
  );
}

function isPublicHttpUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri) && !uri.includes('chrome-extension');
}

/**
 * Pick an HTTP(S) URL from document aliases that Anthropic can download.
 * Mirrors the pre-refactor `ClaudeService.firstPDFURI` logic.
 */
function downloadableHttpUriFromAliases(uris: readonly string[]): string | null {
  const list = [...uris];
  for (const uri of list) {
    if (isPublicHttpUri(uri) && uri.toLowerCase().endsWith('.pdf')) {
      return uri;
    }
  }
  if (list.some(u => u.startsWith('urn:x-pdf:'))) {
    return preferredHttpUri(list);
  }
  return preferredHttpUri(list);
}

/**
 * Returns an HTTP(S) URL suitable for Claude document-grounded AI search.
 *
 * Hypothesis's canonical `currentDocumentUri` may be a PDF fingerprint URN or
 * extension URL that Anthropic cannot fetch; this helper prefers a public
 * download link from `searchUris()` in that case.
 */
export function claudeAccessibleDocumentUri(
  store: Pick<SidebarStore, 'mainFrame' | 'defaultContentFrame' | 'searchUris'>,
): string | null {
  const frameUri = contentFrameUri(store);
  const aliases = store.searchUris();
  const pdfContext = aliases.some(u => u.startsWith('urn:x-pdf:'));

  if (frameUri && isPublicHttpUri(frameUri)) {
    if (!pdfContext || frameUri.toLowerCase().endsWith('.pdf')) {
      return frameUri;
    }
  }

  return downloadableHttpUriFromAliases(aliases);
}

/** Hosts where Anthropic cannot fetch the PDF without the user's browser session. */
const PAYWALL_PDF_HOSTS =
  /^(dl\.acm\.org|ieeexplore\.ieee\.org|link\.springer\.com|www\.sciencedirect\.com|onlinelibrary\.wiley\.com)$/i;

/**
 * Heuristic: hosts where Anthropic often cannot fetch the PDF URL directly.
 * AI search still tries the URL first and falls back to browser-uploaded bytes.
 */
export function pdfRequiresBrowserPdfUpload(documentUri: string | null): boolean {
  if (!documentUri) {
    return true;
  }
  try {
    return PAYWALL_PDF_HOSTS.test(new URL(documentUri).hostname);
  } catch {
    return true;
  }
}

/**
 * Returns the canonical URI for the current document.
 *
 * Priority:
 *  1. contentFrameUri — mainFrame or defaultContentFrame from the guest.
 *  2. First HTTP(S) URI in searchUris() — for PDFs, searchUris()[0] is the
 *     fingerprint URN (urn:x-pdf:…), so we skip it and take the HTTP link.
 *  3. searchUris()[0] — last-resort fallback (e.g. URN-only documents).
 *  4. null when no frame information is available yet.
 */
export function currentDocumentUri(
  store: Pick<SidebarStore, 'mainFrame' | 'defaultContentFrame' | 'searchUris'>,
): string | null {
  const frameUri = contentFrameUri(store);
  if (frameUri) {
    return frameUri;
  }
  return preferredHttpUri(store.searchUris());
}

/** All URIs Hypothesis associates with the current document. */
export function documentUriAliases(
  store: Pick<SidebarStore, 'searchUris'>,
): readonly string[] {
  return store.searchUris();
}

/**
 * True when `uri` refers to the same document as `canonicalUri`.
 * Strict equality, or both values appear in `aliases` (e.g. URN + HTTPS).
 */
export function documentUriMatches(
  uri: string,
  canonicalUri: string | null | undefined,
  aliases: readonly string[] = [],
): boolean {
  if (!canonicalUri) {
    return false;
  }
  if (uri === canonicalUri) {
    return true;
  }
  if (aliases.length === 0) {
    return false;
  }
  const aliasSet = new Set(aliases);
  return aliasSet.has(uri) && aliasSet.has(canonicalUri);
}

/** Saved annotations on the current document for a group. */
export function filterSavedAnnotationsForDocument(
  annotations: SavedAnnotation[],
  groupId: string,
  aliases: readonly string[],
): SavedAnnotation[] {
  const uriSet = new Set(aliases);
  return annotations.filter(
    ann => ann.group === groupId && uriSet.has(ann.uri),
  );
}

/** True when `uri` refers to the current document alias set. */
function uriBelongsToDocumentAliases(
  uri: string,
  aliases: readonly string[],
): boolean {
  if (aliases.includes(uri)) {
    return true;
  }
  return aliases.some(alias => documentUriMatches(alias, uri, aliases));
}

/**
 * Resolve the document URI used for tag inventory, palette sync, and counts.
 *
 * Uses the guest frame URI only when it belongs to the current `searchUris`
 * alias set. Ignores transient frame URIs from other documents (a common cause
 * of inventory/highlight flicker). Falls back to HTTP-first alias selection.
 */
export function resolveDocumentUriFromCandidates(
  store: Pick<SidebarStore, 'mainFrame' | 'defaultContentFrame' | 'searchUris'>,
  candidateUris?: string[],
): string | null {
  const aliases = candidateUris ?? store.searchUris();
  const frameUri = contentFrameUri(store);
  if (frameUri && uriBelongsToDocumentAliases(frameUri, aliases)) {
    if (isPublicHttpUri(frameUri)) {
      return frameUri;
    }
    return preferredHttpUri(aliases) ?? frameUri;
  }
  return preferredHttpUri(aliases) ?? aliases[0] ?? null;
}
