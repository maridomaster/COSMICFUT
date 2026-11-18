/**
 * (Rodada ao vivo) Todos da sala assistem às partidas ao vivo dos humanos — espectadores, técnicos desempregados, quem
 * não joga no dia e quem já terminou o próprio jogo. Reaproveita o LiveMatch (mesma tela da partida) em modo SÓ
 * LEITURA: sem Mudanças, sem pausa, sem táticas. Quem joga continua com o controle total na /partida e pode espiar
 * os outros jogos aqui.
 *
 * Os ticks chegam em lote (~1 s) para a sala inteira; o store monta cada partida em `others` (ver store/online.ts).
 */
import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft, Eye, Hourglass, Play, Radio, Tv } from 'lucide-react';
import type { LiveMatchInfo } from '@cosmicfut/shared';
import type { Fixture } from '@cosmicfut/engine';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/format';
import { useSeason } from '@/store/season';
import { fixtureIndex, useOnline, type OnlineLiveMatch } from '@/store/online';
import { Button } from '@/components/ui/button';
import { FixtureLine } from '@/components/game/standings';
import { LiveMatch } from '@/pages/match/Live';
import { MatchViewProvider, type MatchView } from '@/pages/match/view';
import { Countdown, IndexCrest, OtherGames, STATUS_LABEL, useClubName } from './common';
import { appearedOf, FixtureStrip, scorersOf } from './OnlineMatchPage';

const NO_PLAYERS: never[] = [];
const noop = () => undefined;

/** Há partida humana rolando (ou para começar) no dia de jogo? */
export function useLiveRoundActive(): boolean {
  return useOnline((s) => s.room?.phase === 'matchday' && Object.values(s.infos).some((i) => i.status !== 'finished'));
}

/** Botão "▶ Rodada ao vivo" (barra do topo): aparece enquanto houver partidas ao vivo. */
export function LiveRoundButton({ className }: { className?: string }) {
  const active = useLiveRoundActive();
  const live = useOnline((s) => Object.values(s.infos).filter((i) => i.status === 'live' || i.status === 'half-time').length);
  const here = useLocation().pathname === '/rodada-ao-vivo';
  if (!active) return null;
  return (
    <Link
      to="/rodada-ao-vivo"
      aria-current={here ? 'page' : undefined}
      title="Assista às partidas ao vivo da rodada"
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#2563eb] px-3 text-sm font-bold text-white shadow-[0_6px_20px_-6px_#2563eb] transition-colors hover:bg-[#1d4ed8] focus-visible:ring-2 focus-visible:ring-[#93c5fd] focus-visible:outline-none',
        here && 'ring-2 ring-[#93c5fd]',
        className,
      )}
    >
      <Play className="size-4" fill="currentColor" aria-hidden />
      <span className="hidden sm:inline">Rodada ao vivo</span>
      <span className="sm:hidden">Ao vivo</span>
      {live > 0 && <span className="size-2 animate-pulse rounded-full bg-[#fca5a5]" aria-label={`${live} ao vivo`} />}
    </Link>
  );
}

/* ───────── página ───────── */

