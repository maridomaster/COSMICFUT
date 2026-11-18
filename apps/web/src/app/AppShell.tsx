import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClubBundle } from '@cosmicfut/shared';
import { squadOf } from '@/data/squads';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { SkipCalendarModal, useSkipModal } from '@/pages/calendar/SkipCalendar';
import { AlertTriangle, Bell, CalendarClock, CalendarDays, ChevronRight, Database, FastForward, FolderOpen, Globe2, Loader2, LogOut, Menu, PlayCircle, Save, Sparkles, Trophy, Users, X } from 'lucide-react';
import { useGame, useViewClubId } from '@/store/game';
import { useSeason, useSeasonOver } from '@/store/season';
import { useMatch } from '@/store/match';
import { useIsOnline } from '@/store/mode';
import { useOnline } from '@/store/online';
import { ReadyButton } from '@/pages/online/ReadyButton';
import { LiveRoundButton } from '@/pages/online/LiveRound';
import { ChatDock, ConnectionBadge } from '@/pages/online/common';
import { TurnLayer, TurnStrip } from '@/pages/online/TurnLayer';
import { HotseatEndTurnButton, HotseatPassScreen, HotseatStrip, useHotseat } from '@/pages/hotseat/Hotseat';
import { hotseatAction } from '@/store/season';
import { SEASON_START, SEASON_YEAR } from '@/season/setup';
import { competitionOf, fixtureToday, humanSeasonLabel, upcomingFixtures, weekOf } from '@/season/view';
import { compShort, fixtureInfo } from '@/season/comps';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { useClubBundle, useLeagueMap } from '@/data/hooks';
import { indexCrestPaths, type DataOrigin } from '@/data/source';
import { applyClubTheme } from '@/lib/color';
import { fmtAgo, fmtDate } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/Logo';
import { Crest } from '@/components/game/Crest';
import { useEnsureLineup } from '@/data/useEnsureLineup';
import { Kbd, Tooltip } from '@/components/ui/tooltip';
import { ClubContext, useCurrentClub } from './ClubContext';
import { JOBLESS_ROUTES, NAV_ITEMS, ONLINE_JOBLESS_ROUTES } from './nav';
import { FiredOverlay } from '@/pages/coach/FiredOverlay';
import { useCoachCareer, usePendingJobCount, useUnemployed, useUnreadMail } from '@/pages/coach/shared';
import { Onboarding } from './Onboarding';
import { useSpaceShortcut } from './shortcuts';
import { useSettings } from '@/store/settings';
import { CurrencyToggle } from '@/components/game/CurrencyToggle';

