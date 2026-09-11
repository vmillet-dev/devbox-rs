/**
 * The **order is the value**: a rung's position in this list decides both the `z-index`
 * and which dialog Escape reaches, so adding one is a single entry here. No stylesheet
 * carries a modal `z-index`.
 *
 * ⚠️ The banners of `layout/` sit at 80 and must stay above every modal: they are
 * triggered from inside one, and a blurred backdrop over them would hide the
 * acknowledgement. Hence the base well below it.
 */
const LAYERS = ['editor', 'app', 'settings', 'update', 'palette', 'fields', 'zoom'] as const;

export type DialogLayer = (typeof LAYERS)[number];

const FIRST_RUNG = 50;

export function dialogRung(layer: DialogLayer): number {
  return FIRST_RUNG + LAYERS.indexOf(layer);
}

/**
 * - `fitted` — height follows the content, the panel is padded.
 * - `framed` — fixed height with a scrolling middle, so changing page does not make the
 *   panel jump under the cursor. Its sections carry their own padding.
 * - `bare` — no surface at all: what is shown *is* the content (an image).
 */
export type DialogVariant = 'fitted' | 'framed' | 'bare';
