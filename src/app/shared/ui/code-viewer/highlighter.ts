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
import { LanguageTag } from '@core/models/language.model';

/**
 * Seul point de contact avec highlight.js.
 *
 * Les grammaires sont importées **une par une** depuis `highlight.js/lib/` : le
 * paquet complet embarque près de 200 langages, ce qui ferait exploser le budget
 * de bundle initial pour les douze qui servent ici.
 *
 * Aucune feuille de style de highlight.js n'est importée : elles codent leurs
 * couleurs en dur. Le thème vit dans `src/styles/_code-theme.scss`, qui traduit
 * les classes `.hljs-*` en variables du thème.
 */

/**
 * Grammaire highlight.js correspondant à chaque langage de note. Trois n'ont pas
 * le même nom des deux côtés (`toml` est décrit par `ini`, `html` par `xml`), et
 * `txt` n'en a volontairement aucune : du texte libre n'a rien à colorer.
 */
const GRAMMARS: Readonly<Partial<Record<LanguageTag, string>>> = {
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
  return text.replace(/[&<>]/g, (character) => HTML_ESCAPES[character]);
}

/** Ouverture ou fermeture de balise dans la sortie de highlight.js. */
const SPAN_PATTERN = /<span class="([^"]*)">|<\/span>/g;

/**
 * Redécoupe la sortie de highlight.js en une chaîne HTML par ligne source.
 *
 * highlight.js colore le bloc **entier** — c'est précisément ce qui lui permet
 * de traiter un commentaire ou une chaîne s'étendant sur plusieurs lignes. Mais
 * le visualiseur rend une ligne par élément, pour sa gouttière de numéros : un
 * simple `split('\n')` couperait au milieu des `<span>` qui chevauchent une fin
 * de ligne et produirait du HTML déséquilibré.
 *
 * D'où ce parcours : on tient la pile des balises ouvertes, on la referme en fin
 * de ligne et on la rouvre au début de la suivante. La grammaire à traverser est
 * étroite — highlight.js n'émet que `<span class="…">`, `</span>` et du texte
 * déjà échappé — ce qui rend le parcours par expression régulière suffisant.
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
 * Contenu colorié, une chaîne HTML par ligne source.
 *
 * Le HTML renvoyé ne contient que des `<span class="hljs-…">` autour de texte
 * échappé par highlight.js : il traverse le sanitizer d'Angular sans perte, et
 * il ne faut surtout pas le marquer comme sûr — le contenu d'une note est saisi
 * par l'utilisateur.
 */
export function highlightLines(content: string, language: LanguageTag): string[] {
  const grammar = GRAMMARS[language];
  if (!grammar) {
    return content.split('\n').map(escapeHtml);
  }

  // `ignoreIllegals` : une note est du texte libre, souvent un fragment qui ne
  // respecte pas la grammaire de bout en bout. Sans ça highlight.js lèverait,
  // et un extrait de JSON tronqué ne s'afficherait plus du tout.
  const highlighted = hljs.highlight(content, { language: grammar, ignoreIllegals: true }).value;

  return splitHighlightedLines(highlighted);
}
