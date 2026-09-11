import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ClockService } from '@core/time/clock.service';
import { PreferencesService } from '@core/preferences/preferences.service';
import { NotesRepository } from '../data/notes.repository';
import { SpacesRepository } from '../data/spaces.repository';
import { NoteDraft } from '../model/note.model';

/** Written once the samples have been offered, whatever came of it. */
const SEEDED_KEY = 'devbox.notes.samplesSeeded';

const DEADLINE_DAYS = 7;

/**
 * Bodies that are **code**, and so are not translated — they also could not be:
 * Transloco reads `{{name}}` as an interpolation and would replace a snippet's
 * fields with empty strings on the way out.
 */
const PSQL_SNIPPET = 'psql -h {{host}} -p {{port=5432}} -U {{user}} -d {{database}}';

const SIGNAL_SNIPPET = `readonly count = signal(0);
readonly doubled = computed(() => this.count() * 2);

increment(): void {
  this.count.update((value) => value + 1);
}`;

/**
 * Keyed by name rather than positional: the whole set is translated in one go,
 * and inserting a key here can no longer shift every sample's text by one.
 */
const KEYS = {
  spaceName: 'notes.samples.space',
  welcomeTitle: 'notes.samples.welcome.title',
  welcomeContent: 'notes.samples.welcome.content',
  welcomeSource: 'notes.samples.welcome.source',
  snippetTitle: 'notes.samples.snippet.title',
  snippetSource: 'notes.samples.snippet.source',
  checklistTitle: 'notes.samples.checklist.title',
  checklistOpen: 'notes.samples.checklist.open',
  checklistCopy: 'notes.samples.checklist.copy',
  checklistFields: 'notes.samples.checklist.fields',
  checklistPalette: 'notes.samples.checklist.palette',
  checklistSpace: 'notes.samples.checklist.space',
  codeTitle: 'notes.samples.code.title',
  codeSource: 'notes.samples.code.source',
  devboxTag: 'notes.samples.tags.devbox',
  exampleTag: 'notes.samples.tags.example',
  databaseTag: 'notes.samples.tags.database',
  angularTag: 'notes.samples.tags.angular',
} as const;

type SampleTexts = Record<keyof typeof KEYS, string>;

/**
 * The notes a brand-new installation opens on.
 *
 * An empty canvas is the worst possible introduction: a virgin database has no
 * space, so not even a note can be created. These four carry one feature each
 * (pin, `{{fields}}`, checklist, deadline) and are ordinary notes — editing or
 * trashing them is the point.
 *
 * The content comes from the front end because it is user-facing text, which
 * the back end never writes. It also means the samples arrive in the language
 * the application starts in.
 */
@Injectable({ providedIn: 'root' })
export class SampleNotesService {
  private readonly notes = inject(NotesRepository);
  private readonly spaces = inject(SpacesRepository);
  private readonly preferences = inject(PreferencesService);
  private readonly transloco = inject(TranslocoService);
  private readonly clock = inject(ClockService);

  /**
   * Files the samples on a fresh installation, and says whether it did — the
   * caller reloads its stores on a `true`.
   *
   * Two guards, not one. The marker alone would re-seed anyone whose
   * preferences file went missing; "no space at all" alone would re-seed the
   * day the last space disappears. Together they only ever match a database
   * that has never been written to.
   */
  async seedIfFirstRun(): Promise<boolean> {
    if (this.preferences.read(SEEDED_KEY) !== null) return false;

    try {
      if ((await this.spaces.loadAll()).length > 0) {
        // An installation that predates the samples: nothing to offer, and
        // nothing to come back and check on every launch either.
        this.preferences.write(SEEDED_KEY, 'skipped');
        return false;
      }

      return await this.seed();
    } catch {
      // No bridge (jsdom), or a database that will not open: the canvas reports
      // its own failure, and a second banner would only add noise.
      return false;
    }
  }

  private async texts(): Promise<SampleTexts> {
    const names = Object.keys(KEYS) as (keyof typeof KEYS)[];
    const translated = await firstValueFrom(this.transloco.selectTranslate<string[]>(Object.values(KEYS)));

    return Object.fromEntries(names.map((name, index) => [name, translated[index] ?? ''])) as SampleTexts;
  }

  private async seed(): Promise<boolean> {
    const text = await this.texts();

    const space = await this.spaces.create({ name: text.spaceName });
    // Written before the notes: a failure halfway through leaves an incomplete
    // set, which is still better than a second full set on the next launch.
    this.preferences.write(SEEDED_KEY, 'true');

    const drafts: NoteDraft[] = [
      {
        spaceId: space.id,
        title: text.welcomeTitle,
        language: 'md',
        content: text.welcomeContent,
        source: text.welcomeSource,
        tags: [text.devboxTag],
        // Pinned so the "pinned" section is not an empty heading on the first
        // screen.
        pinned: true,
        lifecycle: { kind: 'permanent' },
        kind: 'snippet',
        items: [],
      },
      {
        spaceId: space.id,
        title: text.snippetTitle,
        language: 'sh',
        content: PSQL_SNIPPET,
        source: text.snippetSource,
        tags: [text.databaseTag, text.exampleTag],
        pinned: false,
        lifecycle: { kind: 'permanent' },
        kind: 'snippet',
        items: [],
      },
      {
        spaceId: space.id,
        title: text.checklistTitle,
        language: 'txt',
        content: '',
        source: '',
        tags: [text.devboxTag],
        pinned: false,
        lifecycle: { kind: 'permanent' },
        kind: 'checklist',
        items: [
          text.checklistOpen,
          text.checklistCopy,
          text.checklistFields,
          text.checklistPalette,
          text.checklistSpace,
        ].map((label) => ({ text: label, done: false })),
      },
      {
        spaceId: space.id,
        title: text.codeTitle,
        language: 'ts',
        content: SIGNAL_SNIPPET,
        source: text.codeSource,
        tags: [text.angularTag, text.exampleTag],
        pinned: false,
        // The one sample with a deadline: it is what puts a note in the untriaged
        // lights the ⏳ badge and gives the quick filter something to find.
        lifecycle: { kind: 'expires', at: this.deadline() },
        kind: 'snippet',
        items: [],
      },
    ];

    // Sequential on purpose: `created_at` orders the canvas, and parallel
    // writes would land in whatever order the bridge answered in.
    for (const draft of drafts) {
      await this.notes.create(draft);
    }

    return true;
  }

  /**
   * End of the local day, like the editor's date field: midnight would make a
   * note dated today expired on the spot.
   */
  private deadline(): Date {
    const at = new Date(this.clock.now());
    at.setDate(at.getDate() + DEADLINE_DAYS);
    at.setHours(23, 59, 59, 999);

    return at;
  }
}
