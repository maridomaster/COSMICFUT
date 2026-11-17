import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Award, CalendarDays, Crown, GitBranch, Info, ListOrdered, Medal, Ticket, Trophy, Volleyball } from 'lucide-react';
import type { KnockoutStageDef } from '@cosmicfut/shared';
import type { Competition, SeasonState } from '@cosmicfut/engine';
import { squads } from '@/data/squads';
import { useCountryMap } from '@/data/hooks';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeasonState, useWorld } from '@/store/season';
import {
  bracketOf, clubStatusIn, compShort, currentStageId, groupTables, myCompetitions, stageTitle, tieView, topScorers,
  type BracketRound, type TieView,
} from '@/season/comps';
import { clubTable, humanIdOf, humanSeasonLabel, REGION_LABEL, weekOf, type Zone } from '@/season/view';
import { describeFormat } from '@/season/formatText';
import {
  CATEGORY_LABEL, CONTINENTAL_ORDER, careerCountryOf, compCategory, confedRows, leagueVagas, qualifierRows, slotRules, vagasZone,
  type CompCategory, type ConfedRow, type QualProjection,
} from '@/season/continental';
import type { QualZoneInfo } from '@cosmicfut/engine';
import { useQualProjection } from '@/season/useContinental';
import { useCareerData } from '@/career/useCareerData';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Flag } from '@/components/game/bits';
import { ContinentalSeal } from '@/components/game/ContinentalSeal';
import { StandingsTable, ZoneLegend, ZONE_META, withQualZones, zonesIn } from '@/components/game/standings';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { clubIndexEntry } from '@/data/clubIndex';

type Category = CompCategory;

const CATS: Category[] = ['nacional', 'copa', 'continental', 'regional', 'estadual', 'estrangeira'];

