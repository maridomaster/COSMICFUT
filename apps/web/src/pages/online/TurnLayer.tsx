/**
 * (17/11) Camada do jogo online com até 6 técnicos:
 *  - faixa da rodada: ordem das vezes (modo turnos, estilo Brasfoot) ou "Aguardando" com avatares (simultâneo),
 *    cronômetro, "Pular até…" (votação) e "Forçar" (host);
 *  - tela de passagem "Vez de X — Clube" (como o Brasfoot trocando de técnico);
 *  - painel "Vez de X" para quem espera: feed ao vivo do que o técnico da vez faz (nível público);
 *  - contagem 3-2-1, votações (pular / pausar), progresso do salto e banner de quem parou o salto;
 *  - reações flutuantes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, Check, ChevronDown, ChevronUp, CircleStop, FastForward, Hourglass, Pause, Vote, X } from 'lucide-react';
import { REACTIONS, type RoomPlayer } from '@cosmicfut/shared';
import { skipShortcuts } from '@cosmicfut/engine';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/format';
import { useIsOnline } from '@/store/mode';
import { useMe, useMyTurn, useOnline } from '@/store/online';
import { Button } from '@/components/ui/button';
import { Countdown, IndexCrest, useClubName } from './common';

const NO_PLAYERS: RoomPlayer[] = [];

function Dot({ p, size = 22, ring }: { p: RoomPlayer | undefined; size?: number; ring?: boolean }) {
  if (!p) return null;
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-full font-black text-black/80', ring && 'ring-2 ring-white')}
      style={{ width: size, height: size, background: p.color ?? '#64748b', fontSize: size * 0.45 }}
      title={p.nickname}
      aria-hidden
    >
      {p.nickname.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Faixa abaixo do topo (todas as telas do jogo online). */
export function TurnStrip() {
  const room = useOnline((s) => s.room);
  const me = useMe();
  const act = useOnline((s) => s.act);
  const toast = useOnline((s) => s.toast);
  const { turns, mine } = useMyTurn();
  const [skipOpen, setSkipOpen] = useState(false);
  if (!room || room.phase !== 'planning') return null;
  const players = room.players;
  const byId = (id: string) => players.find((p) => p.playerId === id);
  const force = async () => {
    const err = await act('round:force');
    if (err) toast({ kind: 'error', title: 'Forçar', text: err });
  };
  const t = room.turn;
  return (
    <div className="border-t border-line bg-surface/80" role="status" aria-live="polite">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-1.5 sm:px-4">
        {turns && t ? (
          <>
            <span className="shrink-0 text-[10px] font-bold tracking-wider text-fg-subtle uppercase">Rodada {t.round}</span>
            <ol className="flex shrink-0 items-center gap-1">
              {t.order.map((id) => {
                const p = byId(id);
                const now = t.playerId === id;
                const done = t.done.includes(id);
                return (
                  <li
                    key={id}
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold',
                      now ? 'border-warning bg-warning/15 text-fg' : done ? 'border-success/30 text-fg-muted' : 'border-line text-fg-muted',
                    )}
                  >
                    <Dot p={p} size={16} />
                    <span className="max-w-[6rem] truncate">{id === me?.playerId ? 'Você' : p?.nickname}</span>
                    {done && <Check className="size-3 text-success" />}
                    {now && t.deadline && (
                      <span className="text-warning">
                        <Countdown at={t.deadline} />
                      </span>
                    )}
                    {p && !p.connected && <span className="text-[9px] text-fg-subtle">(off)</span>}
                  </li>
                );
              })}
            </ol>
            <span className="shrink-0 text-[11px] text-fg-muted">{mine ? <b className="text-warning">Sua vez!</b> : t.playerId ? `Vez de ${byId(t.playerId)?.nickname ?? '?'}` : 'Encerrando a rodada…'}</span>
          </>
        ) : (
          <SimultaneousWaiting />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {room.settings.skipVotes !== false && !me?.spectator && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setSkipOpen(true)} disabled={!!room.vote}>
              <FastForward /> Pular até…
            </Button>
          )}
          {me?.isHost && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void force()} title="Host: encerra a vez atual (o assistente cuida) / avança a rodada">
              <Hourglass /> Forçar
            </Button>
          )}
        </span>
      </div>
      {skipOpen && <SkipVoteModal onClose={() => setSkipOpen(false)} />}
    </div>
  );
}

