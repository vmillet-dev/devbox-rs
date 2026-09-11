import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';

export interface Contribution {
  readonly id: string;
  /** Decides the display order; leave room between two items. */
  readonly order: number;
}

/**
 * The titlebar, the preferences panel and the shortcuts sheet are application frame:
 * importing a feature from `layout/` would break the rule that deleting a feature's folder
 * deletes the feature. Each feature registers on start and withdraws on destruction, so an
 * unloaded tool contributes nothing.
 */
@Injectable()
export abstract class ContributionRegistry<T extends Contribution> {
  private readonly registered = signal<readonly T[]>([]);

  readonly items: Signal<readonly T[]> = computed(() =>
    [...this.registered()].sort((left, right) => left.order - right.order),
  );

  /** Re-registering an id replaces the item rather than doubling it. */
  register(items: readonly T[]): void {
    const ids = new Set(items.map((item) => item.id));
    this.registered.update((current) => [...current.filter((item) => !ids.has(item.id)), ...items]);
  }

  unregister(ids: readonly string[]): void {
    const dropped = new Set(ids);
    this.registered.update((current) => current.filter((item) => !dropped.has(item.id)));
  }
}

/**
 * Registers for the lifetime of the injection context that calls this, so a component
 * contributing in its constructor withdraws on destruction without arranging it.
 */
export function contribute<T extends Contribution>(
  registry: ContributionRegistry<T>,
  items: readonly T[],
): void {
  registry.register(items);
  inject(DestroyRef).onDestroy(() => {
    registry.unregister(items.map((item) => item.id));
  });
}
