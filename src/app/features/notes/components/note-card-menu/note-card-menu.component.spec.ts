import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Space } from '@core/models/space.model';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { NoteCardMenuComponent } from './note-card-menu.component';

const SPACES: readonly Space[] = [
  { id: 'work', name: 'Work' },
  { id: 'personal', name: 'Personal' },
  { id: 'archive', name: 'Archive' },
];

describe('NoteCardMenuComponent', () => {
  let fixture: ComponentFixture<NoteCardMenuComponent>;

  function trigger(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.card-menu-trigger');
  }

  function items(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.card-menu-item')];
  }

  function moveItems(): HTMLButtonElement[] {
    return items().filter((item) => !item.classList.contains('card-menu-delete'));
  }

  function deleteItem(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.card-menu-delete');
  }

  async function open(): Promise<void> {
    trigger().click();
    await fixture.whenStable();
  }

  async function pressKey(key: string): Promise<void> {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [NoteCardMenuComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(NoteCardMenuComponent);
    fixture.componentRef.setInput('noteTitle', 'Ma note');
    fixture.componentRef.setInput('spaces', SPACES);
    fixture.componentRef.setInput('currentSpaceId', 'work');
    // jsdom only tracks `document.activeElement` for attached elements.
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('stays closed until the trigger is used', () => {
    expect(items()).toHaveLength(0);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('names the note in the trigger label, since ⋯ says nothing on its own', () => {
    expect(trigger().getAttribute('aria-label')).toBe('Options de la note Ma note');
  });

  it('offers every space except the one the note is already in', async () => {
    await open();

    expect(moveItems().map((item) => item.textContent?.trim())).toEqual(['Personal', 'Archive']);
  });

  it('emits the destination space and closes', async () => {
    const moves: string[] = [];
    fixture.componentInstance.moveRequested.subscribe((id) => moves.push(id));
    await open();

    moveItems()[1].click();
    await fixture.whenStable();

    expect(moves).toEqual(['archive']);
    expect(items()).toHaveLength(0);
  });

  it('hides the move group entirely when there is nowhere to move to', async () => {
    fixture.componentRef.setInput('spaces', [SPACES[0]]);
    await fixture.whenStable();

    await open();

    // Offering an empty "move to" heading would suggest a broken menu.
    expect(moveItems()).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.card-menu-title')).toBeNull();
    expect(deleteItem()).not.toBeNull();
  });

  it('asks for confirmation before emitting a deletion', async () => {
    const deletions: unknown[] = [];
    fixture.componentInstance.deleteRequested.subscribe(() => deletions.push(true));
    await open();

    deleteItem().click();
    await fixture.whenStable();

    // Two steps rather than a native confirm(): a system dialog freezes the
    // whole WebView, including the IPC bridge.
    expect(deletions).toEqual([]);
    expect(deleteItem().textContent).toContain('Confirmer ?');

    deleteItem().click();
    await fixture.whenStable();

    expect(deletions).toHaveLength(1);
  });

  it('forgets a pending confirmation when the menu is reopened', async () => {
    await open();
    deleteItem().click();
    await fixture.whenStable();

    trigger().click();
    await fixture.whenStable();
    await open();

    expect(deleteItem().textContent).toContain('Supprimer');
  });

  it('does not open the note when the trigger is clicked', async () => {
    // The card itself is a button wrapping the whole surface: without stopping
    // propagation, opening the menu would open the editor at the same time.
    let bubbled = false;
    fixture.nativeElement.parentElement?.addEventListener('click', () => (bubbled = true), {
      once: true,
    });

    await open();

    expect(bubbled).toBe(false);
  });

  it('moves focus into the menu when it opens', async () => {
    await open();

    expect(document.activeElement).toBe(items()[0]);
  });

  it('cycles focus with the arrow keys', async () => {
    await open();

    await pressKey('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);

    await pressKey('End');
    expect(document.activeElement).toBe(items()[items().length - 1]);

    await pressKey('ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    await open();

    await pressKey('Escape');

    expect(items()).toHaveLength(0);
    // Without this the focus would land on <body> when the menu is destroyed.
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when a click lands outside', async () => {
    await open();

    document.body.click();
    await fixture.whenStable();

    expect(items()).toHaveLength(0);
  });
});
