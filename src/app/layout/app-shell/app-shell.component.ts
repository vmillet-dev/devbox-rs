import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TitlebarComponent } from '../titlebar/titlebar.component';
import { NotesPageComponent } from '../../features/notes/notes-page/notes-page.component';

@Component({
  selector: 'app-shell',
  imports: [TitlebarComponent, NotesPageComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {}
