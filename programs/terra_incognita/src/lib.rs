//! Terra Incognita: a global treasure hunt whose location nobody knows.
//!
//! The treasure is sealed inside a private ephemeral rollup. Players fly airships over a
//! globe and take soundings; the program measures the distance to the treasure inside the
//! enclave and writes a coarse band into the player's private logbook. A commitment
//! published before play and the location revealed afterwards make every hint auditable.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_instruction,
};
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::{Discriminator, InstructionData};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi},
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, ACCOUNT_SIGNATURES_FLAG,
            PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{action, commit, delegate, ephemeral, vrf, vrf_callback},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::{delegate_account_with_actions, DelegateAccounts, DelegateConfig},
    dlp_api::args::PostDelegationActions,
    ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder},
    vrf::{
        consts::DEFAULT_EPHEMERAL_QUEUE,
        instructions::{create_request_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
    ActionArgs, ShortAccountMeta,
};
#[allow(deprecated)]
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use hydra_api::instruction::{CreateArgs, SchedMeta, ScheduledIx};
use solana_sha256_hasher::hashv;

pub mod blind;
pub mod errors;
pub mod geo;
pub mod state;

use errors::HuntError;
use geo::Vec3;
use state::*;

declare_id!("37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v");

/// Hydra scheduler deployed inside ephemeral rollups.
pub const HYDRA_EPHEMERAL_ID: Pubkey = pubkey!("eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf");
pub const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const MAGIC_FEE_VAULT_SEED: &[u8] = b"magic-fee-vault";
const ACTION_ESCROW_SEED: &[u8] = b"balance";
/// Escrow slot the delegation program charges for post-commit actions.
const ACTION_ESCROW_INDEX: u8 = 255;
const TOP_UP_EPHEMERAL_BALANCE: u64 = 9;
const CLOSE_EPHEMERAL_BALANCE: u64 = 11;
const SETTLE_COMPUTE_UNITS: u32 = 120_000;
const TICK_COMPUTE_UNITS: u32 = 400_000;
/// Rollup slots per second.
const SLOTS_PER_SEC: u64 = 20;

#[ephemeral]
#[program]
pub mod terra_incognita {
    use super::*;

    /// Creates a hunt on Solana: the public hunt and board, the treasure that will hold the
    /// secret, and the vault that keeps the prize until settlement.
    pub fn create_hunt(ctx: Context<CreateHunt>, id: u64, params: HuntParams) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            params.creator_bps <= MAX_CREATOR_BPS
                && (1..=MAX_PLAYERS as u8).contains(&params.max_players)
                && params.speed_kms > 0
                && params.zone_interval_secs > 0
                && params.starts_at <= now + MAX_START_DELAY_SECS
                && params.deadline >= params.starts_at.max(now) + MIN_PLAY_SECS
                && params.deadline - params.starts_at.max(now) <= MAX_DURATION_SECS
                && params.ops_lamports >= MIN_OPS_LAMPORTS
                && params.title.len() <= MAX_TITLE_LEN
                && params.clue.len() <= MAX_CLUE_LEN,
            HuntError::InvalidParams
        );

        let hunt_key = ctx.accounts.hunt.key();
        let hunt = &mut ctx.accounts.hunt;
        hunt.creator = ctx.accounts.creator.key();
        hunt.id = id;
        hunt.mode = params.mode;
        hunt.validator = params.validator;
        hunt.entry_fee = params.entry_fee;
        hunt.prize_seed = params.prize_seed;
        hunt.creator_bps = params.creator_bps;
        hunt.max_players = params.max_players;
        hunt.speed_kms = params.speed_kms;
        hunt.starts_at = params.starts_at;
        hunt.deadline = params.deadline;
        hunt.zone_interval_secs = params.zone_interval_secs;
        hunt.status = HuntStatus::Created;
        hunt.bump = ctx.bumps.hunt;
        hunt.board_bump = ctx.bumps.board;
        hunt.treasure_bump = ctx.bumps.treasure;
        hunt.vault_bump = ctx.bumps.vault;
        hunt.title = params.title;
        hunt.clue = params.clue;

        ctx.accounts.board.load_init()?.hunt = hunt_key;

        let treasure = &mut ctx.accounts.treasure;
        treasure.hunt = hunt_key;
        treasure.best_dot = Treasure::NO_SOUNDING;
        treasure.bump = ctx.bumps.treasure;

        let vault = &mut ctx.accounts.vault;
        vault.hunt = hunt_key;
        vault.prize_seed = params.prize_seed;
        vault.bump = ctx.bumps.vault;

        let creator = ctx.accounts.creator.to_account_info();
        let system_program = ctx.accounts.system_program.key();
        for (to, lamports) in [
            (ctx.accounts.vault.to_account_info(), params.prize_seed),
            (ctx.accounts.hunt.to_account_info(), params.ops_lamports),
            (ctx.accounts.treasure.to_account_info(), permission_rent(2)),
        ] {
            transfer(
                CpiContext::new(
                    system_program,
                    Transfer {
                        from: creator.clone(),
                        to,
                    },
                ),
                lamports,
            )?;
        }

        // Escrow that pays for the settlement action the rollup schedules at the end.
        let mut data = TOP_UP_EPHEMERAL_BALANCE.to_le_bytes().to_vec();
        data.extend_from_slice(&ACTION_ESCROW_LAMPORTS.to_le_bytes());
        data.push(ACTION_ESCROW_INDEX);
        let top_up = Instruction {
            program_id: DELEGATION_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(creator.key(), true),
                AccountMeta::new_readonly(hunt_key, false),
                AccountMeta::new(ctx.accounts.action_escrow.key(), false),
                AccountMeta::new_readonly(system_program, false),
            ],
            data,
        };
        invoke_signed(
            &top_up,
            &[
                creator.clone(),
                ctx.accounts.hunt.to_account_info(),
                ctx.accounts.action_escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
        )?;
        Ok(())
    }

    /// Delegates the hunt, its board and its treasure to the hunt's validator.
    /// Accounts that are already delegated are skipped, so the call can be repeated.
    pub fn delegate_hunt(ctx: Context<DelegateHunt>, id: u64) -> Result<()> {
        let hunt = read_hunt(&ctx.accounts.hunt)?;
        require!(hunt.status == HuntStatus::Created, HuntError::WrongStatus);
        let config = || DelegateConfig {
            validator: Some(hunt.validator),
            ..Default::default()
        };
        let creator = ctx.accounts.creator.key();
        let hunt_key = ctx.accounts.hunt.key();

        if ctx.accounts.board.owner == &crate::ID {
            ctx.accounts.delegate_board(
                &ctx.accounts.creator,
                &[BOARD_SEED, hunt_key.as_ref()],
                config(),
            )?;
        }
        if ctx.accounts.treasure.owner == &crate::ID {
            ctx.accounts.delegate_treasure(
                &ctx.accounts.creator,
                &[TREASURE_SEED, hunt_key.as_ref()],
                config(),
            )?;
        }
        if ctx.accounts.hunt.owner == &crate::ID {
            ctx.accounts.delegate_hunt(
                &ctx.accounts.creator,
                &[HUNT_SEED, creator.as_ref(), &id.to_le_bytes()],
                config(),
            )?;
        }
        Ok(())
    }

    /// Author mode, sealed without a readable transaction: delegates the hunt, its board and
    /// its treasure, and attaches to the treasure's delegation a post-delegation action that
    /// the validator runs inside the rollup. The client encrypts the action's arguments, the
    /// location and the salt, to the validator's key, so they never appear in clear on Solana
    /// or in the rollup. The action has to be `seal_from_action` signed by the creator.
    pub fn delegate_hunt_sealed(
        ctx: Context<DelegateHunt>,
        id: u64,
        actions: Vec<u8>,
    ) -> Result<()> {
        let hunt = read_hunt(&ctx.accounts.hunt)?;
        require!(hunt.mode == HuntMode::Author, HuntError::WrongMode);
        require!(hunt.status == HuntStatus::Created, HuntError::WrongStatus);
        let actions = PostDelegationActions::try_from_slice(&actions)
            .map_err(|_| error!(HuntError::InvalidParams))?;
        let creator = ctx.accounts.creator.key();
        require!(
            actions.inserted_signers == 0
                && actions.inserted_non_signers == 0
                && actions.signers.len() == 1
                && actions.signers[0] == creator.to_bytes(),
            HuntError::InvalidParams
        );

        let config = || DelegateConfig {
            validator: Some(hunt.validator),
            ..Default::default()
        };
        let hunt_key = ctx.accounts.hunt.key();
        ctx.accounts.delegate_board(
            &ctx.accounts.creator,
            &[BOARD_SEED, hunt_key.as_ref()],
            config(),
        )?;
        ctx.accounts.delegate_hunt(
            &ctx.accounts.creator,
            &[HUNT_SEED, creator.as_ref(), &id.to_le_bytes()],
            config(),
        )?;

        let payer = ctx.accounts.creator.to_account_info();
        let treasure = ctx.accounts.treasure.to_account_info();
        delegate_account_with_actions(
            DelegateAccounts {
                payer: &payer,
                pda: &treasure,
                owner_program: &ctx.accounts.owner_program,
                buffer: &ctx.accounts.buffer_treasure,
                delegation_record: &ctx.accounts.delegation_record_treasure,
                delegation_metadata: &ctx.accounts.delegation_metadata_treasure,
                delegation_program: &ctx.accounts.delegation_program,
                system_program: &ctx.accounts.system_program,
            },
            &[TREASURE_SEED, hunt_key.as_ref()],
            config(),
            actions,
            &[&payer],
        )?;
        Ok(())
    }

    /// Enters a hunt on Solana: pays the entry fee into the vault, creates the player's
    /// logbook and delegates it to the hunt's validator. `operator` is a session key that
    /// may fly the airship on the owner's behalf; prizes always go to the owner.
    pub fn join(ctx: Context<Join>, operator: Pubkey) -> Result<()> {
        let hunt = read_hunt(&ctx.accounts.hunt)?;
        let now = Clock::get()?.unix_timestamp;
        // The copy on Solana turns Live when `arm` commits; it stays Live until the
        // finalized hunt comes back.
        require!(hunt.status == HuntStatus::Live, HuntError::NotLive);
        require!(!hunt.finalized && now < hunt.deadline, HuntError::HuntClosed);

        let vault = &mut ctx.accounts.vault;
        require!(vault.entrants < hunt.max_players, HuntError::HuntFull);
        vault.entrants += 1;
        vault.entry_total = vault
            .entry_total
            .checked_add(hunt.entry_fee)
            .ok_or(HuntError::Overflow)?;

        let player = ctx.accounts.player.to_account_info();
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: player.clone(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            hunt.entry_fee,
        )?;

        let hunt_key = ctx.accounts.hunt.key();
        let player_key = player.key();
        let space = 8 + Logbook::INIT_SPACE;
        let lamports = Rent::get()?.minimum_balance(space) + permission_rent(2);
        let logbook_info = ctx.accounts.logbook.to_account_info();
        create_owned_account(
            &player,
            &logbook_info,
            &ctx.accounts.system_program.to_account_info(),
            space,
            lamports,
            &[
                LOGBOOK_SEED,
                hunt_key.as_ref(),
                player_key.as_ref(),
                &[ctx.bumps.logbook],
            ],
        )?;
        let logbook = Logbook {
            hunt: hunt_key,
            owner: player_key,
            operator,
            ship_index: 0,
            embarked: false,
            bump: ctx.bumps.logbook,
            entries: Vec::new(),
        };
        {
            let mut data = logbook_info.try_borrow_mut_data()?;
            logbook.try_serialize(&mut &mut data[..])?;
        }

        ctx.accounts.delegate_logbook(
            &ctx.accounts.player,
            &[LOGBOOK_SEED, hunt_key.as_ref(), player_key.as_ref()],
            DelegateConfig {
                validator: Some(hunt.validator),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Pays out the vault once the hunt is back on Solana in a final state. Scheduled by the
    /// rollup together with the last commit, and callable by anyone as a fallback.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let hunt = &ctx.accounts.hunt;
        require!(
            hunt.finalized && hunt.status.is_terminal(),
            HuntError::NotFinalized
        );
        let vault = &mut ctx.accounts.vault;
        require!(!vault.settled, HuntError::AlreadySettled);
        vault.settled = true;

        // A void hunt hands the creator back the prize seed only; every entrant takes their
        // own fee back with `refund_entry`.
        let (pot, creator_cut) = if hunt.status == HuntStatus::Void {
            (vault.prize_seed, 0)
        } else {
            let pot = vault
                .prize_seed
                .checked_add(vault.entry_total)
                .ok_or(HuntError::Overflow)?;
            let cut = (vault.entry_total as u128 * hunt.creator_bps as u128 / 10_000) as u64;
            (pot, cut)
        };
        let prize = pot - creator_cut;

        let vault_info = vault.to_account_info();
        let reserve = Rent::get()?.minimum_balance(vault_info.data_len());
        require!(
            vault_info.lamports() >= reserve.saturating_add(pot),
            HuntError::Overflow
        );
        **vault_info.try_borrow_mut_lamports()? -= pot;
        **ctx.accounts.payee.try_borrow_mut_lamports()? += prize;
        **ctx.accounts.creator.try_borrow_mut_lamports()? += creator_cut;
        msg!("settled: prize {} creator {}", prize, creator_cut);
        Ok(())
    }

    /// Returns an entrant's fee from the vault of a void hunt and closes their released
    /// logbook, whose rent goes back to them as well. Anyone may send it.
    pub fn refund_entry(ctx: Context<RefundEntry>) -> Result<()> {
        let hunt = &ctx.accounts.hunt;
        require!(
            hunt.finalized && hunt.status == HuntStatus::Void,
            HuntError::NotVoid
        );
        let fee = hunt.entry_fee;
        let vault = &mut ctx.accounts.vault;
        vault.entry_total = vault.entry_total.checked_sub(fee).ok_or(HuntError::Overflow)?;
        vault.entrants = vault.entrants.checked_sub(1).ok_or(HuntError::Overflow)?;
        let vault_info = vault.to_account_info();
        let reserve = Rent::get()?.minimum_balance(vault_info.data_len());
        require!(
            vault_info.lamports() >= reserve.saturating_add(fee),
            HuntError::Overflow
        );
        **vault_info.try_borrow_mut_lamports()? -= fee;
        **ctx.accounts.owner.try_borrow_mut_lamports()? += fee;
        Ok(())
    }

    /// Withdraws a hunt that was never delegated: closes the hunt, its board, treasure and
    /// vault, prize seed included, back to the creator.
    pub fn cancel_hunt(_ctx: Context<CancelHunt>) -> Result<()> {
        Ok(())
    }

    /// Closes the escrow that pays for the settlement action once it is no longer needed,
    /// and hands the creator everything the hunt account holds beyond its own rent.
    pub fn reclaim_escrow(ctx: Context<ReclaimEscrow>) -> Result<()> {
        let hunt = &ctx.accounts.hunt;
        require!(
            hunt.status == HuntStatus::Created || ctx.accounts.vault.settled,
            HuntError::WrongStatus
        );
        let creator = hunt.creator;
        let id = hunt.id.to_le_bytes();
        let bump = [hunt.bump];
        let hunt_info = ctx.accounts.hunt.to_account_info();
        if ctx.accounts.action_escrow.lamports() > 0 {
            let mut data = CLOSE_EPHEMERAL_BALANCE.to_le_bytes().to_vec();
            data.push(ACTION_ESCROW_INDEX);
            invoke_signed(
                &Instruction {
                    program_id: DELEGATION_PROGRAM_ID,
                    accounts: vec![
                        AccountMeta::new(hunt_info.key(), true),
                        AccountMeta::new(ctx.accounts.action_escrow.key(), false),
                        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                    ],
                    data,
                },
                &[
                    hunt_info.clone(),
                    ctx.accounts.action_escrow.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[&[HUNT_SEED, creator.as_ref(), &id, &bump]],
            )?;
        }
        sweep_surplus(&hunt_info, &ctx.accounts.creator.to_account_info())
    }

    /// Opens the hunt inside the rollup: makes the treasure unreadable for everyone and, in
    /// VRF mode, asks the oracle for the randomness that will place it.
    pub fn open_hunt(ctx: Context<OpenHunt>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let hunt_key = ctx.accounts.hunt.key();
        let treasure_key = ctx.accounts.treasure.key();
        require!(!ctx.accounts.treasure.sealed, HuntError::AlreadySealed);
        match ctx.accounts.hunt.status {
            HuntStatus::Created => {}
            HuntStatus::Sealing => require!(
                ctx.accounts.hunt.mode == HuntMode::Vrf
                    && now >= ctx.accounts.treasure.vrf_requested_at + VRF_RETRY_SECS,
                HuntError::SealPending
            ),
            _ => return err!(HuntError::WrongStatus),
        }

        seal_permission(
            ctx.accounts.treasure.to_account_info(),
            &PermissionAccounts {
                permission: ctx.accounts.treasure_permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
            },
            vec![],
            &[
                TREASURE_SEED,
                hunt_key.as_ref(),
                &[ctx.accounts.hunt.treasure_bump],
            ],
        )?;

        if ctx.accounts.hunt.mode == HuntMode::Vrf {
            let slot = Clock::get()?.slot;
            let caller_seed = hashv(&[hunt_key.as_ref(), &slot.to_le_bytes()]).to_bytes();
            let request = create_request_randomness_ix(RequestRandomnessParams {
                payer: ctx.accounts.creator.key(),
                oracle_queue: ctx.accounts.oracle_queue.key(),
                callback_program_id: crate::ID,
                callback_discriminator: instruction::SealFromVrf::DISCRIMINATOR.to_vec(),
                caller_seed,
                accounts_metas: Some(vec![SerializableAccountMeta {
                    pubkey: treasure_key,
                    is_signer: false,
                    is_writable: true,
                }]),
                ..Default::default()
            });
            ctx.accounts
                .invoke_signed_vrf(&ctx.accounts.creator.to_account_info(), &request)?;
            ctx.accounts.treasure.vrf_requested_at = now;
        }
        ctx.accounts.hunt.status = HuntStatus::Sealing;
        Ok(())
    }

    /// VRF callback. Stores the oracle's output in the treasure and nothing else; the
    /// location is derived from it when the hunt is armed.
    pub fn seal_from_vrf(ctx: Context<SealFromVrf>, randomness: [u8; 32]) -> Result<()> {
        let treasure = &mut ctx.accounts.treasure;
        require!(treasure.vrf_requested_at != 0, HuntError::VrfNotRequested);
        require!(!treasure.sealed, HuntError::AlreadySealed);
        treasure.entropy = randomness;
        treasure.sealed = true;
        Ok(())
    }

    /// Author mode: the creator places the treasure. The transaction goes straight to the
    /// rollup and is only accepted once `open_hunt` has made the treasure private.
    pub fn seal_from_author(
        ctx: Context<SealFromAuthor>,
        location: Vec3,
        salt: [u8; 32],
    ) -> Result<()> {
        let hunt = &ctx.accounts.hunt;
        require!(hunt.mode == HuntMode::Author, HuntError::WrongMode);
        require!(hunt.status == HuntStatus::Sealing, HuntError::WrongStatus);
        require!(geo::is_unit(&location), HuntError::NotUnitVector);
        let treasure = &mut ctx.accounts.treasure;
        require!(!treasure.sealed, HuntError::AlreadySealed);
        treasure.location = geo::canonical(&location);
        treasure.salt = salt;
        treasure.zone_seed = geo::author_zone_seed(&salt);
        treasure.sealed = true;
        Ok(())
    }

    /// Author mode, run by the validator as the post-delegation action attached by
    /// `delegate_hunt_sealed`: makes the treasure private and places it in one step.
    ///
    /// `hunt` travels inside the encrypted arguments, so a copied ciphertext cannot seal a
    /// different hunt with this hunt's location.
    pub fn seal_from_action(
        ctx: Context<SealFromAction>,
        hunt: Pubkey,
        location: Vec3,
        salt: [u8; 32],
    ) -> Result<()> {
        let hunt_key = ctx.accounts.hunt.key();
        require_keys_eq!(hunt, hunt_key, HuntError::ForeignSeal);
        require!(
            ctx.accounts.hunt.mode == HuntMode::Author,
            HuntError::WrongMode
        );
        require!(
            ctx.accounts.hunt.status == HuntStatus::Created,
            HuntError::WrongStatus
        );
        require!(!ctx.accounts.treasure.sealed, HuntError::AlreadySealed);
        require!(geo::is_unit(&location), HuntError::NotUnitVector);

        seal_permission(
            ctx.accounts.treasure.to_account_info(),
            &PermissionAccounts {
                permission: ctx.accounts.treasure_permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
            },
            vec![],
            &[
                TREASURE_SEED,
                hunt_key.as_ref(),
                &[ctx.accounts.hunt.treasure_bump],
            ],
        )?;
        let treasure = &mut ctx.accounts.treasure;
        treasure.location = geo::canonical(&location);
        treasure.salt = salt;
        treasure.zone_seed = geo::author_zone_seed(&salt);
        treasure.sealed = true;
        ctx.accounts.hunt.status = HuntStatus::Sealing;
        Ok(())
    }

    /// Starts the hunt once the treasure is sealed: publishes the commitment to the location
    /// and commits the hunt to Solana so the commitment is anchored before anyone plays.
    pub fn arm(ctx: Context<Arm>) -> Result<()> {
        let hunt_key = ctx.accounts.hunt.key();
        require!(
            ctx.accounts.hunt.status == HuntStatus::Sealing,
            HuntError::WrongStatus
        );
        let treasure = &mut ctx.accounts.treasure;
        require!(treasure.sealed, HuntError::NotSealed);
        if ctx.accounts.hunt.mode == HuntMode::Vrf {
            let (location, salt, zone_seed) = geo::derive_secrets(&treasure.entropy);
            treasure.location = location;
            treasure.salt = salt;
            treasure.zone_seed = zone_seed;
        }

        let hunt = &mut ctx.accounts.hunt;
        hunt.commitment = geo::commitment(&hunt_key, &treasure.location, &treasure.salt);
        hunt.status = HuntStatus::Live;
        hunt.exit(&crate::ID)?;

        let creator = hunt.creator;
        let id = hunt.id.to_le_bytes();
        let bump = [hunt.bump];
        let seeds: &[&[u8]] = &[HUNT_SEED, creator.as_ref(), &id, &bump];
        let hunt_info = as_signer(hunt.to_account_info());
        MagicIntentBundleBuilder::new(
            hunt_info.clone(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
        .commit(&[hunt_info])
        .build_and_invoke_signed(&[seeds])?;
        Ok(())
    }

    /// Registers a recurring `tick` with the Hydra scheduler of the rollup.
    pub fn schedule_tick(ctx: Context<ScheduleTick>, interval_slots: u32) -> Result<()> {
        let hunt = &ctx.accounts.hunt;
        require!(hunt.status == HuntStatus::Live, HuntError::NotLive);
        let clock = Clock::get()?;
        let interval_slots = (interval_slots as u64).max(SLOTS_PER_SEC);
        let lifetime_secs = (hunt.deadline - clock.unix_timestamp).max(0) as u64 + 120;
        let hunt_key = hunt.key();
        let tick = tick_instruction(hunt_key, hunt);
        let metas: Vec<SchedMeta> = tick
            .accounts
            .iter()
            .map(|meta| SchedMeta {
                pubkey: meta.pubkey.to_bytes(),
                is_writable: meta.is_writable,
            })
            .collect();
        let args = CreateArgs {
            seed: hunt_key.to_bytes(),
            authority: [0u8; 32],
            start_slot: clock.slot + interval_slots,
            interval_slots,
            remaining: lifetime_secs * SLOTS_PER_SEC / interval_slots + 1,
            priority_tip: 0,
            cu_limit: TICK_COMPUTE_UNITS,
            scheduled: &[ScheduledIx {
                program_id: crate::ID.to_bytes(),
                metas: &metas,
                data: &tick.data,
            }],
        };
        let creator = hunt.creator;
        let id = hunt.id.to_le_bytes();
        let bump = [hunt.bump];
        hydra_api::cpi::ephemeral::native::create(
            &as_signer(hunt.to_account_info()),
            &ctx.accounts.crank.to_account_info(),
            &ctx.accounts.ephemeral_vault.to_account_info(),
            &ctx.accounts.magic_program.to_account_info(),
            &args,
            &[&[HUNT_SEED, creator.as_ref(), &id, &bump]],
        )?;
        Ok(())
    }

    /// Registers a recurring `tick` with the validator's built-in task scheduler.
    #[allow(deprecated)]
    pub fn schedule_tick_legacy<'info>(
        ctx: Context<'info, ScheduleTickLegacy<'info>>,
        task_id: i64,
        interval_millis: i64,
    ) -> Result<()> {
        let hunt = &ctx.accounts.hunt;
        require!(hunt.status == HuntStatus::Live, HuntError::NotLive);
        let now = Clock::get()?.unix_timestamp;
        let interval_millis = interval_millis.max(1_000);
        let lifetime_millis = ((hunt.deadline - now).max(0) + 120) * 1_000;
        let tick = tick_instruction(hunt.key(), hunt);
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &&ctx.accounts.magic_program,
            instruction_accounts: &[
                ctx.accounts.hunt.to_account_info(),
                ctx.accounts.treasure.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.magic_fee_vault.to_account_info(),
                ctx.accounts.program.to_account_info(),
                ctx.accounts.magic_context.to_account_info(),
            ],
            args: ScheduleTaskArgs {
                task_id,
                execution_interval_millis: interval_millis,
                iterations: lifetime_millis / interval_millis + 1,
                instructions: vec![tick],
            },
        }
        .invoke()?;
        Ok(())
    }

    /// Makes the player's logbook private to its owner and operator and puts the airship
    /// on the board at `start`. The sounding gear starts cold, so the first sounding has to
    /// wait for the cooldown like any other.
    pub fn embark(ctx: Context<Embark>, start: Vec3) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let hunt_key = ctx.accounts.hunt.key();
        require!(
            ctx.accounts.hunt.status == HuntStatus::Live,
            HuntError::NotLive
        );
        require!(now < ctx.accounts.hunt.deadline, HuntError::DeadlinePassed);
        require!(!ctx.accounts.logbook.embarked, HuntError::AlreadyEmbarked);
        require!(geo::is_unit(&start), HuntError::NotUnitVector);
        let start = geo::canonical(&start);

        let owner = ctx.accounts.logbook.owner;
        let operator = ctx.accounts.logbook.operator;
        let mut members = vec![reader(owner)];
        if operator != owner {
            members.push(reader(operator));
        }
        seal_permission(
            ctx.accounts.logbook.to_account_info(),
            &PermissionAccounts {
                permission: ctx.accounts.logbook_permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
            },
            members,
            &[
                LOGBOOK_SEED,
                hunt_key.as_ref(),
                owner.as_ref(),
                &[ctx.accounts.logbook.bump],
            ],
        )?;

        let mut board = ctx.accounts.board.load_mut()?;
        let index = board.ship_count;
        require!((index as usize) < MAX_PLAYERS, HuntError::HuntFull);
        board.ships[index as usize] = Ship {
            owner,
            depart_ts: now,
            arrive_ts: now,
            last_probe_ts: now,
            from: start,
            to: start,
            probes: 0,
            embarked: 1,
            _padding: [0; 6],
        };
        board.ship_count = index + 1;

        let logbook = &mut ctx.accounts.logbook;
        logbook.ship_index = index;
        logbook.embarked = true;
        ctx.accounts.hunt.players = index + 1;
        Ok(())
    }

    /// Sends the airship towards `destination`. Only possible while it is not in flight.
    pub fn set_course(ctx: Context<SetCourse>, destination: Vec3) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let hunt = &ctx.accounts.hunt;
        require!(hunt.status == HuntStatus::Live, HuntError::NotLive);
        require!(now >= hunt.starts_at, HuntError::NotStarted);
        require!(now < hunt.deadline, HuntError::DeadlinePassed);
        require!(geo::is_unit(&destination), HuntError::NotUnitVector);
        let destination = geo::canonical(&destination);

        let logbook = &ctx.accounts.logbook;
        let mut board = ctx.accounts.board.load_mut()?;
        let ship = &mut board.ships[logbook.ship_index as usize];
        require!(
            ship.embarked == 1 && ship.owner == logbook.owner,
            HuntError::NotEmbarked
        );
        require!(now >= ship.arrive_ts, HuntError::InFlight);
        ship.from = ship.to;
        ship.to = destination;
        ship.depart_ts = now;
        ship.arrive_ts = now + geo::travel_secs(&ship.from, &destination, hunt.speed_kms);
        Ok(())
    }

    /// Takes a sounding where the airship is. The distance band goes into the private
    /// logbook and a pin, without the band, goes on the public board.
    //
    // Invariant, for every instruction: which errors can occur and what is written to
    // publicly readable accounts never depends on the secrets kept in Treasure and Logbook
    // (location, salt, zone seed, bands, closest sounding, pending strike). A private
    // result reaches public state only through `tick` in a later slot, or through the
    // disclosures the game is built on: the commitment, the zone cap and the final reveal.
    // The rollup returns the error of a simulated transaction to anyone, so a sounding
    // must not be able to fail, succeed or run longer because of what it measured.
    pub fn probe(ctx: Context<Probe>) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let hunt = &mut ctx.accounts.hunt;
        require!(hunt.status == HuntStatus::Live, HuntError::NotLive);
        require!(now >= hunt.starts_at, HuntError::NotStarted);
        require!(now < hunt.deadline, HuntError::DeadlinePassed);

        let logbook = &mut ctx.accounts.logbook;
        let mut board = ctx.accounts.board.load_mut()?;
        let index = logbook.ship_index;
        let pos = {
            let ship = &mut board.ships[index as usize];
            require!(
                ship.embarked == 1 && ship.owner == logbook.owner,
                HuntError::NotEmbarked
            );
            require!((ship.probes as usize) < MAX_PROBES, HuntError::ProbeLimit);
            require!(now >= ship.arrive_ts, HuntError::InFlight);
            require!(
                now >= ship.last_probe_ts + PROBE_COOLDOWN_SECS,
                HuntError::Cooldown
            );
            ship.probes += 1;
            ship.last_probe_ts = now;
            ship.to
        };
        board.push_pin(index, pos, now);
        hunt.probes_total += 1;

        // From here on the secret is involved: no branches, no errors, no public writes.
        let treasure = &mut ctx.accounts.treasure;
        let owner = logbook.owner;
        let closeness = geo::dot(&pos, &treasure.location);
        let band = geo::band_for_dot(closeness);
        logbook.entries.push(LogEntry { pos, band, ts: now });

        let closer = geo::lt(treasure.best_dot, closeness);
        treasure.best_dot = blind::pick_i64(closer, closeness, treasure.best_dot);
        treasure.best_player = blind::pick_key(closer, &owner, &treasure.best_player);
        treasure.best_ts = blind::pick_i64(closer, now, treasure.best_ts);

        let first_strike = blind::is_zero(band as u64) & blind::is_zero(treasure.strike_slot);
        treasure.strike_player = blind::pick_key(first_strike, &owner, &treasure.strike_player);
        treasure.strike_slot = blind::pick_u64(first_strike, clock.slot, treasure.strike_slot);
        treasure.strike_ts = blind::pick_i64(first_strike, now, treasure.strike_ts);
        Ok(())
    }

    /// Advances the hunt from the clock, one step per call: promotes a strike made in an
    /// earlier slot, closes the hunt at the deadline, shrinks the public zone, or finalizes
    /// a hunt that has ended. Does nothing when there is nothing to do. Takes no signers so
    /// a scheduler can drive it.
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let hunt = &mut ctx.accounts.hunt;
        let treasure = &mut ctx.accounts.treasure;

        if hunt.status == HuntStatus::Live {
            // Within the slot of a strike this is 0 whether or not there was one, and it is
            // computed without branching on the pending strike.
            let pending = blind::is_zero(treasure.strike_slot) ^ 1;
            let due = geo::lt(treasure.strike_slot as i64, clock.slot as i64);
            if blind::opaque(pending & due) == 1 {
                hunt.status = HuntStatus::Struck;
                hunt.winner = treasure.strike_player;
                hunt.ended_at = treasure.strike_ts;
            } else if now >= hunt.deadline {
                if treasure.best_player == Pubkey::default() {
                    hunt.status = HuntStatus::Void;
                } else {
                    hunt.status = HuntStatus::Closest;
                    hunt.winner = treasure.best_player;
                }
                hunt.ended_at = now;
            } else {
                let stage = geo::zone_stage_at(now, hunt.starts_at, hunt.zone_interval_secs);
                if stage > hunt.zone_stage {
                    hunt.zone_stage = stage;
                    hunt.zone_center =
                        geo::zone_center(&treasure.location, &treasure.zone_seed, stage);
                }
            }
            return Ok(());
        }

        // A hunt that never went live ends void at its deadline, so the prize seed can go
        // back to the creator.
        if matches!(hunt.status, HuntStatus::Created | HuntStatus::Sealing) {
            if now >= hunt.deadline {
                hunt.status = HuntStatus::Void;
                hunt.ended_at = now;
            }
            return Ok(());
        }

        if hunt.status.is_terminal() && !hunt.finalized {
            reveal_and_release(
                hunt,
                treasure,
                ctx.accounts.vault.key(),
                ctx.accounts.magic_fee_vault.to_account_info(),
                ctx.accounts.magic_context.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            )?;
        }
        Ok(())
    }

    /// Ends a decided hunt: reveals the location and salt, commits the hunt to Solana,
    /// releases it from the rollup and schedules the payout in the same intent. Whether it
    /// may run depends on the public hunt state alone.
    pub fn finalize(ctx: Context<Tick>) -> Result<()> {
        let hunt = &mut ctx.accounts.hunt;
        require!(hunt.status.is_terminal(), HuntError::NotEnded);
        require!(!hunt.finalized, HuntError::AlreadyFinalized);
        reveal_and_release(
            hunt,
            &mut ctx.accounts.treasure,
            ctx.accounts.vault.key(),
            ctx.accounts.magic_fee_vault.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
    }

    /// Makes the treasure account readable by everyone once the hunt is over.
    pub fn open_treasure(ctx: Context<OpenTreasure>) -> Result<()> {
        let treasure = &ctx.accounts.treasure;
        require!(treasure.revealed, HuntError::NotRevealed);
        publish_permission(
            treasure.to_account_info(),
            &PermissionAccounts {
                permission: ctx.accounts.treasure_permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
            },
            &[TREASURE_SEED, treasure.hunt.as_ref(), &[treasure.bump]],
        )
    }

    /// Makes a logbook readable by everyone once the hunt is over, so every hint in it can
    /// be checked against the revealed location.
    pub fn open_logbook(ctx: Context<OpenLogbook>) -> Result<()> {
        require!(ctx.accounts.treasure.revealed, HuntError::NotRevealed);
        let logbook = &ctx.accounts.logbook;
        publish_permission(
            logbook.to_account_info(),
            &PermissionAccounts {
                permission: ctx.accounts.logbook_permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
            },
            &[
                LOGBOOK_SEED,
                logbook.hunt.as_ref(),
                logbook.owner.as_ref(),
                &[logbook.bump],
            ],
        )
    }

    /// Returns a logbook to Solana after the hunt, where its rent can be reclaimed.
    pub fn release_logbook(ctx: Context<ReleaseLogbook>) -> Result<()> {
        require!(ctx.accounts.treasure.revealed, HuntError::NotRevealed);
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.logbook.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Returns the board and the treasure to Solana after the hunt.
    pub fn release_board(ctx: Context<ReleaseBoard>) -> Result<()> {
        require!(ctx.accounts.treasure.revealed, HuntError::NotRevealed);
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[
            ctx.accounts.board.to_account_info(),
            ctx.accounts.treasure.to_account_info(),
        ])
        .build_and_invoke()?;
        Ok(())
    }

    /// Closes a released logbook and returns its rent to the player.
    pub fn close_logbook(_ctx: Context<CloseLogbook>) -> Result<()> {
        Ok(())
    }

    /// Closes the released board of a finalized hunt and returns its rent, together with
    /// whatever the hunt account holds beyond its own rent, to the creator.
    pub fn close_board(ctx: Context<CloseBoard>) -> Result<()> {
        sweep_surplus(
            &ctx.accounts.hunt.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
        )
    }

    /// Closes the released treasure of a finalized hunt. The hunt account keeps the revealed
    /// location and salt; the zone seed and the closest sounding go with the treasure.
    pub fn close_treasure(_ctx: Context<CloseTreasure>) -> Result<()> {
        Ok(())
    }
}

