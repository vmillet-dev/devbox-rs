import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppInfoService, APP_NAME, REPOSITORY_URL } from './app-info.service';

/**
 * `getVersion()` and `openUrl()` belong to the Tauri core and to a plugin, so there is no
 * token to substitute. They are not mocked either: `vi.mock` on a Tauri package is
 * unreliable here, and the case that matters is the one jsdom reproduces for free — no
 * bridge at all.
 */
describe('AppInfoService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it('reads null outside a Tauri runtime rather than making a version up', async () => {
    const info = TestBed.inject(AppInfoService);

    expect(info.version()).toBeNull();
    await vi.waitFor(() => expect(info.version()).toBeNull());
  });

  it('points at the repository declared in the Tauri capabilities', () => {
    // ⚠️ Outside the scope declared for `opener:allow-open-url`, the call is
    // refused at runtime, and nothing says so before then.
    expect(REPOSITORY_URL).toBe('https://github.com/vmillet-dev/devbox-rs');
    expect(APP_NAME).toBe('DevBox');
  });
});
