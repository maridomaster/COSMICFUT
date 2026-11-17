import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import {
  ArrowDown, ArrowRight, ArrowUp, Baby, CalendarCheck, Check, Crown, FileSignature, Globe2, Hourglass, Loader2, Medal, PiggyBank, Trophy, UserMinus, XCircle,
} from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import {
  cycleOfCompetition, expiringContracts, finalRanking, renewalDemand, seasonLabel, seasonOver, turnoverInfo,
  type Competition, type ContinentalQualifiers, type RenewTerms, type SeasonState, type SeasonSummary, type WorldState,
} from '@cosmicfut/engine';
import { getCareerBase, squads } from '@/data/squads';
import { useCareerData } from '@/career/useCareerData';
import {
  BRAZIL_COUNTRY_ID, CONTINENTAL_ORDER, careerCountryOf, compCategory, projectContinental, qualifierRows, type CompCategory, type QualifierRow,
} from '@/season/continental';
import { ContinentalSeal } from '@/components/game/ContinentalSeal';
import { ZONE_META } from '@/components/game/standings';
import { Input, NativeSelect } from '@/components/ui/input';
import { clubIndexEntry } from '@/data/clubIndex';
import { useCountryMap } from '@/data/hooks';
import { fmtMoney, fmtMoneySigned, overallColor } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeason } from '@/store/season';
import { compShort, myCompetitions, clubStatusIn } from '@/season/comps';
import { humanSeasonLabel, REGION_LABEL } from '@/season/view';

/**
 * (Etapa 1) Fim de temporada REGIONAL: só as competições do ciclo que vira (América do Sul em 31/12; Europa/Arábia
 * em 30/06). As do outro ciclo continuam em andamento e não entram no balanço.
 */
export function closingView(state: SeasonState): SeasonState {
  if (!state.segment) return state;
  const cycle = turnoverInfo(state).cycle;
  return { ...state, competitions: state.competitions.filter((c) => cycleOfCompetition(c) === cycle) };
}
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Flag, PositionChip } from '@/components/game/bits';
import { ClubCrest, clubLabel } from '@/components/game/status';

const TYPE_ORDER: Record<string, number> = { league: 0, cup: 1, supercup: 2, state: 3, continental: 4 };

/** Fim de Temporada: campeões, acesso/rebaixamento, premiação, contratos e virada (nextSeason no worker). */
export function SeasonEndPage() {
  const save = useSeason((s) => s.save);
  const [justRolled, setJustRolled] = useState(false);
  if (!save?.world) {
    return (
      <div className="cf-card mx-auto mt-6 max-w-lg p-8 text-center text-sm text-fg-muted">A virada de temporada existe só na carreira solo.</div>
    );
  }
  const over = seasonOver(save.season);
  if (over && !justRolled) return <SeasonOver state={save.season} world={save.world} clubId={save.season.humanClubIds[0] ?? save.clubId} onRolled={() => setJustRolled(true)} />;
  if (save.summary) return <RolloverSummary summary={save.summary} world={save.world} state={save.season} clubId={save.season.humanClubIds[0] ?? save.clubId} />;
  return <NotOver />;
}

function NotOver() {
  return (
    <div className="cf-card mx-auto mt-6 max-w-lg p-8 text-center">
      <Hourglass className="mx-auto size-10 text-club-accent" />
      <h1 className="mt-4 text-xl font-extrabold">A temporada está em andamento</h1>
      <p className="mt-1 text-sm text-fg-muted">
        A tela de fim de temporada abre na virada da sua região: 31/12 na América do Sul, 30/06 na Europa e na Arábia Saudita.
      </p>
      <Link to="/dashboard" className="mt-5 inline-block text-sm font-semibold text-club-accent hover:underline">
        Voltar ao painel
      </Link>
    </div>
  );
}

/* ═════════════════════ antes da virada ═════════════════════ */