function SimultaneousWaiting() {
  const room = useOnline((s) => s.room)!;
  const me = useOnline((s) => s.playerId);
  const waiting = room.players.filter((p) => !p.spectator && p.connected && !p.ready && p.playerId !== me);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-fg-muted">
      {waiting.length ? (
        <>
          Aguardando:
          {waiting.map((p) => (
            <span key={p.playerId} className="flex items-center gap-1 font-semibold text-fg">
              <Dot p={p} size={16} /> {p.nickname}
            </span>
          ))}
        </>
      ) : (
        'Todos prontos?'
      )}
      {room.planningDeadline && (
        <span className="rounded-full bg-warning/15 px-1.5 font-bold text-warning">
          <Countdown at={room.planningDeadline} />
        </span>
      )}
    </span>
  );
}

/** Votação para pular até uma data (atalhos do calendário). */
function SkipVoteModal({ onClose }: { onClose: () => void }) {
  const season = useOnline((s) => s.season);
  const room = useOnline((s) => s.room);
  const me = useMe();
  const act = useOnline((s) => s.act);
  const toast = useOnline((s) => s.toast);
  const today = season?.date ?? room?.date ?? '';
  const add = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
  const shortcuts = useMemo(() => {
    if (!season || !me?.clubId) return [] as { label: string; date: string }[];
    const sc = skipShortcuts(season, me.clubId);
    const out: { label: string; date: string }[] = [];
    if (sc.nextMatch) out.push({ label: 'Meu próximo jogo', date: sc.nextMatch });
    out.push({ label: '+1 semana', date: add(today, 7) }, { label: '+1 mês', date: add(today, 30) }, { label: '+3 meses', date: add(today, 91) });
    out.push({ label: '+1 ano', date: sc.plusYear });
    return out;
  }, [season, me?.clubId, today]);
  const [date, setDate] = useState(() => add(today, 30));
  const propose = async (until: string, label?: string) => {
    const err = await act('vote:propose', { kind: 'skip', until, ...(label ? { label } : {}) });
    if (err) toast({ kind: 'error', title: 'Votação', text: err });
    else onClose();
  };
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-label="Votar para pular">
      <div className="cf-card w-full max-w-md p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <CalendarClock className="size-5 text-club-accent" /> Votar para pular até…
          </h2>
          <button onClick={onClose} aria-label="Fechar" className="text-fg-subtle hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Passa se a maioria dos técnicos conectados aceitar em 30 s. Durante o salto o assistente cuida de todos os clubes (escalação, renovações das peças-chave). Para no fim de temporada de qualquer um ou numa proposta grande por um jogador de vocês.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {shortcuts.map((s) => (
            <Button key={s.label} variant="outline" size="sm" onClick={() => void propose(s.date, s.label)}>
              {s.label} <span className="text-[10px] text-fg-subtle">{fmtDate(s.date, { day: '2-digit', month: 'short' })}</span>
            </Button>
          ))}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Outra data</span>
            <input type="date" value={date} min={add(today, 1)} onChange={(e) => setDate(e.target.value)} className="h-9 w-full rounded-xl border border-line bg-surface-2/70 px-3 text-sm" aria-label="Data-alvo" />
          </label>
          <Button variant="club" onClick={() => void propose(date)} disabled={!date || date <= today}>
            <Vote /> Propor
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Tudo que flutua sobre o jogo online (montado no AppShell). */
export function TurnLayer() {
  const online = useIsOnline();
  if (!online) return null;
  return (
    <>
      <PassScreen />
      <WaitingPanel />
      <CountdownOverlay />
      <VoteBanner />
      <SkipOverlay />
      <SkipEndBanner />
      <FloatingReactions />
    </>
  );
}

