import { useTournamentData } from '@/hooks/useTournamentData';

export function Flag({ team }: { team: string }) {
  const { data } = useTournamentData();
  const code = data?.flag_map[team];
  if (!code) return null;
  return <span className={`fi fi-${code}`} aria-hidden />;
}
