import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FakeUpdater } from '@testing/fake-updater';
import { UpdateStore } from './update.store';
import { UpdaterService } from './updater.service';

describe('UpdateStore', () => {
  let updater: FakeUpdater;
  let store: UpdateStore;
  let notifier: ErrorNotifier;

  beforeEach(() => {
    TestBed.resetTestingModule();
    updater = new FakeUpdater();
    TestBed.configureTestingModule({
      providers: [{ provide: UpdaterService, useValue: updater }],
    });
    store = TestBed.inject(UpdateStore);
    notifier = TestBed.inject(ErrorNotifier);
  });

  it('stays idle when the app is already up to date', async () => {
    await store.check();

    expect(store.status()).toBe('idle');
    expect(store.update()).toBeNull();
  });

  it('proposes the update without installing anything', async () => {
    updater.available = { version: '0.2.0', currentVersion: '0.1.0', notes: 'Corrections' };

    await store.check();

    expect(store.status()).toBe('available');
    expect(store.update()?.version).toBe('0.2.0');
    expect(updater.installCalls).toBe(0);
  });

  it('reports a failed check to the console but not to the user', async () => {
    // Offline or a dev build with a placeholder public key: this fails on every
    // launch, and a banner would be a daily reproach for nothing actionable.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    updater.checkError = new Error('network unreachable');

    await store.check();

    expect(store.status()).toBe('idle');
    expect(notifier.notice()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('installs and relaunches once the user accepts', async () => {
    updater.available = { version: '0.2.0', currentVersion: '0.1.0' };
    await store.check();

    await store.accept();

    expect(updater.installCalls).toBe(1);
    expect(updater.relaunched).toBe(true);
    expect(store.status()).toBe('installed');
  });

  it('exposes download progress as a whole percentage', async () => {
    updater.available = { version: '0.2.0', currentVersion: '0.1.0' };
    updater.progressSteps = [0.4237];
    await store.check();

    await store.accept();

    expect(store.progressPercent()).toBe(42);
  });

  it('leaves progress indeterminate when the total size is unknown', async () => {
    updater.available = { version: '0.2.0', currentVersion: '0.1.0' };
    updater.progressSteps = [null];
    await store.check();

    await store.accept();

    expect(store.progressPercent()).toBeNull();
  });

  it('surfaces an install failure and keeps the offer open for a retry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    updater.available = { version: '0.2.0', currentVersion: '0.1.0' };
    updater.installError = new Error('disk full');
    await store.check();

    await store.accept();

    expect(notifier.notice()?.ref.key).toBe('errors.updateFailed');
    expect(notifier.notice()?.detail).toBe('disk full');
    expect(store.status()).toBe('available');
    expect(store.update()).not.toBeNull();
    error.mockRestore();
  });

  it('releases the native resource when the user defers', async () => {
    updater.available = { version: '0.2.0', currentVersion: '0.1.0' };
    await store.check();

    await store.dismiss();

    expect(store.update()).toBeNull();
    expect(store.status()).toBe('idle');
    expect(updater.discarded).toBe(true);
  });

  it('ignores a dismissal while the installer is running', async () => {
    updater.available = { version: '0.2.0', currentVersion: '0.1.0' };
    updater.deferInstall = true;
    await store.check();
    const installing = store.accept();

    await store.dismiss();

    expect(store.status()).toBe('installing');
    expect(store.update()).not.toBeNull();

    updater.finishInstall();
    await installing;
  });

  it('ignores a second check while an update is already on the table', async () => {
    updater.available = { version: '0.2.0', currentVersion: '0.1.0' };
    await store.check();

    updater.available = { version: '0.3.0', currentVersion: '0.1.0' };
    await store.check();

    expect(store.update()?.version).toBe('0.2.0');
  });
});