/** "Vez de X — Clube": a troca de técnico (1,8 s). */
function PassScreen() {
  const room = useOnline((s) => s.room);
  const me = useOnline((s) => s.playerId);
  const name = useClubName();
  const cur = room?.phase === 'planning' && room.settings.turnMode !== 'simultaneous' ? (room.turn?.playerId ?? null) : null;
  const [shown, setShown] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!cur || cur === last.current) {
      if (!cur) last.current = null;
      return;
    }
    last.current = cur;
    setShown(cur);
  }, [cur]);
  // (efeito separado: no StrictMode o efeito acima roda duas vezes e o 2º não remarcaria o timer)
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), 1800);
    return () => clearTimeout(id);
  }, [shown]);
  const p = room?.players.find((x) => x.playerId === shown);
  // a vez dos outros: aviso leve no topo (não bloqueia a leitura); a minha vez: tela cheia, como o Brasfoot
  if (p && p.playerId !== me) {
    return (
      <AnimatePresence>
        <motion.div
          key={p.playerId}
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-x-0 top-[calc(var(--topbar-h)_+_1.5rem)] z-[63] flex justify-center px-3"
          role="status"
        >
          <div className="cf-card flex items-center gap-3 px-4 py-2.5 shadow-2xl" style={{ borderLeft: `5px solid ${p.color ?? '#64748b'}` }}>
            <IndexCrest id={p.clubId} size={34} />
            <div>
              <div className="text-[10px] font-semibold tracking-[0.2em] text-fg-muted uppercase">Vez de</div>
              <div className="text-base font-extrabold">
                {p.nickname} <span className="text-xs font-normal text-fg-muted">· {p.clubId ? name(p.clubId) : ''}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }
  return (
    <AnimatePresence>
      {p && (
        <motion.div
          key={p.playerId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShown(null)}
          className="fixed inset-0 z-[65] grid place-items-center bg-black/70 backdrop-blur-sm"
          role="alert"
        >
          <motion.div initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} className="cf-card flex flex-col items-center gap-3 px-10 py-8 text-center" style={{ borderTop: `6px solid ${p.color ?? '#64748b'}` }}>
            <IndexCrest id={p.clubId} size={84} />
            <div className="text-xs font-semibold tracking-[0.22em] text-fg-muted uppercase">{p.playerId === me ? 'Sua vez!' : 'Vez de'}</div>
            <div className="text-3xl font-extrabold tracking-tight">{p.playerId === me ? p.nickname : p.nickname}</div>
            <div className="text-sm text-fg-muted">{p.clubId ? name(p.clubId) : ''}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Quem espera: "Vez de X" com o feed ao vivo (somente leitura até a sua vez). */
function WaitingPanel() {
  const room = useOnline((s) => s.room);
  const feed = useOnline((s) => s.feed);
  const { turns, mine, current } = useMyTurn();
  const me = useMe();
  const [open, setOpen] = useState(true);
  const name = useClubName();
  if (!room || room.phase !== 'planning' || !turns || mine || !current || !me) return null;
  const items = feed.filter((f) => f.at >= (room.turn?.startedAt ?? 0) - 1000 || f.kind === 'turn').slice(-6);
  return (
    <div className="fixed bottom-3 left-3 z-[50] w-[min(22rem,calc(100vw-1.5rem))]">
      <div className="cf-card overflow-hidden shadow-2xl" style={{ borderLeft: `4px solid ${current.color ?? '#64748b'}` }}>
        <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <IndexCrest id={current.clubId} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">Vez de {current.nickname}</span>
            <span className="block truncate text-[11px] text-fg-muted">
              {current.clubId ? name(current.clubId) : ''} · suas telas estão em modo leitura
              {room.turn?.deadline ? (
                <>
                  {' '}
                  · <Countdown at={room.turn.deadline} />
                </>
              ) : null}
            </span>
          </span>
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
        {open && (
          <ol className="max-h-48 space-y-1 overflow-y-auto border-t border-line px-3 py-2 text-xs" aria-live="polite" aria-label="O que está acontecendo">
            {items.length === 0 && <li className="text-fg-subtle">{current.nickname} está pensando…</li>}
            {items.map((f, i) => (
              <li key={`${f.at}-${i}`} className="text-fg-muted">
                <span className="text-fg-subtle">{new Date(f.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> {f.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function CountdownOverlay() {
  const at = useOnline((s) => s.room?.countdown?.endsAt ?? null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [at]);
  const n = at ? Math.max(1, Math.ceil((at - now) / 1000)) : null;
  return (
    <AnimatePresence>
      {n !== null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[64] grid place-items-center bg-black/40" role="status" aria-live="assertive">
          <motion.div key={n} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-[9rem] leading-none font-black text-white drop-shadow-2xl">
            {n}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VoteBanner() {
  const room = useOnline((s) => s.room);
  const me = useMe();
  const act = useOnline((s) => s.act);
  const live = useOnline((s) => s.live);
  const v = room?.vote ?? null;
  const players = room?.players ?? NO_PLAYERS;
  const canPause = room?.phase === 'matchday' && room.settings.pauseVotes !== false && !!live && live.phase === 'live' && !v && !me?.spectator;
  if (!v)
    return canPause ? (
      <div className="fixed right-3 bottom-20 z-[50]">
        <Button variant="outline" size="sm" onClick={() => void act('vote:propose', { kind: 'pause' })} title="Pausa as partidas ao vivo se a maioria aceitar">
          <Pause /> Votar pausa
        </Button>
      </div>
    ) : null;
  const by = players.find((p) => p.playerId === v.by)?.nickname ?? '?';
  const voted = v.yes.includes(me?.playerId ?? '') ? 'yes' : v.no.includes(me?.playerId ?? '') ? 'no' : null;
  return (
    <div className="fixed inset-x-0 top-[calc(var(--topbar-h)_+_0.25rem)] z-[62] flex justify-center px-3">
      <div className="cf-card flex w-full max-w-lg flex-wrap items-center gap-3 px-4 py-3 shadow-2xl" role="alertdialog" aria-label="Votação">
        <Vote className="size-5 text-club-accent" />
        <div className="min-w-0 flex-1 text-sm">
          <b>{by}</b> propõe {v.kind === 'skip' ? <>pular até <b>{v.until ? fmtDate(v.until) : '?'}</b>{v.label ? ` (${v.label})` : ''}</> : <b>pausar as partidas</b>}
          <div className="text-[11px] text-fg-muted">
            {v.yes.length} sim · {v.no.length} não · precisa de {v.needed} · <Countdown at={v.deadline} />
          </div>
        </div>
        {!me?.spectator && (
          <div className="flex gap-2">
            <Button size="sm" variant={voted === 'yes' ? 'club' : 'outline'} onClick={() => void act('vote:cast', { id: v.id, yes: true })}>
              Sim
            </Button>
            <Button size="sm" variant={voted === 'no' ? 'club' : 'outline'} onClick={() => void act('vote:cast', { id: v.id, yes: false })}>
              Não
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SkipOverlay() {
  const skip = useOnline((s) => s.room?.skip ?? null);
  const me = useMe();
  const act = useOnline((s) => s.act);
  const players = useOnline((s) => s.room?.players ?? NO_PLAYERS);
  if (!skip) return null;
  const d = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
  const pct = Math.min(100, Math.max(0, (d(skip.from, skip.date) / Math.max(1, d(skip.from, skip.until))) * 100));
  return createPortal(
    <div className="fixed inset-0 z-[66] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-label="Pulando no tempo">
      <div className="cf-card w-full max-w-md p-6 text-center">
        <FastForward className="mx-auto size-8 text-club-accent" />
        <h2 className="mt-2 text-lg font-bold">Pulando até {fmtDate(skip.until)}</h2>
        <p className="text-xs text-fg-muted">Proposto por {players.find((p) => p.playerId === skip.by)?.nickname ?? '?'} · o assistente cuida de todos os clubes</p>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-club-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="tabular mt-2 text-sm font-semibold">
          {fmtDate(skip.date)} · {Math.round(pct)}%
        </div>
        {me?.isHost && (
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void act('skip:cancel')}>
            <CircleStop /> Cancelar (host)
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SkipEndBanner() {
  const e = useOnline((s) => s.skipEnd);
  const dismiss = useOnline((s) => s.dismissSkipEnd);
  const players = useOnline((s) => s.room?.players ?? NO_PLAYERS);
  useEffect(() => {
    if (!e) return;
    const id = setTimeout(dismiss, 12_000);
    return () => clearTimeout(id);
  }, [e, dismiss]);
  if (!e || e.reason === 'done') return null;
  const who = e.playerId ? players.find((p) => p.playerId === e.playerId) : undefined;
  const title = e.reason === 'cancelled' ? 'Salto cancelado pelo host' : e.reason === 'season-end' ? 'O salto parou: fim de temporada' : e.reason === 'offer' ? `O salto parou: evento de ${who?.nickname ?? 'um técnico'}` : 'O salto parou';
  return (
    <div className="fixed inset-x-0 top-[calc(var(--topbar-h)_+_0.25rem)] z-[61] flex justify-center px-3">
      <div className="cf-card flex w-full max-w-lg items-start gap-3 px-4 py-3 shadow-2xl" role="alert" style={who ? { borderLeft: `4px solid ${who.color ?? '#64748b'}` } : undefined}>
        {who && <IndexCrest id={who.clubId} size={28} />}
        <div className="min-w-0 flex-1 text-sm">
          <b>{title}</b>
          {e.note && <div className="text-xs text-fg-muted">{e.note}</div>}
          <div className="text-[11px] text-fg-subtle">
            {e.days} dia(s) simulados · parou em {fmtDate(e.date)}
          </div>
        </div>
        <button onClick={dismiss} aria-label="Fechar" className="text-fg-subtle hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Reações de todos (balões que sobem) + botões. */
function FloatingReactions() {
  const reactions = useOnline((s) => s.reactions);
  const players = useOnline((s) => s.room?.players ?? NO_PLAYERS);
  const act = useOnline((s) => s.act);
  const me = useMe();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="pointer-events-none fixed top-[calc(var(--topbar-h)_+_0.75rem)] right-3 z-[58] flex flex-col items-end gap-1.5">
        <AnimatePresence>
          {reactions.slice(-5).map((r) => {
            const p = players.find((x) => x.playerId === r.playerId);
            return (
              <motion.div
                key={r.key}
                initial={{ opacity: 0, x: 20, scale: 0.7 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2/95 px-2 py-1 text-xs shadow-xl"
              >
                <Dot p={p} size={18} />
                <span className="font-semibold">{p?.nickname}</span>
                <span className="text-lg leading-none font-black">{r.emoji}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {me && (
        <div className="fixed right-3 bottom-[4.5rem] z-[49] flex flex-col items-end gap-1 sm:bottom-3 sm:right-20">
          {open && (
            <div className="flex gap-1 rounded-xl border border-line-strong bg-surface-2/95 p-1 shadow-xl">
              {REACTIONS.map((e) => (
                <button key={e} className="grid h-8 min-w-8 place-items-center rounded-lg px-1 text-sm font-black hover:bg-surface-3" aria-label={`Reagir ${e}`} onClick={() => void act('room:react', { emoji: e })}>
                  {e}
                </button>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" className="h-9 rounded-full px-3" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Reações">
            {open ? <X /> : <span className="text-base leading-none">🔥</span>}
          </Button>
        </div>
      )}
    </>
  );
}
