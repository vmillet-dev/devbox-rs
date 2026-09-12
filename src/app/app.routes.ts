import { Routes } from '@angular/router';

/**
 * DevBox is meant to hold several tools: each feature is loaded on demand, so
 * adding one does not weigh on the others' startup.
 */
export const routes: Routes = [
  {
    path: 'notes',
    loadComponent: () => import('@features/notes/notes-page.component').then((m) => m.NotesPageComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'notes' },
  { path: '**', redirectTo: 'notes' },
];
