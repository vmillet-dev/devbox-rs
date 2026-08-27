import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { SelectionBarComponent } from './selection-bar.component';

const SPACES = [
  { id: 'space-1', name: 'Perso' },
  { id: 'space-2', name: 'Boulot' },
];

describe('SelectionBarComponent', () => {
  let fixture: ComponentFixture<SelectionBarComponent>;

  function actions(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.selection-action')];
  }

  function deleteButton(): HTMLButtonElement {
    return actions()[1];
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SelectionBarComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(SelectionBarComponent);
    fixture.componentRef.setInput('count', 3);
    fixture.componentRef.setInput('spaces', SPACES);
    fixture.autoDetectChanges();
  });

  it('announces how many notes are selected', () => {
    expect(fixture.nativeElement.querySelector('.selection-count').textContent).toContain('3');
  });

  it('offers every space as a move target', () => {
    const options = [...fixture.nativeElement.querySelectorAll('.selection-move option')];

    expect(options.map((option) => (option as HTMLOptionElement).textContent?.trim())).toEqual([
      'Déplacer vers',
      'Perso',
      'Boulot',
    ]);
  });

  it('emits the chosen space and resets the picker', async () => {
    let emitted: string | undefined;
    fixture.componentInstance.moveRequested.subscribe((id) => (emitted = id));
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('.selection-move');

    select.value = 'space-2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(emitted).toBe('space-2');
    // Sinon le sélecteur resterait figé sur la dernière destination et la
    // rejouer demanderait de repasser par « Déplacer vers ».
    expect(select.value).toBe('');
  });

  it('hides the move picker when there is nowhere to move to', async () => {
    fixture.componentRef.setInput('spaces', []);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.selection-move')).toBeNull();
  });

  it('emits the typed tag and clears the field', async () => {
    let emitted: string | undefined;
    fixture.componentInstance.tagRequested.subscribe((tag) => (emitted = tag));
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.selection-tag-input');
    input.value = '  urgent ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    fixture.debugElement
      .query(By.css('.selection-tag-form'))
      .triggerEventHandler('submit', new Event('submit'));
    await fixture.whenStable();

    expect(emitted).toBe('urgent');
    expect(input.value).toBe('');
  });

  it('does not emit a blank tag', async () => {
    let emitted = 0;
    fixture.componentInstance.tagRequested.subscribe(() => (emitted += 1));

    fixture.debugElement
      .query(By.css('.selection-tag-form'))
      .triggerEventHandler('submit', new Event('submit'));
    await fixture.whenStable();

    expect(emitted).toBe(0);
  });

  it('asks for a confirmation before trashing a whole selection', async () => {
    let emitted = 0;
    fixture.componentInstance.deleteRequested.subscribe(() => (emitted += 1));

    deleteButton().click();
    await fixture.whenStable();

    expect(emitted).toBe(0);
    expect(deleteButton().textContent).toContain('Confirmer');

    deleteButton().click();
    await fixture.whenStable();

    expect(emitted).toBe(1);
  });
});
