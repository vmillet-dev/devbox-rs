import { ShortcutGroup } from '@core/services/shortcuts/shortcut.model';
import { CANVAS_SHORTCUT_GROUP } from './canvas-keyboard.directive';

/**
 * The canvas group comes from [`CanvasKeyboardDirective`], where the same table also
 * binds the keys; the two below are documentation, their keys being handled by the editor
 * and by the palette themselves. Key names stay untranslated.
 */
export const NOTES_SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  CANVAS_SHORTCUT_GROUP,
  {
    id: 'notes.editor',
    labelKey: 'shortcuts.groups.editor',
    shortcuts: [
      { keys: ['Escape'], labelKey: 'shortcuts.editor.close' },
      { keys: ['Enter'], labelKey: 'shortcuts.editor.newItem' },
      { keys: ['Backspace'], labelKey: 'shortcuts.editor.removeItem' },
      { keys: ['Alt', '↑ ↓'], labelKey: 'shortcuts.editor.moveItem' },
    ],
  },
  {
    id: 'notes.palette',
    labelKey: 'shortcuts.groups.palette',
    shortcuts: [
      { keys: ['↑ ↓'], labelKey: 'shortcuts.palette.navigate' },
      { keys: ['Enter'], labelKey: 'shortcuts.palette.paste' },
      { keys: ['Tab'], labelKey: 'shortcuts.palette.open' },
      { keys: ['Escape'], labelKey: 'shortcuts.palette.close' },
    ],
  },
];
