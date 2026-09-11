import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppMenuEntry, AppMenuRegistry } from './app-menu.registry';

function entry(id: string, order: number, extra: Partial<AppMenuEntry> = {}): AppMenuEntry {
  return { id, labelKey: `file.${id}`, order, run: () => undefined, ...extra };
}

describe('AppMenuRegistry', () => {
  let registry: AppMenuRegistry;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    registry = TestBed.inject(AppMenuRegistry);
  });

  it('offers nothing until a feature contributes', () => {
    // An entry for a tool that is not loaded would have nothing to run.
    expect(registry.entries()).toEqual([]);
  });

  it('orders entries by their declared order, not by arrival', () => {
    registry.register([entry('later', 20), entry('first', 10)]);

    expect(registry.entries().map((item) => item.id)).toEqual(['first', 'later']);
  });

  it('replaces an entry re-registered under the same id', () => {
    registry.register([entry('import', 10)]);
    registry.register([entry('import', 10, { labelKey: 'file.other' })]);

    expect(registry.entries()).toHaveLength(1);
    expect(registry.entries()[0].labelKey).toBe('file.other');
  });

  it('lets a feature take its entries back', () => {
    registry.register([entry('a', 10), entry('b', 20)]);

    registry.unregister(['a']);

    expect(registry.entries().map((item) => item.id)).toEqual(['b']);
  });

  it('keeps the disabled state live rather than frozen at registration', () => {
    // "Export selection" follows what is ticked right now.
    const nothingChecked = signal(true);
    registry.register([entry('exportSelection', 10, { disabled: nothingChecked })]);

    expect(registry.entries()[0].disabled?.()).toBe(true);

    nothingChecked.set(false);
    expect(registry.entries()[0].disabled?.()).toBe(false);
  });
});
