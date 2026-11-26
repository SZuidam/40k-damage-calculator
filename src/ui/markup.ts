/**
 * Light markup for ability descriptions (the rule text the user pastes in):
 *
 * - `**bold**` and `*italic*` / `_italic_` (bold may hold italic);
 * - lines starting with `- `, `* ` or `• ` form a bulleted list, `1. ` / `1) ` a numbered one;
 * - a blank line starts a new paragraph, a single line break is kept.
 *
 * Anything else is plain text. It is parsed into a small tree and built with DOM nodes (never
 * innerHTML), so the text can't inject HTML.
 */

export type Inline = { text: string } | { bold: Inline[] } | { italic: Inline[] } | { br: true };
export type Block = { p: Inline[] } | { ul: Inline[][] } | { ol: Inline[][] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** The blocks of `source`: paragraphs and lists, in order. */
export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list = null as { kind: 'ul' | 'ol'; items: string[] } | null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ p: paragraph.flatMap((line, i) => (i === 0 ? parseInline(line) : [{ br: true as const }, ...parseInline(line)])) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list.kind === 'ul' ? { ul: list.items.map(parseInline) } : { ol: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const kind = BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : null;
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (kind) {
      flushParagraph();
      if (list?.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push(line.replace(kind === 'ul' ? BULLET : NUMBERED, ''));
    } else if (list && /^\s+/.test(raw)) {
      // An indented line continues the list item above it.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

// **bold**, then *italic* or _italic_: the markers must hug the text ("2 * 3" stays as it is).
const INLINE = /\*\*(?=\S)(.+?)(?<=\S)\*\*|\*(?=\S)(.+?)(?<=\S)\*|(?<![\p{L}\p{N}])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/gu;

/** The bold, italic and plain runs of one line. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ bold: parseInline(match[1]) });
    else out.push({ italic: parseInline(match[2] ?? match[3]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

function inlineText(runs: readonly Inline[]): string {
  return runs.map((r) => ('text' in r ? r.text : 'br' in r ? '\n' : inlineText('bold' in r ? r.bold : r.italic))).join('');
}

/** `source` as plain text, for tooltips: markers removed, list items as "• " / "1. " lines. */
export function markupToText(source: string): string {
  return parseMarkup(source)
    .map((b) => ('p' in b ? inlineText(b.p) : 'ul' in b ? b.ul.map((item) => `• ${inlineText(item)}`).join('\n') : b.ol.map((item, i) => `${i + 1}. ${inlineText(item)}`).join('\n')))
    .join('\n\n');
}

function renderInline(runs: readonly Inline[]): Node[] {
  return runs.map((r) => {
    if ('text' in r) return document.createTextNode(r.text);
    if ('br' in r) return document.createElement('br');
    const el = document.createElement('bold' in r ? 'strong' : 'em');
    el.append(...renderInline('bold' in r ? r.bold : r.italic));
    return el;
  });
}

/** `source` as DOM nodes: <p>, <ul> / <ol>, <strong>, <em> and <br>. */
export function renderMarkup(source: string): Node[] {
  return parseMarkup(source).map((b) => {
    if ('p' in b) {
      const p = document.createElement('p');
      p.append(...renderInline(b.p));
      return p;
    }
    const list = document.createElement('ul' in b ? 'ul' : 'ol');
    for (const item of 'ul' in b ? b.ul : b.ol) {
      const li = document.createElement('li');
      li.append(...renderInline(item));
      list.append(li);
    }
    return list;
  });
}
