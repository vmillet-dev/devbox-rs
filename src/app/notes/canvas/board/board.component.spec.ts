import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Folder } from '@core/model/folder.model';
import { createNote } from '@testing/note.fixture';
import { fakeBoardNote, fakeZone } from '@testing/fake-board-repository';
import { provideAppTesting } from '@testing/testing.providers';
import { BoardComponent } from './board.component';

const PERF: Folder = {
  id: 'perf',
  spaceId: 'sql',
  name: 'Perf',
  colour: 'amber',
  createdAt: new Date('2026-01-01T10:00:00Z'),
};

describe('BoardComponent', () => {
  let fixture: ComponentFixture<BoardComponent>;

  function root(): HTMLElement {
    return fixture.nativeElement;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    // ⚠️ Only `Date`: the zoneless scheduler needs real rAF for `whenStable()`.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    TestBed.configureTestingModule({
      imports: [BoardComponent],
      providers: [provideAppTesting()],
    });
    fixture = TestBed.createComponent(BoardComponent);
    fixture.componentRef.setInput('zones', []);
    fixture.componentRef.setInput('loose', []);
    fixture.componentRef.setInput('width', 1200);
    fixture.componentRef.setInput('height', 800);
    fixture.autoDetectChanges();
  });

  it('sizes the surface from what the back end says is on it', () => {
    const surface = root().querySelector<HTMLElement>('.board-surface');

    expect(surface?.style.width).toBe('1200px');
    expect(surface?.style.height).toBe('800px');
  });

  it('places a zone at its stored frame', async () => {
    fixture.componentRef.setInput('zones', [
      fakeZone({ folder: PERF, frame: { x: 580, y: 16, width: 300, height: 372 } }),
    ]);
    await fixture.whenStable();

    const zone = root().querySelector<HTMLElement>('[data-testid="board-zone"]');
    expect(zone?.style.left).toBe('580px');
    expect(zone?.style.top).toBe('16px');
    expect(zone?.style.width).toBe('300px');
  });

  it('carries the folder colour onto its zone', async () => {
    fixture.componentRef.setInput('zones', [fakeZone({ folder: PERF })]);
    await fixture.whenStable();

    expect(root().querySelector('[data-testid="board-zone"]')?.className).toContain('is-amber');
  });

  /** ⚠️ The inside of a zone is a flow, not a second set of coordinates to maintain. */
  it('lets the cards of a zone flow rather than placing them', async () => {
    fixture.componentRef.setInput('zones', [
      fakeZone({ folder: PERF, notes: [fakeBoardNote(createNote({ id: 'a' }))] }),
    ]);
    await fixture.whenStable();

    const card = root().querySelector<HTMLElement>('[data-testid="board-zone"] app-note-card');
    expect(card?.style.left).toBe('');
    expect(card?.style.top).toBe('');
  });

  it('places a loose card at its own position, under a counted label', async () => {
    fixture.componentRef.setInput('loose', [
      fakeBoardNote(createNote({ id: 'b' }), { position: { x: 276, y: 426 } }),
    ]);
    await fixture.whenStable();

    const card = root().querySelector<HTMLElement>('[data-testid="board-loose-card"]');
    expect(card?.style.left).toBe('276px');
    expect(card?.style.top).toBe('426px');
    expect(root().querySelector('[data-testid="board-loose-label"]')?.textContent).toContain('1');
  });

  /** ⚠️ Dimmed in place: a reflow throws away the only thing the board has. */
  it('dims what a search did not match instead of dropping it', async () => {
    fixture.componentRef.setInput('zones', [
      fakeZone({
        folder: PERF,
        notes: [
          fakeBoardNote(createNote({ id: 'a' })),
          fakeBoardNote(createNote({ id: 'b' }), { matches: false }),
        ],
      }),
    ]);
    await fixture.whenStable();

    const cards = root().querySelectorAll('[data-testid="board-zone"] app-note-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].className).not.toContain('dimmed');
    expect(cards[1].className).toContain('dimmed');
  });

  it('says so when there is nothing to arrange', () => {
    expect(fixture.debugElement.query(By.css('[data-testid="board-empty"]'))).not.toBeNull();
  });

  it('asks to descend when a zone title is clicked', async () => {
    const seen: string[] = [];
    fixture.componentInstance.folderOpened.subscribe((id) => seen.push(id));
    fixture.componentRef.setInput('zones', [fakeZone({ folder: PERF })]);
    await fixture.whenStable();

    root().querySelector<HTMLElement>('[data-testid="board-zone-open"]')?.click();
    await fixture.whenStable();

    expect(seen).toEqual(['perf']);
  });
});
