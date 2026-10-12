import { ed25519 } from '@noble/curves/ed25519';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';

/**
 * Anything that can sign for one public key: a browser wallet adapter or a local keypair.
 * `signMessage` is only needed to authenticate to the rollup as this key.
 */
export interface TerraSigner {
  readonly publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/** A signer whose secret key is in memory. Operator and relay keys are always local. */
export interface LocalSigner extends TerraSigner {
  readonly keypair: Keypair;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export function keypairSigner(keypair: Keypair): LocalSigner {
  return {
    keypair,
    publicKey: keypair.publicKey,
    async signTransaction(tx) {
      tx.partialSign(keypair);
      return tx;
    },
    async signMessage(message) {
      return ed25519.sign(message, keypair.secretKey.slice(0, 32));
    },
  };
}

/** The parts of a Solana wallet adapter this client uses. */
export interface WalletLike {
  publicKey: PublicKey | null;
  signTransaction?: <T extends Transaction>(tx: T) => Promise<T>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}

/** Wraps a connected wallet adapter. */
export function walletSigner(wallet: WalletLike): TerraSigner {
  const { publicKey, signTransaction, signMessage } = wallet;
  if (!publicKey) throw new Error('wallet is not connected');
  if (!signTransaction) throw new Error('wallet cannot sign transactions');
  return {
    publicKey,
    signTransaction: (tx) => signTransaction.call(wallet, tx),
    ...(signMessage ? { signMessage: (message: Uint8Array) => signMessage.call(wallet, message) } : {}),
  };
}

export function isLocalSigner(signer: TerraSigner): signer is LocalSigner {
  return 'keypair' in signer && isKeypair((signer as LocalSigner).keypair);
}

/** Duck-typed, so that a Keypair from another copy of web3.js is recognised too. */
function isKeypair(value: unknown): value is Keypair {
  return (
    typeof value === 'object' &&
    value !== null &&
    'secretKey' in value &&
    (value as Keypair).secretKey instanceof Uint8Array &&
    !('signTransaction' in value)
  );
}

export function toSigner(signer: TerraSigner | Keypair): TerraSigner {
  return isKeypair(signer) ? keypairSigner(signer) : (signer as TerraSigner);
}
