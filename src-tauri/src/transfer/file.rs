//! Reading and writing the export file. Nothing here knows the database.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::model::{Bundle, ExportReport, IncomingBundle};
use crate::count::saturating_u32;
use crate::error::{AppError, StorageError};

/// ⚠️ Written beside the target then renamed: `fs::write` truncates first, so an
/// export that ran out of disk destroyed the file it was overwriting.
pub fn write(path: &str, bundle: &Bundle) -> Result<ExportReport, AppError> {
    let report = ExportReport {
        notes: saturating_u32(bundle.notes.len()),
        spaces: saturating_u32(bundle.spaces.len()),
    };

    let json = serde_json::to_string_pretty(bundle)
        .map_err(|error| StorageError::File(error.to_string()))?;

    let staged = staging_path(path);
    std::fs::write(&staged, json)
        .map_err(|error| StorageError::File(format!("{}: {error}", staged.display())))?;

    if let Err(error) = std::fs::rename(&staged, path) {
        let _ = std::fs::remove_file(&staged);
        return Err(StorageError::File(format!("{path}: {error}")).into());
    }

    Ok(report)
}

pub fn read(path: &str) -> Result<IncomingBundle, AppError> {
    let json = std::fs::read_to_string(path)
        .map_err(|error| StorageError::File(format!("{path}: {error}")))?;

    Ok(super::model::read_bundle(&json)?)
}

/// Same directory as the target, or the rename would cross volumes and stop being
/// atomic.
fn staging_path(path: &str) -> PathBuf {
    let target = Path::new(path);
    let name = target
        .file_name()
        .map_or_else(|| OsString::from("export"), OsStr::to_os_string);

    let mut staged = OsString::from(".");
    staged.push(name);
    staged.push(format!(".{}.tmp", Uuid::new_v4()));

    target.with_file_name(staged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::fixtures::note as sample;
    use crate::spaces::model::Space;

    fn bundle() -> Bundle {
        Bundle {
            version: super::super::model::FORMAT_VERSION,
            exported_at: sample().created_at,
            spaces: vec![Space {
                id: "s-1".to_string(),
                name: "Personal".to_string(),
            }],
            notes: vec![sample()],
        }
    }

    fn scratch() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("devbox-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    /// A staging file one directory away would make the rename cross volumes, and
    /// with it stop being atomic — the whole point of writing beside the target.
    #[test]
    fn the_staging_file_sits_next_to_its_target() {
        let target = std::env::temp_dir().join("documents").join("library.json");

        let staged = staging_path(&target.to_string_lossy());

        assert_eq!(staged.parent(), target.parent());
        assert_ne!(staged.file_name(), target.file_name());
    }

    #[test]
    fn two_exports_of_the_same_target_never_stage_the_same_file() {
        let target = std::env::temp_dir().join("library.json");

        let first = staging_path(&target.to_string_lossy());
        let second = staging_path(&target.to_string_lossy());

        assert_ne!(first, second);
    }

    #[test]
    fn an_export_leaves_no_staging_file_behind() {
        let directory = scratch();
        let target = directory.join("library.json");

        write(&target.to_string_lossy(), &bundle()).unwrap();

        let left: Vec<_> = std::fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();

        assert_eq!(left, ["library.json"]);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn exporting_over_an_existing_file_replaces_it_whole() {
        let directory = scratch();
        let target = directory.join("library.json");
        std::fs::write(&target, "previous export, longer than what replaces it").unwrap();

        write(&target.to_string_lossy(), &bundle()).unwrap();

        let written = std::fs::read_to_string(&target).unwrap();
        assert!(written.starts_with('{'));
        assert!(!written.contains("previous export"));
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn an_export_to_an_unreachable_directory_reports_rather_than_panicking() {
        let error = write("/no/such/directory/library.json", &bundle()).unwrap_err();

        assert!(matches!(error.code, crate::error::ErrorCode::FileAccess));
    }

    #[test]
    fn a_written_bundle_reads_back_as_itself() {
        let directory = scratch();
        let target = directory.join("library.json");

        write(&target.to_string_lossy(), &bundle()).unwrap();
        let read_back = read(&target.to_string_lossy()).unwrap();

        assert_eq!(read_back.bundle.notes.len(), 1);
        assert_eq!(read_back.bundle.spaces[0].name, "Personal");
        std::fs::remove_dir_all(&directory).ok();
    }
}
