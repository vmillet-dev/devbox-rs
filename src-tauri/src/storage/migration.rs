//! Application des migrations embarquées, et adoption des bases héritées.
//!
//! ⚠️ **Append-only.** Faire évoluer le modèle = ajouter un dossier
//! `migrations/AAAA-MM-JJ-HHMMSS_nom/`, jamais modifier une migration livrée.

#[cfg(test)]
mod tests;

use diesel::migration::MigrationSource;
use diesel::prelude::*;
use diesel::sql_types::{Integer, Text};
use diesel::sqlite::Sqlite;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

use super::error::StorageError;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// Valeur maximale qu'a livrée l'ancien `PRAGMA user_version`. Ne bouge plus :
/// une migration ajoutée aujourd'hui n'a jamais existé sous l'ancien schéma.
const LEGACY_MIGRATION_COUNT: usize = 3;

#[derive(QueryableByName)]
struct UserVersion {
    #[diesel(sql_type = Integer)]
    user_version: i32,
}

fn embedded_versions() -> Result<Vec<String>, StorageError> {
    let mut versions = MigrationSource::<Sqlite>::migrations(&MIGRATIONS)
        .map_err(|error| StorageError::Migration(error.to_string()))?
        .iter()
        .map(|migration| migration.name().version().to_string())
        .collect::<Vec<_>>();
    versions.sort();

    Ok(versions)
}

/// Fait adopter par Diesel l'historique qu'écrivait l'ancien `PRAGMA user_version`.
///
/// Sans elle, une base déjà installée rejouerait la migration initiale sur des
/// tables existantes. Les `n` premières sont donc marquées appliquées sans être
/// exécutées, et le pragma remis à zéro — deux sources de vérité sur l'état du
/// schéma finiraient par diverger.
fn adopt_legacy_history(
    connection: &mut SqliteConnection,
    embedded: &[String],
) -> Result<(), StorageError> {
    let legacy: i32 = diesel::sql_query("PRAGMA user_version")
        .get_result::<UserVersion>(connection)?
        .user_version;

    // Zéro : base neuve, ou passée par ici lors d'une ouverture précédente.
    if legacy <= 0 {
        return Ok(());
    }

    // Crée `__diesel_schema_migrations` si elle manque — l'insertion suit.
    connection
        .applied_migrations()
        .map_err(|error| StorageError::Migration(error.to_string()))?;

    let adopted = usize::try_from(legacy)
        .unwrap_or(0)
        .min(LEGACY_MIGRATION_COUNT)
        .min(embedded.len());

    connection.transaction(|connection| {
        for version in &embedded[..adopted] {
            diesel::sql_query(
                "INSERT OR IGNORE INTO __diesel_schema_migrations (version) VALUES (?)",
            )
            .bind::<Text, _>(version)
            .execute(connection)?;
        }
        diesel::sql_query("PRAGMA user_version = 0").execute(connection)?;

        Ok::<_, StorageError>(())
    })
}

pub fn run(connection: &mut SqliteConnection) -> Result<(), StorageError> {
    let embedded = embedded_versions()?;

    adopt_legacy_history(connection, &embedded)?;

    // Une migration appliquée qu'on ne connaît pas signale une base écrite par
    // une version plus récente : refuser vaut mieux qu'écraser ses données.
    let applied = connection
        .applied_migrations()
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    if let Some(unknown) = applied
        .iter()
        .map(ToString::to_string)
        .find(|version| !embedded.contains(version))
    {
        return Err(StorageError::SchemaTooRecent(unknown));
    }

    connection
        .run_pending_migrations(MIGRATIONS)
        .map_err(|error| StorageError::Migration(error.to_string()))?;

    Ok(())
}
