/**
 * Une **variable globale** : la valeur qu'un `{{champ}}` prend dans tout le
 * corpus, faute d'une valeur saisie sur la note elle-même.
 *
 * Une paire plutôt qu'une entrée de `Record` : le panneau édite une **liste**,
 * où une ligne à moitié remplie et une ligne en double doivent exister le temps
 * d'être corrigées. Un objet ne saurait porter ni l'une ni l'autre.
 */
export interface Variable {
  readonly name: string;
  readonly value: string;
}

/**
 * ⚠️ Miroir de `notes::placeholder::is_field_name` (Rust).
 *
 * La règle vit là-bas — c'est elle qui décide si `{{ user.name }}` réclame un
 * formulaire — et le back refuse déjà ce qui n'y répond pas. Ce doublon ne sert
 * qu'à le **dire avant** : sans lui, une ligne mal nommée disparaîtrait à
 * l'enregistrement sans un mot.
 */
export function isVariableName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

/**
 * Les variables prêtes à partir : les lignes nommées et renseignées, la
 * dernière l'emportant en cas de doublon — comme le ferait l'objet JSON qui
 * traverse le pont.
 *
 * Une valeur vide n'est pas envoyée : vide veut dire « je garde ce que le
 * snippet propose », et l'écrire figerait cette réponse.
 */
export function toVariableRecord(variables: readonly Variable[]): Record<string, string> {
  const record: Record<string, string> = {};

  for (const { name, value } of variables) {
    if (isVariableName(name) && value !== '') {
      record[name] = value;
    }
  }

  return record;
}

/** Les noms portés par plus d'une ligne : le panneau les signale. */
export function duplicateNames(variables: readonly Variable[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const { name } of variables) {
    if (name === '') continue;

    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }

  return duplicates;
}
