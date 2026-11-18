/** Botão grande "Pronto" do planejamento online (substitui o "Continuar" do solo no topbar). */
import { useNavigate } from 'react-router';
import { Check, CheckCircle2, Eye, FastForward, FileSignature, Hourglass, Loader2, PlayCircle, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMe, useMyTurn, useOnline, useWaitingFor } from '@/store/online';
import { Button } from '@/components/ui/button';
import { useLiveRoundActive } from './LiveRound';

export function ReadyButton({ size = 'md', className, showWaiting = false }: { size?: 'md' | 'lg'; className?: string; showWaiting?: boolean }) {
  const navigate = useNavigate();
  const phase = useOnline((s) => s.room?.phase);
  const live = useOnline((s) => s.live);
  const busy = useOnline((s) => s.readyBusy);
  const setReady = useOnline((s) => s.setReady);
  const lineupSync = useOnline((s) => s.lineupSync);
  const me = useMe();
  const waiting = useWaitingFor();

  const turn = useMyTurn();
  const liveRound = useLiveRoundActive();
  let btn;
  if (phase === 'planning' && me?.spectator) {
    btn = (
      <Button variant="outline" size={size} disabled className={className}>
        <Eye /> Espectador
      </Button>
    );
  } else if (phase === 'planning' && turn.turns) {
    // (17/11) modo turnos (estilo Brasfoot): "Concluir vez" só na minha vez
    btn = turn.mine ? (
      <Button variant="club" size={size} onClick={() => void setReady(true)} disabled={busy} className={cn('relative min-w-[8.5rem] px-3 font-extrabold sm:px-5', className)} title="Passa a vez para o próximo técnico">
        {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Concluir vez
        {lineupSync === 'pending' || lineupSync === 'saving' ? <span className="absolute -top-1 -right-1 size-2.5 animate-pulse rounded-full bg-warning" title="Salvando escalação…" /> : null}
      </Button>
    ) : (
      <Button variant="outline" size={size} disabled className={cn('max-w-[12rem] px-3', className)}>
        <Hourglass /> <span className="truncate">Vez de {turn.current?.nickname ?? '…'}</span>
      </Button>
    );
  } else if (phase === 'planning') {
    const ready = !!me?.ready;
    btn = (
      <Button
        variant={ready ? 'outline' : 'club'}
        size={size}
        onClick={() => void setReady(!ready)}
        disabled={busy}
        className={cn('relative min-w-[7.5rem] px-3 font-extrabold sm:px-5', ready && 'border-success/50 text-success', className)}
        aria-pressed={ready}
        title={ready ? 'Clique para desmarcar' : 'Marque quando terminar a escalação'}
      >
        {busy ? <Loader2 className="animate-spin" /> : ready ? <CheckCircle2 /> : <Check />}
        {ready ? 'Pronto!' : 'Pronto'}
        {lineupSync === 'pending' || lineupSync === 'saving' ? <span className="absolute -top-1 -right-1 size-2.5 animate-pulse rounded-full bg-warning" title="Salvando escalação…" /> : null}
      </Button>
    );
  } else if (phase === 'simulating') {
    btn = (
      <Button variant="outline" size={size} disabled className={className}>
        <Loader2 className="animate-spin" /> <span className="hidden min-[400px]:inline">Simulando…</span>
      </Button>
    );
  } else if (phase === 'matchday' && !live && liveRound) {
    // (Rodada ao vivo) sem jogo meu: o botão azul "Rodada ao vivo" ao lado já leva às partidas
    btn = null;
  } else if (phase === 'matchday') {
    btn = (
      <Button variant="club" size={size} onClick={() => navigate('/partida')} className={cn('px-3 sm:px-4', className)}>
        <PlayCircle /> <span className="hidden min-[400px]:inline">{live ? 'Partida ao vivo' : 'Rodada ao vivo'}</span>
      </Button>
    );
  } else if (phase === 'season-end') {
    // fim de temporada: renovações + "pronto para a virada" (season:renew) na tela de Fim de temporada
    const ready = !!me?.ready;
    btn = (
      <Button
        variant={ready ? 'outline' : 'club'}
        size={size}
        onClick={() => navigate('/fim-de-temporada')}
        className={cn('px-3 font-extrabold sm:px-4', ready && 'border-success/50 text-success', className)}
        title={ready ? 'Renovações enviadas: aguardando a virada' : 'Renove os contratos e fique pronto para a próxima temporada'}
      >
        {ready ? <CheckCircle2 /> : <FileSignature />}
        <span className="hidden min-[400px]:inline">{ready ? 'Pronto p/ virada' : 'Fim de temporada'}</span>
      </Button>
    );
  } else {
    btn = (
      <Button variant="outline" size={size} disabled className={className}>
        <Loader2 className="animate-spin" />
      </Button>
    );
  }

  if (!showWaiting || (phase !== 'planning' && phase !== 'season-end')) return btn;
  return (
    <div className="flex items-center gap-2">
      <DevAdvance />
      <div className="hidden max-w-[16rem] text-right text-[11px] leading-tight text-fg-muted md:block">
        {waiting.length ? (
          <>
            Aguardando: <b className="text-fg">{waiting.join(', ')}</b>
          </>
        ) : me?.ready ? (
          'Todos prontos!'
        ) : (
          'Só falta você'
        )}
      </div>
      {waiting.length > 0 && (
        <span className="tabular grid h-6 min-w-6 place-items-center rounded-full bg-surface-3 px-1.5 text-[11px] font-bold text-fg-muted md:hidden" title={`Aguardando: ${waiting.join(', ')}`}>
          {waiting.length}
        </span>
      )}
      {btn}
    </div>
  );
}

/**
 * (dev) Avanço rápido do host — `dev:advance` (o servidor precisa de DEV_COMMANDS=1). Só no build de
 * desenvolvimento, só para o host e só no planejamento. Os jogos humanos também são simulados.
 */
function DevAdvance() {
  const phase = useOnline((s) => s.room?.phase);
  const me = useMe();
  const busy = useOnline((s) => s.devBusy);
  const devAdvance = useOnline((s) => s.devAdvance);
  if (!import.meta.env.DEV || !me?.isHost || phase !== 'planning') return null;
  return (
    <div className="hidden items-center md:flex">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        className="px-2 text-[11px] text-fg-subtle"
        title="DEV: simula até o próximo dia com jogo humano (inclusive o seu jogo de hoje)"
        onClick={() => void devAdvance('next-match')}
      >
        {busy ? <Loader2 className="animate-spin" /> : <SkipForward />} dev: jogo
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        className="px-2 text-[11px] text-fg-subtle"
        title="DEV: simula até o fim da temporada (os jogos humanos também)"
        onClick={() => {
          if (window.confirm('DEV: simular até o fim da temporada (os jogos de todos os humanos também são simulados)?')) void devAdvance('season-end');
        }}
      >
        <FastForward /> dev: fim
      </Button>
    </div>
  );
}
