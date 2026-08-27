//! Une pièce jointe : ce que la base retient, et les règles qui décident du
//! reste.
//!
//! Les octets ne sont pas ici. La base ne garde qu'une fiche ; le fichier vit
//! dans `app_data_dir()/attachments/`, sous un nom **dérivé de l'identifiant** —
//! deux captures nommées `image.png` ne doivent pas s'écraser, et un nom venu de
//! l'extérieur n'a pas à décider d'un chemin d'écriture.

use chrono::{DateTime, Utc};
use serde::Serialize;
use specta::Type;

use crate::error::{StorageError, ValidationError};

/// 10 Mo : au-delà, ce n'est plus une capture d'écran collée à côté d'une note.
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub note_id: String,
    /// Nom d'origine, celui qu'on affiche. Jamais utilisé comme chemin.
    pub file_name: String,
    pub mime_type: String,
    /// `u32` et non `u64` : Specta refuse ce que JSON ne rend pas sans perte, et
    /// [`MAX_BYTES`] tient largement dedans.
    pub byte_size: u32,
    pub created_at: DateTime<Utc>,
}

impl Attachment {
    /// Nom du fichier sur le disque.
    pub fn stored_name(&self) -> String {
        stored_name(&self.id, &self.file_name)
    }

    pub fn is_image(&self) -> bool {
        self.mime_type.starts_with("image/")
    }
}

/// Extension retenue **en minuscules et purement alphanumérique** : le reste
/// (séparateurs, `..`, deux-points) sortirait du dossier des pièces jointes.
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

/// Table volontairement courte : ce qu'on sait afficher, plus un repli. Un type
/// inconnu reste attachable, il n'est simplement pas prévisualisé.
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

/// Le nom d'origine, débarrassé de tout chemin : un import ne doit pas pouvoir
/// afficher `../../secrets/clé.pem` comme si la note l'avait produit.
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

/// Nom donné à une image collée : l'appelant fournit un horodatage lisible, on
/// garantit l'extension. Sans elle, `mime_of` rendrait `application/octet-stream`
/// et la capture ne serait pas prévisualisée.
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

/// Encode du RGBA brut — ce que le presse-papier système rend — en PNG.
///
/// Le presse-papier ne donne pas de fichier : sans cet encodage il faudrait
/// stocker des octets qu'aucun visualiseur ne saurait ouvrir.
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

    // La borne au-dessus garantit la conversion.
    Ok(u32::try_from(byte_size).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stored_name_comes_from_the_identifier_not_from_the_user() {
        // Deux « capture.png » collées à deux notes ne doivent pas s'écraser.
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
        // Sans elle, `mime_of` rendrait `application/octet-stream` et la capture
        // ne serait jamais prévisualisée.
        assert_eq!(png_name("capture-2026"), "capture-2026.png");
        assert_eq!(png_name("capture.PNG"), "capture.PNG");
        assert_eq!(png_name("   "), "capture.png");
    }

    #[test]
    fn raw_clipboard_pixels_become_a_readable_png() {
        let rgba = vec![255u8; 2 * 2 * 4];

        let png = encode_png(2, 2, &rgba).unwrap();

        // La signature PNG : ce que le fichier doit porter pour qu'un
        // visualiseur — le nôtre compris — accepte de l'ouvrir.
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(mime_of(&png_name("capture")), "image/png");
    }

    #[test]
    fn a_truncated_clipboard_image_is_refused_rather_than_written() {
        // Le presse-papier peut rendre une image vide ou incohérente ; écrire un
        // fichier illisible serait pire que ne rien attacher.
        assert!(encode_png(2, 2, &[0u8; 4]).is_err());
        assert!(encode_png(0, 0, &[]).is_err());
    }
}
