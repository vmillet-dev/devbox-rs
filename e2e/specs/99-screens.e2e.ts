import { browser } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { board, spaces } from '../pageobjects/overlays.page.js';
import { reloadCanvas, waitForCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId } from '../support/bridge.js';

/** Throwaway: photographs the cards so a human can look at them. */
describe('Screens', () => {
  before(async () => {
    await canvas.open();
    const homeId = await homeSpaceId();
    const spaceId = (await bridge.createSpace({ name: 'Photos' })).id;

    const perf = await bridge.createFolder({ spaceId, name: 'Perf' });
    await bridge.createFolder({ spaceId, name: 'Migrations' });

    const one = await bridge.createNote(
      draft({
        spaceId,
        title: 'Connexion psql',
        content: 'psql -h {{host}} -p {{port=5432}} -U {{user}} -d {{database}}',
        language: 'sh',
        tags: ['exemple', 'sql'],
      }),
    );
    await bridge.fileNotes([one.id], perf.id);
    await bridge.createNote(
      draft({
        spaceId,
        title: 'Un titre vraiment long qui doit tenir sur deux lignes sans être coupé',
        content: 'readonly count = signal(0);\nreadonly doubled = computed(() => this.count() * 2);',
        language: 'ts',
        tags: ['angular'],
      }),
    );
    await bridge.createNote(
      draft({
        spaceId,
        title: 'Avant la release',
        kind: 'checklist',
        items: [
          { text: 'Tag', done: true },
          { text: 'Notes de version', done: false },
        ],
      }),
    );
    await bridge.createNote(draft({ spaceId: homeId, title: 'Ailleurs' }));

    await reloadCanvas();
    await spaces.open();
    await spaces.option(spaceId).click();
    await waitForCanvas();
  });

  it('photographs the date view', async () => {
    await board.show('date');
    await browser.saveScreenshot('./e2e/shots/01-date.png');
  });

  it('photographs the board', async () => {
    await board.show('board');
    await browser.saveScreenshot('./e2e/shots/02-board.png');
  });
});
