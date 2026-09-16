import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { IpcError } from '@core/ipc/ipc.error';
import { VaultRepository } from '@core/data/vault.repository';
import { VaultStore } from '@core/state/vault.store';
import { FakeVaultRepository } from '@testing/fake-vault-repository';
import { provideAppTesting } from '@testing/testing.providers';
import { VaultGateComponent } from './vault-gate.component';

describe('VaultGateComponent', () => {
  let fixture: ComponentFixture<VaultGateComponent>;
  let repository: FakeVaultRepository;
  let store: VaultStore;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VaultGateComponent],
      providers: [provideAppTesting()],
    });
    repository = TestBed.inject(VaultRepository) as unknown as FakeVaultRepository;
    store = TestBed.inject(VaultStore);
    fixture = TestBed.createComponent(VaultGateComponent);
    fixture.autoDetectChanges();
  });

  function field(hook: string): HTMLInputElement | null {
    return fixture.debugElement.query(By.css(`[data-testid="${hook}"]`))?.nativeElement ?? null;
  }

  function submitButton(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('[data-testid="vault-submit"]')).nativeElement;
  }

  function problem(): string {
    return (
      fixture.debugElement.query(By.css('[data-testid="vault-problem"]')).nativeElement.textContent?.trim() ??
      ''
    );
  }

  async function type(hook: string, value: string): Promise<void> {
    const input = field(hook);
    if (input === null) throw new Error(`no field "${hook}"`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function open(state: 'absent' | 'locked'): Promise<void> {
    repository.answer = state;
    await store.load();
    await fixture.whenStable();
  }

  describe('unlocking an existing library', () => {
    beforeEach(async () => {
      await open('locked');
    });

    it('asks for one passphrase and no confirmation', () => {
      expect(field('vault-passphrase')).not.toBeNull();
      expect(field('vault-confirmation')).toBeNull();
    });

    it('will not submit an empty field', () => {
      expect(submitButton().disabled).toBe(true);
    });

    /**
     * ⚠️ Said before the round trip: deriving takes 224 ms, and answering "too short"
     * after it reads as the application thinking about it.
     */
    it('says a passphrase is too short without asking the back end', async () => {
      await type('vault-passphrase', 'short');

      expect(problem()).toContain('8');
      expect(submitButton().disabled).toBe(true);
      expect(repository.passphrases).toEqual([]);
    });

    it('hands the passphrase over once it is long enough', async () => {
      await type('vault-passphrase', 'correct horse');
      submitButton().click();
      await fixture.whenStable();

      expect(repository.passphrases).toEqual(['correct horse']);
    });

    /**
     * ⚠️ Whatever happens, success included: a passphrase left in a DOM node is a
     * passphrase in a memory dump.
     */
    it('clears the field as soon as it has been sent', async () => {
      await type('vault-passphrase', 'correct horse');
      submitButton().click();
      await fixture.whenStable();

      expect(field('vault-passphrase')?.value).toBe('');
    });

    /** A typo belongs beside the field that caused it, not in the global error banner. */
    it('says a refused passphrase in place rather than through the banner', async () => {
      repository.failNext = new IpcError('unlock_vault', {
        code: 'wrongPassphrase',
        params: {},
        detail: 'Wrong passphrase',
      });

      await type('vault-passphrase', 'battery staple');
      submitButton().click();
      await fixture.whenStable();

      expect(store.refused()).toBe(true);
      expect(problem()).not.toBe('');
    });

    it('withdraws the refusal as soon as the field is touched again', async () => {
      repository.failNext = new IpcError('unlock_vault', {
        code: 'wrongPassphrase',
        params: {},
        detail: 'Wrong passphrase',
      });
      await type('vault-passphrase', 'battery staple');
      submitButton().click();
      await fixture.whenStable();

      await type('vault-passphrase', 'b');

      expect(store.refused()).toBe(false);
    });
  });

  describe('protecting a library that has never been encrypted', () => {
    beforeEach(async () => {
      await open('absent');
    });

    it('asks for the passphrase twice', () => {
      expect(field('vault-passphrase')).not.toBeNull();
      expect(field('vault-confirmation')).not.toBeNull();
    });

    it('refuses to submit while the two entries differ', async () => {
      await type('vault-passphrase', 'correct horse');
      await type('vault-confirmation', 'correct hors');

      expect(submitButton().disabled).toBe(true);
      expect(problem()).not.toBe('');
    });

    it('creates once both entries agree', async () => {
      await type('vault-passphrase', 'correct horse');
      await type('vault-confirmation', 'correct horse');
      submitButton().click();
      await fixture.whenStable();

      expect(repository.passphrases).toEqual(['correct horse']);
      expect(store.isUnlocked()).toBe(true);
    });

    /** It cannot be recovered, and this is the only moment that can still be acted on. */
    it('says plainly that a lost passphrase is a lost library', () => {
      const warning = fixture.debugElement.query(By.css('.warning'));

      expect(warning).not.toBeNull();
      expect(warning.nativeElement.textContent.trim()).not.toBe('');
    });
  });
});
