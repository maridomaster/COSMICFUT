import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Banknote, CalendarClock, ChevronRight, Crown, Handshake, Heart, Inbox, Landmark, ListOrdered, PiggyBank, Trophy, UserRound, Users } from 'lucide-react';
import type { Club, Country } from '@cosmicfut/shared';
import type { Competition, FinanceLedger, Fixture, SeasonState } from '@cosmicfut/engine';
import type { SquadSummary } from '@/data/derive';
import { fmtDate, fmtInt, fmtMoney, fmtMoneySigned, POSITION_META, POSITION_ORDER } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn, clubInitials } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag, OvrBadge, PositionChip, StatTile } from '@/components/game/bits';
import { AgeChip } from '@/components/game/chips';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { StandingsTable, withQualZones, ZoneLegend, zonesIn } from '@/components/game/standings';
import { ContinentalSeal } from '@/components/game/ContinentalSeal';
import { clubTable, humanSeasonLabel, weekOf } from '@/season/view';
import { clubStatusIn, compShort, fixtureCaption, myCompetitions } from '@/season/comps';
import { compCategory, careerCountryOf } from '@/season/continental';
import { ledgerTotals } from '@/season/ledger';
import { useQualProjection } from '@/season/useContinental';

const EMPTY_SEASON = { season: 0, date: '', humanClubIds: [], competitions: [], clubs: {}, news: [] } as SeasonState;

/* ---------- Visão do elenco ---------- */
/**
 * (Atualização 41) Substitui também a antiga tabela "Elenco completo" do Dashboard (2.043px, duplicava a página
 * Elenco): posições + top 5 clicável (abre o card do jogador) + atalho para o Elenco.
 */