export function CompetitionsPage() {
  const season = useSeasonState();
  const world = useWorld();
  const human = humanIdOf(season);
  const country = careerCountryOf(season);
  const humanUf = clubIndexEntry(human)?.state ?? null;
  const countries = useCountryMap();
  const [params, setParams] = useSearchParams();
  const catOf = (c: Competition) => compCategory(c, country);
  const mine = useMemo(() => myCompetitions(season, human), [season, human]);
  const defaultId = mine[0]?.id ?? season.competitions[0]?.id;
  const compId = params.get('c') ?? defaultId;
  const comp = season.competitions.find((c) => c.id === compId) ?? season.competitions.find((c) => c.id === defaultId);
  const catParam = params.get('cat') as Category | null;
  const cat: Category = catParam && CATS.includes(catParam) ? catParam : comp ? catOf(comp) : 'nacional';

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true },
    );

  const byCat = useMemo(() => {
    const out: Record<Category, Competition[]> = { nacional: [], copa: [], estadual: [], continental: [], regional: [], estrangeira: [] };
    for (const c of season.competitions) out[compCategory(c, country)].push(c);
    out.nacional.sort((a, b) => (a.division ?? 0) - (b.division ?? 0));
    out.continental.sort((a, b) => (CONTINENTAL_ORDER.indexOf(a.id) + 1 || 99) - (CONTINENTAL_ORDER.indexOf(b.id) + 1 || 99));
    // (Etapa 1) estrangeiras por região, país e divisão (liga, copa, supercopa)
    const tOrd: Record<string, number> = { league: 0, cup: 1, supercup: 2 };
    out.estrangeira.sort((a, b) => (a.region ?? '').localeCompare(b.region ?? '') || (a.countryId ?? 0) - (b.countryId ?? 0) || (tOrd[a.type] ?? 9) - (tOrd[b.type] ?? 9) || (a.division ?? 0) - (b.division ?? 0) || a.name.localeCompare(b.name, 'pt-BR'));
    return out;
  }, [season.competitions, country]);
  const ufs = useMemo(() => [...new Set(byCat.estadual.map((c) => c.uf ?? ''))].filter(Boolean).sort(), [byCat]);
  const uf = comp?.type === 'state' ? (comp.uf ?? humanUf ?? ufs[0]) : (params.get('uf') ?? humanUf ?? ufs[0]);
  // continentais: carreira no Brasil (o save migrado só as terá na temporada seguinte)
  const continentalOn = !!world && world.countryCode === 'BRA' && world.options.continental !== false;
  const visibleCats = CATS.filter((k) => byCat[k].length > 0 || (k === 'continental' && continentalOn));

  const pickCat = (k: Category) => {
    const list = k === 'estadual' ? byCat.estadual.filter((c) => c.uf === uf) : byCat[k];
    const target = list.find((c) => c.clubIds.includes(human)) ?? list[0];
    if (target) update({ c: target.id, cat: k, s: null });
    else update({ cat: k, s: null });
  };

  if (!comp) {
    return <p className="text-sm text-fg-muted">Nenhuma competição nesta temporada.</p>;
  }
  const listInCat = cat === 'estadual' ? byCat.estadual.filter((c) => c.uf === uf) : byCat[cat];
  const emptyCat = listInCat.length === 0;
  const chips = cat === 'continental' || cat === 'regional' || cat === 'estrangeira';

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cf-label text-club-accent">
            Temporada {humanSeasonLabel(season)} · Semana {weekOf(season.date)}
          </p>
          <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">Competições</h1>
          <p className="text-xs text-fg-muted">Tabelas por fase, chaves do mata-mata, artilharia e campeões.</p>
        </div>
      </motion.header>

      {/* atalhos: minhas competições */}
      {mine.length > 0 && (
        <motion.div variants={fadeUp} className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {mine.map((c) => {
            const st = clubStatusIn(c, human, (id) => clubLabel(id, true));
            const on = c.id === comp.id;
            const special = c.type === 'continental' || catOf(c) === 'regional';
            return (
              <button
                key={c.id}
                onClick={() => update({ c: c.id, cat: catOf(c), s: null })}
                className={cn(
                  'flex min-w-[10.5rem] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                  on ? 'border-club-accent/60 bg-club-accent/10' : 'border-line bg-surface-2/40 hover:border-line-strong',
                )}
              >
                {/* (Sala de Troféus) emblema de toda competição; `special` mantido para o restante do card */}
                <ContinentalSeal compId={c.id} size={special ? 30 : 28} />
                <span className="flex min-w-0 flex-col items-start">
                  <span className="text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">Seu clube</span>
                  <span className="max-w-[12rem] truncate text-sm font-bold">{compShort(c)}</span>
                  <span className={cn('max-w-[12rem] truncate text-[11px] font-semibold', toneCls(st.tone))}>{st.text}</span>
                </span>
              </button>
            );
          })}
        </motion.div>
      )}

      {/* seletor */}
      <motion.div variants={fadeUp} className="cf-card flex flex-col gap-3 p-3">
        <div
          role="tablist"
          aria-label="Categoria"
          className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-2/60 p-1 sm:flex sm:flex-wrap"
        >
          {visibleCats.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={cat === k}
              onClick={() => pickCat(k)}
              className={cn('h-8 rounded-lg px-3 text-xs font-semibold transition-colors sm:flex-1', cat === k ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg')}
            >
              {CATEGORY_LABEL[k]}
            </button>
          ))}
        </div>
        {chips ? (
          !emptyCat && (
            <div className="flex flex-wrap gap-1.5" role="list" aria-label={CATEGORY_LABEL[cat]}>
              {listInCat.map((c) => {
                const on = c.id === comp.id;
                const ctry = c.countryId !== undefined ? countries.get(c.countryId) : undefined;
                return (
                  <button
                    key={c.id}
                    role="listitem"
                    aria-current={on || undefined}
                    onClick={() => update({ c: c.id, cat, s: null })}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                      on ? 'border-club-accent/60 bg-club-accent/10 text-fg' : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
                    )}
                  >
                    {cat === 'estrangeira' ? <Flag country={ctry} /> : <ContinentalSeal compId={c.id} size={22} />}
                    <span className="max-w-[16rem] truncate" title={[c.region ? REGION_LABEL[c.region] : '', c.name, c.seasonLabel].filter(Boolean).join(' · ')}>
                      {cat === 'estrangeira' ? `${ctry?.name ?? ''} · ${c.type === 'league' ? `${c.division ?? 1}ª div.` : compShort(c)}` : compShort(c)}
                      {c.seasonLabel && <span className="ml-1 font-normal text-fg-subtle">{c.seasonLabel}</span>}
                    </span>
                    {c.clubIds.includes(human) && <span className="text-club-accent">★</span>}
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {cat === 'estadual' && (
              <NativeSelect
                aria-label="Estado"
                value={uf}
                className="sm:w-28"
                onChange={(e) => {
                  const list = byCat.estadual.filter((c) => c.uf === e.target.value);
                  const target = list.find((c) => c.clubIds.includes(human)) ?? list[0];
                  if (target) update({ c: target.id, cat: 'estadual', uf: e.target.value, s: null });
                }}
              >
                {ufs.map((u) => (
                  <option key={u} value={u}>
                    {u}
                    {u === humanUf ? ' ★' : ''}
                  </option>
                ))}
              </NativeSelect>
            )}
            <NativeSelect aria-label="Competição" value={catOf(comp) === cat ? comp.id : ''} className="min-w-0 flex-1" onChange={(e) => update({ c: e.target.value, s: null })}>
              {catOf(comp) !== cat && <option value="">Escolha…</option>}
              {listInCat.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.seasonLabel ? ` ${c.seasonLabel}` : ''}
                  {c.type === 'state' ? ` (${c.division}ª div.)` : ''}
                  {c.clubIds.includes(human) ? ' ★' : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </motion.div>

      {emptyCat && cat === 'continental' ? (
        <motion.div variants={fadeUp}>
          <ContinentalSoon season={season.season} />
        </motion.div>
      ) : (
        <CompetitionView key={comp.id} comp={comp} human={human} season={season} stageParam={params.get('s')} onStage={(s) => update({ s })} />
      )}
    </motion.div>
  );
}

function toneCls(t: 'gold' | 'good' | 'bad' | 'neutral') {
  return t === 'gold' ? 'text-warning' : t === 'good' ? 'text-success' : t === 'bad' ? 'text-danger' : 'text-fg-muted';
}

/** Save migrado da Fase 1: as continentais só existem a partir da temporada seguinte. */
function ContinentalSoon({ season }: { season: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex -space-x-2">
          {['LIBERTADORES', 'SULAMERICANA', 'INTERCONTINENTAL'].map((id) => (
            <ContinentalSeal key={id} compId={id} size={44} />
          ))}
        </div>
        <h2 className="text-lg font-extrabold">Competições continentais começam em {season + 1}</h2>
        <p className="max-w-lg text-sm text-fg-muted">
          Este save é de antes das continentais. A temporada {season} segue com as competições nacionais; na virada, as vagas da
          Libertadores e da Sul-Americana são definidas pela tabela da Série A e pela Copa do Brasil.
        </p>
      </CardContent>
    </Card>
  );
}

function CompetitionView({
  comp, human, season, stageParam, onStage,
}: { comp: Competition; human: string; season: SeasonState; stageParam: string | null; onStage: (s: string) => void }) {
  const countries = useCountryMap();
  const stages = comp.format?.stages ?? [];
  const stageId = stages.some((s) => s.id === stageParam) ? stageParam! : currentStageId(comp);
  const def = stages.find((s) => s.id === stageId);
  const played = comp.fixtures.filter((f) => f.result).length;
  const formatText = useMemo(() => describeFormat(comp.format), [comp.format]);
  const cat = compCategory(comp, careerCountryOf(season));
  const proj = useQualProjection(season, comp);
  // (Etapa 2) "Vagas" de qualquer liga: zonas da regra (UEFA/AFC/CONMEBOL, acesso, playoffs, rebaixamento)
  const careerData = useCareerData();
  const world = useWorld();
  const vagas = useMemo(() => (proj ? [] : leagueVagas(careerData, comp)), [proj, careerData, comp]);
  const vagasFn = useMemo(() => (vagas.length ? vagasZone(vagas) : undefined), [vagas]);
  // copas de jogo único por fase (Intercontinental): todas as fases numa trilha só
  const flow = stages.length > 1 && stages.every((s) => s.kind === 'knockout' && s.rounds.length === 1 && s.rounds[0].tie.legs === 1);
  const ctry = cat === 'estrangeira' && comp.countryId !== undefined ? countries.get(comp.countryId) : undefined;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-3">
        <motion.section variants={fadeUp} className="cf-card relative overflow-hidden p-4 sm:p-5">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_120%_at_0%_0%,color-mix(in_oklab,var(--club-accent)_14%,transparent),transparent_70%)]" />
          <div className="relative flex flex-wrap items-start gap-4">
            {cat !== 'estrangeira' || !ctry ? (
              <ContinentalSeal compId={comp.id} size={52} title={comp.name} />
            ) : (
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-club-accent/15 text-club-accent">
                {ctry ? <Flag country={ctry} className="h-6" /> : <Trophy className="size-6" />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">{comp.name}</h2>
              {formatText && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-fg-muted">{formatText}</p>}
              <p className="mt-1 text-[11px] text-fg-subtle">
                {ctry ? `${ctry.name} · ` : ''}
                {comp.clubIds.length} clubes · {played}/{comp.fixtures.length} jogos disputados{comp.finished ? ' · encerrada' : ''}
                {cat === 'estrangeira' ? ' · simulação leve' : ''}
              </p>
            </div>
            {comp.championId && (
              <div className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
                <Crown className="size-5 text-warning" />
                <ClubCrest id={comp.championId} size={26} />
                <div className="leading-tight">
                  <div className="text-[10px] font-semibold tracking-wider text-warning uppercase">Campeão</div>
                  <div className="text-sm font-bold">{clubLabel(comp.championId)}</div>
                </div>
              </div>
            )}
          </div>
          {stages.length > 1 && !flow && (
            <div className="scrollbar-thin relative mt-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Fases">
              {stages.map((s) => {
                const st = comp.stages?.[s.id];
                const on = s.id === stageId;
                return (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => onStage(s.id)}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                      on ? 'border-club-accent bg-club-accent text-club-on-accent' : 'border-line text-fg-muted hover:text-fg',
                    )}
                  >
                    {s.kind === 'knockout' ? <GitBranch className="size-3.5" /> : <ListOrdered className="size-3.5" />}
                    {stageTitle(s)}
                    {s.title && <Trophy className="size-3" aria-label="vale troféu" />}
                    <span className={cn('size-1.5 rounded-full', st?.status === 'active' ? 'bg-success' : st?.status === 'done' ? 'bg-fg-subtle' : 'bg-transparent ring-1 ring-fg-subtle')} title={st?.status === 'active' ? 'em andamento' : st?.status === 'done' ? 'concluída' : 'a definir'} />
                    <span className="sr-only">({st?.status === 'active' ? 'em andamento' : st?.status === 'done' ? 'concluída' : 'a definir'})</span>
                  </button>
                );
              })}
            </div>
          )}
        </motion.section>

        <motion.div variants={fadeUp}>
          {flow ? (
            <StagesFlow comp={comp} human={human} />
          ) : !comp.format ? (
            <SimpleTable comp={comp} human={human} proj={proj} />
          ) : def && comp.stages?.[def.id] && comp.stages[def.id].status !== 'pending' ? (
            def.kind === 'table' ? (
              <StageTables comp={comp} stageId={def.id} human={human} qual={proj?.zone} vagas={def.id === 'league' ? vagasFn : undefined} />
            ) : (
              <Bracket comp={comp} stageId={def.id} human={human} />
            )
          ) : def ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-fg-muted">
                <b className="text-fg">{stageTitle(def)}</b> ainda não começou — os {def.kind === 'knockout' ? 'confrontos' : 'grupos'} saem quando a fase anterior terminar.
                {def.kind === 'knockout' && <PendingRounds def={def as KnockoutStageDef} />}
              </CardContent>
            </Card>
          ) : null}
        </motion.div>
      </div>

      <div className="min-w-0 space-y-3">
        {proj && (
          <motion.div variants={fadeUp}>
            <VagasCard proj={proj} comp={comp} human={human} season={season} />
          </motion.div>
        )}
        {!proj && vagas.length > 0 && (
          <motion.div variants={fadeUp}>
            <LeagueVagasCard comp={comp} zones={vagas} human={human} rows={comp.division === 1 ? confedRows(world, careerData, comp.countryId) : { season: null, rows: [] }} />
          </motion.div>
        )}
        <motion.div variants={fadeUp}>
          <TitlesCard comp={comp} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <ScorersCard comp={comp} human={human} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <Link to={`/calendario?tab=jogos&c=${encodeURIComponent(comp.id)}`} className="flex items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-xs font-semibold text-fg-muted hover:text-fg">
            <CalendarDays className="size-4" /> Jogos da competição no Calendário
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

function PendingRounds({ def }: { def: KnockoutStageDef }) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {def.rounds.map((r) => (
        <span key={r.name} className="rounded-md border border-line px-2 py-0.5 text-[11px]">
          {r.name} · {r.tie.legs === 2 ? 'ida e volta' : r.tie.neutral ? 'jogo único (neutro)' : 'jogo único'}
        </span>
      ))}
    </div>
  );
}

function SimpleTable({ comp, human, proj }: { comp: Competition; human: string; proj: QualProjection | null }) {
  const t = clubTable(comp);
  const zone = withQualZones(t.rows, t.zone, proj?.zone);
  return (
    <Card>
      <CardHeader icon={<ListOrdered />} title="Classificação" subtitle={comp.name} action={<ZoneLegend comp={comp} zones={proj ? zonesIn(t.rows.length, zone) : undefined} />} className="flex-wrap" />
      <CardContent className="px-2 sm:px-4">
        <StandingsTable comp={comp} rows={t.rows} zone={zone} highlightId={human} />
      </CardContent>
    </Card>
  );
}

/**
 * Tabelas de uma fase (um card por grupo), com zonas derivadas do formato (+ vagas continentais projetadas).
 * (Etapa 2) `vagas`: zonas da regra da liga (Liga dos Campeões, Liga Europa, AFC, playoffs...) por posição.
 */
export function StageTables({ comp, stageId, human, qual, vagas }: { comp: Competition; stageId: string; human: string; qual?: QualProjection['zone']; vagas?: (pos: number) => Zone }) {
  const tables = useMemo(
    () =>
      groupTables(comp, stageId).map((t) => {
        const base = (p: number): Zone => {
          const v = vagas?.(p) ?? t.zone(p);
          return v === 'playoff' ? 'relegation' : v;
        };
        return { ...t, z: withQualZones(t.rows, base, qual) };
      }),
    [comp, stageId, qual, vagas],
  );
  const many = tables.length > 2;
  const legend = useMemo(() => {
    const s = new Set<Exclude<Zone, null>>();
    for (const t of tables) for (const z of zonesIn(t.rows.length, t.z)) s.add(z);
    return (Object.keys(ZONE_META) as Exclude<Zone, null>[]).filter((z) => s.has(z));
  }, [tables]);
  // grupo do humano primeiro em fases com muitos grupos
  const ordered = useMemo(() => {
    if (!many) return tables;
    const i = tables.findIndex((t) => t.rows.some((r) => r.clubId === human));
    return i > 0 ? [tables[i], ...tables.slice(0, i), ...tables.slice(i + 1)] : tables;
  }, [tables, many, human]);
  return (
    <div className="space-y-3">
      <div className="px-1">
        <ZoneLegend comp={comp} zones={legend} />
      </div>
      <div className={cn('grid gap-4', many ? 'md:grid-cols-2' : tables.length === 2 ? 'lg:grid-cols-2' : '')}>
        {ordered.map((t) => (
          <Card key={t.name}>
            <CardHeader icon={<ListOrdered />} title={t.name} subtitle={`${t.rows.length} clubes`} />
            <CardContent className="px-2 sm:px-4">
              <StandingsTable comp={comp} rows={t.rows} compact={many} zone={t.z} highlightId={human} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ───────────── chave do mata-mata ───────────── */

export function Bracket({ comp, stageId, human }: { comp: Competition; stageId: string; human: string }) {
  const { rounds, third } = useMemo(() => bracketOf(comp, stageId), [comp, stageId]);
  const def = comp.format?.stages.find((s) => s.id === stageId) as KnockoutStageDef | undefined;
  const scroller = useRef<HTMLDivElement>(null);
  // rola até a rodada atual (a primeira com confronto sem vencedor)
  const current = rounds.findIndex((r) => r.ties.some((t) => !t.tie.winner) || r.placeholders > 0);
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-round="${current}"]`);
    if (el && scroller.current) scroller.current.scrollLeft = Math.max(0, el.offsetLeft - 16);
  }, [current]);
  const big = (rounds[0]?.ties.length ?? 0) > 16;
  return (
    <Card>
      <CardHeader icon={<GitBranch />} title={def && def.name !== 'Fase Final' && rounds.length === 1 ? def.name : 'Chave'} subtitle={rounds.map((r) => r.name).join(' → ')} />
      <CardContent className="px-2 sm:px-4">
        <div ref={scroller} className="scrollbar-thin overflow-x-auto pb-2">
          <div className="flex min-w-max items-stretch gap-3">
            {rounds.map((r) => (
              <RoundColumn key={r.index} round={r} def={def} human={human} compact={big && r.index === 0} />
            ))}
          </div>
        </div>
        {third && (
          <div className="mt-3 max-w-xs">
            <div className="mb-1 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">Disputa de 3º lugar</div>
            <TieCard v={third} human={human} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function legsLabel(tie: { legs: number; neutral?: boolean } | undefined) {
  return tie ? (tie.legs === 2 ? 'ida e volta' : tie.neutral ? 'jogo único · campo neutro' : 'jogo único') : '';
}

function RoundColumn({ round, def, human, compact }: { round: BracketRound; def: KnockoutStageDef | undefined; human: string; compact: boolean }) {
  const tie = def?.rounds[round.index]?.tie;
  return (
    <div data-round={round.index} className="flex w-[13.5rem] shrink-0 flex-col">
      <div className="mb-2 px-1">
        <div className="truncate text-xs font-bold">{round.name}</div>
        <div className="text-[10px] text-fg-subtle">{legsLabel(tie)}</div>
      </div>
      <div className={cn('flex flex-1 flex-col justify-around', compact ? 'gap-1' : 'gap-2')}>
        {round.ties.map((v) => (
          <TieCard key={v.tie.id} v={v} human={human} />
        ))}
        {Array.from({ length: round.placeholders }, (_, i) => (
          <div key={`p${i}`} className="grid h-[3.6rem] place-items-center rounded-xl border border-dashed border-line text-[11px] text-fg-subtle">
            a definir
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Trilha de fases de jogo único (Copa Intercontinental): cada fase é um confronto; as que valem troféu
 * (Dérbi das Américas, Copa África-Ásia-Pacífico, Challenger Cup) mostram o campeão da etapa.
 */
function StagesFlow({ comp, human }: { comp: Competition; human: string }) {
  const stages = comp.format?.stages ?? [];
  return (
    <Card>
      <CardHeader icon={<GitBranch />} title="Caminho da taça" subtitle="Jogos únicos em campo neutro · empate → pênaltis" />
      <CardContent className="px-2 sm:px-4">
        <div className="scrollbar-thin overflow-x-auto pb-2">
          <div className="flex min-w-max items-stretch gap-2">
            {stages.map((s, i) => {
              const ties = comp.stages?.[s.id]?.ties ?? [];
              const title = s.title ? comp.titles?.find((t) => t.title === s.title) : undefined;
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="flex w-[13.5rem] shrink-0 flex-col">
                    <div className="mb-2 flex items-center gap-1.5 px-1">
                      {s.title && <Trophy className="size-3.5 shrink-0 text-warning" />}
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold">{s.name}</div>
                        <div className="text-[10px] text-fg-subtle">{s.title ? 'vale troféu' : s.id === comp.format?.champion ? 'decide o título' : 'eliminatória'}</div>
                      </div>
                    </div>
                    {ties.length ? (
                      ties.map((t) => <TieCard key={t.id} v={tieView(comp, t)} human={human} />)
                    ) : (
                      <div className="grid h-[3.6rem] place-items-center rounded-xl border border-dashed border-line text-[11px] text-fg-subtle">a definir</div>
                    )}
                    {title && (
                      <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">
                        <Crown className="size-3.5" />
                        <ClubCrest id={title.clubId} size={14} />
                        <span className="truncate">{clubLabel(title.clubId, true)}</span>
                      </div>
                    )}
                  </div>
                  {i < stages.length - 1 && <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TieCard({ v, human }: { v: TieView; human: string }) {
  const { tie } = v;
  const mine = tie.a === human || tie.b === human;
  const row = (id: string, isA: boolean) => {
    const won = tie.winner === id;
    const lost = tie.loser === id;
    const legGoals = v.legs.map((f) => (f.result ? (f.homeId === id ? f.result.home : f.result.away) : null));
    const agg = isA ? v.agg.a : v.agg.b;
    const pen = v.pens ? (isA ? v.pens.a : v.pens.b) : undefined;
    return (
      <div className={cn('flex items-center gap-1.5 px-2 py-1', lost && 'opacity-50')}>
        <ClubCrest id={id} size={16} />
        <span className={cn('min-w-0 flex-1 truncate text-[12px]', won ? 'font-bold' : 'font-medium', id === human && 'text-club-accent')}>{clubLabel(id, true)}</span>
        {v.legs.length > 1 &&
          legGoals.map((g, i) => (
            <span key={i} className="tabular w-3.5 text-center text-[11px] text-fg-muted">
              {g ?? '·'}
            </span>
          ))}
        <span className={cn('tabular w-5 rounded text-center text-[12px] font-extrabold', v.anyPlayed ? (won ? 'bg-success/20 text-success' : 'bg-surface-3') : 'text-fg-subtle')}>
          {v.anyPlayed ? agg : '–'}
        </span>
        {pen !== undefined && <span className="tabular w-6 text-[10px] font-semibold text-fg-muted">({pen})</span>}
      </div>
    );
  };
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-surface-2/50', mine ? 'border-club-accent/60 ring-1 ring-club-accent/30' : 'border-line')}>
      {row(tie.a, true)}
      <div className="h-px bg-line/70" />
      {row(tie.b, false)}
    </div>
  );
}

/* ───────────── lateral ───────────── */

/** (Fase 2) Vagas continentais pela tabela da Série A (regra da engine, com repasse) + projeção atual. */
function VagasCard({ proj, comp, human, season }: { proj: QualProjection; comp: Competition; human: string; season: SeasonState }) {
  const data = useCareerData();
  const world = useWorld();
  const code = world?.countryCode ?? 'BRA';
  const rules = data ? slotRules(data, code) : null;
  const cupName = season.competitions.find((c) => c.id === `${code}-CUP`)?.name ?? 'Copa Nacional';
  const order = useMemo(() => clubTable(comp).rows.map((r) => r.clubId), [comp]);
  // na ordem da tabela (as listas da engine vêm ordenadas por pote/força)
  const rows = useMemo(
    () =>
      qualifierRows(proj.q, order, { leagueName: /^Brasileirão/.test(comp.name) ? 'Brasileirão' : comp.name, cupName, order })
        .sort((a, b) => (order.indexOf(a.clubId) + 1 || 99) - (order.indexOf(b.clubId) + 1 || 99)),
    [proj, order, comp, cupName],
  );
  const zoneRows: { zone: 'libertadores' | 'libpre' | 'sula'; label: string; range: string }[] = [];
  if (rules) {
    let p = 1;
    const range = (n: number) => (n <= 1 ? `${p}º` : `${p}º–${p + n - 1}º`);
    if (rules.libGroups) { zoneRows.push({ zone: 'libertadores', label: `G${rules.libGroups} · Libertadores, fase de grupos`, range: range(rules.libGroups) }); p += rules.libGroups; }
    if (rules.libF2) { zoneRows.push({ zone: 'libpre', label: `G${p + rules.libF2 - 1} · Libertadores, 2ª fase (preliminar)`, range: range(rules.libF2) }); p += rules.libF2; }
    if (rules.libF1) { zoneRows.push({ zone: 'libpre', label: 'Libertadores, 1ª fase (preliminar)', range: range(rules.libF1) }); p += rules.libF1; }
    if (rules.sulaGroups) { zoneRows.push({ zone: 'sula', label: 'Sul-Americana, fase de grupos', range: range(rules.sulaGroups) }); p += rules.sulaGroups; }
    if (rules.sulaPrelim) zoneRows.push({ zone: 'sula', label: 'Sul-Americana, preliminar', range: range(rules.sulaPrelim) });
  }
  return (
    <Card>
      <CardHeader icon={<Ticket />} title="Vagas" subtitle={`Continentais de ${proj.season} pela tabela`} />
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {zoneRows.map((z) => (
            <div key={z.label} className="flex items-center gap-2 text-xs">
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: ZONE_META[z.zone].color }} />
              <span className="tabular w-14 shrink-0 font-bold">{z.range}</span>
              <span className="min-w-0 flex-1 text-fg-muted">{z.label}</span>
            </div>
          ))}
        </div>
        <p className="flex gap-1.5 text-[11px] leading-relaxed text-fg-subtle">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {rules?.cupSlot ? `O campeão da ${cupName} tem vaga nos grupos. ` : ''}Os campeões da Libertadores e da Sul-Americana também entram direto. Se um clube já
            classificado ocupa uma vaga da tabela, ela passa ao próximo colocado (repasse).
            {proj.cupPending ? ` A vaga da ${cupName} está reservada até a final.` : ''}
          </span>
        </p>
        {rows.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">{comp.finished ? 'Classificados' : 'Se terminasse hoje'}</div>
            <div className="space-y-1">
              {rows.map((r) => (
                <div key={r.clubId} className={cn('flex items-center gap-2 rounded-lg px-2 py-1', r.clubId === human ? 'bg-club-accent/10' : 'odd:bg-surface-2/35')}>
                  <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: ZONE_META[r.zone].color }} />
                  <ClubCrest id={r.clubId} size={16} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{clubLabel(r.clubId, true)}</span>
                  <span className="truncate text-right text-[10px] text-fg-muted" title={`${r.comp} · ${r.phase}`}>
                    {r.why}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * (Etapa 2) Vagas de qualquer liga: zonas da regra (Liga dos Campeões / Liga Europa / Conferência, AFC Elite,
 * Libertadores / Sul-Americana, acesso, playoffs e rebaixamento) + os clubes do país nas vagas gravadas no mundo.
 */
function LeagueVagasCard({ comp, zones, human, rows }: { comp: Competition; zones: QualZoneInfo[]; human: string; rows: { season: number | null; rows: ConfedRow[] } }) {
  const label = (s: number) => `${s}/${String((s + 1) % 100).padStart(2, '0')}`;
  return (
    <Card>
      <CardHeader icon={<Ticket />} title="Vagas" subtitle={`${comp.name} · zonas da tabela`} />
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {zones.map((z) => (
            <div key={`${z.zone}-${z.from}`} className="flex items-center gap-2 text-xs">
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: ZONE_META[z.zone].color }} />
              <span className="tabular w-14 shrink-0 font-bold">{z.from === z.to ? `${z.from}º` : `${z.from}º–${z.to}º`}</span>
              <span className="min-w-0 flex-1 text-fg-muted">{z.label}</span>
            </div>
          ))}
        </div>
        <p className="flex gap-1.5 text-[11px] leading-relaxed text-fg-subtle">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            As vagas são gravadas na virada pela tabela final, pelos campeões das copas e pelos campeões continentais. Se um clube já
            classificado ocupa uma vaga, ela passa ao próximo colocado (repasse). As vagas restantes vão a clubes convidados.
          </span>
        </p>
        {rows.rows.length > 0 && rows.season !== null && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">Classificados · {label(rows.season)}</div>
            <div className="space-y-1">
              {rows.rows.map((r) => (
                <div key={r.clubId} className={cn('flex items-center gap-2 rounded-lg px-2 py-1', r.clubId === human ? 'bg-club-accent/10' : 'odd:bg-surface-2/35')}>
                  <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: ZONE_META[r.zone].color }} />
                  <ClubCrest id={r.clubId} size={16} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{clubLabel(r.clubId, true)}</span>
                  <span className="truncate text-right text-[10px] text-fg-muted" title={r.why}>
                    {r.comp}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TitlesCard({ comp }: { comp: Competition }) {
  const items: { label: string; clubId: string | null; icon: 'gold' | 'silver' | 'title' }[] = [];
  if (comp.championId) items.push({ label: 'Campeão', clubId: comp.championId, icon: 'gold' });
  if (comp.viceId) items.push({ label: 'Vice', clubId: comp.viceId, icon: 'silver' });
  // troféus intermediários declarados no formato (Intercontinental): mostra também os ainda em disputa
  const declared = (comp.format?.stages ?? []).filter((s) => s.title).map((s) => s.title!);
  for (const t of comp.titles ?? []) items.push({ label: t.title, clubId: t.clubId, icon: 'title' });
  for (const t of declared) if (!comp.titles?.some((x) => x.title === t)) items.push({ label: t, clubId: null, icon: 'title' });
  return (
    <Card>
      <CardHeader icon={<Award />} title="Títulos" subtitle={comp.finished ? 'Competição encerrada' : 'Em disputa'} />
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="text-sm text-fg-muted">Ainda sem campeão. Títulos de turno (ex.: Taça Guanabara) aparecem aqui quando decididos.</p>}
        {items.map((it, i) => (
          <div key={i} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', it.icon === 'gold' ? 'border-warning/40 bg-warning/10' : 'border-line/70 bg-surface-2/40')}>
            {it.icon === 'gold' ? <Crown className="size-4 text-warning" /> : it.icon === 'silver' ? <Medal className="size-4 text-fg-muted" /> : <Trophy className="size-4 text-club-accent" />}
            {it.clubId ? <ClubCrest id={it.clubId} size={22} /> : <span className="grid size-[22px] place-items-center rounded-full border border-dashed border-line text-[10px] text-fg-subtle">?</span>}
            <div className="min-w-0 flex-1">
              <div className={cn('truncate text-sm font-semibold', !it.clubId && 'text-fg-subtle')}>{it.clubId ? clubLabel(it.clubId) : 'A definir'}</div>
              <div className="truncate text-[11px] text-fg-muted">{it.label}</div>
            </div>
          </div>
        ))}
        {(comp.promotedIds?.length ?? 0) > 0 && (
          <p className="pt-1 text-[11px] text-success">Acesso: {comp.promotedIds!.map((id) => clubLabel(id, true)).join(', ')}</p>
        )}
        {(comp.relegatedIds?.length ?? 0) > 0 && (
          <p className="text-[11px] text-danger">Rebaixados: {comp.relegatedIds!.map((id) => clubLabel(id, true)).join(', ')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ScorersCard({ comp, human }: { comp: Competition; human: string }) {
  const list = useMemo(() => topScorers(comp, 15), [comp]);
  // o artilheiro pode ter mudado de clube depois do gol: procura no clube do gol e no clube de origem
  const nameOf = (pid: string, clubId: string) =>
    squads(clubId).find((p) => p.id === pid)?.name ?? squads(pid.split(':')[0]).find((p) => p.id === pid)?.name ?? pid;
  return (
    <Card>
      <CardHeader icon={<Volleyball />} title="Artilharia" subtitle={comp.name} />
      <CardContent className="space-y-1">
        {list.length === 0 && <p className="text-sm text-fg-muted">Nenhum gol ainda.</p>}
        {list.map((s, i) => (
          <div key={s.playerId} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', s.clubId === human ? 'bg-club-accent/10' : 'odd:bg-surface-2/35')}>
            <span className="tabular w-5 text-xs font-bold text-fg-subtle">{i + 1}</span>
            <ClubCrest id={s.clubId} size={18} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{nameOf(s.playerId, s.clubId)}</span>
            <span className="tabular text-sm font-extrabold">{s.goals}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
