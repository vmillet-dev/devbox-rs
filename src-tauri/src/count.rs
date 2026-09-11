//! Counters that cross the bridge.

/// Saturates instead of failing.
///
/// Specta refuses `usize` and `i64` — JSON carries no integer that wide without
/// loss — and every counter here is a number of rows, which plateaus far below
/// `u32::MAX`. Losing the exact figure on an absurd value beats failing a whole
/// command over a label.
pub(crate) fn saturating_u32<T: TryInto<u32>>(value: T) -> u32 {
    value.try_into().unwrap_or(u32::MAX)
}
