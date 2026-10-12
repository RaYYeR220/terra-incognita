use anchor_lang::prelude::*;

pub const HUNT_SEED: &[u8] = b"hunt";
pub const BOARD_SEED: &[u8] = b"board";
pub const TREASURE_SEED: &[u8] = b"treasure";
pub const LOGBOOK_SEED: &[u8] = b"logbook";
pub const VAULT_SEED: &[u8] = b"vault";

pub const MAX_PLAYERS: usize = 64;
pub const MAX_PROBES: usize = 64;
pub const PIN_RING: usize = 128;
pub const MAX_TITLE_LEN: usize = 48;
pub const MAX_CLUE_LEN: usize = 200;
pub const MAX_CREATOR_BPS: u16 = 2_000;
pub const PROBE_COOLDOWN_SECS: i64 = 3;
/// A VRF request that was not answered within this window may be repeated.
pub const VRF_RETRY_SECS: i64 = 60;
/// Lower bound of the lamports a hunt carries for rollup fees.
pub const MIN_OPS_LAMPORTS: u64 = 5_000_000;
/// Lamports placed in the escrow that pays for the settlement action on Solana.
pub const ACTION_ESCROW_LAMPORTS: u64 = 200_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum HuntMode {
    /// The location comes from a VRF callback inside the rollup; nobody chooses it.
    Vrf,
    /// The creator places the treasure and publishes a riddle.
    Author,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum HuntStatus {
    Created,
    Sealing,
    Live,
    /// A sounding landed within 50 km.
    Struck,
    /// The deadline passed; the closest sounding wins.
    Closest,
    /// The deadline passed without a single sounding.
    Void,
}

impl HuntStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Struck | Self::Closest | Self::Void)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Hunt {
    pub creator: Pubkey,
    pub id: u64,
    pub mode: HuntMode,
    pub validator: Pubkey,
    pub entry_fee: u64,
    pub prize_seed: u64,
    pub creator_bps: u16,
    pub max_players: u8,
    pub speed_kms: u32,
    pub starts_at: i64,
    pub deadline: i64,
    pub zone_interval_secs: u32,
    pub status: HuntStatus,
    pub finalized: bool,
    pub commitment: [u8; 32],
    pub zone_stage: u8,
    pub zone_center: [i32; 3],
    pub players: u8,
    pub probes_total: u32,
    pub winner: Pubkey,
    pub revealed_location: [i32; 3],
    pub revealed_salt: [u8; 32],
    pub ended_at: i64,
    pub bump: u8,
    pub board_bump: u8,
    pub treasure_bump: u8,
    pub vault_bump: u8,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    #[max_len(MAX_CLUE_LEN)]
    pub clue: String,
}

impl Hunt {
    /// Account the prize is paid to: the winner, or the creator of a void hunt.
    pub fn payee(&self) -> Pubkey {
        if self.status == HuntStatus::Void {
            self.creator
        } else {
            self.winner
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct Treasure {
    pub hunt: Pubkey,
    pub sealed: bool,
    /// Set at finalisation; unlocks the audit openers.
    pub revealed: bool,
    /// Raw VRF output the location is derived from. Zero for author-placed treasures.
    pub entropy: [u8; 32],
    pub location: [i32; 3],
    pub salt: [u8; 32],
    pub zone_seed: [u8; 32],
    pub vrf_requested_at: i64,
    /// Closest sounding so far; `NO_SOUNDING` until the first one.
    pub best_dot: i64,
    pub best_player: Pubkey,
    pub best_ts: i64,
    /// First sounding within striking distance. It stays here, unseen, until a later
    /// `tick` promotes it to the public hunt state. A zero slot means no strike.
    pub strike_player: Pubkey,
    pub strike_slot: u64,
    pub strike_ts: i64,
    pub bump: u8,
}

impl Treasure {
    /// Below every possible dot product of two points.
    pub const NO_SOUNDING: i64 = -2 * crate::geo::S2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct LogEntry {
    pub pos: [i32; 3],
    pub band: u8,
    pub ts: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Logbook {
    pub hunt: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub ship_index: u8,
    pub embarked: bool,
    pub bump: u8,
    #[max_len(MAX_PROBES)]
    pub entries: Vec<LogEntry>,
}

impl Logbook {
    pub fn is_pilot(&self, key: &Pubkey) -> bool {
        *key == self.owner || *key == self.operator
    }
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub hunt: Pubkey,
    pub prize_seed: u64,
    pub entry_total: u64,
    pub entrants: u8,
    pub settled: bool,
    pub bump: u8,
}

#[zero_copy]
pub struct Ship {
    pub owner: Pubkey,
    pub depart_ts: i64,
    pub arrive_ts: i64,
    pub last_probe_ts: i64,
    pub from: [i32; 3],
    pub to: [i32; 3],
    pub probes: u8,
    pub embarked: u8,
    pub _padding: [u8; 6],
}

#[zero_copy]
pub struct Pin {
    pub ts: i64,
    pub pos: [i32; 3],
    pub ship_index: u8,
    pub _padding: [u8; 3],
}

/// Public state of a hunt: where every airship is and where the last soundings were taken.
#[account(zero_copy)]
pub struct Board {
    pub hunt: Pubkey,
    /// Total pins ever pushed; the ring slot of the next pin is `pin_count % PIN_RING`.
    pub pin_count: u32,
    pub ship_count: u8,
    pub _padding: [u8; 3],
    pub ships: [Ship; MAX_PLAYERS],
    pub pins: [Pin; PIN_RING],
}

impl Board {
    pub const SPACE: usize = 8 + core::mem::size_of::<Board>();

    pub fn push_pin(&mut self, ship_index: u8, pos: [i32; 3], ts: i64) {
        let slot = self.pin_count as usize % PIN_RING;
        self.pins[slot] = Pin {
            ts,
            pos,
            ship_index,
            _padding: [0; 3],
        };
        self.pin_count = self.pin_count.wrapping_add(1);
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HuntParams {
    pub mode: HuntMode,
    pub validator: Pubkey,
    pub entry_fee: u64,
    pub prize_seed: u64,
    pub creator_bps: u16,
    pub max_players: u8,
    pub speed_kms: u32,
    pub starts_at: i64,
    pub deadline: i64,
    pub zone_interval_secs: u32,
    /// Lamports left on the hunt account for rollup fees.
    pub ops_lamports: u64,
    pub title: String,
    pub clue: String,
}
