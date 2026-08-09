//! Panne de persistance.

use thiserror::Error;

/// Les commandes convertissent ces variantes en `AppError` : la variante devient
/// un **code** que le front traduit, et le `Display` n'est plus que le détail
/// technique — c'est pourquoi il peut rester en français.
#[derive(Debug, Error)]
pub enum StorageError {
    /// Jamais un `Ok` silencieux : le front croirait avoir enregistré.
    #[error("Note introuvable : {0}")]
    NoteNotFound(String),
    /// Espace visé inexistant : la note n'aurait nulle part où être rangée.
    #[error("Espace introuvable : {0}")]
    SpaceNotFound(String),
    /// Nom déjà pris (comparaison insensible à la casse).
    #[error("Un espace nommé « {0} » existe déjà")]
    DuplicateSpaceName(String),
    /// Colonne qu'aucune écriture de ce code n'aurait pu produire.
    #[error("Note « {id} » illisible : le champ « {field} » est hors format")]
    CorruptRow { id: String, field: &'static str },
    /// Base portant une migration que ce binaire ne connaît pas : elle a été
    /// écrite par une version plus récente de l'application.
    #[error("Base de données portant la migration « {0} », inconnue de cette version de DevBox")]
    SchemaTooRecent(String),
    /// Ouverture ou migration impossible — panne d'avant le premier `SELECT`.
    #[error("Migration impossible : {0}")]
    Migration(String),
    /// `#[from]` : requis par `Connection::transaction`, qui exige de savoir
    /// absorber l'erreur de Diesel dans celle de l'appelant. `#[source]` en
    /// prime, là où l'ancien `impl Display` écrasé perdait la chaîne de causes.
    #[error("Erreur de stockage : {0}")]
    Sqlite(#[from] diesel::result::Error),
}
