import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_ADAPTER, ClipboardAdapter, ClipboardService } from './clipboard.service';

function fakeAdapter(overrides: Partial<ClipboardAdapter> = {}): ClipboardAdapter {
  return {
    readText: vi.fn(async () => 'contenu'),
    writeText: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ClipboardService', () => {
  let adapter: ClipboardAdapter;
  let service: ClipboardService;

  function setUp(double: ClipboardAdapter): void {
    adapter = double;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: CLIPBOARD_ADAPTER, useValue: adapter }],
    });
    service = TestBed.inject(ClipboardService);
  }

  beforeEach(() => setUp(fakeAdapter()));

  it('writes the value and reports success', async () => {
    await expect(service.copy('SELECT 1')).resolves.toBe(true);

    expect(adapter.writeText).toHaveBeenCalledWith('SELECT 1');
  });

  it('reads the value back', async () => {
    await expect(service.paste()).resolves.toBe('contenu');
  });

  it('reports failure rather than throwing when the plugin is unavailable', async () => {
    // This is the case outside Tauri, and the one every other spec runs under.
    setUp(fakeAdapter({ writeText: vi.fn(async () => Promise.reject(new Error('no plugin'))) }));

    await expect(service.copy('x')).resolves.toBe(false);
  });

  it('reads an unavailable clipboard as empty', async () => {
    setUp(fakeAdapter({ readText: vi.fn(async () => Promise.reject(new Error('no plugin'))) }));

    await expect(service.paste()).resolves.toBe('');
  });

  it('reads an empty clipboard as an empty string rather than null', async () => {
    // The plugin returns null on some platforms; callers test truthiness.
    setUp(fakeAdapter({ readText: vi.fn(async () => null) }));

    await expect(service.paste()).resolves.toBe('');
  });
});