/// Moves everything `hunt` holds beyond its rent to `creator`.
fn sweep_surplus<'info>(hunt: &AccountInfo<'info>, creator: &AccountInfo<'info>) -> Result<()> {
    let keep = Rent::get()?.minimum_balance(hunt.data_len());
    let surplus = hunt.lamports().saturating_sub(keep);
    **hunt.try_borrow_mut_lamports()? -= surplus;
    **creator.try_borrow_mut_lamports()? += surplus;
    Ok(())
}

/// Creates a program-owned PDA, also when someone has already sent lamports to its address
/// (which makes the system program's `create_account` fail).
fn create_owned_account<'info>(
    payer: &AccountInfo<'info>,
    target: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    space: usize,
    lamports: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    let present = target.lamports();
    if present == 0 {
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                target.key,
                lamports,
                space as u64,
                &crate::ID,
            ),
            &[payer.clone(), target.clone(), system_program.clone()],
            &[seeds],
        )?;
        return Ok(());
    }
    if lamports > present {
        invoke_signed(
            &system_instruction::transfer(payer.key, target.key, lamports - present),
            &[payer.clone(), target.clone(), system_program.clone()],
            &[],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(target.key, space as u64),
        &[target.clone(), system_program.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(target.key, &crate::ID),
        &[target.clone(), system_program.clone()],
        &[seeds],
    )?;
    Ok(())
}

/// Rollup rent of a permission account with room for `members` members.
fn permission_rent(members: usize) -> u64 {
    ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(members) as u32)
}

