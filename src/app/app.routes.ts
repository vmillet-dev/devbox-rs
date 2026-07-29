import { Routes } from '@angular/router';

/**
 * DevBox est prévu multi-outils (notes, hachage, encodage) : chaque feature est
 * chargée à la demande, pour que l'ajout d'un outil n'alourdisse pas le
 * démarrage des autres.
 */
export const routes: Routes = [
  {
    path: 'notes',
    loadComponent: () => import('@features/notes/notes-page.component').then((m) => m.NotesPageComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'notes' },
  { path: '**', redirectTo: 'notes' },
];
