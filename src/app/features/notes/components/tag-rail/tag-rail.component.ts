import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TagPillComponent } from '../../../../shared/ui/tag-pill/tag-pill.component';

@Component({
  selector: 'app-tag-rail',
  imports: [TagPillComponent],
  templateUrl: './tag-rail.component.html',
  styleUrl: './tag-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagRailComponent {
  readonly tags = input.required<string[]>();
  readonly activeTags = input.required<ReadonlySet<string>>();

  readonly tagToggled = output<string>();
}
