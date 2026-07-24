import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { Space } from '../../../../core/models/space.model';

@Component({
  selector: 'app-space-switcher',
  templateUrl: './space-switcher.component.html',
  styleUrl: './space-switcher.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class SpaceSwitcherComponent {
  readonly spaces = input.required<Space[]>();
  readonly activeSpace = input.required<Space>();

  readonly spaceChanged = output<string>();

  protected readonly open = signal(false);

  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected select(space: Space): void {
    this.spaceChanged.emit(space.id);
    this.open.set(false);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
