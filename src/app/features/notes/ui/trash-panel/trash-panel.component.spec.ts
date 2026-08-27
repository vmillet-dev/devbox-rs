import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashedNote } from '@features/notes/model/note.model';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { TrashPanelComponent } from './trash-panel.component';

const NOW = new Date('2026-08-27T09:00:00Z');

function trashed(overrides: Partial<TrashedNote> = {}): TrashedNote {
  return {
    id: 'note-1',
    spaceId: 'space-1',
    title: 'Deleted note',
    language: 'txt',
    content: 'line one\nline two\nline three',
    tags: [],
    deletedAt: new Date('2026-08-27T08:00:00Z'),
    purgeAt: new Date('2026-09-26T08:00:00Z'),
    ...overrides,
  };
}

describe('TrashPanelComponent', () => {
  let fixture: ComponentFixture<TrashPanelComponent>;

  function rows(): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll('.trash-row')];
  }

  function actionsOf(index: number): HTMLButtonElement[] {
    return [...rows()[index].querySelectorAll<HTMLButtonElement>('.trash-action')];
  }

  beforeEach(async () => {
    // Seule `Date` est truquée : `requestAnimationFrame` truqué bloquerait
    // l'ordonnanceur zoneless d'Angular et `whenStable` ne rendrait jamais.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TrashPanelComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(TrashPanelComponent);
    fixture.componentRef.setInput('notes', [trashed()]);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('states the retention rule the backend applies', () => {
    expect(fixture.nativeElement.querySelector('.trash-hint').textContent).toContain('30 jours');
  });

  it('shows when a note was deleted and when it will be erased', () => {
    const meta = rows()[0].querySelector('.trash-row-meta')?.textContent ?? '';

    expect(meta).toContain('il y a 1h');
    expect(meta).toContain('30');
  });

  it('counts the last day as still the user’s', async () => {
    // Arrondi au supérieur : « effacée dans 1 j » tant qu'il reste du temps.
    fixture.componentRef.setInput('notes', [
      trashed({ purgeAt: new Date('2026-08-27T23:00:00Z') }),
    ]);
    await fixture.whenStable();

    expect(rows()[0].querySelector('.trash-row-meta')?.textContent).toContain('1 j');
  });

  it('says a note is erased today once its deadline has passed', async () => {
    fixture.componentRef.setInput('notes', [
      trashed({ purgeAt: new Date('2026-08-27T08:59:00Z') }),
    ]);
    await fixture.whenStable();

    expect(rows()[0].querySelector('.trash-row-meta')?.textContent).toContain("aujourd'hui");
  });

  it('falls back to a label for an untitled note', async () => {
    fixture.componentRef.setInput('notes', [trashed({ title: '' })]);
    await fixture.whenStable();

    expect(rows()[0].querySelector('.trash-row-title')?.textContent?.trim()).toBe('Sans titre');
  });

  it('shows an empty state rather than an empty list', async () => {
    fixture.componentRef.setInput('notes', []);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.trash-state').textContent).toContain('vide');
    // Vider une corbeille déjà vide n'a rien à proposer.
    expect(fixture.nativeElement.querySelector('.trash-footer')).toBeNull();
  });

  it('restores in one click', async () => {
    let emitted: string | undefined;
    fixture.componentInstance.restoreRequested.subscribe((id) => (emitted = id));

    actionsOf(0)[0].click();
    await fixture.whenStable();

    expect(emitted).toBe('note-1');
  });

  it('asks for a confirmation before erasing for good', async () => {
    let emitted = 0;
    fixture.componentInstance.purgeRequested.subscribe(() => (emitted += 1));

    actionsOf(0)[1].click();
    await fixture.whenStable();
    expect(emitted).toBe(0);
    expect(actionsOf(0)[1].textContent).toContain('Confirmer');

    actionsOf(0)[1].click();
    await fixture.whenStable();
    expect(emitted).toBe(1);
  });

  it('confirms one row at a time', async () => {
    fixture.componentRef.setInput('notes', [trashed(), trashed({ id: 'note-2' })]);
    await fixture.whenStable();

    actionsOf(0)[1].click();
    await fixture.whenStable();

    expect(actionsOf(1)[1].textContent).not.toContain('Confirmer');
  });
});
