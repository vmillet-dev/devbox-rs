import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsPage, SettingsRegistry } from './settings-registry';

@Component({ selector: 'app-stub-page', template: '' })
class StubPageComponent {}

function page(id: string, order: number, extra: Partial<SettingsPage> = {}): SettingsPage {
  return { id, labelKey: `settings.pages.${id}`, order, component: StubPageComponent, ...extra };
}

describe('SettingsRegistry', () => {
  let registry: SettingsRegistry;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    registry = TestBed.inject(SettingsRegistry);
  });

  it('offers nothing until a feature contributes', () => {
    expect(registry.pages()).toEqual([]);
  });

  it('orders pages by their declared order, not by arrival', () => {
    registry.register([page('later', 20), page('first', 10)]);

    expect(registry.pages().map((entry) => entry.id)).toEqual(['first', 'later']);
  });

  it('replaces a page re-registered under the same id', () => {
    registry.register([page('variables', 20)]);
    registry.register([page('variables', 20, { labelKey: 'settings.pages.other' })]);

    expect(registry.pages()).toHaveLength(1);
    expect(registry.pages()[0].labelKey).toBe('settings.pages.other');
  });

  it('lets a feature take its pages back', () => {
    registry.register([page('a', 10), page('b', 20)]);

    registry.unregister(['a']);

    expect(registry.pages().map((entry) => entry.id)).toEqual(['b']);
  });
});
