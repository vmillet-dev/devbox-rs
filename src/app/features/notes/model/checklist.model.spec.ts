import { describe, expect, it } from 'vitest';
import { checklistProgress, checklistToText, noteCopyText } from './checklist.model';

/** Un littéral, pour garder les chaînes attendues sur une seule ligne. */
const NEWLINE = String.fromCharCode(10);

describe('checklistProgress', () => {
  it('counts what is ticked', () => {
    expect(
      checklistProgress([
        { text: 'a', done: true },
        { text: 'b', done: false },
        { text: 'c', done: true },
      ]),
    ).toEqual({ done: 2, total: 3, percent: 67 });
  });

  it('reads an empty list as nothing done rather than everything done', () => {
    // Dividing by zero would show a full bar on a list holding no task at all.
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('reaches exactly 100 when every task is ticked', () => {
    expect(checklistProgress([{ text: 'a', done: true }]).percent).toBe(100);
  });
});

describe('checklistToText', () => {
  it('renders the markdown task list a ticket or a message expects', () => {
    const text = checklistToText([
      { text: 'Relire', done: true },
      { text: 'Déployer', done: false },
    ]);

    expect(text).toBe(['- [x] Relire', '- [ ] Déployer'].join(NEWLINE));
  });

  it('renders an empty list as nothing at all', () => {
    expect(checklistToText([])).toBe('');
  });
});

describe('noteCopyText', () => {
  it('copies the body of an ordinary note', () => {
    expect(noteCopyText({ kind: 'snippet', content: 'select 1', items: [] })).toBe('select 1');
  });

  it('copies the rendered list of a checklist, which has no body', () => {
    // Sans ça la carte et la palette poseraient une chaîne vide dans le
    // presse-papier.
    expect(noteCopyText({ kind: 'checklist', content: '', items: [{ text: 'Relire', done: false }] })).toBe(
      '- [ ] Relire',
    );
  });
});
