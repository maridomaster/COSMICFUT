import { useEffect, useMemo, useRef } from 'react';
import type { Player } from '@cosmicfut/shared';
import { isLineupValid, useGame } from '@/store/game';
import { unavailablePlayers, type Lineup } from '@cosmicfut/engine';
import { useSeason } from '@/store/season';
import { useNextCompetitionId } from '@/components/game/status';

/** Lesionados + suspensos do clube humano na temporada atual (Set estável por estado do clube). */
export function useHumanUnavailable(): Set<string> {
  const club = useSeason((s) => (s.save ? s.save.season.clubs[s.save.season.humanClubIds[0] ?? s.save.clubId] : undefined));
  // (Atualização 38) suspensão por competição: a do próximo jogo do clube
  const comp = useNextCompetitionId();
  return useMemo(() => (club ? unavailablePlayers(club, comp) : new Set<string>()), [club, comp]);
}

/**
 * Garante uma escalação válida para o elenco carregado: logo após escolher o clube
 * (lineup null), após a migração do persist, ou se a escalação salva ficar inconsistente
 * com o elenco (ex.: dados regenerados), roda o autoPick da engine — sem lesionados/suspensos.
 */
export function useEnsureLineup(players: Player[]) {
  const lineup = useGame((s) => s.lineup);
  const autoPick = useGame((s) => s.autoPick);
  const unavailable = useHumanUnavailable();
  // evita loop caso o elenco não permita 11 titulares
  const tried = useRef<Player[] | null>(null);
  useEffect(() => {
    if (players.length < 11 || isLineupValid(lineup, players)) return;
    // mercado: um reserva vendido só sai do banco; titular vendido ⇒ autoPick reescala
    // (isLineupValid é type guard: aqui o TS estreitaria para null)
    const cur = lineup as Lineup | null;
    if (cur && cur.starters.length === 11) {
      const ids = new Set(players.map((p) => p.id));
      if (cur.starters.every((id) => ids.has(id)) && new Set(cur.starters).size === 11) {
        const bench = cur.bench.filter((id, i, a) => ids.has(id) && a.indexOf(id) === i && !cur.starters.includes(id));
        useGame.getState().setLineup({ ...cur, bench });
        return;
      }
    }
    if (tried.current === players && lineup !== null) return;
    tried.current = players;
    autoPick(players, unavailable);
  }, [lineup, players, autoPick, unavailable]);
}
