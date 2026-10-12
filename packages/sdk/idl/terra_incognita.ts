/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/terra_incognita.json`.
 */
export type TerraIncognita = {
  "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v",
  "metadata": {
    "name": "terraIncognita",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "A global treasure hunt whose location lives inside a private ephemeral rollup"
  },
  "instructions": [
    {
      "name": "arm",
      "docs": [
        "Starts the hunt once the treasure is sealed: publishes the commitment to the location",
        "and commits the hunt to Solana so the commitment is anchored before anyone plays."
      ],
      "discriminator": [
        230,
        51,
        249,
        116,
        166,
        65,
        21,
        70
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "magicFeeVault",
          "writable": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "cancelHunt",
      "docs": [
        "Withdraws a hunt that was never delegated: closes the hunt, its board, treasure and",
        "vault, prize seed included, back to the creator."
      ],
      "discriminator": [
        1,
        235,
        200,
        4,
        199,
        21,
        221,
        229
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "hunt"
          ]
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeBoard",
      "docs": [
        "Closes the released board of a finalized hunt and returns its rent, together with",
        "whatever the hunt account holds beyond its own rent, to the creator."
      ],
      "discriminator": [
        117,
        4,
        35,
        166,
        80,
        233,
        153,
        42
      ],
      "accounts": [
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "closeLogbook",
      "docs": [
        "Closes a released logbook and returns its rent to the player."
      ],
      "discriminator": [
        69,
        220,
        67,
        125,
        16,
        240,
        189,
        105
      ],
      "accounts": [
        {
          "name": "hunt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "logbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              },
              {
                "kind": "account",
                "path": "logbook.owner",
                "account": "logbook"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "The player who paid for the logbook decides when its record goes."
          ],
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "closeTreasure",
      "docs": [
        "Closes the released treasure of a finalized hunt. The hunt account keeps the revealed",
        "location and salt; the zone seed and the closest sounding go with the treasure."
      ],
      "discriminator": [
        187,
        30,
        57,
        240,
        198,
        200,
        102,
        105
      ],
      "accounts": [
        {
          "name": "hunt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "createHunt",
      "docs": [
        "Creates a hunt on Solana: the public hunt and board, the treasure that will hold the",
        "secret, and the vault that keeps the prize until settlement."
      ],
      "discriminator": [
        184,
        154,
        59,
        39,
        76,
        114,
        11,
        186
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "actionEscrow",
          "writable": true
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "huntParams"
            }
          }
        }
      ]
    },
    {
      "name": "delegateHunt",
      "docs": [
        "Delegates the hunt, its board and its treasure to the hunt's validator.",
        "Accounts that are already delegated are skipped, so the call can be repeated."
      ],
      "discriminator": [
        15,
        231,
        0,
        144,
        0,
        63,
        217,
        47
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferHunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                31,
                121,
                116,
                169,
                207,
                1,
                221,
                226,
                235,
                100,
                3,
                209,
                66,
                211,
                59,
                216,
                221,
                47,
                131,
                36,
                180,
                228,
                100,
                48,
                170,
                4,
                165,
                236,
                207,
                205,
                239,
                253
              ]
            }
          }
        },
        {
          "name": "delegationRecordHunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataHunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "bufferBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "board"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                31,
                121,
                116,
                169,
                207,
                1,
                221,
                226,
                235,
                100,
                3,
                209,
                66,
                211,
                59,
                216,
                221,
                47,
                131,
                36,
                180,
                228,
                100,
                48,
                170,
                4,
                165,
                236,
                207,
                205,
                239,
                253
              ]
            }
          }
        },
        {
          "name": "delegationRecordBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "bufferTreasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                31,
                121,
                116,
                169,
                207,
                1,
                221,
                226,
                235,
                100,
                3,
                209,
                66,
                211,
                59,
                216,
                221,
                47,
                131,
                36,
                180,
                228,
                100,
                48,
                170,
                4,
                165,
                236,
                207,
                205,
                239,
                253
              ]
            }
          }
        },
        {
          "name": "delegationRecordTreasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataTreasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "delegateHuntSealed",
      "docs": [
        "Author mode, sealed without a readable transaction: delegates the hunt, its board and",
        "its treasure, and attaches to the treasure's delegation a post-delegation action that",
        "the validator runs inside the rollup. The client encrypts the action's arguments, the",
        "location and the salt, to the validator's key, so they never appear in clear on Solana",
        "or in the rollup. The action has to be `seal_from_action` signed by the creator."
      ],
      "discriminator": [
        246,
        98,
        243,
        175,
        236,
        228,
        97,
        27
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferHunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                31,
                121,
                116,
                169,
                207,
                1,
                221,
                226,
                235,
                100,
                3,
                209,
                66,
                211,
                59,
                216,
                221,
                47,
                131,
                36,
                180,
                228,
                100,
                48,
                170,
                4,
                165,
                236,
                207,
                205,
                239,
                253
              ]
            }
          }
        },
        {
          "name": "delegationRecordHunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataHunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "bufferBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "board"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                31,
                121,
                116,
                169,
                207,
                1,
                221,
                226,
                235,
                100,
                3,
                209,
                66,
                211,
                59,
                216,
                221,
                47,
                131,
                36,
                180,
                228,
                100,
                48,
                170,
                4,
                165,
                236,
                207,
                205,
                239,
                253
              ]
            }
          }
        },
        {
          "name": "delegationRecordBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataBoard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "board"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "bufferTreasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                31,
                121,
                116,
                169,
                207,
                1,
                221,
                226,
                235,
                100,
                3,
                209,
                66,
                211,
                59,
                216,
                221,
                47,
                131,
                36,
                180,
                228,
                100,
                48,
                170,
                4,
                165,
                236,
                207,
                205,
                239,
                253
              ]
            }
          }
        },
        {
          "name": "delegationRecordTreasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataTreasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "actions",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "embark",
      "docs": [
        "Makes the player's logbook private to its owner and operator and puts the airship",
        "on the board at `start`. The sounding gear starts cold, so the first sounding has to",
        "wait for the cooldown like any other."
      ],
      "discriminator": [
        221,
        131,
        158,
        83,
        229,
        46,
        151,
        168
      ],
      "accounts": [
        {
          "name": "pilot",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "logbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              },
              {
                "kind": "account",
                "path": "logbook.owner",
                "account": "logbook"
              }
            ]
          }
        },
        {
          "name": "logbookPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "logbook"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "start",
          "type": {
            "array": [
              "i32",
              3
            ]
          }
        }
      ]
    },
    {
      "name": "finalize",
      "docs": [
        "Ends a decided hunt: reveals the location and salt, commits the hunt to Solana,",
        "releases it from the rollup and schedules the payout in the same intent. Whether it",
        "may run depends on the public hunt state alone."
      ],
      "discriminator": [
        171,
        61,
        218,
        56,
        127,
        115,
        12,
        217
      ],
      "accounts": [
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "magicFeeVault",
          "writable": true
        },
        {
          "name": "program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "join",
      "docs": [
        "Enters a hunt on Solana: pays the entry fee into the vault, creates the player's",
        "logbook and delegates it to the hunt's validator. `operator` is a session key that",
        "may fly the airship on the owner's behalf; prizes always go to the owner."
      ],
      "discriminator": [
        206,
        55,
        2,
        106,
        113,
        220,
        17,
        163
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "hunt",
          "docs": [
            "deserialized and address-checked in the handler."
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "bufferLogbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "logbook"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                31,
                121,
                116,
                169,
                207,
                1,
                221,
                226,
                235,
                100,
                3,
                209,
                66,
                211,
                59,
                216,
                221,
                47,
                131,
                36,
                180,
                228,
                100,
                48,
                170,
                4,
                165,
                236,
                207,
                205,
                239,
                253
              ]
            }
          }
        },
        {
          "name": "delegationRecordLogbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "logbook"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataLogbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "logbook"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "logbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "operator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "openHunt",
      "docs": [
        "Opens the hunt inside the rollup: makes the treasure unreadable for everyone and, in",
        "VRF mode, asks the oracle for the randomness that will place it."
      ],
      "discriminator": [
        210,
        48,
        140,
        2,
        52,
        192,
        229,
        174
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "hunt"
          ]
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasurePermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openLogbook",
      "docs": [
        "Makes a logbook readable by everyone once the hunt is over, so every hint in it can",
        "be checked against the revealed location."
      ],
      "discriminator": [
        65,
        218,
        114,
        16,
        79,
        244,
        125,
        183
      ],
      "accounts": [
        {
          "name": "treasure",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "logbook.hunt",
                "account": "logbook"
              }
            ]
          }
        },
        {
          "name": "logbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "logbook.hunt",
                "account": "logbook"
              },
              {
                "kind": "account",
                "path": "logbook.owner",
                "account": "logbook"
              }
            ]
          }
        },
        {
          "name": "logbookPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "logbook"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openTreasure",
      "docs": [
        "Makes the treasure account readable by everyone once the hunt is over."
      ],
      "discriminator": [
        182,
        11,
        160,
        145,
        11,
        250,
        104,
        164
      ],
      "accounts": [
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "treasure.hunt",
                "account": "treasure"
              }
            ]
          }
        },
        {
          "name": "treasurePermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "probe",
      "docs": [
        "Takes a sounding where the airship is. The distance band goes into the private",
        "logbook and a pin, without the band, goes on the public board."
      ],
      "discriminator": [
        9,
        126,
        79,
        73,
        106,
        229,
        245,
        221
      ],
      "accounts": [
        {
          "name": "pilot",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "logbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              },
              {
                "kind": "account",
                "path": "logbook.owner",
                "account": "logbook"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "reclaimEscrow",
      "docs": [
        "Closes the escrow that pays for the settlement action once it is no longer needed,",
        "and hands the creator everything the hunt account holds beyond its own rent."
      ],
      "discriminator": [
        176,
        139,
        187,
        224,
        9,
        247,
        207,
        234
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "hunt"
          ]
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "actionEscrow",
          "writable": true
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "refundEntry",
      "docs": [
        "Returns an entrant's fee from the vault of a void hunt and closes their released",
        "logbook, whose rent goes back to them as well. Anyone may send it."
      ],
      "discriminator": [
        214,
        5,
        136,
        23,
        253,
        7,
        230,
        81
      ],
      "accounts": [
        {
          "name": "hunt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "logbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              },
              {
                "kind": "account",
                "path": "logbook.owner",
                "account": "logbook"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "releaseBoard",
      "docs": [
        "Returns the board and the treasure to Solana after the hunt."
      ],
      "discriminator": [
        30,
        124,
        132,
        157,
        15,
        9,
        104,
        102
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "treasure.hunt",
                "account": "treasure"
              }
            ]
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "treasure.hunt",
                "account": "treasure"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "releaseLogbook",
      "docs": [
        "Returns a logbook to Solana after the hunt, where its rent can be reclaimed."
      ],
      "discriminator": [
        78,
        109,
        72,
        138,
        128,
        82,
        171,
        162
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasure",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "logbook.hunt",
                "account": "logbook"
              }
            ]
          }
        },
        {
          "name": "logbook",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "logbook.hunt",
                "account": "logbook"
              },
              {
                "kind": "account",
                "path": "logbook.owner",
                "account": "logbook"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "scheduleTick",
      "docs": [
        "Registers a recurring `tick` with the Hydra scheduler of the rollup."
      ],
      "discriminator": [
        197,
        80,
        214,
        198,
        209,
        150,
        211,
        44
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "crank",
          "writable": true
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "hydraProgram",
          "address": "eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf"
        }
      ],
      "args": [
        {
          "name": "intervalSlots",
          "type": "u32"
        }
      ]
    },
    {
      "name": "scheduleTickLegacy",
      "docs": [
        "Registers a recurring `tick` with the validator's built-in task scheduler."
      ],
      "discriminator": [
        175,
        93,
        123,
        79,
        128,
        170,
        167,
        238
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "magicFeeVault",
          "writable": true
        },
        {
          "name": "program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "taskId",
          "type": "i64"
        },
        {
          "name": "intervalMillis",
          "type": "i64"
        }
      ]
    },
    {
      "name": "sealFromAction",
      "docs": [
        "Author mode, run by the validator as the post-delegation action attached by",
        "`delegate_hunt_sealed`: makes the treasure private and places it in one step.",
        "",
        "`hunt` travels inside the encrypted arguments, so a copied ciphertext cannot seal a",
        "different hunt with this hunt's location."
      ],
      "discriminator": [
        29,
        105,
        81,
        7,
        7,
        74,
        162,
        227
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "hunt"
          ]
        },
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasurePermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "treasure"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "hunt",
          "type": "pubkey"
        },
        {
          "name": "location",
          "type": {
            "array": [
              "i32",
              3
            ]
          }
        },
        {
          "name": "salt",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "sealFromAuthor",
      "docs": [
        "Author mode: the creator places the treasure. The transaction goes straight to the",
        "rollup and is only accepted once `open_hunt` has made the treasure private."
      ],
      "discriminator": [
        90,
        117,
        157,
        146,
        40,
        147,
        159,
        138
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "hunt"
          ]
        },
        {
          "name": "hunt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "location",
          "type": {
            "array": [
              "i32",
              3
            ]
          }
        },
        {
          "name": "salt",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "sealFromVrf",
      "docs": [
        "VRF callback. Stores the oracle's output in the treasure and nothing else; the",
        "location is derived from it when the hunt is armed."
      ],
      "discriminator": [
        28,
        57,
        25,
        134,
        69,
        160,
        242,
        178
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "treasure.hunt",
                "account": "treasure"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setCourse",
      "docs": [
        "Sends the airship towards `destination`. Only possible while it is not in flight."
      ],
      "discriminator": [
        250,
        103,
        46,
        37,
        33,
        217,
        147,
        106
      ],
      "accounts": [
        {
          "name": "pilot",
          "signer": true
        },
        {
          "name": "hunt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "logbook",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  98,
                  111,
                  111,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              },
              {
                "kind": "account",
                "path": "logbook.owner",
                "account": "logbook"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "destination",
          "type": {
            "array": [
              "i32",
              3
            ]
          }
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Pays out the vault once the hunt is back on Solana in a final state. Scheduled by the",
        "rollup together with the last commit, and callable by anyone as a fallback."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "hunt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
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
          "name": "escrowAuth"
        },
        {
          "name": "escrow"
        }
      ],
      "args": []
    },
    {
      "name": "tick",
      "docs": [
        "Advances the hunt from the clock, one step per call: promotes a strike made in an",
        "earlier slot, closes the hunt at the deadline, shrinks the public zone, or finalizes",
        "a hunt that has ended. Does nothing when there is nothing to do. Takes no signers so",
        "a scheduler can drive it."
      ],
      "discriminator": [
        92,
        79,
        44,
        8,
        101,
        80,
        63,
        15
      ],
      "accounts": [
        {
          "name": "hunt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt.creator",
                "account": "hunt"
              },
              {
                "kind": "account",
                "path": "hunt.id",
                "account": "hunt"
              }
            ]
          }
        },
        {
          "name": "treasure",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "hunt"
              }
            ]
          }
        },
        {
          "name": "magicFeeVault",
          "writable": true
        },
        {
          "name": "program",
          "address": "37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "board",
      "discriminator": [
        79,
        48,
        160,
        63,
        153,
        132,
        240,
        56
      ]
    },
    {
      "name": "hunt",
      "discriminator": [
        126,
        151,
        152,
        114,
        99,
        37,
        27,
        144
      ]
    },
    {
      "name": "logbook",
      "discriminator": [
        172,
        25,
        126,
        120,
        15,
        17,
        153,
        255
      ]
    },
    {
      "name": "treasure",
      "discriminator": [
        98,
        92,
        220,
        45,
        191,
        149,
        105,
        178
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidParams",
      "msg": "Hunt parameters are out of range"
    },
    {
      "code": 6001,
      "name": "invalidHunt",
      "msg": "The account is not a hunt of this program"
    },
    {
      "code": 6002,
      "name": "wrongStatus",
      "msg": "The hunt is not in the required state"
    },
    {
      "code": 6003,
      "name": "notSealed",
      "msg": "The treasure has not been sealed yet"
    },
    {
      "code": 6004,
      "name": "alreadySealed",
      "msg": "The treasure is already sealed"
    },
    {
      "code": 6005,
      "name": "sealPending",
      "msg": "A randomness request is still pending"
    },
    {
      "code": 6006,
      "name": "vrfNotRequested",
      "msg": "No randomness was requested for this treasure"
    },
    {
      "code": 6007,
      "name": "wrongMode",
      "msg": "This hunt uses a different sealing mode"
    },
    {
      "code": 6008,
      "name": "notUnitVector",
      "msg": "Coordinates must be a unit vector scaled by 1e9"
    },
    {
      "code": 6009,
      "name": "huntFull",
      "msg": "The hunt has no free seats"
    },
    {
      "code": 6010,
      "name": "huntClosed",
      "msg": "The hunt no longer accepts players"
    },
    {
      "code": 6011,
      "name": "notLive",
      "msg": "The hunt is not live"
    },
    {
      "code": 6012,
      "name": "notStarted",
      "msg": "The hunt has not started yet"
    },
    {
      "code": 6013,
      "name": "deadlinePassed",
      "msg": "The deadline has passed"
    },
    {
      "code": 6014,
      "name": "notPilot",
      "msg": "Signer is neither the owner nor the operator of this logbook"
    },
    {
      "code": 6015,
      "name": "alreadyEmbarked",
      "msg": "The airship has already embarked"
    },
    {
      "code": 6016,
      "name": "notEmbarked",
      "msg": "The airship has not embarked"
    },
    {
      "code": 6017,
      "name": "inFlight",
      "msg": "The airship is still in flight"
    },
    {
      "code": 6018,
      "name": "cooldown",
      "msg": "The sounding gear is cooling down"
    },
    {
      "code": 6019,
      "name": "probeLimit",
      "msg": "The logbook is full"
    },
    {
      "code": 6020,
      "name": "notEnded",
      "msg": "The hunt has not ended"
    },
    {
      "code": 6021,
      "name": "alreadyFinalized",
      "msg": "The hunt is already finalized"
    },
    {
      "code": 6022,
      "name": "notFinalized",
      "msg": "The hunt is not finalized"
    },
    {
      "code": 6023,
      "name": "alreadySettled",
      "msg": "The vault is already settled"
    },
    {
      "code": 6024,
      "name": "notRevealed",
      "msg": "The treasure has not been revealed"
    },
    {
      "code": 6025,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6026,
      "name": "useRefund",
      "msg": "Entries of a void hunt are returned with refund_entry"
    },
    {
      "code": 6027,
      "name": "notVoid",
      "msg": "Only entries of a void hunt are refunded"
    },
    {
      "code": 6028,
      "name": "foreignSeal",
      "msg": "The sealed action belongs to another hunt"
    }
  ],
  "types": [
    {
      "name": "board",
      "docs": [
        "Public state of a hunt: where every airship is and where the last soundings were taken."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hunt",
            "type": "pubkey"
          },
          {
            "name": "pinCount",
            "docs": [
              "Total pins ever pushed; the ring slot of the next pin is `pin_count % PIN_RING`."
            ],
            "type": "u32"
          },
          {
            "name": "shipCount",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "ships",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "ship"
                  }
                },
                64
              ]
            }
          },
          {
            "name": "pins",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "pin"
                  }
                },
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "hunt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "huntMode"
              }
            }
          },
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "prizeSeed",
            "type": "u64"
          },
          {
            "name": "creatorBps",
            "type": "u16"
          },
          {
            "name": "maxPlayers",
            "type": "u8"
          },
          {
            "name": "speedKms",
            "type": "u32"
          },
          {
            "name": "startsAt",
            "type": "i64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "zoneIntervalSecs",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "huntStatus"
              }
            }
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "zoneStage",
            "type": "u8"
          },
          {
            "name": "zoneCenter",
            "type": {
              "array": [
                "i32",
                3
              ]
            }
          },
          {
            "name": "players",
            "type": "u8"
          },
          {
            "name": "probesTotal",
            "type": "u32"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "revealedLocation",
            "type": {
              "array": [
                "i32",
                3
              ]
            }
          },
          {
            "name": "revealedSalt",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "endedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "boardBump",
            "type": "u8"
          },
          {
            "name": "treasureBump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "clue",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "huntMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "vrf"
          },
          {
            "name": "author"
          }
        ]
      }
    },
    {
      "name": "huntParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "huntMode"
              }
            }
          },
          {
            "name": "validator",
            "type": "pubkey"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "prizeSeed",
            "type": "u64"
          },
          {
            "name": "creatorBps",
            "type": "u16"
          },
          {
            "name": "maxPlayers",
            "type": "u8"
          },
          {
            "name": "speedKms",
            "type": "u32"
          },
          {
            "name": "startsAt",
            "type": "i64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "zoneIntervalSecs",
            "type": "u32"
          },
          {
            "name": "opsLamports",
            "docs": [
              "Lamports left on the hunt account for rollup fees."
            ],
            "type": "u64"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "clue",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "huntStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "created"
          },
          {
            "name": "sealing"
          },
          {
            "name": "live"
          },
          {
            "name": "struck"
          },
          {
            "name": "closest"
          },
          {
            "name": "void"
          }
        ]
      }
    },
    {
      "name": "logEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pos",
            "type": {
              "array": [
                "i32",
                3
              ]
            }
          },
          {
            "name": "band",
            "type": "u8"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "logbook",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hunt",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "shipIndex",
            "type": "u8"
          },
          {
            "name": "embarked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "entries",
            "type": {
              "vec": {
                "defined": {
                  "name": "logEntry"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "pin",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "pos",
            "type": {
              "array": [
                "i32",
                3
              ]
            }
          },
          {
            "name": "shipIndex",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ship",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "departTs",
            "type": "i64"
          },
          {
            "name": "arriveTs",
            "type": "i64"
          },
          {
            "name": "lastProbeTs",
            "type": "i64"
          },
          {
            "name": "from",
            "type": {
              "array": [
                "i32",
                3
              ]
            }
          },
          {
            "name": "to",
            "type": {
              "array": [
                "i32",
                3
              ]
            }
          },
          {
            "name": "probes",
            "type": "u8"
          },
          {
            "name": "embarked",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "treasure",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hunt",
            "type": "pubkey"
          },
          {
            "name": "sealed",
            "type": "bool"
          },
          {
            "name": "revealed",
            "docs": [
              "Set at finalisation; unlocks the audit openers."
            ],
            "type": "bool"
          },
          {
            "name": "entropy",
            "docs": [
              "Raw VRF output the location is derived from. Zero for author-placed treasures."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "location",
            "type": {
              "array": [
                "i32",
                3
              ]
            }
          },
          {
            "name": "salt",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "zoneSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "vrfRequestedAt",
            "type": "i64"
          },
          {
            "name": "bestDot",
            "docs": [
              "Closest sounding so far; `NO_SOUNDING` until the first one."
            ],
            "type": "i64"
          },
          {
            "name": "bestPlayer",
            "type": "pubkey"
          },
          {
            "name": "bestTs",
            "type": "i64"
          },
          {
            "name": "strikePlayer",
            "docs": [
              "First sounding within striking distance. It stays here, unseen, until a later",
              "`tick` promotes it to the public hunt state. A zero slot means no strike."
            ],
            "type": "pubkey"
          },
          {
            "name": "strikeSlot",
            "type": "u64"
          },
          {
            "name": "strikeTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hunt",
            "type": "pubkey"
          },
          {
            "name": "prizeSeed",
            "type": "u64"
          },
          {
            "name": "entryTotal",
            "type": "u64"
          },
          {
            "name": "entrants",
            "type": "u8"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
