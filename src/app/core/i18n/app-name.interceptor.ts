import { Injectable } from '@angular/core';
import { Translation, TranslocoInterceptor } from '@jsverse/transloco';
import { APP_INFO } from '@core/app-info/app-info.service';

/**
 * The placeholder a translation writes instead of the application's name.
 *
 * ⚠️ Deliberately **not** Transloco syntax. An unknown `{{name}}` is replaced by the
 * empty string, so `{{app}}` would turn every one of these strings into a sentence with
 * a hole in it the day this interceptor stopped being registered — silently. `%APP%`
 * survives the pipe untouched, so the same accident is visible on screen.
 */
export const APP_NAME_TOKEN = '%APP%';

/**
 * Substitutes the name **once, when a language is loaded**, before any pipe reads the
 * string. The alternative — a parameter passed at each call site — has twenty call
 * sites, no compile-time check, and loses the name without a word when one is missed.
 */
@Injectable({ providedIn: 'root' })
export class AppNameInterceptor implements TranslocoInterceptor {
  preSaveTranslation(translation: Translation): Translation {
    return this.substitute(translation) as Translation;
  }

  preSaveTranslationKey(_key: string, value: string): string {
    return value.replaceAll(APP_NAME_TOKEN, APP_INFO.name);
  }

  /**
   * Transloco flattens a translation before saving it, but not in every configuration:
   * walking handles both shapes rather than depending on which one arrives.
   */
  private substitute(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replaceAll(APP_NAME_TOKEN, APP_INFO.name);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.substitute(item));
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, this.substitute(nested)]));
    }
    return value;
  }
}