export function SquadOverviewCard({ summary, onSelect }: { summary: SquadSummary; onSelect?: (id: string) => void }) {
  const maxPos = Math.max(...POSITION_ORDER.map((p) => summary.byPosition[p]), 1);
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Users />}
        title="Visão do elenco"
        subtitle={`${summary.size} jogadores`}
        action={
          <Link to="/elenco" className="flex items-center gap-0.5 text-xs font-semibold text-club-accent hover:underline">
            Elenco <ChevronRight className="size-3.5" />
          </Link>
        }
      />
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            {/* (Atualização 41) o overall médio já está na faixa do clube: aqui, idade e folha */}
            <StatTile label="Idade média" value={summary.avgAge.toFixed(1)} />
            <StatTile label="Folha/mês" value={fmtMoney(summary.wageBill)} />
          </div>
          <div className="space-y-1">
            {POSITION_ORDER.map((p, i) => {
              const n = summary.byPosition[p];
              const meta = POSITION_META[p];
              return (
                <div key={p} className="flex items-center gap-2">
                  <PositionChip position={p} />
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: meta.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(n / maxPos) * 100}%` }}
                      transition={{ duration: 0.7, delay: 0.2 + i * 0.06, ease: EASE_OUT }}
                    />
                  </div>
                  <span className="tabular w-5 text-right text-xs font-semibold">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="cf-label mb-1">Top 5</div>
          <ol className="divide-y divide-line/50">
            {summary.top.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={onSelect ? () => onSelect(p.id) : undefined}
                  disabled={!onSelect}
                  className="cf-row flex w-full items-center gap-2 px-1 text-left disabled:cursor-default"
                >
                  <span className="tabular w-3 text-[10px] font-bold text-fg-subtle">{i + 1}</span>
                  <PositionChip position={p.position} foot={p.side} />
                  <span className="min-w-0 flex-1 truncate text-body font-semibold">{p.name}</span>
                  <AgeChip age={p.age} />
                  <OvrBadge value={p.overall} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
/* ---------- Finanças ---------- */
/** (Etapa 4) Rótulo da Moral da Torcida. */
export function fanLabel(v: number): string {
  if (v >= 85) return 'torcida em festa';
  if (v >= 70) return 'torcida empolgada';
  if (v >= 50) return 'torcida confiante';
  if (v >= 35) return 'torcida desconfiada';
  return 'torcida revoltada';
}

export function FinanceCard({ club, wageBill, balance, ledger, ceiling, fanMorale }: { club: Club; wageBill: number; balance: number; ledger?: FinanceLedger; ceiling?: number; fanMorale?: number }) {
  const annualWages = wageBill * 12;
  // (Etapa 4) uso do Teto da Folha Salarial (diretoria); saves sem perfil: folha × patrocínio (antigo)
  const hasCeiling = !!ceiling && ceiling > 0;
  const ratio = hasCeiling ? annualWages / ceiling! : club.finances.sponsorPerSeason > 0 ? annualWages / club.finances.sponsorPerSeason : 1;
  const healthy = hasCeiling ? ratio < 0.9 : ratio <= 1;
  const { income, expenses, net } = ledgerTotals(ledger ?? {});
  const rows = [
    { icon: <PiggyBank />, label: 'Caixa do Clube', value: fmtMoney(balance), hint: balance < 0 ? 'no cheque especial (juros de 2,5% ao mês)' : 'saldo disponível', tone: balance < 0 ? 'text-danger' : '' },
    { icon: <Banknote />, label: 'Folha salarial', value: fmtMoney(wageBill), hint: `/mês · ${fmtMoney(annualWages)} por ano`, tone: '' },
    {
      icon: <Handshake />,
      label: 'Resultado na temporada',
      value: fmtMoneySigned(net),
      hint: `receitas ${fmtMoney(income)} · despesas ${fmtMoney(expenses)}`,
      tone: net > 0 ? 'text-success' : net < 0 ? 'text-danger' : '',
    },
    ...(fanMorale !== undefined
      ? [{ icon: <Heart />, label: 'Moral da Torcida', value: `${Math.round(fanMorale)}`, hint: fanLabel(fanMorale), tone: fanMorale >= 70 ? 'text-success' : fanMorale < 40 ? 'text-danger' : '' }]
      : []),
  ];
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Banknote />}
        title="Finanças"
        subtitle="Resumo da temporada"
        action={
          <Link to="/financas" className="text-xs font-semibold text-club-accent hover:underline">
            Detalhes
          </Link>
        }
      />
      <CardContent className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} title={r.hint} className="flex items-center gap-2.5 rounded-lg border border-line/70 bg-surface-2/40 px-2.5 py-1.5">
            <span className="grid size-6 place-items-center rounded-md bg-surface-3 text-fg-muted [&_svg]:size-3.5">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-fg-muted">{r.label}</div>
              <div className="truncate text-[10px] text-fg-subtle">{r.hint}</div>
            </div>
            <div className={cn('tabular text-base font-bold tracking-tight', r.tone)}>{r.value}</div>
          </div>
        ))}
        <div className="pt-0.5">
          <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
            <span>{hasCeiling ? `Teto da folha: ${fmtMoney(ceiling!)}/ano` : 'Folha anual vs. patrocínio'}</span>
            <span className={cn('tabular font-semibold', healthy ? 'text-success' : ratio > 1 ? 'text-danger' : 'text-warning')}>{Math.round(ratio * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label="Uso do teto da folha salarial" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: healthy ? 'var(--color-success)' : ratio > 1 ? 'var(--color-danger)' : 'var(--color-warning)' }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, ratio * 100)}%` }}
              transition={{ duration: 0.9, delay: 0.3, ease: EASE_OUT }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Próximos jogos (temporada real) ---------- */
export function FixturesCard({ clubId, fixtures, today, compName, season }: { clubId: string; fixtures: Fixture[]; today: string; compName: string; season?: SeasonState }) {
  return (
    <Card className="h-full">
      <CardHeader
        icon={<CalendarClock />}
        title="Próximos jogos"
        subtitle={compName}
        action={
          <Link to="/calendario" className="text-xs font-semibold text-club-accent hover:underline">
            Calendário
          </Link>
        }
      />
      <CardContent className="space-y-1">
        {fixtures.length === 0 && <p className="text-sm text-fg-muted">Sem jogos restantes na temporada.</p>}
        {fixtures.map((f, i) => {
          const home = f.homeId === clubId;
          const opp = home ? f.awayId : f.homeId;
          const isToday = f.date === today;
          return (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.06, duration: 0.4, ease: EASE_OUT }}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-2.5 py-1',
                i === 0 ? 'border-club-accent/35 bg-club-accent/[0.07]' : 'border-line/70 bg-surface-2/40',
              )}
            >
              <div className="w-8 shrink-0 text-center leading-tight">
                <div className="tabular text-sm font-bold">{fmtDate(f.date, { day: '2-digit' })}</div>
                <div className="text-[10px] font-semibold text-fg-muted uppercase">{fmtDate(f.date, { month: 'short' })}</div>
              </div>
              <ClubCrest id={opp} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  <span className="text-fg-subtle">{home ? 'vs' : '@'} </span>
                  {clubLabel(opp)}
                </div>
                <div className="truncate text-[11px] text-fg-muted">
                  {season && season.competitions.length > 1 ? (
                    <>
                      <b className="font-semibold text-club-accent">{fixtureCaption(season, f)}</b> · {fmtDate(f.date, { weekday: 'short' })}
                    </>
                  ) : (
                    <>
                      Rodada {f.round} · {fmtDate(f.date, { weekday: 'short' })}
                    </>
                  )}
                </div>
              </div>
              {isToday ? (
                <Link to="/partida" className="rounded-full bg-club-accent px-2 py-0.5 text-[11px] font-black text-club-on-accent uppercase">
                  Hoje
                </Link>
              ) : (
                <Badge variant={home ? 'club' : 'default'}>{home ? 'Casa' : 'Fora'}</Badge>
              )}
            </motion.div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ---------- Estádio ---------- */
function stadiumTier(cap: number) {
  if (cap >= 70000) return 'Colosso';
  if (cap >= 45000) return 'Grande porte';
  if (cap >= 20000) return 'Médio porte';
  return 'Pequeno porte';
}

export function StadiumCard({ club, capacity, work }: { club: Club; capacity?: number; work?: { seats: number; until: string } | null }) {
  const cap = capacity ?? club.stadium.capacity;
  return (
    <Card>
      <CardHeader
        icon={<Landmark />}
        title="Estádio"
        subtitle={stadiumTier(cap)}
        action={
          work ? (
            <Link to="/financas?tab=gestao" className="rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning" title={`+${fmtInt(work.seats)} lugares em ${fmtDate(work.until)}`}>
              em obras
            </Link>
          ) : undefined
        }
      />
      <CardContent>
        <div className="truncate text-sm font-bold tracking-tight">{club.stadium.name}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="tabular text-xl font-extrabold text-club-accent">{fmtInt(cap)}</span>
          <span className="text-xs text-fg-muted">lugares</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" title="Capacidade numa escala até 100 mil lugares">
          <motion.div
            className="h-full rounded-full bg-linear-to-r from-club-primary to-club-accent"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, (cap / 100000) * 100)}%` }}
            transition={{ duration: 0.9, delay: 0.3, ease: EASE_OUT }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Técnico ---------- */
export function CoachCard({ club, country }: { club: Club; country: Country | undefined }) {
  return (
    <Card>
      <CardHeader icon={<UserRound />} title="Técnico" subtitle="Comissão técnica" />
      <CardContent className="flex items-center gap-3">
        <div className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-club-primary to-club-secondary p-[2px]">
          <div className="grid size-full place-items-center rounded-[10px] bg-surface text-sm font-extrabold text-fg">
            {clubInitials(club.coach.name).slice(0, 2)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-tight">{club.coach.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Flag country={country} />
            {country?.name ?? '—'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Mini classificação ---------- */
export function StandingsMiniCard({ comp, clubId, season }: { comp: Competition; clubId: string; season?: SeasonState }) {
  const t0 = clubTable(comp, clubId);
  // (Fase 2) Série A da carreira: vagas continentais projetadas nas zonas
  const proj = useQualProjection(season ?? EMPTY_SEASON, season ? comp : undefined);
  const t = proj ? { ...t0, zone: withQualZones(t0.rows, t0.zone, proj.zone) } : t0;
  return (
    <Card className="h-full">
      <CardHeader
        icon={<ListOrdered />}
        title="Classificação"
        subtitle={t.label ? `${comp.name} · ${t.label}` : comp.name}
        action={
          <Link to={comp.format ? `/competicoes?c=${encodeURIComponent(comp.id)}` : '/calendario?tab=tabela'} className="text-xs font-semibold text-club-accent hover:underline">
            Completa
          </Link>
        }
      />
      <CardContent className="space-y-2 px-2 pt-2 sm:px-3">
        <StandingsTable comp={comp} rows={t.rows} zone={t.zone} highlightId={clubId} compact limitAround={12} />
        <div className="px-2">
          <ZoneLegend comp={comp} zones={comp.format ? zonesIn(t.rows.length, t.zone) : undefined} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Minhas competições (carreira) ---------- */
export function MyCompetitionsCard({ season, clubId }: { season: SeasonState; clubId: string }) {
  const comps = myCompetitions(season, clubId);
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Trophy />}
        title="Minhas competições"
        subtitle={`${comps.length} na temporada ${humanSeasonLabel(season)} · semana ${weekOf(season.date)}`}
        action={
          <Link to="/competicoes" className="text-xs font-semibold text-club-accent hover:underline">
            Ver todas
          </Link>
        }
      />
      <CardContent className="space-y-1">
        {comps.map((c, i) => {
          const st = clubStatusIn(c, clubId, (id) => clubLabel(id, true));
          const cat = compCategory(c, careerCountryOf(season));
          // (Sala de Troféus) todas as competições têm emblema próprio (data/competitionIdentity.ts)
          const special = cat !== 'estrangeira';
          return (
            <motion.div key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.05, duration: 0.35, ease: EASE_OUT }}>
              <Link
                to={`/competicoes?c=${encodeURIComponent(c.id)}`}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-2.5 py-1 transition-colors hover:border-line-strong',
                  st.tone === 'gold' ? 'border-warning/45 bg-warning/10' : 'border-line/70 bg-surface-2/40',
                )}
              >
                {special ? (
                  <ContinentalSeal compId={c.id} size={28} title={c.name} />
                ) : (
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-md',
                      st.tone === 'gold' ? 'bg-warning/20 text-warning' : st.tone === 'good' ? 'bg-success/15 text-success' : st.tone === 'bad' ? 'bg-danger/15 text-danger' : 'bg-surface-3 text-fg-muted',
                    )}
                  >
                    {st.tone === 'gold' ? <Crown className="size-4" /> : <Trophy className="size-4" />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {compShort(c)}
                    {cat === 'continental' && <span className="ml-1.5 rounded bg-club-accent/15 px-1 align-middle text-[9px] font-black tracking-wider text-club-accent uppercase">continental</span>}
                  </div>
                  {st.sub && <div className="truncate text-[11px] text-fg-muted">{st.sub}</div>}
                </div>
                <span
                  className={cn(
                    'max-w-[45%] truncate text-right text-xs font-bold',
                    st.tone === 'gold' ? 'text-warning' : st.tone === 'good' ? 'text-success' : st.tone === 'bad' ? 'text-danger' : 'text-fg',
                  )}
                >
                  {st.text}
                </span>
              </Link>
            </motion.div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ---------- Caixa de entrada (notícias da temporada) ---------- */
export function NewsCard({ season, clubId }: { season: SeasonState; clubId: string }) {
  const items = season.news
    .map((n, i) => ({ ...n, i }))
    .slice(-30)
    .reverse();
  return (
    <Card className="h-full">
      <CardHeader icon={<Inbox />} title="Caixa de entrada" subtitle={`${season.news.length} mensagens na temporada`} />
      <CardContent className="pt-2">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-fg-muted">
            Nenhuma notícia ainda. Clique em <b className="text-fg">Continuar</b> para avançar a temporada.
          </p>
        ) : (
          <ul className="scrollbar-thin max-h-[17rem] space-y-1 overflow-y-auto pr-1">
            {items.map((n, k) => {
              const mine = n.clubId === clubId;
              return (
                <motion.li
                  key={n.i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(k, 10) * 0.03, duration: 0.3, ease: EASE_OUT }}
                  className={cn('flex gap-2 rounded-lg border px-2.5 py-1.5', mine ? 'border-club-accent/30 bg-club-accent/[0.06]' : 'border-line/60 bg-surface-2/40')}
                >
                  {n.clubId ? <ClubCrest id={n.clubId} size={18} className="mt-0.5" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-fg-subtle" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-snug text-fg">
                      <span className="tabular mr-1.5 text-[10px] font-semibold text-fg-subtle">{fmtDate(n.date, { day: '2-digit', month: 'short' })}</span>
                      {n.text}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}