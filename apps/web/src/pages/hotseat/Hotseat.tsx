/**
 * (17/11) "Vários técnicos no mesmo computador" (hot-seat, como no Brasfoot): faixa das vezes, botão "Concluir vez",
 * tela de passagem "Vez de X — Clube" e o painel de configuração na Escolha de Clube.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { PLAYER_COLORS, type ClubIndexEntry } from '@cosmicfut/shared';
import { MAX_HOTSEAT, type HotseatManager } from '@cosmicfut/engine';
import { indexCrestPaths } from '@/data/source';
import { cn, normalizeSearch } from '@/lib/utils';
import { hotseatAction, setPendingHotseat, useSeason } from '@/store/season';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Crest } from '@/components/game/Crest';
import { IndexCrest, useClubName } from '@/pages/online/common';

function Dot({ color, name, size = 18 }: { color: string; name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-black text-black/80" style={{ width: size, height: size, background: color, fontSize: size * 0.45 }} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function useHotseat() {
  return useSeason((s) => s.save?.world?.hotseat ?? null);
}

/** Botão "Concluir vez" (passa ao próximo técnico). O último da rodada usa o Continuar normal. */
export function HotseatEndTurnButton({ className }: { className?: string }) {
  const hs = useHotseat();
  const busy = useSeason((s) => !!s.advancing || s.rolling);
  const [pending, setPending] = useState(false);
  if (!hs) return null;
  const end = async () => {
    setPending(true);
    try {
      await hotseatAction('end-turn');
    } finally {
      setPending(false);
    }
  };
  return (
    <Button variant="club" onClick={() => void end()} disabled={busy || pending} className={cn('px-3 sm:px-4', className)} title="Passa a vez ao próximo técnico">
      {pending ? <Loader2 className="animate-spin" /> : <Check />}
      <span className="hidden sm:inline">Concluir vez</span>
      <ChevronRight />
    </Button>
  );
}

/** Faixa abaixo do topo: ordem das vezes, quem já jogou e de quem é a vez. */
export function HotseatStrip() {
  const hs = useHotseat();
  const name = useClubName();
  if (!hs) return null;
  return (
    <div className="border-t border-line bg-surface/80" role="status" aria-live="polite">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-1.5 sm:px-4">
        <span className="shrink-0 text-[10px] font-bold tracking-wider text-fg-subtle uppercase">Técnicos</span>
        <ol className="flex shrink-0 items-center gap-1">
          {hs.managers.map((m, i) => {
            const now = hs.active === i;
            const done = hs.done.includes(i);
            return (
              <li key={m.clubId} className={cn('flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold', now ? 'border-warning bg-warning/15' : done ? 'border-success/30 text-fg-muted' : 'border-line text-fg-muted')} title={name(m.clubId)}>
                <Dot color={m.color} name={m.name} size={16} />
                <span className="max-w-[7rem] truncate">{m.name}</span>
                {done && <Check className="size-3 text-success" />}
              </li>
            );
          })}
        </ol>
        <span className="shrink-0 text-[11px] text-fg-muted">
          Vez de <b className="text-warning">{hs.managers[hs.active]?.name}</b>
          {hs.done.length >= hs.managers.length - 1 ? ' · último da rodada: Continuar avança o dia' : ''}
        </span>
      </div>
    </div>
  );
}

