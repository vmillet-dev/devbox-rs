import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import type {
  BoardNote as WireBoardNote,
  BoardView as WireBoardView,
  BoardZone as WireBoardZone,
} from '@core/ipc/bindings';
import { BoardNote, BoardQuery, BoardView, BoardZone } from '../model/board.model';
import { toIsoString, toNote } from './note.mapper';

/**
 * ⚠️ `BoardNote` spreads a `DisplayNote` on the wire, so the note has to be lifted out of
 * it here: `toNote` is what turns the ISO instants back into `Date`s.
 */
function toBoardNote({ matches, position, ...note }: WireBoardNote): BoardNote {
  return { note: toNote(note), matches, position };
}

function toZone(dto: WireBoardZone): BoardZone {
  return {
    folder: { ...dto.folder, colour: dto.folder.colour ?? 'blue', createdAt: new Date(dto.folder.createdAt) },
    frame: dto.frame,
    notes: dto.notes.map(toBoardNote),
  };
}

function toBoardView(dto: WireBoardView): BoardView {
  return { ...dto, zones: dto.zones.map(toZone), loose: dto.loose.map(toBoardNote) };
}

@Injectable({ providedIn: 'root' })
export class BoardRepository {
  async query(query: BoardQuery): Promise<BoardView> {
    const wire = {
      ...query,
      tags: [...query.tags],
      languages: [...query.languages],
      now: toIsoString(query.now, 'now'),
    };
    return toBoardView(unwrap('board_view', await commands.boardView(wire)));
  }
}
