import { browser } from '@wdio/globals';
import { readFileSync, writeFileSync } from 'node:fs';

import { homeSpaceMarker } from './profile.js';

import type {
  Attachment,
  DisplayNote,
  ExportReport,
  ImportReport,
  NoteDraft,
  NotePatch,
  NotesQuery,
  NotesView,
  Space,
  SpaceDraft,
  TagUsage,
  TrashedNote,
} from '@core/ipc/bindings';

/**
 * Seeding a corpus by clicking would be slow and would test the seeding rather
 * than the scenario — so it goes through the same bridge the application uses,
 * into the same Rust, into the same database. The types come from the generated
 * `bindings.ts`, so a Rust signature that moves stops this file compiling. That
 * import is type-only and erased before `tsx` sees it: nothing here drags
 * `@tauri-apps/api` into the test process, which has no Tauri runtime of its own.
 *
 * ⚠️ `window.__TAURI__` (exposed by `withGlobalTauri` in `tauri.e2e.conf.json`) and
 * not `browser.tauri.execute`: the service resolves the latter through an HTTP
 * endpoint it only addresses correctly under the `embedded` driver provider, and
 * loses even that after a `reloadSession` — which is how a scenario restarts the
 * application. This path is the application's own `invoke`, and it survives both.
 */
async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const outcome = (await browser.executeAsync(
    (name: string, payload: Record<string, unknown>, done: (value: unknown) => void) => {
      const tauri = (window as unknown as Record<string, any>)['__TAURI__'];
      tauri.core
        .invoke(name, payload)
        .then((value: unknown) => done({ ok: value }))
        .catch((error: unknown) => done({ err: String(error) }));
    },
    command,
    args,
  )) as { ok?: T; err?: string };

  if (outcome.err !== undefined) {
    throw new Error(`${command} failed: ${outcome.err}`);
  }
  return outcome.ok as T;
}

export const bridge = {
  listSpaces: () => invoke<Space[]>('list_spaces'),
  createSpace: (draft: SpaceDraft) => invoke<Space>('create_space', { draft }),
  renameSpace: (id: string, draft: SpaceDraft) => invoke<Space>('rename_space', { id, draft }),
  deleteSpace: (id: string, targetSpaceId: string) => invoke<null>('delete_space', { id, targetSpaceId }),

  queryNotes: (query: NotesQuery) => invoke<NotesView>('query_notes', { query }),
  createNote: (draft: NoteDraft) => invoke<DisplayNote>('create_note', { draft }),
  updateNote: (id: string, patch: NotePatch) => invoke<DisplayNote>('update_note', { id, patch }),
  deleteNote: (id: string) => invoke<null>('delete_note', { id }),

  /** The batch commands answer with a count: a selection can hold an id that went stale. */
  deleteNotes: (ids: string[]) => invoke<number>('delete_notes', { ids }),
  moveNotes: (ids: string[], spaceId: string) => invoke<number>('move_notes', { ids, spaceId }),
  tagNotes: (ids: string[], tags: string[]) => invoke<number>('tag_notes', { ids, tags }),
  purgeNotes: (ids: string[]) => invoke<number>('purge_notes', { ids }),
  emptyTrash: () => invoke<number>('empty_trash'),

  listTrash: () => invoke<TrashedNote[]>('list_trash'),
  listTags: () => invoke<TagUsage[]>('list_tags'),
  renameTag: (tag: string, into: string) => invoke<number>('rename_tag', { tag, into }),
  listAttachments: (noteId: string) => invoke<Attachment[]>('list_attachments', { noteId }),
  listGlobalPlaceholders: () => invoke<Record<string, string>>('list_global_placeholders'),
  setGlobalPlaceholders: (values: Record<string, string>) =>
    invoke<Record<string, string>>('set_global_placeholders', { values }),

  exportNotes: (path: string, spaceId: string | null = null) =>
    invoke<ExportReport>('export_notes', { path, spaceId }),
  importNotes: (path: string) => invoke<ImportReport>('import_notes', { path }),
} as const;

/** A `NoteDraft` is exhaustive on the wire; a scenario only ever cares about two or three fields. */
export function draft(overrides: Partial<NoteDraft> & Pick<NoteDraft, 'spaceId'>): NoteDraft {
  return {
    title: '',
    language: 'txt',
    content: '',
    source: '',
    tags: [],
    pinned: false,
    lifecycle: { kind: 'permanent' },
    ...overrides,
  };
}

/** Same idea for the query: the canvas always sends `pinnedFirst`, and `now` has to be live. */
export function query(overrides: Partial<NotesQuery> = {}): NotesQuery {
  return {
    spaceId: null,
    search: '',
    filter: 'all',
    tags: [],
    languages: [],
    now: new Date().toISOString(),
    tzOffsetMinutes: new Date().getTimezoneOffset(),
    pinnedFirst: true,
    ...overrides,
  };
}

/**
 * Where a seeded note goes: the space the install seeded, by id, for the whole run.
 *
 * ⚠️ **Not** `listSpaces()[0]`. `list_spaces` orders by `name COLLATE NOCASE`, so the
 * first row is the alphabetically first space, not the seeded one — and a spec file
 * running after another created `Ops` or `Veille` would silently pick that one
 * instead. It worked only because `Découverte` and `Getting started` both sort early;
 * renaming the sample space, or adding a locale, would have moved it under the suite.
 *
 * Resolved once, while a virgin profile still holds exactly one space, then read back
 * from a file — WebdriverIO gives each spec file its own worker process, so a
 * module-level cache would be empty again in the next one. `resetProfile()` deletes
 * the note along with the profile, so a new run resolves it afresh.
 */
function readHomeSpaceId(): string | null {
  try {
    return readFileSync(homeSpaceMarker(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export async function homeSpaceId(): Promise<string> {
  const remembered = readHomeSpaceId();
  if (remembered) {
    return remembered;
  }

  const spaces = await bridge.listSpaces();
  const first = spaces[0];
  if (!first) {
    throw new Error('a fresh profile should have seeded one space');
  }
  if (spaces.length > 1) {
    throw new Error(
      `the seeded space is asked for with ${spaces.length} spaces present, so "the first one" is a ` +
        `guess. It has to be resolved while the profile is still virgin, in 01-first-launch. ` +
        `Found ${JSON.stringify(spaces.map((space) => space.name))}`,
    );
  }

  writeFileSync(homeSpaceMarker(), first.id, 'utf8');
  return first.id;
}
