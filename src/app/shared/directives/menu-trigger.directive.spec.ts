import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { MenuTriggerDirective } from './menu-trigger.directive';

@Component({
  selector: 'app-menu-trigger-host',
  imports: [MenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" id="outside">outside</button>
    <div
      appMenuTrigger
      #menu="appMenu"
      (escaped)="escapes.set(escapes() + 1)"
      (closed)="closes.set(closes() + 1)"
    >
      <button type="button" appMenuAnchor id="anchor" (click)="menu.toggle()">File</button>
      @if (menu.open()) {
        <div id="panel"><button type="button" id="entry">Import…</button></div>
      }
    </div>
  `,
})
class MenuTriggerHostComponent {
  readonly menu = viewChild.required(MenuTriggerDirective);
  readonly escapes = signal(0);
  readonly closes = signal(0);
}

describe('MenuTriggerDirective', () => {
  let fixture: ComponentFixture<MenuTriggerHostComponent>;

  function element(id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`#${id}`);
  }

  function menu(): MenuTriggerDirective {
    return fixture.componentInstance.menu();
  }

  async function open(): Promise<void> {
    element('anchor')!.click();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [MenuTriggerHostComponent] });
    fixture = TestBed.createComponent(MenuTriggerHostComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('starts closed', () => {
    expect(menu().open()).toBe(false);
    expect(element('panel')).toBeNull();
  });

  it('opens and closes on the anchor', async () => {
    await open();
    expect(element('panel')).not.toBeNull();

    await open();
    expect(menu().open()).toBe(false);
    expect(fixture.componentInstance.closes()).toBe(1);
  });

  /** ⚠️ Focus would otherwise go to `<body>`, leaving the keyboard nowhere. */
  it('gives focus back to the anchor when it closes', async () => {
    await open();
    element('entry')!.focus();

    menu().close();
    await fixture.whenStable();

    expect(document.activeElement).toBe(element('anchor'));
  });

  /** Left `false` when what closes the menu is something else taking focus. */
  it('leaves focus alone when asked to', async () => {
    await open();
    element('outside')!.focus();

    menu().close(false);
    await fixture.whenStable();

    expect(document.activeElement).toBe(element('outside'));
  });

  it('closes on a click outside, without stealing focus back', async () => {
    await open();
    element('outside')!.focus();

    element('outside')!.click();
    await fixture.whenStable();

    expect(menu().open()).toBe(false);
    expect(document.activeElement).toBe(element('outside'));
  });

  it('stays open for a click inside itself', async () => {
    await open();

    element('entry')!.click();
    await fixture.whenStable();

    expect(menu().open()).toBe(true);
  });

  /**
   * ⚠️ Escape is emitted rather than handled here: a multi-level menu has to be able to
   * fold its own panel before the whole thing closes.
   */
  it('emits Escape instead of closing itself', async () => {
    await open();

    element('anchor')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.escapes()).toBe(1);
    expect(menu().open()).toBe(true);
  });

  it('says nothing when closing something already closed', () => {
    menu().close();

    expect(fixture.componentInstance.closes()).toBe(0);
  });
});
