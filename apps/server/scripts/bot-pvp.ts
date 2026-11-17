/**
 * Bot "adversário" para testar o PvP pela UI: entra numa sala, escolhe um clube da MESMA divisão
 * de outro jogador (ex.: o seu Palmeiras), marca pronto em toda rodada e, nas partidas PvP,
 * faz uma substituição e muda a postura no intervalo, demorando para voltar (a UI mostra
 * "Aguardando adversário").
 *
 *   node apps/server/scripts/bot-pvp.ts --code ABCDEF [--nick Rival] [--resume-delay 8000]
 *
 * Opções: --url http://localhost:8787  --club <clubId> (força o clube)  --rounds <n>
 *         --accept-ratio 1 (mercado: aceita propostas de humanos com valor ≥ ratio × valor do jogador; 0 = recusa todas)
 *
 * Mercado: quando outro humano faz proposta por um jogador do bot (oferta `pending` vinda de 'market:update'), o bot
 * responde sozinho com 'market:respond' — aceita se a proposta ≥ valor de mercado × accept-ratio, senão recusa.
 *
 * Roda direto com `node apps/server/scripts/bot-pvp.ts` (sem --import): registra o resolvedor de `.ts` da engine
 * antes de carregar o resto, como o src/start.ts. Também: `npm run bot:pvp --workspace @cosmicfut/server -- --code X`.
 */
import '../src/node-hooks.ts';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import type { MatchState, Side, TransferOffer } from '@cosmicfut/engine';
import type { MarketPatch, RoomSummary } from '@cosmicfut/shared';
import type { Ack, ClientEvents, MatchStartPayload, MatchTickPayload, ServerEvents } from '../src/protocol.ts';

// imports que carregam a engine (imports relativos sem extensão): só depois do hook registrado
const { GameData } = await import('../src/data.ts');
const { DEFAULT_DATA_DIR } = await import('../src/config.ts');

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.COSMICFUT_URL ?? 'http://localhost:8787' },
    code: { type: 'string' },
    nick: { type: 'string', default: 'Rival' },
    club: { type: 'string' },
    'resume-delay': { type: 'string', default: '8000' },
    rounds: { type: 'string', default: '0' },
    'accept-ratio': { type: 'string', default: '1' },
    data: { type: 'string', default: DEFAULT_DATA_DIR },
  },
});
if (!args.code) {
  console.error('Use --code <CÓDIGO>.');
  process.exit(1);
}

const data = new GameData(args.data!);
const sock: Socket<ServerEvents, ClientEvents> = io(args.url!, { transports: ['websocket'] });
const log = (...a: unknown[]) => console.log(`[${args.nick}]`, ...a);
const resumeDelay = Number(args['resume-delay']) || 0;
const maxRounds = Number(args.rounds) || 0;

let me = '';
let myClub: string | null = null;
let lastRoom: RoomSummary | null = null;
let rounds = 0;
let picking = false;
let readying = false;
const live = new Map<string, { side: Side; pvp: boolean; players: MatchState['players'] | null; acted: boolean; start: MatchStartPayload }>();

function call<T>(ev: string, ...a: unknown[]): Promise<Ack<T>> {
  return new Promise((res) => (sock.emit as (e: string, ...x: unknown[]) => void)(ev, ...a, res));
}
const clubName = (id: string | null) => (id ? (data.club(id)?.name ?? id) : '—');

/** Clubes livres da mesma divisão do clube de outro humano (ou da 1ª divisão do país). */
function candidates(room: RoomSummary): string[] {
  const taken = new Set(room.players.map((p) => p.clubId).filter(Boolean));
  const leagues = data.leagues().filter((d) => d.countryId === room.settings.countryId && d.clubIds.length >= 2 && d.clubIds.length <= 40);
  const other = room.players.find((p) => p.playerId !== me && p.clubId)?.clubId;
  const div = (other && leagues.find((d) => d.clubIds.includes(other))) || leagues.sort((a, b) => a.division - b.division)[0];
  return (div?.clubIds ?? []).filter((id) => !taken.has(id)).sort(() => Math.random() - 0.5);
}

async function onRoom(room: RoomSummary) {
  lastRoom = room;
  const self = room.players.find((p) => p.playerId === me);
  if (!self) return;
  if (room.phase === 'lobby' && !self.clubId && !picking) {
    picking = true;
    for (const id of args.club ? [args.club] : candidates(room)) {
      const r = await call('room:pick-club', { clubId: id });
      if (r.ok) {
        myClub = id;
        log(`escolheu ${clubName(id)} (${id})`);
        break;
      }
    }
    picking = false;
  }
  // sem trava por data: após um reinício do servidor a rodada volta ao planejamento do mesmo dia
  if (room.phase === 'planning' && !self.ready && !readying) {
    readying = true;
    if (maxRounds && rounds >= maxRounds) {
      log(`fim após ${rounds} rodada(s)`);
      process.exit(0);
    }
    await call('round:ready', { ready: true });
    readying = false;
    log(`pronto (${room.date})`);
  }
  // carreira: fim de temporada — só "pronto", sem season:renew (o servidor aplica a renovação automática)
  if (room.phase === 'season-end' && !self.ready && !readying) {
    readying = true;
    const r = await call('round:ready', { ready: true });
    readying = false;
    log(`fim de temporada: ${r.ok ? 'pronto para a virada' : r.error}`);
  }
}

