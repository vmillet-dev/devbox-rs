import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterOutlet, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorBannerComponent } from '@shared/ui/error-banner/error-banner.component';
import { UpdatePromptComponent } from '@shared/ui/update-prompt/update-prompt.component';
import { provideAppTesting } from '@testing/testing.providers';
import { TitlebarComponent } from '../titlebar/titlebar.component';
import { AppShellComponent } from './app-shell.component';

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [provideAppTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.autoDetectChanges();
  });

  it('renders the persistent chrome: titlebar, global error banner and update prompt', () => {
    expect(fixture.debugElement.query(By.directive(TitlebarComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(ErrorBannerComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(UpdatePromptComponent))).not.toBeNull();
  });

  it('hosts features through the router outlet rather than importing them directly', () => {
    expect(fixture.debugElement.query(By.directive(RouterOutlet))).not.toBeNull();
  });
});
