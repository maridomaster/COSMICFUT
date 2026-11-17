/**
 * (Registros) Estatísticas: artilharia e assistências por competição e temporada (ao vivo na temporada atual; das
 * temporadas encerradas, o top 20/10 gravado na virada) e os números do seu elenco na temporada.
 */
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, Handshake, Users, Volleyball } from 'lucide-react';
import { playerCareer, topRows, type ChampionRecord, type Competition, type RecordRow, type SeasonState } from '@cosmicfut/engine';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeasonState, useWorld } from '@/store/season';
import { squads } from '@/data/squads';
import { humanIdOf, humanSeasonLabel, REGION_LABEL } from '@/season/view';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { CompetitionEmblem } from '@/components/game/CompetitionEmblem';

const LIVE = 'atual';
const TYPE_LABEL: Record<string, string> = { league: 'Ligas', cup: 'Copas', supercup: 'Supercopas', state: 'Estaduais', continental: 'Continentais' };
const TYPE_ORDER: Record<string, number> = { continental: 0, league: 1, cup: 2, supercup: 3, state: 4 };

/** Nome do jogador (clube do gol, clube de origem). */
function nameOf(pid: string, clubId: string): string {
  return squads(clubId).find((p) => p.id === pid)?.name ?? squads(pid.slice(0, pid.lastIndexOf(':'))).find((p) => p.id === pid)?.name ?? pid;
}

const labelOf = (r: ChampionRecord) => r.seasonLabel ?? String(r.season);

interface CompOption {
  id: string;
  name: string;
  group: string;
  order: number;
  mine: boolean;
}

