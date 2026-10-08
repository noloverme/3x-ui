import type { SponsorList } from '@/generated/types';

const EMPTY: SponsorList = { sponsors: [] };

export function useSponsorsQuery() {
  return { data: EMPTY, fetched: true };
}
