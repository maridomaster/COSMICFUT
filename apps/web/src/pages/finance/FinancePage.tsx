import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/ui/page-header';
import { motion } from 'motion/react';
import {
  ArrowLeftRight, Award, BadgeDollarSign, Banknote, BarChart3, Building2, CalendarDays, Gauge, Handshake, HandCoins, Heart, Landmark, LineChart, Percent, PiggyBank, Ticket,
  Scale, TrendingDown, TrendingUp, Tv, UserMinus, Users, Wrench,
} from 'lucide-react';
import { ManagementPanel } from './ManagementPanel';
import { SponsorPanel } from './SponsorPanel';
import { budgetsApply, financeOverview, type SeasonState } from '@cosmicfut/engine';
import { BudgetBalance } from './BudgetBalance';
import { useCurrentClub } from '@/app/ClubContext';
import { summarizeSquad } from '@/data/derive';
import { fmtDate, fmtInt, fmtMoney, fmtMoneySigned } from '@/lib/format';
import { expenseLines, ledgerTotals, revenueLines, salesPurchases } from '@/season/ledger';
import { fmtPrice } from '@/season/finance';
import { CurrencyToggle } from '@/components/game/CurrencyToggle';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { fanLabel } from '@/pages/dashboard/Cards';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeason, useSeasonState, useWorld, type BalancePoint } from '@/store/season';
import { humanSeasonLabel } from '@/season/view';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatTile } from '@/components/game/bits';

type FinanceLedger = NonNullable<SeasonState['clubs'][string]['finance']>;

const NO_HISTORY: BalancePoint[] = [];
const EMPTY_LEDGER: FinanceLedger = { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0 };

/** Receitas e despesas de um livro-caixa (Etapa 4: linhas de season/ledger.ts). */
function totalsOf(l: FinanceLedger) {
  const t = ledgerTotals(l);
  const { sales, purchases } = salesPurchases(l);
  return { ...t, sales, purchases };
}

const REV_ICON: Record<string, ReactNode> = {
  tickets: <Ticket />, tv: <Tv />, sponsor: <Handshake />, prizes: <Award />, sales: <ArrowLeftRight />, owner: <Landmark />,
};
const EXP_ICON: Record<string, ReactNode> = {
  wages: <Banknote />, staff: <Users />, maintenance: <Building2 />, operating: <Wrench />, interest: <Percent />, purchases: <UserMinus />,
  luvas: <HandCoins />, stadium: <Building2 />,
};

