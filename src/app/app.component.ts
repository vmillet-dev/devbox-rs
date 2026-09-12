import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ErrorBannerComponent } from '@layout/error-banner/error-banner.component';
import { StatusToastComponent } from '@layout/status-toast/status-toast.component';
import { TitlebarComponent } from '@layout/titlebar/titlebar.component';
import { UpdatePromptComponent } from '@layout/update-prompt/update-prompt.component';

/**
 * The application's persistent frame: the features plug in through the outlet, not through
 * a direct import.
 */
@Component({
  selector: 'app-root',
  imports: [
    TitlebarComponent,
    ErrorBannerComponent,
    StatusToastComponent,
    RouterOutlet,
    UpdatePromptComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
