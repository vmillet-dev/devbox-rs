/**
 * Node ≥ 22 ships a `localStorage` global of its own. It shadows the one jsdom installs
 * and evaluates to `undefined` unless the process was started with `--localstorage-file`,
 * which is enough to take down every spec that touches it; reading it also prints an
 * `ExperimentalWarning` once per worker.
 *
 * The replacement is therefore installed **unconditionally**: finding out whether the
 * global works means reading the accessor, which is exactly what emits that warning.
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
