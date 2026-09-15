//! ⚠️ The bytes are not here: the database holds a record, and the file lives in
//! `app_data_dir()/attachments/` under a name derived from the id — two captures called
//! `image.png` must not overwrite each other, and a name from outside has no business
//! deciding a write path.

use chrono::{DateTime, Utc};
use serde::Serialize;
use specta::Type;

use crate::count::saturating_u32;
use crate::error::{StorageError, ValidationError};

/// 10 MB: past that it is no longer a screenshot pasted next to a note.
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub note_id: String,
    /// The original name, the one displayed. ⚠️ Never used as a path.
    pub file_name: String,
    pub mime_type: String,
    /// `u32` and not `u64`: Specta refuses what JSON cannot carry without loss.
    pub byte_size: u32,
    pub created_at: DateTime<Utc>,
}

impl Attachment {
    pub fn stored_name(&self) -> String {
        stored_name(&self.id, &self.file_name)
    }
}

/// ⚠️ Lowercase and purely alphanumeric: anything else (separators, `..`, colons) would
/// escape the attachments directory.
fn extension_of(file_name: &str) -> Option<String> {
    let candidate = file_name.rsplit_once('.')?.1;
    if candidate.is_empty()
        || candidate.len() > 8
        || !candidate.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return None;
    }

    Some(candidate.to_ascii_lowercase())
}

pub fn stored_name(id: &str, file_name: &str) -> String {
    match extension_of(file_name) {
        Some(extension) => format!("{id}.{extension}"),
        None => id.to_string(),
    }
}

/// Deliberately short: an unknown type stays attachable, it is simply not previewed.
pub fn mime_of(file_name: &str) -> String {
    let mime = match extension_of(file_name).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("txt" | "log" | "md") => "text/plain",
        Some("csv") => "text/csv",
        Some("zip") => "application/zip",
        _ => "application/octet-stream",
    };

    mime.to_string()
}

/// ⚠️ Stripped of any path: an import must not be able to show `../../secrets/key.pem`
/// as though the note had produced it.
pub fn display_name(path: &str) -> Result<String, ValidationError> {
    let trimmed = path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();

    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(ValidationError::new("fileName", "unreadable file name"));
    }

    Ok(trimmed)
}

/// The caller supplies a readable timestamp, this guarantees the extension: without it
/// `mime_of` would answer `application/octet-stream` and skip the preview.
pub fn png_name(base: &str) -> String {
    let trimmed = base.trim();
    let stem = if trimmed.is_empty() {
        "capture"
    } else {
        trimmed
    };

    if stem.to_ascii_lowercase().ends_with(".png") {
        stem.to_string()
    } else {
        format!("{stem}.png")
    }
}

/// Encodes raw RGBA — what the system clipboard hands over — into PNG.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, StorageError> {
    let expected = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    if width == 0 || height == 0 || rgba.len() < expected {
        return Err(StorageError::File(format!(
            "clipboard image of {width}×{height} carries {} bytes, {expected} expected",
            rgba.len()
        )));
    }

    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| StorageError::File(format!("png header: {error}")))?;
        writer
            .write_image_data(&rgba[..expected])
            .map_err(|error| StorageError::File(format!("png data: {error}")))?;
    }

    Ok(png)
}

pub fn validate_size(byte_size: u64) -> Result<u32, ValidationError> {
    if byte_size > MAX_BYTES {
        return Err(ValidationError::new(
            "byteSize",
            format!("attachment of {byte_size} bytes, limit is {MAX_BYTES}"),
        ));
    }

    Ok(saturating_u32(byte_size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stored_name_comes_from_the_identifier_not_from_the_user() {
        assert_eq!(stored_name("a-1", "capture.png"), "a-1.png");
        assert_eq!(stored_name("a-2", "capture.png"), "a-2.png");
    }

    #[test]
    fn a_hostile_extension_is_dropped_rather_than_written() {
        for name in ["x.../../evil", "x.p g", "x.", "x.verylongextension"] {
            assert_eq!(stored_name("a-1", name), "a-1");
        }
    }

    #[test]
    fn the_extension_decides_the_type_case_insensitively() {
        assert_eq!(mime_of("Capture.PNG"), "image/png");
        assert_eq!(mime_of("dump.unknown"), "application/octet-stream");
    }

    #[test]
    fn only_the_last_segment_of_a_path_is_displayed() {
        assert_eq!(
            display_name(r"C:\Users\me\capture.png").unwrap(),
            "capture.png"
        );
        assert_eq!(display_name("/home/me/capture.png").unwrap(), "capture.png");
    }

    #[test]
    fn a_path_with_no_file_name_is_refused_with_its_field() {
        assert_eq!(display_name("  ").unwrap_err().field, "fileName");
        assert_eq!(display_name("/tmp/..").unwrap_err().field, "fileName");
    }

    #[test]
    fn a_file_over_the_limit_is_refused_before_being_copied() {
        assert!(validate_size(MAX_BYTES).is_ok());
        assert_eq!(validate_size(MAX_BYTES + 1).unwrap_err().field, "byteSize");
    }

    #[test]
    fn a_pasted_image_always_ends_up_with_its_extension() {
        assert_eq!(png_name("capture-2026"), "capture-2026.png");
        assert_eq!(png_name("capture.PNG"), "capture.PNG");
        assert_eq!(png_name("   "), "capture.png");
    }

    #[test]
    fn raw_clipboard_pixels_become_a_readable_png() {
        let rgba = vec![255u8; 2 * 2 * 4];

        let png = encode_png(2, 2, &rgba).unwrap();

        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(mime_of(&png_name("capture")), "image/png");
    }

    #[test]
    fn a_truncated_clipboard_image_is_refused_rather_than_written() {
        assert!(encode_png(2, 2, &[0u8; 4]).is_err());
        assert!(encode_png(0, 0, &[]).is_err());
    }
}
