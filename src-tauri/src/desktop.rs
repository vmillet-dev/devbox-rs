//! Tray and global shortcuts: Tauri glue, not a feature.
//!
//! **Nothing user-visible is written here**: the menu labels arrive from the
//! front end already translated.

use std::str::FromStr;
use std::sync::Mutex;

use serde::Deserialize;
use specta::Type;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Mirrors of `core/ipc/app-events.service.ts`: a typo here would produce a
/// silently inert subscription.
const CAPTURE_EVENT: &str = "devbox:capture";
const NEW_NOTE_EVENT: &str = "devbox:new-note";
const PALETTE_EVENT: &str = "devbox:palette";

/// `unminimize` first: a minimised window that is merely shown stays in the
/// taskbar.
pub(crate) fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Shows the window **then** asks the front for the action: the native side
/// never creates the note itself, which spares it from duplicating language
/// detection.
fn reveal_and_emit(app: &AppHandle, topic: &str) {
    reveal(app);
    let _ = app.emit(topic, ());
}

// --- Shortcuts active outside the window ------------------------------------

/// Les trois raccourcis globaux, tels que le front les règle.
///
/// Trois champs plutôt qu'une carte : un raccourci absent serait une action
/// qu'aucune touche n'atteint plus, et une carte laisserait le compilateur muet.
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindings {
    pub capture: String,
    pub new_note: String,
    pub palette: String,
}

impl ShortcutBindings {
    /// ⚠️ Miroir de `DEFAULT_SHORTCUTS` (`core/shortcuts/shortcut.model.ts`).
    ///
    /// Ce doublon est voulu : ces valeurs servent **avant** que le front ait
    /// démarré, et sans elles `Ctrl+Alt+P` serait mort le temps du premier
    /// rendu — précisément la seconde où l'on s'en sert depuis une autre
    /// application.
    ///
    /// ⚠️ Pas `Ctrl+Alt+Espace` pour la palette : ce raccourci est déjà pris par
    /// des applications très répandues (Claude, entre autres), et le premier
    /// arrivé gagne — DevBox n'aurait qu'une touche morte.
    fn defaults() -> Self {
        Self {
            capture: "Ctrl+Alt+V".to_string(),
            new_note: "Ctrl+Alt+N".to_string(),
            palette: "Ctrl+Alt+P".to_string(),
        }
    }

    fn entries(&self) -> [(&str, &'static str); 3] {
        [
            (&self.capture, CAPTURE_EVENT),
            (&self.new_note, NEW_NOTE_EVENT),
            (&self.palette, PALETTE_EVENT),
        ]
    }
}

/// Ce qui est enregistré à l'instant, et l'action que chacun déclenche.
///
/// Une liste plutôt que trois constantes : les combinaisons changent au gré des
/// préférences, et le gestionnaire ne peut donc pas les comparer à des valeurs
/// capturées une fois pour toutes.
type ActiveShortcuts = Mutex<Vec<(Shortcut, &'static str)>>;

/// Installe le greffon et prend les raccourcis par défaut.
///
/// Un raccourci déjà pris par une autre application est journalisé mais **pas
/// fatal** : DevBox doit démarrer sans lui.
pub(crate) fn register_shortcuts(app: &AppHandle) -> tauri::Result<()> {
    app.manage(ActiveShortcuts::default());

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                // Without this filter the key release would replay the action.
                if event.state() != ShortcutState::Pressed {
                    return;
                }

                let Some(topic) = topic_of(app, shortcut) else {
                    return;
                };

                reveal_and_emit(app, topic);
            })
            .build(),
    )?;

    let taken = apply_shortcuts(app, &ShortcutBindings::defaults());
    if !taken.is_empty() {
        log::warn!(
            "Global shortcuts unavailable at startup: {}",
            taken.join(", ")
        );
    }

    Ok(())
}

fn topic_of(app: &AppHandle, shortcut: &Shortcut) -> Option<&'static str> {
    let active = app.try_state::<ActiveShortcuts>()?;
    let active = active.lock().ok()?;

    active
        .iter()
        .find(|(registered, _)| registered == shortcut)
        .map(|(_, topic)| *topic)
}

/// Reprend les trois raccourcis depuis zéro et rend **ce qui n'a pas pu être
/// pris** : une combinaison illisible comme une combinaison déjà prise.
///
/// Tout est relâché d'abord — régler un raccourci en laisse forcément un autre
/// derrière, et la combinaison abandonnée continuerait sinon de répondre.
fn apply_shortcuts(app: &AppHandle, bindings: &ShortcutBindings) -> Vec<String> {
    if let Err(error) = app.global_shortcut().unregister_all() {
        log::warn!("Global shortcuts not released: {error}");
    }

    let mut registered = Vec::new();
    let mut unavailable = Vec::new();

    for (accelerator, topic) in bindings.entries() {
        let Ok(shortcut) = Shortcut::from_str(accelerator) else {
            log::warn!("Global shortcut {accelerator} unreadable");
            unavailable.push(accelerator.to_string());
            continue;
        };

        if let Err(error) = app.global_shortcut().register(shortcut) {
            log::warn!("Global shortcut {accelerator} unavailable: {error}");
            unavailable.push(accelerator.to_string());
            continue;
        }

        registered.push((shortcut, topic));
    }

    if let Some(active) = app.try_state::<ActiveShortcuts>()
        && let Ok(mut active) = active.lock()
    {
        *active = registered;
    }

    unavailable
}

