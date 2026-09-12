use chrono::{DateTime, TimeDelta, Utc};
use serde::Serialize;
use specta::Type;

use super::model::Note;

/// Single threshold: the panel shows the deadline the purge applies.
pub const RETENTION: TimeDelta = TimeDelta::days(30);

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrashedNote {
    #[serde(flatten)]
    pub note: Note,
    pub deleted_at: DateTime<Utc>,
    /// Derived, never stored: retention can change between versions.
    pub purge_at: DateTime<Utc>,
}

pub fn purge_at(deleted_at: DateTime<Utc>) -> DateTime<Utc> {
    deleted_at + RETENTION
}

pub fn is_expired(deleted_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    purge_at(deleted_at) <= now
}

pub fn trashed(note: Note, deleted_at: DateTime<Utc>) -> TrashedNote {
    TrashedNote {
        note,
        deleted_at,
        purge_at: purge_at(deleted_at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::iso8601;

    fn at(iso: &str) -> DateTime<Utc> {
        iso8601::parse(iso).unwrap()
    }

    #[test]
    fn a_note_deleted_today_expires_thirty_days_later() {
        assert_eq!(
            purge_at(at("2026-07-25T09:00:00.000Z")),
            at("2026-08-24T09:00:00.000Z")
        );
    }

    #[test]
    fn the_last_day_still_belongs_to_the_user() {
        let deleted = at("2026-07-25T09:00:00.000Z");

        assert!(!is_expired(deleted, at("2026-08-24T08:59:59.999Z")));
        assert!(is_expired(deleted, at("2026-08-24T09:00:00.000Z")));
    }
}
