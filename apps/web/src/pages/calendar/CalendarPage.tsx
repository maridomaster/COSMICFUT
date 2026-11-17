import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, House, ListOrdered, Plane, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsOnline } from '@/store/mode';
import { useSeason } from '@/store/season';
import { useSkipModal } from './SkipCalendar';
import { tieSummary, type Competition } from '@cosmicfut/engine';
import { fmtDate } from '@/lib/format';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeasonState } from '@/store/season';
import { clubFixtures, clubTable, competitionOf, currentRound, humanIdOf, humanRegionOf, humanSeasonLabel, REGION_LABEL, resultFor, roundsOf, weekOf } from '@/season/view';
import { compShort, currentStageId, fixtureInfo, stageDefOf } from '@/season/comps';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Segmented } from '@/components/ui/range';
import { FixtureLine, StandingsTable, ZoneLegend, zonesIn } from '@/components/game/standings';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { CompetitionEmblem } from '@/components/game/CompetitionEmblem';
import { Bracket, StageTables } from '@/pages/competitions/CompetitionsPage';

type Tab = 'jogos' | 'tabela' | 'meus';

const GROUP_LABEL: Record<string, string> = { league: 'Nacionais', cup: 'Copas', supercup: 'Copas', state: 'Estaduais', continental: 'Continentais' };

