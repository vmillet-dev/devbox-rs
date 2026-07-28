/**
 * Identité du projet, telle qu'affichée dans la fiche « À propos ».
 *
 * Pas de description ici : c'est du texte visible par l'utilisateur, donc une
 * clé de traduction (`about.description`), pas une constante figée en français.
 *
 * ⚠️ `REPOSITORY_URL` doit rester couverte par la portée déclarée pour
 * `opener:allow-open-url` dans `src-tauri/capabilities/default.json`, sinon
 * l'ouverture est refusée à l'exécution.
 */
export const REPOSITORY_URL = 'https://github.com/vmillet-dev/devbox-rs';

export const AUTHOR_NAME = 'Valentin MILLET';

export const AUTHOR_HANDLE = '@vmillet-dev';
