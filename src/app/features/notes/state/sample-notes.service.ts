import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ClockService } from '@core/time/clock.service';
import { PreferencesService } from '@core/preferences/preferences.service';
import { NotesRepository } from '../data/notes.repository';
import { SpacesRepository } from '../data/spaces.repository';
import { NoteDraft } from '../model/note.model';

/**
 * Written once the samples have been offered, whatever came of it. A second
 * pass would file a second copy of everything the day someone deletes them.
 */
const SEEDED_KEY = 'devbox.notes.samplesSeeded';

/** Days before the sample with a deadline falls due. */
const DEADLINE_DAYS = 7;

/**
 * Bodies that are **code**, and so are not translated.
 *
 * They also could not be: Transloco reads `{{name}}` as an interpolation and
 * would replace the snippet's fields with empty strings on the way out. A note
 * demonstrating `{{fields}}` has to carry them from here.
 */
const PSQL_SNIPPET = 'psql -h {{host}} -p {{port=5432}} -U {{user}} -d {{database}}';

const SIGNAL_SNIPPET = `readonly count = signal(0);
readonly doubled = computed(() => this.count() * 2);

increment(): void {
  this.count.update((value) => value + 1);
}`;

/** The keys read in one go, in the order [`seedIfFirstRun`] destructures them. */
const KEYS = [
  'notes.samples.space',
  'notes.samples.welcome.title',
  'notes.samples.welcome.content',
  'notes.samples.welcome.source',
  'notes.samples.snippet.title',
  'notes.samples.snippet.source',
  'notes.samples.checklist.title',
  'notes.samples.checklist.open',
  'notes.samples.checklist.copy',
  'notes.samples.checklist.fields',
  'notes.samples.checklist.palette',
  'notes.samples.checklist.space',
  'notes.samples.code.title',
  'notes.samples.code.source',
  'notes.samples.tags.devbox',
  'notes.samples.tags.example',
  'notes.samples.tags.database',
  'notes.samples.tags.angular',
];

/**
 * The notes a brand-new installation opens on.
 *
 * An empty canvas is the worst possible introduction: no space, so not even a
 * note can be created — the button is refused on purpose when there is nowhere
 * to file one. These four samples carry one feature each (pin, `{{fields}}`,
 * checklist, deadline), and they are ordinary notes: editing or trashing them
 * is the point.
 *
 * **The content comes from the front end**, not from a seed in Rust, because it
 * is user-facing text and the back end writes none — it would ship French into
 * an English interface. It also means the samples arrive in the language the
 * application starts in.
 *
 * Lives in `state/` rather than `data/`: it orchestrates the repositories the
 * way a store does, it just has no state of its own to expose.
 */
@Injectable({ providedIn: 'root' })
export class SampleNotesService {
  private readonly notes = inject(NotesRepository);
  private readonly spaces = inject(SpacesRepository);
  private readonly preferences = inject(PreferencesService);
  private readonly transloco = inject(TranslocoService);
  private readonly clock = inject(ClockService);

  /**
   * Files the samples when this is a fresh installation, and says whether it
   * did — the caller reloads its stores on a `true`.
   *
   * Two guards, not one. The marker alone would re-seed anyone whose
   * preferences file is missing; "no space at all" alone would re-seed the day
   * the last space disappears. Together they only ever match a database that
   * has never been written to.
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
      // its own failure, and a second banner about samples nobody asked for
      // would only add noise.
      return false;
    }
  }

  private async seed(): Promise<boolean> {
    const [
      spaceName,
      welcomeTitle,
      welcomeContent,
      welcomeSource,
      snippetTitle,
      snippetSource,
      checklistTitle,
      checklistOpen,
      checklistCopy,
      checklistFields,
      checklistPalette,
      checklistSpace,
      codeTitle,
      codeSource,
      devboxTag,
      exampleTag,
      databaseTag,
      angularTag,
    ] = await firstValueFrom(this.transloco.selectTranslate<string[]>(KEYS));

    const space = await this.spaces.create({ name: spaceName });
    // Written before the notes: a failure halfway through leaves an incomplete
    // set, which is still better than a second full set on the next launch.
    this.preferences.write(SEEDED_KEY, 'true');

    const drafts: NoteDraft[] = [
      {
        spaceId: space.id,
        title: welcomeTitle,
        language: 'md',
        content: welcomeContent,
        source: welcomeSource,
        tags: [devboxTag],
        // Pinned so it opens the canvas, and so the "pinned" section is not an
        // empty heading on the first screen.
        pinned: true,
        lifecycle: { kind: 'permanent' },
        kind: 'snippet',
        items: [],
      },
      {
        spaceId: space.id,
        title: snippetTitle,
        language: 'sh',
        content: PSQL_SNIPPET,
        source: snippetSource,
        tags: [databaseTag, exampleTag],
        pinned: false,
        lifecycle: { kind: 'permanent' },
        kind: 'snippet',
        items: [],
      },
      {
        spaceId: space.id,
        title: checklistTitle,
        language: 'txt',
        content: '',
        source: '',
        tags: [devboxTag],
        pinned: false,
        lifecycle: { kind: 'permanent' },
        kind: 'checklist',
        items: [checklistOpen, checklistCopy, checklistFields, checklistPalette, checklistSpace].map(
          (text) => ({ text, done: false }),
        ),
      },
      {
        spaceId: space.id,
        title: codeTitle,
        language: 'ts',
        content: SIGNAL_SNIPPET,
        source: codeSource,
        tags: [angularTag, exampleTag],
        pinned: false,
        // The one sample with a deadline: it is what puts a note in "à trier",
        // lights the ⏳ badge and gives the quick filter something to find.
        lifecycle: { kind: 'expires', at: this.deadline() },
        kind: 'snippet',
        items: [],
      },
    ];

    // Sequential on purpose: `created_at` orders the canvas, and four parallel
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