fn reader(pubkey: Pubkey) -> Member {
    Member {
        flags: TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG | ACCOUNT_SIGNATURES_FLAG,
        pubkey,
    }
}

/// PDA accounts sign CPIs through seeds, but the intent builders copy the signer flag
/// from the account info they are given.
fn as_signer(info: AccountInfo<'_>) -> AccountInfo<'_> {
    AccountInfo {
        is_signer: true,
        ..info
    }
}

/// Reads a hunt regardless of whether it currently sits on Solana or is delegated.
fn read_hunt(info: &UncheckedAccount) -> Result<Hunt> {
    require!(
        info.owner == &crate::ID || info.owner == &DELEGATION_PROGRAM_ID,
        HuntError::InvalidHunt
    );
    let hunt = Hunt::try_deserialize(&mut &info.try_borrow_data()?[..])
        .map_err(|_| error!(HuntError::InvalidHunt))?;
    let expected = Pubkey::create_program_address(
        &[
            HUNT_SEED,
            hunt.creator.as_ref(),
            &hunt.id.to_le_bytes(),
            &[hunt.bump],
        ],
        &crate::ID,
    )
    .map_err(|_| error!(HuntError::InvalidHunt))?;
    require_keys_eq!(expected, info.key(), HuntError::InvalidHunt);
    Ok(hunt)
}

struct PermissionAccounts<'info> {
    permission: AccountInfo<'info>,
    vault: AccountInfo<'info>,
    magic_program: AccountInfo<'info>,
    permission_program: AccountInfo<'info>,
}

