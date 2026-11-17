/**
 * (Atualização 38) Disciplina por competição: suspensões e amarelos acumulados ficam guardados por `competitionId`.
 *
 * - Expulso na Libertadores ⇒ suspenso só no PRÓXIMO jogo da Libertadores; livre para a liga/copa no fim de semana.
 * - 3 amarelos acumulados numa competição ⇒ 1 jogo de suspensão NAQUELA competição (o contador é por competição).
 * - Uma suspensão só é cumprida num jogo da mesma competição.
 *
 * Estado: `ClubSeasonState.bans[competitionId][playerId] = jogos` e `ClubSeasonState.cards[competitionId][playerId] = amarelos`.
 * Os campos antigos `suspensions`/`yellowCards` (por jogador, sem competição) ficam vazios depois da migração
 * (`migrateDiscipline`); a chave especial `ANY_COMPETITION` ('*') guarda uma suspensão legada sem competição conhecida,
 * cumprida no próximo jogo de qualquer competição.
 */
import type { ClubSeasonState, Fixture, SeasonState } from '../contract';

/** competição "qualquer uma" (suspensão legada sem competição conhecida) */
export const ANY_COMPETITION = '*';

/** amarelos acumulados que geram 1 jogo de suspensão (por competição) */
export const YELLOW_LIMIT = 3;

type Book = Record<string, Record<string, number>>;

/** Jogos de suspensão do jogador para a competição (inclui a suspensão legada '*'). */
export function suspensionGames(club: ClubSeasonState | undefined, playerId: string, competitionId: string | undefined): number {
  if (!club) return 0;
  const b = club.bans;
  let n = 0;
  if (b) {
    if (competitionId === undefined) {
      for (const k in b) n = Math.max(n, b[k][playerId] ?? 0);
    } else {
      n = (b[competitionId]?.[playerId] ?? 0) + (b[ANY_COMPETITION]?.[playerId] ?? 0);
    }
  }
  // saves não migrados (defensivo): mapa antigo por jogador vale para qualquer competição
  const legacy = club.suspensions?.[playerId];
  if (typeof legacy === 'number' && legacy > 0) n += legacy;
  return n;
}

/** Suspenso para um jogo da competição? Sem `competitionId`: suspenso em alguma competição. */
export function isSuspendedFor(club: ClubSeasonState | undefined, playerId: string, competitionId: string | undefined): boolean {
  return suspensionGames(club, playerId, competitionId) > 0;
}

/** Jogadores suspensos para a competição (sem `competitionId`: em qualquer competição). */
export function suspendedPlayers(club: ClubSeasonState | undefined, competitionId?: string): Set<string> {
  const s = new Set<string>();
  if (!club) return s;
  const add = (m: Record<string, number> | undefined) => {
    if (m) for (const pid in m) if (m[pid] > 0) s.add(pid);
  };
  const b = club.bans;
  if (b) {
    if (competitionId === undefined) for (const k in b) add(b[k]);
    else { add(b[competitionId]); add(b[ANY_COMPETITION]); }
  }
  for (const pid in club.suspensions ?? {}) if ((club.suspensions[pid] as unknown as number) > 0) s.add(pid);
  return s;
}

/** Suspensões do jogador em todas as competições: `[competitionId, jogos][]`. */
export function suspensionsOf(club: ClubSeasonState | undefined, playerId: string): [string, number][] {
  const out: [string, number][] = [];
  if (!club?.bans) return out;
  for (const k in club.bans) {
    const g = club.bans[k][playerId];
    if (g > 0) out.push([k, g]);
  }
  return out;
}

/** Amarelos acumulados na competição. */
export function yellowsIn(club: ClubSeasonState | undefined, playerId: string, competitionId: string): number {
  return club?.cards?.[competitionId]?.[playerId] ?? 0;
}

function bump(book: Book, comp: string, pid: string, v: number): void {
  const m = (book[comp] ??= {});
  const n = (m[pid] ?? 0) + v;
  if (n > 0) m[pid] = n;
  else delete m[pid];
  if (!Object.keys(m).length) delete book[comp];
}

export interface DisciplineEvent {
  playerId: string;
  kind: 'red' | 'yellows';
  games: number;
}

/**
 * Pós-jogo de um clube: cumpre as suspensões da competição deste jogo, aplica expulsões e amarelos.
 * `redGames(pid, secondYellow)` decide quantos jogos (1 para 2º amarelo; 1–2 para vermelho direto).
 */
