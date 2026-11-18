/**
 * Partida ONLINE (rota /partida no modo online). Reaproveita os componentes do Match Day
 * (LiveMatch, ChangesPanel, PostMatch) via MatchView; o estado vem dos ticks do servidor
 * — nada é simulado no cliente. Comandos vão por `match:command`.
 */
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { CalendarClock, ChevronRight, Hourglass, ListOrdered, Loader2, PauseCircle, Play, Radio, Swords, Timer, Volleyball } from 'lucide-react';
import type { Competition, Fixture, MatchCommand, Side } from '@cosmicfut/engine';
import { fmtDate } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { clubTable, competitionOf, upcomingFixtures } from '@/season/view';
import { compShort, fixtureInfo } from '@/season/comps';
import { useSeason, useSeasonState } from '@/store/season';
import { fixtureIndex, useOnline, useWaitingFor, type OnlineLiveMatch, type OnlinePreview } from '@/store/online';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ContinentalSeal } from '@/components/game/ContinentalSeal';
import { FixtureLine, StandingsTable, ZoneLegend, zonesIn } from '@/components/game/standings';
import { Bracket } from '@/pages/competitions/CompetitionsPage';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { ChangesButton, LiveMatch } from '@/pages/match/Live';
import { PostMatch } from '@/pages/match/PostMatch';
import { PreMatch } from '@/pages/match/PreMatch';
import { MatchViewProvider, type MatchView, type Scorer } from '@/pages/match/view';
import { Countdown, OtherGames } from './common';
import { LiveRoundButton } from './LiveRound';
import { ReadyButton } from './ReadyButton';

/** referência estável para o seletor (`?? []` no seletor criaria um array novo a cada leitura) */
const NO_PLAYERS: never[] = [];

export function OnlineMatchPage() {
  const live = useOnline((s) => s.live);
  const preview = useOnline((s) => s.matchPreview);
  // pré-jogo (match:preview): até o match:start do servidor
  if (preview && (!live || live.matchId !== preview.matchId)) return <OnlinePreMatch preview={preview} />;
  if (!live) return <NoLiveMatch />;
  if (live.phase === 'summary') return <OnlineRoundSummary live={live} />;
  const top = (
    <>
      <FixtureStrip live={live} />
      <VersusBar live={live} />
    </>
  );
  return (
    <OnlineMatchView live={live}>
      {live.phase === 'post' ? (
        <PostMatch top={top} />
      ) : (
        <LiveMatch top={top} controls={<OnlineControls live={live} />} aside={<PeekOthers excludeId={live.matchId} />} asideLabel="Outros" />
      )}
    </OnlineMatchView>
  );
}

/** (Rodada ao vivo) outros jogos: clicar abre a partida na Rodada ao vivo (espiar sem largar o controle do meu). */
function PeekOthers({ excludeId, title }: { excludeId?: string | null; title?: string }) {
  const navigate = useNavigate();
  const watch = useOnline((s) => s.watch);
  return (
    <OtherGames
      excludeId={excludeId}
      title={title}
      onPick={(id) => {
        watch(id);
        navigate('/rodada-ao-vivo');
      }}
    />
  );
}

/* ───────── pré-jogo online (match:preview) ───────── */

/**
 * Reaproveita o PreMatch do solo com o MatchConfig do servidor (escalações finais dos dois lados) e, no lugar do
 * "Começar partida", a contagem regressiva até o match:start (o servidor dá o apito em `startsAt`).
 */
function OnlinePreMatch({ preview }: { preview: OnlinePreview }) {
  const season = useSeasonState();
  const humanId = season.humanClubIds[0];
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const fixture = useMemo(
    () => fixtureIndex(season).get(preview.matchId) ?? ({ ...preview.fixture, group: undefined } as unknown as Fixture),
    [season, preview],
  );
  const side: Side = preview.side ?? (fixture.homeId === humanId ? 'home' : 'away');
  const preset = useMemo(() => ({ config: preview.config, humanSide: side }), [preview, side]);
  const pvp = !!preview.homePlayerId && !!preview.awayPlayerId;
  const oppId = side === 'home' ? preview.awayPlayerId : preview.homePlayerId;
  const opp = players.find((p) => p.playerId === oppId)?.nickname;
  return (
    <div>
      <VersusBar live={{ side, homePlayerId: preview.homePlayerId, awayPlayerId: preview.awayPlayerId, config: preview.config } as OnlineLiveMatch} />
      <PreMatch
        season={season}
        fixture={fixture}
        humanId={humanId}
        preset={preset}
        footer={<KickoffBar startsAt={preview.startsAt} note={pvp ? `Duelo contra ${opp ?? 'outro técnico'}: a partida é ao vivo para os dois.` : 'Partida ao vivo no servidor.'} />}
      />
    </div>
  );
}

