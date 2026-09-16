import { BoardFrame, BoardPoint } from '@core/model/board.model';

/**
 * The geometry a pointer drag needs, as plain functions. No signals and no DOM: the
 * arithmetic is the part worth testing, and it is the part that gets subtly wrong.
 *
 * ⚠️ HTML5 drag and drop does not work in this WebView and cannot be turned on —
 * `dragDropEnabled` has to stay `true` for the native file drop that feeds attachments,
 * which is exactly what stops the WebView seeing `dragstart` and `drop`. Everything here
 * is driven by pointer events, as checklist reordering already is.
 */

/** Below this, a pointer that moved is a click that wobbled. */
export const DRAG_THRESHOLD_PX = 4;

/** Mirrors `folders::board`, which clamps again before writing. */
export const MIN_ZONE_WIDTH = 264;
export const MIN_ZONE_HEIGHT = 212;

/** A zone drawn smaller than this was a click on the background, not a gesture. */
export const MIN_DRAWN_ZONE = 40;

export type GestureKind = 'card' | 'move-zone' | 'resize-zone' | 'draw-zone';

export interface Gesture {
  readonly kind: GestureKind;
  /** The folder or note being moved; empty while a new zone is being drawn. */
  readonly id: string;
  /** Where the pointer went down, in surface coordinates. */
  readonly origin: BoardPoint;
  /** Where the thing being moved started, so a drag keeps its grab offset. */
  readonly from: BoardFrame;
  readonly to: BoardFrame;
  /** Stays false until the pointer has actually travelled: a click must not persist. */
  readonly moved: boolean;
}

export function samePoint(a: BoardPoint, b: BoardPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export function sameFrame(a: BoardFrame, b: BoardFrame): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function hasTravelled(origin: BoardPoint, at: BoardPoint): boolean {
  return Math.abs(at.x - origin.x) >= DRAG_THRESHOLD_PX || Math.abs(at.y - origin.y) >= DRAG_THRESHOLD_PX;
}

/** Keeps the grab offset: a frame follows the pointer, it does not jump under it. */
export function movedTo(gesture: Gesture, at: BoardPoint): BoardFrame {
  return {
    x: Math.max(0, gesture.from.x + (at.x - gesture.origin.x)),
    y: Math.max(0, gesture.from.y + (at.y - gesture.origin.y)),
    width: gesture.from.width,
    height: gesture.from.height,
  };
}

/**
 * ⚠️ Resizing captures and releases nothing. Unreal's own rule — a comment owns whatever
 * it overlaps — was considered and refused: it silently refiles notes the day a frame is
 * stretched. Membership comes from the drop, in both directions.
 */
export function resizedTo(gesture: Gesture, at: BoardPoint): BoardFrame {
  return {
    x: gesture.from.x,
    y: gesture.from.y,
    width: Math.max(MIN_ZONE_WIDTH, gesture.from.width + (at.x - gesture.origin.x)),
    height: Math.max(MIN_ZONE_HEIGHT, gesture.from.height + (at.y - gesture.origin.y)),
  };
}

/** The rubber band, which reads the same whichever corner it was started from. */
export function drawnTo(origin: BoardPoint, at: BoardPoint): BoardFrame {
  return {
    x: Math.max(0, Math.min(origin.x, at.x)),
    y: Math.max(0, Math.min(origin.y, at.y)),
    width: Math.abs(at.x - origin.x),
    height: Math.abs(at.y - origin.y),
  };
}

/** A band barely dragged was a click on the background, and creates nothing. */
export function isWorthDrawing(frame: BoardFrame): boolean {
  return frame.width >= MIN_DRAWN_ZONE && frame.height >= MIN_DRAWN_ZONE;
}

/** What a drawn band becomes once it is a zone: never too small to drop a card into. */
export function asZone(frame: BoardFrame): BoardFrame {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(MIN_ZONE_WIDTH, frame.width),
    height: Math.max(MIN_ZONE_HEIGHT, frame.height),
  };
}

export function contains(frame: BoardFrame, point: BoardPoint): boolean {
  return (
    point.x >= frame.x &&
    point.x < frame.x + frame.width &&
    point.y >= frame.y &&
    point.y < frame.y + frame.height
  );
}

/**
 * Which zone a drop lands in, topmost first — `null` is the free background, and that is
 * a legitimate answer: dropping there takes a note out of its folder.
 */
export function zoneAt(
  frames: readonly { readonly id: string; readonly frame: BoardFrame }[],
  point: BoardPoint,
): string | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const candidate = frames[index];
    if (candidate && contains(candidate.frame, point)) return candidate.id;
  }
  return null;
}

/** Where a card dropped on the background sits: under the pointer, by its grab offset. */
export function cardPosition(gesture: Gesture, at: BoardPoint): BoardPoint {
  const frame = movedTo(gesture, at);
  return { x: frame.x, y: frame.y };
}
