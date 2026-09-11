import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ShortcutGroup, ShortcutsRegistry } from './shortcuts.registry';

function group(id: string, order: number, extra: Partial<ShortcutGroup> = {}): ShortcutGroup {
  return {
    id,
    labelKey: `shortcuts.groups.${id}`,
    order,
    shortcuts: [{ keys: ['Ctrl', 'K'], labelKey: `shortcuts.${id}.search` }],
    ...extra,
  };
}

describe('ShortcutsRegistry', () => {
  let registry: ShortcutsRegistry;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ShortcutsRegistry);
  });

  it('lists nothing until a feature contributes', () => {
    // Keys of a tool that is not loaded would do nothing when pressed.
    expect(registry.groups()).toEqual([]);
  });

  it('orders groups by their declared order, not by arrival', () => {
    registry.register([group('editor', 20), group('canvas', 10)]);

    expect(registry.groups().map((entry) => entry.id)).toEqual(['canvas', 'editor']);
  });

  it('replaces a group re-registered under the same id', () => {
    registry.register([group('canvas', 10)]);
    registry.register([group('canvas', 10, { shortcuts: [] })]);

    expect(registry.groups()).toHaveLength(1);
    expect(registry.groups()[0].shortcuts).toEqual([]);
  });

  it('lets a feature take its groups back', () => {
    registry.register([group('canvas', 10), group('editor', 20)]);

    registry.unregister(['canvas']);

    expect(registry.groups().map((entry) => entry.id)).toEqual(['editor']);
  });
});
