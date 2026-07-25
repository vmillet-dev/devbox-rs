import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelativeTimePipe } from './relative-time.pipe';

describe('RelativeTimePipe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delegates formatting to formatRelativeTime, comparing against the current time', () => {
    const pipe = new RelativeTimePipe();
    const almostNow = new Date('2026-01-01T11:59:45Z');

    expect(pipe.transform(almostNow)).toBe("à l'instant");
  });
});
