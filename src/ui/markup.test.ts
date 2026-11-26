import { describe, expect, it } from 'vitest';
import { markupToText, parseInline, parseMarkup } from './markup';

describe('parseInline', () => {
  it('reads bold, italic and plain runs', () => {
    expect(parseInline('Re-roll **failed** hits *once*')).toEqual([{ text: 'Re-roll ' }, { bold: [{ text: 'failed' }] }, { text: ' hits ' }, { italic: [{ text: 'once' }] }]);
    expect(parseInline('_Oath of Moment_')).toEqual([{ italic: [{ text: 'Oath of Moment' }] }]);
    expect(parseInline('**bold with *italic* inside**')).toEqual([{ bold: [{ text: 'bold with ' }, { italic: [{ text: 'italic' }] }, { text: ' inside' }] }]);
  });

  it('leaves markers that don’t hug text, and underscores inside words, as they are', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
    expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
    expect(parseInline('**')).toEqual([{ text: '**' }]);
  });
});

describe('parseMarkup', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    expect(parseMarkup('One\ntwo\r\n\r\nThree')).toEqual([{ p: [{ text: 'One' }, { br: true }, { text: 'two' }] }, { p: [{ text: 'Three' }] }]);
    expect(parseMarkup('  \n\n')).toEqual([]);
  });

  it('reads bulleted and numbered lists, with indented lines continuing an item', () => {
    expect(parseMarkup('Pick one:\n- **Hits**: re-roll\n* Wounds\n  of 1\n1. First\n2) Second')).toEqual([
      { p: [{ text: 'Pick one:' }] },
      { ul: [[{ bold: [{ text: 'Hits' }] }, { text: ': re-roll' }], [{ text: 'Wounds of 1' }]] },
      { ol: [[{ text: 'First' }], [{ text: 'Second' }]] },
    ]);
  });
});

describe('markupToText', () => {
  it('drops the markers and writes lists as lines, blocks split by a blank line', () => {
    expect(markupToText('Each time a model **makes an attack**:\n- re-roll a *hit roll* of 1\n\n1. once')).toBe('Each time a model makes an attack:\n\n• re-roll a hit roll of 1\n\n1. once');
  });
});
