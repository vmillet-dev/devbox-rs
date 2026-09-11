import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { TagManagerComponent } from './tag-manager.component';

const TAGS = [
  { tag: 'api', noteCount: 1 },
  { tag: 'auth', noteCount: 4 },
];

describe('TagManagerComponent', () => {
  let fixture: ComponentFixture<TagManagerComponent>;

  function items(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.tags-item')];
  }

  function applyButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.tags-action');
  }

  function deleteButton(): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('.tags-action')][1];
  }

  async function select(...tags: string[]): Promise<void> {
    fixture.componentRef.setInput('selected', new Set(tags));
    await fixture.whenStable();
  }

  async function type(value: string): Promise<void> {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.tags-target');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TagManagerComponent],
      providers: [provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(TagManagerComponent);
    fixture.componentRef.setInput('tags', TAGS);
    fixture.componentRef.setInput('selected', new Set<string>());
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('lists each tag with the number of notes carrying it', () => {
    expect(items().map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '#api 1 note(s)',
      '#auth 4 note(s)',
    ]);
  });

  it('exposes the selection as pressed toggles', async () => {
    await select('auth');

    expect(items().map((item) => item.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('calls it a rename for one tag and a merge for several', async () => {
    await select('auth');
    expect(applyButton().textContent?.trim()).toBe('Renommer');

    await select('auth', 'api');
    expect(applyButton().textContent?.trim()).toBe('Fusionner');
  });

  it('marks its actions unavailable without a selection', () => {
    expect(applyButton().getAttribute('aria-disabled')).toBe('true');
    expect(deleteButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('emits the target name and clears the field', async () => {
    let emitted: string | undefined;
    fixture.componentInstance.renameRequested.subscribe((into) => (emitted = into));
    await select('auth');
    await type('  identity ');

    fixture.debugElement.query(By.css('.tags-actions')).triggerEventHandler('submit', new Event('submit'));
    await fixture.whenStable();

    expect(emitted).toBe('identity');
    expect(fixture.nativeElement.querySelector('.tags-target').value).toBe('');
  });

  it('does not rename towards nothing', async () => {
    let emitted = 0;
    fixture.componentInstance.renameRequested.subscribe(() => (emitted += 1));
    await select('auth');
    await type('   ');

    fixture.debugElement.query(By.css('.tags-actions')).triggerEventHandler('submit', new Event('submit'));
    await fixture.whenStable();

    expect(emitted).toBe(0);
  });

  it('asks for a confirmation before dropping tags from the corpus', async () => {
    let emitted = 0;
    fixture.componentInstance.deleteRequested.subscribe(() => (emitted += 1));
    await select('auth');

    deleteButton().click();
    await fixture.whenStable();
    expect(emitted).toBe(0);
    expect(deleteButton().textContent).toContain('Confirmer');

    deleteButton().click();
    await fixture.whenStable();
    expect(emitted).toBe(1);
  });

  it('shows an empty state rather than empty controls', async () => {
    fixture.componentRef.setInput('tags', []);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.tags-state').textContent).toContain('Aucun tag');
    expect(fixture.nativeElement.querySelector('.tags-actions')).toBeNull();
  });
});
