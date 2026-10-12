import type { Metadata } from 'next';

import { PageFrame } from '@/components/chrome/PageFrame';
import { ProofView } from '@/components/proof/ProofView';

export const metadata: Metadata = { title: 'Proof' };

export default async function ProofPage({ params }: PageProps<'/proof/[id]'>) {
  const { id } = await params;
  return (
    <PageFrame current="proof">
      <ProofView id={id} />
    </PageFrame>
  );
}
