/**
 * (Calendário) "Pular no tempo" — como no FC: abre um calendário, escolhe qualquer data futura (ou um atalho) e
 * "Simular até aqui". A simulação roda no worker dia a dia (engine `TimeSkip`), com o assistente no comando do time,
 * barra de progresso (data + %) e Cancelar (para no fim do dia atual; o jogo é salvo). Só na carreira solo.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, ChevronLeft, ChevronRight, CircleStop, FastForward, Flag, Loader2, Play, Repeat, Trophy, X } from 'lucide-react';
import {
  addDays, cycleEnd, cycleOfRegion, cycleSeason, DEFAULT_SKIP_STOPS, TRANSFER_WINDOWS, windowFor,
  type Competition, type Fixture, type Region, type SeasonState, type SkipStops,
} from '@cosmicfut/engine';
import { useSeason, useSeasonOver } from '@/store/season';
import { useMatch } from '@/store/match';
import { clubFixtures, humanIdOf, humanRegionOf, REGION_LABEL } from '@/season/view';
import { fmtDate } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { ClubCrest, clubLabel } from '@/components/game/status';

export const useSkipModal = create<{ open: boolean; show: () => void; hide: () => void }>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

const STOPS_KEY = 'cf:skip-stops';
function loadStops(): SkipStops {
  try {
    const raw = localStorage.getItem(STOPS_KEY);
    if (raw) return { ...DEFAULT_SKIP_STOPS, ...(JSON.parse(raw) as Partial<SkipStops>) };
  } catch {
    /* sem armazenamento: padrões */
  }
  return { ...DEFAULT_SKIP_STOPS };
}
function saveStops(s: SkipStops) {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify(s));
  } catch {
    /* ignora */
  }
}

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const plusYears = (d: string, n: number) => {
  const y = Number(d.slice(0, 4)) + n;
  const md = d.slice(5) === '02-29' ? '02-28' : d.slice(5);
  return `${y}-${md}`;
};

interface Marker {
  kind: 'window-open' | 'window-close' | 'turnover' | 'aging' | 'final' | 'season-end';
  label: string;
}

/** Datas-chave: janelas da região do humano, viradas (30/06 e 31/12), envelhecimento (01/07), finais e fim de temporada. */
function keyDates(season: SeasonState, region: Region, human: string, years: number[]): Map<string, Marker[]> {
  const m = new Map<string, Marker[]>();
  const add = (d: string, mk: Marker) => (m.get(d) ?? m.set(d, []).get(d)!).push(mk);
  for (const y of years) {
    for (const [a, b] of TRANSFER_WINDOWS[region]) {
      add(`${y}-${a}`, { kind: 'window-open', label: `Abre a janela de transferências (${REGION_LABEL[region]})` });
      add(`${y}-${b}`, { kind: 'window-close', label: 'Último dia da janela de transferências' });
    }
    add(`${y}-06-30`, { kind: 'turnover', label: 'Virada da Europa e da Arábia (fim da temporada cruzada)' });
    add(`${y}-07-01`, { kind: 'aging', label: 'Envelhecimento anual dos jogadores e juniores do ano' });
    add(`${y}-12-31`, { kind: 'turnover', label: 'Virada da América do Sul (fim do ano civil)' });
  }
  const cyc = cycleOfRegion(region);
  for (const y of years) add(cycleEnd(cyc, cycleSeason(cyc, `${y}-03-01`)), { kind: 'season-end', label: 'Último dia da sua temporada' });
  // finais / último jogo das competições do humano e das principais
  for (const c of season.competitions) {
    const mine = c.clubIds.includes(human);
    if (!mine && c.type !== 'continental') continue;
    const last = lastDateOf(c);
    if (last && last >= season.date) add(last, { kind: 'final', label: `${mine ? '' : ''}${c.name}${c.seasonLabel ? ` ${c.seasonLabel}` : ''}: ${c.format ? 'final / último jogo' : 'última rodada'}` });
  }
  return m;
}

