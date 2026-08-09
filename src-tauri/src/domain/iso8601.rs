//! Format des instants **stockés**, et sa lecture.
//!
//! ⚠️ Les millisecondes sont toujours écrites, même nulles. `created_at` et
//! `updated_at` sont des colonnes TEXT triées lexicographiquement, et le canevas
//! s'ordonne dessus : `.` (0x2E) précédant `Z` (0x5A), un `09:00:00.500Z`
//! passerait **avant** un `09:00:00Z`. `SecondsFormat::AutoSi`, le défaut de
//! chrono, tombe précisément dans ce piège.
//!
//! Le fil, lui, n'en dépend pas : le front convertit en `Date` à la frontière.

use chrono::{DateTime, SecondsFormat, Utc};

/// `2026-07-25T09:12:00.000Z`.
pub fn format(instant: DateTime<Utc>) -> String {
    instant.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn parse(value: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    DateTime::parse_from_rfc3339(value).map(|instant| instant.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn milliseconds_are_written_even_when_they_are_zero() {
        let instant = parse("2026-07-25T09:00:00Z").unwrap();

        assert_eq!(format(instant), "2026-07-25T09:00:00.000Z");
    }

    #[test]
    fn the_written_form_sorts_the_way_the_column_does() {
        // This is the whole point: the canvas orders on a lexicographic TEXT
        // comparison, so the shorter form would sort *after* a longer one of the
        // same second.
        let plain = format(parse("2026-07-25T09:00:00Z").unwrap());
        let with_millis = format(parse("2026-07-25T09:00:00.500Z").unwrap());

        assert!(plain < with_millis);
    }

    #[test]
    fn an_offset_instant_is_normalised_to_utc() {
        // A column read as UTC but holding a local time would shift the note by
        // hours; normalising on the way in is what makes the comparison sound.
        let instant = parse("2026-07-25T11:00:00+02:00").unwrap();

        assert_eq!(format(instant), "2026-07-25T09:00:00.000Z");
    }

    #[test]
    fn a_round_trip_keeps_the_instant() {
        let written = "2026-07-25T09:12:34.567Z";

        assert_eq!(format(parse(written).unwrap()), written);
    }
}
