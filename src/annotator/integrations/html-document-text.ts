/**
 * Extract text to send to Claude for an HTML page.
 *
 * Uses the full content container (`innerText`) so nothing outside an
 * `<article>` / `main` region is dropped.
 */
export function extractHtmlDocumentText(root: HTMLElement): string {
  const text = (root.innerText ?? '').trim();

  if (!text) {
    throw new Error('No document text available in page');
  }

  return text;
}
