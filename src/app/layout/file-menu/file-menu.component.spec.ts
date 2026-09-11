import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppMenuRegistry } from '@core/menu/app-menu.registry';
import { APP_WINDOW_ADAPTER } from '@core/window/app-window.service';
import { FakeAppWindow } from '@testing/fake-app-window';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { FileMenuComponent } from './file-menu.component';

describe('FileMenuComponent', () => {
  let fixture: ComponentFixture<FileMenuComponent>;
  let registry: AppMenuRegistry;
  let appWindow: FakeAppWindow;

  function trigger(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.file-trigger');
  }

  function options(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.file-option')];
  }

  function optionLabelled(label: string): HTMLButtonElement {
    const found = options().find((option) => option.textContent?.includes(label));
    if (!found) throw new Error(`No menu option labelled "${label}"`);
    return found;
  }

  async function openMenu(): Promise<void> {
    trigger().click();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    appWindow = new FakeAppWindow();
    TestBed.configureTestingModule({
      imports: [FileMenuComponent],
      providers: [provideTranslocoTesting(), { provide: APP_WINDOW_ADAPTER, useValue: appWindow }],
    });
    registry = TestBed.inject(AppMenuRegistry);
    fixture = TestBed.createComponent(FileMenuComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('keeps its panel closed until asked', () => {
    expect(options()).toHaveLength(0);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('always offers the preferences and quitting, even with no feature loaded', async () => {
    // Les deux règlent l'application elle-même : elles ne passent pas par le
    // registre, et un outil non chargé ne les fait pas disparaître.
    await openMenu();

    expect(options().map((option) => option.textContent?.trim())).toEqual(['Préférences…', 'Quitter DevBox']);
  });

  it('opens the preferences panel, closing the menu behind it', async () => {
    await openMenu();

    optionLabelled('Préférences').click();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('app-settings-dialog')).not.toBeNull();
    expect(options()).toHaveLength(0);
  });

  it('renders what the features contributed, in order', async () => {
    registry.register([
      { id: 'b', labelKey: 'file.exportAll', order: 20, run: () => undefined },
      { id: 'a', labelKey: 'file.import', order: 10, run: () => undefined },
    ]);
    await openMenu();

    expect(options().map((option) => option.textContent?.trim())).toEqual([
      'Importer…',
      'Exporter tout…',
      'Préférences…',
      'Quitter DevBox',
    ]);
  });

  it('runs the entry and closes, the report showing elsewhere', async () => {
    // Un sélecteur de fichiers natif passe devant : rouvrir le menu pour lire le
    // résultat serait absurde, d'où le bandeau sous la barre de titre.
    let ran = 0;
    registry.register([{ id: 'a', labelKey: 'file.import', order: 10, run: () => (ran += 1) }]);
    await openMenu();

    optionLabelled('Importer').click();
    await fixture.whenStable();

    expect(ran).toBe(1);
    expect(options()).toHaveLength(0);
  });

  it('refuses to run a disabled entry', async () => {
    let ran = 0;
    registry.register([
      {
        id: 'a',
        labelKey: 'file.exportSelection',
        order: 10,
        disabled: signal(true),
        run: () => (ran += 1),
      },
    ]);
    await openMenu();

    const option = optionLabelled('Exporter la sélection');
    expect(option.getAttribute('aria-disabled')).toBe('true');

    option.click();
    await fixture.whenStable();

    expect(ran).toBe(0);
  });

  it('quits only on a second click', async () => {
    await openMenu();

    optionLabelled('Quitter').click();
    await fixture.whenStable();

    expect(appWindow.exitedWith).toBeNull();
    expect(optionLabelled('Confirmer')).toBeTruthy();

    optionLabelled('Confirmer').click();
    await fixture.whenStable();

    expect(appWindow.exitedWith).toBe(0);
  });

  it('forgets a pending quit confirmation when the menu closes', async () => {
    await openMenu();
    optionLabelled('Quitter').click();
    await fixture.whenStable();

    trigger().click();
    await fixture.whenStable();
    await openMenu();

    expect(optionLabelled('Quitter').textContent).not.toContain('Confirmer');
  });
});
