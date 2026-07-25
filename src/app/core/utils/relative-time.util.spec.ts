import { describe, expect, it } from 'vitest';
import { expiryRef, isExpiringSoon, relativeTimeRef } from './relative-time.util';

describe('relativeTimeRef', () => {
  it('returns the "just now" key when under a minute has elapsed', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const date = new Date('2026-01-01T11:59:45Z');

    expect(relativeTimeRef(date, now)).toEqual({ key: 'time.justNow' });
  });

  it('returns the minutes key when under an hour has elapsed', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const date = new Date('2026-01-01T11:45:00Z');

    expect(relativeTimeRef(date, now)).toEqual({ key: 'time.minutesAgo', params: { count: 15 } });
  });

  it('returns the hours key when under a day has elapsed', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const date = new Date('2026-01-01T09:00:00Z');

    expect(relativeTimeRef(date, now)).toEqual({ key: 'time.hoursAgo', params: { count: 3 } });
  });

  it('returns the days key when a day or more has elapsed', () => {
    const now = new Date('2026-01-05T12:00:00Z');
    const date = new Date('2026-01-01T12:00:00Z');

    expect(relativeTimeRef(date, now)).toEqual({ key: 'time.daysAgo', params: { count: 4 } });
  });
});

describe('expiryRef', () => {
  it('returns the "expired" key when the expiry date is in the past', () => {
    const now = new Date('2026-01-05T12:00:00Z');
    const at = new Date('2026-01-01T12:00:00Z');

    expect(expiryRef(at, now)).toEqual({ key: 'time.expired' });
  });

  it('returns the "expired" key when the expiry date is exactly now', () => {
    const now = new Date('2026-01-05T12:00:00Z');

    expect(expiryRef(now, now)).toEqual({ key: 'time.expired' });
  });

  it('returns the days-remaining key when the expiry date is in the future', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const at = new Date('2026-01-04T12:00:00Z');

    expect(expiryRef(at, now)).toEqual({ key: 'time.expiresIn', params: { count: 3 } });
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
