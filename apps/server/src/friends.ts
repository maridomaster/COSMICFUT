/**
 * (17/11) Liga dos Amigos — ranking entre os técnicos humanos da sala, calculado pelo servidor (autoritativo).
 *
 * Pontos (somados em todas as temporadas da sala):
 *  - Liga: 20 × percentil da posição na liga principal (1º = 100%, último = 0%) × peso da divisão (1ª 1,0 · 2ª 0,6 · outras 0,4);
 *    a temporada em andamento conta pela posição atual.
 *  - Troféus: continental 30 · liga 1ª divisão 25 · liga 2ª 12 · copa nacional 15 · estadual 8 · supercopa 6 · outros 5.
 *  - Copas: 2 por mata-mata vencido.
 *  - Lucro: 1 ponto a cada 5 mi de saldo acima do inicial (limitado a −15…+15 por passagem).
 *  - Confronto direto entre humanos: vitória 3, empate 1.
 *
 * (Carreira online salva) Tudo é atribuído ao TÉCNICO (playerId) dono do clube no momento do fato — passagens
 * ("tenures"): quem troca de clube ou é demitido no meio da temporada leva a posição da liga no dia da saída (temporada
 * parcial), o lucro da passagem e os títulos/confrontos que conquistou; o técnico seguinte começa do zero no clube.
 * Registros antigos (sem playerId) valem para o dono atual do clube.
 */
import type { FriendsFeedItem, FriendsLeague, FriendsRow } from '@cosmicfut/shared';
import type { HumanClubInfo } from './sim-core.ts';

export interface FriendsTitle {
  clubId: string;
  season: number;
  id: string;
  name: string;
  type: string;
  division?: number;
  /** técnico que conquistou (ausente: registro antigo ⇒ dono atual do clube) */
  playerId?: string;
}

export interface H2HCell {
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
}

export interface FriendsSeason {
  clubId: string;
  season: number;
  pos: number;
  size: number;
  division: number;
  name: string;
  koWins: number;
  playerId?: string;
  /** passagem encerrada no meio da temporada (posição no dia da saída) */
  partial?: boolean;
}

export interface FriendsTenure {
  playerId: string;
  clubId: string;
  from: string | null;
  to: string | null;
}

/** Estado persistente da Liga dos Amigos (guardado na sala). */
export interface FriendsStore {
  /** saldo no início da passagem: chave `playerId@clubId` (antigo: clubId) */
  startBalance: Record<string, number>;
  /** temporadas já encerradas: posição final na liga e mata-matas vencidos */
  seasons: FriendsSeason[];
  titles: FriendsTitle[];
  /** confrontos por CLUBE (matriz exibida) */
  h2h: Record<string, Record<string, H2HCell>>;
  /** (carreira online) confrontos por TÉCNICO (pontos) */
  h2hP?: Record<string, Record<string, H2HCell>>;
  feed: FriendsFeedItem[];
  /** situação atual (último meta do simulador) */
  current: Record<string, HumanClubInfo>;
  season: number | null;
  /** (carreira online) passagens dos técnicos pelos clubes */
  tenures?: FriendsTenure[];
  /** (carreira online) lucro acumulado das passagens encerradas, por técnico (pontos já limitados) */
  profitBank?: Record<string, number>;
  /** (carreira online) lucro em € das passagens encerradas (exibição) */
  profitBankRaw?: Record<string, number>;
}

export const emptyFriends = (): FriendsStore => ({ startBalance: {}, seasons: [], titles: [], h2h: {}, h2hP: {}, feed: [], current: {}, season: null, tenures: [], profitBank: {}, profitBankRaw: {} });

const FEED_CAP = 80;
const DIV_WEIGHT = (d: number) => (d <= 1 ? 1 : d === 2 ? 0.6 : 0.4);
const tkey = (playerId: string, clubId: string) => `${playerId}@${clubId}`;

/** dono atual de cada clube (playerId), para atribuir fatos */
export type OwnerOf = (clubId: string) => string | null;

export function trophyWeight(t: { type: string; division?: number }): number {
  switch (t.type) {
    case 'continental':
      return 30;
    case 'league':
      return (t.division ?? 1) <= 1 ? 25 : 12;
    case 'cup':
      return 15;
    case 'state':
      return 8;
    case 'supercup':
      return 6;
    default:
      return 5;
  }
}

export const leaguePoints = (pos: number, size: number, division: number): number =>
  size > 1 ? 20 * (1 - (pos - 1) / (size - 1)) * DIV_WEIGHT(division) : 20 * DIV_WEIGHT(division);

