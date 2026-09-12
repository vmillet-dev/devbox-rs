import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { FilterChipsComponent } from './filter-chips.component';

describe('FilterChipsComponent', () => {
  let fixture: ComponentFixture<FilterChipsComponent>;

  function chips(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.chip')];
  }

  function chipLabels(): string[] {
    return chips().map((chip) => chip.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FilterChipsComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(FilterChipsComponent);
    fixture.componentRef.setInput('active', 'all');
    fixture.autoDetectChanges();
  });

  it('renders one chip per filter', () => {
    expect(chipLabels()).toEqual(['Tout', '📌 Épinglées', '⏳ À trier']);
  });

  it('marks the chip matching the active filter', async () => {
    fixture.componentRef.setInput('active', 'pinned');
    await fixture.whenStable();

    const activeChips = chips().filter((chip) => chip.classList.contains('active'));
    expect(activeChips).toHaveLength(1);
    expect(activeChips[0].textContent).toContain('Épinglées');
  });

  it('exposes the active state as a pressed toggle, not only as a CSS class', async () => {
    fixture.componentRef.setInput('active', 'pinned');
    await fixture.whenStable();

    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('hides the decorative icons from assistive tech', () => {
    const icons = [...fixture.nativeElement.querySelectorAll('.chip span')];

    expect(icons.every((icon: Element) => icon.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('groups the chips under a single accessible name', () => {
    const group = fixture.nativeElement.querySelector('.filter-chips');

    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Filtrer les notes');
  });

  it('emits filterChanged with the clicked filter key', () => {
    let emitted: string | undefined;
    fixture.componentInstance.filterChanged.subscribe((filter) => (emitted = filter));

    fixture.debugElement.queryAll(By.css('.chip'))[1].triggerEventHandler('click');

    expect(emitted).toBe('pinned');
  });
});
