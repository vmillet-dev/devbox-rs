import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { Space } from '@core/models/space.model';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { FilterChipsComponent } from '../filter-chips/filter-chips.component';
import { SearchBoxComponent } from '../search-box/search-box.component';
import { SpaceSwitcherComponent } from '../space-switcher/space-switcher.component';
import { NotesTopbarComponent } from './notes-topbar.component';

const SPACES: readonly Space[] = [{ id: 'work', name: 'Work' }];

describe('NotesTopbarComponent', () => {
  let fixture: ComponentFixture<NotesTopbarComponent>;

  function child<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NotesTopbarComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(NotesTopbarComponent);
    fixture.componentRef.setInput('spaces', SPACES);
    fixture.componentRef.setInput('activeSpace', SPACES[0]);
    fixture.componentRef.setInput('activeFilter', 'all');
    fixture.autoDetectChanges();
  });

  it('passes its inputs down to the space switcher, search box and filter chips', async () => {
    fixture.componentRef.setInput('searchQuery', 'hello');
    await fixture.whenStable();

    expect(child(SpaceSwitcherComponent).spaces()).toEqual(SPACES);
    expect(child(SpaceSwitcherComponent).activeSpace()).toEqual(SPACES[0]);
    expect(child(SearchBoxComponent).query()).toBe('hello');
    expect(child(FilterChipsComponent).active()).toBe('all');
  });

  it('relays the shortcut-enabled flag to the search box', async () => {
    fixture.componentRef.setInput('searchShortcutEnabled', false);
    await fixture.whenStable();

    expect(child(SearchBoxComponent).shortcutEnabled()).toBe(false);
  });

  it('enables the search shortcut by default', () => {
    expect(child(SearchBoxComponent).shortcutEnabled()).toBe(true);
  });

  it('forwards spaceChanged from the space switcher', () => {
    let emitted: string | null | undefined;
    fixture.componentInstance.spaceChanged.subscribe((id) => (emitted = id));

    child(SpaceSwitcherComponent).spaceChanged.emit('work');

    expect(emitted).toBe('work');
  });

  it('forwards the "all spaces" selection as null', () => {
    let emitted: string | null | undefined;
    fixture.componentInstance.spaceChanged.subscribe((id) => (emitted = id));

    child(SpaceSwitcherComponent).spaceChanged.emit(null);

    expect(emitted).toBeNull();
  });

  it('forwards spaceCreated from the space switcher', () => {
    let emitted: string | undefined;
    fixture.componentInstance.spaceCreated.subscribe((name) => (emitted = name));

    child(SpaceSwitcherComponent).spaceCreated.emit('Side project');

    expect(emitted).toBe('Side project');
  });

  it('forwards searchQueryChanged from the search box', () => {
    let emitted: string | undefined;
    fixture.componentInstance.searchQueryChanged.subscribe((query) => (emitted = query));

    child(SearchBoxComponent).query.set('term');

    expect(emitted).toBe('term');
  });

  it('forwards filterChanged from the filter chips', () => {
    let emitted: string | undefined;
    fixture.componentInstance.filterChanged.subscribe((filter) => (emitted = filter));

    child(FilterChipsComponent).filterChanged.emit('pinned');

    expect(emitted).toBe('pinned');
  });

  it('emits newNoteRequested when the "new note" button is clicked', () => {
    let emitted = false;
    fixture.componentInstance.newNoteRequested.subscribe(() => (emitted = true));

    fixture.debugElement.query(By.css('.new-note-btn')).triggerEventHandler('click');

    expect(emitted).toBe(true);
  });

  it('relays the "all spaces" mode down to the switcher', async () => {
    fixture.componentRef.setInput('activeSpace', null);
    await fixture.whenStable();

    expect(child(SpaceSwitcherComponent).activeSpace()).toBeNull();
  });
});
