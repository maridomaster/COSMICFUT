/**
 * (Táticas) Disponibilidade para a escalação automática ("Melhor Elenco" / "Descansar Time").
 *
 * Usa o PRÓXIMO jogo do clube exibido (hot-seat: o técnico ativo) para a suspensão POR COMPETIÇÃO
 * (`suspendedPlayers`/`isSuspendedFor` do engine — season/discipline.ts, Atualização 38): um expulso na
 * Libertadores continua escalável no jogo da liga.
 */
import { useMemo } from 'react';
import { nextFixtureFor, suspendedPlayers } from '@cosmicfut/engine';
import { useViewClubId } from '@/store/game';
import { useSeason } from '@/store/season';

export interface LineupAvailability {
  /** lesionados + suspensos para o próximo jogo */
  unavailable: Set<string>;
  /** condição física 0..100 */
  fitness: Record<string, number>;
  /** competição do próximo jogo (null fora de temporada) */
  competitionId: string | null;
  competitionName: string | null;
}

export function useLineupAvailability(): LineupAvailability {
  const viewId = useViewClubId();
  const season = useSeason((s) => s.save?.season ?? null);
  return useMemo(() => {
    const clubId = viewId ?? season?.humanClubIds[0] ?? null;
    const club = clubId && season ? season.clubs[clubId] : undefined;
    let competitionId: string | null = null;
    let competitionName: string | null = null;
    if (season && clubId) {
      const f = nextFixtureFor(season, clubId);
      competitionId = f?.competitionId ?? null;
      competitionName = competitionId ? (season.competitions.find((c) => c.id === competitionId)?.name ?? null) : null;
    }
    const unavailable = new Set<string>();
    if (club) {
      for (const [id, d] of Object.entries(club.injuries)) if (d > 0) unavailable.add(id);
      // sem próximo jogo: suspenso em qualquer competição
      for (const id of suspendedPlayers(club, competitionId ?? undefined)) unavailable.add(id);
    }
    return { unavailable, fitness: club?.fitness ?? {}, competitionId, competitionName };
  }, [viewId, season]);
}
