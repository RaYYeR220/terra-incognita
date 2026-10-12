//! Selections whose executed instructions do not depend on their operands.
//!
//! `probe` handles the secret location. Its compute use must not vary with what it finds,
//! or a caller could learn the result from the point at which a compute budget runs out.

//!
//! Writing the arithmetic branch-free is not enough on its own: once the optimiser can see
//! that a value is a 0/1 flag, it turns the masks back into a comparison or a select, and
//! SBF has no conditional move, so that becomes a branch. Every flag therefore passes
//! through `opaque` before it is used.

use anchor_lang::prelude::Pubkey;

/// Returns `x` through a volatile load, so the optimiser knows nothing about its range.
#[inline(always)]
pub fn opaque(x: u64) -> u64 {
    // SAFETY: reads a live local that is properly aligned and initialised.
    unsafe { core::ptr::read_volatile(&x) }
}

/// 1 when `x` is zero, otherwise 0. `x` must be below 2⁶³.
#[inline(always)]
pub fn is_zero(x: u64) -> u64 {
    opaque(x).wrapping_sub(1) >> 63
}

/// `yes` when `flag` is 1, `no` when it is 0.
#[inline(always)]
pub fn pick_u64(flag: u64, yes: u64, no: u64) -> u64 {
    no ^ (opaque(flag).wrapping_neg() & (yes ^ no))
}

/// `yes` when `flag` is 1, `no` when it is 0.
#[inline(always)]
pub fn pick_i64(flag: u64, yes: i64, no: i64) -> i64 {
    pick_u64(flag, yes as u64, no as u64) as i64
}

/// `yes` when `flag` is 1, `no` when it is 0.
#[inline(always)]
pub fn pick_key(flag: u64, yes: &Pubkey, no: &Pubkey) -> Pubkey {
    let mask = (opaque(flag) as u8).wrapping_neg();
    let (yes, no) = (yes.as_ref(), no.as_ref());
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = no[i] ^ (mask & (yes[i] ^ no[i]));
    }
    Pubkey::new_from_array(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_test() {
        assert_eq!(is_zero(0), 1);
        assert_eq!(is_zero(1), 0);
        assert_eq!(is_zero(7), 0);
        assert_eq!(is_zero(i64::MAX as u64), 0);
    }

    #[test]
    fn picks() {
        assert_eq!(pick_u64(1, 5, 9), 5);
        assert_eq!(pick_u64(0, 5, 9), 9);
        assert_eq!(pick_i64(1, -5, i64::MAX), -5);
        assert_eq!(pick_i64(0, -5, i64::MIN), i64::MIN);
        let (a, b) = (Pubkey::new_from_array([1; 32]), Pubkey::new_from_array([0xfe; 32]));
        assert_eq!(pick_key(1, &a, &b), a);
        assert_eq!(pick_key(0, &a, &b), b);
    }
}
