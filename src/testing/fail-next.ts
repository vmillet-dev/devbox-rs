/**
 * Shared failure gate for the in-memory repositories.
 *
 * Each double exposes `failNext`; a spec sets it to make the next call reject
 * once, which is how error paths are exercised without a real backend.
 */
export interface FailsNext {
  failNext: Error | null;
}

export function guard<T>(owner: FailsNext, operation: () => T): Promise<T> {
  if (owner.failNext) {
    const error = owner.failNext;
    owner.failNext = null;
    return Promise.reject(error);
  }
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}