function KickoffBar({ startsAt, note }: { startsAt: number; note: string }) {
  const total = useMemo(() => Math.max(1000, startsAt - Date.now()), [startsAt]);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-club-accent/40 bg-club-accent/10 px-4 py-3 sm:flex-row sm:items-center" role="status">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Timer className="size-4 text-club-accent" /> A bola rola em <Countdown at={startsAt} />
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{note} Escalações confirmadas; mudanças, só durante o jogo.</p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3 sm:w-48">
        <motion.div className="h-full rounded-full bg-club-accent" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: total / 1000, ease: 'linear' }} />
      </div>
    </div>
  );
}

/* ───────── competição / fase / ida e volta (match:start.fixture + config) ───────── */

export function FixtureStrip({ live }: { live: OnlineLiveMatch }) {
  const season = useSeason((s) => s.save?.season);
  const nf = live.fixture;
  const info = useMemo(() => {
    if (!season || !nf) return null;
    // a fixture da SeasonState (com stage/grupo) quando já chegou; senão a da rede (o snapshot pode atrasar)
    const f = fixtureIndex(season).get(nf.id) ?? ({ ...nf, group: undefined } as unknown as Fixture);
    return fixtureInfo(season, f);
  }, [season, nf]);
  if (!nf) return null;
  const rules = live.config;
  const continental = info?.comp?.type === 'continental';
  const first = info?.firstLeg;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-fg-muted">
      {continental && info?.comp && <ContinentalSeal compId={info.comp.id} size={18} title={info.comp.name} />}
      <span className="font-semibold text-fg">{info ? compShort(info.comp ?? ({ name: info.compName } as Competition)) : nf.competitionId}</span>
      <span aria-hidden>·</span>
      <span>{info?.phase ?? nf.label ?? `Rodada ${nf.round}`}</span>
      {info?.legLabel && <span className="rounded bg-club-accent/15 px-1.5 font-bold text-club-accent">{info.legLabel}</span>}
      {first?.result && (
        <span className="tabular rounded-md border border-line px-1.5">
          Ida: {clubLabel(first.homeId, true)} {first.result.home} x {first.result.away} {clubLabel(first.awayId, true)}
        </span>
      )}
      {rules.knockout && (
        <span className="rounded-md border border-warning/40 bg-warning/10 px-1.5 font-semibold text-warning">
          {rules.aggregate ? 'decide no agregado' : 'jogo decisivo'} · empate → {rules.extraTime ? 'prorrogação e pênaltis' : 'pênaltis'}
        </span>
      )}
      {nf.neutral && <span className="rounded-md border border-line px-1.5">campo neutro</span>}
    </div>
  );
}

/* ───────── adaptador useOnline → MatchView ───────── */