export function CalendarPage() {
  const season = useSeasonState();
  const human = humanIdOf(season);
  const online = useIsOnline();
  const openSkip = useSkipModal((s) => s.show);
  const busy = useSeason((s) => !!s.advancing || s.rolling);
  const [params, setParams] = useSearchParams();
  const tab = (['jogos', 'tabela', 'meus'].includes(params.get('tab') ?? '') ? params.get('tab') : 'meus') as Tab;
  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        p.set('tab', t);
        return p;
      },
      { replace: true },
    );

  const humanComp = competitionOf(season, human);
  const compId = params.get('c') ?? humanComp?.id ?? season.competitions[0]?.id;
  const setCompId = (id: string) =>
    setParams(
      (p) => {
        p.set('c', id);
        return p;
      },
      { replace: true },
    );
  const comp = season.competitions.find((c) => c.id === compId) ?? season.competitions[0];
  const total = comp ? roundsOf(comp) : 0;
  const [round, setRound] = useState<number | null>(null);
  const shownRound = Math.min(total, Math.max(1, round ?? (comp ? currentRound(comp) : 1)));

  const roundFixtures = useMemo(
    () => (comp ? comp.fixtures.filter((f) => f.round === shownRound).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)) : []),
    [comp, shownRound],
  );
  const roundDate = roundFixtures[0]?.date;
  const roundLabel = roundFixtures[0]?.label;
  const mine = useMemo(() => clubFixtures(season, human), [season, human]);
  // (Etapa 1) competições agrupadas por região (a do humano primeiro) e tipo
  const myRegion = humanRegionOf(season);
  const groups = useMemo(() => {
    const m = new Map<string, Competition[]>();
    const order = new Map<string, number>();
    for (const c of season.competitions) {
      const reg = c.region ? REGION_LABEL[c.region] : '';
      const k = c.type === 'state' ? `Estaduais · ${c.uf ?? ''}` : [reg, GROUP_LABEL[c.type] ?? 'Outras'].filter(Boolean).join(' · ');
      if (!order.has(k)) order.set(k, (c.region && c.region === myRegion ? 0 : c.type === 'state' ? 2 : 1) * 1000 + order.size);
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return [...m.entries()].sort((a, b) => order.get(a[0])! - order.get(b[0])!);
  }, [season.competitions, myRegion]);

  if (!comp) return null;
  const many = season.competitions.length > 1;

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cf-label text-club-accent">
            Temporada {humanSeasonLabel(season)} · Semana {weekOf(season.date)}
          </p>
          <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">Calendário</h1>
          <p className="text-xs text-fg-muted">Hoje: {fmtDate(season.date, { weekday: 'long', day: '2-digit', month: 'long' })}</p>
          {/* (Calendário) pular no tempo — só na carreira solo */}
          {!online && (
            <Button variant="outline" size="sm" className="mt-2" onClick={openSkip} disabled={busy}>
              <CalendarClock /> Pular para uma data…
            </Button>
          )}
        </div>
        {tab !== 'meus' && (
          <div className="flex w-full items-center gap-2 sm:w-80">
            {/* (Sala de Troféus) emblema da competição escolhida */}
            <CompetitionEmblem compId={comp.id} name={comp.name} type={comp.type} size={32} />
            <NativeSelect
              aria-label="Competição"
              className="min-w-0 flex-1"
              value={comp.id}
              onChange={(e) => {
                setCompId(e.target.value);
                setRound(null);
              }}
            >
              {many
                ? groups.map(([g, list]) => (
                    <optgroup key={g} label={g}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.seasonLabel ? ` ${c.seasonLabel}` : ''}
                          {c.clubIds.includes(human) ? ' ★' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : season.competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
            </NativeSelect>
          </div>
        )}
      </motion.header>

      <motion.div variants={fadeUp} className="max-w-md">
        <Segmented
          id="cal-tab"
          label="Visualização"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'meus', label: 'Meus jogos' },
            { value: 'jogos', label: 'Rodadas' },
            { value: 'tabela', label: 'Classificação' },
          ]}
        />
      </motion.div>

      <AnimatePresence mode="wait">
        {tab === 'jogos' && (
          <motion.div key="jogos" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
            <Card>
              <div className="flex items-center gap-2 border-b border-line px-3 py-3 sm:px-5">
                <button
                  aria-label="Rodada anterior"
                  disabled={shownRound <= 1}
                  onClick={() => setRound(shownRound - 1)}
                  className="grid size-9 place-items-center rounded-lg border border-line text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <div className="min-w-0 flex-1 text-center">
                  <div className="text-sm font-bold">
                    Rodada {shownRound} <span className="font-normal text-fg-subtle">de {total}</span>
                  </div>
                  <div className="truncate text-[11px] text-fg-muted">
                    {comp.seasonLabel ? `${comp.seasonLabel} · ` : ''}
                    {roundLabel && comp.format ? `${roundLabel} · ` : ''}
                    {roundDate && fmtDate(roundDate, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                    {roundDate ? ` · semana ${weekOf(roundDate)}` : ''}
                  </div>
                </div>
                <button
                  aria-label="Próxima rodada"
                  disabled={shownRound >= total}
                  onClick={() => setRound(shownRound + 1)}
                  className="grid size-9 place-items-center rounded-lg border border-line text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
              {/* faixa de rodadas */}
              <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:px-5">
                {Array.from({ length: total }, (_, i) => i + 1).map((r) => {
                  const done = comp.fixtures.filter((f) => f.round === r).every((f) => f.result);
                  return (
                    <button
                      key={r}
                      onClick={() => setRound(r)}
                      className={cn(
                        'tabular h-7 min-w-7 shrink-0 rounded-md px-1.5 text-[11px] font-bold transition-colors',
                        r === shownRound ? 'bg-club-accent text-club-on-accent' : done ? 'bg-surface-3 text-fg-muted hover:text-fg' : 'border border-line text-fg-subtle hover:text-fg',
                      )}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
              <CardContent className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {roundFixtures.length === 0 && <p className="text-sm text-fg-muted">Os jogos desta fase ainda não foram definidos.</p>}
                {roundFixtures.map((f) => (
                  <FixtureLine key={f.id} f={f} highlightId={human} />
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {tab === 'tabela' && (
          <motion.div key="tabela" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
            <CompTable comp={comp} human={human} />
          </motion.div>
        )}

        {tab === 'meus' && (
          <motion.div key="meus" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
            <Card>
              <CardHeader icon={<CalendarDays />} title={`Jogos do ${clubLabel(human)}`} subtitle={`${mine.filter((f) => f.result).length}/${mine.length} disputados · todas as competições`} />
              <CardContent className="space-y-1.5">
                {mine.map((f) => {
                  const home = f.homeId === human;
                  const opp = home ? f.awayId : f.homeId;
                  const res = resultFor(f, human);
                  const isNext = !f.result && f.id === mine.find((x) => !x.result)?.id;
                  const info = fixtureInfo(season, f);
                  // agregado depois da volta (engine: tieSummary)
                  const tie = f.result && f.tieId ? tieSummary(season, f.tieId) : null;
                  const agg =
                    tie && tie.legs.length > 1 && tie.legs[tie.legs.length - 1]?.id === f.id
                      ? tie.a === human
                        ? { me: tie.aggregate.a, op: tie.aggregate.b }
                        : { me: tie.aggregate.b, op: tie.aggregate.a }
                      : null;
                  return (
                    <div
                      key={f.id}
                      className={cn(
                        'grid grid-cols-[3rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-3 py-2',
                        isNext ? 'border-club-accent/45 bg-club-accent/[0.08]' : 'border-line/60 bg-surface-2/35',
                      )}
                    >
                      <span className="text-center leading-tight">
                        <span className="tabular block text-sm font-bold">{fmtDate(f.date, { day: '2-digit' })}</span>
                        <span className="block text-[10px] text-fg-muted uppercase">{fmtDate(f.date, { month: 'short' })}</span>
                        <span className="tabular block text-[9px] text-fg-subtle" title={`Semana ${weekOf(f.date)} do ano`}>S{weekOf(f.date)}</span>
                      </span>
                      <span title={home ? 'Mandante' : f.neutral ? 'Campo neutro' : 'Visitante'} className="text-fg-muted">
                        {home ? <House className="size-4" /> : <Plane className="size-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <ClubCrest id={opp} size={20} />
                          <span className="truncate text-sm font-medium">{clubLabel(opp)}</span>
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-fg-muted">
                          <Trophy className="size-3 shrink-0 text-club-accent" />
                          <span className="truncate">
                            <b className="font-semibold text-fg/80">{compShort(info.comp ?? ({ name: info.compName } as Competition))}</b>
                            {info.comp?.seasonLabel ? ` ${info.comp.seasonLabel}` : ''} · {info.phase}
                            {info.legLabel ? ` · ${info.legLabel}` : ''}
                          </span>
                        </span>
                      </span>
                      {f.result ? (
                        <span className="flex flex-col items-end">
                          <span
                            className={cn(
                              'tabular rounded-md px-2 py-0.5 text-sm font-extrabold',
                              res === 'W' ? 'bg-success/15 text-success' : res === 'L' ? 'bg-danger/15 text-danger' : 'bg-surface-3 text-fg-muted',
                            )}
                          >
                            {f.result.home} x {f.result.away}
                          </span>
                          {f.result.penalties && (
                            <span className="tabular text-[10px] text-fg-muted">
                              pên. {f.result.penalties.home}x{f.result.penalties.away}
                            </span>
                          )}
                          {agg && (
                            <span className="tabular text-[10px] text-fg-muted">
                              agr. {agg.me}x{agg.op}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-fg-subtle">{isNext ? 'próximo' : '—'}</span>
                      )}
                    </div>
                  );
                })}
                <p className="pt-2 text-[11px] text-fg-subtle">
                  Fases de mata-mata são sorteadas quando a fase anterior termina: novos jogos aparecem aqui ao longo da temporada.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Classificação: competições com formato mostram a fase atual (tabelas por grupo ou chave). */
function CompTable({ comp, human }: { comp: Competition; human: string }) {
  if (comp.format) {
    const sid = currentStageId(comp);
    const def = stageDefOf(comp, sid);
    if (sid && def) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 px-1 text-sm">
            <span className="font-bold">{def.name}</span>
            <Link to={`/competicoes?c=${encodeURIComponent(comp.id)}`} className="text-xs font-semibold text-club-accent hover:underline">
              Todas as fases
            </Link>
          </div>
          {def.kind === 'table' ? <StageTables comp={comp} stageId={sid} human={human} /> : <Bracket comp={comp} stageId={sid} human={human} />}
        </div>
      );
    }
  }
  const t = clubTable(comp);
  return (
    <Card>
      <CardHeader icon={<ListOrdered />} title="Classificação" subtitle={comp.name} action={<ZoneLegend comp={comp} zones={comp.format ? zonesIn(t.rows.length, t.zone) : undefined} />} className="flex-wrap" />
      <CardContent className="px-2 sm:px-4">
        <StandingsTable comp={comp} rows={t.rows} zone={t.zone} highlightId={human} />
      </CardContent>
    </Card>
  );
}
