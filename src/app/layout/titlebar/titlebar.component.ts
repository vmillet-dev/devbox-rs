import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-titlebar',
  templateUrl: './titlebar.component.html',
  styleUrl: './titlebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitlebarComponent {
  readonly title = input('DevBox');
}