function OnlineMatchView({ live, children }: { live: OnlineLiveMatch; children: ReactNode }) {
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const me = useOnline((s) => s.playerId);
  const value = useMemo<MatchView>(() => {
    const o = useOnline.getState();
    const side = live.side;
    const pause = live.pause;
    const waiting = pause ? pause.waitingFor.filter((id) => id !== me).map((id) => players.find((p) => p.playerId === id)?.nickname ?? 'adversário') : [];
    const pvp = !!live.homePlayerId && !!live.awayPlayerId;
    let panelNote: ReactNode = null;
    if (pause) {
      panelNote = (
        <span className="flex items-center gap-1.5">
          <Hourglass className="size-3.5 text-warning" />
          {live.resumeSent ? (
            <>
              {pvp ? 'Aguardando adversário' : 'Aguardando'}
              {waiting.length ? ` (${waiting.join(', ')})` : ''} · volta em <Countdown at={pause.resumeAt} />
            </>
          ) : (
            <>
              Partida parada · volta sozinha em <Countdown at={pause.resumeAt} />
            </>
          )}
        </span>
      );
    }
    return {
      online: true,
      state: live.state,
      config: live.config,
      humanSide: side,
      feed: live.feed,
      batch: live.batch,
      panel: live.panel,
      toasts: live.toasts,
      result: live.result,
      getAppeared: () => appearedOf(live, side),
      getScorers: () => scorersOf(live),
      openPanel: o.openPanel,
      closePanel: o.closePanel,
      resume: () => void o.resumeMatch(),
      command: (cmd: MatchCommand) => o.command(cmd),
      toast: o.matchToast,
      dismissToast: o.dismissMatchToast,
      finish: o.toSummary,
      finishing: false,
      resumeLabel: pause && !live.resumeSent ? (pause.reason === 'half-time' ? 'Iniciar 2º Tempo' : 'Voltar ao jogo') : 'Voltar ao jogo',
      // (Atualização 38) selo do painel: pausado (intervalo/mudanças) ou seguindo (limite de pausas do tempo esgotado)
      pausedLabel: pause ? (pause.reason === 'half-time' ? 'Partida pausada' : 'Relógio parado') : 'Partida segue',
      resumeDisabled: !!pause && live.resumeSent,
      panelNote,
    };
  }, [live, players, me]);
  return <MatchViewProvider value={value}>{children}</MatchViewProvider>;
}

/** Quem já entrou em campo pelo lado: titulares + quem entrou nas substituições. */
export function appearedOf(live: OnlineLiveMatch, side: Side): string[] {
  const ids = new Set(live.config[side].lineup.starters);
  for (const e of live.state.events) if (e.type === 'substitution' && e.side === side && e.playerId) ids.add(e.playerId);
  return [...ids];
}

export function scorersOf(live: OnlineLiveMatch): Scorer[] {
  return live.state.events
    .filter((e) => (e.type === 'goal' || e.type === 'own-goal') && e.side && e.playerId)
    .map((e) => ({ side: e.side!, playerId: e.playerId!, minute: e.minute, ownGoal: e.type === 'own-goal' || undefined }));
}

/* ───────── VOCÊ x AMIGO ───────── */

function VersusBar({ live }: { live: OnlineLiveMatch }) {
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const pvp = !!live.homePlayerId && !!live.awayPlayerId;
  const label = (side: Side) => {
    const id = side === 'home' ? live.homePlayerId : live.awayPlayerId;
    if (side === live.side) return { tag: 'VOCÊ', nick: players.find((p) => p.playerId === id)?.nickname ?? '' };
    if (id) return { tag: 'AMIGO', nick: players.find((p) => p.playerId === id)?.nickname ?? 'Adversário' };
    return { tag: 'CPU', nick: clubLabel(live.config[side].clubId, true) };
  };
  const h = label('home');
  const a = label('away');
  const chip = (x: { tag: string; nick: string }, side: Side) => (
    <span className={cn('flex min-w-0 items-center gap-1.5', side === 'home' ? 'justify-end' : 'justify-start')}>
      {side === 'away' && <TagChip tag={x.tag} />}
      <span className="truncate text-xs font-semibold text-fg">{x.nick}</span>
      {side === 'home' && <TagChip tag={x.tag} />}
    </span>
  );
  return (
    <div className={cn('mb-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border px-3 py-1.5', pvp ? 'border-club-accent/40 bg-club-accent/10' : 'border-line bg-surface-2/50')}>
      {chip(h, 'home')}
      <span className="flex items-center gap-1 text-[10px] font-black tracking-[0.2em] text-fg-muted uppercase">
        {pvp ? <Swords className="size-3.5 text-club-accent" /> : null}
        {pvp ? 'PvP' : 'x'}
      </span>
      {chip(a, 'away')}
    </div>
  );
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-wider',
        tag === 'VOCÊ' ? 'bg-club-accent text-club-on-accent' : tag === 'AMIGO' ? 'bg-warning text-bg' : 'bg-surface-3 text-fg-muted',
      )}
    >
      {tag}
    </span>
  );
}

