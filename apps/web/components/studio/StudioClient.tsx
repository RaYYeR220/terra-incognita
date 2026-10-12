'use client';

import { Wallets } from '@/components/wallet/Wallets';

import { StudioForm } from './StudioForm';

export function StudioClient() {
  return (
    <Wallets>
      <StudioForm />
    </Wallets>
  );
}