/// Creates a private permission for `account`, readable by `members` only. The account
/// pays the rollup rent itself and signs with its seeds. Does nothing if it already exists.
fn seal_permission<'info>(
    account: AccountInfo<'info>,
    accounts: &PermissionAccounts<'info>,
    members: Vec<Member>,
    seeds: &[&[u8]],
) -> Result<()> {
    if accounts.permission.owner == &PERMISSION_PROGRAM_ID && !accounts.permission.data_is_empty()
    {
        return Ok(());
    }
    CreateEphemeralPermissionCpi {
        payer: account.clone(),
        permissioned_account: account,
        permission: accounts.permission.clone(),
        vault: accounts.vault.clone(),
        magic_program: accounts.magic_program.clone(),
        permission_program: accounts.permission_program.clone(),
        args: EphemeralMembersArgs {
            is_private: true,
            members,
        },
    }
    .invoke_signed(&[seeds])?;
    Ok(())
}

/// Lifts the read restriction of `account`.
fn publish_permission<'info>(
    account: AccountInfo<'info>,
    accounts: &PermissionAccounts<'info>,
    seeds: &[&[u8]],
) -> Result<()> {
    UpdateEphemeralPermissionCpi {
        payer: account.clone(),
        authority: account.clone(),
        permissioned_account: account,
        permission: accounts.permission.clone(),
        vault: accounts.vault.clone(),
        magic_program: accounts.magic_program.clone(),
        permission_program: accounts.permission_program.clone(),
        authority_is_signer: false,
        args: EphemeralMembersArgs {
            is_private: false,
            members: vec![],
        },
    }
    .invoke_signed(&[seeds])?;
    Ok(())
}

