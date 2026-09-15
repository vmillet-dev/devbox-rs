import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { VaultStore } from '@core/state/vault.store';

/** What `create_vault` refuses below, said before the round trip rather than after it. */
const MINIMUM_LENGTH = 8;

/**
 * The screen that stands in front of everything until the library is open.
 *
 * ⚠️ The gate is here, at the root, and not in each store: the canvas is never mounted
 * while the library is locked, so no store has to hold a "locked" branch and no command
 * is called before it can be answered.
 */
@Component({
  selector: 'app-vault-gate',
  imports: [TranslocoPipe],
  templateUrl: './vault-gate.component.html',
  styleUrl: './vault-gate.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultGateComponent {
  protected readonly vault = inject(VaultStore);

  protected readonly passphrase = signal('');
  protected readonly confirmation = signal('');

  protected readonly isCreating = computed(() => this.vault.needsCreating());

  /**
   * ⚠️ Said here rather than left to the back end: a first launch that answers "too short"
   * after a 224 ms derivation reads as the application thinking about it.
   */
  protected readonly tooShort = computed(
    () => this.passphrase().length > 0 && this.passphrase().length < MINIMUM_LENGTH,
  );

  protected readonly mismatched = computed(
    () => this.isCreating() && this.confirmation().length > 0 && this.confirmation() !== this.passphrase(),
  );

  protected readonly canSubmit = computed(() => {
    if (this.vault.isWorking() || this.passphrase().length < MINIMUM_LENGTH) return false;

    return !this.isCreating() || this.confirmation() === this.passphrase();
  });

  protected readonly minimumLength = MINIMUM_LENGTH;

  private readonly passphraseField = viewChild<ElementRef<HTMLInputElement>>('passphraseField');

  constructor() {
    // ⚠️ Not the `autofocus` attribute, which the linter refuses: this screen is the only
    // thing there is, and the user opened the application to type into this field.
    afterNextRender(() => this.passphraseField()?.nativeElement.focus());
  }

  protected onPassphrase(value: string): void {
    this.passphrase.set(value);
    this.vault.clearRefusal();
  }

  protected onConfirmation(value: string): void {
    this.confirmation.set(value);
  }

  /**
   * ⚠️ The field is cleared whatever happens, success included: a passphrase left in a
   * DOM node is a passphrase in a memory dump, and the store never held it either.
   */
  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) return;

    const typed = this.passphrase();
    const created = this.isCreating();

    this.passphrase.set('');
    this.confirmation.set('');

    if (created) {
      await this.vault.create(typed);
    } else {
      await this.vault.unlock(typed);
    }
  }
}