/** Tela de passagem quando o controle muda de técnico (1,8 s; clique fecha). */
export function HotseatPassScreen() {
  const hs = useHotseat();
  const name = useClubName();
  const active = hs ? hs.managers[hs.active] : null;
  const key = active ? `${hs!.active}` : null;
  const last = useRef<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!key || key === last.current) return;
    const first = last.current === null;
    last.current = key;
    if (first) return; // ao abrir o jogo não mostra
    setShown(key);
  }, [key]);
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), 1800);
    return () => clearTimeout(id);
  }, [shown]);
  return (
    <AnimatePresence>
      {shown && active && (
        <motion.div key={shown} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShown(null)} className="fixed inset-0 z-[65] grid place-items-center bg-black/75 backdrop-blur-sm" role="alert">
          <motion.div initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} className="cf-card flex flex-col items-center gap-3 px-10 py-8 text-center" style={{ borderTop: `6px solid ${active.color}` }}>
            <IndexCrest id={active.clubId} size={84} />
            <div className="text-xs font-semibold tracking-[0.22em] text-fg-muted uppercase">Vez de</div>
            <div className="text-3xl font-extrabold tracking-tight">{active.name}</div>
            <div className="text-sm text-fg-muted">{name(active.clubId)}</div>
            <div className="text-[11px] text-fg-subtle">Passe o computador para {active.name}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────── configuração (Escolha de Clube) ───────── */

export interface HotseatDraft {
  name: string;
  color: string;
  clubId: string | null;
}

/**
 * Painel "Vários técnicos no mesmo computador": o 1º técnico escolhe o clube clicando no cartão (como sempre); os
 * outros (até 6 no total) escolhem aqui. `extra` vai para setPendingHotseat quando a carreira é criada.
 */
export function HotseatSetup({ index, firstName, onFirstName, extra, onExtra }: {
  index: ClubIndexEntry[];
  firstName: string;
  onFirstName: (v: string) => void;
  extra: HotseatDraft[];
  onExtra: (v: HotseatDraft[]) => void;
}) {
  const used = new Set(extra.map((e) => e.color));
  const add = () => {
    if (extra.length >= MAX_HOTSEAT - 1) return;
    const color = PLAYER_COLORS.find((c) => c !== PLAYER_COLORS[0] && !used.has(c)) ?? PLAYER_COLORS[(extra.length + 1) % PLAYER_COLORS.length];
    onExtra([...extra, { name: `Técnico ${extra.length + 2}`, color, clubId: null }]);
  };
  return (
    <section className="cf-card mt-4 p-4" aria-label="Vários técnicos no mesmo computador">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Users className="size-4 text-club-accent" /> Vários técnicos no mesmo computador
          </h2>
          <p className="text-xs text-fg-muted">Como no Brasfoot: até 6 técnicos, cada um faz a sua vez e passa o computador. O 1º técnico escolhe o clube clicando num cartão abaixo.</p>
        </div>
        <Button variant="outline" size="sm" onClick={add} disabled={extra.length >= MAX_HOTSEAT - 1}>
          <Plus /> Adicionar técnico
        </Button>
      </div>
      {extra.length > 0 && (
        <ul className="mt-3 space-y-2">
          <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/40 p-2">
            <Dot color={PLAYER_COLORS[0]} name={firstName || '1'} size={26} />
            <Input value={firstName} onChange={(e) => onFirstName(e.target.value.slice(0, 20))} className="h-9 w-40" aria-label="Nome do técnico 1" />
            <span className="text-xs text-fg-muted">clube: o cartão que você clicar abaixo</span>
          </li>
          {extra.map((m, i) => (
            <ManagerRow
              key={i}
              index={index}
              m={m}
              taken={new Set(extra.filter((_, j) => j !== i).map((x) => x.clubId).filter((x): x is string => !!x))}
              onChange={(next) => onExtra(extra.map((x, j) => (j === i ? next : x)))}
              onRemove={() => onExtra(extra.filter((_, j) => j !== i))}
              n={i + 2}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ManagerRow({ index, m, taken, onChange, onRemove, n }: { index: ClubIndexEntry[]; m: HotseatDraft; taken: Set<string>; onChange: (m: HotseatDraft) => void; onRemove: () => void; n: number }) {
  const [q, setQ] = useState('');
  const club = m.clubId ? index.find((c) => c.id === m.clubId) : undefined;
  const hits = useMemo(() => {
    const s = normalizeSearch(q);
    if (s.length < 2) return [];
    return index.filter((c) => !c.guest && !taken.has(c.id) && normalizeSearch(c.name).includes(s)).sort((a, b) => b.level - a.level).slice(0, 8);
  }, [q, index, taken]);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/40 p-2">
      <div className="flex gap-1" role="radiogroup" aria-label={`Cor do técnico ${n}`}>
        {PLAYER_COLORS.slice(1, 7).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={m.color === c} aria-label={`Cor ${c}`} onClick={() => onChange({ ...m, color: c })} className={cn('size-5 rounded-full', m.color === c && 'ring-2 ring-white')} style={{ background: c }} />
        ))}
      </div>
      <Input value={m.name} onChange={(e) => onChange({ ...m, name: e.target.value.slice(0, 20) })} className="h-9 w-36" aria-label={`Nome do técnico ${n}`} />
      {club ? (
        <span className="flex items-center gap-2 rounded-lg border border-club-accent/40 bg-club-accent/10 px-2 py-1 text-xs font-semibold">
          <Crest path={indexCrestPaths(club)} name={club.name} colors={club.colors} size={20} /> {club.name}
          <button type="button" className="text-fg-subtle hover:text-fg" onClick={() => onChange({ ...m, clubId: null })} aria-label="Trocar clube">
            ×
          </button>
        </span>
      ) : (
        <div className="relative min-w-[12rem] flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar clube do técnico…" className="h-9" aria-label={`Clube do técnico ${n}`} />
          {hits.length > 0 && (
            <ul className="absolute top-full z-20 mt-1 w-full rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl">
              {hits.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-surface-3" onClick={() => { onChange({ ...m, clubId: c.id }); setQ(''); }}>
                    <Crest path={indexCrestPaths(c)} name={c.name} colors={c.colors} size={18} /> {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remover técnico ${n}`}>
        <Trash2 />
      </Button>
    </li>
  );
}

/** Monta a lista final (1º técnico + extras com clube) e registra para a criação da carreira. */
export function commitHotseat(firstClubId: string, firstName: string, extra: HotseatDraft[]): HotseatManager[] | null {
  const list = extra.filter((e) => e.clubId && e.clubId !== firstClubId);
  if (!list.length) {
    setPendingHotseat(null);
    return null;
  }
  const managers: HotseatManager[] = [
    { name: firstName.trim() || 'Técnico 1', color: PLAYER_COLORS[0], clubId: firstClubId },
    ...list.map((e, i) => ({ name: e.name.trim() || `Técnico ${i + 2}`, color: e.color, clubId: e.clubId! })),
  ];
  setPendingHotseat(managers);
  return managers;
}
