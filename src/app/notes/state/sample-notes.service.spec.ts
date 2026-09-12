import { TestBed } from '@angular/core/testing';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '@core/preferences/preferences.service';
import { NotesRepository } from '@notes/data/notes.repository';
import { SpacesRepository } from '@notes/data/spaces.repository';
import { NoteDraft } from '@notes/model/note.model';
import { FakeNotesRepository } from '@testing/fake-notes-repository';
import { FakeSpacesRepository } from '@testing/fake-spaces-repository';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { SampleNotesService } from './sample-notes.service';

describe('SampleNotesService', () => {
  let notes: FakeNotesRepository;
  let spaces: FakeSpacesRepository;
  let created: MockInstance<FakeNotesRepository['create']>;
  let service: SampleNotesService;
  let preferences: PreferencesService;

  /** The drafts handed to the repository, in the order they were written. */
  const drafts = (): NoteDraft[] => created.mock.calls.map(([draft]) => draft);

  function setUp(existingSpaces: { id: string; name: string }[] = []): void {
    TestBed.resetTestingModule();
    notes = new FakeNotesRepository();
    spaces = new FakeSpacesRepository(existingSpaces);
    created = vi.spyOn(notes, 'create');
    TestBed.configureTestingModule({
      providers: [
        { provide: NotesRepository, useValue: notes },
        { provide: SpacesRepository, useValue: spaces },
        provideTranslocoTesting(),
      ],
    });
    service = TestBed.inject(SampleNotesService);
    preferences = TestBed.inject(PreferencesService);
  }

  beforeEach(() => {
    // The deadline sample is dated from the clock; `Date` alone, or the
    // zoneless scheduler loses the `requestAnimationFrame` it needs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T09:00:00Z'));
    setUp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('files a space and its samples into a database that has never been written to', async () => {
    expect(await service.seedIfFirstRun()).toBe(true);

    expect((await spaces.loadAll()).map((space) => space.name)).toEqual(['Découverte']);
    expect(drafts()).toHaveLength(4);
    expect(drafts().every((draft) => draft.spaceId === 'fake-space-1')).toBe(true);
  });

  it('carries one feature per sample', async () => {
    await service.seedIfFirstRun();
    const [welcome, snippet, checklist, code] = drafts();

    expect(welcome.pinned).toBe(true);
    expect(snippet.content).toContain('{{host}}');
    expect(snippet.content).toContain('{{port=5432}}');
    expect(checklist.kind).toBe('checklist');
    expect(checklist.items).toHaveLength(5);
    expect(checklist.items.every((item) => !item.done)).toBe(true);
    expect(code.lifecycle.kind).toBe('expires');
  });

  it('dates the deadline to the end of a local day', async () => {
    // Midnight would make a note dated today expired on the spot.
    await service.seedIfFirstRun();
    const lifecycle = drafts()[3].lifecycle;

    expect(lifecycle.kind).toBe('expires');
    if (lifecycle.kind !== 'expires') return;
    expect(lifecycle.at.getHours()).toBe(23);
    expect(lifecycle.at.getMinutes()).toBe(59);
    expect(lifecycle.at.getDate()).toBe(new Date('2026-09-18T09:00:00Z').getDate());
  });

  it('spells out the languages rather than leaving detection to guess', async () => {
    await service.seedIfFirstRun();

    expect(drafts().map((draft) => draft.language)).toEqual(['md', 'sh', 'txt', 'ts']);
  });

  it('never offers the samples twice', async () => {
    await service.seedIfFirstRun();

    expect(await service.seedIfFirstRun()).toBe(false);
    expect(drafts()).toHaveLength(4);
  });

  it('leaves an existing installation alone, and stops looking', async () => {
    setUp([{ id: 'space-1', name: 'Perso' }]);

    expect(await service.seedIfFirstRun()).toBe(false);
    expect(drafts()).toHaveLength(0);
    // Marked, so the check does not run on every launch from now on.
    expect(preferences.read('devbox.notes.samplesSeeded')).not.toBeNull();
  });

  it('stays silent when there is no database to write to', async () => {
    // jsdom has no bridge; the canvas reports its own failure, and a second
    // banner about samples nobody asked for would only add noise.
    spaces.failNext = new Error('no bridge');

    await expect(service.seedIfFirstRun()).resolves.toBe(false);
    expect(drafts()).toHaveLength(0);
  });

  it('does not start over when a write failed halfway through', async () => {
    notes.failNext = new Error('disk full');

    expect(await service.seedIfFirstRun()).toBe(false);
    // An incomplete set beats a second full set on the next launch.
    expect(await service.seedIfFirstRun()).toBe(false);
    expect((await spaces.loadAll()).length).toBe(1);
  });
});
