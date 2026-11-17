/** Peças visuais do modo online (sala, chat, outros jogos, banners e toasts). */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Crown, Loader2, MessageCircle, Send, Trophy, Wifi, WifiOff, X } from 'lucide-react';
import type { LiveMatchInfo, RoomPlayer } from '@cosmicfut/shared';
import { useClubIndex } from '@/data/hooks';
import { indexCrestPaths } from '@/data/source';
import { cachedBundle } from '@/data/squads';
import { cn } from '@/lib/utils';
import { useIsOnline } from '@/store/mode';
import { useOnline } from '@/store/online';
import { Button } from '@/components/ui/button';
import { Crest } from '@/components/game/Crest';

/** referência estável para o seletor (`?? []` no seletor criaria um array novo a cada leitura) */
const NO_PLAYERS: never[] = [];

/* ───────── clubes pelo índice (lobby: os elencos ainda não foram carregados) ───────── */

export function useClubIndexMap() {
  const { data } = useClubIndex();
  return useMemo(() => new Map((data ?? []).map((c) => [c.id, c])), [data]);
}

/** Escudo a partir do índice (ou do bundle em cache, se houver). */
export function IndexCrest({ id, size = 28, className }: { id: string | null; size?: number; className?: string }) {
  const index = useClubIndexMap();
  if (!id) return <span className={cn('inline-block rounded-lg border border-dashed border-line-strong', className)} style={{ width: size, height: size }} />;
  const b = cachedBundle(id)?.club;
  const e = index.get(id);
  const path = b ? [b.crest, b.crestMini].filter((p): p is string => !!p) : e ? indexCrestPaths(e) : null;
  return <Crest path={path} name={b?.name ?? e?.name ?? id} colors={b?.colors ?? e?.colors ?? { primary: '#555', secondary: '#999' }} size={size} className={className} />;
}

export function useClubName() {
  const index = useClubIndexMap();
  return (id: string | null | undefined, short = false) => {
    if (!id) return '—';
    const b = cachedBundle(id)?.club;
    return (short ? b?.shortName : b?.name) ?? index.get(id)?.name ?? id;
  };
}

/* ───────── copiar ───────── */

export function CopyButton({ text, label, className, icon }: { text: string; label: string; className?: string; icon?: ReactNode }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback (http sem permissão de clipboard)
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} className={className} aria-label={label}>
      {done ? <Check className="text-success" /> : (icon ?? <Copy />)} {done ? 'Copiado!' : label}
    </Button>
  );
}

/* ───────── jogadores ───────── */

