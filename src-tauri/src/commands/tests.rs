use diesel::prelude::*;
use std::sync::Mutex;

use super::*;
use error::ErrorCode;

fn in_memory() -> Db {
    Mutex::new(diesel::SqliteConnection::establish(":memory:").unwrap())
}

#[test]
fn a_healthy_connection_is_handed_over() {
    let db = in_memory();

    assert!(lock(&db).is_ok());
}

#[test]
fn a_poisoned_connection_is_reported_instead_of_panicking_again() {
    let db = in_memory();

    // Poison it the way production would: a panic while the guard is held.
    // The hook is silenced so a deliberate panic does not look like a crash.
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = db.lock().unwrap();
        panic!("une commande a paniqué en tenant la connexion");
    }));
    std::panic::set_hook(hook);

    // `unwrap_err()` would need the guard to be `Debug`, which
    // `SqliteConnection` is not; and `unwrap()` in `lock` itself would take
    // the whole process down on the next command.
    let Err(error) = lock(&db) else {
        panic!("un mutex empoisonné doit être signalé, pas rendu");
    };

    assert!(matches!(error.code, ErrorCode::StorageUnavailable));
}