fn fee_vault_address(validator: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[MAGIC_FEE_VAULT_SEED, validator.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0
}

/// The `tick` instruction exactly as a scheduler has to submit it.
fn tick_instruction(hunt_key: Pubkey, hunt: &Hunt) -> Instruction {
    let treasure = Pubkey::create_program_address(
        &[TREASURE_SEED, hunt_key.as_ref(), &[hunt.treasure_bump]],
        &crate::ID,
    );
    let vault = Pubkey::create_program_address(
        &[VAULT_SEED, hunt_key.as_ref(), &[hunt.vault_bump]],
        &crate::ID,
    );
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(hunt_key, false),
            AccountMeta::new(treasure.unwrap_or_default(), false),
            AccountMeta::new_readonly(vault.unwrap_or_default(), false),
            AccountMeta::new(fee_vault_address(&hunt.validator), false),
            AccountMeta::new_readonly(crate::ID, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
        ],
        data: instruction::Tick {}.data(),
    }
}

/// Copies the secret into the hunt, then commits the hunt to Solana, releases it from the
/// rollup and attaches the payout as an action of the same intent. The hunt account pays
/// the fees and authorises the action escrow, signing with its seeds.
fn reveal_and_release<'info>(
    hunt: &mut Account<'info, Hunt>,
    treasure: &mut Account<'info, Treasure>,
    vault: Pubkey,
    fee_vault: AccountInfo<'info>,
    magic_context: AccountInfo<'info>,
    magic_program: AccountInfo<'info>,
) -> Result<()> {
    hunt.revealed_location = treasure.location;
    hunt.revealed_salt = treasure.salt;
    hunt.finalized = true;
    treasure.revealed = true;
    hunt.exit(&crate::ID)?;

    let meta = |pubkey: Pubkey, is_writable: bool| ShortAccountMeta {
        pubkey: pubkey.to_bytes().into(),
        is_writable,
    };
    let hunt_info = as_signer(hunt.to_account_info());
    let payout = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            meta(hunt.key(), false),
            meta(vault, true),
            meta(hunt.payee(), true),
            meta(hunt.creator, true),
        ],
        args: ActionArgs::new(instruction::Settle {}.data()),
        escrow_authority: hunt_info.clone(),
        compute_units: SETTLE_COMPUTE_UNITS,
    };

    let creator = hunt.creator;
    let id = hunt.id.to_le_bytes();
    let bump = [hunt.bump];
    let seeds: &[&[u8]] = &[HUNT_SEED, creator.as_ref(), &id, &bump];
    MagicIntentBundleBuilder::new(hunt_info.clone(), magic_context, magic_program)
        .magic_fee_vault(fee_vault)
        .commit_and_undelegate(&[hunt_info])
        .add_post_undelegate_actions([payout])
        .build_and_invoke_signed(&[seeds])?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateHunt<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Hunt::INIT_SPACE,
        seeds = [HUNT_SEED, creator.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub hunt: Box<Account<'info, Hunt>>,
    #[account(
        init,
        payer = creator,
        space = Board::SPACE,
        seeds = [BOARD_SEED, hunt.key().as_ref()],
        bump
    )]
    pub board: AccountLoader<'info, Board>,
    #[account(
        init,
        payer = creator,
        space = 8 + Treasure::INIT_SPACE,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump
    )]
    pub treasure: Box<Account<'info, Treasure>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, hunt.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,
    /// CHECK: escrow of the hunt at the delegation program, created by the top-up.
    #[account(
        mut,
        seeds = [ACTION_ESCROW_SEED, hunt.key().as_ref(), &[ACTION_ESCROW_INDEX]],
        bump,
        seeds::program = DELEGATION_PROGRAM_ID
    )]
    pub action_escrow: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct DelegateHunt<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: checked by seeds and deserialized in the handler.
    #[account(mut, del, seeds = [HUNT_SEED, creator.key().as_ref(), &id.to_le_bytes()], bump)]
    pub hunt: UncheckedAccount<'info>,
    /// CHECK: checked by seeds.
    #[account(mut, del, seeds = [BOARD_SEED, hunt.key().as_ref()], bump)]
    pub board: UncheckedAccount<'info>,
    /// CHECK: checked by seeds.
    #[account(mut, del, seeds = [TREASURE_SEED, hunt.key().as_ref()], bump)]
    pub treasure: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct Join<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: owned by this program or, while delegated, by the delegation program;
    /// deserialized and address-checked in the handler.
    pub hunt: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_SEED, hunt.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: created and delegated in the handler.
    #[account(
        mut,
        del,
        seeds = [LOGBOOK_SEED, hunt.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub logbook: UncheckedAccount<'info>,
}

