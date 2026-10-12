use anchor_lang::prelude::*;

#[error_code]
pub enum HuntError {
    #[msg("Hunt parameters are out of range")]
    InvalidParams,
    #[msg("The account is not a hunt of this program")]
    InvalidHunt,
    #[msg("The hunt is not in the required state")]
    WrongStatus,
    #[msg("The treasure has not been sealed yet")]
    NotSealed,
    #[msg("The treasure is already sealed")]
    AlreadySealed,
    #[msg("A randomness request is still pending")]
    SealPending,
    #[msg("No randomness was requested for this treasure")]
    VrfNotRequested,
    #[msg("This hunt uses a different sealing mode")]
    WrongMode,
    #[msg("Coordinates must be a unit vector scaled by 1e9")]
    NotUnitVector,
    #[msg("The hunt has no free seats")]
    HuntFull,
    #[msg("The hunt no longer accepts players")]
    HuntClosed,
    #[msg("The hunt is not live")]
    NotLive,
    #[msg("The hunt has not started yet")]
    NotStarted,
    #[msg("The deadline has passed")]
    DeadlinePassed,
    #[msg("Signer is neither the owner nor the operator of this logbook")]
    NotPilot,
    #[msg("The airship has already embarked")]
    AlreadyEmbarked,
    #[msg("The airship has not embarked")]
    NotEmbarked,
    #[msg("The airship is still in flight")]
    InFlight,
    #[msg("The sounding gear is cooling down")]
    Cooldown,
    #[msg("The logbook is full")]
    ProbeLimit,
    #[msg("The hunt has not ended")]
    NotEnded,
    #[msg("The hunt is already finalized")]
    AlreadyFinalized,
    #[msg("The hunt is not finalized")]
    NotFinalized,
    #[msg("The vault is already settled")]
    AlreadySettled,
    #[msg("The treasure has not been revealed")]
    NotRevealed,
    #[msg("Arithmetic overflow")]
    Overflow,
}
