import { ChangelogRelease } from '@core/app-info/changelog.service';

/**
 * Stand-in for `ChangelogService`. The real one goes through the Tauri bridge
 * and the `opener` plugin, neither of which jsdom has.
 */
export class FakeChangelog {
  releases: readonly ChangelogRelease[] = [
    {
      version: '0.2.0',
      date: '2026-09-11',
      sections: [{ title: 'Added', items: ['Sample notes on first launch.'] }],
    },
    {
      version: '0.1.0',
      date: null,
      sections: [{ title: '', items: ['Shipped at last.'] }],
    },
  ];

  /** When set, `load` rejects with it. */
  loadError: Error | null = null;

  openedReleases = 0;

  async load(): Promise<readonly ChangelogRelease[]> {
    if (this.loadError) throw this.loadError;
    return this.releases;
  }

  async openReleases(): Promise<void> {
    this.openedReleases += 1;
  }
}
