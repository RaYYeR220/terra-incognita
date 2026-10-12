import { ed25519 } from '@noble/curves/ed25519';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { TerraTxError, base58, isTxError, keypairSigner, programErrorName, toSigner } from '../src/index.js';

describe('program errors', () => {
  it('names the codes the program returns', () => {
    expect(programErrorName(6003)).toBe('NotSealed');
    expect(programErrorName(6011)).toBe('NotLive');
    expect(programErrorName(6018)).toBe('Cooldown');
    expect(programErrorName(6023)).toBe('AlreadySettled');
    expect(programErrorName(1)).toBeNull();
  });

  it('reads the code from a failed status, a preflight message and the logs', () => {
    const executed = new TerraTxError('rollup', 'sig', { InstructionError: [0, { Custom: 6020 }] });
    expect(executed.code).toBe('NotEnded');
    expect(executed.message).toContain('The hunt has not ended');

    const preflight = new TerraTxError(
      'rollup',
      null,
      'Simulation failed. \nMessage: transaction verification error: Error processing Instruction 1: custom program error: 0x1773.',
    );
    expect(preflight.code).toBe('NotSealed');
    expect(preflight.number).toBe(6003);

    const logged = new TerraTxError('solana', 'sig', 'failed', ['Program log: AnchorError ... Error Number: 6017. Error Message: x.']);
    expect(logged.code).toBe('InFlight');
    expect(isTxError(logged, 'InFlight', 'Cooldown')).toBe(true);
    expect(isTxError(logged, 'Cooldown')).toBe(false);

    const outside = new TerraTxError('solana', null, 'Blockhash not found');
    expect(outside.code).toBeNull();
    expect(isTxError(outside)).toBe(true);
  });
});

describe('signing and encoding', () => {
  it('encodes base58 like web3.js', () => {
    for (let i = 0; i < 20; i += 1) {
      const key = Keypair.generate().publicKey;
      expect(base58(key.toBytes())).toBe(key.toBase58());
    }
    expect(base58(PublicKey.default.toBytes())).toBe(PublicKey.default.toBase58());
    expect(base58(Uint8Array.of(0, 0, 1))).toBe('112');
  });

  it('signs login messages with a keypair', async () => {
    const keypair = Keypair.generate();
    const signer = keypairSigner(keypair);
    const message = new TextEncoder().encode('challenge');
    const signature = await signer.signMessage(message);
    expect(ed25519.verify(signature, message, keypair.publicKey.toBytes())).toBe(true);
    expect(toSigner(keypair).publicKey.equals(keypair.publicKey)).toBe(true);
    expect(toSigner(signer)).toBe(signer);
  });
});