#[action]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(mut, seeds = [VAULT_SEED, hunt.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: the winner, or the creator of a void hunt.
    #[account(mut, address = hunt.payee())]
    pub payee: UncheckedAccount<'info>,
    /// CHECK: receives the creator's share.
    #[account(mut, address = hunt.creator)]
    pub creator: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct OpenHunt<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        has_one = creator
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
    /// CHECK: permission account of the treasure.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, treasure.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub treasure_permission: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: the oracle queue delegated to ephemeral rollups.
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct SealFromVrf<'info> {
    #[account(
        mut,
        seeds = [TREASURE_SEED, treasure.hunt.as_ref()],
        bump = treasure.bump
    )]
    pub treasure: Account<'info, Treasure>,
}

#[derive(Accounts)]
pub struct SealFromAuthor<'info> {
    pub creator: Signer<'info>,
    #[account(
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        has_one = creator
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
}

#[derive(Accounts)]
pub struct SealFromAction<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        has_one = creator
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
    /// CHECK: permission account of the treasure.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, treasure.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub treasure_permission: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct Arm<'info> {
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
    /// CHECK: fee vault of the hunt's validator.
    #[account(mut, address = fee_vault_address(&hunt.validator))]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ScheduleTick<'info> {
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    /// CHECK: crank account, derived and checked by the scheduler.
    #[account(mut)]
    pub crank: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = HYDRA_EPHEMERAL_ID)]
    pub hydra_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ScheduleTickLegacy<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    /// CHECK: checked by seeds.
    #[account(mut, seeds = [TREASURE_SEED, hunt.key().as_ref()], bump = hunt.treasure_bump)]
    pub treasure: UncheckedAccount<'info>,
    /// CHECK: checked by seeds.
    #[account(seeds = [VAULT_SEED, hunt.key().as_ref()], bump = hunt.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: fee vault of the hunt's validator.
    #[account(mut, address = fee_vault_address(&hunt.validator))]
    pub magic_fee_vault: UncheckedAccount<'info>,
    /// CHECK: this program.
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Embark<'info> {
    pub pilot: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(mut, seeds = [BOARD_SEED, hunt.key().as_ref()], bump = hunt.board_bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(
        mut,
        seeds = [LOGBOOK_SEED, hunt.key().as_ref(), logbook.owner.as_ref()],
        bump = logbook.bump,
        constraint = logbook.is_pilot(pilot.key) @ HuntError::NotPilot
    )]
    pub logbook: Account<'info, Logbook>,
    /// CHECK: permission account of the logbook.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, logbook.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub logbook_permission: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetCourse<'info> {
    pub pilot: Signer<'info>,
    #[account(
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(mut, seeds = [BOARD_SEED, hunt.key().as_ref()], bump = hunt.board_bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(
        seeds = [LOGBOOK_SEED, hunt.key().as_ref(), logbook.owner.as_ref()],
        bump = logbook.bump,
        constraint = logbook.is_pilot(pilot.key) @ HuntError::NotPilot
    )]
    pub logbook: Account<'info, Logbook>,
}

