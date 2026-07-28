import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppInfoService } from '@core/app-info/app-info.service';
import { FakeAppInfo } from '@testing/fake-app-info';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { AboutDialogComponent } from './about-dialog.component';

describe('AboutDialogComponent', () => {
  let fixture: ComponentFixture<AboutDialogComponent>;
  let appInfo: FakeAppInfo;

  beforeEach(() => {
    TestBed.resetTestingModule();
    appInfo = new FakeAppInfo();
    TestBed.configureTestingModule({
      imports: [AboutDialogComponent],
      providers: [{ provide: AppInfoService, useValue: appInfo }, provideTranslocoTesting()],
    });
    fixture = TestBed.createComponent(AboutDialogComponent);
    fixture.autoDetectChanges();
  });

  it('is a modal dialog labelled by its own title', () => {
    const panel = fixture.nativeElement.querySelector('.about-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe('about-dialog-title');
    expect(fixture.nativeElement.querySelector('#about-dialog-title')).not.toBeNull();
  });

  it('shows the running version', () => {
    expect(fixture.nativeElement.querySelector('.about-version').textContent.trim()).toBe('v0.1.0');
  });

  it('falls back to a dash rather than inventing a version outside Tauri', async () => {
    appInfo.versionSignal.set(null);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.about-version').textContent.trim()).toBe('—');
  });

  it('names the developer and the repository', () => {
    const facts = fixture.nativeElement.querySelector('.about-facts').textContent;
    expect(facts).toContain('Valentin MILLET');
    expect(facts).toContain('@vmillet-dev');
    expect(facts).toContain('github.com/vmillet-dev/devbox-rs');
  });

  it('opens the repository through the seam rather than navigating the WebView', () => {
    fixture.debugElement.query(By.css('.about-repo')).triggerEventHandler('click');

    expect(appInfo.openedRepository).toBe(1);
    // A real link would have moved the locked-down WebView off the app.
    expect(fixture.nativeElement.querySelector('.about-repo').tagName).toBe('BUTTON');
  });

  it('emits on the close button, on Escape and on a backdrop click', async () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fixture.debugElement.query(By.css('.about-close')).triggerEventHandler('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.nativeElement.querySelector('.about-backdrop').click();
    await fixture.whenStable();

    expect(closed).toHaveBeenCalledTimes(3);
  });
});
