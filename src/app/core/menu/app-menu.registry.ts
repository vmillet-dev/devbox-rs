import { Injectable, Signal } from '@angular/core';
import { Contribution, ContributionRegistry } from '@core/contributions/contribution.registry';

/**
 * `disabled` is a signal and not a boolean: "Export selection" depends on what is ticked
 * right now, and a value frozen at registration would stop matching the screen a second
 * later.
 */
export interface AppMenuEntry extends Contribution {
  readonly labelKey: string;
  readonly disabled?: Signal<boolean>;
  readonly run: () => void;
}

@Injectable({ providedIn: 'root' })
export class AppMenuRegistry extends ContributionRegistry<AppMenuEntry> {
  readonly entries = this.items;
}
