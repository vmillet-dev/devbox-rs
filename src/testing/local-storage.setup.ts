/**
 * `localStorage` for the test environment.
 *
 * Node ≥ 22 ships a `localStorage` global of its own. It shadows the one jsdom
 * installs and evaluates to `undefined` unless the process was started with
 * `--localstorage-file`, which is enough to take down every spec that touches
 * it: the legacy-preferences migration, and the three shells that clear it
 * between tests. Reading it also prints `ExperimentalWarning: localStorage is
 * not available` once per worker.
 *
 * The replacement is therefore installed **unconditionally**, without first
 * checking whether the global works — finding out means reading the accessor,
 * which is exactly what emits that warning. Nothing here depends on what jsdom's
 * implementation adds over this one (quota errors, `storage` events), so one
 * implementation on every Node version is also one less thing that can differ
 * between a laptop and CI.
 *
 * Setup files run once per spec file, so each gets its own empty storage; the
 * specs that care clear it in a `beforeEach` anyway.
 */

function createStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length(): number {
      return entries.size;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return entries.get(String(key)) ?? null;
    },
    // The real thing stringifies both sides; a spec storing a number must read
    // one back as a string, like the WebView would hand it over.
    setItem(key: string, value: string): void {
      entries.set(String(key), String(value));
    },
    removeItem(key: string): void {
      entries.delete(String(key));
    },
    clear(): void {
      entries.clear();
    },
  };
}

Object.defineProperty(globalThis, 'localStorage', {
  value: createStorage(),
  configurable: true,
  enumerable: false,
  writable: false,
});
