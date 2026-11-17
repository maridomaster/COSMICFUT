/**
 * Camada global do modo online (montada na raiz do router):
 *  - conecta o socket quando há modo online / sessão salva (o rejoin restaura sala, temporada e partida);
 *  - ao chegar um `match:start`, leva o jogador para a tela da partida;
 *  - banner "Reconectando…" e toasts do online.
 */
import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useIsOnline } from '@/store/mode';
import { useOnline } from '@/store/online';
import { OnlineToasts, ReconnectBanner } from './common';
import { SimHostHint } from './SimHostHint';

export function RootLayout() {
  return (
    <>
      <Outlet />
      <OnlineRuntime />
    </>
  );
}

function OnlineRuntime() {
  const online = useIsOnline();
  const session = useOnline((s) => s.session);
  const live = useOnline((s) => s.live);
  const navigate = useNavigate();
  const location = useLocation();
  const navigatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (online && session) useOnline.getState().connect();
  }, [online, session]);

  // match:preview (pré-jogo) ou match:start → tela da partida (uma vez por partida)
  const previewId = useOnline((s) => s.matchPreview?.matchId ?? null);
  useEffect(() => {
    const id = previewId ?? (live && live.phase === 'live' ? live.matchId : null);
    if (!online || !id) return;
    if (navigatedFor.current === id) return;
    // fora do jogo (menu inicial, lobby de outra sala, escolha de clube solo): não sequestra a navegação
    if (/^\/(online|inicio|novo-jogo)/.test(location.pathname)) return;
    navigatedFor.current = id;
    if (location.pathname !== '/partida') navigate('/partida');
  }, [online, live, previewId, location.pathname, navigate]);

  // fim de temporada (season:end review) → tela de renovações (uma vez por temporada). Quem está vendo o
  // pós-jogo/resumo da última rodada não é interrompido: o botão do topo e o painel levam até lá.
  const seasonEnd = useOnline((s) => (s.room?.phase === 'season-end' ? (s.room.seasonEnd?.season ?? s.room.season ?? 0) : null));
  const navigatedEnd = useRef<number | null>(null);
  useEffect(() => {
    if (!online || seasonEnd === null || navigatedEnd.current === seasonEnd) return;
    if (/^\/(online|inicio|novo-jogo|carreiras)/.test(location.pathname)) return;
    if (location.pathname === '/partida' && live) return;
    navigatedEnd.current = seasonEnd;
    if (location.pathname !== '/fim-de-temporada') navigate('/fim-de-temporada');
  }, [online, seasonEnd, live, location.pathname, navigate]);

  return (
    <>
      <ReconnectBanner />
      <SimHostHint />
      <OnlineToasts />
    </>
  );
}
