import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsStore } from '@core/services/settings/settings.store';
import { DEFAULT_SHORTCUTS } from '@core/services/shortcuts/shortcut.model';
import { CHECK_KEY } from '@shared/directives/canvas-keyboard.directive';
import { DialogComponent } from '@shared/layout/dialog/dialog.component';

/** Each chapter names two keys, `gettingStarted.chapters.<id>.title` and `.body`. */
const CHAPTERS = [
  'notes',
  'spaces',
  'folders',
  'organise',
  'fields',
  'checklists',
  'palette',
  'attachments',
  'trash',
  'transfer',
] as const;

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
   * ⚠️ Interpolated into every chapter, because Transloco replaces an unknown `{{name}}`
   * with the empty string — a body cannot spell a key out. The quick-paste one follows
   * the preference rather than the combination that shipped.
   */
  protected readonly keys = computed(() => ({
    palette: this.settings.paletteShortcut(),
    capture: DEFAULT_SHORTCUTS.capture,
    newNote: DEFAULT_SHORTCUTS.newNote,
    check: CHECK_KEY,
  }));
}
