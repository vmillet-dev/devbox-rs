import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LanguageTag } from '../../../../core/models/language.model';

type TokenType = 'key' | 'string' | 'number' | 'punct' | 'comment' | 'plain';

interface CodeToken {
  text: string;
  type: TokenType;
}

// Regex nommée : "clé" si suivie d'un ':', sinon "chaîne" — l'ordre des
// alternatives fait gagner le premier cas quand les deux correspondent.
const JSON_TOKEN_PATTERN =
  /(?<key>"(?:[^"\\]|\\.)*")(?=\s*:)|(?<str>"(?:[^"\\]|\\.)*")|(?<num>-?\d+(?:\.\d+)?)|(?<punct>[{}[\],:])/g;

function tokenizeJsonLine(line: string): CodeToken[] {
  if (line.trim().startsWith('//')) {
    return [{ text: line, type: 'comment' }];
  }

  const tokens: CodeToken[] = [];
  const pattern = new RegExp(JSON_TOKEN_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), type: 'plain' });
    }
    const groups = match.groups!;
    if (groups['key'] !== undefined) {
      tokens.push({ text: groups['key'], type: 'key' });
    } else if (groups['str'] !== undefined) {
      tokens.push({ text: groups['str'], type: 'string' });
    } else if (groups['num'] !== undefined) {
      tokens.push({ text: groups['num'], type: 'number' });
    } else if (groups['punct'] !== undefined) {
      tokens.push({ text: groups['punct'], type: 'punct' });
    }
    lastIndex = pattern.lastIndex;
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
 */
@Component({
  selector: 'app-code-viewer',
  templateUrl: './code-viewer.component.html',
  styleUrl: './code-viewer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeViewerComponent {
  readonly content = input.required<string>();
  readonly language = input<LanguageTag>('txt');

  protected readonly lines = computed<CodeToken[][]>(() => {
    const rawLines = this.content().split('\n');
    return this.language() === 'json'
      ? rawLines.map(tokenizeJsonLine)
      : rawLines.map((line) => [{ text: line, type: 'plain' as const }]);
  });
}
