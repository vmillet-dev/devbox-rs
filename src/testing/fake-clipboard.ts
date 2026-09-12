import { ClipboardAdapter } from '@core/services/clipboard/clipboard.service';
import { FailsNext, guard } from './fail-next';

/**
 * Every spec gets one through `provideAppTesting`: under jsdom the real plugin rejects,
 * which `ClipboardService` swallows — a spec would then assert against a silent failure.
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
