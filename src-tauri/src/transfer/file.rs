//! Nothing here knows the database.
//!
//! The export is a zip: `bundle.json` at the root, one entry per attachment under
//! `attachments/`. ⚠️ Base64 inside the JSON was the obvious alternative and was refused:
//! it costs a third more bytes, and the import path holds the file as a `String`, then a
//! `serde_json::Value`, then a `Bundle` — three copies of every screenshot in memory.
//! Archive entries are pulled one at a time instead.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::model::{Bundle, ExportReport, IncomingBundle};
use crate::attachments::model::Attachment;
use crate::count::saturating_u32;
use crate::error::{AppError, StorageError};

const BUNDLE_ENTRY: &str = "bundle.json";
const ATTACHMENTS_ENTRY: &str = "attachments";

/// What a zip opens with. An export written before the archive existed is plain JSON and
/// is still read: a new DevBox reads an old file, an old DevBox does not read a new one.
const ZIP_MAGIC: [u8; 4] = [b'P', b'K', 0x03, 0x04];

fn file_error(what: &str, error: &std::io::Error) -> StorageError {
    StorageError::File(format!("{what}: {error}"))
}

fn zip_error(error: &zip::result::ZipError) -> StorageError {
    StorageError::File(error.to_string())
}

/// ⚠️ Written beside the target then renamed: a truncating write destroys the previous
/// export the day the disk fills.
pub fn write(path: &str, bundle: &Bundle, attachments: &Path) -> Result<ExportReport, AppError> {
    let json = serde_json::to_string_pretty(bundle)
        .map_err(|error| StorageError::File(error.to_string()))?;

    let staged = staging_path(path);
    let stored = match archive(&staged, &json, &bundle.attachments, attachments) {
        Ok(stored) => stored,
        Err(error) => {
            let _ = std::fs::remove_file(&staged);
            return Err(error.into());
        }
    };

    if let Err(error) = std::fs::rename(&staged, path) {
        let _ = std::fs::remove_file(&staged);
        return Err(StorageError::File(format!("{path}: {error}")).into());
    }

    Ok(ExportReport {
        notes: saturating_u32(bundle.notes.len()),
        spaces: saturating_u32(bundle.spaces.len()),
        attachments: stored,
    })
}

/// The bundle is deflated, being repetitive text. The attachments are stored as they are:
/// a PNG is already compressed, and deflating it again costs time for nothing.
fn archive(
    staged: &Path,
    json: &str,
    records: &[Attachment],
    source: &Path,
) -> Result<u32, StorageError> {
    let target =
        File::create(staged).map_err(|error| file_error(&staged.display().to_string(), &error))?;
    let mut writer = ZipWriter::new(target);

    writer
        .start_file(
            BUNDLE_ENTRY,
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .map_err(|error| zip_error(&error))?;
    writer
        .write_all(json.as_bytes())
        .map_err(|error| file_error(BUNDLE_ENTRY, &error))?;

    let mut stored = 0;
    for record in records {
        let name = record.stored_name();

        // A record whose file has gone missing leaves the export rather than failing it:
        // the note still travels, and `attachments_missing` says so on the way back in.
        let Ok(bytes) = std::fs::read(source.join(&name)) else {
            continue;
        };

        writer
            .start_file(
                format!("{ATTACHMENTS_ENTRY}/{name}"),
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .map_err(|error| zip_error(&error))?;
        writer
            .write_all(&bytes)
            .map_err(|error| file_error(&name, &error))?;
        stored += 1;
    }

    writer.finish().map_err(|error| zip_error(&error))?;

    Ok(stored)
}

/// The bundle, and whatever carries the attachment bytes that belong with it.
pub fn read(path: &str) -> Result<(IncomingBundle, Payload), AppError> {
    let mut file = File::open(path).map_err(|error| file_error(path, &error))?;

    let mut magic = [0u8; 4];
    let zipped = file.read_exact(&mut magic).is_ok() && magic == ZIP_MAGIC;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| file_error(path, &error))?;

    if !zipped {
        let json = std::fs::read_to_string(path).map_err(|error| file_error(path, &error))?;
        return Ok((super::model::read_bundle(&json)?, Payload::Empty));
    }

    let mut archive =
        ZipArchive::new(file).map_err(|error| StorageError::ImportFormat(error.to_string()))?;

    let json = {
        let mut entry = archive
            .by_name(BUNDLE_ENTRY)
            .map_err(|_| StorageError::ImportFormat(format!("no {BUNDLE_ENTRY} in the archive")))?;
        let mut json = String::new();
        entry
            .read_to_string(&mut json)
            .map_err(|error| file_error(BUNDLE_ENTRY, &error))?;
        json
    };

    Ok((
        super::model::read_bundle(&json)?,
        Payload::Archive(Box::new(archive)),
    ))
}

/// The attachment bytes of an import, handed over one at a time.
pub enum Payload {
    /// A `.json` export: it carried no attachments.
    Empty,
    Archive(Box<ZipArchive<File>>),
}

impl Payload {
    /// `None` when the archive names the record but does not carry its bytes.
    pub fn take(&mut self, stored_name: &str) -> Option<Vec<u8>> {
        let Self::Archive(archive) = self else {
            return None;
        };

        let mut entry = archive
            .by_name(&format!("{ATTACHMENTS_ENTRY}/{stored_name}"))
            .ok()?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).ok()?;

        Some(bytes)
    }
}