export function AppShell() {
  const clubId = useGame((s) => s.clubId);
  const slotId = useGame((s) => s.slotId);
  const preview = useGame((s) => s.clubPreview);
  const resetGame = useGame((s) => s.resetGame);
  // (17/11) hot-seat: o elenco/tema do técnico ativo (o boot continua pelo clube do slot)
  const viewClubId = useViewClubId();
  const { data: bundle, origin, error, loading } = useClubBundle(viewClubId);
  const seasonStatus = useSeason((s) => s.status);
  const seasonError = useSeason((s) => s.error);
  const boot = useSeason((s) => s.boot);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  // (Etapa 4) moeda exibida (€/R$): trocar re-renderiza o app inteiro com a nova formatação
  const currency = useSettings((s) => s.currency);

  // Temporada: carrega o slot ativo do IndexedDB ou cria (carreira nova). Trocar de slot refaz o boot.
  useEffect(() => {
    if (clubId) void boot(clubId);
  }, [clubId, slotId, boot]);

  // Tema dinâmico: aplica já com o preview persistido e refina quando o bundle chega.
  const colors = bundle?.club.colors ?? preview?.colors ?? null;
  useEffect(() => {
    applyClubTheme(colors);
  }, [colors?.primary, colors?.secondary]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setDrawer(false), [location.pathname]);

  const online = useIsOnline();
  const session = useOnline((s) => s.session);
  const roomPhase = useOnline((s) => s.room?.phase);
  const spectator = useOnline((s) => !!s.room?.players.find((p) => p.playerId === s.playerId)?.spectator);
  // (Fase 3) técnico desempregado: só Central de Empregos, Caixa de Entrada, Meu Técnico, Histórico e Competições
  const unemployed = useUnemployed();
  const switching = useSeason((s) => s.switching);
  const jobless = unemployed && !(online ? ONLINE_JOBLESS_ROUTES : JOBLESS_ROUTES).includes(location.pathname);
  if (online) {
    if (!session) return <Navigate to="/online" replace />;
    if (roomPhase === 'lobby') return <Navigate to={`/online/${session.code}`} replace />;
    if (!clubId) return <OnlineConnecting code={session.code} />;
  }
  if (!clubId) return <Navigate to="/inicio" replace />;

  return (
    <div className="cf-backdrop min-h-dvh">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-line bg-surface/70 backdrop-blur-xl lg:block">
        <SidebarContent origin={origin} />
      </aside>

      {/* Drawer mobile */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] border-r border-line bg-surface lg:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
            >
              <button
                aria-label="Fechar menu"
                onClick={() => setDrawer(false)}
                className="absolute top-4 right-3 grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-5" />
              </button>
              <SidebarContent origin={origin} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-56">
        <Topbar onMenu={() => setDrawer(true)} />
        <main className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-5 sm:py-4 lg:px-6">
          {error ? (
            <LoadError onReset={resetGame} message={error.message} />
          ) : seasonStatus === 'unsupported' ? (
            <NoLeague onReset={resetGame} message={seasonError ?? ''} />
          ) : seasonStatus === 'legacy' ? (
            <LegacySave />
          ) : seasonStatus === 'legacy-career' ? (
            <LegacyCareer />
          ) : seasonStatus === 'error' ? (
            <LoadError onReset={resetGame} message={seasonError ?? 'erro ao criar a temporada'} />
          ) : !bundle || loading || switching ? (
            <ShellSkeleton />
          ) : seasonStatus !== 'ready' ? (
            <SeasonLoading />
          ) : jobless ? (
            <Navigate to={spectator ? '/sala' : '/empregos'} replace />
          ) : (
            <EffectiveClub bundle={bundle} origin={origin ?? 'fixture'}>
              <LineupKeeper />
              {!online && <Onboarding />}
              {!online && <SkipCalendarModal />}
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                >
                  {/* (Etapa 4) trocar a moeda remonta a página (formatação nova), sem animação de saída */}
                  <Fragment key={currency}>
                    <Outlet />
                  </Fragment>
                </motion.div>
              </AnimatePresence>
            </EffectiveClub>
          )}
        </main>
      </div>
      {online && <ChatDock />}
      {online && <TurnLayer />}
      {!online && <HotseatPassScreen />}
      {!online && <FiredOverlay />}
    </div>
  );
}

/** Online: conectado à sala, esperando a temporada (snapshot) chegar. */
function OnlineConnecting({ code }: { code: string }) {
  const navigate = useNavigate();
  const status = useOnline((s) => s.status);
  return (
    <div className="cf-backdrop grid min-h-dvh place-items-center px-4">
      <div className="cf-card w-full max-w-md p-8 text-center" aria-busy>
        <Loader2 className="mx-auto size-9 animate-spin text-club-accent" />
        <h2 className="mt-4 text-lg font-bold">Entrando na sala {code}…</h2>
        <p className="mt-1 text-sm text-fg-muted">{status === 'connected' ? 'Recebendo a temporada do servidor.' : 'Conectando ao servidor.'}</p>
        <Button variant="ghost" className="mt-5" onClick={() => navigate('/inicio')}>
          Menu inicial
        </Button>
      </div>
    </div>
  );
}

/**
 * Fornece o clube com o elenco EFETIVO da temporada (chegadas/saídas do mercado, salários novos).
 * A referência do array só muda quando o elenco muda de fato (ids/salários), não a cada dia simulado.
 */
