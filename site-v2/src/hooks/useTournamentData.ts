import { useQuery } from '@tanstack/react-query';
import type { TournamentData } from '@/lib/types';

async function fetchData(): Promise<TournamentData> {
  const res = await fetch('/data.json');
  if (!res.ok) throw new Error('Failed to load tournament data');
  return res.json();
}

export function useTournamentData() {
  return useQuery({
    queryKey: ['tournament-data'],
    queryFn: fetchData,
    staleTime: Infinity, // static asset; refetch on full reload
  });
}
