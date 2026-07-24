import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-titlebar',
  templateUrl: './titlebar.component.html',
  styleUrl: './titlebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitlebarComponent {
  readonly title = input('DevBox');
}
