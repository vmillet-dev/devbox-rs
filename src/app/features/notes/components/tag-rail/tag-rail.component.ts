import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TagPillComponent } from '@shared/ui/tag-pill/tag-pill.component';

@Component({
  selector: 'app-tag-rail',
  imports: [TagPillComponent, TranslocoPipe],
  templateUrl: './tag-rail.component.html',
  styleUrl: './tag-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagRailComponent {
  readonly tags = input.required<readonly string[]>();
  readonly activeTags = input.required<ReadonlySet<string>>();

  readonly tagToggled = output<string>();
}
