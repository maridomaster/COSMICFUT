/**
 * Bots de linha de comando: entram numa sala, escolhem um clube (livre ou no draft), jogam a vez (modo turnos) ou
 * marcam "pronto" (simultâneo), votam, reagem e renovam no fim de temporada. Servem para testar o online sem amigos.
 *
 *   node scripts/bot.ts --create [--start-when 2] [--speed 100]          cria sala (host) e imprime o código
 *   node scripts/bot.ts --code ABCDEF [--count 5] [--nick Robô]          entra numa sala existente (N bots)
 *
 * Opções: --url http://localhost:8787  --club <clubId>  --region EU|SA|SAU  --rounds <n>  --think <ms por vez>
 *         --vote yes|no|random  --chatty (manda mensagens/reações de vez em quando)
 *
 * (17/11) até 6 técnicos: `--count 5` sobe 5 bots num processo só (um socket cada).
 * Roda direto com `node apps/server/scripts/bot.ts` (registra o resolvedor de `.ts` da engine antes).
 */
import '../src/node-hooks.ts';
import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import type { RoomSummary, SeasonEndPayload } from '@cosmicfut/shared';
import type { Ack, ClientEvents, MatchPausePayload, MatchStartPayload, ServerEvents } from '../src/protocol.ts';

const { GameData } = await import('../src/data.ts');
const { DEFAULT_DATA_DIR } = await import('../src/config.ts');
const { bestAvailable } = await import('../src/lobby.ts');

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.COSMICFUT_URL ?? 'http://localhost:8787' },
    code: { type: 'string' },
    create: { type: 'boolean', default: false },
    nick: { type: 'string' },
    count: { type: 'string', default: '1' },
    club: { type: 'string' },
    region: { type: 'string' },
    speed: { type: 'string', default: '100' },
    'start-when': { type: 'string', default: '1' },
    rounds: { type: 'string', default: '0' },
    think: { type: 'string', default: '1500' },
    vote: { type: 'string', default: 'yes' },
    chatty: { type: 'boolean', default: false },
    data: { type: 'string', default: DEFAULT_DATA_DIR },
  },
});

if (!args.create && !args.code) {
  console.error('Use --create ou --code <CÓDIGO>. Ex.: node scripts/bot.ts --code ABCDEF --count 5');
  process.exit(1);
}

const data = new GameData(args.data!);
const NAMES = ['Robô Zagallo', 'Bot Telê', 'Andróide Parreira', 'Ciborgue Felipão', 'Chip Tite', 'Byte Guardiola', 'Pixel Klopp'];
const EU = ['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL'];
const regionOf = (leagueId: string | null) => {
  const c = (leagueId ?? '').split('-')[0];
  return c === 'ARS' ? 'SAU' : EU.includes(c) ? 'EU' : 'SA';
};
const clubName = (id: string | null) => (id ? data.club(id)?.name ?? id : '—');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const maxRounds = Number(args.rounds) || 0;
const startWhen = Number(args['start-when']) || 1;
const think = Number(args.think) || 0;
const sockets: Socket[] = [];