/* ───────── controles (sem relógio local) ───────── */

function OnlineControls({ live }: { live: OnlineLiveMatch }) {
  const resume = useOnline((s) => s.resumeMatch);
  const requestPause = useOnline((s) => s.requestPause);
  const openPanel = useOnline((s) => s.openPanel);
  const me = useOnline((s) => s.playerId);
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const pause = live.pause;
  const pvp = !!live.homePlayerId && !!live.awayPlayerId;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2/60 px-2.5 py-1 text-xs font-semibold text-fg-muted">
          <Radio className="size-3.5 text-danger" /> Ao vivo no servidor
        </span>
        {!pause && live.phase === 'live' && live.state.phase !== 'penalties' && (
          <Button variant="ghost" size="sm" onClick={() => void requestPause()} disabled={live.pauseRequested} title={pvp ? 'A partida para quando os dois pedirem' : 'Pausa a partida'}>
            <PauseCircle /> {live.pauseRequested ? (pvp ? 'Pausa pedida…' : 'Pausando…') : 'Pedir pausa'}
          </Button>
        )}
        <div className="ml-auto hidden lg:block">
          <ChangesButton />
        </div>
      </div>
      {pause && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          role="status"
        >
          <Hourglass className="size-4" />
          <span className="min-w-0 flex-1">
            <b>{pause.reason === 'half-time' ? 'Intervalo' : pause.reason === 'changes' ? (pause.by === me ? 'Pausa para mudanças' : `${players.find((p) => p.playerId === pause.by)?.nickname ?? 'Adversário'} está fazendo mudanças`) : 'Partida pausada'}</b>
            {live.resumeSent ? (pvp ? ' · aguardando adversário' : ' · aguardando') : ''} · volta em <Countdown at={pause.resumeAt} />
          </span>
          {pause.reason === 'half-time' && (
            <Button size="sm" variant="outline" onClick={() => openPanel('halftime')}>
              Mudanças
            </Button>
          )}
          {!live.resumeSent && (
            <Button size="sm" variant="club" onClick={() => void resume()}>
              <Play fill="currentColor" /> Voltar ao jogo
            </Button>
          )}
        </motion.div>
      )}
    </div>
  );
}

/* ───────── sem partida / resumo ───────── */

function NoLiveMatch() {
  const season = useSeasonState();
  const human = season.humanClubIds[0];
  const room = useOnline((s) => s.room);
  const waiting = useWaitingFor();
  const infoCount = useOnline((s) => Object.keys(s.infos).length);
  const next = upcomingFixtures(season, human, 1)[0];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="cf-card mt-6 p-8 text-center">
        {room?.phase === 'matchday' || room?.phase === 'simulating' ? (
          <>
            <Loader2 className="mx-auto size-10 animate-spin text-club-accent" />
            <h1 className="mt-4 text-xl font-extrabold">{room.phase === 'simulating' ? 'Simulando a rodada…' : 'Partidas em andamento'}</h1>
            <p className="mt-1 text-sm text-fg-muted">{room.phase === 'simulating' ? 'O servidor está avançando os dias até o próximo jogo.' : 'Seu clube não joga hoje — acompanhe os outros jogos.'}</p>
            {room.phase === 'matchday' && <LiveRoundButton className="mt-4" />}
          </>
        ) : (
          <>
            <CalendarClock className="mx-auto size-10 text-club-accent" />
            <h1 className="mt-4 text-xl font-extrabold">Sem partida agora</h1>
            <p className="mt-1 text-sm text-fg-muted">{fmtDate(season.date, { weekday: 'long', day: '2-digit', month: 'long' })}</p>
            {next && (
              <>
                <div className="mt-5 flex items-center justify-center gap-4">
                  <ClubCrest id={next.homeId} size={44} />
                  <span className="text-sm font-bold text-fg-muted">x</span>
                  <ClubCrest id={next.awayId} size={44} />
                </div>
                <p className="mt-2 text-sm">
                  <b>{clubLabel(next.homeId)}</b> x <b>{clubLabel(next.awayId)}</b>
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  Rodada {next.round} · {fmtDate(next.date, { weekday: 'short', day: '2-digit', month: 'short' })}
                </p>
              </>
            )}
            {room?.phase === 'planning' && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <ReadyButton size="lg" />
                {waiting.length > 0 && <p className="text-xs text-fg-muted">Aguardando: {waiting.join(', ')}</p>}
              </div>
            )}
            {room?.phase === 'season-end' && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <p className="text-sm text-fg-muted">A temporada terminou: renove os contratos para a virada.</p>
                <ReadyButton size="lg" />
              </div>
            )}
          </>
        )}
      </motion.div>
      {infoCount > 0 && (
        <div className="cf-card p-4">
          <PeekOthers title="Jogos da rodada" />
        </div>
      )}
    </div>
  );
}

