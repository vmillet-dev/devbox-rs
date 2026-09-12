import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsStore } from '@core/settings/settings.store';
import { DEFAULT_SHORTCUTS } from '@core/shortcuts/shortcut.model';
import { DialogComponent } from '@shared/ui/dialog/dialog.component';

/**
 * Each chapter names two keys, `gettingStarted.chapters.<id>.title` and `.body`.
 *
 * Held here and not contributed through a registry, unlike the menu entries: a chapter
 * carries **no code**, so `layout/` imports nothing from a feature by listing them.
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
 * The written half of the pair the sample notes make, and the one that survives the day
 * they are deleted.
 */
@Component({
  selector: 'app-getting-started-dialog',
  imports: [DialogComponent, TranslocoPipe],
  templateUrl: './getting-started-dialog.component.html',
  styleUrl: './getting-started-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GettingStartedDialogComponent {
  private readonly settings = inject(SettingsStore);

  readonly closed = output<void>();

  protected readonly chapters = CHAPTERS;

  /**
   * Interpolated into every chapter, so a body can name a key without hard-coding it. The
   * quick-paste one follows the preference: a guide quoting the combination that shipped
   * would be wrong for anyone who changed it.
   */
  protected readonly keys = computed(() => ({
    palette: this.settings.paletteShortcut(),
    capture: DEFAULT_SHORTCUTS.capture,
    newNote: DEFAULT_SHORTCUTS.newNote,
  }));
}