export function FinancePage() {
  const { bundle } = useCurrentClub();
  const season = useSeasonState();
  const world = useWorld();
  // seletor estável: `?? []` criaria um array novo a cada leitura (loop de re-render)
  const history = useSeason((s) => s.save?.history) ?? NO_HISTORY;
  const humanId = bundle.club.id;
  const club = season.clubs[humanId];
  const current = club?.finance ?? EMPTY_LEDGER;

  // temporadas anteriores (livros arquivados na virada da região: world.ledgers, chave "2026" ou "2026/27") + a atual
  const label = humanSeasonLabel(season);
  const years = useMemo(() => {
    const out: { season: string; ledger: FinanceLedger; current: boolean }[] = [];
    for (const [y, byClub] of Object.entries(world?.ledgers ?? {})) {
      const l = byClub[humanId];
      if (l && y !== label) out.push({ season: y, ledger: l, current: false });
    }
    out.sort((a, b) => a.season.localeCompare(b.season));
    out.push({ season: label, ledger: current, current: true });
    return out;
  }, [world?.ledgers, humanId, label, current]);
  const [picked, setPicked] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const sel = years.find((y) => y.season === picked) ?? years[years.length - 1];
  const isCurrent = sel.current;
  const ledger = sel.ledger;

  // (Etapa 4) vendas e compras ficam separadas no livro (`sales`/`purchases`); livros antigos: pelo saldo do mercado
  const transfersNet = ledger.transfers ?? 0;
  const currentTotals = totalsOf(current);
  const { income, expenses, net, purchases } = isCurrent ? currentTotals : totalsOf(ledger);
  const chartYears = years.map((y) => ({ season: y.season, current: y.current, ...(y.current ? currentTotals : totalsOf(y.ledger)) }));
  const wageBill = useMemo(() => summarizeSquad(bundle.players).wageBill, [bundle.players]);
  const balance = club?.balance ?? 0;
  const start = history[0]?.balance ?? balance;
  const ov = useMemo(() => financeOverview(season, humanId), [season, humanId]);

  const revenue = revenueLines(ledger).filter((r) => r.value || ['tickets', 'tv', 'sponsor', 'prizes'].includes(r.key)).map((r) => ({ ...r, icon: REV_ICON[r.key] }));
  const costs = expenseLines(ledger).filter((c) => c.value || ['wages', 'staff', 'maintenance', 'operating'].includes(c.key)).map((c) => ({ ...c, icon: EXP_ICON[c.key] }));
  const maxRev = Math.max(1, ...revenue.map((r) => r.value), ...costs.map((c) => c.value));

  // (Atualização 41) abas: antes eram 10 cards empilhados (3.109px a 1280×720); cada aba cabe (ou quase) numa tela
  const econ = isCurrent && !!ov.econ;
  // (28/11) a gestão (ingresso, empréstimo, estádio, luvas) também no online
  const manage = isCurrent && !!world;
  const tabs = [
    { key: 'resumo', label: 'Resumo', icon: <Scale /> },
    ...(econ ? [{ key: 'diretoria', label: 'Diretoria e mês', icon: <Gauge /> }] : []),
    ...(manage || econ ? [{ key: 'gestao', label: 'Bilheteria e gestão', icon: <Ticket /> }] : []),
    // (28/11) patrocínio master
    ...(econ ? [{ key: 'patrocinio', label: 'Patrocínio', icon: <BadgeDollarSign /> }] : []),
    ...(isCurrent || years.length > 1 ? [{ key: 'historico', label: 'Histórico', icon: <LineChart /> }] : []),
  ] as const;
  const tab = tabs.find((t) => t.key === tabParam)?.key ?? 'resumo';
  const setTab = (k: string) => setParams(k === 'resumo' ? {} : { tab: k }, { replace: true });

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      <motion.div variants={fadeUp}>
        <PageHeader
          title="Finanças"
          eyebrow="Gestão"
          meta={isCurrent ? `Livro-caixa da temporada ${label} · atualizado em ${fmtDate(season.date)}` : `Livro-caixa fechado da temporada ${sel.season}`}
          actions={
            <>
              <CurrencyToggle />
              {years.length > 1 && (
                <div role="group" aria-label="Escolher temporada" className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-2/60 p-0.5">
                  {years.map((y) => (
                    <button
                      key={y.season}
                      type="button"
                      aria-pressed={y.season === sel.season}
                      onClick={() => setPicked(y.current ? null : y.season)}
                      className={cn(
                        'tabular h-7 rounded-md px-2.5 text-xs font-semibold transition-colors',
                        y.season === sel.season ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg',
                      )}
                    >
                      {y.season}
                      {y.current && <span className="ml-1 font-normal opacity-80">(atual)</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          }
        />
      </motion.div>

      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {isCurrent ? (
          <StatTile label="Caixa do Clube" value={<span className={balance < 0 ? 'text-danger' : ''}>{fmtMoney(balance)}</span>} hint={balance < 0 ? `cheque especial · limite ${fmtMoney(-ov.creditLimit)}` : `início da temporada: ${fmtMoney(start)}`} />
        ) : (
          <StatTile label="Temporada" value={sel.season} hint="encerrada" />
        )}
        <StatTile label="Receitas" value={<span className="text-success">{fmtMoney(income)}</span>} hint={isCurrent ? 'acumulado na temporada' : 'total da temporada'} />
        <StatTile label="Despesas" value={<span className="text-danger">{fmtMoney(expenses)}</span>} hint={purchases ? 'salários, custos e transferências' : 'salários e custos'} />
        <StatTile
          label="Resultado"
          value={<span className={net >= 0 ? 'text-success' : 'text-danger'}>{fmtMoneySigned(net)}</span>}
          hint={isCurrent ? `folha atual ${fmtMoney(wageBill)}/mês` : 'receitas − despesas'}
        />
      </motion.div>

      {tabs.length > 1 && (
        <motion.div variants={fadeUp} className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'none' }}>
          <div role="tablist" aria-label="Seções de finanças" className="flex w-max gap-0.5 rounded-lg border border-line bg-surface-2/60 p-0.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition-colors [&_svg]:size-3.5',
                  tab === t.key ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {tab === 'resumo' && (
        <>
          {isCurrent && budgetsApply(season, humanId) && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader icon={<Scale />} title="Orçamentos da diretoria" subtitle="Transferências × folha salarial · equilibre com o slider (vale a partir de agora)" />
                <CardContent>
                  <BudgetBalance season={season} clubId={humanId} />
                </CardContent>
              </Card>
            </motion.div>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <motion.div variants={fadeUp}>
              <Card className="h-full">
                <CardHeader icon={<TrendingUp />} title="Receitas" subtitle="por origem" />
                <CardContent className="space-y-1">
                  {revenue.map((r, i) => (
                    <LedgerRow key={r.key} icon={r.icon} label={r.label} hint={r.hint} value={r.value} max={maxRev} tone="pos" delay={i * 0.06} />
                  ))}
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={fadeUp}>
              <Card className="h-full">
                <CardHeader icon={<TrendingDown />} title="Despesas" subtitle="por origem" />
                <CardContent className="space-y-1">
                  {costs.map((c, i) => (
                    <LedgerRow
                      key={c.key}
                      icon={c.icon}
                      label={c.label}
                      hint={c.key === 'wages' && isCurrent ? `${fmtMoney(wageBill)} por mês (dia 1)` : c.key === 'purchases' ? `${c.hint} · saldo do mercado ${fmtMoneySigned(transfersNet)}` : c.hint}
                      value={c.value}
                      max={maxRev}
                      tone="neg"
                      delay={i * 0.06}
                    />
                  ))}
                  {isCurrent && (
                    <div className="flex items-center gap-2 rounded-lg border border-line/70 bg-surface-2/40 px-2.5 py-1.5">
                      <span className="grid size-6 place-items-center rounded-md bg-surface-3 text-fg-muted [&_svg]:size-3.5">
                        <PiggyBank />
                      </span>
                      <div className="min-w-0 flex-1 text-[11px] text-fg-muted">
                        Projeção anual da folha: <b className="text-fg">{fmtMoney(wageBill * 12)}</b>. {ov.econ ? <>Patrocínio e comercial: <b className="text-fg">{fmtMoney(ov.sponsorMonthly * 12)}</b>/ano.</> : <>Patrocínio contratado: <b className="text-fg">{fmtMoney(bundle.club.finances.sponsorPerSeason)}</b>/temporada.</>}
                        {purchases > 0 && <> Compras na temporada: <b className="text-fg">{fmtMoney(purchases)}</b>.</>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </>
      )}

      {tab === 'diretoria' && econ && (
        <>
          <motion.div variants={fadeUp} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <BoardCard ov={ov} wageBill={wageBill} />
            <MonthlyCard ov={ov} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <CashFlowCard ov={ov} />
          </motion.div>
        </>
      )}

      {tab === 'patrocinio' && (
        <motion.div variants={fadeUp}>
          <SponsorPanel season={season} clubId={humanId} />
        </motion.div>
      )}

      {tab === 'gestao' && (
        <>
          {manage && (
            <motion.div variants={fadeUp}>
              <ManagementPanel season={season} clubId={humanId} />
            </motion.div>
          )}
          {econ && (
            <motion.div variants={fadeUp}>
              <GatesCard gates={ov.gates} />
            </motion.div>
          )}
        </>
      )}

      {tab === 'historico' && (
        <>
          {isCurrent && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader icon={<LineChart />} title="Evolução do saldo" subtitle={history[0] ? `desde ${fmtDate(history[0].date)}` : 'sem registros ainda'} />
                <CardContent>
                  <BalanceChart points={history} />
                </CardContent>
              </Card>
            </motion.div>
          )}
          {years.length > 1 && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader icon={<BarChart3 />} title="Comparativo por temporada" subtitle="Receitas e despesas de cada ano" />
                <CardContent>
                  <YearsChart years={chartYears} selected={sel.season} onPick={(s, cur) => setPicked(cur ? null : s)} />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </motion.div>
  );
}
type Overview = ReturnType<typeof financeOverview>;

/** Barra de medidor (0..100%+) com faixa de alerta. */
function Meter({ value, label, tone }: { value: number; label: string; tone: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--color-success)' : tone === 'warn' ? 'var(--color-warning)' : 'var(--color-danger)';
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, value * 100)}%` }} transition={{ duration: 0.8, ease: EASE_OUT }} />
    </div>
  );
}

/** (Etapa 4) Diretoria e torcida: Teto da Folha Salarial (usado/teto), Moral da Torcida e cheque especial. */
function BoardCard({ ov, wageBill }: { ov: Overview; wageBill: number }) {
  const used = wageBill * 12;
  const usage = ov.wageCeiling > 0 ? used / ov.wageCeiling : 0;
  const fm = Math.round(ov.fanMorale);
  return (
    <Card className="h-full">
      <CardHeader icon={<Gauge />} title="Diretoria e torcida" subtitle="Teto da folha, Moral da Torcida e crédito" />
      <CardContent className="space-y-2.5">
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="font-semibold">Teto da Folha (orçamento salarial)</span>
            <span className="tabular text-fg-muted">
              <b className={cn('text-fg', usage > 1 && 'text-danger')}>{fmtMoney(used)}</b> / {fmtMoney(ov.wageCeiling)} por ano · <b className={usage > 1 ? 'text-danger' : usage >= 0.9 ? 'text-warning' : 'text-success'}>{Math.round(usage * 100)}%</b>
            </span>
          </div>
          <Meter value={usage} label="Uso do teto da folha salarial" tone={usage > 1 ? 'bad' : usage >= 0.9 ? 'warn' : 'good'} />
          <p className="mt-1 text-[11px] leading-snug text-fg-subtle">
            {usage > 1
              ? 'Acima do teto: a diretoria veta contratações e renovações que aumentem a folha.'
              : `Folga de ${fmtMoney(Math.max(0, ov.wageCeiling - used) / 12)} por mês para novos salários. Contratos acima do teto são vetados.`}
          </p>
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 font-semibold"><Heart className="size-3.5 text-club-accent" /> Moral da Torcida</span>
            <span className="tabular"><b className={fm >= 70 ? 'text-success' : fm < 40 ? 'text-danger' : 'text-fg'}>{fm}</b> <span className="text-fg-muted">/ 100 · {fanLabel(fm)}</span></span>
          </div>
          <Meter value={fm / 100} label="Moral da Torcida" tone={fm >= 50 ? 'good' : fm >= 35 ? 'warn' : 'bad'} />
          <p className="mt-1 text-[11px] leading-snug text-fg-subtle">Sobe com vitórias, títulos e contratações de peso; cai com derrotas, vendas de estrelas e ingresso caro. Mexe no público e no gasto por torcedor.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Cheque especial" value={fmtMoney(ov.creditLimit)} hint={`limite · juros de ${(ov.overdraftRate * 100).toLocaleString('pt-BR')}% ao mês`} />
          <StatTile label="Técnico" value={fmtMoney(ov.coachMonthly)} hint="salário de referência por mês" />
        </div>
      </CardContent>
    </Card>
  );
}

/** (Etapa 4) Lançamentos fixos de cada dia 1. */
function MonthlyCard({ ov }: { ov: Overview }) {
  const rows: [string, number, 'pos' | 'neg'][] = [
    ['Cota de TV', ov.tvMonthly, 'pos'],
    ['Patrocínio e comercial', ov.sponsorMonthly, 'pos'],
    ...(ov.ownerMonthly ? ([['Aporte (dono)', ov.ownerMonthly, 'pos']] as [string, number, 'pos'][]) : []),
    ['Comissão técnica e funcionários', ov.staffMonthly, 'neg'],
    ['Manutenção do estádio', ov.maintenanceMonthly, 'neg'],
    ['Despesas operacionais', ov.opexMonthly, 'neg'],
  ];
  const net = rows.reduce((s, [, v, t]) => s + (t === 'pos' ? v : -v), 0);
  return (
    <Card className="h-full">
      <CardHeader icon={<CalendarDays />} title="Todo dia 1" subtitle="Parcelas fixas do mês (sem salários dos jogadores)" />
      <CardContent className="space-y-1">
        {rows.map(([k, v, t]) => (
          <div key={k} className="flex items-center justify-between rounded-md border border-line/60 bg-surface-2/40 px-2.5 py-1 text-[13px]">
            <span className="text-fg-muted">{k}</span>
            <span className={cn('tabular font-semibold', t === 'pos' ? 'text-success' : 'text-danger')}>{t === 'pos' ? '+' : '−'}{fmtMoney(v)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 pt-1 text-sm">
          <span className="font-semibold">Saldo fixo do mês</span>
          <span className={cn('tabular font-bold', net >= 0 ? 'text-success' : 'text-danger')}>{fmtMoneySigned(net)}</span>
        </div>
        <p className="px-3 text-[11px] text-fg-subtle">Bilheteria entra a cada jogo em casa; prêmios, ao alcançar cada fase; salários dos jogadores saem no dia 1.</p>
      </CardContent>
    </Card>
  );
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');

/** (Etapa 4) Demonstrativo mensal: receitas × despesas por mês (meses fechados + o mês em andamento). */
function CashFlowCard({ ov }: { ov: Overview }) {
  const months = [...ov.months.slice(-6), ...(ov.currentMonth ? [{ ...ov.currentMonth, current: true }] : [])] as (Overview['months'][number] & { current?: boolean })[];
  if (!months.length) return null;
  const rev = revenueLines({}).map((r) => r.key);
  const exp = expenseLines({}).map((r) => r.key);
  const val = (flow: Overview['months'][number]['flow'], side: 'rev' | 'exp', key: string) =>
    (side === 'rev' ? revenueLines(flow) : expenseLines(flow)).find((x) => x.key === key)?.value ?? 0;
  const used = (side: 'rev' | 'exp', key: string) => months.some((m) => val(m.flow, side, key) !== 0);
  const cell = (v: number, tone?: string) => <td className={cn('tabular px-2 py-1 text-right whitespace-nowrap', tone)}>{v ? fmtMoney(v) : '—'}</td>;
  return (
    <Card>
      <CardHeader icon={<BarChart3 />} title="Fluxo de caixa mensal" subtitle="Demonstrativo: receitas × despesas por mês" />
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-line text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
                <th className="py-1.5 text-left font-semibold">Linha</th>
                {months.map((m) => (
                  <th key={m.month} className="px-2 py-1.5 text-right font-semibold">{monthLabel(m.month)}{m.current ? '*' : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={months.length + 1} className="pt-2 pb-1 text-[10px] font-bold tracking-wider text-success uppercase">Receitas</td></tr>
              {rev.filter((k) => used('rev', k)).map((k) => (
                <tr key={k} className="border-b border-line/40">
                  <td className="py-1 pr-2 text-fg-muted">{revenueLines({}).find((x) => x.key === k)!.label}</td>
                  {months.map((m) => <Fragment key={m.month}>{cell(val(m.flow, 'rev', k))}</Fragment>)}
                </tr>
              ))}
              <tr><td colSpan={months.length + 1} className="pt-3 pb-1 text-[10px] font-bold tracking-wider text-danger uppercase">Despesas</td></tr>
              {exp.filter((k) => used('exp', k)).map((k) => (
                <tr key={k} className="border-b border-line/40">
                  <td className="py-1 pr-2 text-fg-muted">{expenseLines({}).find((x) => x.key === k)!.label}</td>
                  {months.map((m) => <Fragment key={m.month}>{cell(val(m.flow, 'exp', k))}</Fragment>)}
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-1.5">Resultado do mês</td>
                {months.map((m) => {
                  const t = ledgerTotals(m.flow);
                  return <Fragment key={m.month}>{cell(t.net, t.net >= 0 ? 'text-success' : 'text-danger')}</Fragment>;
                })}
              </tr>
              <tr>
                <td className="py-1 text-fg-muted">Caixa no fim do mês</td>
                {months.map((m) => <Fragment key={m.month}>{cell(m.balance, m.balance < 0 ? 'text-danger' : '')}</Fragment>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">* mês em andamento (até hoje).</p>
      </CardContent>
    </Card>
  );
}

/** (Etapa 4) Bilheteria dos últimos jogos em casa: público, preço, importância e Moral da Torcida. */
function GatesCard({ gates }: { gates: Overview['gates'] }) {
  return (
    <Card>
      <CardHeader icon={<Ticket />} title="Bilheteria — últimos jogos em casa" subtitle="Renda = público × preço × importância × gasto por torcedor (moral)" />
      <CardContent>
        {gates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-fg-muted">Nenhum jogo em casa ainda nesta carreira.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b border-line text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
                  <th className="py-1.5 text-left font-semibold">Data</th>
                  <th className="py-1.5 text-left font-semibold">Adversário</th>
                  <th className="py-1.5 text-left font-semibold">Importância</th>
                  <th className="py-1.5 text-right font-semibold">Público</th>
                  <th className="py-1.5 text-right font-semibold">Preço</th>
                  <th className="py-1.5 text-right font-semibold">Torcida</th>
                  <th className="py-1.5 text-right font-semibold">Renda</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {gates.map((g) => (
                  <tr key={g.fixtureId} className="border-b border-line/40">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(g.date, { day: '2-digit', month: 'short' })}</td>
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-1.5"><ClubCrest id={g.opponentId} size={16} /> <span className="truncate">{clubLabel(g.opponentId, true)}</span></span>
                      <span className="block truncate text-[10px] text-fg-subtle">{g.competition}{g.neutral ? ' · campo neutro (50/50)' : ''}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold">×{g.importance.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span>{' '}
                      <span className="text-fg-subtle">{g.importanceLabel}</span>
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {fmtInt(g.attendance)} <span className="text-fg-subtle">({g.capacity ? Math.round((g.attendance / g.capacity) * 100) : 0}%)</span>
                    </td>
                    <td className="py-1.5 text-right">{fmtPrice(g.price)}</td>
                    <td className="py-1.5 text-right">{g.fanMorale}</td>
                    <td className="py-1.5 text-right font-semibold text-success">{fmtMoney(g.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LedgerRow({ icon, label, hint, value, max, tone, delay }: { icon: ReactNode; label: string; hint: string; value: number; max: number; tone: 'pos' | 'neg'; delay: number }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface-2/40 px-2.5 py-1.5" title={hint}>
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-surface-3 text-fg-muted [&_svg]:size-3.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-semibold">{label}</span>
          <span className="ml-1.5 hidden truncate text-[11px] text-fg-subtle sm:inline">{hint}</span>
        </div>
        <div className="tabular text-sm font-bold tracking-tight">{fmtMoney(value)}</div>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className="h-full rounded-full"
          style={{ background: tone === 'pos' ? 'var(--color-success)' : 'var(--color-danger)' }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%` }}
          transition={{ duration: 0.7, delay: 0.2 + delay, ease: EASE_OUT }}
        />
      </div>
    </div>
  );
}

interface YearTotals {
  season: string;
  current: boolean;
  income: number;
  expenses: number;
  net: number;
}

/** Barras agrupadas (receitas × despesas) por temporada + tabela com o resultado. Clique escolhe a temporada. */
function YearsChart({ years, selected, onPick }: { years: YearTotals[]; selected: string; onPick: (season: string, current: boolean) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = 220;
  const pad = { l: 56, r: 12, t: 14, b: 28 };
  const max = Math.max(1, ...years.flatMap((y) => [y.income, y.expenses]));
  const ticks = [0, max / 2, max];
  const slot = (W - pad.l - pad.r) / years.length;
  const bw = Math.min(34, slot * 0.28);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const base = y(0);
  const bar = (x: number, v: number, color: string, delay: number) => {
    const top = y(Math.max(0, v));
    const h = Math.max(0, base - top);
    const r = Math.min(4, h);
    // canto arredondado só na ponta de dados (topo), ancorado na base
    const d = `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`;
    return <motion.path d={d} fill={color} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay }} />;
  };
  const hv = hover !== null ? years[hover] : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" /> Receitas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-danger" /> Despesas
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Receitas e despesas por temporada" onPointerLeave={() => setHover(null)}>
          {ticks.map((tv, i) => (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={i === 0 ? undefined : '3 4'} />
              <text x={pad.l - 8} y={y(tv) + 4} textAnchor="end" fontSize="11" fill="var(--color-fg-subtle)">
                {fmtMoney(tv)}
              </text>
            </g>
          ))}
          {years.map((yr, i) => {
            const cx = pad.l + slot * i + slot / 2;
            const on = yr.season === selected;
            return (
              <g key={yr.season} className="cursor-pointer" onPointerEnter={() => setHover(i)} onClick={() => onPick(yr.season, yr.current)}>
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t} fill={on ? 'var(--color-surface-2)' : hover === i ? 'var(--color-surface-2)' : 'transparent'} opacity={on ? 0.9 : 0.5} rx="8" />
                {bar(cx - bw - 1, yr.income, 'var(--color-success)', i * 0.05)}
                {bar(cx + 1, yr.expenses, 'var(--color-danger)', i * 0.05 + 0.03)}
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="12" fontWeight={on ? 700 : 500} fill={on ? 'var(--color-fg)' : 'var(--color-fg-muted)'}>
                  {yr.season}
                  {yr.current ? '*' : ''}
                </text>
              </g>
            );
          })}
        </svg>
        {hv && hover !== null && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface-2/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
            style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, transform: 'translateX(-50%)' }}
          >
            <div className="text-[10px] text-fg-muted">Temporada {hv.season}{hv.current ? ' (em andamento)' : ''}</div>
            <div className="tabular">Receitas <b>{fmtMoney(hv.income)}</b></div>
            <div className="tabular">Despesas <b>{fmtMoney(hv.expenses)}</b></div>
            <div className={cn('tabular font-bold', hv.net >= 0 ? 'text-success' : 'text-danger')}>{fmtMoneySigned(hv.net)}</div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-fg-subtle">* temporada em andamento (valores acumulados até hoje).</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
              <th className="py-1.5 text-left font-semibold">Temporada</th>
              <th className="py-1.5 text-right font-semibold">Receitas</th>
              <th className="py-1.5 text-right font-semibold">Despesas</th>
              <th className="py-1.5 text-right font-semibold">Resultado</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {years
              .slice()
              .reverse()
              .map((yr) => (
                <tr key={yr.season} className={cn('border-b border-line/50', yr.season === selected && 'bg-surface-2/50')}>
                  <td className="py-1.5">
                    <button type="button" className="font-semibold hover:text-club-accent" onClick={() => onPick(yr.season, yr.current)}>
                      {yr.season}
                      {yr.current && <span className="ml-1 text-[11px] font-normal text-fg-muted">(atual)</span>}
                    </button>
                  </td>
                  <td className="py-1.5 text-right">{fmtMoney(yr.income)}</td>
                  <td className="py-1.5 text-right">{fmtMoney(yr.expenses)}</td>
                  <td className={cn('py-1.5 text-right font-semibold', yr.net >= 0 ? 'text-success' : 'text-danger')}>{fmtMoneySigned(yr.net)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Gráfico de linha (SVG próprio) com área, grade discreta e crosshair + tooltip ao passar o mouse. */
function BalanceChart({ points }: { points: BalancePoint[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = 240;
  const pad = { l: 56, r: 12, t: 12, b: 26 };
  const data = points.length === 1 ? [points[0], points[0]] : points;
  const t = data.map((p) => Date.parse(p.date + 'T00:00:00Z'));
  const v = data.map((p) => p.balance);
  const t0 = t[0];
  const t1 = Math.max(t[t.length - 1], t0 + 86400000);
  let lo = Math.min(...v, 0);
  let hi = Math.max(...v);
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  lo -= span * 0.06;
  hi += span * 0.06;
  const x = (ms: number) => pad.l + ((ms - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (val: number) => pad.t + (1 - (val - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = data.map((_, i) => `${i ? 'L' : 'M'}${x(t[i]).toFixed(1)},${y(v[i]).toFixed(1)}`).join('');
  const area = `${line}L${x(t[t.length - 1]).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}L${x(t[0]).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}Z`;
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
  const months = useMemo(() => {
    const out: { ms: number; label: string }[] = [];
    const d = new Date(t0);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() <= t1) {
      out.push({ ms: d.getTime(), label: d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '') });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  }, [t0, t1]);

  const onMove = (e: { clientX: number }) => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(x(t[i]) - px) < Math.abs(x(t[best]) - px)) best = i;
    setHover(best);
  };

  if (points.length < 2) {
    return (
      <div className="grid place-items-center gap-1 py-10 text-center">
        <LineChart className="size-8 text-fg-subtle" />
        <p className="text-sm font-semibold">Ainda sem movimentação nesta temporada</p>
        <p className="text-xs text-fg-muted">O gráfico aparece quando o saldo mudar (salários, cotas, bilheteria, transferências).</p>
      </div>
    );
  }
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Evolução do saldo do clube">
        <defs>
          <linearGradient id="bal-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--club-accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--club-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tv, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={i === 0 ? undefined : '3 4'} />
            <text x={pad.l - 8} y={y(tv) + 4} textAnchor="end" fontSize="11" fill="var(--color-fg-subtle)">
              {fmtMoney(tv)}
            </text>
          </g>
        ))}
        {lo < 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--color-danger)" strokeOpacity="0.5" strokeWidth="1" />}
        {months.map((m) => (
          <text key={m.ms} x={x(m.ms)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-fg-subtle)">
            {m.label}
          </text>
        ))}
        <motion.path d={area} fill="url(#bal-area)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
        <motion.path d={line} fill="none" stroke="var(--club-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE_OUT }} />
        <circle cx={x(t[t.length - 1])} cy={y(v[v.length - 1])} r="4" fill="var(--club-accent)" stroke="var(--color-surface)" strokeWidth="2" />
        {hover !== null && (
          <g>
            <line x1={x(t[hover])} x2={x(t[hover])} y1={pad.t} y2={H - pad.b} stroke="var(--color-fg-muted)" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={x(t[hover])} cy={y(v[hover])} r="5" fill="var(--club-accent)" stroke="var(--color-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface-2/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
          style={{ left: `${(x(t[hover]) / W) * 100}%`, transform: `translateX(${x(t[hover]) > W * 0.7 ? '-105%' : '8px'})` }}
        >
          <div className="text-[10px] text-fg-muted">{fmtDate(h.date)}</div>
          <div className={cn('tabular font-bold', h.balance < 0 ? 'text-danger' : 'text-fg')}>{fmtMoney(h.balance)}</div>
        </div>
      )}
    </div>
  );
}
