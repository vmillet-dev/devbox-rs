import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOTES_REPOSITORY } from '../../core/data/notes-repository.token';
import { FakeNotesRepository } from '../../../testing/fake-notes-repository';
import { TitlebarComponent } from '../titlebar/titlebar.component';
import { NotesPageComponent } from '../../features/notes/notes-page/notes-page.component';
import { AppShellComponent } from './app-shell.component';

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [{ provide: NOTES_REPOSITORY, useValue: new FakeNotesRepository([]) }],
    });
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.autoDetectChanges();
  });

  it('renders the titlebar and the notes page', () => {
    expect(fixture.debugElement.query(By.directive(TitlebarComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(NotesPageComponent))).not.toBeNull();
  });
});
