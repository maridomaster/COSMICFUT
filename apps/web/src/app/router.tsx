import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { useSoloGame } from '@/store/game';
import { useIsOnline } from '@/store/mode';
import { useOnline } from '@/store/online';
import { AppShell } from './AppShell';
import { NAV_ITEMS } from './nav';
import { ClubSelectPage } from '@/pages/ClubSelect';
import { CareersPage } from '@/pages/careers/CareersPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { ComingSoonPage } from '@/pages/ComingSoon';
import { SquadPage } from '@/pages/squad/SquadPage';
import { TacticsPage } from '@/pages/tactics/TacticsPage';
import { CalendarPage } from '@/pages/calendar/CalendarPage';
import { FinancePage } from '@/pages/finance/FinancePage';
import { MatchPage } from '@/pages/match/MatchPage';
import { MarketPage } from '@/pages/market/MarketPage';
import { AcademyPage } from '@/pages/academy/AcademyPage';
import { CompetitionsPage } from '@/pages/competitions/CompetitionsPage';
import { HistoryPage } from '@/pages/history/HistoryPage';
import { StatsPage } from '@/pages/stats/StatsPage';
import { SeasonEndPage } from '@/pages/season-end/SeasonEndPage';
import { StartMenuPage } from '@/pages/online/StartMenu';
import { OnlineLobbyPage } from '@/pages/online/LobbyPage';
import { OnlineMatchPage } from '@/pages/online/OnlineMatchPage';
import { LiveRoundPage } from '@/pages/online/LiveRound';
import { OnlineSeasonEndPage } from '@/pages/online/OnlineSeasonEndPage';
import { RootLayout } from '@/pages/online/OnlineRuntime';
import { FriendsPage } from '@/pages/online/FriendsPage';
import { InboxPage } from '@/pages/coach/InboxPage';
import { JobsPage } from '@/pages/coach/JobsPage';
import { CoachPage } from '@/pages/coach/CoachPage';
import { OnlineJobsPage } from '@/pages/online/OnlineJobsPage';
import { CareerRoomPage } from '@/pages/online/CareerRoomPage';

/** Sem jogo: menu inicial (Carreira Solo × Online). */
function RootRedirect() {
  const online = useIsOnline();
  const session = useOnline((s) => s.session);
  const soloClub = useSoloGame((s) => s.clubId);
  if (online && session) return <Navigate to="/dashboard" replace />;
  return <Navigate to={soloClub && !online ? '/dashboard' : '/inicio'} replace />;
}

/** Mesma rota, tela diferente por modo. */
function ByMode({ solo, online }: { solo: ReactNode; online: ReactNode }) {
  return useIsOnline() ? online : solo;
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/inicio', element: <StartMenuPage /> },
      { path: '/online', element: <OnlineLobbyPage /> },
      { path: '/online/:code', element: <OnlineLobbyPage /> },
      { path: '/novo-jogo', element: <ClubSelectPage /> },
      { path: '/carreiras', element: <CareersPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/elenco', element: <SquadPage /> },
          { path: '/taticas', element: <TacticsPage /> },
          { path: '/calendario', element: <CalendarPage /> },
          { path: '/financas', element: <FinancePage /> },
          { path: '/competicoes', element: <CompetitionsPage /> },
          { path: '/historico', element: <HistoryPage /> },
          { path: '/estatisticas', element: <StatsPage /> },
          { path: '/amigos', element: <FriendsPage /> },
          {
            path: '/fim-de-temporada',
            element: <ByMode solo={<SeasonEndPage />} online={<OnlineSeasonEndPage />} />,
          },
          { path: '/partida', element: <ByMode solo={<MatchPage />} online={<OnlineMatchPage />} /> },
          // (Rodada ao vivo) todos da sala assistem às partidas dos técnicos (só leitura)
          { path: '/rodada-ao-vivo', element: <ByMode solo={<Navigate to="/dashboard" replace />} online={<LiveRoundPage />} /> },
          // solo e online: as ações passam pelo adaptador (pages/market/actions.ts)
          { path: '/mercado', element: <MarketPage /> },
          // (Base) categorias de base: revelações periódicas (solo e online)
          { path: '/base', element: <AcademyPage /> },
          // (Fase 3) carreira do técnico (solo)
          { path: '/inbox', element: <InboxPage /> },
          // (carreira online) Central de Empregos online: vagas, propostas, diretoria
          { path: '/empregos', element: <ByMode solo={<JobsPage />} online={<OnlineJobsPage />} /> },
          { path: '/sala', element: <ByMode solo={<Navigate to="/dashboard" replace />} online={<CareerRoomPage />} /> },
          { path: '/tecnico', element: <CoachPage /> },
          ...NAV_ITEMS.filter((i) => !i.ready).map((item) => ({ path: item.to, element: <ComingSoonPage item={item} /> })),
        ],
      },
      { path: '*', element: <RootRedirect /> },
    ],
  },
  // GitHub Pages (projeto): o app vive em /COSMICFUT/ — as rotas são relativas ao base do Vite
], { basename: import.meta.env.BASE_URL.replace(/\/+$/, '') || '/' });