/** Resumo da rodada online: resultados da divisão no dia do jogo e tabela atualizada. */
function OnlineRoundSummary({ live }: { live: OnlineLiveMatch }) {
  const navigate = useNavigate();
  const season = useSeasonState();
  const human = season.humanClubIds[0];
  const nf = live.fixture;
  // competição do jogo (liga, estadual, copa, continental); sem fixture (servidor antigo): a liga do clube
  const comp = (nf && season.competitions.find((c) => c.id === nf.competitionId)) ?? competitionOf(season, human);
  const closeLive = useOnline((s) => s.closeLive);
  const phase = useOnline((s) => s.room?.phase);
  const date = live.date ?? season.date;
  const games = (comp?.fixtures ?? []).filter((f) => f.date === date && (!nf?.stageId || f.stageId === nf.stageId));
  // o dia só é processado quando TODAS as partidas humanas terminam
  const processed = season.date > date;
  const round = games[0]?.round;
  const mine = nf ? fixtureIndex(season).get(nf.id) : undefined;
  const caption = mine ? fixtureInfo(season, mine).phase : null;
  const koStage = mine?.tieId && comp ? mine.stageId : undefined;
  const table = comp ? clubTable(comp, human) : null;
  const back = () => {
    closeLive();
    navigate(phase === 'season-end' ? '/fim-de-temporada' : '/dashboard');
  };
  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.07)} className="space-y-3">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cf-label text-club-accent">{comp?.name}</p>
          <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">{caption && comp?.format ? `Resumo · ${caption}` : `Resumo da rodada ${round ?? ''}`}</h1>
          <p className="text-xs text-fg-muted">{processed ? `${games.length} ${games.length === 1 ? 'jogo' : 'jogos'} nesta fase` : 'Aguardando as outras partidas terminarem…'}</p>
        </div>
        <Button variant="club" className="w-full sm:w-auto" onClick={back}>
          <ChevronRight /> {phase === 'season-end' ? 'Fim de temporada' : 'Voltar ao planejamento'}
        </Button>
      </motion.header>
      {!processed && (
        <motion.div variants={fadeUp} className="cf-card p-4">
          <PeekOthers title="Partidas em andamento" />
        </motion.div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <motion.div variants={fadeUp}>
          <Card className="h-full">
            <CardHeader icon={<Volleyball />} title="Resultados" subtitle={comp?.name} />
            <CardContent className="space-y-2">
              {games.map((f) => (
                <FixtureLine key={f.id} f={f} highlightId={human} />
              ))}
              {!games.length && <p className="text-sm text-fg-muted">Sem outros jogos desta fase neste dia.</p>}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeUp}>
          {comp && koStage ? (
            <Bracket comp={comp} stageId={koStage} human={human} />
          ) : comp && table ? (
            <Card>
              <CardHeader
                icon={<ListOrdered />}
                title={processed ? 'Classificação atualizada' : 'Classificação'}
                subtitle={table.label ? `${comp.name} · ${table.label}` : comp.name}
                action={<ZoneLegend comp={comp} zones={comp.format ? zonesIn(table.rows.length, table.zone) : undefined} />}
              />
              <CardContent className="px-2 sm:px-4">
                <StandingsTable comp={comp} rows={table.rows} zone={table.zone} highlightId={human} />
              </CardContent>
            </Card>
          ) : null}
        </motion.div>
      </div>
    </motion.div>
  );
}
