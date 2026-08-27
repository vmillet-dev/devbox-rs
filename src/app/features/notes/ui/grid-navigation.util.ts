/**
 * Déplacement du focus dans une grille dont le nombre de colonnes n'est connu
 * qu'à l'écran : il dépend de la largeur de la fenêtre, et les sections n'ont
 * pas toutes le même nombre de cartes.
 *
 * D'où des **positions mesurées** plutôt qu'un nombre de colonnes : les lignes
 * se déduisent des `top` identiques, et la colonne la plus proche se choisit sur
 * `left`. Fonction pure, donc testable sans DOM.
 */
export interface CardBox {
  readonly top: number;
  readonly left: number;
}

export type FocusDirection = 'prev' | 'next' | 'up' | 'down';

/** Deux cartes de la même ligne peuvent différer de quelques pixels. */
const ROW_TOLERANCE = 4;

function rowsOf(boxes: readonly CardBox[]): number[][] {
  const rows: number[][] = [];

  boxes.forEach((box, index) => {
    const row = rows.find((candidate) => {
      const first = boxes[candidate[0]];
      return Math.abs(first.top - box.top) <= ROW_TOLERANCE;
    });

    if (row) {
      row.push(index);
    } else {
      rows.push([index]);
    }
  });

  return rows;
}

/**
 * Renvoie l'index à focaliser, ou `current` quand le déplacement sort de la
 * grille — buter en silence vaut mieux que de reboucler, qui ferait perdre de
 * vue où on en est.
 */
export function nextFocusIndex(
  boxes: readonly CardBox[],
  current: number,
  direction: FocusDirection,
): number {
  if (boxes.length === 0) return -1;
  if (current < 0 || current >= boxes.length) return 0;

  if (direction === 'prev') return Math.max(0, current - 1);
  if (direction === 'next') return Math.min(boxes.length - 1, current + 1);

  const rows = rowsOf(boxes);
  const rowIndex = rows.findIndex((row) => row.includes(current));
  const targetRow = rows[rowIndex + (direction === 'down' ? 1 : -1)];
  if (!targetRow) return current;

  const { left } = boxes[current];

  return targetRow.reduce((closest, candidate) =>
    Math.abs(boxes[candidate].left - left) < Math.abs(boxes[closest].left - left) ? candidate : closest,
  );
}
