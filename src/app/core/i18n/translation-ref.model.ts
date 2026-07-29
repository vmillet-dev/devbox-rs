/**
 * Référence vers une clé Transloco, consommée par le pipe `transloco` dans le
 * template.
 *
 * Règle de la maison : le code qui produit du texte destiné à l'utilisateur
 * renvoie une référence, jamais une chaîne formatée — la traduction a donc
 * toujours lieu dans la langue active.
 */
export interface TranslationRef {
  readonly key: string;
  readonly params?: Record<string, unknown>;
}