export function PlayersList({ players, meId, showReady = true }: { players: RoomPlayer[]; meId: string | null; showReady?: boolean }) {
  const name = useClubName();
  return (
    <ul className="space-y-1.5">
      {players.map((p) => (
        <li key={p.playerId} className={cn('flex items-center gap-2.5 rounded-xl border px-2.5 py-2', p.playerId === meId ? 'border-club-accent/40 bg-club-accent/8' : 'border-line bg-surface-2/40')}>
          <span className="relative">
            <IndexCrest id={p.clubId} size={30} />
            <span
              className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface', p.connected ? 'bg-success' : 'bg-fg-subtle')}
              title={p.connected ? 'Conectado' : 'Desconectado'}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="truncate">{p.nickname}</span>
              {p.isHost && <Crown className="size-3.5 shrink-0 text-warning" aria-label="Host" />}
              {p.playerId === meId && <span className="rounded bg-club-accent/20 px-1 text-[9px] font-black tracking-wider text-club-accent uppercase">você</span>}
            </div>
            <div className="truncate text-[11px] text-fg-muted">{p.clubId ? name(p.clubId) : 'escolhendo clube…'}</div>
          </div>
          {showReady && (
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                !p.connected ? 'bg-surface-3 text-fg-subtle' : p.ready ? 'bg-success/15 text-success' : 'bg-surface-3 text-fg-muted',
              )}
            >
              {!p.connected ? 'offline' : p.ready ? 'pronto' : 'aguardando'}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ───────── chat ───────── */

export function ChatBox({ className, compact }: { className?: string; compact?: boolean }) {
  const chat = useOnline((s) => s.chat);
  const me = useOnline((s) => s.playerId);
  const send = useOnline((s) => s.sendChat);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    const r = await send(t);
    setErr(r);
  };
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <ol ref={list} className={cn('scrollbar-thin flex-1 space-y-1.5 overflow-y-auto pr-1', compact ? 'max-h-56' : 'min-h-40')} aria-live="polite" aria-label="Mensagens">
        {chat.length === 0 && <li className="py-6 text-center text-xs text-fg-subtle">Ninguém falou nada ainda. Mande um "bora!"</li>}
        {chat.map((m, i) => (
          <li key={`${m.at}-${i}`} className={cn('flex flex-col', m.playerId === me ? 'items-end' : 'items-start')}>
            <span className="text-[10px] text-fg-subtle">
              {m.playerId === me ? 'Você' : m.nickname} · {new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className={cn('max-w-[85%] rounded-xl px-2.5 py-1.5 text-sm break-words', m.playerId === me ? 'bg-club-accent/20 text-fg' : 'bg-surface-3 text-fg')}>{m.text}</span>
          </li>
        ))}
      </ol>
      <form onSubmit={(e) => void submit(e)} className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          placeholder="Mensagem…"
          aria-label="Mensagem do chat"
          className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-surface-2/70 px-3 text-sm outline-none focus:border-club-accent/60"
        />
        <Button type="submit" size="sm" variant="club" className="h-9" aria-label="Enviar">
          <Send />
        </Button>
      </form>
      {err && <p className="mt-1 text-[11px] text-danger">{err}</p>}
    </div>
  );
}

/* ───────── outros jogos (match:info) ───────── */

const STATUS_LABEL: Record<LiveMatchInfo['status'], string> = { pending: 'a seguir', live: 'ao vivo', 'half-time': 'intervalo', finished: 'encerrado' };

export function OtherGames({ excludeId, title = 'Outros jogos' }: { excludeId?: string | null; title?: string }) {
  const infos = useOnline((s) => s.infos);
  const players = useOnline((s) => s.room?.players) ?? NO_PLAYERS;
  const name = useClubName();
  const list = Object.values(infos).filter((m) => m.matchId !== excludeId);
  const nick = (id: string | null) => (id ? (players.find((p) => p.playerId === id)?.nickname ?? '') : 'CPU');
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Trophy className="size-4 text-club-accent" /> {title}
      </h3>
      {list.length === 0 ? (
        <p className="py-3 text-center text-xs text-fg-subtle">Nenhuma outra partida de humanos nesta rodada.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((m) => {
            const live = m.status === 'live';
            const agg = m.aggregateBefore ? { home: m.aggregateBefore.home + m.score.home, away: m.aggregateBefore.away + m.score.away } : null;
            return (
              <li key={m.matchId} className="rounded-xl border border-line bg-surface-2/40 px-2.5 py-2">
                {m.label && (
                  <div className="mb-1 truncate text-center text-[10px] font-semibold tracking-wider text-fg-subtle uppercase" title={m.label}>
                    {m.label}
                  </div>
                )}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <span className="flex min-w-0 items-center justify-end gap-1.5 text-right text-xs font-semibold">
                    <span className="truncate">{name(m.homeClubId, true)}</span>
                    <IndexCrest id={m.homeClubId} size={20} />
                  </span>
                  <span className="tabular rounded-md bg-black/30 px-2 py-0.5 text-sm font-black">
                    {m.score.home} : {m.score.away}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                    <IndexCrest id={m.awayClubId} size={20} />
                    <span className="truncate">{name(m.awayClubId, true)}</span>
                  </span>
                </div>
                {(agg || m.penaltyScore) && (
                  <div className="tabular mt-0.5 flex justify-center gap-2 text-[10px] font-semibold">
                    {agg && <span className="text-fg-muted">agregado {agg.home} x {agg.away}</span>}
                    {m.penaltyScore && <span className="text-warning">pên. {m.penaltyScore.home} x {m.penaltyScore.away}</span>}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between text-[10px] text-fg-muted">
                  <span className="truncate">{nick(m.homePlayerId)}</span>
                  <span className={cn('flex items-center gap-1 rounded-full px-1.5 font-bold tracking-wider uppercase', live ? 'bg-danger/20 text-danger' : 'bg-surface-3')}>
                    {live && <span className="size-1.5 animate-pulse rounded-full bg-danger" />}
                    {m.status === 'live' ? `${m.minute}'` : STATUS_LABEL[m.status]}
                  </span>
                  <span className="truncate text-right">{nick(m.awayPlayerId)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───────── conexão ───────── */

export function ConnectionBadge({ className }: { className?: string }) {
  const status = useOnline((s) => s.status);
  const ok = status === 'connected';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold', ok ? 'border-success/30 text-success' : 'border-warning/30 text-warning', className)}>
      {ok ? <Wifi className="size-3.5" /> : status === 'idle' ? <WifiOff className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
      {ok ? 'online' : status === 'idle' ? 'desconectado' : status === 'replaced' ? 'aberto em outra aba' : 'conectando…'}
    </span>
  );
}

/** Banner global de reconexão (todas as telas, só no modo online com sala). */
export function ReconnectBanner() {
  const online = useIsOnline();
  const status = useOnline((s) => s.status);
  const session = useOnline((s) => s.session);
  const error = useOnline((s) => s.error);
  const retry = useOnline((s) => s.retry);
  const show = online && !!session && (status === 'reconnecting' || status === 'replaced');
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          role="status"
          aria-live="assertive"
          className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-2"
        >
          <div className="flex max-w-xl items-center gap-2.5 rounded-xl border border-warning/40 bg-[#2a2210]/95 px-3.5 py-2 text-sm text-warning shadow-2xl backdrop-blur">
            {status === 'replaced' ? <WifiOff className="size-4 shrink-0" /> : <Loader2 className="size-4 shrink-0 animate-spin" />}
            <span className="min-w-0 flex-1">
              {status === 'replaced' ? (
                <>
                  <b>Sala aberta em outra aba/aparelho.</b> <span className="text-warning/80">Esta conexão foi encerrada.</span>
                </>
              ) : (
                <>
                  <b>Reconectando…</b> <span className="text-warning/80">{error ? `(${error})` : 'a partida continua no servidor.'}</span>
                </>
              )}
            </span>
            {status === 'replaced' && (
              <Button size="sm" variant="outline" onClick={retry}>
                Jogar aqui
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Toasts do modo online (resultados da rodada, erros). */
export function OnlineToasts() {
  const toasts = useOnline((s) => s.toasts);
  const dismiss = useOnline((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[55] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            className={cn(
              'pointer-events-auto relative rounded-xl border px-3.5 py-2.5 pr-8 text-sm shadow-xl backdrop-blur-xl',
              t.kind === 'error' ? 'border-danger/40 bg-[#2a1215]/95 text-danger' : t.kind === 'success' ? 'border-success/40 bg-surface-2/95' : 'border-line-strong bg-surface-2/95',
            )}
          >
            <button aria-label="Fechar aviso" onClick={() => dismiss(t.id)} className="absolute top-2 right-2 text-fg-subtle hover:text-fg">
              <X className="size-4" />
            </button>
            <div className="font-bold">{t.title}</div>
            {t.text && <div className="text-xs text-fg-muted">{t.text}</div>}
            {t.lines && (
              <ul className="mt-1 space-y-0.5 text-xs text-fg">
                {t.lines.slice(0, 8).map((l, i) => (
                  <li key={i} className="tabular">
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Contagem regressiva até `at` (epoch ms). */
export function Countdown({ at }: { at: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [at]);
  if (!at) return null;
  return <span className="tabular">{Math.max(0, Math.ceil((at - now) / 1000))}s</span>;
}

/** Botão flutuante de chat (planejamento online). */
export function ChatDock() {
  const [open, setOpen] = useState(false);
  const count = useOnline((s) => s.chat.length);
  const [seen, setSeen] = useState(count);
  useEffect(() => {
    if (open) setSeen(count);
  }, [open, count]);
  const unread = Math.max(0, count - seen);
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Fechar chat' : 'Abrir chat'}
        className="fixed bottom-4 left-4 z-30 grid size-12 place-items-center rounded-full border border-line-strong bg-surface-2 text-fg shadow-xl hover:border-club-accent/50 lg:left-[15rem]"
      >
        <MessageCircle className="size-5" />
        {unread > 0 && <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-club-accent px-1 text-[10px] font-black text-club-on-accent">{unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="cf-card fixed bottom-20 left-4 z-30 w-[min(22rem,calc(100vw-2rem))] p-3 lg:left-[15rem]"
            role="dialog"
            aria-label="Chat da sala"
          >
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">
                <MessageCircle className="size-4 text-club-accent" /> Chat da sala
              </span>
              <button aria-label="Fechar chat" onClick={() => setOpen(false)} className="text-fg-subtle hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
            <ChatBox compact />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
