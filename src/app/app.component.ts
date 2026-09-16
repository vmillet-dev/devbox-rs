import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ErrorBannerComponent } from '@banners/error-banner/error-banner.component';
import { StatusToastComponent } from '@banners/status-toast/status-toast.component';
import { TitlebarComponent } from '@titlebar/titlebar.component';
import { UpdatePromptComponent } from '@banners/update-prompt/update-prompt.component';
import { PassphrasePromptComponent } from './passphrase-prompt/passphrase-prompt.component';
import { VaultGateComponent } from './vault-gate/vault-gate.component';
import { VaultStore } from '@core/state/vault.store';

@Component({
  selector: 'app-root',
  imports: [
    TitlebarComponent,
    ErrorBannerComponent,
    StatusToastComponent,
    RouterOutlet,
    UpdatePromptComponent,
    VaultGateComponent,
    PassphrasePromptComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly vault = inject(VaultStore);
}
