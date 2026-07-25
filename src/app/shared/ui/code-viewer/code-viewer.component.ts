import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FALLBACK_LANGUAGE, LanguageTag } from '@core/models/language.model';

type TokenType = 'key' | 'string' | 'number' | 'punct' | 'comment' | 'plain';

interface CodeToken {
  readonly text: string;
  readonly type: TokenType;
}

// Regex nommée : "clé" si suivie d'un ':', sinon "chaîne" — l'ordre des
// alternatives fait gagner le premier cas quand les deux correspondent.
const JSON_TOKEN_PATTERN =
  /(?<key>"(?:[^"\\]|\\.)*")(?=\s*:)|(?<str>"(?:[^"\\]|\\.)*")|(?<num>-?\d+(?:\.\d+)?)|(?<punct>[{}[\],:])/g;

/** Ordre de test des groupes nommés, du plus spécifique au plus général. */
const TOKEN_GROUPS: readonly (readonly [group: string, type: TokenType])[] = [
  ['key', 'key'],
  ['str', 'string'],
  ['num', 'number'],
  ['punct', 'punct'],
];

function tokenizeJsonLine(line: string): CodeToken[] {
  if (line.trim().startsWith('//')) {
    return [{ text: line, type: 'comment' }];
  }

  const tokens: CodeToken[] = [];
  let lastIndex = 0;

  // `matchAll` travaille sur son propre curseur : pas de `lastIndex` partagé à
  // réinitialiser entre deux lignes, contrairement à une boucle `exec`.
  for (const match of line.matchAll(JSON_TOKEN_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, index), type: 'plain' });
    }

    const groups = match.groups ?? {};
    const matched = TOKEN_GROUPS.find(([group]) => groups[group] !== undefined);
    if (matched) {
      tokens.push({ text: groups[matched[0]], type: matched[1] });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), type: 'plain' });
  }
  return tokens;
}

/**
 * Aperçu en lecture seule avec numéros de ligne. Coloration syntaxique
 * uniquement pour JSON (regex légère, pas de dépendance externe) ; les
 * autres langages s'affichent en texte brut monospace.
 *
 * Vit dans `shared/ui` parce qu'il ne sait rien des notes : la future feature
 * « formatters » (`format_json`) l'utilisera telle quelle.
 */
@Component({
  selector: 'app-code-viewer',
  templateUrl: './code-viewer.component.html',
  styleUrl: './code-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeViewerComponent {
  readonly content = input.required<string>();
  readonly language = input<LanguageTag>(FALLBACK_LANGUAGE);

  protected readonly lines = computed<readonly CodeToken[][]>(() => {
    const rawLines = this.content().split('\n');
    return this.language() === 'json'
      ? rawLines.map(tokenizeJsonLine)
      : rawLines.map((line) => [{ text: line, type: 'plain' as const }]);
  });
}
