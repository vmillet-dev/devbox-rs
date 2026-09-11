import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsRegistry } from '@core/settings/settings-registry';
import { provideAppTesting } from '@testing/testing.providers';
import { SettingsDialogComponent } from './settings-dialog.component';

@Component({
  selector: 'app-contributed-page',
  template: '<p class="contributed">Contribué</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ContributedPageComponent {}

describe('SettingsDialogComponent', () => {
  let fixture: ComponentFixture<SettingsDialogComponent>;
  let registry: SettingsRegistry;

  function railOptions(): HTMLButtonElement[] {
    return [...fixture.nativeElement.querySelectorAll('.settings-rail-option')];
  }

  function optionLabelled(label: string): HTMLButtonElement {
    const found = railOptions().find((option) => option.textContent?.includes(label));
    if (!found) throw new Error(`No rail option labelled "${label}"`);
    return found;
  }

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(SettingsDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SettingsDialogComponent],
      providers: [provideAppTesting()],
    });
    registry = TestBed.inject(SettingsRegistry);
  });

  it('is a modal dialog labelled by its own title', async () => {
    await render();

    const panel = fixture.nativeElement.querySelector('.settings-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe('settings-dialog-title');
  });

  it('offers its own page even with no feature loaded', async () => {
    await render();

    expect(railOptions().map((option) => option.textContent?.trim())).toEqual(['Paramètres']);
  });

  it('shows what a feature contributed, after its own page', async () => {
    registry.register([
      {
        id: 'notes.variables',
        labelKey: 'settings.pages.variables',
        order: 20,
        component: ContributedPageComponent,
      },
    ]);
    await render();

    expect(railOptions().map((option) => option.textContent?.trim())).toEqual(['Paramètres', 'Variables']);
  });

  it('opens on the settings page, which is what the menu entry promised', async () => {
    registry.register([
      {
        id: 'notes.variables',
        labelKey: 'settings.pages.variables',
        order: 20,
        component: ContributedPageComponent,
      },
    ]);
    await render();

    expect(optionLabelled('Paramètres').getAttribute('aria-current')).toBe('page');
    expect(fixture.nativeElement.querySelector('.contributed')).toBeNull();
  });

  it('renders the contributed page without knowing anything about it', async () => {
    registry.register([
      {
        id: 'notes.variables',
        labelKey: 'settings.pages.variables',
        order: 20,
        component: ContributedPageComponent,
      },
    ]);
    await render();

    optionLabelled('Variables').click();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.contributed')).not.toBeNull();
  });

  it('falls back to the first page when the chosen one is unregistered', async () => {
    registry.register([
      {
        id: 'notes.variables',
        labelKey: 'settings.pages.variables',
        order: 20,
        component: ContributedPageComponent,
      },
    ]);
    await render();
    optionLabelled('Variables').click();
    await fixture.whenStable();

    // La feature se décharge : sa page part avec elle.
    registry.unregister(['notes.variables']);
    await fixture.whenStable();

    expect(optionLabelled('Paramètres').getAttribute('aria-current')).toBe('page');
  });

  it('emits on the close button, on Escape and on a backdrop click', async () => {
    await render();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fixture.nativeElement.querySelector('.settings-close').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.nativeElement.querySelector('.settings-backdrop').click();
    await fixture.whenStable();

    expect(closed).toHaveBeenCalledTimes(3);
  });
});
