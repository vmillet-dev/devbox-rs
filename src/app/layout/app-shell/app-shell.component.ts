import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ErrorBannerComponent } from '@shared/ui/error-banner/error-banner.component';
import { UpdatePromptComponent } from '@shared/ui/update-prompt/update-prompt.component';
import { TitlebarComponent } from '../titlebar/titlebar.component';

/**
 * Cadre persistant de l'application : barre de titre, bandeau d'erreur global,
 * pop-in de mise à jour, et zone de contenu pilotée par le routeur. Les features
 * (notes, et plus tard crypto / formatters) se branchent par l'outlet, pas par
 * un import direct.
 */
@Component({
  selector: 'app-shell',
  imports: [TitlebarComponent, ErrorBannerComponent, RouterOutlet, UpdatePromptComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {}
