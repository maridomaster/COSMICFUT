import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Crown, Globe2, Handshake, History, Trophy, Volleyball } from 'lucide-react';
import { championsOf, clubHistory, type ChampionRecord, type ClubCampaign } from '@cosmicfut/engine';
import { CONTINENTAL_ORDER } from '@/season/continental';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeason, useWorld } from '@/store/season';
import { clubIndexEntry } from '@/data/clubIndex';
import { competitionIdentity } from '@/data/competitionIdentity';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Segmented } from '@/components/ui/range';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { CompetitionEmblem } from '@/components/game/CompetitionEmblem';
import { TrophyArt } from '@/components/game/TrophyArt';
import { CampaignIcon, TrophyRoom, campaignText } from './TrophyRoom';

const TYPE_ORDER: Record<string, number> = { continental: 0, league: 1, cup: 2, supercup: 3, state: 4 };
const divOf = (r: ChampionRecord) => Number(/-(\d+)$/.exec(r.competitionId)?.[1] ?? 0);
const contIdx = (r: ChampionRecord) => (CONTINENTAL_ORDER.indexOf(r.competitionId) + 1 || 99);
const sortRecords = (list: ChampionRecord[]) =>
  list.slice().sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || contIdx(a) - contIdx(b) || divOf(a) - divOf(b) || a.competitionId.localeCompare(b.competitionId));

/** (Sala de Troféus) Nome de exibição pelo registro de identidade (sem patrocinador); cai no nome gravado. */
const nameOf = (r: Pick<ChampionRecord, 'competitionId' | 'name' | 'type'>) => competitionIdentity(r.competitionId, { name: r.name, type: r.type }).name;

type Section = 'continental' | 'nacional' | 'regional' | 'estadual' | 'estrangeira';
const SECTION_LABEL: Record<Section, string> = {
  continental: 'Continentais e mundiais',
  nacional: 'Nacionais',
  regional: 'Regionais',
  estadual: 'Estaduais',
  estrangeira: 'Outros países',
};
const SECTIONS: Section[] = ['continental', 'nacional', 'regional', 'estadual', 'estrangeira'];

/** Seção de um registro do histórico (o registro não guarda o país: deduz pelo id). */
function sectionOf(r: ChampionRecord, code: string): Section {
  if (r.type === 'continental') return 'continental';
  if (r.type === 'state') return 'estadual';
  if (!/^[A-Z]{3}-/.test(r.competitionId)) return 'regional';
  // (Etapa 1) ligas, copas e supercopas de outros países ("ING-1", "ESP-CUP", "ARG-SUP")
  return r.competitionId.startsWith(`${code}-`) ? 'nacional' : 'estrangeira';
}

/** (Etapa 1) Rótulo da temporada do registro: "2026" (ano civil) ou "2026/27" (temporada europeia/saudita). */
const labelOf = (r: ChampionRecord) => r.seasonLabel ?? String(r.season);
/** ordem: mais recente primeiro ("2027" > "2026/27" > "2026") */
const byLabelDesc = (a: string, b: string) => b.localeCompare(a);

