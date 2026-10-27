'use strict';

// Reader mode deliberately keeps text only. No image, script, style, iframe or
// link destination is copied into the reader document, so opening it cannot
// start new network requests or leak the original page through embedded assets.

const MAX_BLOCKS = 500;
const MAX_CHARACTERS = 120000;
const TYPES = new Set(['h1', 'h2', 'h3', 'p', 'li', 'blockquote', 'pre']);

function collapse(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeReaderDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const blocks = [];
  let total = 0;
  const sourceBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  for (const block of sourceBlocks) {
    if (!block || typeof block !== 'object') continue;
    if (!TYPES.has(block.type)) continue;
    const text = collapse(block.text).slice(0, 20000);
    if (text.length < 2 || total + text.length > MAX_CHARACTERS) continue;
    if (blocks.length && blocks[blocks.length - 1].type === block.type && blocks[blocks.length - 1].text === text) continue;
    blocks.push({ type: block.type, text });
    total += text.length;
    if (blocks.length >= MAX_BLOCKS) break;
  }
  if (!blocks.length) return null;
  const title = collapse(raw.title).slice(0, 300) || 'Reader view';
  const byline = collapse(raw.byline).slice(0, 200);
  const site = collapse(raw.site).slice(0, 200);
  const lang = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(String(raw.lang || '')) ? String(raw.lang) : '';
  const words = blocks.reduce((sum, block) => sum + block.text.split(/\s+/).filter(Boolean).length, 0);
  return {
    title,
    byline,
    site,
    lang,
    blocks,
    words,
    minutes: Math.max(1, Math.ceil(words / 220)),
    truncated: Boolean(raw.truncated) || total >= MAX_CHARACTERS || sourceBlocks.length > blocks.length
  };
}

// Executed with executeJavaScript inside the page. Keep it self-contained: it
// must not reference Node, require, or any module-scoped value.
function extractReaderDocument() {
  const collapse = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const skipTags = new Set(['NAV', 'ASIDE', 'FOOTER', 'HEADER', 'FORM', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DIALOG']);
  const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE', 'LI', 'FIGCAPTION', 'TD']);
  const textLength = (element) => collapse(element.textContent).length;

  const candidates = [];
  for (const selector of ['article', 'main', '[role="main"]', '#content', '.post-content', '.article-body', '.entry-content', '.article-content']) {
    for (const element of document.querySelectorAll(selector)) candidates.push(element);
  }
  let root = document.body;
  let bestScore = 0;
  for (const candidate of candidates) {
    const text = textLength(candidate);
    if (text < 200) continue;
    const linkText = Array.from(candidate.querySelectorAll('a')).reduce((sum, link) => sum + collapse(link.textContent).length, 0);
    const headings = candidate.querySelectorAll('h1,h2,h3').length;
    const score = text + headings * 80 - linkText * 0.8;
    if (score > bestScore) { bestScore = score; root = candidate; }
  }
  if (!root) return { title: document.title, blocks: [] };

  const titleNode = root.querySelector('h1') || document.querySelector('h1');
  const meta = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content || '';
  const title = collapse(titleNode?.textContent) || collapse(document.title).replace(/\s*[|—–-]\s*[^|—–-]{1,60}$/, '');
  const byline = collapse(meta('author') || meta('article:author') || root.querySelector('[rel="author"], .byline, .author')?.textContent);
  const site = collapse(meta('og:site_name')) || location.hostname;

  const blocks = [];
  let truncated = false;
  const elements = root.querySelectorAll('p,h1,h2,h3,h4,blockquote,pre,li,figcaption,td');
  for (const element of elements) {
    if (blocks.length >= 500) { truncated = true; break; }
    if (skipTags.has(element.tagName)) continue;
    if (!blockTags.has(element.tagName)) continue;
    const ancestor = element.parentElement?.closest('nav,aside,footer,header,form,script,style,noscript,svg,canvas,iframe,video,audio,button,dialog');
    if (ancestor && root.contains(ancestor)) continue;
    if (element.querySelector('p,h1,h2,h3,h4,blockquote,pre,li,figcaption,td') && element.tagName !== 'PRE') continue;
    if (element.closest('article,main,[role="main"]') === null && root === document.body && element.closest('header,footer,nav,aside')) continue;
    const text = collapse(element.textContent);
    if (text.length < 2) continue;
    const linkLength = Array.from(element.querySelectorAll('a')).reduce((sum, link) => sum + collapse(link.textContent).length, 0);
    if (text.length > 80 && linkLength / text.length > 0.65) continue;
    let type = element.tagName.toLowerCase();
    if (type === 'h4') type = 'h3';
    if (type === 'figcaption' || type === 'td') type = 'p';
    if (!['h1', 'h2', 'h3', 'p', 'li', 'blockquote', 'pre'].includes(type)) continue;
    const previous = blocks[blocks.length - 1];
    if (previous && previous.text === text) continue;
    blocks.push({ type, text: text.slice(0, 20000) });
  }
  return { title, byline, site, lang: document.documentElement.lang || '', blocks, truncated };
}

module.exports = {
  MAX_BLOCKS,
  MAX_CHARACTERS,
  normalizeReaderDocument,
  extractionSource: `(${extractReaderDocument.toString()})()`
};