function lastDateOf(c: Competition): string | null {
  const cal = c.calendar;
  if (cal?.length) return cal[cal.length - 1];
  let last: string | null = null;
  for (const f of c.fixtures) if (!last || f.date > last) last = f.date;
  return last;
}

export function SkipCalendarModal() {
  const open = useSkipModal((s) => s.open);
  const hide = useSkipModal((s) => s.hide);
  const skipping = useSeason((s) => !!s.advancing?.skip);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, hide]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={hide} />
          <div key="wrap" className="pointer-events-none fixed inset-0 z-[61] grid place-items-end sm:place-items-center sm:p-4">
            <motion.div
              role="dialog"
              aria-modal
              aria-labelledby="skip-title"
              aria-busy={skipping}
              className="scrollbar-thin pointer-events-auto max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-w-4xl sm:rounded-2xl"
              initial={{ y: 30, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              <SkipBody onClose={hide} />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function SkipBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const season = useSeason((s) => s.save?.season);
  const advancing = useSeason((s) => s.advancing);
  const rolling = useSeason((s) => s.rolling);
  const lastSkip = useSeason((s) => s.lastSkip);
  const metrics = useSeason((s) => s.metrics);
  const skipTo = useSeason((s) => s.skipTo);
  const cancelSkip = useSeason((s) => s.cancelSkip);
  const over = useSeasonOver();
  const today = season?.date ?? '2026-01-01';
  const human = season ? humanIdOf(season) ?? '' : '';
  const region: Region = (season && humanRegionOf(season)) ?? 'SA';
  const [month, setMonth] = useState(today.slice(0, 7));
  const [target, setTarget] = useState<string | null>(null);
  const [stops, setStopsState] = useState<SkipStops>(loadStops);
  const setStops = (p: Partial<SkipStops>) =>
    setStopsState((s) => {
      const n = { ...s, ...p };
      saveStops(n);
      return n;
    });
  const skipping = !!advancing?.skip;
  const y0 = Number(today.slice(0, 4));
  const years = useMemo(() => Array.from({ length: 11 }, (_, i) => y0 + i), [y0]);
  const markers = useMemo(() => (season ? keyDates(season, region, human, years) : new Map<string, Marker[]>()), [season, region, human, years]);
  const fixtures = useMemo(() => {
    const m = new Map<string, Fixture>();
    if (season && human) for (const f of clubFixtures(season, human)) m.set(f.date, f);
    return m;
  }, [season, human]);

  if (!season) return null;

  // atalhos
  const nextMatch = [...fixtures.values()].find((f) => !f.result && f.date > today)?.date ?? null;
  const win = windowFor(region, today);
  const winTarget = win.open && win.closesOn ? addDays(win.closesOn, 1) : win.opensOn;
  const cyc = cycleOfRegion(region);
  const seasonEndTarget = addDays(cycleEnd(cyc, cycleSeason(cyc, today)), 1);
  const yearStart = (y: number) => (cyc === 'split' ? `${y}-07-01` : `${y}-01-01`);
  const shortcuts: { label: string; date: string | null; hint?: string }[] = [
    { label: 'Próximo jogo', date: nextMatch, hint: 'chega no dia do jogo (ainda não disputado)' },
    { label: win.open ? 'Fim da janela' : 'Abertura da janela', date: winTarget },
    { label: 'Fim da temporada', date: seasonEndTarget, hint: 'o dia seguinte ao último da sua temporada' },
    { label: '+1 ano', date: plusYears(today, 1) },
  ];

  const [yy, mm] = month.split('-').map(Number);
  const first = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay(); // 0 = domingo
  const lead = (first + 6) % 7;
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysIn(yy, mm) }, (_, i) => iso(yy, mm, i + 1))];
  const shiftMonth = (k: number) => {
    const d = new Date(Date.UTC(yy, mm - 1 + k, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (next < today.slice(0, 7) || Number(next.slice(0, 4)) > y0 + 10) return;
    setMonth(next);
  };
  const pick = (d: string | null) => {
    if (!d || d <= today) return;
    setTarget(d);
    setMonth(d.slice(0, 7));
  };
  const days = target ? dayDiff(today, target) : 0;
  const msPerDay = metrics?.lastSimMs && metrics.lastContinueDays ? Math.max(25, metrics.lastSimMs / metrics.lastContinueDays) : 70;
  const estSec = Math.round((days * msPerDay) / 1000);
  const selMarkers = target ? markers.get(target) ?? [] : [];
  const selFixture = target ? fixtures.get(target) : undefined;
  const pct = advancing && advancing.total ? Math.round((advancing.day / advancing.total) * 100) : 0;
  const resumeTarget = lastSkip?.reason === 'season-end' && lastSkip.until > today ? lastSkip.until : null;

  const run = async (until: string) => {
    useMatch.getState().reset();
    const out = await skipTo(until, stops);
    if (out?.reason === 'season-end') {
      onClose();
      navigate('/fim-de-temporada');
    } else if (out?.reason === 'fired') onClose();
  };

  return (
    <div>
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-club-accent/15 text-club-accent">
          <CalendarClock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="skip-title" className="text-lg font-extrabold tracking-tight">
            Calendário · pular no tempo
          </h2>
          <p className="text-xs text-fg-muted">
            Hoje: {fmtDate(today, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}. Escolha uma data: tudo até ela é simulado, com o assistente
            escalando o time. Gols, assistências, títulos e campanhas ficam registrados.
          </p>
        </div>
        <button type="button" aria-label="Fechar" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
          <X className="size-5" />
        </button>
      </div>

      {skipping && advancing ? (
        <div className="space-y-4 px-5 py-8" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <Loader2 className="size-6 animate-spin text-club-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">Simulando até {fmtDate(advancing.skip!.until, { day: '2-digit', month: 'long', year: 'numeric' })}</div>
              <div className="text-xs text-fg-muted">
                Data atual da simulação: <b className="tabular text-fg">{fmtDate(advancing.date, { day: '2-digit', month: 'short', year: 'numeric' })}</b> · {advancing.day}/{advancing.total} dias
              </div>
            </div>
            <span className="tabular text-2xl font-black">{pct}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-linear-to-r from-club-primary to-club-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-fg-subtle">Você pode fechar esta janela: a barra no topo mostra o progresso. Cancelar para no fim do dia atual e salva o jogo.</p>
            <Button variant="outline" onClick={cancelSkip}>
              <CircleStop /> Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
          {/* calendário */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <button type="button" aria-label="Mês anterior" onClick={() => shiftMonth(-1)} className="grid size-8 place-items-center rounded-lg border border-line text-fg-muted hover:bg-surface-2 hover:text-fg">
                <ChevronLeft className="size-4" />
              </button>
              <div className="min-w-0 flex-1 text-center text-sm font-bold capitalize">{fmtDate(`${month}-15`, { month: 'long', year: 'numeric' })}</div>
              <button type="button" aria-label="Próximo mês" onClick={() => shiftMonth(1)} className="grid size-8 place-items-center rounded-lg border border-line text-fg-muted hover:bg-surface-2 hover:text-fg">
                <ChevronRight className="size-4" />
              </button>
              <NativeSelect aria-label="Ano" value={String(yy)} onChange={(e) => setMonth(`${e.target.value}-${e.target.value === String(y0) ? today.slice(5, 7) : '01'}`)} className="w-24">
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
              {WEEKDAYS.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={`e${i}`} />;
                const past = d < today;
                const isToday = d === today;
                const f = fixtures.get(d);
                const mk = markers.get(d) ?? [];
                const inWindow = windowFor(region, d).open;
                const sel = d === target;
                const between = target && d > today && d < target;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={past || isToday}
                    onClick={() => pick(d)}
                    title={[f ? `${f.homeId === human ? 'x' : '@'} ${clubLabel(f.homeId === human ? f.awayId : f.homeId, true)}${f.result ? ` (${f.result.home}x${f.result.away})` : ''}` : '', ...mk.map((x) => x.label)].filter(Boolean).join('\n') || undefined}
                    className={cn(
                      'relative flex h-14 flex-col items-center justify-start rounded-lg border px-0.5 pt-1 text-xs transition-colors',
                      past ? 'border-transparent text-fg-subtle/50' : 'border-line/60 hover:border-club-accent/60 hover:bg-club-accent/5',
                      inWindow && !past && 'bg-success/[0.06]',
                      between && 'bg-club-accent/10',
                      isToday && 'border-club-accent/70 font-bold',
                      sel && 'border-club-accent bg-club-accent text-club-on-accent',
                    )}
                  >
                    <span className="tabular leading-none font-semibold">{Number(d.slice(8))}</span>
                    {f && (
                      <span className="mt-1">
                        <ClubCrest id={f.homeId === human ? f.awayId : f.homeId} size={18} />
                      </span>
                    )}
                    <span className="absolute right-1 bottom-1 flex gap-0.5">
                      {mk.some((x) => x.kind === 'final') && <Trophy className={cn('size-2.5', sel ? 'text-club-on-accent' : 'text-warning')} />}
                      {mk.some((x) => x.kind === 'turnover' || x.kind === 'season-end') && <Flag className={cn('size-2.5', sel ? 'text-club-on-accent' : 'text-club-accent')} />}
                      {mk.some((x) => x.kind === 'window-open' || x.kind === 'window-close') && <Repeat className={cn('size-2.5', sel ? 'text-club-on-accent' : 'text-success')} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-fg-subtle">
              <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-success/30" /> janela aberta</span>
              <span className="inline-flex items-center gap-1"><Repeat className="size-3 text-success" /> abre/fecha a janela</span>
              <span className="inline-flex items-center gap-1"><Flag className="size-3 text-club-accent" /> virada / fim da sua temporada</span>
              <span className="inline-flex items-center gap-1"><Trophy className="size-3 text-warning" /> final / última rodada</span>
              <span>escudo = seu jogo (só os já sorteados)</span>
            </div>
          </div>

          {/* painel */}
          <div className="space-y-4">
            {lastSkip && (
              <div className={cn('rounded-xl border px-3 py-2.5 text-xs', lastSkip.reason === 'done' ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')}>
                <div className="font-bold">{lastSkip.reason === 'done' ? 'Salto concluído' : lastSkip.reason === 'cancelled' ? 'Salto cancelado' : 'O salto parou'}</div>
                <div className="mt-0.5 text-fg-muted">
                  {lastSkip.note ?? `Chegamos a ${fmtDate(lastSkip.date)}.`} {lastSkip.days} dia(s), {lastSkip.games.toLocaleString('pt-BR')} jogos, {lastSkip.turnovers} virada(s) em {(lastSkip.ms / 1000).toFixed(1)} s.
                </div>
                {resumeTarget && (
                  over ? (
                    <Button size="sm" variant="club" className="mt-2 w-full" onClick={() => { onClose(); navigate('/fim-de-temporada'); }}>
                      <Trophy /> Ir para o fim de temporada
                    </Button>
                  ) : (
                    <Button size="sm" variant="club" className="mt-2 w-full" disabled={rolling} onClick={() => void run(resumeTarget)}>
                      <Play /> Retomar até {fmtDate(resumeTarget)}
                    </Button>
                  )
                )}
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">Atalhos</div>
              <div className="grid grid-cols-2 gap-1.5">
                {shortcuts.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    disabled={!s.date || s.date <= today}
                    onClick={() => pick(s.date)}
                    title={s.hint}
                    className={cn('rounded-lg border px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-40', s.date && s.date === target ? 'border-club-accent bg-club-accent/10' : 'border-line hover:bg-surface-2')}
                  >
                    <div className="font-semibold">{s.label}</div>
                    <div className="tabular text-[10px] text-fg-muted">{s.date ? fmtDate(s.date) : '—'}</div>
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <NativeSelect
                  aria-label="Pular para um ano"
                  value=""
                  onChange={(e) => e.target.value && pick(yearStart(Number(e.target.value)))}
                  className="flex-1"
                >
                  <option value="">Ir para o ano…</option>
                  {years.slice(1).map((y) => (
                    <option key={y} value={y}>
                      {cyc === 'split' ? `Temporada ${y}/${String((y + 1) % 100).padStart(2, '0')} (01/07/${y})` : `${y} (01/01/${y})`}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">Parar quando…</div>
              <div className="space-y-1.5 text-xs">
                <Check label="Eu for demitido" checked={stops.fired && !stops.none} disabled={stops.none} onChange={(v) => setStops({ fired: v })} />
                <Check label="Chegar proposta de emprego" checked={stops.jobOffer && !stops.none} disabled={stops.none} onChange={(v) => setStops({ jobOffer: v })} />
                <div className="flex items-center gap-2">
                  <Check label="Proposta por jogador ≥" checked={stops.playerOffer && !stops.none} disabled={stops.none} onChange={(v) => setStops({ playerOffer: v })} />
                  <input
                    type="number"
                    min={50}
                    max={500}
                    step={10}
                    aria-label="Percentual do valor de mercado"
                    value={stops.playerOfferPct}
                    disabled={stops.none || !stops.playerOffer}
                    onChange={(e) => setStops({ playerOfferPct: Math.max(1, Math.min(1000, Number(e.target.value) || 0)) })}
                    className="tabular h-7 w-16 rounded-md border border-line bg-surface-2 px-1.5 text-right text-xs disabled:opacity-40"
                  />
                  <span className="text-fg-muted">% do valor</span>
                </div>
                <Check label="Fim da minha temporada (renovações e resumo)" checked={stops.seasonEnd && !stops.none} disabled={stops.none} onChange={(v) => setStops({ seasonEnd: v })} />
                <div className="border-t border-line/60 pt-1.5">
                  <Check label="Não parar (atravessa tudo; o assistente renova as peças-chave)" checked={stops.none} onChange={(v) => setStops({ none: v })} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface-2/40 p-3">
              {target ? (
                <>
                  <div className="text-sm font-bold">{fmtDate(target, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
                  <div className="text-[11px] text-fg-muted">
                    {days} dia(s) · estimativa ≈ {estSec < 60 ? `${Math.max(1, estSec)} s` : `${Math.round(estSec / 60)} min`}
                  </div>
                  {selFixture && (
                    <div className="mt-1 text-[11px]">
                      Jogo: {selFixture.homeId === human ? 'x' : '@'} <b>{clubLabel(selFixture.homeId === human ? selFixture.awayId : selFixture.homeId, true)}</b> (chega no dia, antes do jogo)
                    </div>
                  )}
                  {selMarkers.map((x, i) => (
                    <div key={i} className="mt-0.5 text-[11px] text-fg-muted">• {x.label}</div>
                  ))}
                </>
              ) : (
                <p className="text-xs text-fg-muted">Escolha um dia no calendário ou um atalho.</p>
              )}
              <Button variant="club" className="mt-3 w-full" disabled={!target || !!advancing || rolling || over} onClick={() => target && void run(target)}>
                <FastForward /> Simular até aqui
              </Button>
              {over && <p className="mt-1.5 text-[11px] text-warning">Sua temporada acabou: faça a virada em "Fim de temporada" antes de pular.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2', disabled && 'cursor-not-allowed opacity-50')}>
      <input type="checkbox" className="size-4 accent-[var(--club-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
