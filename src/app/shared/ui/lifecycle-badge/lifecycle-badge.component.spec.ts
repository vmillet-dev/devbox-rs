import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LifecycleBadgeComponent } from './lifecycle-badge.component';

describe('LifecycleBadgeComponent', () => {
  let fixture: ComponentFixture<LifecycleBadgeComponent>;

  beforeEach(() => {
    // Only virtualize `Date`; Angular's zoneless scheduler relies on real rAF/setTimeout for `whenStable()` to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    TestBed.configureTestingModule({ imports: [LifecycleBadgeComponent] });
    fixture = TestBed.createComponent(LifecycleBadgeComponent);
    fixture.componentRef.setInput('lifecycle', { kind: 'permanent' });
    fixture.autoDetectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the "never expires" label for a permanent note', () => {
    expect(fixture.nativeElement.textContent.trim()).toBe("📌 N'expire jamais");
  });

  it('is never stale for a permanent note', () => {
    const badge = fixture.debugElement.query(By.css('.lifecycle-badge'));
    expect(badge.classes['stale']).toBeFalsy();
  });

  it('shows the countdown label for an expiring note', async () => {
    fixture.componentRef.setInput('lifecycle', { kind: 'expires', at: new Date('2026-01-04T00:00:00Z') });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent.trim()).toBe('⏳ expire dans 3j');
  });

  it('is marked stale when the expiry is within the soon threshold', async () => {
    fixture.componentRef.setInput('lifecycle', { kind: 'expires', at: new Date('2026-01-02T00:00:00Z') });
    await fixture.whenStable();

    const badge = fixture.debugElement.query(By.css('.lifecycle-badge'));
    expect(badge.classes['stale']).toBe(true);
  });

  it('is not marked stale when the expiry is far away', async () => {
    fixture.componentRef.setInput('lifecycle', { kind: 'expires', at: new Date('2026-02-01T00:00:00Z') });
    await fixture.whenStable();

    const badge = fixture.debugElement.query(By.css('.lifecycle-badge'));
    expect(badge.classes['stale']).toBeFalsy();
  });
});