export function LiveRoundPage() {
  const navigate = useNavigate();
  const infos = useOnline((s) => s.infos);
  const others = useOnline((s) => s.others);
  const watching = useOnline((s) => s.watching);
  const watch = useOnline((s) => s.watch);
  const me = useOnline((s) => s.playerId);
  const phase = useOnline((s) => s.room?.phase);
  const myLive = useOnline((s) => s.live);
  const preview = useOnline((s) => s.matchPreview);

  const list = useMemo(() => sortInfos(Object.values(infos)), [infos]);
  const isMine = (m: LiveMatchInfo) => !!me && (m.homePlayerId === me || m.awayPlayerId === me);
  const watchable = list.filter((m) => !isMine(m));
  // a escolhida; senão a primeira que já tem imagem (ao vivo), senão a primeira de outro técnico
  const selectedId =
    (watching && infos[watching] && !isMine(infos[watching]) ? watching : null) ??
    watchable.find((m) => others[m.matchId] && m.status !== 'finished')?.matchId ??
    watchable.find((m) => others[m.matchId])?.matchId ??
    watchable[0]?.matchId ??
    null;
  const selected = selectedId ? others[selectedId] : undefined;
  const myMatch = list.find(isMine);
  const pick = (m: LiveMatchInfo) => {
    if (isMine(m)) navigate('/partida');
    else watch(m.matchId);
  };

  return (
    <div className="space-y-3">
      <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-2">
        <span className="grid size-9 place-items-center rounded-full bg-[#2563eb] text-white" aria-hidden>
          <Tv className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg leading-tight font-extrabold tracking-tight sm:text-xl">Rodada ao vivo</h1>
          <p className="text-xs text-fg-muted">
            {phase === 'matchday' ? 'Assista às partidas dos técnicos da sala — só para ver, sem mexer nos times.' : 'A rodada terminou. Os resultados ficam no calendário e nas competições.'}
          </p>
        </div>
        {myMatch && (myLive?.phase === 'live' || preview) && (
          <Button variant="club" size="sm" onClick={() => navigate('/partida')}>
            <Play fill="currentColor" /> Voltar ao meu jogo
          </Button>
        )}
      </motion.header>

      {/* abas: uma por partida humana do dia (placar e minuto) */}
      {list.length > 0 && (
        <div role="tablist" aria-label="Partidas ao vivo" className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {list.map((m) => (
            <MatchTab key={m.matchId} m={m} mine={isMine(m)} active={m.matchId === selectedId} onClick={() => pick(m)} />
          ))}
        </div>
      )}

      {!list.length ? (
        <EmptyRound />
      ) : selected ? (
        <WatchMatch key={selected.matchId} live={selected} onPick={(id) => pick(infos[id])} />
      ) : selectedId ? (
        <NotStarted info={infos[selectedId]} onPick={(id) => pick(infos[id])} />
      ) : (
        // só a minha partida hoje
        <div className="cf-card p-6 text-center">
          <p className="text-sm text-fg-muted">Hoje só a sua partida é de técnico humano.</p>
          <Button variant="club" className="mt-3" onClick={() => navigate('/partida')}>
            <Play fill="currentColor" /> Ir para o meu jogo
          </Button>
        </div>
      )}
    </div>
  );
}

function sortInfos(xs: LiveMatchInfo[]): LiveMatchInfo[] {
  const rank: Record<LiveMatchInfo['status'], number> = { live: 0, 'half-time': 0, pending: 1, finished: 2 };
  return xs.slice().sort((a, b) => rank[a.status] - rank[b.status] || a.matchId.localeCompare(b.matchId));
}

function MatchTab({ m, mine, active, onClick }: { m: LiveMatchInfo; mine: boolean; active: boolean; onClick: () => void }) {
  const name = useClubName();
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const nick = (id: string | null) => (id ? (players.find((p) => p.playerId === id)?.nickname ?? '') : '');
  const live = m.status === 'live';
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex w-[13.5rem] shrink-0 flex-col gap-1 rounded-xl border px-2.5 py-2 text-left transition-colors',
        active ? 'border-[#3b82f6] bg-[#2563eb]/15 ring-1 ring-[#3b82f6]/50' : 'border-line bg-surface-2/50 hover:border-[#3b82f6]/50',
      )}
    >
      <span className="flex items-center justify-between gap-1 text-[10px] font-bold tracking-wider uppercase">
        <span className={cn('flex items-center gap-1 rounded-full px-1.5', live ? 'bg-danger/20 text-danger' : 'bg-surface-3 text-fg-muted')}>
          {live && <span className="size-1.5 animate-pulse rounded-full bg-danger" />}
          {live ? `${m.minute}'` : STATUS_LABEL[m.status]}
        </span>
        {mine ? <span className="rounded-md bg-club-accent px-1.5 text-club-on-accent">Seu jogo</span> : <span className="flex items-center gap-1 text-fg-subtle"><Eye className="size-3" /> assistir</span>}
      </span>
      <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
        <span className="flex min-w-0 items-center justify-end gap-1 text-xs font-semibold">
          <span className="truncate">{name(m.homeClubId, true)}</span>
          <IndexCrest id={m.homeClubId} size={18} />
        </span>
        <span className="tabular rounded-md bg-black/30 px-1.5 text-sm font-black">
          {m.score.home}:{m.score.away}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs font-semibold">
          <IndexCrest id={m.awayClubId} size={18} />
          <span className="truncate">{name(m.awayClubId, true)}</span>
        </span>
      </span>
      <span className="flex justify-between gap-2 truncate text-[10px] text-fg-muted">
        <span className="truncate">{nick(m.homePlayerId) || 'CPU'}</span>
        <span className="truncate text-right">{nick(m.awayPlayerId) || 'CPU'}</span>
      </span>
    </button>
  );
}

