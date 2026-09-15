//! The key file, beside the database.
//!
//! ⚠️ Outside the library on purpose: it carries what is needed to derive the key, so it
//! has to be readable before anything can be opened. It holds no key — a salt, the cost
//! the key was derived at, and a known value sealed under it.
//!
//! ⚠️ Losing this file loses the library, exactly as losing the passphrase does. An export
//! is the only copy that does not depend on it.

use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::key::{Cost, SALT_BYTES, Vault, fresh_salt};
use crate::error::StorageError;

pub const FILE_NAME: &str = "vault.json";

/// Bumped when a file written today would stop being readable.
const FORMAT_VERSION: u32 = 1;

/// What the check value holds. Its content is irrelevant — that it opens is the answer.
const CHECK_PLAINTEXT: &str = "devbox-vault-v1";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyFile {
    version: u32,
    kdf: Kdf,
    /// ⚠️ A known value sealed under the derived key. Without it a wrong passphrase would
    /// unlock happily and the whole library would read as gibberish — and the first write
    /// would then seal real notes under the wrong key.
    check: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kdf {
    algorithm: String,
    memory_kib: u32,
    passes: u32,
    lanes: u32,
    salt: String,
}

pub fn path_in(directory: &Path) -> PathBuf {
    directory.join(FILE_NAME)
}

pub fn exists(directory: &Path) -> bool {
    path_in(directory).is_file()
}

/// A library that has never been encrypted. ⚠️ Refuses to overwrite: the file that is
/// there is the only way into the notes beside it.
pub fn create(directory: &Path, passphrase: &str, cost: Cost) -> Result<Vault, StorageError> {
    let path = path_in(directory);
    if path.exists() {
        return Err(StorageError::Vault(
            "this library already has a key file".to_string(),
        ));
    }

    let salt = fresh_salt()?;
    let vault = Vault::derive(passphrase, &salt, cost)?;

    let file = KeyFile {
        version: FORMAT_VERSION,
        kdf: Kdf {
            algorithm: "argon2id".to_string(),
            memory_kib: cost.memory_kib,
            passes: cost.passes,
            lanes: cost.lanes,
            salt: BASE64.encode(salt),
        },
        check: vault.seal(CHECK_PLAINTEXT)?,
    };

    write_atomically(&path, &file)?;

    Ok(vault)
}

/// ⚠️ Answers [`StorageError::WrongPassphrase`] and nothing more detailed: which of the
/// two the caller got wrong is not something to help with.
pub fn unlock(directory: &Path, passphrase: &str) -> Result<Vault, StorageError> {
    let path = path_in(directory);
    let json = std::fs::read_to_string(&path)
        .map_err(|error| StorageError::Vault(format!("{}: {error}", path.display())))?;

    let file: KeyFile = serde_json::from_str(&json)
        .map_err(|error| StorageError::Vault(format!("unreadable key file: {error}")))?;

    if file.version > FORMAT_VERSION {
        return Err(StorageError::Vault(format!(
            "key file version {}, this version of DevBox reads up to {FORMAT_VERSION}",
            file.version
        )));
    }
    if file.kdf.algorithm != "argon2id" {
        return Err(StorageError::Vault(format!(
            "key derived with \"{}\", which this version of DevBox cannot reproduce",
            file.kdf.algorithm
        )));
    }

    let salt = BASE64
        .decode(&file.kdf.salt)
        .map_err(|_| StorageError::Vault("the salt is not base64".to_string()))?;
    if salt.len() != SALT_BYTES {
        return Err(StorageError::Vault(
            "the salt is the wrong size".to_string(),
        ));
    }

    let cost = Cost {
        memory_kib: file.kdf.memory_kib,
        passes: file.kdf.passes,
        lanes: file.kdf.lanes,
    };
    let vault = Vault::derive(passphrase, &salt, cost)?;

    match vault.open(&file.check) {
        Ok(check) if check == CHECK_PLAINTEXT => Ok(vault),
        _ => Err(StorageError::WrongPassphrase),
    }
}

/// ⚠️ Staged then renamed. A key file half-written is a library nobody opens again, and
/// a plain write truncates before it fills.
fn write_atomically(path: &Path, file: &KeyFile) -> Result<(), StorageError> {
    let json = serde_json::to_string_pretty(file)
        .map_err(|error| StorageError::Vault(error.to_string()))?;

    let staged = path.with_file_name(format!(".{FILE_NAME}.{}.tmp", Uuid::new_v4()));
    std::fs::write(&staged, json)
        .map_err(|error| StorageError::Vault(format!("{}: {error}", staged.display())))?;

    if let Err(error) = std::fs::rename(&staged, path) {
        let _ = std::fs::remove_file(&staged);
        return Err(StorageError::Vault(format!("{}: {error}", path.display())));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ⚠️ Cheap parameters: the real ones cost 224 ms a derivation, and these tests derive
    /// a dozen times. What they assert on is the file, not Argon2id's strength.
    fn cheap() -> Cost {
        Cost {
            memory_kib: 64,
            passes: 1,
            lanes: 1,
        }
    }

    fn scratch() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("devbox-vault-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    #[test]
    fn a_created_vault_opens_again_with_the_same_passphrase() {
        let directory = scratch();

        let created = create(&directory, "correct horse", cheap()).unwrap();
        let sealed = created.seal("a note").unwrap();

        let reopened = unlock(&directory, "correct horse").unwrap();
        assert_eq!(reopened.open(&sealed).unwrap(), "a note");

        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ The whole point of the check value: without it this would succeed and every
    /// later write would seal real notes under a key nobody can reproduce.
    #[test]
    fn a_wrong_passphrase_is_refused_rather_than_accepted_quietly() {
        let directory = scratch();
        create(&directory, "correct horse", cheap()).unwrap();

        let error = unlock(&directory, "battery staple").unwrap_err();

        assert!(matches!(error, StorageError::WrongPassphrase));
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn the_key_file_holds_no_key_and_no_passphrase() {
        let directory = scratch();
        create(&directory, "correct horse", cheap()).unwrap();

        let written = std::fs::read_to_string(path_in(&directory)).unwrap();

        assert!(!written.contains("correct horse"));
        assert!(written.contains("argon2id"));
    }

    /// The cost travels with the file, so raising the default later does not lock an
    /// existing library out.
    #[test]
    fn a_library_reopens_at_the_cost_it_was_written_with() {
        let directory = scratch();
        let odd = Cost {
            memory_kib: 96,
            passes: 3,
            lanes: 1,
        };
        create(&directory, "correct horse", odd).unwrap();

        // `unlock` reads the parameters rather than assuming today's defaults.
        assert!(unlock(&directory, "correct horse").is_ok());
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ Overwriting would throw away the only way into the notes sitting beside it.
    #[test]
    fn creating_over_an_existing_key_file_is_refused() {
        let directory = scratch();
        create(&directory, "first", cheap()).unwrap();

        assert!(create(&directory, "second", cheap()).is_err());
        // And the first passphrase still works.
        assert!(unlock(&directory, "first").is_ok());

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_key_file_from_a_newer_version_says_so_rather_than_failing_on_serde() {
        let directory = scratch();
        create(&directory, "correct horse", cheap()).unwrap();

        let path = path_in(&directory);
        let mut json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        json["version"] = serde_json::json!(FORMAT_VERSION + 1);
        std::fs::write(&path, json.to_string()).unwrap();

        let error = unlock(&directory, "correct horse").unwrap_err();
        assert!(format!("{error}").contains("reads up to"));

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn an_unknown_derivation_is_named_rather_than_guessed_at() {
        let directory = scratch();
        create(&directory, "correct horse", cheap()).unwrap();

        let path = path_in(&directory);
        let mut json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        json["kdf"]["algorithm"] = serde_json::json!("scrypt");
        std::fs::write(&path, json.to_string()).unwrap();

        let error = unlock(&directory, "correct horse").unwrap_err();
        assert!(format!("{error}").contains("scrypt"));

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_library_with_no_key_file_says_it_has_none() {
        let directory = scratch();

        assert!(!exists(&directory));
        create(&directory, "correct horse", cheap()).unwrap();
        assert!(exists(&directory));

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn creating_leaves_no_staging_file_behind() {
        let directory = scratch();
        create(&directory, "correct horse", cheap()).unwrap();

        let left: Vec<_> = std::fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();

        assert_eq!(left, [FILE_NAME]);
        std::fs::remove_dir_all(&directory).ok();
    }
}
