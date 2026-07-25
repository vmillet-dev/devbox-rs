import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOTES_REPOSITORY } from './core/data/notes-repository.token';
import { FakeNotesRepository } from '../testing/fake-notes-repository';
import { AppShellComponent } from './layout/app-shell/app-shell.component';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [{ provide: NOTES_REPOSITORY, useValue: new FakeNotesRepository([]) }],
    });
    fixture = TestBed.createComponent(AppComponent);
    fixture.autoDetectChanges();
  });

  it('renders the app shell', () => {
    expect(fixture.debugElement.query(By.directive(AppShellComponent))).not.toBeNull();
  });
});
