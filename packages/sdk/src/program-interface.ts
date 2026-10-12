// Written by scripts/sync-idl.ts from the program's IDL. Change the program and rerun the script.

export const PROGRAM_INTERFACE = {
  "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v",
  "version": "0.1.0",
  "instructions": {
    "arm": {
      "discriminator": [230, 51, 249, 116, 166, 65, 21, 70],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "magic_fee_vault",
          "writable": true
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magic_context",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ]
    },
    "close_board": {
      "discriminator": [117, 4, 35, 166, 80, 233, 153, 42],
      "accounts": [
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true
        }
      ]
    },
    "close_logbook": {
      "discriminator": [69, 220, 67, 125, 16, 240, 189, 105],
      "accounts": [
        {
          "name": "hunt"
        },
        {
          "name": "logbook",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        }
      ]
    },
    "close_treasure": {
      "discriminator": [187, 30, 57, 240, 198, 200, 102, 105],
      "accounts": [
        {
          "name": "hunt"
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true
        }
      ]
    },
    "create_hunt": {
      "discriminator": [184, 154, 59, 39, 76, 114, 11, 186],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "action_escrow",
          "writable": true
        },
        {
          "name": "delegation_program",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ]
    },
    "delegate_hunt": {
      "discriminator": [15, 231, 0, 144, 0, 63, 217, 47],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "buffer_hunt",
          "writable": true
        },
        {
          "name": "delegation_record_hunt",
          "writable": true
        },
        {
          "name": "delegation_metadata_hunt",
          "writable": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "buffer_board",
          "writable": true
        },
        {
          "name": "delegation_record_board",
          "writable": true
        },
        {
          "name": "delegation_metadata_board",
          "writable": true
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "buffer_treasure",
          "writable": true
        },
        {
          "name": "delegation_record_treasure",
          "writable": true
        },
        {
          "name": "delegation_metadata_treasure",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "owner_program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "delegation_program",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ]
    },
    "delegate_hunt_sealed": {
      "discriminator": [246, 98, 243, 175, 236, 228, 97, 27],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "buffer_hunt",
          "writable": true
        },
        {
          "name": "delegation_record_hunt",
          "writable": true
        },
        {
          "name": "delegation_metadata_hunt",
          "writable": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "buffer_board",
          "writable": true
        },
        {
          "name": "delegation_record_board",
          "writable": true
        },
        {
          "name": "delegation_metadata_board",
          "writable": true
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "buffer_treasure",
          "writable": true
        },
        {
          "name": "delegation_record_treasure",
          "writable": true
        },
        {
          "name": "delegation_metadata_treasure",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "owner_program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "delegation_program",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ]
    },
    "embark": {
      "discriminator": [221, 131, 158, 83, 229, 46, 151, 168],
      "accounts": [
        {
          "name": "pilot",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "logbook",
          "writable": true
        },
        {
          "name": "logbook_permission",
          "writable": true
        },
        {
          "name": "permission_program",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeral_vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ]
    },
    "finalize": {
      "discriminator": [171, 61, 218, 56, 127, 115, 12, 217],
      "accounts": [
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "vault"
        },
        {
          "name": "magic_fee_vault",
          "writable": true
        },
        {
          "name": "program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magic_context",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ]
    },
    "join": {
      "discriminator": [206, 55, 2, 106, 113, 220, 17, 163],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "hunt"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "buffer_logbook",
          "writable": true
        },
        {
          "name": "delegation_record_logbook",
          "writable": true
        },
        {
          "name": "delegation_metadata_logbook",
          "writable": true
        },
        {
          "name": "logbook",
          "writable": true
        },
        {
          "name": "owner_program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "delegation_program",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ]
    },
    "open_hunt": {
      "discriminator": [210, 48, 140, 2, 52, 192, 229, 174],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "treasure_permission",
          "writable": true
        },
        {
          "name": "permission_program",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeral_vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "oracle_queue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "program_identity"
        },
        {
          "name": "vrf_program",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slot_hashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ]
    },
    "open_logbook": {
      "discriminator": [65, 218, 114, 16, 79, 244, 125, 183],
      "accounts": [
        {
          "name": "treasure"
        },
        {
          "name": "logbook",
          "writable": true
        },
        {
          "name": "logbook_permission",
          "writable": true
        },
        {
          "name": "permission_program",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeral_vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ]
    },
    "open_treasure": {
      "discriminator": [182, 11, 160, 145, 11, 250, 104, 164],
      "accounts": [
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "treasure_permission",
          "writable": true
        },
        {
          "name": "permission_program",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeral_vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ]
    },
    "probe": {
      "discriminator": [9, 126, 79, 73, 106, 229, 245, 221],
      "accounts": [
        {
          "name": "pilot",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "logbook",
          "writable": true
        }
      ]
    },
    "process_undelegation": {
      "discriminator": [196, 28, 41, 206, 48, 37, 51, 167],
      "accounts": [
        {
          "name": "base_account",
          "writable": true
        },
        {
          "name": "buffer"
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ]
    },
    "release_board": {
      "discriminator": [30, 124, 132, 157, 15, 9, 104, 102],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magic_context",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ]
    },
    "release_logbook": {
      "discriminator": [78, 109, 72, 138, 128, 82, 171, 162],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasure"
        },
        {
          "name": "logbook",
          "writable": true
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magic_context",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ]
    },
    "schedule_tick": {
      "discriminator": [197, 80, 214, 198, 209, 150, 211, 44],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "crank",
          "writable": true
        },
        {
          "name": "ephemeral_vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "hydra_program",
          "address": "eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf"
        }
      ]
    },
    "schedule_tick_legacy": {
      "discriminator": [175, 93, 123, 79, 128, 170, 167, 238],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "vault"
        },
        {
          "name": "magic_fee_vault",
          "writable": true
        },
        {
          "name": "program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magic_context",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ]
    },
    "seal_from_action": {
      "discriminator": [29, 105, 81, 7, 7, 74, 162, 227],
      "accounts": [
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "treasure_permission",
          "writable": true
        },
        {
          "name": "permission_program",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeral_vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ]
    },
    "seal_from_author": {
      "discriminator": [90, 117, 157, 146, 40, 147, 159, 138],
      "accounts": [
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "hunt"
        },
        {
          "name": "treasure",
          "writable": true
        }
      ]
    },
    "seal_from_vrf": {
      "discriminator": [28, 57, 25, 134, 69, 160, 242, 178],
      "accounts": [
        {
          "name": "vrf_program_identity",
          "signer": true
        },
        {
          "name": "treasure",
          "writable": true
        }
      ]
    },
    "set_course": {
      "discriminator": [250, 103, 46, 37, 33, 217, 147, 106],
      "accounts": [
        {
          "name": "pilot",
          "signer": true
        },
        {
          "name": "hunt"
        },
        {
          "name": "board",
          "writable": true
        },
        {
          "name": "logbook"
        }
      ]
    },
    "settle": {
      "discriminator": [175, 42, 185, 87, 144, 131, 102, 212],
      "accounts": [
        {
          "name": "hunt"
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "payee",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true
        },
        {
          "name": "escrow_auth"
        },
        {
          "name": "escrow"
        }
      ]
    },
    "tick": {
      "discriminator": [92, 79, 44, 8, 101, 80, 63, 15],
      "accounts": [
        {
          "name": "hunt",
          "writable": true
        },
        {
          "name": "treasure",
          "writable": true
        },
        {
          "name": "vault"
        },
        {
          "name": "magic_fee_vault",
          "writable": true
        },
        {
          "name": "program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "magic_program",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magic_context",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ]
    }
  },
  "accounts": {
    "Board": [79, 48, 160, 63, 153, 132, 240, 56],
    "Hunt": [126, 151, 152, 114, 99, 37, 27, 144],
    "Logbook": [172, 25, 126, 120, 15, 17, 153, 255],
    "Treasure": [98, 92, 220, 45, 191, 149, 105, 178],
    "Vault": [211, 8, 232, 43, 2, 152, 117, 119]
  },
  "errors": [
    {
      "code": 6000,
      "name": "InvalidParams",
      "msg": "Hunt parameters are out of range"
    },
    {
      "code": 6001,
      "name": "InvalidHunt",
      "msg": "The account is not a hunt of this program"
    },
    {
      "code": 6002,
      "name": "WrongStatus",
      "msg": "The hunt is not in the required state"
    },
    {
      "code": 6003,
      "name": "NotSealed",
      "msg": "The treasure has not been sealed yet"
    },
    {
      "code": 6004,
      "name": "AlreadySealed",
      "msg": "The treasure is already sealed"
    },
    {
      "code": 6005,
      "name": "SealPending",
      "msg": "A randomness request is still pending"
    },
    {
      "code": 6006,
      "name": "VrfNotRequested",
      "msg": "No randomness was requested for this treasure"
    },
    {
      "code": 6007,
      "name": "WrongMode",
      "msg": "This hunt uses a different sealing mode"
    },
    {
      "code": 6008,
      "name": "NotUnitVector",
      "msg": "Coordinates must be a unit vector scaled by 1e9"
    },
    {
      "code": 6009,
      "name": "HuntFull",
      "msg": "The hunt has no free seats"
    },
    {
      "code": 6010,
      "name": "HuntClosed",
      "msg": "The hunt no longer accepts players"
    },
    {
      "code": 6011,
      "name": "NotLive",
      "msg": "The hunt is not live"
    },
    {
      "code": 6012,
      "name": "NotStarted",
      "msg": "The hunt has not started yet"
    },
    {
      "code": 6013,
      "name": "DeadlinePassed",
      "msg": "The deadline has passed"
    },
    {
      "code": 6014,
      "name": "NotPilot",
      "msg": "Signer is neither the owner nor the operator of this logbook"
    },
    {
      "code": 6015,
      "name": "AlreadyEmbarked",
      "msg": "The airship has already embarked"
    },
    {
      "code": 6016,
      "name": "NotEmbarked",
      "msg": "The airship has not embarked"
    },
    {
      "code": 6017,
      "name": "InFlight",
      "msg": "The airship is still in flight"
    },
    {
      "code": 6018,
      "name": "Cooldown",
      "msg": "The sounding gear is cooling down"
    },
    {
      "code": 6019,
      "name": "ProbeLimit",
      "msg": "The logbook is full"
    },
    {
      "code": 6020,
      "name": "NotEnded",
      "msg": "The hunt has not ended"
    },
    {
      "code": 6021,
      "name": "AlreadyFinalized",
      "msg": "The hunt is already finalized"
    },
    {
      "code": 6022,
      "name": "NotFinalized",
      "msg": "The hunt is not finalized"
    },
    {
      "code": 6023,
      "name": "AlreadySettled",
      "msg": "The vault is already settled"
    },
    {
      "code": 6024,
      "name": "NotRevealed",
      "msg": "The treasure has not been revealed"
    },
    {
      "code": 6025,
      "name": "Overflow",
      "msg": "Arithmetic overflow"
    }
  ]
} as const;
