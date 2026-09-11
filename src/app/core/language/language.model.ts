import type { Language } from '@core/ipc/bindings';

/**
 * The languages recognised for badges and note bodies. A plain alias of the
 * union **generated** from the Rust `Language` enum, so a variant added there
 * appears here on regeneration and breaks the build everywhere it is not
 * handled — starting with `LANGUAGE_LABELS`, which has to stay exhaustive.
 */
export type LanguageTag = Language;

/**
 * The key order is the editor select's: data formats first, then languages,
 * then markup, then plain text.
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

/** The language kept when the value received is not (or no longer) recognised. */
export const FALLBACK_LANGUAGE: LanguageTag = 'txt';

/**
 * Narrows a **free** string — a `<select>`'s value, never data from the bridge.
 * The bridge already delivers a `LanguageTag`, the Rust enum having replaced
 * the string there, so nothing is left to narrow on that side.
 */
export function isLanguageTag(value: unknown): value is LanguageTag {
  return typeof value === 'string' && Object.hasOwn(LANGUAGE_LABELS, value);
}
