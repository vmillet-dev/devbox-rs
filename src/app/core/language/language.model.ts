import type { Language } from '@core/ipc/bindings';

/**
 * Langages reconnus pour la coloration des badges et du corps des notes. Simple
 * alias de l'union **générée** depuis l'enum `Language` de
 * `src-tauri/src/notes/language.rs` : ce n'est plus un miroir tenu à la main,
 * une variante ajoutée en Rust apparaît ici dès la régénération et casse la
 * compilation partout où elle n'est pas traitée — à commencer par
 * `LANGUAGE_LABELS`, qui doit rester exhaustif.
 */
export type LanguageTag = Language;

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
 * Restreint une chaîne **libre** — la valeur d'un `<select>`, jamais une donnée
 * venue du pont. Le pont, lui, livre déjà un `LanguageTag` : l'enum Rust y a
 * remplacé la chaîne, donc il n'y a plus rien à narrower de ce côté.
 */
export function isLanguageTag(value: unknown): value is LanguageTag {
  return typeof value === 'string' && Object.hasOwn(LANGUAGE_LABELS, value);
}