/* ───────── partida assistida (LiveMatch só leitura) ───────── */

function WatchMatch({ live, onPick }: { live: OnlineLiveMatch; onPick: (matchId: string) => void }) {
  const value = useMemo<MatchView>(
    () => ({
      online: true,
      readOnly: true,
      state: live.state,
      config: live.config,
      humanSide: 'home',
      feed: live.feed,
      batch: live.batch,
      panel: null,
      toasts: [],
      result: live.result,
      getAppeared: () => appearedOf(live, 'home'),
      getScorers: () => scorersOf(live),
      openPanel: noop,
      closePanel: noop,
      resume: noop,
      command: async () => 'Você só está assistindo esta partida.',
      toast: noop,
      dismissToast: noop,
      finish: noop,
      finishing: false,
    }),
    [live],
  );
  const top = (
    <>
      <FixtureStrip live={live} />
      <WatchBar live={live} />
    </>
  );
  return (
    <MatchViewProvider value={value}>
      <LiveMatch top={top} controls={<WatchControls live={live} />} aside={<WatchAside currentId={live.matchId} onPick={onPick} date={live.date} />} asideLabel="Outros" />
    </MatchViewProvider>
  );
}

/** Técnicos de cada lado (sem "VOCÊ": aqui ninguém está no comando). */
function WatchBar({ live }: { live: OnlineLiveMatch }) {
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const name = useClubName();
  const who = (id: string | null, clubId: string) => (id ? (players.find((p) => p.playerId === id)?.nickname ?? 'Técnico') : `CPU · ${name(clubId, true)}`);
  return (
    <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-[#3b82f6]/40 bg-[#2563eb]/10 px-3 py-1.5 text-xs font-semibold">
      <span className="truncate text-right">{who(live.homePlayerId, live.config.home.clubId)}</span>
      <span className="flex items-center gap-1 text-[10px] font-black tracking-[0.2em] text-[#93c5fd] uppercase">
        <Eye className="size-3.5" /> só assistindo
      </span>
      <span className="truncate">{who(live.awayPlayerId, live.config.away.clubId)}</span>
    </div>
  );
}

function WatchControls({ live }: { live: OnlineLiveMatch }) {
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const pause = live.pause;
  const ended = live.phase !== 'live' || live.state.phase === 'finished';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2/60 px-2.5 py-1 text-xs font-semibold text-fg-muted">
        <Radio className={cn('size-3.5', ended ? 'text-fg-subtle' : 'text-danger')} /> {ended ? 'Fim de jogo' : 'Ao vivo · você está assistindo'}
      </span>
      {pause && !ended && (
        <span className="flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning" role="status">
          <Hourglass className="size-3.5" />
          {pause.reason === 'half-time' ? 'Intervalo' : pause.reason === 'changes' ? `${players.find((p) => p.playerId === pause.by)?.nickname ?? 'Técnico'} está fazendo mudanças` : 'Partida pausada'}
          {pause.resumeAt ? (
            <>
              {' '}
              · volta em <Countdown at={pause.resumeAt} />
            </>
          ) : null}
        </span>
      )}
    </div>
  );
}