/// Règle les raccourcis globaux et rend ceux qu'une autre application garde.
///
/// Le front l'appelle au démarrage puis à chaque changement de préférence, et
/// **affiche** ce qui revient : le natif ne peut qu'échouer en silence, et une
/// ligne de journal n'est pas une interface — sans ce retour, presser la touche
/// ne ferait rien et rien ne dirait pourquoi.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
pub fn set_global_shortcuts(bindings: ShortcutBindings, app: AppHandle) -> Vec<String> {
    apply_shortcuts(&app, &bindings)
}

// --- What the close and minimise buttons do ----------------------------------

/// Réglé depuis le panneau de préférences et poussé ici, comme les libellés de
/// la barre système : la préférence vit dans `preferences.json`, côté front, et
/// la relire depuis Rust ferait une seconde source à tenir en phase.
#[derive(Debug, Clone, Copy, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowBehavior {
    pub close_to_tray: bool,
    pub minimize_to_tray: bool,
}

/// Ce que fait DevBox tant que le front n'a rien dit : la croix range la fenêtre
/// dans la barre système — l'application est faite pour rester à portée d'un
/// raccourci — et « réduire » réduit, comme partout ailleurs.
impl Default for WindowBehavior {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            minimize_to_tray: false,
        }
    }
}

type WindowBehaviorState = Mutex<WindowBehavior>;

#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)]
pub fn set_window_behavior(behavior: WindowBehavior, app: AppHandle) {
    if let Some(state) = app.try_state::<WindowBehaviorState>() {
        if let Ok(mut current) = state.lock() {
            *current = behavior;
        }
        return;
    }

    app.manage(WindowBehaviorState::new(behavior));
}

fn window_behavior(app: &AppHandle) -> WindowBehavior {
    app.try_state::<WindowBehaviorState>()
        .and_then(|state: State<'_, WindowBehaviorState>| state.lock().ok().map(|current| *current))
        .unwrap_or_default()
}

/// ⚠️ Les deux exigent une barre système : sans elle, cacher la fenêtre
/// laisserait un processus que plus rien ne peut rappeler.
pub(crate) fn hides_on_close(app: &AppHandle) -> bool {
    window_behavior(app).close_to_tray && tray_exists(app)
}

/// Tauri n'émet pas d'événement « réduite » : seul `Resized` passe, et c'est à
/// l'appelant de demander ensuite à la fenêtre où elle en est.
pub(crate) fn hides_on_minimize(app: &AppHandle) -> bool {
    window_behavior(app).minimize_to_tray && tray_exists(app)
}

// --- System tray: icon, menu, and item actions --------------------------------

const TRAY_ID: &str = "devbox";

const OPEN_ITEM: &str = "open";
const NEW_NOTE_ITEM: &str = "new-note";
const CAPTURE_ITEM: &str = "capture";
const PALETTE_ITEM: &str = "palette";
const QUIT_ITEM: &str = "quit";

/// Labels cross the bridge **already translated**: the interface language
/// is a front-end preference, and keeping a translation table in Rust would
/// mean maintaining a second one.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub open: String,
    pub new_note: String,
    pub capture: String,
    pub palette: String,
    pub quit: String,
}

/// Creates the icon, or replaces only its menu if it already exists — a
/// language change thus re-translates it without making it flicker.
///
/// Does **not** return a `Result`: an absent system tray is not a failure
/// the front end can handle, and inventing a code for it would add a branch
/// that nothing would display. The failure is logged on the native side, and
/// [`tray_exists`] then prevents closing from hiding the window where nothing
/// could call it back.
#[tauri::command]
#[specta::specta]
// A command receives its arguments deserialized from the IPC payload:
// they arrive owned, whether it consumes them or not.
#[allow(clippy::needless_pass_by_value)]
pub fn sync_tray(labels: TrayLabels, app: AppHandle) {
    let menu = match build_menu(&app, &labels) {
        Ok(menu) => menu,
        Err(error) => {
            log::warn!("System tray menu unavailable: {error}");
            return;
        }
    };

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(error) = tray.set_menu(Some(menu)) {
            log::warn!("System tray menu not updated: {error}");
        }
        return;
    }

    if let Err(error) = build_tray(&app, &menu) {
        log::warn!("System tray unavailable: {error}");
    }
}

pub(crate) fn tray_exists(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

fn build_menu(app: &AppHandle, labels: &TrayLabels) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, OPEN_ITEM, &labels.open, true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, NEW_NOTE_ITEM, &labels.new_note, true, None::<&str>)?;
    let capture = MenuItem::with_id(app, CAPTURE_ITEM, &labels.capture, true, None::<&str>)?;
    let palette = MenuItem::with_id(app, PALETTE_ITEM, &labels.palette, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, &labels.quit, true, None::<&str>)?;

    Menu::with_items(
        app,
        &[&open, &new_note, &capture, &palette, &separator, &quit],
    )
}

fn build_tray(app: &AppHandle, menu: &Menu<Wry>) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or(tauri::Error::UnknownPath)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("DevBox")
        // Left click shows the window; the menu remains on right click, where
        // Windows expects it.
        .show_menu_on_left_click(false)
        .menu(menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ITEM => reveal(app),
            NEW_NOTE_ITEM => reveal_and_emit(app, NEW_NOTE_EVENT),
            CAPTURE_ITEM => reveal_and_emit(app, CAPTURE_EVENT),
            PALETTE_ITEM => reveal_and_emit(app, PALETTE_EVENT),
            // The only path that actually terminates the process: the window's
            // close button only hides it.
            QUIT_ITEM => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
