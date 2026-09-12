import { Injectable, Type } from '@angular/core';
import { Contribution, ContributionRegistry } from '@core/contributions/contribution.registry';

/**
 * `component` is rendered through `NgComponentOutlet`: the panel shows a page it knows
 * nothing about, exactly as the "File" menu runs an action it knows nothing about.
 */
export interface SettingsPage extends Contribution {
  readonly labelKey: string;
  readonly component: Type<unknown>;
}

@Injectable({ providedIn: 'root' })
export class SettingsRegistry extends ContributionRegistry<SettingsPage> {
  readonly pages = this.items;
}