export function StatsPage() {
  const season = useSeasonState();
  const world = useWorld();
  const human = humanIdOf(season) ?? '';
  const [label, setLabel] = useState(LIVE);
  const history = world?.history ?? [];
  const labels = useMemo(() => [...new Set(history.filter((h) => h.scorers?.length).map(labelOf))].sort((a, b) => b.localeCompare(a)), [history]);

  const options: CompOption[] = useMemo(() => {
    const src: { id: string; name: string; type: string; region?: string; seasonLabel?: string; clubIds?: string[]; table?: string[] }[] =
      label === LIVE
        ? season.competitions.filter((c) => Object.keys(c.scorers ?? {}).length > 0).map((c) => ({ ...c, name: `${c.name}${c.seasonLabel ? ` ${c.seasonLabel}` : ''}` }))
        : history.filter((h) => labelOf(h) === label && h.scorers?.length).map((h) => ({ id: h.competitionId, name: h.name, type: h.type, table: h.table }));
    return src
      .map((c) => {
        const mine = !!human && (c.clubIds ?? c.table ?? []).includes(human);
        const group = c.type === 'state' ? TYPE_LABEL.state : [c.region ? REGION_LABEL[c.region as 'SA'] : '', TYPE_LABEL[c.type] ?? 'Outras'].filter(Boolean).join(' · ');
        return { id: c.id, name: c.name, group, mine, order: (mine ? 0 : 10) + (TYPE_ORDER[c.type] ?? 9) };
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }, [label, season.competitions, history, human]);
  const [compId, setCompId] = useState<string | null>(null);
  const selected = options.find((o) => o.id === compId) ?? options[0];

  const { scorers, assists } = useMemo(() => {
    if (!selected) return { scorers: [] as RecordRow[], assists: [] as RecordRow[] };
    if (label === LIVE) {
      const c = season.competitions.find((x) => x.id === selected.id) as Competition;
      return { scorers: topRows(c.scorers, c.scorerClubs, 20, nameOf), assists: topRows(c.assists, c.scorerClubs, 20, nameOf) };
    }
    const r = history.find((h) => h.competitionId === selected.id && labelOf(h) === label);
    return { scorers: r?.scorers ?? [], assists: r?.assists ?? [] };
  }, [selected, label, season.competitions, history]);

  const groups = useMemo(() => {
    const m = new Map<string, CompOption[]>();
    for (const o of options) (m.get(o.group) ?? m.set(o.group, []).get(o.group)!).push(o);
    return [...m.entries()];
  }, [options]);

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cf-label text-club-accent">Registros de todos os jogos</p>
          <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">Estatísticas</h1>
          <p className="text-xs text-fg-muted">Artilharia e assistências de cada competição, ao vivo e das temporadas encerradas.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {/* (Sala de Troféus) emblema da competição escolhida */}
          {selected && <CompetitionEmblem compId={selected.id} name={selected.name} size={34} />}
          <NativeSelect aria-label="Temporada" value={label} onChange={(e) => { setLabel(e.target.value); setCompId(null); }} className="w-40">
            <option value={LIVE}>Temporada atual</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Competição" value={selected?.id ?? ''} onChange={(e) => setCompId(e.target.value)} className="w-full sm:w-72">
            {groups.map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.mine ? ' ★' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </div>
      </motion.header>

      {!selected ? (
        <motion.div variants={fadeUp} className="cf-card p-8 text-center">
          <BarChart3 className="mx-auto size-10 text-fg-subtle" />
          <p className="mt-3 font-semibold">Nenhum gol registrado ainda</p>
          <p className="text-sm text-fg-muted">As tabelas aparecem quando as competições começam.</p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <motion.div variants={fadeUp}>
            <RankCard icon={<Volleyball />} title="Artilharia" subtitle={selected.name} rows={scorers} unit={['gol', 'gols']} human={human} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <RankCard icon={<Handshake />} title="Assistências" subtitle={selected.name} rows={assists} unit={['assist.', 'assist.']} human={human} />
          </motion.div>
        </div>
      )}
      {label === LIVE && human && (
        <motion.div variants={fadeUp}>
          <SquadStats season={season} human={human} />
        </motion.div>
      )}
    </motion.div>
  );
}

function RankCard({ icon, title, subtitle, rows, unit, human }: { icon: React.ReactNode; title: string; subtitle: string; rows: RecordRow[]; unit: [string, string]; human: string }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      <CardContent className="space-y-1">
        {rows.length === 0 && <p className="text-sm text-fg-muted">Sem registros.</p>}
        {rows.map(([pid, name, club, n], i) => (
          <div key={pid} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', club === human ? 'bg-club-accent/10' : 'odd:bg-surface-2/35')}>
            <span className="tabular w-5 text-xs font-bold text-fg-subtle">{i + 1}</span>
            <ClubCrest id={club} size={18} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={clubLabel(club)}>
              {name}
              <span className="ml-1.5 text-[11px] text-fg-subtle">{clubLabel(club, true)}</span>
            </span>
            <span className="tabular text-sm font-extrabold">{n}</span>
            <span className="w-10 text-[10px] text-fg-subtle">{n === 1 ? unit[0] : unit[1]}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Números do elenco do humano na temporada (todas as competições), das linhas de carreira vivas. */
function SquadStats({ season, human }: { season: SeasonState; human: string }) {
  const world = useWorld();
  const label = humanSeasonLabel(season);
  const rows = useMemo(() => {
    const out: { id: string; name: string; games: number; goals: number; assists: number; rating: number }[] = [];
    for (const p of squads(human)) {
      const live = playerCareer(world, season, p.id).filter((r) => r.clubId === human && r.season === label);
      const g = live.reduce((s, r) => s + r.games, 0);
      if (!g) continue;
      out.push({
        id: p.id, name: p.name, games: g, goals: live.reduce((s, r) => s + r.goals, 0), assists: live.reduce((s, r) => s + r.assists, 0),
        rating: live.reduce((s, r) => s + r.rating * r.games, 0) / g,
      });
    }
    return out.sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.games - a.games);
  }, [season, human, world, label]);
  return (
    <Card>
      <CardHeader icon={<Users />} title={`Elenco do ${clubLabel(human)}`} subtitle={`Temporada ${label} · todas as competições`} />
      <CardContent className="px-2 sm:px-4">
        {rows.length === 0 ? (
          <p className="px-2 text-sm text-fg-muted">Nenhum jogo disputado nesta temporada.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] tracking-wider text-fg-subtle uppercase">
                <th className="px-2 py-1 text-left font-semibold">Jogador</th>
                <th className="px-2 py-1 text-right font-semibold">J</th>
                <th className="px-2 py-1 text-right font-semibold">G</th>
                <th className="px-2 py-1 text-right font-semibold">A</th>
                <th className="px-2 py-1 text-right font-semibold">Nota</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="odd:bg-surface-2/35">
                  <td className="truncate px-2 py-1">{r.name}</td>
                  <td className="tabular px-2 py-1 text-right">{r.games}</td>
                  <td className="tabular px-2 py-1 text-right font-bold">{r.goals}</td>
                  <td className="tabular px-2 py-1 text-right">{r.assists}</td>
                  <td className="tabular px-2 py-1 text-right">{r.rating.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