export const profitPoints = (profit: number): number => Math.max(-15, Math.min(15, Math.round(profit / 5_000_000)));

export function pushFeed(f: FriendsStore, item: FriendsFeedItem): void {
  f.feed.unshift(item);
  if (f.feed.length > FEED_CAP) f.feed.length = FEED_CAP;
}

const addCell = (m: Record<string, Record<string, H2HCell>>, a: string, b: string, gf: number, ga: number) => {
  const c = ((m[a] ??= {})[b] ??= { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  c.gf += gf;
  c.ga += ga;
  if (gf > ga) c.w++;
  else if (gf < ga) c.l++;
  else c.d++;
};

/** Jogo entre dois humanos: matriz de confrontos + feed. */
export function recordH2H(f: FriendsStore, homeId: string, awayId: string, hg: number, ag: number, date: string | null, names: (clubId: string) => string, ownerOf?: OwnerOf): void {
  addCell(f.h2h, homeId, awayId, hg, ag);
  addCell(f.h2h, awayId, homeId, ag, hg);
  const hp = ownerOf?.(homeId);
  const ap = ownerOf?.(awayId);
  if (hp && ap) {
    f.h2hP ??= {};
    addCell(f.h2hP, hp, ap, hg, ag);
    addCell(f.h2hP, ap, hp, ag, hg);
  }
  const [win, lose, wg, lg] = hg >= ag ? [homeId, awayId, hg, ag] : [awayId, homeId, ag, hg];
  pushFeed(f, {
    at: Date.now(), date, kind: hg === ag ? 'draw' : 'win', clubIds: [homeId, awayId],
    text: hg === ag ? `${names(homeId)} e ${names(awayId)} empataram em ${hg} x ${ag}` : `${names(win)} venceu ${names(lose)} por ${wg} x ${lg}`,
  });
}

/** Atualiza com o meta novo do simulador: saldo inicial (1ª vez), títulos novos (feed) e situação atual. */
export function updateFromMeta(f: FriendsStore, humans: Record<string, HumanClubInfo> | undefined, season: number, date: string, names: (clubId: string) => string, ownerOf?: OwnerOf): boolean {
  if (!humans) return false;
  let titled = false;
  for (const [clubId, h] of Object.entries(humans)) {
    const owner = ownerOf?.(clubId) ?? null;
    const key = owner ? tkey(owner, clubId) : clubId;
    if (f.startBalance[key] === undefined) f.startBalance[key] = h.balance;
    for (const t of h.titles) {
      if (f.titles.some((x) => x.clubId === clubId && x.id === t.id && x.season === t.season)) continue;
      f.titles.push({ clubId, ...t, ...(owner ? { playerId: owner } : {}) });
      pushFeed(f, { at: Date.now(), date, kind: 'title', clubIds: [clubId], text: `${names(clubId)} foi campeão: ${t.name}!` });
      titled = true;
    }
  }
  f.current = humans;
  f.season = season;
  return titled;
}

/** Antes da virada: grava a posição final e as copas da temporada de cada humano. */
export function closeSeason(f: FriendsStore, season: number, ownerOf?: OwnerOf): void {
  for (const [clubId, h] of Object.entries(f.current)) {
    const owner = ownerOf?.(clubId) ?? undefined;
    if (f.seasons.some((s) => s.clubId === clubId && s.season === season && !s.partial && (s.playerId ?? undefined) === owner)) continue;
    f.seasons.push({
      clubId, season, pos: h.league?.pos ?? 0, size: h.league?.size ?? 0, division: h.league?.division ?? 9, name: h.league?.name ?? '', koWins: h.koWins,
      ...(owner ? { playerId: owner } : {}),
    });
  }
}

/** Começa uma passagem (início da carreira, contratação). */
export function startTenure(f: FriendsStore, playerId: string, clubId: string, date: string | null): void {
  f.tenures ??= [];
  if (f.tenures.some((t) => t.playerId === playerId && t.clubId === clubId && t.to === null)) return;
  f.tenures.push({ playerId, clubId, from: date, to: null });
  const cur = f.current[clubId];
  if (cur) f.startBalance[tkey(playerId, clubId)] = cur.balance;
  else delete f.startBalance[tkey(playerId, clubId)];
}

/**
 * Fecha a passagem (demissão, saída): a posição atual na liga vira uma temporada parcial do técnico e o lucro da
 * passagem vai para o "banco" dele.
 */
export function endTenure(f: FriendsStore, playerId: string, clubId: string, date: string | null): void {
  f.tenures ??= [];
  const t = f.tenures.find((x) => x.playerId === playerId && x.clubId === clubId && x.to === null);
  if (t) t.to = date;
  const cur = f.current[clubId];
  if (cur && f.season !== null) {
    f.seasons.push({
      clubId, season: f.season, pos: cur.league?.pos ?? 0, size: cur.league?.size ?? 0, division: cur.league?.division ?? 9,
      name: cur.league?.name ?? '', koWins: cur.koWins, playerId, partial: true,
    });
    const key = tkey(playerId, clubId);
    const start = f.startBalance[key] ?? f.startBalance[clubId];
    if (start !== undefined) {
      const profit = cur.balance - start;
      f.profitBank ??= {};
      f.profitBankRaw ??= {};
      f.profitBank[playerId] = (f.profitBank[playerId] ?? 0) + profitPoints(profit);
      f.profitBankRaw[playerId] = (f.profitBankRaw[playerId] ?? 0) + profit;
    }
    delete f.startBalance[key];
  }
}

/** Ranking + matriz + feed para os clientes. */
export function computeFriendsLeague(f: FriendsStore, players: { playerId: string; nickname: string; clubId: string | null; color?: string }[]): FriendsLeague {
  const owner = new Map<string, string>();
  for (const p of players) if (p.clubId) owner.set(p.clubId, p.playerId);
  const whoSeason = (s: { clubId: string; playerId?: string }) => s.playerId ?? owner.get(s.clubId) ?? null;
  const rows: FriendsRow[] = players.map((p) => {
    const cur = p.clubId ? f.current[p.clubId] : undefined;
    let league = 0;
    let cups = 0;
    for (const s of f.seasons) {
      if (whoSeason(s) !== p.playerId) continue;
      if (s.pos > 0) league += leaguePoints(s.pos, s.size, s.division);
      cups += 2 * s.koWins;
    }
    // temporada em andamento (se ainda não foi fechada) no clube atual
    if (cur && p.clubId && !f.seasons.some((s) => s.clubId === p.clubId && s.season === f.season && !s.partial && whoSeason(s) === p.playerId)) {
      if (cur.league) league += leaguePoints(cur.league.pos, cur.league.size, cur.league.division);
      cups += 2 * cur.koWins;
    }
    const titles = f.titles.filter((t) => whoSeason(t) === p.playerId);
    const trophies = titles.reduce((s, t) => s + trophyWeight(t), 0);
    const start = p.clubId ? (f.startBalance[tkey(p.playerId, p.clubId)] ?? f.startBalance[p.clubId]) : undefined;
    const curProfit = cur && start !== undefined ? cur.balance - start : 0;
    const profit = curProfit + (f.profitBankRaw?.[p.playerId] ?? 0);
    const profitPts = Math.max(-30, Math.min(30, profitPoints(curProfit) + (f.profitBank?.[p.playerId] ?? 0)));
    const h2h = { w: 0, d: 0, l: 0 };
    const byPlayer = f.h2hP?.[p.playerId];
    const cells = byPlayer ? Object.values(byPlayer) : !f.h2hP || !Object.keys(f.h2hP).length ? Object.values((p.clubId && f.h2h[p.clubId]) || {}) : [];
    for (const c of cells) {
      h2h.w += c.w;
      h2h.d += c.d;
      h2h.l += c.l;
    }
    const breakdown = {
      league: Math.round(league), trophies, cups, profit: profitPts, h2h: 3 * h2h.w + h2h.d,
    };
    const tenures = (f.tenures ?? []).filter((t) => t.playerId === p.playerId).map((t) => ({ clubId: t.clubId, from: t.from, to: t.to }));
    return {
      playerId: p.playerId, nickname: p.nickname, clubId: p.clubId, ...(p.color ? { color: p.color } : {}),
      ...(tenures.length ? { tenures } : {}),
      points: breakdown.league + breakdown.trophies + breakdown.cups + breakdown.profit + breakdown.h2h,
      breakdown,
      league: cur?.league ? { name: cur.league.name, pos: cur.league.pos, size: cur.league.size } : null,
      titles: titles.map((t) => ({ season: t.season, name: t.name })),
      profit,
      h2h,
    };
  });
  rows.sort((a, b) => b.points - a.points || b.breakdown.h2h - a.breakdown.h2h || a.nickname.localeCompare(b.nickname));
  const ids = new Set(players.map((p) => p.clubId).filter((x): x is string => !!x));
  const matrix: FriendsLeague['matrix'] = {};
  for (const a of ids) for (const b of ids) if (a !== b && f.h2h[a]?.[b]) (matrix[a] ??= {})[b] = { ...f.h2h[a][b] };
  return { rows, matrix, feed: f.feed.slice(0, 40), season: f.season };
}
