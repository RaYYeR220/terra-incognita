import type { Metadata } from 'next';

import { PageFrame } from '@/components/chrome/PageFrame';
import p from '@/components/chrome/paper.module.css';
import { HuntsList } from '@/components/hunts/HuntsList';

export const metadata: Metadata = { title: 'Hunts' };

export default function HuntsPage() {
  return (
    <PageFrame current="hunts">
      <h1 className={p.h1}>Hunts at sea</h1>
      <p className={p.lede}>Every hunt on the program, read from Solana and the rollup. Join a live one, or read the proof of one that has ended.</p>
      <HuntsList />
    </PageFrame>
  );
}
