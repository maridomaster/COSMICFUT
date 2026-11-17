import { useMemo } from 'react';
import { BatteryLow, Cross } from 'lucide-react';
import { isSuspendedFor as engineIsSuspendedFor, nextFixtureFor, suspendedPlayers, suspensionGames } from '@cosmicfut/engine';
import { cachedBundle } from '@/data/squads';
import { clubIndexEntry, shortFromName } from '@/data/clubIndex';
import { indexCrestPaths } from '@/data/source';
import { cn } from '@/lib/utils';
import { useSeason } from '@/store/season';
import { Crest } from './Crest';
import { YellowsChip } from './chips';

export interface PlayerStatus {
  /** dias de lesão restantes */
  injury?: number;
  /** jogos de suspensão restantes */
  suspension?: number;
  /** condição física 0..100 (ausente = 100) */
  fitness?: number;
  yellows?: number;
}

/**
 * Competição do próximo jogo do clube humano (a suspensão é por competição — Atualização 38).
 * `undefined` sem temporada ou sem jogos pela frente.
 */
export function useNextCompetitionId(): string | undefined {
  const season = useSeason((s) => s.save?.season);
  const clubId = useSeason((s) => (s.save ? s.save.season.humanClubIds[0] ?? s.save.clubId : undefined));
  return useMemo(() => (season && clubId ? nextFixtureFor(season, clubId)?.competitionId : undefined), [season, clubId]);
}

/**
 * Situação dos jogadores do clube humano na temporada (lesão, suspensão, físico, amarelos).
 * (Atualização 38) Suspensão e amarelos são os da competição do PRÓXIMO jogo do clube (ou de `competitionId`):
 * expulso na Libertadores não aparece suspenso para o jogo da liga.
 */
export function useHumanStatus(competitionId?: string): Map<string, PlayerStatus> {
  const club = useSeason((s) => (s.save ? s.save.season.clubs[s.save.season.humanClubIds[0] ?? s.save.clubId] : undefined));
  const nextComp = useNextCompetitionId();
  const comp = competitionId ?? nextComp;
  return useMemo(() => {
    const m = new Map<string, PlayerStatus>();
    if (!club) return m;
    const get = (id: string) => {
      let v = m.get(id);
      if (!v) m.set(id, (v = {}));
      return v;
    };
    for (const [id, d] of Object.entries(club.injuries)) if (d > 0) get(id).injury = d;
    for (const id of suspendedPlayers(club, comp)) {
      const g = suspensionGames(club, id, comp);
      if (g > 0) get(id).suspension = g;
    }
    for (const [id, f] of Object.entries(club.fitness)) if (f < 100) get(id).fitness = Math.round(f);
    if (comp) for (const [id, y] of Object.entries(club.cards?.[comp] ?? {})) if (y > 0) get(id).yellows = y;
    return m;
  }, [club, comp]);
}

/**
 * (Atualização 38) Suspenso para um jogo da competição? Helper para telas fora do React (ex.: Táticas) — lê a
 * temporada atual do store. Sem `competitionId`: a competição do próximo jogo do clube humano.
 */
export function isSuspendedFor(player: { id: string } | string, competitionId?: string): boolean {
  const save = useSeason.getState().save;
  if (!save) return false;
  const season = save.season;
  const clubId = season.humanClubIds[0] ?? save.clubId;
  const comp = competitionId ?? nextFixtureFor(season, clubId)?.competitionId;
  return engineIsSuspendedFor(season.clubs[clubId], typeof player === 'string' ? player : player.id, comp);
}

export function isUnavailable(s: PlayerStatus | undefined): boolean {
  return !!s && ((s.injury ?? 0) > 0 || (s.suspension ?? 0) > 0);
}

/** Cartão (amarelo/vermelho) desenhado em CSS. */
export function CardIcon({ color, className, title }: { color: 'yellow' | 'red'; className?: string; title?: string }) {
  return (
    <span
      title={title ?? (color === 'yellow' ? 'Cartão amarelo' : 'Cartão vermelho')}
      className={cn('inline-block h-3.5 w-2.5 shrink-0 rounded-[2px] shadow-[0_1px_2px_rgb(0_0_0/0.5)]', color === 'yellow' ? 'bg-[#facc15]' : 'bg-[#ef4444]', className)}
    />
  );
}

/** Ícone de lesão (cruz médica). */
export function InjuryIcon({ className, title }: { className?: string; title?: string }) {
  return (
    <span title={title ?? 'Lesionado'} className={cn('inline-grid size-4 shrink-0 place-items-center rounded-[4px] bg-danger text-white', className)}>
      <Cross className="size-3" strokeWidth={3} />
    </span>
  );
}

/** Badges de indisponibilidade/condição para listas de jogadores. */
export function AvailabilityBadges({ status, compact, className, yellows = true }: { status: PlayerStatus | undefined; compact?: boolean; className?: string; yellows?: boolean }) {
  if (!status) return null;
  // (Atualização 38) a barra de stamina mostra a faixa; o ícone de bateria só aparece abaixo de 50% (laranja/vermelho)
  const tired = status.fitness !== undefined && status.fitness < 50;
  // (Atualização 41) amarelos pendurados (competição do próximo jogo) entram na mesma família de status
  const cards = yellows && !status.suspension ? (status.yellows ?? 0) : 0;
  if (!status.injury && !status.suspension && !tired && !cards) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {cards > 0 && <YellowsChip count={cards} />}
      {!!status.injury && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-danger">
          <InjuryIcon title={`Lesionado — ${status.injury} ${status.injury === 1 ? 'dia' : 'dias'} fora`} />
          {!compact && <span className="tabular">{status.injury}d</span>}
        </span>
      )}
      {!!status.suspension && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-danger">
          <CardIcon color="red" title={`Suspenso — ${status.suspension} ${status.suspension === 1 ? 'jogo' : 'jogos'}`} />
          {!compact && <span className="tabular">{status.suspension}j</span>}
        </span>
      )}
      {tired && !status.injury && (
        <span title={`Condição física ${status.fitness}%`} className="inline-flex items-center gap-0.5 text-[10px] font-bold text-warning">
          <BatteryLow className="size-3.5" />
          {!compact && <span className="tabular">{status.fitness}%</span>}
        </span>
      )}
    </span>
  );
}

/** Escudo de um clube da temporada (bundle em cache; senão o índice de clubes). */
export function ClubCrest({ id, size = 24, className }: { id: string; size?: number; className?: string }) {
  const club = cachedBundle(id)?.club;
  const entry = club ? undefined : clubIndexEntry(id);
  return (
    <Crest
      path={club ? [club.crest, club.crestMini].filter((p): p is string => !!p) : entry ? indexCrestPaths(entry) : null}
      name={club?.name ?? entry?.name ?? id}
      colors={club?.colors ?? entry?.colors ?? { primary: '#555', secondary: '#999' }}
      size={size}
      className={className}
    />
  );
}

export function clubLabel(id: string, short = false): string {
  const c = cachedBundle(id)?.club;
  if (c) return (short ? c.shortName : c.name) ?? id;
  const e = clubIndexEntry(id);
  if (e) return short ? shortFromName(e.name) : e.name;
  return id;
}

export function clubColors(id: string): { primary: string; secondary: string } {
  return cachedBundle(id)?.club.colors ?? clubIndexEntry(id)?.colors ?? { primary: '#555', secondary: '#999' };
}
