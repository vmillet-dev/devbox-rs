import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { IpcError } from '@core/ipc/ipc.error';
import { VaultRepository } from '@core/data/vault.repository';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { FakeVaultRepository } from '@testing/fake-vault-repository';
import { provideAppTesting } from '@testing/testing.providers';
import { VaultStore } from './vault.store';

const REFUSED = new IpcError('unlock_vault', {
  code: 'wrongPassphrase',
  params: {},
  detail: 'Wrong passphrase',
});

describe('VaultStore', () => {
  let store: VaultStore;
  let repository: FakeVaultRepository;
  let notifier: ErrorNotifier;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideAppTesting()] });
    repository = TestBed.inject(VaultRepository) as unknown as FakeVaultRepository;
    store = TestBed.inject(VaultStore);
    notifier = TestBed.inject(ErrorNotifier);
  });

  /**
   * ⚠️ `null` is not "locked": the shell renders neither the canvas nor the gate until
   * Rust has answered, rather than flashing one and replacing it with the other.
   */
  it('knows nothing before the first answer', () => {
    expect(store.state()).toBeNull();
    expect(store.isUnlocked()).toBe(false);
    expect(store.needsCreating()).toBe(false);
  });

  it('reads the state from Rust, which is where it lives', async () => {
    repository.answer = 'locked';
    await store.load();

    expect(store.state()).toBe('locked');
    expect(store.isUnlocked()).toBe(false);
    expect(store.needsCreating()).toBe(false);
  });

  it('asks for a passphrase twice on a library that has never had one', async () => {
    repository.answer = 'absent';
    await store.load();

    expect(store.needsCreating()).toBe(true);
  });

  /** A page reload must not ask again for a library this process already has open. */
  it('stays unlocked for a front end that rebooted', async () => {
    repository.answer = 'unlocked';
    await store.load();

    expect(store.isUnlocked()).toBe(true);
  });

  it('reports a state it could not read rather than guessing', async () => {
    repository.failNext = new IpcError('vault_state', {
      code: 'storage',
      params: {},
      detail: 'no bridge',
    });

    await store.load();

    expect(store.state()).toBeNull();
    expect(notifier.notice()?.ref.key).toBe('errors.vaultStateFailed');
  });

  describe('opening the library', () => {
    it('unlocks with the phrase it was given', async () => {
      expect(await store.unlock('an end-to-end passphrase')).toBe(true);

      expect(repository.passphrases).toEqual(['an end-to-end passphrase']);
      expect(store.isUnlocked()).toBe(true);
    });

    it('creates on a first launch, and the library is open straight after', async () => {
      repository.answer = 'absent';
      await store.load();

      expect(await store.create('a first passphrase')).toBe(true);
      expect(store.isUnlocked()).toBe(true);
    });

    /**
     * ⚠️ A refused passphrase is the ordinary answer to a typo: it belongs beside the
     * field, never in the error banner, which is for things that went wrong.
     */
    it('refuses beside the field, not in the banner', async () => {
      repository.failNext = REFUSED;

      expect(await store.unlock('not it')).toBe(false);
      expect(store.refused()).toBe(true);
      expect(notifier.notice()).toBeNull();
      expect(store.isUnlocked()).toBe(false);
    });

    it('sends anything else to the banner, where failures go', async () => {
      repository.failNext = new IpcError('unlock_vault', {
        code: 'storage',
        params: {},
        detail: 'disk gone',
      });

      expect(await store.unlock('a passphrase')).toBe(false);
      expect(store.refused()).toBe(false);
      expect(notifier.notice()?.ref.key).toBe('errors.unlockFailed');
    });

    it('withdraws the refusal when the field is touched again', async () => {
      repository.failNext = REFUSED;
      await store.unlock('not it');

      store.clearRefusal();

      expect(store.refused()).toBe(false);
    });

    it('clears a standing refusal before trying again', async () => {
      repository.failNext = REFUSED;
      await store.unlock('not it');
      expect(store.refused()).toBe(true);

      expect(await store.unlock('the right one')).toBe(true);
      expect(store.refused()).toBe(false);
    });

    it('says it is working while the key is being derived', async () => {
      expect(store.isWorking()).toBe(false);

      const running = store.unlock('a passphrase');
      expect(store.isWorking()).toBe(true);

      await running;
      expect(store.isWorking()).toBe(false);
    });

    it('stops working even when the attempt failed', async () => {
      repository.failNext = REFUSED;

      await store.unlock('not it');

      expect(store.isWorking()).toBe(false);
    });
  });

  describe('changing the passphrase', () => {
    it('hands both phrases over and leaves the session open', async () => {
      repository.answer = 'unlocked';
      await store.load();

      expect(await store.changePassphrase('the old one', 'a longer phrase')).toBe(true);

      expect(repository.changes).toEqual([{ current: 'the old one', next: 'a longer phrase' }]);
      expect(store.isUnlocked()).toBe(true);
    });

    it('treats a refused current phrase as a refusal, not a failure', async () => {
      repository.failNext = REFUSED;

      expect(await store.changePassphrase('not the old one', 'a longer phrase')).toBe(false);
      expect(store.refused()).toBe(true);
      expect(notifier.notice()).toBeNull();
    });

    /** ⚠️ Its own message: "unlock failed" would be a lie about what was attempted. */
    it('reports anything else under its own name', async () => {
      repository.failNext = new IpcError('change_passphrase', {
        code: 'storage',
        params: {},
        detail: 'disk gone',
      });

      expect(await store.changePassphrase('the old one', 'a longer phrase')).toBe(false);
      expect(notifier.notice()?.ref.key).toBe('errors.passphraseChangeFailed');
    });
  });
});
