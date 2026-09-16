/** Generated from the Rust enum, so a state added there breaks the shell until handled. */
export type { VaultState } from '@core/ipc/bindings';

/**
 * What `vault::validate` refuses below. Said on the front too, so a first launch does not
 * answer "too short" after a second of derivation, and an export prompt can refuse a
 * phrase it would be sold as protection.
 */
export const MINIMUM_PASSPHRASE_LENGTH = 8;