/// ⚠️ Same directory as the target, or the rename crosses volumes and stops being atomic.
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
                pinned: false,
            }],
            notes: vec![sample()],
            attachments: Vec::new(),
        }
    }

    fn record() -> Attachment {
        Attachment {
            id: "a-1".to_string(),
            note_id: sample().id,
            file_name: "capture.png".to_string(),
            mime_type: "image/png".to_string(),
            byte_size: 4,
            created_at: sample().created_at,
        }
    }

    fn scratch() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("devbox-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    /// A staging file one directory away would make the rename cross volumes.
    #[test]
    fn the_staging_file_sits_next_to_its_target() {
        let target = std::env::temp_dir()
            .join("documents")
            .join("library.devbox");

        let staged = staging_path(&target.to_string_lossy());

        assert_eq!(staged.parent(), target.parent());
        assert_ne!(staged.file_name(), target.file_name());
    }

    #[test]
    fn two_exports_of_the_same_target_never_stage_the_same_file() {
        let target = std::env::temp_dir().join("library.devbox");

        let first = staging_path(&target.to_string_lossy());
        let second = staging_path(&target.to_string_lossy());

        assert_ne!(first, second);
    }

    #[test]
    fn an_export_leaves_no_staging_file_behind() {
        let directory = scratch();
        let target = directory.join("library.devbox");

        write(&target.to_string_lossy(), &bundle(), &directory).unwrap();

        let left: Vec<_> = std::fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();

        assert_eq!(left, ["library.devbox"]);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn exporting_over_an_existing_file_replaces_it_whole() {
        let directory = scratch();
        let target = directory.join("library.devbox");
        std::fs::write(&target, "previous export, longer than what replaces it").unwrap();

        write(&target.to_string_lossy(), &bundle(), &directory).unwrap();

        let written = std::fs::read(&target).unwrap();
        assert_eq!(written[..4], ZIP_MAGIC);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn an_export_to_an_unreachable_directory_reports_rather_than_panicking() {
        let directory = scratch();

        let error = write("/no/such/directory/library.devbox", &bundle(), &directory).unwrap_err();

        assert!(matches!(error.code, crate::error::ErrorCode::FileAccess));
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_written_bundle_reads_back_as_itself() {
        let directory = scratch();
        let target = directory.join("library.devbox");

        write(&target.to_string_lossy(), &bundle(), &directory).unwrap();
        let (read_back, _) = read(&target.to_string_lossy()).unwrap();

        assert_eq!(read_back.bundle.notes.len(), 1);
        assert_eq!(read_back.bundle.spaces[0].name, "Personal");
        std::fs::remove_dir_all(&directory).ok();
    }

    /// The point of the archive: the bytes travel with the record.
    #[test]
    fn an_attachment_travels_with_its_note() {
        let directory = scratch();
        let target = directory.join("library.devbox");
        let attachment = record();
        std::fs::write(directory.join(attachment.stored_name()), b"\x89PNG").unwrap();

        let mut exported = bundle();
        exported.attachments = vec![attachment.clone()];
        let report = write(&target.to_string_lossy(), &exported, &directory).unwrap();

        assert_eq!(report.attachments, 1);

        let (read_back, mut payload) = read(&target.to_string_lossy()).unwrap();
        assert_eq!(read_back.bundle.attachments.len(), 1);
        assert_eq!(
            payload.take(&attachment.stored_name()),
            Some(b"\x89PNG".to_vec())
        );
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ A record whose file has gone missing must not fail the export: the note is what
    /// matters, and the import reports the gap.
    #[test]
    fn a_record_whose_file_is_gone_leaves_the_export_rather_than_failing_it() {
        let directory = scratch();
        let target = directory.join("library.devbox");

        let mut exported = bundle();
        exported.attachments = vec![record()];
        let report = write(&target.to_string_lossy(), &exported, &directory).unwrap();

        assert_eq!(report.attachments, 0);
        assert_eq!(report.notes, 1);
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ New DevBox reads what old DevBox wrote: a `.json` export predates the archive.
    #[test]
    fn a_json_export_from_before_the_archive_still_imports() {
        let directory = scratch();
        let target = directory.join("library.json");
        let json = serde_json::to_string_pretty(&bundle()).unwrap();
        std::fs::write(&target, json).unwrap();

        let (read_back, payload) = read(&target.to_string_lossy()).unwrap();

        assert_eq!(read_back.bundle.notes.len(), 1);
        assert!(matches!(payload, Payload::Empty));
        std::fs::remove_dir_all(&directory).ok();
    }
}
