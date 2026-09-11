import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsStore } from '@core/settings/settings.store';
import { DEFAULT_SHORTCUTS } from '@core/shortcuts/shortcut.model';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';

/**
 * The chapters of the guide, in reading order. Each one names two keys,
 * `gettingStarted.chapters.<id>.title` and `.body`.
 *
 * Held here and not contributed through a registry, unlike the menu entries and
 * the shortcut groups: a chapter carries **no code** — nothing to run, nothing
 * a feature has to be loaded to provide — so `layout/` imports nothing from a
 * feature by listing them. Adding the hashing tool's chapter will be a text
 * change, in this array and in both locales.
 */
const CHAPTERS = [
  'notes',
  'spaces',
  'organise',
  'fields',
  'checklists',
  'palette',
  'attachments',
  'trash',
  'transfer',
] as const;

/**
 * "Prise en main": what the application can do, in the order one meets it.
 *
 * The sample notes created on first launch show the same features with real
 * notes; this is the written half of the pair, and the one that survives the
 * day they are deleted.
 */
@Component({
  selector: 'app-getting-started-dialog',
  imports: [DialogBackdropDirective, FocusTrapDirective, TranslocoPipe],
  templateUrl: './getting-started-dialog.component.html',
  styleUrl: './getting-started-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class GettingStartedDialogComponent {
  private readonly settings = inject(SettingsStore);

  readonly closed = output<void>();

  protected readonly chapters = CHAPTERS;

  /**
   * Interpolated into every chapter, so a body can name a key without hard-coding
   * it. The quick-paste one follows the preference: a guide quoting the combination
   * that shipped would be wrong for anyone who changed it.
   */
  protected readonly keys = computed(() => ({
    palette: this.settings.paletteShortcut(),
    capture: DEFAULT_SHORTCUTS.capture,
    newNote: DEFAULT_SHORTCUTS.newNote,
  }));
}
