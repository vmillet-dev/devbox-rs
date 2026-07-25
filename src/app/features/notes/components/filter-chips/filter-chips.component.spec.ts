import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../../../testing/provide-transloco-testing';
import { FilterChipsComponent } from './filter-chips.component';

describe('FilterChipsComponent', () => {
  let fixture: ComponentFixture<FilterChipsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FilterChipsComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(FilterChipsComponent);
    fixture.componentRef.setInput('active', 'all');
    fixture.autoDetectChanges();
  });

  it('renders one chip per filter', () => {
    const chips = fixture.debugElement.queryAll(By.css('.chip'));
    expect(chips.map((chip) => chip.nativeElement.textContent.trim())).toEqual(['Tout', '📌 Épinglées', '⏳ À trier']);
  });

  it('marks the chip matching the active filter', async () => {
    fixture.componentRef.setInput('active', 'pinned');
    await fixture.whenStable();

    const chips = fixture.debugElement.queryAll(By.css('.chip'));
    const activeChips = chips.filter((chip) => chip.classes['active']);
    expect(activeChips).toHaveLength(1);
    expect(activeChips[0].nativeElement.textContent).toContain('Épinglées');
  });

  it('emits filterChanged with the clicked filter key', () => {
    let emitted: string | undefined;
    fixture.componentInstance.filterChanged.subscribe((filter) => (emitted = filter));

    fixture.debugElement.queryAll(By.css('.chip'))[1].triggerEventHandler('click');

    expect(emitted).toBe('pinned');
  });
});
