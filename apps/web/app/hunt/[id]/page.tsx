import type { Metadata } from 'next';

import { HuntRoute } from '@/components/game/HuntRoute';

export const metadata: Metadata = { title: 'Hunt' };

export default async function HuntPage({ params, searchParams }: PageProps<'/hunt/[id]'>) {
  const { id } = await params;
  const query = await searchParams;
  const course = typeof query.course === 'string' ? query.course : null;
  return <HuntRoute id={id} sim={query.sim === '1'} course={course} />;
}
