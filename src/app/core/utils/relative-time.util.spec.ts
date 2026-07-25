import { describe, expect, it } from 'vitest';
import { formatExpiry, formatRelativeTime, isExpiringSoon } from './relative-time.util';

describe('formatRelativeTime', () => {
  it('returns "just now" label when under a minute has elapsed', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const date = new Date('2026-01-01T11:59:45Z');

    expect(formatRelativeTime(date, now)).toBe("à l'instant");
  });

  it('returns minutes label when under an hour has elapsed', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const date = new Date('2026-01-01T11:45:00Z');

    expect(formatRelativeTime(date, now)).toBe('il y a 15 min');
  });

  it('returns hours label when under a day has elapsed', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const date = new Date('2026-01-01T09:00:00Z');

    expect(formatRelativeTime(date, now)).toBe('il y a 3h');
  });

  it('returns days label when a day or more has elapsed', () => {
    const now = new Date('2026-01-05T12:00:00Z');
    const date = new Date('2026-01-01T12:00:00Z');

    expect(formatRelativeTime(date, now)).toBe('il y a 4j');
  });
});

describe('formatExpiry', () => {
  it('returns the "expired" label when the expiry date is in the past', () => {
    const now = new Date('2026-01-05T12:00:00Z');
    const at = new Date('2026-01-01T12:00:00Z');

    expect(formatExpiry(at, now)).toBe('expirée');
  });

  it('returns the "expired" label when the expiry date is exactly now', () => {
    const now = new Date('2026-01-05T12:00:00Z');

    expect(formatExpiry(now, now)).toBe('expirée');
  });

  it('returns the number of days remaining when the expiry date is in the future', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const at = new Date('2026-01-04T12:00:00Z');

    expect(formatExpiry(at, now)).toBe('expire dans 3j');
  });
});

describe('isExpiringSoon', () => {
  it('returns true when the expiry date is within the default 3-day threshold', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const at = new Date('2026-01-03T12:00:00Z');

    expect(isExpiringSoon(at, now)).toBe(true);
  });

  it('returns false when the expiry date is beyond the default 3-day threshold', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const at = new Date('2026-01-10T12:00:00Z');

    expect(isExpiringSoon(at, now)).toBe(false);
  });

  it('respects a custom threshold', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const at = new Date('2026-01-08T12:00:00Z');

    expect(isExpiringSoon(at, now, 10)).toBe(true);
  });
});