function EffectiveClub({ bundle, origin, children }: { bundle: ClubBundle; origin: DataOrigin; children: ReactNode }) {
  const market = useSeason((s) => s.save?.season.market);
  // carreira: a SeasonState muda a cada operação; a assinatura do elenco decide se re-renderiza
  useSeason((s) => s.save?.season);
  const career = useSeason((s) => !!s.save?.world);
  const players = squadOf(bundle.club.id);
  const effectiveOn = !!(market || career);
  const sig = (effectiveOn ? players : bundle.players).map((p) => `${p.id}:${p.wage}:${p.overall}:${p.age}:${p.potential}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const effective = useMemo(() => (effectiveOn && players.length ? players : bundle.players), [sig, bundle]);
  const value = useMemo(() => ({ bundle: effective === bundle.players ? bundle : { ...bundle, players: effective }, origin }), [bundle, effective, origin]);
  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}

/** Monta a escalação automática assim que o elenco do clube carrega (ver useEnsureLineup). */
function LineupKeeper() {
  const { bundle } = useCurrentClub();
  useEnsureLineup(bundle.players);
  return null;
}

/** Ofertas recebidas pendentes pelo clube humano (badge do Mercado). */
export function useIncomingOffers(): number {
  return useSeason((s) => (s.save?.season.market?.offers ?? []).filter((o) => o.status === 'pending' && o.fromClubId === s.save!.clubId).length);
}

/** Há jogo do clube humano hoje (ainda não disputado)? */
function useMatchToday(): boolean {
  // (Fase 3) o clube humano é o da temporada (o técnico pode estar desempregado ou ter trocado de clube)
  return useSeason((s) => (s.save && s.save.season.humanClubIds[0] ? !!fixtureToday(s.save.season, s.save.season.humanClubIds[0]) : false));
}

function SidebarContent({ origin }: { origin: DataOrigin | undefined }) {
  const navigate = useNavigate();
  const preview = useGame((s) => s.clubPreview);
  const matchToday = useMatchToday();
  const incoming = useIncomingOffers();
  const online = useIsOnline();
  const liveOnline = useOnline((s) => !!s.live && s.live.phase === 'live');
  // (Fase 3) carreira do técnico
  const coach = useCoachCareer();
  const unemployed = useUnemployed();
  const unread = useUnreadMail();
  const jobOffers = usePendingJobCount();
  // (carreira online) a Central de Empregos também existe online (vagas, propostas, confiança da diretoria)
  const items = NAV_ITEMS.filter(
    (i) => (!i.online || online) && (!i.coach || !!coach || (online && i.to === '/empregos')) && (!unemployed || (online ? ONLINE_JOBLESS_ROUTES : JOBLESS_ROUTES).includes(i.to)),
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2" aria-label="Principal">
        <p className="cf-label px-3 pb-1.5">{unemployed ? 'Procurando emprego' : 'Gestão'}</p>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            data-tour={item.to.slice(1)}
            className={({ isActive }) =>
              cn(
                'group relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
                isActive ? 'text-fg' : 'text-fg-muted hover:bg-surface-2/70 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg border border-club-accent/25 bg-club-accent/10"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-club-accent" />}
                <item.icon className={cn('relative size-4', isActive ? 'text-club-accent' : 'text-fg-subtle group-hover:text-fg-muted')} />
                <span className="relative flex-1">{item.label}</span>
                {item.to === '/partida' && (online ? liveOnline : matchToday) && (
                  <span className="relative flex items-center gap-1 rounded-md bg-club-accent px-1.5 py-0.5 text-[9px] font-black tracking-wider text-club-on-accent uppercase">
                    <span className="size-1.5 animate-pulse rounded-full bg-current" /> hoje
                  </span>
                )}
                {item.to === '/mercado' && incoming > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    title={incoming === 1 ? '1 oferta recebida' : `${incoming} ofertas recebidas`}
                    className="tabular relative grid h-5 min-w-5 place-items-center rounded-full bg-club-accent px-1.5 text-[10px] font-black text-club-on-accent"
                  >
                    {incoming}
                  </motion.span>
                )}
                {((item.to === '/inbox' && unread > 0) || (item.to === '/empregos' && jobOffers > 0)) && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    title={item.to === '/inbox' ? `${unread} não lido(s)` : `${jobOffers} proposta(s)`}
                    aria-label={item.to === '/inbox' ? `${unread} e-mails não lidos` : `${jobOffers} propostas de emprego`}
                    className="tabular relative grid h-5 min-w-5 place-items-center rounded-full bg-club-accent px-1.5 text-[10px] font-black text-club-on-accent"
                  >
                    {item.to === '/inbox' ? unread : jobOffers}
                  </motion.span>
                )}
                {!item.ready && (
                  <span className="relative rounded-md border border-line px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-fg-subtle uppercase">
                    em breve
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-2 border-t border-line p-3">
        {preview && (
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2/50 p-2">
            <Crest path={indexCrestPaths(preview)} name={preview.name} colors={preview.colors} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{preview.name}</div>
              <div className="text-[11px] text-fg-subtle">{unemployed ? 'Seu último clube · desempregado' : coach ? coach.coach.name : 'Seu clube'}</div>
            </div>
          </div>
        )}
        {!online && <SaveStatus />}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-fg-subtle uppercase">Moeda</span>
          <CurrencyToggle compact />
        </div>
        {online ? (
          <OnlineRoomCard />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/carreiras')} data-tour="carreiras">
              <FolderOpen /> Carreiras
            </Button>
            <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/inicio')}>
              <Globe2 /> Jogar Online
            </Button>
          </div>
        )}
        {origin === 'fixture' && (
          <p className="flex items-center justify-center gap-1.5 text-[10px] text-fg-subtle" title="public/data ainda não disponível — usando fixture de desenvolvimento">
            <Database className="size-3" /> dados de fixture (dev)
          </p>
        )}
      </div>
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const preview = useGame((s) => s.clubPreview);
  const date = useSeason((s) => s.save?.season.date ?? SEASON_START);
  // (Etapa 1) rótulo da temporada da região do humano ("2026" ou "2026/27") e semana do ano
  const season = useSeason((s) => (s.save?.season ? humanSeasonLabel(s.save.season) : String(SEASON_YEAR)));
  const week = weekOf(date);
  const ready = useSeason((s) => s.status === 'ready');
  const advancing = useSeason((s) => s.advancing);
  const continueToMatch = useSeason((s) => s.continueToMatch);
  const matchPhase = useMatch((s) => s.phase);
  const matchToday = useMatchToday();
  const clubId = useGame((s) => s.clubId);
  const online = useIsOnline();
  const over = useSeasonOver();
  const simulateToEnd = useSeason((s) => s.simulateToEnd);
  const rolling = useSeason((s) => s.rolling);
  const unemployed = useUnemployed();
  const openSkip = useSkipModal((s) => s.show);
  const cancelSkip = useSeason((s) => s.cancelSkip);
  const onContinue = async () => {
    // (Fase 3) desempregado: avança até uma proposta/resposta (a virada do ano é automática)
    if (unemployed) {
      const r = await continueToMatch();
      if (r === 'job') navigate('/empregos');
      return;
    }
    if (over) {
      navigate('/fim-de-temporada');
      return;
    }
    // jogo em andamento ou dia de jogo: vai para o Match Day
    if (matchToday || matchPhase === 'live' || matchPhase === 'post') {
      navigate('/partida');
      return;
    }
    // resumo da rodada já visto: libera o Match Day para o próximo jogo
    if (matchPhase === 'done') useMatch.getState().reset();
    // (17/11) hot-seat: o último técnico da rodada conclui a vez e o dia avança para todos
    if (hotseat) {
      const last = hotseat.done.length >= hotseat.managers.length - 1;
      await hotseatAction('end-turn');
      if (!last) return; // (atalho Espaço fora do último técnico = concluir vez)
    }
    const r = await continueToMatch();
    if (r === 'matchday') navigate('/partida');
    else if (r === 'season-over') navigate('/fim-de-temporada');
  };
  const continueEnabled = ready && !advancing && !rolling && !online;
  const hotseat = useHotseat();
  const hotseatTurn = !!hotseat && !matchToday && !over && !unemployed && hotseat.done.length < hotseat.managers.length - 1;
  useSpaceShortcut(() => void onContinue(), continueEnabled);
  const onSimEnd = async () => {
    if (!window.confirm('DEV: simular até o fim da temporada (os jogos do seu clube também são simulados)?')) return;
    useMatch.getState().reset();
    await simulateToEnd();
    navigate('/fim-de-temporada');
  };
  const viewClubId = useViewClubId();
  const { data: bundle } = useClubBundle(viewClubId ?? clubId);
  const leagues = useLeagueMap();
  const club = bundle?.club;
  const mainComp = useSeason((s) => (s.save?.world ? competitionOf(s.save.season, s.save.season.humanClubIds[0] ?? s.save.clubId)?.name : undefined));
  const spectator = useOnline((s) => !!s.room?.players.find((p) => p.playerId === s.playerId)?.spectator);
  const subtitle = online && spectator ? 'Espectador — assiste às partidas e conversa' : unemployed ? 'Sem clube — procurando emprego' : undefined;
  const league = club?.leagueId ? leagues.get(club.leagueId) : undefined;
  // (carreira online) desempregado: o clube da visão é só referência de tema
  const name = online && spectator ? 'Espectador' : online && unemployed ? 'Sem clube' : (club?.name ?? preview?.name ?? '');
  const colors = club?.colors ?? preview?.colors ?? { primary: '#555', secondary: '#999' };
  // (Atualização 41) altura real do topo (faixas de turno/aviso mudam a altura) → --topbar-h para os elementos sticky
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header ref={headerRef} className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
      {/* filete superior nas cores do clube */}
      <div className="h-[2px] w-full bg-linear-to-r from-club-primary via-club-accent to-club-secondary opacity-80" />
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-3 sm:px-5 lg:px-6">
        <button
          aria-label="Abrir menu"
          onClick={onMenu}
          className="-ml-1 grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Crest path={club ? [club.crest, club.crestMini].filter((p): p is string => !!p) : preview ? indexCrestPaths(preview) : null} name={name} colors={colors} size={32} className="drop-shadow-[0_0_10px_color-mix(in_oklab,var(--club-primary)_45%,transparent)]" />
          <div className="min-w-0">
            <div className="truncate text-[15px] leading-tight font-bold tracking-tight">{name}</div>
            <div className="hidden truncate text-xs text-fg-muted sm:block">
              {subtitle ?? mainComp ?? (league ? `${league.name} · ${league.divisionName}` : 'Temporada ' + season)}
            </div>
          </div>
          {!subtitle && <NextMatchChip />}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1">
            <CalendarDays className="size-4 text-club-accent" />
            <div className="leading-tight">
              <div className="cf-label hidden sm:block">{ready ? `Temporada ${season} · Sem. ${week}` : 'Carregando…'}</div>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={ready ? date : 'loading'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="tabular text-xs font-semibold whitespace-nowrap sm:text-sm"
                >
                  {ready ? (
                    <>
                      {fmtDate(date, { day: '2-digit', month: 'short' })}
                      <span className="hidden sm:inline"> {date.slice(0, 4)}</span>
                    </>
                  ) : (
                    <span className="inline-block h-3 w-16 animate-pulse rounded bg-surface-3" aria-hidden />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          {online ? (
            <>
              <LiveRoundButton />
              <ReadyButton showWaiting />
            </>
          ) : (
          <>
            {import.meta.env.DEV && !over && !unemployed && (
              <Button variant="ghost" size="sm" onClick={onSimEnd} disabled={!ready || !!advancing || rolling} className="hidden px-2 text-[11px] text-fg-subtle md:inline-flex" title="Somente em desenvolvimento: simula até o fim da temporada">
                <FastForward /> dev: fim
              </Button>
            )}
            <Tooltip content="Calendário: pular para qualquer data (o assistente comanda o time)">
              <Button
                variant="outline"
                onClick={() => openSkip()}
                disabled={!ready || !!advancing || rolling}
                className="px-2.5"
                aria-label="Pular no tempo (calendário)"
                data-tour="skip"
              >
                <CalendarClock />
                <span className="hidden lg:inline">Pular</span>
              </Button>
            </Tooltip>
            {hotseatTurn ? (
              <HotseatEndTurnButton />
            ) : (
            <Tooltip
              content={
                <span className="flex items-center gap-1.5">
                  {unemployed ? 'Avançar até chegar uma proposta ou resposta' : over ? 'Ver o fim de temporada' : matchToday ? 'Ir para o jogo de hoje' : 'Avançar até o próximo jogo'} <Kbd>Espaço</Kbd>
                </span>
              }
            >
              <Button
                variant="club"
                onClick={onContinue}
                disabled={!continueEnabled}
                className="relative px-3 sm:px-4"
                aria-label={unemployed ? 'Continuar' : over ? 'Fim de temporada' : matchToday ? 'Ir para a partida' : 'Continuar'}
                aria-keyshortcuts="Space"
                data-tour="continue"
              >
                {advancing ? <Loader2 className="animate-spin" /> : unemployed ? null : over ? <Trophy /> : matchToday ? <PlayCircle /> : null}
                <span className="hidden sm:inline">{advancing ? 'Simulando…' : unemployed ? 'Continuar' : over ? 'Fim de temporada' : matchToday ? 'Jogar' : 'Continuar'}</span>
                {!advancing && (unemployed || (!matchToday && !over)) && <ChevronRight />}
              </Button>
            </Tooltip>
            )}
          </>
          )}
        </div>
      </div>
      {online && <TurnStrip />}
      {!online && <HotseatStrip />}
      {/* progresso do Continuar (dia a dia até o próximo jogo) */}
      <AnimatePresence>
        {advancing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-line bg-surface/80"
            role="status"
            aria-live="polite"
          >
            <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-1 text-[11px] text-fg-muted sm:px-5 lg:px-6">
              <span className="tabular shrink-0 font-semibold text-fg">{fmtDate(advancing.date, { day: '2-digit', month: 'short' })}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  className="h-full rounded-full bg-linear-to-r from-club-primary to-club-accent"
                  animate={{ width: `${Math.round((advancing.day / Math.max(1, advancing.total)) * 100)}%` }}
                  transition={{ duration: 0.12 }}
                />
              </div>
              {advancing.skip ? (
                <>
                  <span className="tabular shrink-0">
                    até {fmtDate(advancing.skip.until, { day: '2-digit', month: 'short', year: 'numeric' })} · {Math.round((advancing.day / Math.max(1, advancing.total)) * 100)}%
                  </span>
                  <button type="button" className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => openSkip()}>
                    Detalhes
                  </button>
                  <button type="button" className="shrink-0 font-semibold text-danger hover:underline" onClick={() => cancelSkip()}>
                    Cancelar
                  </button>
                </>
              ) : (
                <span className="tabular shrink-0">
                  {advancing.toEnd ? 'temporada · ' : ''}dia {advancing.day}/{advancing.total}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <StopStrip />
      {!online && <SaveErrorStrip />}
    </header>
  );
}

/** Sidebar (solo): "salvo há X min" + "Salvar agora". */
/** Ao lado do nome do clube: sempre o próximo jogo (adversário, casa/fora, competição/fase e data). */
function NextMatchChip() {
  const season = useSeason((s) => s.save?.season);
  const clubId = useSeason((s) => s.save?.season.humanClubIds[0] ?? s.save?.clubId);
  const navigate = useNavigate();
  const next = useMemo(() => {
    if (!season || !clubId) return null;
    const f = upcomingFixtures(season, clubId, 1)[0];
    if (!f) return null;
    const home = f.homeId === clubId;
    const info = fixtureInfo(season, f);
    const comp = info.comp ? compShort(info.comp) : info.compName;
    return { f, home, opp: home ? f.awayId : f.homeId, comp, phase: info.phase, today: f.date === season.date };
  }, [season, clubId]);
  if (!next) return null;
  return (
    <button
      type="button"
      data-testid="next-match-chip"
      onClick={() => navigate('/calendario')}
      title={`Próximo jogo: ${clubLabel(next.opp)} (${next.home ? 'casa' : 'fora'}) · ${next.comp} · ${next.phase}`}
      className="ml-1 hidden min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1 text-left transition-colors hover:border-club-accent/60 md:flex"
    >
      <ClubCrest id={next.opp} size={24} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[11px] text-fg-muted">
          <span className={cn('font-semibold', next.today ? 'text-club-accent' : 'text-fg-muted')}>{next.today ? 'Hoje' : fmtDate(next.f.date, { day: '2-digit', month: 'short' })}</span>
          {' · '}
          {next.home ? 'Casa' : 'Fora'}
        </div>
        <div className="max-w-[300px] truncate text-xs font-semibold">
          x {clubLabel(next.opp)}
          <span className="font-normal text-fg-muted"> · {next.comp}{next.phase ? ` · ${next.phase}` : ''}</span>
        </div>
      </div>
    </button>
  );
}

function SaveStatus() {
  const lastSavedAt = useSeason((s) => s.lastSavedAt);
  const saving = useSeason((s) => s.saving);
  const ready = useSeason((s) => s.status === 'ready');
  const busy = useSeason((s) => !!s.advancing || s.rolling);
  const saveNow = useSeason((s) => s.saveNow);
  const failed = useSeason((s) => !!s.saveError);
  const now = useNow(20_000);
  const [flash, setFlash] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1">
      {failed ? <AlertTriangle className="size-3.5 shrink-0 text-warning" /> : <Save className="size-3.5 shrink-0 text-fg-subtle" />}
      <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted" role="status" aria-live="polite" title={lastSavedAt ? new Date(lastSavedAt).toLocaleString('pt-BR') : undefined}>
        {failed ? 'Falha ao salvar' : flash ? 'Salvo!' : lastSavedAt ? `Salvo ${fmtAgo(lastSavedAt, now)}` : 'Ainda não salvo'}
      </span>
      <button
        type="button"
        disabled={!ready || saving || busy}
        onClick={async () => {
          if (await saveNow()) {
            setFlash(true);
            setTimeout(() => setFlash(false), 1500);
          }
        }}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-club-accent hover:bg-club-accent/10 disabled:opacity-40"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Salvar agora'}
      </button>
    </div>
  );
}

/** Falha ao gravar no IndexedDB (quota): mensagem amigável + caminho para exportar/excluir. */
function SaveErrorStrip() {
  const err = useSeason((s) => s.saveError);
  const dismiss = useSeason((s) => s.dismissSaveError);
  const navigate = useNavigate();
  if (!err) return null;
  return (
    <div className="border-t border-warning/40 bg-warning/10" role="alert">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-1 text-xs sm:px-5 lg:px-6">
        <AlertTriangle className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          <b className="font-semibold">{err.quota ? 'Sem espaço para salvar' : 'Não foi possível salvar'}:</b>{' '}
          {err.quota ? 'o armazenamento deste navegador está cheio. Exporte carreiras que não usa para arquivo e exclua-as.' : err.message}
        </span>
        <button className="shrink-0 font-semibold text-warning hover:underline" onClick={() => navigate('/carreiras')}>
          Carreiras
        </button>
        <button aria-label="Fechar aviso" className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:text-fg" onClick={dismiss}>
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Por que o Continuar parou (título, oferta recebida…). */
function StopStrip() {
  const stop = useSeason((s) => s.lastStop);
  const dismiss = useSeason((s) => s.dismissStop);
  const navigate = useNavigate();
  const unemployed = useUnemployed();
  if (!stop?.note) return null;
  return (
    <div className="border-t border-line bg-club-accent/10" role="status" aria-live="polite">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-1 text-xs sm:px-5 lg:px-6">
        <Bell className="size-3.5 shrink-0 text-club-accent" />
        <span className="min-w-0 flex-1 truncate">
          <b className="font-semibold">
            {stop.reason === 'skip' ? 'Calendário' : stop.reason === 'offer' ? 'Proposta recebida' : stop.reason === 'news' ? 'Notícia importante' : stop.reason === 'migrated' || stop.reason === 'coach' ? 'Save atualizado' : stop.reason === 'job' ? 'Emprego' : 'Aviso'}:
          </b>{' '}
          {stop.note}
        </span>
        {stop.reason === 'skip' && stop.skip === 'season-end' && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/fim-de-temporada'); }}>
            Fim de temporada
          </button>
        )}
        {stop.reason === 'skip' && stop.skip === 'offer' && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/mercado?tab=recebidas'); }}>
            Ver proposta
          </button>
        )}
        {stop.reason === 'skip' && (stop.skip === 'done' || stop.skip === 'cancelled') && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/historico'); }}>
            Histórico
          </button>
        )}
        {(stop.reason === 'job' || (stop.reason === 'skip' && stop.skip === 'job') || (stop.reason === 'limit' && unemployed)) && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/empregos'); }}>
            Central de Empregos
          </button>
        )}
        {stop.reason === 'coach' && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/tecnico'); }}>
            Meu Técnico
          </button>
        )}
        {stop.reason === 'migrated' && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/competicoes?cat=continental'); }}>
            Saiba mais
          </button>
        )}
        {stop.reason === 'offer' && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/mercado?tab=recebidas'); }}>
            Ver
          </button>
        )}
        {stop.reason === 'news' && (
          <button className="shrink-0 font-semibold text-club-accent hover:underline" onClick={() => { dismiss(); navigate('/competicoes'); }}>
            Competições
          </button>
        )}
        <button aria-label="Fechar aviso" className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:text-fg" onClick={dismiss}>
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SeasonLoading() {
  const p = useSeason((s) => s.bootProgress);
  const label = !p ? 'Abrindo o save…' : p.stage === 'elencos' ? 'Carregando elencos de todos os clubes' : p.stage === 'calendário' ? 'Montando o calendário real: Europa, América do Sul e Arábia' : 'Lendo competições e calendário';
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="cf-card mx-auto mt-10 max-w-md p-8 text-center" aria-busy>
      <Loader2 className="mx-auto size-9 animate-spin text-club-accent" />
      <h2 className="mt-4 text-lg font-bold">Preparando a temporada</h2>
      <p className="mt-1 text-sm text-fg-muted">{label}</p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-3">
        <motion.div className="h-full rounded-full bg-club-accent" animate={{ width: `${pct}%` }} transition={{ duration: 0.2 }} />
      </div>
      {p && p.total > 1 && (
        <p className="tabular mt-2 text-xs text-fg-subtle">
          {p.done}/{p.total}
        </p>
      )}
    </div>
  );
}

/** Save antigo (v1, só a liga): aviso amigável + carreira nova com o mesmo clube. */
function LegacySave() {
  const navigate = useNavigate();
  const startFresh = useSeason((s) => s.startFresh);
  const preview = useGame((s) => s.clubPreview);
  const [busy, setBusy] = useState(false);
  return (
    <div className="cf-card mx-auto mt-10 max-w-lg p-8 text-center">
      <Sparkles className="mx-auto size-10 text-club-accent" />
      <h2 className="mt-4 text-lg font-bold">A carreira ficou muito maior</h2>
      <p className="mt-2 text-sm text-fg-muted">
        Agora a temporada tem estaduais, Copa do Brasil, Supercopa, Séries A a D e a virada de ano, com acesso, rebaixamento, contratos e juniores.
        O seu save é de uma versão anterior, que só tinha a liga, e não pode ser convertido.
      </p>
      <p className="mt-2 text-xs text-fg-subtle">Ao começar, o save antigo é apagado deste navegador.</p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Button
          variant="club"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await startFresh();
            setBusy(false);
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <PlayCircle />} Nova carreira{preview ? ` com o ${preview.name}` : ''}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => navigate('/novo-jogo')}>
          Escolher outro clube
        </Button>
      </div>
    </div>
  );
}

/**
 * (Etapa 1) Carreira de uma versão anterior (ano civil centrado num país): não migra para a linha do tempo global.
 * O slot continua na lista de carreiras (exportar/excluir); o jogador começa uma nova.
 */
function LegacyCareer() {
  const navigate = useNavigate();
  return (
    <div className="cf-card mx-auto mt-10 max-w-lg p-8 text-center" data-testid="legacy-career">
      <Sparkles className="mx-auto size-10 text-club-accent" />
      <h2 className="mt-4 text-lg font-bold">Carreira legado — iniciar nova carreira</h2>
      <p className="mt-2 text-sm text-fg-muted">
        O mundo do jogo mudou: agora Europa, América do Sul e Arábia Saudita rodam juntas num calendário real, com a
        temporada europeia de agosto a maio e a sul-americana de janeiro a dezembro. Esta carreira é de uma versão
        anterior e não pode ser convertida.
      </p>
      <p className="mt-2 text-xs text-fg-subtle">Ela continua salva: em Carreiras dá para exportá-la para arquivo ou excluí-la.</p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Button variant="club" onClick={() => navigate('/novo-jogo')}>
          <PlayCircle /> Nova carreira
        </Button>
        <Button variant="outline" onClick={() => navigate('/carreiras')}>
          Ver carreiras
        </Button>
      </div>
    </div>
  );
}

function NoLeague({ message, onReset }: { message: string; onReset: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="cf-card mx-auto mt-10 max-w-md p-8 text-center">
      <AlertTriangle className="mx-auto size-10 text-warning" />
      <h2 className="mt-4 text-lg font-bold">Sem competição nesta versão</h2>
      <p className="mt-1 text-sm text-fg-muted">{message}. Escolha um clube que dispute uma liga nacional ou um estadual para começar a carreira.</p>
      <Button
        variant="club"
        className="mt-6"
        onClick={() => {
          // exclui o slot sem competição (lê o slot ativo antes do reset)
          void useSeason.getState().discard();
          onReset();
          navigate('/novo-jogo');
        }}
      >
        Escolher outro clube
      </Button>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <div className="h-44 animate-shimmer rounded-[var(--radius-card)] bg-[linear-gradient(90deg,var(--color-surface)_0%,var(--color-surface-2)_50%,var(--color-surface)_100%)] bg-[length:200%_100%]" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 animate-shimmer rounded-[var(--radius-card)] bg-[linear-gradient(90deg,var(--color-surface)_0%,var(--color-surface-2)_50%,var(--color-surface)_100%)] bg-[length:200%_100%]" />
        ))}
      </div>
    </div>
  );
}

function LoadError({ message, onReset }: { message: string; onReset: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="cf-card mx-auto mt-10 max-w-md p-8 text-center">
      <AlertTriangle className="mx-auto size-10 text-warning" />
      <h2 className="mt-4 text-lg font-bold">Não foi possível carregar o clube</h2>
      <p className="mt-1 text-sm text-fg-muted">Os dados do clube salvo não foram encontrados ({message}).</p>
      <Button
        variant="club"
        className="mt-6"
        onClick={() => {
          onReset();
          navigate('/novo-jogo');
        }}
      >
        Escolher outro clube
      </Button>
    </div>
  );
}

/** Sidebar no online: código da sala, jogadores conectados e "Sair da sala". */
function OnlineRoomCard() {
  const navigate = useNavigate();
  const room = useOnline((s) => s.room);
  const leave = useOnline((s) => s.leave);
  const connected = room?.players.filter((p) => p.connected).length ?? 0;
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-line bg-surface-2/50 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-fg-subtle uppercase">Sala online</span>
          <ConnectionBadge className="py-0 text-[10px]" />
        </div>
        <div className="mt-0.5 font-mono text-lg font-black tracking-[0.2em]">{room?.code ?? '······'}</div>
        <div className="flex items-center gap-1 text-[11px] text-fg-muted">
          <Users className="size-3.5" /> {connected}/{room?.players.length ?? 0} conectados
        </div>
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/sala')}>
        <Users /> Carreira e sala
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          if (!window.confirm('Sair agora? A carreira fica salva com a sua vaga: volte quando quiser em "Minhas carreiras online".')) return;
          void leave().then(() => navigate('/inicio'));
        }}
      >
        <LogOut /> Sair (continuar depois)
      </Button>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/inicio')}>
        Menu inicial
      </Button>
    </div>
  );
}