let token = '';
sock.on('connect', async () => {
  if (me) {
    // reconexão (servidor reiniciou / rede): volta para a sala com o token
    const rj = await call('room:rejoin', { code: args.code, token });
    log('rejoin', rj.ok ? 'ok' : rj.error);
    return;
  }
  const r = await call<{ playerId: string; token: string }>('room:join', { code: args.code, nickname: args.nick });
  if (!r.ok) {
    log('erro ao entrar:', r.error);
    process.exit(1);
  }
  me = r.data.playerId;
  token = r.data.token;
  log(`entrou na sala ${args.code!.toUpperCase()}`);
  // o room:state da entrada chega antes do ack: processa o último recebido
  if (lastRoom) void onRoom(lastRoom);
});

sock.on('room:state', (room) => void onRoom(room));

sock.on('match:start', (m) => {
  const pvp = !!m.homePlayerId && !!m.awayPlayerId;
  const st = m.state as MatchState;
  live.set(m.matchId, { side: m.side ?? 'home', pvp, players: st.players, acted: false, start: m });
  const cfg = m.config as { home: { clubId: string }; away: { clubId: string } };
  log(`partida ${clubName(cfg.home.clubId)} x ${clubName(cfg.away.clubId)} — ${pvp ? 'PvP' : 'PvE'} (${m.side})`);
});

sock.on('match:tick', (t: MatchTickPayload) => {
  const l = live.get(t.matchId);
  if (l && t.players) l.players = t.players as MatchState['players'];
});

sock.on('match:pause', async (p) => {
  if (!p.paused) return;
  const l = live.get(p.matchId);
  if (l?.pvp && p.reason === 'half-time' && !l.acted && l.players) {
    l.acted = true;
    const mine = l.players[l.side];
    const cfg = l.start.config as Record<Side, { lineup: { starters: string[] } }>;
    const starters = new Set(cfg[l.side].lineup.starters);
    const out = [...mine].reverse().find((x) => x.onPitch && x.slotIndex !== null && x.slotIndex > 0);
    const inn = mine.find((x) => !x.onPitch && !x.sentOff && !starters.has(x.id));
    if (out && inn) {
      const r = await call('match:command', { matchId: p.matchId, command: { type: 'substitute', outId: out.id, inId: inn.id } });
      log('substituição', r.ok ? 'ok' : r.error);
    }
    const r2 = await call('match:command', { matchId: p.matchId, command: { type: 'set-tactic', tactic: { mentality: 'attacking', pressing: 'high' } } });
    log('postura', r2.ok ? 'ok' : r2.error);
    if (resumeDelay) {
      log(`voltando do intervalo em ${resumeDelay} ms`);
      await new Promise((r) => setTimeout(r, resumeDelay));
    }
  }
  void call('match:resume', { matchId: p.matchId });
});

sock.on('match:end', ({ matchId, result }) => {
  const r = result as { homeGoals: number; awayGoals: number };
  live.delete(matchId);
  rounds++;
  log(`fim de jogo: ${r.homeGoals} x ${r.awayGoals}`);
});
/* ── mercado: responde às propostas de outros humanos pelos jogadores do bot ── */
const acceptRatio = Number(args['accept-ratio'] ?? '1');
const answered = new Set<string>();
async function answerOffers(offers: TransferOffer[]) {
  const humans = new Set((lastRoom?.players ?? []).map((p) => p.clubId).filter(Boolean));
  const mine = lastRoom?.players.find((p) => p.playerId === me)?.clubId ?? myClub;
  for (const o of offers) {
    if (o.status !== 'pending' || o.fromClubId !== mine || !humans.has(o.toClubId) || answered.has(o.id)) continue;
    answered.add(o.id);
    const accept = acceptRatio > 0 && o.fee >= o.player.value * acceptRatio;
    const r = await call('market:respond', { offerId: o.id, accept });
    log(`proposta do ${o.toName} por ${o.player.name} (${o.fee} / valor ${o.player.value}): ${accept ? 'aceita' : 'recusada'}${r.ok ? '' : ` — ${r.error}`}`);
  }
}
sock.on('market:update', (u) => {
  try {
    const patch = JSON.parse(gunzipSync(u.patchGz as Uint8Array).toString('utf8')) as MarketPatch;
    void answerOffers((patch.market as { offers: TransferOffer[] }).offers ?? []);
  } catch (e) {
    log('market:update ilegível', String(e));
  }
});
sock.on('match:preview', (p) => log(`pré-jogo: bola rola em ${Math.round((p.startsAt - Date.now()) / 1000)} s`));

sock.on('error', (e) => log('erro do servidor:', e.code, e.message));
sock.on('disconnect', (why) => log('desconectado:', why));
process.on('SIGINT', () => {
  sock.disconnect();
  process.exit(0);
});
void myClub;