export function applyMatchDiscipline(
  club: ClubSeasonState,
  competitionId: string,
  cards: { playerId: string; color: 'yellow' | 'red' }[],
  redGames: (playerId: string, secondYellow: boolean) => number,
): DisciplineEvent[] {
  const bans = (club.bans ??= {});
  const book = (club.cards ??= {});
  // suspensões cumpridas neste jogo: só as da mesma competição (e a legada '*')
  for (const key of [competitionId, ANY_COMPETITION]) {
    const m = bans[key];
    if (!m) continue;
    for (const pid of Object.keys(m)) bump(bans, key, pid, -1);
  }
  const out: DisciplineEvent[] = [];
  const reds = new Set(cards.filter((c) => c.color === 'red').map((c) => c.playerId));
  for (const pid of reds) {
    const secondYellow = cards.some((c) => c.playerId === pid && c.color === 'yellow');
    const games = redGames(pid, secondYellow);
    bump(bans, competitionId, pid, games);
    out.push({ playerId: pid, kind: 'red', games });
  }
  for (const c of cards) {
    if (c.color !== 'yellow' || reds.has(c.playerId)) continue;
    const n = yellowsIn(club, c.playerId, competitionId) + 1;
    if (n >= YELLOW_LIMIT) {
      bump(book, competitionId, c.playerId, -(n - 1));
      bump(bans, competitionId, c.playerId, 1);
      out.push({ playerId: c.playerId, kind: 'yellows', games: 1 });
    } else bump(book, competitionId, c.playerId, 1);
  }
  return out;
}

/** Move a disciplina de um jogador entre clubes (transferência: a suspensão acompanha o jogador). */
export function moveDiscipline(from: ClubSeasonState | undefined, to: ClubSeasonState | undefined, playerId: string): void {
  if (!from) return;
  for (const key of ['bans', 'cards'] as const) {
    const src = from[key];
    if (!src) continue;
    for (const comp of Object.keys(src)) {
      const v = src[comp][playerId];
      if (v === undefined) continue;
      bump(src, comp, playerId, -v);
      if (to) bump((to[key] ??= {}), comp, playerId, v);
    }
  }
}

/** Próximo jogo do clube (sem resultado, a partir da data atual) — mesma regra de `nextFixtureFor`. */
function nextFixtureOf(state: SeasonState, clubId: string): Fixture | null {
  let best: Fixture | null = null;
  for (const c of state.competitions) {
    for (const f of c.fixtures) {
      if (f.result || f.date < state.date) continue;
      if (f.homeId !== clubId && f.awayId !== clubId) continue;
      if (!best || f.date < best.date || (f.date === best.date && f.id < best.id)) best = f;
    }
  }
  return best;
}

/**
 * Competição do último jogo disputado pelo clube. Os saves antigos não guardavam onde o cartão saiu, mas a regra
 * antiga cumpria a suspensão no jogo seguinte de qualquer competição: uma suspensão ainda pendente nasceu, quase
 * sempre, no último jogo do clube.
 */
function lastPlayedCompetition(state: SeasonState, clubId: string): string | undefined {
  let best: Fixture | null = null;
  for (const c of state.competitions) {
    for (const f of c.fixtures) {
      if (!f.result || (f.homeId !== clubId && f.awayId !== clubId)) continue;
      if (!best || f.date > best.date || (f.date === best.date && f.id > best.id)) best = f;
    }
  }
  return best?.competitionId;
}

/**
 * Migração (idempotente) dos mapas antigos `suspensions`/`yellowCards` (por jogador, sem competição) para
 * `bans`/`cards` por competição. A competição de origem não era guardada; regra:
 *  1. a competição do ÚLTIMO jogo disputado pelo clube (a suspensão quase sempre nasceu ali) — se o clube ainda tem
 *     jogo dessa competição pela frente;
 *  2. senão, a competição do próximo jogo do clube;
 *  3. senão (sem jogos), '*' (qualquer competição).
 * Amarelos antigos seguem a mesma regra (sem jogo futuro: descartados). Devolve quantos clubes mudaram.
 */
export function migrateDiscipline(state: SeasonState): number {
  let changed = 0;
  for (const club of Object.values(state.clubs)) {
    const sus = club.suspensions ?? {};
    const yel = club.yellowCards ?? {};
    const hasSus = Object.values(sus).some((v) => typeof v === 'number' && v > 0);
    const hasYel = Object.values(yel).some((v) => typeof v === 'number' && v > 0);
    if (!hasSus && !hasYel) {
      if (Object.keys(sus).length || Object.keys(yel).length) { club.suspensions = {}; club.yellowCards = {}; changed++; }
      continue;
    }
    const next = nextFixtureOf(state, club.clubId);
    const last = lastPlayedCompetition(state, club.clubId);
    const lastHasMore = last !== undefined && state.competitions.some((c) => c.id === last && c.fixtures.some((f) => !f.result && f.date >= state.date && (f.homeId === club.clubId || f.awayId === club.clubId)));
    const target = lastHasMore ? last : next?.competitionId;
    const bans = (club.bans ??= {});
    const book = (club.cards ??= {});
    for (const [pid, g] of Object.entries(sus)) if (typeof g === 'number' && g > 0) bump(bans, target ?? ANY_COMPETITION, pid, g);
    if (target) for (const [pid, y] of Object.entries(yel)) if (typeof y === 'number' && y > 0) bump(book, target, pid, Math.min(y, YELLOW_LIMIT - 1));
    club.suspensions = {};
    club.yellowCards = {};
    changed++;
  }
  return changed;
}
