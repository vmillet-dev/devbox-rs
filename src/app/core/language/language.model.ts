/** Langages reconnus pour la coloration des badges et du corps des notes. */
export type LanguageTag =
  'json' | 'js' | 'ts' | 'py' | 'sql' | 'yml' | 'toml' | 'xml' | 'html' | 'css' | 'sh' | 'md' | 'txt';

/**
 * L'ordre des clés est celui du sélecteur de l'éditeur (cf. `LANGUAGE_OPTIONS`) :
 * formats de données d'abord, puis langages, puis balisage, puis texte.
 */
export const LANGUAGE_LABELS: Record<LanguageTag, string> = {
  json: 'JSON',
  js: 'JS',
  ts: 'TS',
  py: 'PY',
  sql: 'SQL',
  yml: 'YML',
  toml: 'TOML',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  sh: 'SH',
  md: 'MD',
  txt: 'TXT',
};

/** Langage retenu quand la valeur reçue n'est pas (ou plus) reconnue par le front. */
export const FALLBACK_LANGUAGE: LanguageTag = 'txt';

/**
 * Garde de type utilisée au franchissement de la frontière IPC : le backend Rust
 * pourrait renvoyer un langage que cette version du front ignore encore.
 */
export function isLanguageTag(value: unknown): value is LanguageTag {
  return typeof value === 'string' && Object.hasOwn(LANGUAGE_LABELS, value);
}
