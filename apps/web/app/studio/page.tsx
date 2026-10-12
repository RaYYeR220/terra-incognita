import type { Metadata } from 'next';

import { PageFrame } from '@/components/chrome/PageFrame';
import p from '@/components/chrome/paper.module.css';
import { StudioClient } from '@/components/studio/StudioClient';

export const metadata: Metadata = { title: 'Studio' };

export default function StudioPage() {
  return (
    <PageFrame current="studio">
      <h1 className={p.h1}>Hide a treasure of your own.</h1>
      <p className={p.lede}>
        Put up a prize, set the entry fee and the clock, and let the enclave pick the spot — or choose it yourself and write the riddle. You earn a share of every entry.
      </p>
      <StudioClient />
    </PageFrame>
  );
}