function runBot(nick: string, create: boolean, index: number): void {
  const sock: Socket<ServerEvents, ClientEvents> = io(args.url!, { transports: ['websocket'] });
  sockets.push(sock as unknown as Socket);
  const log = (...a: unknown[]) => console.log(`[${nick}]`, ...a);
  let me = '';
  let myClub: string | null = null;
  let lastReadyDate: string | null = null;
  let lastTurnKey = '';
  let lastVote = '';
  let rounds = 0;
  let picking = false;
  let lastSeasonEnd: SeasonEndPayload | null = null;

  const call = <T>(ev: string, ...a: unknown[]): Promise<Ack<T>> =>
    new Promise((res) => (sock.emit as (e: string, ...x: unknown[]) => void)(ev, ...a, res));

  /** clubes livres (qualquer região em escopo, ou só a pedida), dos mais fortes */
  const candidates = (room: RoomSummary): string[] => {
    const taken = new Set(room.players.map((p) => p.clubId).filter(Boolean));
    return data
      .playableEntries()
      .filter((c) => !taken.has(c.id) && (!args.region || regionOf(c.leagueId) === args.region) && (c.level ?? 0) >= 12)
      .map((c) => c.id);
  };

  const pickClub = async (room: RoomSummary, best = false) => {
    if (picking || myClub) return;
    picking = true;
    let list: string[];
    if (args.club && index === 0) list = [args.club];
    else if (best) {
      const taken = new Set(room.players.map((p) => p.clubId).filter((x): x is string => !!x));
      const b = bestAvailable(data.playableEntries(), taken);
      list = b ? [b.id] : [];
    } else list = candidates(room).sort(() => Math.random() - 0.5).slice(0, 10);
    for (const id of list) {
      const r = await call('room:pick-club', { clubId: id });
      if (r.ok) {
        myClub = id;
        log(`escolheu ${clubName(id)} (${id})`);
        break;
      }
    }
    picking = false;
  };

  const chat = (text: string) => args.chatty && void call('chat:send', { text });
  const react = () => args.chatty && Math.random() < 0.3 && void call('room:react', { emoji: ['⚽', '👏', '😂', '😡', '🔥', 'GG'][Math.floor(Math.random() * 6)] });

  sock.on('connect', async () => {
    if (me) return;
    if (create) {
      const r = await call<{ code: string; playerId: string }>('room:create', { nickname: nick, settings: { matchSpeedMs: Number(args.speed) } });
      if (!r.ok) {
        log('erro ao criar:', r.error);
        process.exit(1);
      }
      me = r.data.playerId;
      log(`sala criada: ${r.data.code}  (outros bots: node scripts/bot.ts --code ${r.data.code} --count 5)`);
    } else {
      const r = await call<{ playerId: string }>('room:join', { code: args.code, nickname: nick });
      if (!r.ok) {
        log('erro ao entrar:', r.error);
        return;
      }
      me = r.data.playerId;
      log(`entrou na sala ${args.code!.toUpperCase()}`);
      chat('Bora!');
    }
  });

  sock.on('room:state', async (room) => {
    const self = room.players.find((p) => p.playerId === me);
    if (!self) return;
    // votação: vota uma vez
    if (room.vote && room.vote.id !== lastVote && !room.vote.yes.includes(me) && !room.vote.no.includes(me)) {
      lastVote = room.vote.id;
      const yes = args.vote === 'random' ? Math.random() < 0.5 : args.vote !== 'no';
      await sleep(400 + Math.random() * 800);
      const r = await call('vote:cast', { id: room.vote.id, yes });
      log(`voto ${yes ? 'SIM' : 'NÃO'} (${room.vote.kind}${room.vote.until ? ` até ${room.vote.until}` : ''})${r.ok ? '' : ` — ${r.error}`}`);
    }
    if (room.phase === 'lobby') {
      const mode = room.settings.pickMode ?? 'free';
      if (!self.clubId && mode === 'free') await pickClub(room);
      // draft: na minha vez, depois de "pensar" um pouco, o melhor disponível
      if (mode === 'draft' && room.draft?.current === me && !myClub) {
        await sleep(Math.min(think, 4000));
        if (useRoomState.current?.draft?.current === me) await pickClub(room, true);
      }
      if (self.isHost && room.players.filter((p) => !p.spectator).length >= startWhen && room.players.every((p) => p.spectator || p.clubId)) {
        const r = await call('room:start');
        if (r.ok) log('temporada iniciada');
      }
      return;
    }
    if (self.clubId) myClub = self.clubId;
    if (room.phase === 'planning') {
      const turns = room.settings.turnMode !== 'simultaneous';
      if (turns) {
        const key = `${room.turn?.round}:${room.date}`;
        if (room.turn?.playerId === me && lastTurnKey !== key) {
          lastTurnKey = key;
          if (maxRounds && rounds >= maxRounds) {
            log(`fim após ${rounds} rodada(s)`);
            sock.disconnect();
            return;
          }
          log(`minha vez (rodada ${room.turn.round}, ${room.date})`);
          await sleep(think);
          if (Math.random() < 0.25) chat('Pensando na escalação...');
          react();
          const r = await call('turn:end');
          rounds++;
          log(r.ok ? 'concluí a vez' : `turn:end falhou: ${r.error}`);
        }
      } else if (!self.ready && lastReadyDate !== room.date) {
        lastReadyDate = room.date;
        if (maxRounds && rounds >= maxRounds) {
          log(`fim após ${rounds} rodada(s)`);
          sock.disconnect();
          return;
        }
        await sleep(Math.min(think, 3000));
        rounds++;
        await call('round:ready', { ready: true });
        log(`pronto (${room.date})`);
      }
    }
    if (room.phase === 'season-end' && !self.ready && lastSeasonEnd) {
      const mine = (myClub && lastSeasonEnd.expiring?.[myClub]) || [];
      const renew = Object.fromEntries(mine.filter((p) => p.age < 31).map((p) => [p.playerId, true as const]));
      const r = await call<{ accepted: number }>('season:renew', { renew, ready: true });
      log(r.ok ? `fim da temporada ${lastSeasonEnd.season}: ${r.data.accepted} renovação(ões)` : `season:renew falhou: ${r.error}`);
    }
  });
  const useRoomState: { current: RoomSummary | null } = { current: null };
  sock.on('room:state', (r) => (useRoomState.current = r));

  sock.on('match:start', (m: MatchStartPayload) => {
    const cfg = m.config as { home: { clubId: string }; away: { clubId: string } };
    log(`partida ${clubName(cfg.home.clubId)} x ${clubName(cfg.away.clubId)} — sou ${m.side ?? 'espectador'}`);
  });
  sock.on('match:pause', (p: MatchPausePayload) => {
    if (p.paused) setTimeout(() => void call('match:resume', { matchId: p.matchId }), p.reason === 'requested' ? 5000 : 500);
  });
  sock.on('match:end', ({ result }) => {
    const r = result as { homeGoals: number; awayGoals: number };
    log(`fim de jogo: ${r.homeGoals} x ${r.awayGoals}`);
    react();
  });
  sock.on('season:end', (e) => {
    if (e.stage === 'review') lastSeasonEnd = e;
    else log(`virada concluída: temporada ${e.season} encerrada`);
  });
  sock.on('skip:end', (e) => log(`salto terminou: ${e.reason}${e.note ? ` — ${e.note}` : ''}`));
  sock.on('error', (e) => log('erro do servidor:', e.code, e.message));
  sock.on('disconnect', (why) => log('desconectado:', why));
}

const count = Math.max(1, Math.min(6, Number(args.count) || 1));
for (let i = 0; i < count; i++) {
  const nick = count === 1 && args.nick ? args.nick : `${args.nick ?? NAMES[i % NAMES.length]}${count > 1 && args.nick ? ` ${i + 1}` : ''}`;
  runBot(nick, !!args.create && i === 0, i);
  await sleep(250);
}

process.on('SIGINT', () => {
  for (const s of sockets) s.disconnect();
  process.exit(0);
});
