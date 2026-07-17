import { extractHtmlDocumentText } from '../html-document-text';

describe('extractHtmlDocumentText', () => {
  it('returns the full container text', () => {
    const root = document.createElement('div');
    const nav = document.createElement('nav');
    nav.textContent = 'Menu';
    const article = document.createElement('article');
    article.textContent = 'Article body';
    root.appendChild(nav);
    root.appendChild(article);

    const text = extractHtmlDocumentText(root);
    assert.include(text, 'Menu');
    assert.include(text, 'Article body');
  });

  it('throws when there is no text', () => {
    const root = document.createElement('div');
    assert.throws(
      () => extractHtmlDocumentText(root),
      /No document text available/,
    );
  });
});