function SeasonOver({ state: full, world, clubId, onRolled }: { state: SeasonState; world: WorldState; clubId: string; onRolled: () => void }) {
  const rollover = useSeason((s) => s.rollover);
  const rolling = useSeason((s) => s.rolling);
  // (Etapa 1) balanço só das competições da região que vira; a SeasonState completa vai para a engine
  const state = useMemo(() => closingView(full), [full]);
  const ti = useMemo(() => turnoverInfo(full), [full]);
  const regionNames = (ti.regions ?? []).map((r) => REGION_LABEL[r]).join(' e ');
  const mine = useMemo(() => myCompetitions(state, clubId), [state, clubId]);
  const expiring = useMemo(() => {
    const base = getCareerBase();
    return base ? expiringContracts(world, full, base, clubId).sort((a, b) => b.overall - a.overall) : [];
  }, [world, full, clubId]);
  // (Fase 2) renovação detalhada: salário e duração por jogador; o pedido vem de `renewalDemand`
  // mesma reputação que a virada usa (clubs-index), para o pedido exibido ser exatamente o avaliado
  const rep = clubIndexEntry(clubId)?.reputation ?? 2;
  const demandOf = (p: Player, years?: number) => renewalDemand(full, squads, clubId, p, years, rep);
  const [terms, setTerms] = useState<Record<string, RenewRow>>(() => {
    const out: Record<string, RenewRow> = {};
    expiring.forEach((p, i) => {
      const d0 = demandOf(p);
      const years = Math.min(d0.maxYears, Math.max(d0.minYears, 2));
      // padrão: renova quem é útil (top 12 do elenco por overall) e tem até 33 anos, oferecendo o pedido
      out[p.id] = { on: i < 12 && p.age <= 33, years, wage: demandOf(p, years).wage, edited: false };
    });
    return out;
  });
  const patch = (id: string, p: Partial<RenewRow>) => setTerms((t) => ({ ...t, [id]: { ...t[id], ...p } }));
  const setAll = (on: boolean) => setTerms((t) => Object.fromEntries(Object.entries(t).map(([id, r]) => [id, { ...r, on }])));
  const matchAll = () =>
    setTerms((t) => {
      const out = { ...t };
      for (const p of expiring) if (out[p.id]) out[p.id] = { ...out[p.id], wage: demandOf(p, out[p.id].years).wage, edited: false };
      return out;
    });
  const renewing = expiring.filter((p) => terms[p.id]?.on);
  const refusing = renewing.filter((p) => terms[p.id].wage < demandOf(p, terms[p.id].years).wage);
  const titles = mine.filter((c) => c.championId === clubId);
  const prizes = state.clubs[clubId]?.finance?.prizes ?? 0;
  const next = seasonLabel(ti.cycle, ti.season + 1);
  const wageDelta = renewing.filter((p) => !refusing.includes(p)).reduce((t, p) => t + (terms[p.id].wage - p.wage), 0);

  const start = async () => {
    const map: Record<string, RenewTerms> = {};
    for (const p of renewing) map[p.id] = { wage: terms[p.id].wage, years: terms[p.id].years };
    const r = await rollover(map);
    if (r) {
      onRolled();
      window.scrollTo({ top: 0 });
    }
  };

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.section variants={fadeUp} className="cf-card relative overflow-hidden p-5 sm:p-7">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_120%_at_0%_0%,color-mix(in_oklab,var(--club-primary)_28%,transparent),transparent_70%)]" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center">
          <ClubCrest id={clubId} size={84} className="mx-auto md:mx-0" />
          <div className="min-w-0 flex-1 text-center md:text-left">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-club-accent uppercase">Fim de temporada</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-4xl">Temporada {ti.label} encerrada</h1>
            {regionNames && <p className="mt-1 text-xs text-fg-subtle">Virada de {regionNames} · {ti.date.split('-').reverse().join('/')}</p>}
            <p className="mt-2 text-sm text-fg-muted">
              {titles.length ? (
                <>
                  <b className="text-warning">{titles.length === 1 ? '1 título' : `${titles.length} títulos`}:</b> {titles.map((c) => c.name).join(', ')}.
                </>
              ) : (
                'Sem títulos neste ano.'
              )}{' '}
              Premiação recebida: <b className="text-fg">{fmtMoney(prizes)}</b>.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
              {mine.map((c) => {
                const st = clubStatusIn(c, clubId, (id) => clubLabel(id, true));
                return (
                  <span key={c.id} className={cn('rounded-lg border px-2 py-1 text-[11px]', st.tone === 'gold' ? 'border-warning/50 bg-warning/10 text-warning' : st.tone === 'good' ? 'border-success/40 text-success' : st.tone === 'bad' ? 'border-danger/40 text-danger' : 'border-line text-fg-muted')}>
                    <b className="font-semibold text-fg">{compShort(c)}:</b> {st.text}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <motion.div variants={fadeUp}>
          <ChampionsCard state={state} clubId={clubId} />
        </motion.div>
        <div className="space-y-3">
          <motion.div variants={fadeUp}>
            <MovesCard state={state} clubId={clubId} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <PrizesCard state={state} clubId={clubId} />
          </motion.div>
        </div>
      </div>

      <motion.div variants={fadeUp}>
        <ContinentalPreviewCard state={full} world={world} clubId={clubId} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader
            icon={<FileSignature />}
            title="Contratos vencendo"
            subtitle={expiring.length ? `${expiring.length === 1 ? '1 jogador' : `${expiring.length} jogadores`} com contrato até o fim de ${ti.label}. Quem não for renovado sai como livre.` : 'Nenhum contrato vence nesta virada.'}
            action={
              expiring.length > 0 ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <button className="font-semibold text-club-accent hover:underline" onClick={() => setAll(true)}>
                    Todos
                  </button>
                  <button className="font-semibold text-fg-muted hover:underline" onClick={() => setAll(false)}>
                    Nenhum
                  </button>
                  <button className="font-semibold text-fg-muted hover:underline" onClick={matchAll} title="Oferece a cada jogador exatamente o salário pedido">
                    Pagar o pedido
                  </button>
                </div>
              ) : undefined
            }
            className="flex-wrap"
          />
          {expiring.length > 0 && (
            <CardContent className="space-y-1.5">
              {expiring.map((p) => {
                const t = terms[p.id];
                if (!t) return null;
                const demand = demandOf(p, t.years);
                const low = t.on && t.wage < demand.wage;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'rounded-xl border px-3 py-2',
                      !t.on ? 'border-line/60 bg-surface-2/35' : low ? 'border-danger/60 bg-danger/[0.08]' : 'border-success/35 bg-surface-2/60',
                    )}
                  >
                    <label className="grid cursor-pointer grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_auto] items-center gap-2.5">
                      <input type="checkbox" checked={t.on} onChange={() => patch(p.id, { on: !t.on })} className="size-4 accent-[var(--club-accent)]" aria-label={`Renovar ${p.name}`} />
                      <PositionChip position={p.position} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{p.name}</span>
                        <span className="block text-[11px] text-fg-muted">
                          {p.age} anos · <b style={{ color: overallColor(p.overall) }}>{p.overall}</b> · hoje {fmtMoney(p.wage)}/mês
                        </span>
                      </span>
                      <span className="tabular text-right text-[11px]">
                        {t.on ? (
                          <>
                            <span className="text-fg-subtle">pede </span>
                            <span className="font-semibold text-fg">{fmtMoney(demand.wage)}</span>
                            <span className="block text-[10px] text-fg-subtle">
                              prefere {demand.minYears}–{demand.maxYears} anos
                            </span>
                          </>
                        ) : (
                          <span className="font-semibold text-danger">sai livre</span>
                        )}
                      </span>
                    </label>
                    {t.on && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-0 sm:pl-[4.75rem]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-fg-muted" title="valores em euros">€</span>
                          <Input
                            inputMode="numeric"
                            aria-label={`Salário oferecido a ${p.name}`}
                            value={t.wage.toLocaleString('pt-BR')}
                            onChange={(e) => patch(p.id, { wage: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0), edited: true })}
                            className="tabular h-8 w-32 text-sm font-semibold"
                          />
                          <span className="text-[11px] text-fg-subtle">/mês</span>
                        </div>
                        <NativeSelect
                          aria-label={`Duração do contrato de ${p.name}`}
                          value={String(t.years)}
                          className="w-28 [&_select]:h-8 [&_select]:text-xs"
                          onChange={(e) => {
                            const years = Number(e.target.value);
                            patch(p.id, { years, ...(t.edited ? {} : { wage: demandOf(p, years).wage }) });
                          }}
                        >
                          {[1, 2, 3, 4, 5].map((y) => (
                            <option key={y} value={y}>
                              {y} {y > 1 ? 'anos' : 'ano'}
                            </option>
                          ))}
                        </NativeSelect>
                        {low ? (
                          <span className="text-[11px] font-semibold text-danger">abaixo do pedido: vai recusar e sair livre</span>
                        ) : (
                          <span className="text-[11px] text-success">aceita</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="pt-2 text-[11px] text-fg-subtle">
                O pedido vem da engine (idade e overall do ano seguinte, reputação do clube); duração fora da faixa preferida encarece +6% por ano. Abaixo do pedido, o jogador
                recusa e sai como livre. Variação na folha: <b className="text-fg">{fmtMoneySigned(wageDelta)}</b>/mês
                {refusing.length > 0 && <span className="text-danger"> · {refusing.length === 1 ? '1 recusa prevista' : `${refusing.length} recusas previstas`}</span>}.
              </p>
            </CardContent>
          )}
        </Card>
      </motion.div>

      <motion.div variants={fadeUp} className="flex flex-col items-stretch gap-3 rounded-2xl border border-club-accent/30 bg-club-accent/[0.06] p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm text-fg-muted">
          A virada aplica acesso e rebaixamento, renovações ({renewing.length - refusing.length}{refusing.length ? `, ${refusing.length} devem recusar` : ''}) e aposentadorias da região
          {ti.aging ? ', a evolução anual e o envelhecimento (1º de julho), os juniores' : ' (o envelhecimento e os juniores do ano acontecem em 1º de julho)'} e monta o calendário de {next}. As competições das outras regiões seguem normalmente.
        </div>
        <Button variant="club" size="lg" disabled={rolling} onClick={() => void start()}>
          {rolling ? <Loader2 className="animate-spin" /> : <CalendarCheck />} Começar temporada {next}
        </Button>
      </motion.div>
    </motion.div>
  );
}

interface RenewRow {
  on: boolean;
  wage: number;
  years: number;
  /** salário editado à mão (mudar a duração não sobrescreve) */
  edited: boolean;
}

/* ───────────── vagas continentais ───────────── */

export function QualifierList({ rows, clubId }: { rows: QualifierRow[]; clubId: string }) {
  const groups: QualifierRow['comp'][] = ['Libertadores', 'Sul-Americana'];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => {
        const list = rows.filter((r) => r.comp === g);
        return (
          <div key={g}>
            <div className="mb-1.5 flex items-center gap-2">
              <ContinentalSeal compId={g === 'Libertadores' ? 'LIBERTADORES' : 'SULAMERICANA'} size={26} />
              <span className="text-sm font-bold">{g === 'Libertadores' ? 'Copa Libertadores' : 'Copa Sul-Americana'}</span>
              <span className="text-[11px] text-fg-subtle">{list.length} clubes</span>
            </div>
            <div className="space-y-1">
              {list.length === 0 && <p className="text-xs text-fg-muted">Nenhum clube do país.</p>}
              {list.map((r) => (
                <div key={r.clubId} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5', r.clubId === clubId ? 'border-club-accent/50 bg-club-accent/10' : 'border-line/60 bg-surface-2/35')}>
                  <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: ZONE_META[r.zone].color }} />
                  <ClubCrest id={r.clubId} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{clubLabel(r.clubId, true)}</div>
                    <div className="truncate text-[11px] text-fg-muted">{r.why}</div>
                  </div>
                  <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">{r.phase}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Prévia (antes da virada) das vagas do ano seguinte, com a regra da engine sobre a tabela final. */
function ContinentalPreviewCard({ state, world, clubId }: { state: SeasonState; world: WorldState; clubId: string }) {
  const data = useCareerData();
  const code = world.countryCode;
  const league = state.competitions.find((c) => c.id === `${code}-1`);
  const cupName = state.competitions.find((c) => c.id === `${code}-CUP`)?.name ?? 'Copa Nacional';
  const rows = useMemo(() => {
    if (!data || !league || code !== 'BRA' || world.options.continental === false || (state.segment && turnoverInfo(state).cycle !== 'calendar')) return null;
    const order = league.format ? finalRanking(league) : league.clubIds;
    const p = projectContinental(state, data, code, order);
    const national = new Set(data.clubs.filter((c) => c.countryId === world.countryId).map((c) => c.id));
    return qualifierRows(p.q, [...national], { leagueName: league.name, cupName, order });
  }, [data, league, code, world, state, cupName]);
  if (!rows) return null;
  return (
    <Card>
      <CardHeader icon={<Globe2 />} title={`Classificados para as continentais de ${state.season + 1}`} subtitle="Prévia pela tabela final e pela copa (confirmada na virada)" />
      <CardContent>
        <QualifierList rows={rows} clubId={clubId} />
      </CardContent>
    </Card>
  );
}

/** Depois da virada: classificados oficiais (summary.continental) com o motivo de cada vaga. */
function ContinentalSummaryCard({ q, ids, state, clubId, world }: { q: ContinentalQualifiers; ids: string[]; state: SeasonState; clubId: string; world: WorldState }) {
  const code = world.countryCode;
  const league = state.competitions.find((c) => c.id === `${code}-1`);
  const cupName = state.competitions.find((c) => c.id === `${code}-CUP`)?.name ?? 'Copa Nacional';
  // após a virada, world.lastRanking guarda a classificação final da liga do ano encerrado
  const rows = qualifierRows(q, ids, { leagueName: league?.name ?? 'campeonato nacional', cupName, order: world.lastRanking[`${code}-1`] });
  return (
    <Card>
      <CardHeader icon={<Globe2 />} title={`Continentais de ${q.season}`} subtitle="Clubes do país classificados e o motivo de cada vaga" />
      <CardContent>
        <QualifierList rows={rows} clubId={clubId} />
      </CardContent>
    </Card>
  );
}

/** Ordem: liga nacional, continentais, copas, regionais, estaduais e, por último, as ligas estrangeiras. */
const CAT_ORDER: Record<CompCategory, number> = { nacional: 0, continental: 1, copa: 2, regional: 3, estadual: 4, estrangeira: 5 };
function sortComps(list: Competition[], country = BRAZIL_COUNTRY_ID) {
  return list.slice().sort((a, b) =>
    CAT_ORDER[compCategory(a, country)] - CAT_ORDER[compCategory(b, country)] || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) ||
    (CONTINENTAL_ORDER.indexOf(a.id) - CONTINENTAL_ORDER.indexOf(b.id)) || (a.division ?? 0) - (b.division ?? 0) || (a.uf ?? '').localeCompare(b.uf ?? '') || a.name.localeCompare(b.name, 'pt-BR'),
  );
}

export function ChampionsCard({ state, clubId }: { state: SeasonState; clubId: string }) {
  const [allStates, setAllStates] = useState(false);
  const [foreign, setForeign] = useState(false);
  const humanUf = clubIndexEntry(clubId)?.state;
  const country = careerCountryOf(state);
  const list = sortComps(state.competitions, country).filter((c) => {
    const cat = compCategory(c, country);
    if (cat === 'estrangeira') return foreign;
    return c.type !== 'state' || c.clubIds.includes(clubId) || c.uf === humanUf || (allStates && c.division === 1);
  });
  const hasForeign = state.competitions.some((c) => compCategory(c, country) === 'estrangeira');
  return (
    <Card className="h-full">
      <CardHeader icon={<Trophy />} title="Campeões" subtitle={`Temporada ${state.segment ? turnoverInfo(state).label : state.season}`} className="flex-wrap" action={
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button className="text-xs font-semibold text-club-accent hover:underline" aria-pressed={allStates} onClick={() => setAllStates((v) => !v)}>
            {allStates ? 'Menos estaduais' : 'Todos os estaduais'}
          </button>
          {hasForeign && (
            <button className="text-xs font-semibold text-club-accent hover:underline" aria-pressed={foreign} onClick={() => setForeign((v) => !v)}>
              {foreign ? 'Sem estrangeiras' : 'Ligas estrangeiras'}
            </button>
          )}
        </div>
      } />
      <CardContent className="space-y-1.5">
        {list.map((c) => (
          <div key={c.id} className={cn('rounded-xl border px-3 py-2', c.championId === clubId ? 'border-warning/50 bg-warning/10' : 'border-line/60 bg-surface-2/35')}>
            <div className="flex items-center gap-2">
              {c.type === 'continental' || compCategory(c, country) === 'regional' ? (
                <ContinentalSeal compId={c.id} size={18} />
              ) : (
                <Crown className={cn('size-4 shrink-0', c.championId === clubId ? 'text-warning' : 'text-fg-subtle')} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg-muted">{c.name}</span>
              {c.championId ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <ClubCrest id={c.championId} size={18} />
                  <span className="truncate text-sm font-bold">{clubLabel(c.championId, true)}</span>
                </span>
              ) : (
                <span className="text-xs text-fg-subtle">—</span>
              )}
            </div>
            {(c.viceId || c.titles?.length) && (
              <div className="mt-0.5 truncate pl-6 text-[11px] text-fg-subtle">
                {c.viceId && <>vice {clubLabel(c.viceId, true)}</>}
                {c.titles?.map((t) => ` · ${t.title}: ${clubLabel(t.clubId, true)}`).join('')}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function MovesCard({ state, clubId }: { state: SeasonState; clubId: string }) {
  const humanUf = clubIndexEntry(clubId)?.state;
  const comps = sortComps(state.competitions).filter((c) => (c.type === 'league' || (c.type === 'state' && (c.uf === humanUf || c.clubIds.includes(clubId)))) && ((c.promotedIds?.length ?? 0) > 0 || (c.relegatedIds?.length ?? 0) > 0));
  const chip = (id: string, up: boolean) => (
    <span key={id} className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]', id === clubId ? (up ? 'border-success bg-success/15 font-bold text-success' : 'border-danger bg-danger/15 font-bold text-danger') : 'border-line')}>
      <ClubCrest id={id} size={14} />
      {clubLabel(id, true)}
    </span>
  );
  return (
    <Card>
      <CardHeader icon={<ArrowUp />} title="Acesso e rebaixamento" subtitle="Divisões nacionais e o estadual do seu estado" />
      <CardContent className="space-y-3">
        {comps.length === 0 && <p className="text-sm text-fg-muted">Sem movimentações registradas.</p>}
        {comps.map((c) => (
          <div key={c.id}>
            <div className="mb-1 text-[11px] font-semibold text-fg-muted">{c.name}</div>
            {(c.promotedIds?.length ?? 0) > 0 && (
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <ArrowUp className="size-3.5 text-success" />
                {c.promotedIds!.map((id) => chip(id, true))}
              </div>
            )}
            {(c.relegatedIds?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <ArrowDown className="size-3.5 text-danger" />
                {c.relegatedIds!.map((id) => chip(id, false))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PrizesCard({ state, clubId }: { state: SeasonState; clubId: string }) {
  const prizes = state.career?.prizes ?? {};
  const fin = state.clubs[clubId]?.finance;
  const mine = state.news.filter((n) => n.clubId === clubId && /premiação/i.test(n.text)).slice(-6);
  const main = sortComps(state.competitions).filter((c) => c.type !== 'state' || c.clubIds.includes(clubId));
  return (
    <Card>
      <CardHeader icon={<PiggyBank />} title="Premiação" subtitle={state.career?.prizeMode === 'proportional' ? 'Proporcional à colocação' : 'Fiel ao original: só o campeão recebe'} />
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between rounded-xl border border-line/70 bg-surface-2/40 px-3 py-2">
          <span className="text-xs text-fg-muted">Seu clube recebeu</span>
          <span className="tabular text-lg font-extrabold text-success">{fmtMoney(fin?.prizes ?? 0)}</span>
        </div>
        {mine.map((n, i) => (
          <p key={i} className="text-[11px] text-fg-muted">
            {n.text}
          </p>
        ))}
        <div className="space-y-1 pt-1">
          {main.map((c) => {
            const v = c.prizeKey ? prizes[c.prizeKey] : undefined;
            if (!v) return null;
            return (
              <div key={c.id} className="flex items-center gap-2 text-[11px]">
                <Medal className="size-3.5 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate text-fg-muted">{compShort(c)}</span>
                {c.championId && <ClubCrest id={c.championId} size={14} />}
                <span className="tabular font-semibold">{fmtMoney(v)}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ═════════════════════ depois da virada ═════════════════════ */

export function RolloverSummary({
  summary, world, state, clubId, mine,
}: {
  summary: SeasonSummary; world: WorldState; state: SeasonState; clubId: string;
  /** (online, vários humanos) filtra `humanReleased` aos jogadores deste clube */
  mine?: (playerId: string) => boolean;
}) {
  const navigate = useNavigate();
  const countries = useCountryMap();
  const myRet = summary.retirements.filter((r) => r.clubId === clubId);
  const myYouth = summary.youth.filter((y) => y.clubId === clubId);
  const released = summary.contracts.humanReleased.filter((id) => !mine || mine(id)).map((id) => world.players.data[id]).filter((p): p is Player => !!p);
  const refused = new Map((summary.contracts.refused ?? []).map((r) => [r.playerId, r]));
  // (Fase 2) a virada também cobre clubes estrangeiros: "no país" conta só os do país da carreira
  const isNational = (id: string) => (clubIndexEntry(id)?.countryId ?? world.countryId) === world.countryId;
  const nationalRet = summary.retirements.filter((r) => isNational(r.clubId));
  const cont = summary.continental;
  const div = Object.entries(world.divisions).find(([, ids]) => ids.includes(clubId))?.[0];
  const divComp = div ? state.competitions.find((c) => c.id === div) : undefined;
  const up = Object.entries(summary.promoted).some(([, ids]) => ids.includes(clubId));
  const down = Object.entries(summary.relegated).some(([, ids]) => ids.includes(clubId));
  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.section variants={fadeUp} className="cf-card p-5 sm:p-7">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-club-accent uppercase">Virada concluída</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Bem-vindo a {humanSeasonLabel(state)}</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {divComp ? (
            <>
              Seu clube disputa a <b className="text-fg">{divComp.name}</b>
              {up ? <span className="text-success"> (acesso conquistado!)</span> : down ? <span className="text-danger"> (rebaixado)</span> : ''}.
            </>
          ) : (
            'Seu clube disputa o estadual nesta temporada.'
          )}{' '}
          {summary.contracts.renewed} contratos renovados no país, {summary.contracts.released} jogadores liberados, {summary.contracts.signedFree} livres contratados pela CPU.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="club" onClick={() => navigate('/dashboard')}>
            <ArrowRight /> Ir para o painel
          </Button>
          <Button variant="outline" onClick={() => navigate('/historico')}>
            <Trophy /> Histórico
          </Button>
          <Button variant="outline" onClick={() => navigate('/elenco')}>
            Elenco
          </Button>
        </div>
      </motion.section>

      {cont && (
        <motion.div variants={fadeUp}>
          <ContinentalSummaryCard q={cont.qualifiers} ids={[...cont.libertadores, ...cont.sulamericana]} state={state} clubId={clubId} world={world} />
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <motion.div variants={fadeUp}>
          <Card className="h-full">
            <CardHeader icon={<Baby />} title="Juniores promovidos" subtitle={`${myYouth.length} no seu clube · ${summary.youth.filter((y) => isNational(y.clubId)).length} no país`} />
            <CardContent className="space-y-1.5">
              {myYouth.length === 0 && <p className="text-sm text-fg-muted">Nenhum júnior subiu para o seu elenco.</p>}
              {myYouth.map((y) => (
                <div key={y.playerId} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-2/35 px-2.5 py-1.5">
                  <Flag country={countries.get(y.nationalityId)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{y.name}</span>
                  <span className="tabular text-xs font-bold" style={{ color: overallColor(y.overall) }}>
                    {y.overall}
                  </span>
                  <span className="tabular text-[11px] text-fg-subtle">pot. {y.potential}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeUp}>
          <Card className="h-full">
            <CardHeader icon={<UserMinus />} title="Aposentadorias" subtitle={`${myRet.length} no seu clube · ${nationalRet.length} no país`} />
            <CardContent className="space-y-1.5">
              {myRet.length === 0 && <p className="text-sm text-fg-muted">Ninguém do seu elenco pendurou as chuteiras.</p>}
              {myRet.map((r) => (
                <div key={r.playerId} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-2/35 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                  <span className="tabular text-[11px] text-fg-muted">{r.age} anos · {r.overall}</span>
                </div>
              ))}
              {summary.retirements.length > myRet.length && (
                <p className="pt-1 text-[11px] text-fg-subtle">
                  Outros: {nationalRet.filter((r) => r.clubId !== clubId).slice(0, 6).map((r) => `${r.name} (${clubLabel(r.clubId, true)})`).join(', ')}…
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeUp}>
          <Card className="h-full">
            <CardHeader icon={<FileSignature />} title="Contratos" subtitle="Saídas do seu elenco" />
            <CardContent className="space-y-1.5">
              {released.length === 0 && (
                <p className="flex items-center gap-1.5 text-sm text-fg-muted">
                  <Check className="size-4 text-success" /> Nenhum jogador saiu por fim de contrato.
                </p>
              )}
              {released.map((p) => {
                const ref = refused.get(p.id);
                return (
                  <div key={p.id} className={cn('rounded-lg border px-2.5 py-1.5', ref ? 'border-danger/40 bg-danger/[0.06]' : 'border-line/60 bg-surface-2/35')}>
                    <div className="flex items-center gap-2">
                      <PositionChip position={p.position} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-danger">{ref ? <><XCircle className="size-3.5" /> recusou</> : 'livre'}</span>
                    </div>
                    {ref && (
                      <p className="mt-0.5 pl-12 text-[11px] text-fg-muted">
                        Pediu {fmtMoney(ref.asked)}/mês, você ofereceu {fmtMoney(ref.offered)}. {ref.reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader icon={<ArrowUp />} title={`Acesso e rebaixamento · ${summary.seasonLabel ?? summary.season}`} subtitle="Divisões nacionais da temporada seguinte (região que virou)" />
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {Object.entries(summary.promoted).map(([div, ids]) => (
              <div key={`p${div}`} className="text-[12px]">
                <div className="mb-1 font-semibold text-success">Sobem de {divName(state, div)}</div>
                <div className="text-fg-muted">{ids.map((id) => (id === clubId ? `★ ${clubLabel(id, true)}` : clubLabel(id, true))).join(', ')}</div>
              </div>
            ))}
            {Object.entries(summary.relegated).map(([div, ids]) => (
              <div key={`r${div}`} className="text-[12px]">
                <div className="mb-1 font-semibold text-danger">Caem de {divName(state, div)}</div>
                <div className="line-clamp-3 text-fg-muted">{ids.map((id) => (id === clubId ? `★ ${clubLabel(id, true)}` : clubLabel(id, true))).join(', ')}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function divName(state: SeasonState, id: string) {
  return state.competitions.find((c) => c.id === id)?.name.replace(/^Brasileirão /, '') ?? id;
}
