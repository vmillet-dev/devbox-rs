/** Langages reconnus pour la coloration des badges et du corps des notes. */
export type LanguageTag = 'json' | 'js' | 'py' | 'sql' | 'yml' | 'txt';

export const LANGUAGE_LABELS: Record<LanguageTag, string> = {
  json: 'JSON',
  js: 'JS',
  py: 'PY',
  sql: 'SQL',
  yml: 'YML',
  txt: 'TXT',
};