function WatchAside({ currentId, onPick, date }: { currentId: string | null; onPick: (matchId: string) => void; date: string | null }) {
  return (
    <div className="space-y-3">
      <OtherGames title="Outros jogos (técnicos)" excludeId={currentId} onPick={onPick} />
      <DayFixtures date={date} />
    </div>
  );
}

/** Os demais jogos do dia (CPU x CPU) nas competições das partidas humanas: placar quando o dia fecha. */
function DayFixtures({ date }: { date: string | null }) {
  const season = useSeason((s) => s.save?.season);
  const infos = useOnline((s) => s.infos);
  const roomDate = useOnline((s) => s.room?.date ?? null);
  const day = date ?? roomDate;
  const games = useMemo(() => {
    if (!season || !day) return [] as Fixture[];
    const human = new Set(Object.keys(infos));
    const comps = new Set(Object.values(infos).map((i) => i.competitionId));
    const idx = fixtureIndex(season);
    const out: Fixture[] = [];
    for (const c of season.competitions) {
      if (comps.size && !comps.has(c.id)) continue;
      for (const f of c.fixtures) if (f.date === day && !human.has(f.id)) out.push(idx.get(f.id) ?? f);
    }
    return out.slice(0, 24);
  }, [season, day, infos]);
  if (!games.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Outros jogos do dia</h3>
      <div className="space-y-1.5">
        {games.map((f) => (
          <FixtureLine key={f.id} f={f} />
        ))}
      </div>
      {!games.some((f) => f.result) && <p className="mt-1.5 text-[11px] text-fg-subtle">Os placares saem quando as partidas ao vivo terminam.</p>}
    </div>
  );
}

function NotStarted({ info, onPick }: { info: LiveMatchInfo; onPick: (matchId: string) => void }) {
  const name = useClubName();
  const startsAt = useOnline((s) => s.matchPreview?.startsAt ?? null);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="cf-card p-6 text-center">
        <div className="flex items-center justify-center gap-4">
          <IndexCrest id={info.homeClubId} size={48} />
          <span className="text-sm font-bold text-fg-muted">x</span>
          <IndexCrest id={info.awayClubId} size={48} />
        </div>
        <p className="mt-2 text-sm">
          <b>{name(info.homeClubId)}</b> x <b>{name(info.awayClubId)}</b>
        </p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-fg-muted">
          <Hourglass className="size-3.5" />
          {info.status === 'finished' ? 'Partida encerrada.' : startsAt ? (
            <>
              A bola rola em <Countdown at={startsAt} />
            </>
          ) : (
            'A bola ainda não rolou — a transmissão começa no apito inicial.'
          )}
        </p>
      </div>
      <div className="cf-card p-3">
        <OtherGames title="Partidas da rodada" excludeId={info.matchId} onPick={onPick} />
      </div>
    </div>
  );
}

function EmptyRound() {
  const date = useOnline((s) => s.room?.date ?? null);
  return (
    <div className="cf-card mx-auto mt-4 max-w-lg p-8 text-center">
      <Tv className="mx-auto size-10 text-[#3b82f6]" />
      <h2 className="mt-3 text-lg font-extrabold">Nenhuma partida ao vivo agora</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Quando um técnico da sala entrar em campo{date ? ` (hoje é ${fmtDate(date, { day: '2-digit', month: 'short' })})` : ''}, o jogo aparece aqui para todos assistirem.
      </p>
      <Button asChild variant="outline" className="mt-4">
        <Link to="/sala">
          <ArrowLeft /> Voltar à sala
        </Link>
      </Button>
    </div>
  );
}
