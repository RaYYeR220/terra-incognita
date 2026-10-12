import { HttpHuntFeed } from './http';
import type { HuntFeed } from './types';

let feed: HuntFeed | null = null;

/** The feed the landing page reads the live hunt from. `MockHuntFeed` stands in for it in isolation. */
export function getFeed(): HuntFeed {
  feed ??= new HttpHuntFeed();
  return feed;
}