/** Histórico da carreira: sala de troféus, campeões por ano (world.history) e por competição. */
export function HistoryPage() {
  const world = useWorld();
  const season = useSeason((s) => s.save?.season ?? null);
  const clubId = useSeason((s) => s.save?.season.humanClubIds[0] ?? s.save?.clubId ?? '');
  const [view, setView] = useState<'clube' | 'ano' | 'competicao'>('clube');
  const history = world?.history ?? [];
  const [cabinetClub, setCabinetClub] = useState<string | null>(null);
  const shownClub = cabinetClub ?? clubId;
  // (Registros) clubes com título na carreira (para ver a sala de troféus de outros)
  const champions = useMemo(() => [...new Set(history.flatMap((h) => [h.championId, ...(h.titles ?? []).map((t) => t.clubId)]).filter((x): x is string => !!x))]
    .sort((a, b) => clubLabel(a).localeCompare(clubLabel(b))), [history]);
  const humanUf = clubIndexEntry(clubId)?.state ?? null;
  const [allStates, setAllStates] = useState(false);

  const seasons = useMemo(() => [...new Set(history.map(labelOf))].sort(byLabelDesc), [history]);
  const trophies = useMemo(() => history.filter((h) => h.championId === clubId), [history, clubId]);
  const compIds = useMemo(() => {
    const m = new Map<string, ChampionRecord>();
    for (const h of sortRecords(history)) if (!m.has(h.competitionId)) m.set(h.competitionId, h);
    return [...m.values()];
  }, [history]);
  const [compId, setCompId] = useState<string | null>(null);
  const selected = compId ?? compIds[0]?.competitionId ?? '';
  const code = world?.countryCode ?? 'BRA';
  const [showForeign, setShowForeign] = useState(false);
  const hasForeign = useMemo(() => history.some((h) => sectionOf(h, code) === 'estrangeira'), [history, code]);
  const continental = useMemo(() => history.filter((h) => h.type === 'continental'), [history]);

  if (!world) {
    return <div className="cf-card mx-auto mt-6 max-w-lg p-8 text-center text-sm text-fg-muted">O histórico existe só na carreira solo.</div>;
  }

  const visible = (r: ChampionRecord) => {
    if (sectionOf(r, code) === 'estrangeira') return showForeign;
    return r.type !== 'state' || r.championId === clubId || (r.competitionId.startsWith(`EST-${humanUf}-`)) || (allStates && divOf(r) === 1);
  };

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cf-label text-club-accent">Carreira desde {world.startSeason}</p>
          <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">Histórico</h1>
          <p className="text-xs text-fg-muted">
            Sala de troféus e campeões de cada temporada encerrada.
            {world.coach && (
              <>
                {' '}
                <Link to="/tecnico" className="font-semibold text-club-accent hover:underline">
                  Ver o histórico do técnico →
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="w-full max-w-md">
          <Segmented
            id="hist-view"
            label="Visualização"
            value={view}
            onChange={setView}
            options={[
              { value: 'clube', label: 'Sala de troféus' },
              { value: 'ano', label: 'Por temporada' },
              { value: 'competicao', label: 'Por competição' },
            ]}
          />
        </div>
      </motion.header>

      {view !== 'clube' && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader icon={<Trophy />} title="Títulos do seu clube" subtitle={`${trophies.length === 0 ? 'Nenhum título' : trophies.length === 1 ? '1 título' : `${trophies.length} títulos`} do ${clubLabel(clubId)}`} />
            <CardContent>
              {trophies.length === 0 ? (
                <p className="text-sm text-fg-muted">Ainda sem títulos na carreira.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {trophies.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 py-1 pr-2.5 pl-1.5 text-xs font-semibold text-warning">
                      <CompetitionEmblem compId={t.competitionId} name={t.name} type={t.type} size={18} /> {nameOf(t)} {labelOf(t)}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {view === 'clube' ? (
        <motion.div variants={fadeUp} className="space-y-3">
          <TrophyRoom
            world={world}
            season={season}
            clubId={shownClub}
            human={clubId}
            options={[...new Set([clubId, ...champions])]}
            onClub={(id) => setCabinetClub(id === clubId ? null : id)}
          />
          <CampaignsCard world={world} clubId={shownClub} />
        </motion.div>
      ) : history.length === 0 ? (
        <motion.div variants={fadeUp} className="cf-card p-8 text-center">
          <History className="mx-auto size-10 text-fg-subtle" />
          <p className="mt-3 font-semibold">Nenhuma temporada encerrada ainda</p>
          <p className="text-sm text-fg-muted">Os campeões aparecem aqui depois da primeira virada de temporada.</p>
        </motion.div>
      ) : view === 'ano' ? (
        <div className="space-y-3">
          {continental.length > 0 && (
            <motion.div variants={fadeUp}>
              <ContinentalGallery records={continental} clubId={clubId} />
            </motion.div>
          )}
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
            <button type="button" aria-pressed={allStates} className="text-xs font-semibold text-club-accent hover:underline" onClick={() => setAllStates((v) => !v)}>
              {allStates ? 'Menos estaduais' : 'Mostrar todos os estaduais'}
            </button>
            {hasForeign && (
              <button type="button" aria-pressed={showForeign} className="text-xs font-semibold text-club-accent hover:underline" onClick={() => setShowForeign((v) => !v)}>
                {showForeign ? 'Ocultar ligas estrangeiras' : 'Mostrar ligas estrangeiras'}
              </button>
            )}
          </div>
          {seasons.map((y) => {
            const recs = sortRecords(history.filter((h) => labelOf(h) === y)).filter(visible);
            return (
              <motion.div key={y} variants={fadeUp}>
                <Card>
                  <CardHeader icon={<History />} title={`Temporada ${y}`} />
                  <CardContent className="space-y-4">
                    {SECTIONS.map((sec) => {
                      const list = recs.filter((r) => sectionOf(r, code) === sec);
                      if (!list.length) return null;
                      return (
                        <div key={sec}>
                          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">{SECTION_LABEL[sec]}</div>
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            {list.map((r) => (
                              <RecordRow key={r.competitionId} r={r} clubId={clubId} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <motion.div variants={fadeUp}>
          <CompetitionHistory world={world} compId={selected} clubId={clubId} options={compIds} onPick={setCompId} />
        </motion.div>
      )}
    </motion.div>
  );
}

/** (Sala de Troféus) Campeões de uma competição com a identidade visual: cabeçalho, maiores campeões e lista por ano. */
function CompetitionHistory({
  world, compId, clubId, options, onPick,
}: { world: { history: ChampionRecord[] }; compId: string; clubId: string; options: ChampionRecord[]; onPick: (id: string) => void }) {
  const list = useMemo(() => championsOf(world, compId), [world, compId]);
  const sample = list[0] ?? options.find((o) => o.competitionId === compId);
  const idt = competitionIdentity(compId, sample ? { name: sample.name, type: sample.type } : undefined);
  const ranking = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of list) if (r.championId) (m.get(r.championId) ?? m.set(r.championId, []).get(r.championId)!).push(labelOf(r));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || clubLabel(a[0]).localeCompare(clubLabel(b[0]))).slice(0, 8);
  }, [list]);
  return (
    <div className="space-y-3">
      <section className="cf-card relative overflow-hidden p-4 sm:p-5">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(60% 130% at 0% 0%, color-mix(in oklab, ${idt.colors.secondary} 24%, transparent), transparent 70%)` }} />
        <div className="relative flex flex-wrap items-center gap-4">
          <CompetitionEmblem compId={compId} identity={idt} size={60} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-fg-subtle uppercase">Campeões por competição</p>
            <h2 className="truncate text-xl font-extrabold tracking-tight">{idt.name}</h2>
            <p className="text-xs text-fg-muted">{list.length === 1 ? '1 edição encerrada' : `${list.length} edições encerradas`}</p>
          </div>
          <div className="hidden h-24 items-end sm:flex">
            <TrophyArt compId={compId} identity={idt} height={88} />
          </div>
          <NativeSelect aria-label="Competição" value={compId} onChange={(e) => onPick(e.target.value)} className="w-full sm:w-64">
            {options.map((c) => (
              <option key={c.competitionId} value={c.competitionId}>
                {nameOf(c)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {ranking.length > 0 && (
          <div className="relative mt-4">
            <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">Maiores campeões na carreira</div>
            <div className="flex flex-wrap gap-2">
              {ranking.map(([id, ys]) => (
                <span key={id} className={cn('inline-flex items-center gap-1.5 rounded-xl border px-2 py-1 text-xs', id === clubId ? 'border-warning/50 bg-warning/10' : 'border-line/70 bg-surface-2/50')}>
                  <ClubCrest id={id} size={18} />
                  <span className="font-semibold">{clubLabel(id, true)}</span>
                  <span className="tabular font-black text-warning">{ys.length}×</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
      <Card>
        <CardContent className="space-y-2 pt-4">
          {list.map((r) => (
            <RecordRow key={labelOf(r)} r={r} clubId={clubId} withSeason />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** (Fase 2) Galeria continental: campeões de cada continental por ano, com os troféus intermediários. */
function ContinentalGallery({ records, clubId }: { records: ChampionRecord[]; clubId: string }) {
  const comps = [...new Set(records.map((r) => r.competitionId))].sort((a, b) => (CONTINENTAL_ORDER.indexOf(a) + 1 || 99) - (CONTINENTAL_ORDER.indexOf(b) + 1 || 99));
  return (
    <Card>
      <CardHeader icon={<Globe2 />} title="Campeões continentais e intercontinentais" subtitle="Competições continentais e mundiais da carreira" />
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {comps.map((id) => {
          const list = records.filter((r) => r.competitionId === id).sort((a, b) => byLabelDesc(labelOf(a), labelOf(b)));
          return (
            <div key={id} className="rounded-xl border border-line/70 bg-surface-2/35 p-3">
              <div className="mb-2 flex items-center gap-2.5">
                <CompetitionEmblem compId={id} name={list[0]?.name} type={list[0]?.type} size={36} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{list[0] ? nameOf(list[0]) : id}</div>
                  <div className="text-[11px] text-fg-subtle">{list.length === 1 ? '1 edição' : `${list.length} edições`}</div>
                </div>
              </div>
              <div className="space-y-1">
                {list.map((r) => (
                  <div key={labelOf(r)} className={cn('rounded-lg px-2 py-1', r.championId === clubId ? 'bg-warning/10 ring-1 ring-warning/40' : 'odd:bg-surface-2/40')}>
                    <div className="flex items-center gap-2">
                      <span className="tabular w-12 text-xs font-extrabold">{labelOf(r)}</span>
                      {r.championId ? (
                        <>
                          <ClubCrest id={r.championId} size={18} />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{clubLabel(r.championId, true)}</span>
                          {r.championId === clubId && <Crown className="size-3.5 text-warning" />}
                        </>
                      ) : (
                        <span className="text-xs text-fg-subtle">—</span>
                      )}
                    </div>
                    {r.titles?.length ? (
                      <div className="mt-0.5 flex flex-wrap gap-x-3 pl-11 text-[10px] text-fg-subtle">
                        {r.titles.map((t) => (
                          <span key={t.title} className="inline-flex items-center gap-1">
                            <Trophy className="size-3" /> {t.title}: {clubLabel(t.clubId, true)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function RecordRow({ r, clubId, withSeason }: { r: ChampionRecord; clubId: string; withSeason?: boolean }) {
  const mine = r.championId === clubId;
  return (
    <div className={cn('rounded-xl border px-3 py-2', mine ? 'border-warning/50 bg-warning/10' : 'border-line/60 bg-surface-2/35')}>
      <div className="flex items-center gap-2">
        {withSeason ? (
          <span className="tabular w-16 text-sm font-extrabold">{labelOf(r)}</span>
        ) : (
          <CompetitionEmblem compId={r.competitionId} name={r.name} type={r.type} size={20} />
        )}
        {!withSeason && <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg-muted">{nameOf(r)}</span>}
        {r.championId ? (
          <span className={cn('flex min-w-0 items-center gap-1.5', withSeason && 'flex-1')}>
            <ClubCrest id={r.championId} size={20} />
            <span className="truncate text-sm font-bold">{clubLabel(r.championId, !withSeason)}</span>
            {mine && <Crown className="size-3.5 shrink-0 text-warning" />}
          </span>
        ) : (
          <span className="text-xs text-fg-subtle">—</span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 truncate pl-7 text-[11px] text-fg-subtle">
        {r.viceId && <span>vice {clubLabel(r.viceId, true)}</span>}
        {r.topScorer && (
          <span className="inline-flex items-center gap-1" title="Artilheiro">
            <Volleyball className="size-3" /> {r.scorers?.[0]?.[1] ?? r.topScorer.name ?? 'Artilheiro'} ({r.topScorer.goals} {r.topScorer.goals === 1 ? 'gol' : 'gols'})
          </span>
        )}
        {r.assists?.[0] && (
          <span className="inline-flex items-center gap-1" title="Líder de assistências">
            <Handshake className="size-3" /> {r.assists[0][1]} ({r.assists[0][3]} assist.)
          </span>
        )}
        {r.titles?.map((t) => (
          <span key={t.title}>
            {t.title}: {clubLabel(t.clubId, true)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** (Registros) Campanhas por temporada de um clube (posição/fase em cada competição). */
function CampaignsCard({ world, clubId }: { world: { history: ChampionRecord[] }; clubId: string }) {
  const seasons = useMemo(() => clubHistory(world, clubId), [world, clubId]);
  return (
    <Card>
      <CardHeader icon={<History />} title="Campanhas por temporada" subtitle="Posição final na liga e fase alcançada em cada competição" />
      <CardContent className="space-y-4">
        {seasons.length === 0 && <p className="text-sm text-fg-muted">Nenhuma temporada encerrada ainda.</p>}
        {seasons.map((s) => (
          <div key={s.season}>
            <div className="mb-1.5 text-[11px] font-extrabold tracking-[0.12em] text-fg-subtle uppercase">Temporada {s.season}</div>
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {s.campaigns.slice().sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)).map((c) => (
                <CampaignRow key={c.competitionId} c={c} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CampaignRow({ c }: { c: ClubCampaign }) {
  const gold = c.champion;
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5', gold ? 'border-warning/50 bg-warning/10' : c.vice ? 'border-line bg-surface-2/60' : 'border-line/60 bg-surface-2/30')}>
      <CompetitionEmblem compId={c.competitionId} name={c.name} type={c.type} size={20} />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg-muted">{nameOf({ competitionId: c.competitionId, name: c.name, type: c.type })}</span>
      <CampaignIcon c={c} />
      <span className={cn('shrink-0 text-xs font-bold', gold && 'text-warning')}>{campaignText(c)}</span>
      {c.titles.length > 0 && <span className="shrink-0 text-[10px] text-warning">+ {c.titles.join(', ')}</span>}
    </div>
  );
}
