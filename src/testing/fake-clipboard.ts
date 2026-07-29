import { ClipboardAdapter } from '@core/clipboard/clipboard.service';
import { FailsNext, guard } from './fail-next';

/**
 * In-memory clipboard.
 *
 * Every spec gets one through `provideAppTesting`, so nothing reaches the real
 * plugin: under jsdom it rejects, which `ClipboardService` swallows — a spec
 * would then be asserting against a silent failure rather than a copy.
 */
export class FakeClipboard implements ClipboardAdapter, FailsNext {
  /** What a read hands back, and what the last write left behind. */
  content: string;

  /** When set, the next call rejects like the plugin does outside Tauri. */
  failNext: Error | null = null;

  constructor(content = '') {
    this.content = content;
  }

  readText(): Promise<string | null> {
    return guard(this, () => this.content);
  }

  writeText(value: string): Promise<void> {
    return guard(this, () => {
      this.content = value;
    });
  }
}
