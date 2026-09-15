//! The bytes on disk, sealed like the rows beside them.
//!
//! ⚠️ A sealed file is read whole to be opened: AES-GCM authenticates the message, and a
//! message is only authentic once all of it has been seen. That is the price of knowing a
//! file was not tampered with, and the 10 MiB cap on an attachment is what keeps it
//! bounded.

use std::path::Path;

use crate::error::StorageError;
use crate::vault::key::Vault;

/// What `open_externally` writes into, under the OS temporary directory.
///
/// ⚠️ A decrypted copy lands here whenever an attachment is opened with the application
/// the desktop chose for it — there is no other way to hand a file to another program.
/// [`sweep_plaintext`] empties it at every launch, so the copy outlives the session at
/// worst, and the README says so plainly.
const PLAINTEXT_DIRECTORY: &str = "devbox-open";

pub fn seal_into(vault: &Vault, source: &Path, destination: &Path) -> Result<u64, StorageError> {
    let plain = std::fs::read(source)
        .map_err(|error| StorageError::File(format!("{}: {error}", source.display())))?;

    write_sealed(vault, destination, &plain)
}

pub fn write_sealed(vault: &Vault, destination: &Path, bytes: &[u8]) -> Result<u64, StorageError> {
    let sealed = vault.seal_bytes(bytes)?;
    std::fs::write(destination, &sealed)
        .map_err(|error| StorageError::File(format!("{}: {error}", destination.display())))?;

    // ⚠️ The plaintext length, not the file's: the record is what the interface shows, and
    // a size inflated by the nonce and the tag would be a lie the user could measure.
    Ok(bytes.len() as u64)
}

pub fn read_sealed(vault: &Vault, path: &Path) -> Result<Vec<u8>, StorageError> {
    let sealed = std::fs::read(path)
        .map_err(|error| StorageError::File(format!("{}: {error}", path.display())))?;

    vault.open_bytes(&sealed)
}

/// Seals a file that is still in the clear, for a library that predates the passphrase.
///
/// ⚠️ Staged then renamed: a file half-rewritten is an attachment lost, where a rename is
/// atomic. And ⚠️ it is **not** idempotent — sealing twice gives a file that opens into
/// ciphertext. It runs once, on the launch that creates the key file.
pub fn seal_in_place(vault: &Vault, path: &Path) -> Result<(), StorageError> {
    let plain = std::fs::read(path)
        .map_err(|error| StorageError::File(format!("{}: {error}", path.display())))?;

    let staged = path.with_extension("sealing");
    write_sealed(vault, &staged, &plain)?;

    std::fs::rename(&staged, path).map_err(|error| {
        let _ = std::fs::remove_file(&staged);
        StorageError::File(format!("{}: {error}", path.display()))
    })
}

/// Where a decrypted copy goes so the desktop can open it.
pub fn plaintext_directory() -> std::path::PathBuf {
    std::env::temp_dir().join(PLAINTEXT_DIRECTORY)
}

/// ⚠️ Run at every launch, beside the orphan-file sweep. A copy handed to another
/// application cannot be deleted while that application holds it, and a crash deletes
/// nothing at all — so the guarantee is "gone by the next launch", not "gone on close".
pub fn sweep_plaintext() {
    let directory = plaintext_directory();
    if let Err(error) = std::fs::remove_dir_all(&directory)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        log::warn!(
            "Decrypted copies not swept from {}: {error}",
            directory.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::key::Cost;

    fn vault() -> Vault {
        Vault::derive(
            "a passphrase",
            b"0123456789abcdef",
            Cost {
                memory_kib: 64,
                passes: 1,
                lanes: 1,
            },
        )
        .unwrap()
    }

    fn scratch() -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "devbox-sealed-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    #[test]
    fn a_sealed_file_reads_back_byte_for_byte() {
        let directory = scratch();
        let vault = vault();
        let target = directory.join("capture.png");

        let bytes = b"\x89PNG\r\n\x1a\n and whatever follows";
        write_sealed(&vault, &target, bytes).unwrap();

        assert_eq!(read_sealed(&vault, &target).unwrap(), bytes);
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ The point: a screenshot of a credentials page must not be readable beside a
    /// database that is.
    #[test]
    fn the_file_on_disk_carries_none_of_the_bytes_it_was_given() {
        let directory = scratch();
        let vault = vault();
        let target = directory.join("capture.png");

        write_sealed(&vault, &target, b"SECRET-TOKEN-abc123").unwrap();

        let raw = std::fs::read(&target).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("SECRET-TOKEN"));
        std::fs::remove_dir_all(&directory).ok();
    }

    /// The record shows what the user attached, not what the cipher added to it.
    #[test]
    fn the_size_reported_is_the_plaintext_size() {
        let directory = scratch();
        let vault = vault();

        let written = write_sealed(&vault, &directory.join("f"), &[0u8; 1000]).unwrap();

        assert_eq!(written, 1000);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_file_sealed_under_another_key_will_not_open() {
        let directory = scratch();
        let target = directory.join("capture.png");
        write_sealed(&vault(), &target, b"bytes").unwrap();

        let other = Vault::derive(
            "another passphrase",
            b"0123456789abcdef",
            Cost {
                memory_kib: 64,
                passes: 1,
                lanes: 1,
            },
        )
        .unwrap();

        assert!(read_sealed(&other, &target).is_err());
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_truncated_file_is_refused_rather_than_half_read() {
        let directory = scratch();
        let vault = vault();
        let target = directory.join("capture.png");
        write_sealed(&vault, &target, b"a reasonably long run of bytes").unwrap();

        let sealed = std::fs::read(&target).unwrap();
        std::fs::write(&target, &sealed[..sealed.len() - 4]).unwrap();

        assert!(read_sealed(&vault, &target).is_err());
        std::fs::remove_dir_all(&directory).ok();
    }
}
