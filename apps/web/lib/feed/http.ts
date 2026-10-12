import type { HuntFeed, HuntSummary } from './types';

async function readFeatured(): Promise<HuntSummary | null> {
  const res = await fetch('/api/hunts/featured', { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { hunt?: HuntSummary | null };
  return body.hunt ?? null;
}

/** The live demo hunt as the server reads it from the chain, polled for the poster on the landing page. */
export class HttpHuntFeed implements HuntFeed {
  featured(): Promise<HuntSummary | null> {
    return readFeatured();
  }

  async list(): Promise<HuntSummary[]> {
    const one = await readFeatured();
    return one ? [one] : [];
  }

  watch(id: string, onChange: (summary: HuntSummary) => void): () => void {
    let stopped = false;
    const tick = async () => {
      const hunt = await readFeatured().catch(() => null);
      if (!stopped && hunt && (id === '*' || hunt.id === id)) onChange(hunt);
    };
    void tick();
    const timer = setInterval(() => void tick(), 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}
