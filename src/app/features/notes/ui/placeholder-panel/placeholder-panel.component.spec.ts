import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Placeholder } from '@features/notes/model/note.model';
import { provideAppTesting } from '@testing/testing.providers';
import { PlaceholderPanelComponent } from './placeholder-panel.component';

const FIELDS: Placeholder[] = [
  { name: 'host', defaultValue: '', value: '' },
  { name: 'port', defaultValue: '5432', value: '' },
];

describe('PlaceholderPanelComponent', () => {
  let fixture: ComponentFixture<PlaceholderPanelComponent>;

  function inputs(): HTMLInputElement[] {
    return [...fixture.nativeElement.querySelectorAll('.field-input')];
  }

  function toggle(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.panel-toggle');
  }

  /** Ce que la bande repliée dit de son contenu, espaces normalisés. */
  function summary(): string {
    return fixture.nativeElement.querySelector('.panel-summary').textContent.replace(/\s+/g, ' ').trim();
  }

  function action(label: string): HTMLButtonElement | undefined {
    return [...fixture.nativeElement.querySelectorAll('.panel-action')].find((button) =>
      (button as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
  }

  async function type(index: number, value: string): Promise<void> {
    inputs()[index].value = value;
    inputs()[index].dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  /** Ce que la sortie d'un champ produit : `focusout` remonte, `blur` non. */
  async function leaveField(): Promise<void> {
    fixture.nativeElement
      .querySelector('.panel-body')
      .dispatchEvent(new Event('focusout', { bubbles: true }));
    await fixture.whenStable();
  }

  /**
   * Le brouillon est amorcé à la construction, sur l'identifiant de la note :
   * un panneau ouvert sur d'autres valeurs est un panneau qu'on remonte, pas un
   * panneau auquel on repasse une entrée.
   */
  async function open(placeholders: readonly Placeholder[] = FIELDS): Promise<void> {
    fixture = TestBed.createComponent(PlaceholderPanelComponent);
    fixture.componentRef.setInput('placeholders', placeholders);
    fixture.componentRef.setInput('noteId', 'note-1');
    fixture.autoDetectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PlaceholderPanelComponent],
      providers: [provideAppTesting()],
    });
    await open();
  });

  it('opens on the fields the note carries, filled with what was already typed', async () => {
    await open([
      { name: 'host', defaultValue: '', value: 'db.internal' },
      { name: 'port', defaultValue: '5432', value: '' },
    ]);

    expect(inputs().map((input) => input.value)).toEqual(['db.internal', '']);
  });

  it('counts how many fields carry a value', async () => {
    await open([
      { name: 'host', defaultValue: '', value: 'db.internal' },
      { name: 'port', defaultValue: '5432', value: '' },
    ]);

    expect(fixture.nativeElement.querySelector('.panel-count').textContent.trim()).toBe('1/2');
  });

  it('shows only its header when collapsed', async () => {
    fixture.componentRef.setInput('open', false);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.panel-body')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.panel-count')).not.toBeNull();
  });

  it('says what the click does while it is collapsed', async () => {
    // Sans verbe, la bande se lit comme un titre de section : c'est ce qu'elle
    // était, et personne ne pensait à cliquer dessus.
    fixture.componentRef.setInput('open', false);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.panel-verb').textContent.trim()).toBe('Afficher');
  });

  it('summarises the values it hides once collapsed', async () => {
    await open([
      { name: 'host', defaultValue: '', value: 'db.internal' },
      { name: 'port', defaultValue: '5432', value: '' },
    ]);
    fixture.componentRef.setInput('open', false);
    await fixture.whenStable();

    // Un résumé se lit comme quelque chose à ouvrir, et répond sans clic à
    // « avec quoi je vais copier ? ».
    expect(summary()).toBe('host = db.internal');
  });

  it('names the first values and counts the rest', async () => {
    await open([
      { name: 'host', defaultValue: '', value: 'db' },
      { name: 'port', defaultValue: '', value: '5432' },
      { name: 'user', defaultValue: '', value: 'root' },
      { name: 'db', defaultValue: '', value: 'billing' },
    ]);
    fixture.componentRef.setInput('open', false);
    await fixture.whenStable();

    // Au-delà de deux, la bande déborderait au lieu de renseigner. Les
    // séparateurs sont dessinés en CSS, d'où la lecture ligne par ligne.
    expect(
      [...fixture.nativeElement.querySelectorAll('.panel-pair')].map((pair) =>
        (pair as HTMLElement).textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['host = db', 'port = 5432', '+2']);
  });

  it('summarises nothing while the panel is open', async () => {
    await open([{ name: 'host', defaultValue: '', value: 'db.internal' }]);

    // Les champs eux-mêmes sont à l'écran : le résumé ferait doublon.
    expect(fixture.nativeElement.querySelector('.panel-summary')).toBeNull();
    expect(fixture.nativeElement.querySelector('.panel-verb')).toBeNull();
  });

  it('follows the typing in the summary, before anything is saved', async () => {
    await type(0, 'db.staging');
    fixture.componentRef.setInput('open', false);
    await fixture.whenStable();

    expect(summary()).toBe('host = db.staging');
  });

  it('asks the editor to fold it rather than folding itself', async () => {
    let emitted = 0;
    fixture.componentInstance.toggled.subscribe(() => (emitted += 1));

    toggle().click();
    await fixture.whenStable();

    // La préférence appartient à l'éditeur : elle survit au passage d'une note
    // à l'autre, ce qu'un état interne au panneau ne ferait pas.
    expect(emitted).toBe(1);
  });

  it('reports every keystroke without writing anything', async () => {
    const emitted: Record<string, string>[] = [];
    fixture.componentInstance.valuesChanged.subscribe((values) => emitted.push(values));
    let committed = 0;
    fixture.componentInstance.valuesCommitted.subscribe(() => (committed += 1));

    await type(0, 'db');
    await type(0, 'db.internal');

    // L'aperçu suit la frappe ; la base, elle, attend la sortie du champ.
    expect(emitted).toEqual([
      { host: 'db', port: '' },
      { host: 'db.internal', port: '' },
    ]);
    expect(committed).toBe(0);
  });

  it('confirms the values when the field is left', async () => {
    let emitted: Record<string, string> | undefined;
    fixture.componentInstance.valuesCommitted.subscribe((values) => (emitted = values));

    await type(0, 'db.internal');
    await leaveField();

    expect(emitted).toEqual({ host: 'db.internal', port: '' });
  });

  it('stays silent when nothing was typed', async () => {
    let emitted = 0;
    fixture.componentInstance.valuesCommitted.subscribe(() => (emitted += 1));

    await leaveField();

    // Passer d'un champ à l'autre ne doit pas réécrire ce qui est déjà en base.
    expect(emitted).toBe(0);
  });

  it('does not confirm twice the same values', async () => {
    let emitted = 0;
    fixture.componentInstance.valuesCommitted.subscribe(() => (emitted += 1));

    await type(0, 'db.internal');
    await leaveField();
    await leaveField();

    expect(emitted).toBe(1);
  });

  it('confirms on demand, for the closing paths that produce no blur', async () => {
    let emitted: Record<string, string> | undefined;
    fixture.componentInstance.valuesCommitted.subscribe((values) => (emitted = values));
    await type(1, '6543');

    fixture.componentInstance.commit();
    await fixture.whenStable();

    expect(emitted).toEqual({ host: '', port: '6543' });
  });

  it('empties every field at once, and says so right away', async () => {
    await open([{ name: 'host', defaultValue: '', value: 'db.internal' }]);
    let emitted: Record<string, string> | undefined;
    fixture.componentInstance.valuesCommitted.subscribe((values) => (emitted = values));

    action('Vider')?.click();
    await fixture.whenStable();

    expect(emitted).toEqual({ host: '' });
    expect(inputs()[0].value).toBe('');
  });

  it('offers nothing to clear when no field carries a value', () => {
    expect(action('Vider')).toBeUndefined();
  });

  it('exposes the preview as a toggle owned by the editor', async () => {
    let emitted = 0;
    fixture.componentInstance.previewToggled.subscribe(() => (emitted += 1));
    fixture.componentRef.setInput('previewing', true);
    await fixture.whenStable();

    const preview = action('Aperçu');
    expect(preview?.getAttribute('aria-pressed')).toBe('true');

    preview?.click();
    await fixture.whenStable();
    expect(emitted).toBe(1);
  });

  it('starts over when another note is opened', async () => {
    await type(0, 'db.internal');

    fixture.componentRef.setInput('placeholders', [{ name: 'host', defaultValue: '', value: '' }]);
    fixture.componentRef.setInput('noteId', 'note-2');
    await fixture.whenStable();

    // Le brouillon est amorcé sur l'id, jamais sur la note : chaque
    // enregistrement en produit un nouvel objet, qui écraserait la saisie.
    expect(inputs()[0].value).toBe('');
  });
});
