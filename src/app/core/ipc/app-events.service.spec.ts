import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventsService, EVENT_SUBSCRIBER, EventSubscriber, Unlisten } from './app-events.service';

describe('AppEventsService', () => {
  let service: AppEventsService;

  function setUp(subscriber: EventSubscriber): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: EVENT_SUBSCRIBER, useValue: subscriber }],
    });
    service = TestBed.inject(AppEventsService);
  }

  /** A subscription that only lands when the test calls `settle`. */
  function deferred() {
    const state = { stopped: 0 };
    let settle: () => void = () => undefined;
    const pending = new Promise<Unlisten>((resolve) => {
      settle = () => resolve(() => (state.stopped += 1));
    });

    return { state, settle, subscriber: (): Promise<Unlisten> => pending };
  }

  beforeEach(() => {
    setUp(async () => () => undefined);
  });

  it('forwards the action the native side sent', async () => {
    let fire: (action: 'capture' | 'new-note' | 'palette') => void = () => undefined;
    const handler = vi.fn();
    setUp(async (incoming) => {
      fire = incoming;
      return () => undefined;
    });

    service.on(handler);
    await Promise.resolve();
    fire('new-note');

    // The payload is what says which action: there is one topic, not three.
    expect(handler).toHaveBeenCalledExactlyOnceWith('new-note');
  });

  it('unsubscribes once the subscription has landed', async () => {
    const { state, settle, subscriber } = deferred();
    setUp(subscriber);

    const unlisten = service.on(() => undefined);
    settle();
    await Promise.resolve();
    unlisten();

    expect(state.stopped).toBe(1);
  });

  it('still unsubscribes when destroyed before the subscription lands', async () => {
    // `listen` resolves a tick later; without the cancelled flag a component
    // torn down in between would stay subscribed for the whole session.
    const { state, settle, subscriber } = deferred();
    setUp(subscriber);

    const unlisten = service.on(() => undefined);
    unlisten();
    settle();
    await Promise.resolve();

    expect(state.stopped).toBe(1);
  });

  it('degrades to an inert subscription when the bridge is unavailable', async () => {
    // This is the case outside Tauri, and the one every other spec runs under.
    setUp(() => Promise.reject(new Error('no bridge')));

    const unlisten = service.on(() => undefined);
    await Promise.resolve();

    expect(() => unlisten()).not.toThrow();
  });
});
