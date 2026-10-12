'use client';

import { WalletReadyState } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { walletSigner } from '@terra-incognita/sdk';
import type { TerraSigner } from '@terra-incognita/sdk';
import { useMemo, useRef, useState } from 'react';

import { terraClient } from '@/lib/chain/client';
import { shortHash } from '@/lib/format';
import { useFocusTrap } from '@/lib/useFocusTrap';

import s from './wallets.module.css';

/** Phantom, Solflare, Backpack and any other Wallet Standard wallet are found on their own. */
export function Wallets({ children }: { children: React.ReactNode }) {
  const endpoint = terraClient().config.baseRpc;
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** The connected wallet as a signer for the SDK, or null. */
export function useWalletSigner(): TerraSigner | null {
  const wallet = useWallet();
  const { publicKey, signTransaction, signMessage, connected } = wallet;
  return useMemo(() => {
    if (!connected || !publicKey || !signTransaction) return null;
    return walletSigner({ publicKey, signTransaction, signMessage });
  }, [connected, publicKey, signTransaction, signMessage]);
}

const PREFERRED = ['Phantom', 'Solflare', 'Backpack'];

export function WalletButton({ className, label = 'Use my wallet' }: { className?: string; label?: string }) {
  const { wallets, select, disconnect, connected, connecting, publicKey, wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useFocusTrap(sheet, open, () => setOpen(false));

  const listed = [...wallets]
    .filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable || PREFERRED.includes(w.adapter.name))
    .sort((a, b) => (PREFERRED.indexOf(a.adapter.name) + 99) % 100 - ((PREFERRED.indexOf(b.adapter.name) + 99) % 100));

  if (connected && publicKey) {
    return (
      <button type="button" className={className ?? s.link} onClick={() => void disconnect()} title="Disconnect">
        {wallet?.adapter.name ?? 'Wallet'} {shortHash(publicKey.toBase58())} · disconnect
      </button>
    );
  }

  const choose = async (name: string) => {
    setError(null);
    try {
      const found = wallets.find((w) => w.adapter.name === name);
      if (!found) return;
      select(found.adapter.name);
      await found.adapter.connect();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'The wallet did not connect.');
    }
  };

  return (
    <>
      <button type="button" className={className ?? s.link} onClick={() => setOpen(true)} disabled={connecting}>
        {connecting ? 'Connecting…' : label}
      </button>
      {open ? (
        <div className={s.scrim} onClick={() => setOpen(false)}>
          <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="wallet-h" ref={sheet} onClick={(e) => e.stopPropagation()}>
            <h2 id="wallet-h">Choose a wallet</h2>
            {listed.length === 0 ? (
              <p className={s.note}>No Solana wallet was found in this browser. Install Phantom, Solflare or Backpack, or keep playing as a guest.</p>
            ) : (
              <ul className={s.list}>
                {listed.map((w) => (
                  <li key={w.adapter.name}>
                    <button type="button" onClick={() => void choose(w.adapter.name)}>
                      {w.adapter.icon ? <img src={w.adapter.icon} alt="" width={28} height={28} /> : null}
                      <span>{w.adapter.name}</span>
                      <small>{w.readyState === WalletReadyState.Installed ? 'installed' : 'not installed'}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error ? <p className={s.error} role="alert">{error}</p> : null}
            <button type="button" className={s.close} onClick={() => setOpen(false)}>
              Not now
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
