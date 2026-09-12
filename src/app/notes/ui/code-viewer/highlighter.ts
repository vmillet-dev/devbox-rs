import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { LanguageTag } from '@notes/model/language.model';

/**
 * Grammars are imported **one by one** from `highlight.js/lib/`: the full package carries
 * close to 200 languages, which would blow the initial bundle budget for the twelve used
 * here. No highlight.js stylesheet is imported — they hard-code their colours, and the
 * theme lives in the global `src/styles/_code-theme.scss`.
 */

/**
 * Three do not share a name across the two sides (`toml` is described by `ini`, `html` by
 * `xml`), and `txt` deliberately has none: free text has nothing to colour.
 *
 * ⚠️ `Record`, not `Partial<Record>`: a language added to the Rust enum has to break this
 * build — left partial it would come back uncoloured, and nothing would say so.
 */
const GRAMMARS: Readonly<Record<LanguageTag, string | null>> = {
  json: 'json',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sql: 'sql',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  html: 'xml',
  css: 'css',
  sh: 'bash',
  md: 'markdown',
  txt: null,
};

for (const [name, grammar] of Object.entries({
  bash,
  css,
  ini,
  javascript,
  json,
  markdown,
  python,
  sql,
  typescript,
  xml,
  yaml,
})) {
  hljs.registerLanguage(name, grammar);
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (character) => HTML_ESCAPES[character] ?? character);
}

const SPAN_PATTERN = /<span class="([^"]*)">|<\/span>/g;

/**
 * highlight.js colours the **whole** block — which is what lets it handle a comment or a
 * string spanning several lines — but the viewer renders one line per element for its
 * number gutter, and a plain split would cut through the spans that straddle a line
 * ending, producing unbalanced HTML.
 *
 * Hence this walk: hold the stack of open tags, close it at the end of a line and reopen
 * it at the start of the next.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';

  const appendText = (text: string): void => {
    const [first, ...rest] = text.split('\n');
    current += first;
    for (const part of rest) {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.map((classes) => `<span class="${classes}">`).join('') + part;
    }
  };

  let cursor = 0;
  for (const match of html.matchAll(SPAN_PATTERN)) {
    appendText(html.slice(cursor, match.index));

    if (match[1] === undefined) {
      open.pop();
    } else {
      open.push(match[1]);
    }

    current += match[0];
    cursor = match.index + match[0].length;
  }
  appendText(html.slice(cursor));
  lines.push(current);

  return lines;
}

/**
 * ⚠️ The HTML returned holds only `<span class="hljs-…">` around text highlight.js has
 * escaped: it passes Angular's sanitizer intact, and must **never** be marked as safe —
 * a note's content is typed by the user.
 */
export function highlightLines(content: string, language: LanguageTag): string[] {
  const grammar = GRAMMARS[language];
  if (!grammar) {
    return content.split('\n').map(escapeHtml);
  }

  // `ignoreIllegals`: a note is free text, often a fragment that does not obey the
  // grammar end to end. Without it a truncated JSON excerpt would stop rendering.
  const highlighted = hljs.highlight(content, { language: grammar, ignoreIllegals: true }).value;

  return splitHighlightedLines(highlighted);
}
