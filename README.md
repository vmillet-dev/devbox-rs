# DevBox

Le couteau suisse du développeur — prise de notes et utilitaires (hashing, encodage, etc.)
Front-end **Angular**, moteur natif **Rust / Tauri v2**.

## Prérequis

- [Node.js](https://nodejs.org/) (v18+) et npm
- [Rust](https://www.rust-lang.org/tools/install) (via `rustup`)
- Les dépendances système Tauri pour votre OS : https://tauri.app/start/prerequisites/
  (sur Linux : `webkit2gtk`, `librsvg2`, etc.)

## Installation

```bash
npm install
```

## Lancer en mode développement (hot-reload)

```bash
npm run tauri dev
```

Cette commande démarre le serveur Angular (`ng serve`, avec hot-reload sur le
code TypeScript/HTML/CSS) **et** compile/lance l'application Tauri, qui recharge
automatiquement la fenêtre lorsqu'un fichier front-end change.
Toute modification du code **Rust** nécessite en revanche une recompilation
(automatique, mais plus longue que le hot-reload front-end).

## Build de production

```bash
npm run tauri build
```

Génère l'exécutable / l'installeur natif dans `src-tauri/target/release`.

## Structure du projet

```
devbox/
├── src/                        # Front-end Angular
│   └── app/
│       ├── app.component.ts    # Démo "Hello World" (invoke -> saluer)
│       ├── app.component.html
│       └── app.component.css
└── src-tauri/                  # Back-end Rust / Tauri
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs
        ├── lib.rs               # Builder Tauri + enregistrement des commandes
        └── commands/
            ├── mod.rs
            ├── greetings.rs     # saluer() — commande de démo
            ├── notes.rs         # squelette du futur module "notes"
            ├── crypto.rs        # squelette du futur module "hashing/crypto"
            └── formatters.rs    # squelette du futur module "encodage"
```

## Ajouter une nouvelle commande Rust

1. Écrire la fonction dans le fichier `commands/<domaine>.rs` concerné, avec
   `#[tauri::command]`.
2. L'enregistrer dans `tauri::generate_handler![...]` dans `src-tauri/src/lib.rs`.
3. L'appeler côté Angular avec `invoke('nom_commande', { ...args })`.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template).
