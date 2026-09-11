/**
 * A **global variable**: the value a `{{field}}` takes across the whole corpus,
 * failing a value typed on the note itself.
 *
 * A pair rather than a `Record` entry: the panel edits a **list**, where a
 * half-filled row and a duplicate row have to exist long enough to be
 * corrected. An object could carry neither.
 */
export interface Variable {
  readonly name: string;
  readonly value: string;
}

/**
 * ⚠️ Mirror of `notes::placeholder::is_field_name` (Rust).
 *
 * The rule lives there — it is what decides whether `{{ user.name }}` demands a
 * form — and the back end already refuses what does not match. This duplicate
 * only exists to **say so beforehand**: without it a badly named row would
 * vanish on save without a word.
 */
export function isVariableName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

/**
 * The variables ready to leave: the named and filled rows, the last one winning
 * on a duplicate — as the JSON object crossing the bridge would.
 *
 * An empty value is not sent: empty means "I keep what the snippet offers", and
 * writing it would freeze that answer.
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

/** Names carried by more than one row: the panel flags them. */
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
