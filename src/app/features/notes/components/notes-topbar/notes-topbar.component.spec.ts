import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../../../../../testing/provide-transloco-testing';
import { Space } from '../../../../core/models/space.model';
import { SpaceSwitcherComponent } from '../space-switcher/space-switcher.component';
import { SearchBoxComponent } from '../search-box/search-box.component';
import { FilterChipsComponent } from '../filter-chips/filter-chips.component';
import { NotesTopbarComponent } from './notes-topbar.component';

const SPACES: Space[] = [{ id: 'work', name: 'Work' }];

describe('NotesTopbarComponent', () => {
  let fixture: ComponentFixture<NotesTopbarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NotesTopbarComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(NotesTopbarComponent);
    fixture.componentRef.setInput('spaces', SPACES);
    fixture.componentRef.setInput('activeSpace', SPACES[0]);
    fixture.componentRef.setInput('activeFilter', 'all');
    fixture.autoDetectChanges();
  });

  it('passes its inputs down to the space switcher, search box and filter chips', async () => {
    fixture.componentRef.setInput('searchQuery', 'hello');
    await fixture.whenStable();

    const spaceSwitcher = fixture.debugElement.query(By.directive(SpaceSwitcherComponent)).componentInstance as SpaceSwitcherComponent;
    const searchBox = fixture.debugElement.query(By.directive(SearchBoxComponent)).componentInstance as SearchBoxComponent;
    const filterChips = fixture.debugElement.query(By.directive(FilterChipsComponent)).componentInstance as FilterChipsComponent;

    expect(spaceSwitcher.spaces()).toEqual(SPACES);
    expect(spaceSwitcher.activeSpace()).toEqual(SPACES[0]);
    expect(searchBox.query()).toBe('hello');
    expect(filterChips.active()).toBe('all');
  });

  it('forwards spaceChanged from the space switcher', () => {
    let emitted: string | undefined;
    fixture.componentInstance.spaceChanged.subscribe((id) => (emitted = id));

    const spaceSwitcher = fixture.debugElement.query(By.directive(SpaceSwitcherComponent)).componentInstance as SpaceSwitcherComponent;
    spaceSwitcher.spaceChanged.emit('work');

    expect(emitted).toBe('work');
  });

  it('forwards searchQueryChanged from the search box', () => {
    let emitted: string | undefined;
    fixture.componentInstance.searchQueryChanged.subscribe((query) => (emitted = query));

    const searchBox = fixture.debugElement.query(By.directive(SearchBoxComponent)).componentInstance as SearchBoxComponent;
    searchBox.queryChange.emit('term');

    expect(emitted).toBe('term');
  });

  it('forwards filterChanged from the filter chips', () => {
    let emitted: string | undefined;
    fixture.componentInstance.filterChanged.subscribe((filter) => (emitted = filter));

    const filterChips = fixture.debugElement.query(By.directive(FilterChipsComponent)).componentInstance as FilterChipsComponent;
    filterChips.filterChanged.emit('pinned');

    expect(emitted).toBe('pinned');
  });

  it('emits newNoteRequested when the "new note" button is clicked', () => {
    let emitted = false;
    fixture.componentInstance.newNoteRequested.subscribe(() => (emitted = true));

    fixture.debugElement.query(By.css('.new-note-btn')).triggerEventHandler('click');

    expect(emitted).toBe(true);
  });

  it('delegates focusSearch() to the search box', () => {
    const searchBox = fixture.debugElement.query(By.directive(SearchBoxComponent)).componentInstance as SearchBoxComponent;
    const focusSpy = vi.spyOn(searchBox, 'focus');

    fixture.componentInstance.focusSearch();

    expect(focusSpy).toHaveBeenCalled();
  });
});
