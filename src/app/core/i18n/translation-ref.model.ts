/**
 * A reference to a Transloco key, consumed by the `transloco` pipe.
 *
 * House rule: code that produces user-facing text returns a reference and never
 * a formatted string, so translation always happens in the active language.
 */
export interface TranslationRef {
  readonly key: string;
  readonly params?: Record<string, unknown>;
}