#[derive(Accounts)]
pub struct Probe<'info> {
    pub pilot: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(mut, seeds = [BOARD_SEED, hunt.key().as_ref()], bump = hunt.board_bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(
        mut,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
    #[account(
        mut,
        seeds = [LOGBOOK_SEED, hunt.key().as_ref(), logbook.owner.as_ref()],
        bump = logbook.bump,
        constraint = logbook.is_pilot(pilot.key) @ HuntError::NotPilot
    )]
    pub logbook: Account<'info, Logbook>,
}

/// Accounts of `tick` and `finalize`. The order is what schedulers store, see
/// `tick_instruction`.
#[commit]
#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
    /// CHECK: checked by seeds; only its address is used.
    #[account(seeds = [VAULT_SEED, hunt.key().as_ref()], bump = hunt.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: fee vault of the hunt's validator.
    #[account(mut, address = fee_vault_address(&hunt.validator))]
    pub magic_fee_vault: UncheckedAccount<'info>,
    /// CHECK: this program, target of the settlement action.
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
    pub magic_program: Program<'info, MagicProgram>,
    /// CHECK: fixed address.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OpenTreasure<'info> {
    #[account(
        mut,
        seeds = [TREASURE_SEED, treasure.hunt.as_ref()],
        bump = treasure.bump
    )]
    pub treasure: Account<'info, Treasure>,
    /// CHECK: permission account of the treasure.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, treasure.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub treasure_permission: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OpenLogbook<'info> {
    #[account(
        seeds = [TREASURE_SEED, logbook.hunt.as_ref()],
        bump = treasure.bump
    )]
    pub treasure: Account<'info, Treasure>,
    #[account(
        mut,
        seeds = [LOGBOOK_SEED, logbook.hunt.as_ref(), logbook.owner.as_ref()],
        bump = logbook.bump
    )]
    pub logbook: Account<'info, Logbook>,
    /// CHECK: permission account of the logbook.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, logbook.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub logbook_permission: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct ReleaseLogbook<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [TREASURE_SEED, logbook.hunt.as_ref()],
        bump = treasure.bump
    )]
    pub treasure: Account<'info, Treasure>,
    #[account(
        mut,
        seeds = [LOGBOOK_SEED, logbook.hunt.as_ref(), logbook.owner.as_ref()],
        bump = logbook.bump
    )]
    pub logbook: Account<'info, Logbook>,
}

