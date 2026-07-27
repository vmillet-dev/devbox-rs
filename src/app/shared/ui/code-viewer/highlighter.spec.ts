import { describe, expect, it } from 'vitest';
import { highlightLines, splitHighlightedLines } from './highlighter';

describe('splitHighlightedLines', () => {
  it('returns one line for content without any newline', () => {
    expect(splitHighlightedLines('plain')).toEqual(['plain']);
  });

  it('returns a single empty line for empty content', () => {
    // Mirrors ''.split('\n'): an empty viewer still shows line 1.
    expect(splitHighlightedLines('')).toEqual(['']);
  });

  it('splits plain text on newlines', () => {
    expect(splitHighlightedLines('one\ntwo')).toEqual(['one', 'two']);
  });

  it('keeps a span that never crosses a line whole', () => {
    expect(splitHighlightedLines('a<span class="hljs-x">b</span>c')).toEqual([
      'a<span class="hljs-x">b</span>c',
    ]);
  });

  it('closes and reopens a span that straddles a newline', () => {
    // The naive split would emit "<span>one" and "two</span>", both unbalanced.
    expect(splitHighlightedLines('<span class="hljs-comment">one\ntwo</span>')).toEqual([
      '<span class="hljs-comment">one</span>',
      '<span class="hljs-comment">two</span>',
    ]);
  });

  it('reopens the whole stack when nested spans straddle a newline', () => {
    const html = '<span class="hljs-a">x<span class="hljs-b">y\nz</span></span>';

    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-a">x<span class="hljs-b">y</span></span>',
      '<span class="hljs-a"><span class="hljs-b">z</span></span>',
    ]);
  });

  it('preserves compound scope classes', () => {
    // highlight.js writes sub-scopes as a second class, e.g. title.function.
    const html = '<span class="hljs-title function_">run\nnext</span>';

    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-title function_">run</span>',
      '<span class="hljs-title function_">next</span>',
    ]);
  });

  it('emits a trailing empty line for content ending on a newline', () => {
    expect(splitHighlightedLines('one\n')).toEqual(['one', '']);
  });
});

describe('highlightLines', () => {
  it('escapes markup when the language has no grammar', () => {
    expect(highlightLines('<b> & </b>', 'txt')).toEqual(['&lt;b&gt; &amp; &lt;/b&gt;']);
  });

  it('produces one entry per source line', () => {
    expect(highlightLines('a\nb\nc', 'txt')).toHaveLength(3);
    expect(highlightLines('{\n"a": 1\n}', 'json')).toHaveLength(3);
  });

  it('maps a language tag onto the grammar that describes it', () => {
    // toml is described by the ini grammar, html by xml: a wrong mapping would
    // silently degrade to uncoloured output rather than fail.
    expect(highlightLines('key = "value"', 'toml').join('')).toContain('hljs-');
    expect(highlightLines('<p>hi</p>', 'html').join('')).toContain('hljs-');
  });
});
