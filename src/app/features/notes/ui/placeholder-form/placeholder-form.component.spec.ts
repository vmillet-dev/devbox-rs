import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { PlaceholderFormComponent } from './placeholder-form.component';

const FIELDS = [
  { name: 'host', defaultValue: '' },
  { name: 'port', defaultValue: '5432' },
];

describe('PlaceholderFormComponent', () => {
  let fixture: ComponentFixture<PlaceholderFormComponent>;

  function inputs(): HTMLInputElement[] {
    return [...fixture.nativeElement.querySelectorAll('.fields-input')];
  }

  async function type(index: number, value: string): Promise<void> {
    inputs()[index].value = value;
    inputs()[index].dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    fixture.debugElement.query(By.css('.fields-panel')).triggerEventHandler('submit', new Event('submit'));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PlaceholderFormComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(PlaceholderFormComponent);
    fixture.componentRef.setInput('placeholders', FIELDS);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('renders one row per field, named', () => {
    expect(
      [...fixture.nativeElement.querySelectorAll('.fields-name')].map((el) =>
        (el as HTMLElement).textContent?.trim(),
      ),
    ).toEqual(['host', 'port']);
  });

  it('seeds each field with its default value', () => {
    // Elles sont là pour être gardées : retaper « 5432 » à chaque copie serait
    // exactement ce que le snippet évite.
    expect(inputs().map((input) => input.value)).toEqual(['', '5432']);
  });

  it('submits every field, defaults included', async () => {
    let emitted: Record<string, string> | undefined;
    fixture.componentInstance.submitted.subscribe((values) => (emitted = values));
    await type(0, 'db.internal');

    await submit();

    expect(emitted).toEqual({ host: 'db.internal', port: '5432' });
  });

  it('lets a value be emptied on purpose', async () => {
    // C'est le back qui décide ce qu'un champ vide vaut : le formulaire
    // transmet, il n'interprète pas.
    let emitted: Record<string, string> | undefined;
    fixture.componentInstance.submitted.subscribe((values) => (emitted = values));
    await type(1, '');

    await submit();

    expect(emitted).toEqual({ host: '', port: '' });
  });

  it('offers a raw copy for a note that only looks templated', async () => {
    let emitted = 0;
    fixture.componentInstance.rawRequested.subscribe(() => (emitted += 1));

    const raw = [...fixture.nativeElement.querySelectorAll('.fields-action')].find((button) =>
      (button as HTMLElement).textContent?.includes('tel quel'),
    ) as HTMLButtonElement;
    raw.click();
    await fixture.whenStable();

    expect(emitted).toBe(1);
  });

  it('says how many values the snippet expects', () => {
    expect(fixture.nativeElement.querySelector('.fields-hint').textContent).toContain('2');
  });
});