#[commit]
#[derive(Accounts)]
pub struct ReleaseBoard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [TREASURE_SEED, treasure.hunt.as_ref()],
        bump = treasure.bump
    )]
    pub treasure: Account<'info, Treasure>,
    #[account(mut, seeds = [BOARD_SEED, treasure.hunt.as_ref()], bump)]
    pub board: AccountLoader<'info, Board>,
}

#[derive(Accounts)]
pub struct CloseLogbook<'info> {
    #[account(
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        constraint = hunt.finalized @ HuntError::NotFinalized,
        constraint = hunt.status != HuntStatus::Void @ HuntError::UseRefund
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        close = owner,
        seeds = [LOGBOOK_SEED, hunt.key().as_ref(), logbook.owner.as_ref()],
        bump = logbook.bump
    )]
    pub logbook: Account<'info, Logbook>,
    /// The player who paid for the logbook decides when its record goes.
    #[account(mut, address = logbook.owner)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefundEntry<'info> {
    #[account(
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(mut, seeds = [VAULT_SEED, hunt.key().as_ref()], bump = hunt.vault_bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        close = owner,
        seeds = [LOGBOOK_SEED, hunt.key().as_ref(), logbook.owner.as_ref()],
        bump = logbook.bump
    )]
    pub logbook: Account<'info, Logbook>,
    /// CHECK: the entrant, who receives the fee and the logbook's rent.
    #[account(mut, address = logbook.owner)]
    pub owner: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelHunt<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        close = creator,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        has_one = creator,
        constraint = hunt.status == HuntStatus::Created @ HuntError::WrongStatus
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(mut, close = creator, seeds = [BOARD_SEED, hunt.key().as_ref()], bump = hunt.board_bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(
        mut,
        close = creator,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
    #[account(
        mut,
        close = creator,
        seeds = [VAULT_SEED, hunt.key().as_ref()],
        bump = hunt.vault_bump,
        constraint = vault.entrants == 0 @ HuntError::WrongStatus
    )]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct ReclaimEscrow<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        has_one = creator
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(seeds = [VAULT_SEED, hunt.key().as_ref()], bump = hunt.vault_bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: escrow of the hunt at the delegation program.
    #[account(
        mut,
        seeds = [ACTION_ESCROW_SEED, hunt.key().as_ref(), &[ACTION_ESCROW_INDEX]],
        bump,
        seeds::program = DELEGATION_PROGRAM_ID
    )]
    pub action_escrow: UncheckedAccount<'info>,
    /// CHECK: fixed address.
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseBoard<'info> {
    #[account(
        mut,
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        constraint = hunt.finalized @ HuntError::NotFinalized
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        close = creator,
        seeds = [BOARD_SEED, hunt.key().as_ref()],
        bump = hunt.board_bump
    )]
    pub board: AccountLoader<'info, Board>,
    #[account(mut, address = hunt.creator)]
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseTreasure<'info> {
    #[account(
        seeds = [HUNT_SEED, hunt.creator.as_ref(), &hunt.id.to_le_bytes()],
        bump = hunt.bump,
        constraint = hunt.finalized @ HuntError::NotFinalized
    )]
    pub hunt: Account<'info, Hunt>,
    #[account(
        mut,
        close = creator,
        seeds = [TREASURE_SEED, hunt.key().as_ref()],
        bump = hunt.treasure_bump
    )]
    pub treasure: Account<'info, Treasure>,
    #[account(mut, address = hunt.creator)]
    pub creator: Signer<'info>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use ephemeral_rollups_sdk::dlp_api::compact::ClearText;

    /// The client builds post-delegation actions by hand. With nothing encrypted, its bytes
    /// for this instruction must equal the delegation program's own encoding.
    #[test]
    fn post_delegation_actions_layout() {
        let key = |b: u8| Pubkey::new_from_array([b; 32]);
        let ix = Instruction {
            program_id: key(1),
            accounts: vec![
                AccountMeta::new_readonly(key(2), true),
                AccountMeta::new(key(3), false),
                AccountMeta::new_readonly(key(4), false),
            ],
            data: vec![9; 8],
        };
        let reference = vec![ix].cleartext();
        let bytes = anchor_lang::prelude::borsh::to_vec(&reference).unwrap();
        let client = "00000100000002020202020202020202020202020202020202020202020202020202020202020300000000010101010101010101010101010101010101010101010101010101010101010100030303030303030303030303030303030303030303030303030303030303030300040404040404040404040404040404040404040404040404040404040404040401000000010300000000400082000308000000090909090909090900000000";
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, client);
        let parsed = PostDelegationActions::try_from_slice(&bytes).unwrap();
        assert_eq!(parsed.signers, vec![key(2).to_bytes()]);
    }
}
