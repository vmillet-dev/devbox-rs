/** Référence vers une clé de traduction Transloco, à consommer via le pipe `transloco` dans le template. */
export interface TranslationRef {
  readonly key: string;
  readonly params?: Record<string, unknown>;
}

export function relativeTimeRef(date: Date, now: Date = new Date()): TranslationRef {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return { key: 'time.justNow' };
  if (minutes < 60) return { key: 'time.minutesAgo', params: { count: minutes } };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { key: 'time.hoursAgo', params: { count: hours } };
  const days = Math.round(hours / 24);
  return { key: 'time.daysAgo', params: { count: days } };
}

export function expiryRef(at: Date, now: Date = new Date()): TranslationRef {
  const days = Math.ceil((at.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return { key: 'time.expired' };
  return { key: 'time.expiresIn', params: { count: days } };
}

export function isExpiringSoon(at: Date, now: Date = new Date(), thresholdDays = 3): boolean {
  const days = (at.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  return days <= thresholdDays;
}
