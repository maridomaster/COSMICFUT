/**
 * (Fase 2) Painel de gestão financeira: preço do ingresso, empréstimo bancário ((Etapa 4) blocos de 2,5% da receita,
 * juros de 1,2% ao mês), ampliação do estádio (€ 3,5–6,5 mil por lugar, obra com prazo) e luvas parceladas.
 * Cada controle mostra as consequências ANTES de confirmar; ações sem volta pedem confirmação.
 * Todas as ações são funções puras da engine aplicadas via `useSeason().market` (o worker recebe a cópia).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Banknote, Building2, Construction, HandCoins, Landmark, RotateCcw, Ticket } from 'lucide-react';
import {
  FINANCE, financeOverview, stadiumWorkDays,
  type SeasonState,
} from '@cosmicfut/engine';
import { addDays, fmtDate, fmtInt, fmtMoney } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeason } from '@/store/season';
import { useMarketActions, type FinanceReq } from '@/pages/market/actions';
import { daysBetween } from '@/season/view';
import { fmtPrice, gateEstimate, nextHomeFixture } from '@/season/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ui/confirm';
import { ClubCrest, clubLabel } from '@/components/game/status';

export function ManagementPanel({ season, clubId }: { season: SeasonState; clubId: string }) {
  // (28/11) mesma ação no solo e no online (antes o painel só existia no solo)
  const actions = useMarketActions();
  const soloBusy = useSeason((s) => !!s.advancing || s.rolling);
  const [pending, setPending] = useState(false);
  const busy = soloBusy || pending || !!actions.blocked;
  const ov = useMemo(() => financeOverview(season, clubId), [season, clubId]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const run = (req: FinanceReq, ok: string) => {
    setPending(true);
    void actions.finance(req).then((r) => {
      setPending(false);
      if (r.error) setMsg({ tone: 'error', text: r.error });
      else setMsg({ tone: 'ok', text: ok });
    });
  };

  return (
    <Card>
      <CardHeader icon={<Landmark />} title="Gestão do clube" subtitle="Ingresso, empréstimo, estádio e luvas" />
      <CardContent className="space-y-3">
        {msg && (
          <motion.p
            key={msg.text}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            role={msg.tone === 'error' ? 'alert' : 'status'}
            className={cn('rounded-xl border px-3.5 py-2 text-sm', msg.tone === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-success/40 bg-success/10 text-success')}
          >
            {msg.text}
          </motion.p>
        )}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <TicketBox season={season} clubId={clubId} ov={ov} busy={busy} run={run} />
          <LoanBox ov={ov} busy={busy} run={run} clubId={clubId} ask={setConfirm} />
          <StadiumBox season={season} ov={ov} busy={busy} run={run} clubId={clubId} ask={setConfirm} />
          <LuvasBox ov={ov} busy={busy} run={run} clubId={clubId} ask={setConfirm} />
        </div>
      </CardContent>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}

type Overview = ReturnType<typeof financeOverview>;
type Run = (req: FinanceReq, ok: string) => void;

function Box({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line/70 bg-surface-2/40 p-2.5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-md bg-surface-3 text-club-accent [&_svg]:size-3.5">{icon}</span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold">{title}</h4>
          {hint && <p className="truncate text-[11px] text-fg-subtle">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Linhas "antes → depois". */
type EffectRow = [label: string, before: ReactNode, after?: ReactNode, tone?: 'good' | 'bad'];

function Effects({ rows }: { rows: EffectRow[] }) {
  return (
    <div className="grid gap-1 rounded-lg border border-line/60 bg-bg/30 p-2.5 text-xs">
      {rows.map(([k, a, b, tone]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <span className="text-fg-muted">{k}</span>
          <span className="tabular text-right font-semibold">
            {b !== undefined ? (
              <>
                <span className="text-fg-subtle">{a}</span> <span className="text-fg-subtle">→</span>{' '}
                <span className={tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-fg'}>{b}</span>
              </>
            ) : (
              a
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ───────────── ingresso ───────────── */

const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function TicketBox({ season, clubId, ov, busy, run }: { season: SeasonState; clubId: string; ov: Overview; busy: boolean; run: Run }) {
  const sug = ov.suggestedTicketPrice;
  const min = Math.ceil(sug * FINANCE.minTicketShare * 100) / 100;
  const max = Math.floor(sug * 3 * 100) / 100;
  const [price, setPriceRaw] = useState(ov.ticketPrice);
  // texto livre no campo (formatado só ao sair), para digitar "7,5" sem o campo se reformatar no meio
  const [text, setText] = useState(fmtNum(ov.ticketPrice));
  const setPrice = (v: number) => {
    setPriceRaw(v);
    setText(fmtNum(v));
  };
  const next = useMemo(() => nextHomeFixture(season, clubId), [season, clubId]);
  const now = gateEstimate(season, clubId, next?.awayId, undefined, next);
  const then = gateEstimate(season, clubId, next?.awayId, price, next);
  const changed = Math.abs(price - ov.ticketPrice) >= 0.005;
  return (
    <Box icon={<Ticket />} title="Preço do ingresso" hint={`Sugerido ${fmtPrice(sug)} · ${ov.customTicketPrice == null ? 'usando o sugerido' : `definido ${fmtPrice(ov.ticketPrice)}`}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-fg-muted" title="valores em euros">€</span>
        <Input
          inputMode="decimal"
          aria-label="Preço do ingresso"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d,.]/g, '');
            setText(raw);
            const v = Number(raw.replace(/\./g, '').replace(',', '.'));
            if (Number.isFinite(v) && raw !== '') setPriceRaw(Math.round(v * 100) / 100);
          }}
          onBlur={() => setText(fmtNum(price))}
          className="tabular h-10 w-28 text-base font-bold"
        />
        <span className="text-[11px] text-fg-subtle">
          {Math.round((price / sug) * 100)}% do sugerido
        </span>
      </div>
      <input
        type="range"
        aria-label="Ajustar preço do ingresso"
        min={min}
        max={max}
        step={0.05}
        value={Math.min(max, Math.max(min, price))}
        onChange={(e) => setPrice(Number(e.target.value))}
        className="mt-3 w-full accent-[var(--club-accent)]"
      />
      <div className="mt-1 flex justify-between text-[10px] text-fg-subtle">
        <span>{fmtPrice(min)} · casa cheia</span>
        <span>{fmtPrice(max)} · elite</span>
      </div>
      <div className="mt-3">
        <Effects
          rows={[
            ['Público por jogo', fmtInt(now.attendance), changed ? fmtInt(then.attendance) : undefined, then.attendance >= now.attendance ? 'good' : 'bad'],
            ['Renda por jogo', fmtMoney(now.revenue), changed ? fmtMoney(then.revenue) : undefined, then.revenue >= now.revenue ? 'good' : 'bad'],
            ['Ocupação', `${now.capacity ? Math.round((now.attendance / now.capacity) * 100) : 0}%`, changed ? `${then.capacity ? Math.round((then.attendance / then.capacity) * 100) : 0}%` : undefined],
          ]}
        />
        {next && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
            Próximo jogo em casa: <ClubCrest id={next.awayId} size={14} /> {clubLabel(next.awayId, true)} · {fmtDate(next.date, { day: '2-digit', month: 'short' })}
          </p>
        )}
        <p className="mt-1 text-[11px] text-fg-subtle">Acima do sugerido o estádio esvazia (−50% de público a cada +100% no preço); abaixo, enche até +30%, limitado à capacidade.</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="club"
          size="sm"
          disabled={busy || !changed || price < min}
          onClick={() => run({ op: 'ticket', price }, `Ingresso agora custa ${fmtPrice(price)}.`)}
        >
          <Ticket /> Aplicar preço
        </Button>
        {ov.customTicketPrice != null && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setPrice(sug);
              run({ op: 'ticket', price: null }, 'O clube volta a cobrar o preço sugerido.');
            }}
          >
            <RotateCcw /> Voltar ao sugerido
          </Button>
        )}
      </div>
    </Box>
  );
}

/* ───────────── empréstimo ───────────── */

function LoanBox({ ov, busy, run, ask }: { ov: Overview; busy: boolean; run: Run; clubId: string; ask: (r: ConfirmRequest) => void }) {
  const block = ov.loanBlock;
  const rate = ov.loanRate;
  const canTake = ov.loan + block <= ov.maxLoan;
  const repay = Math.min(ov.loan, block);
  const canRepay = ov.loan > 0 && ov.balance >= repay;
  const pct = ov.maxLoan > 0 ? Math.min(100, (ov.loan / ov.maxLoan) * 100) : 0;
  return (
    <Box icon={<Banknote />} title="Empréstimo bancário" hint={`Blocos de ${fmtMoney(block)} · juros de ${(rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% ao mês, cobrados no dia 1`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-fg-muted">Dívida</div>
          <div className={cn('tabular text-xl font-extrabold', ov.loan > 0 ? 'text-danger' : '')}>{fmtMoney(ov.loan)}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-fg-muted">Juros por mês</div>
          <div className="tabular text-sm font-bold">{fmtMoney(ov.monthlyInterest)}</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <motion.div className="h-full rounded-full bg-danger" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
      </div>
      <div className="mt-1 text-[10px] text-fg-subtle">Teto do banco (35% da receita): {fmtMoney(ov.maxLoan)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !canTake}
          title={canTake ? undefined : 'Limite de empréstimo atingido'}
          onClick={() =>
            ask({
              title: `Pegar ${fmtMoney(block)} emprestado?`,
              confirmLabel: 'Pegar empréstimo',
              body: (
                <Effects
                  rows={[
                    ['Caixa', fmtMoney(ov.balance), fmtMoney(ov.balance + block), 'good'],
                    ['Dívida', fmtMoney(ov.loan), fmtMoney(ov.loan + block), 'bad'],
                    ['Juros por mês', fmtMoney(ov.monthlyInterest), fmtMoney(Math.round((ov.loan + block) * rate)), 'bad'],
                  ]}
                />
              ),
              onConfirm: () => run({ op: 'loan', blocks: 1 }, `Empréstimo de ${fmtMoney(block)} contratado.`),
            })
          }
        >
          <HandCoins /> Pegar {fmtMoney(block)}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !canRepay}
          title={ov.loan <= 0 ? 'Sem dívida' : !canRepay ? 'Saldo insuficiente' : undefined}
          onClick={() =>
            ask({
              title: `Pagar ${fmtMoney(repay)} do empréstimo?`,
              confirmLabel: 'Pagar',
              body: (
                <Effects
                  rows={[
                    ['Caixa', fmtMoney(ov.balance), fmtMoney(ov.balance - repay), 'bad'],
                    ['Dívida', fmtMoney(ov.loan), fmtMoney(ov.loan - repay), 'good'],
                    ['Juros por mês', fmtMoney(ov.monthlyInterest), fmtMoney(Math.round((ov.loan - repay) * rate)), 'good'],
                  ]}
                />
              ),
              onConfirm: () => run({ op: 'repay', blocks: 1 }, `Pagamento de ${fmtMoney(repay)} realizado.`),
            })
          }
        >
          <Banknote /> Pagar {fmtMoney(repay || block)}
        </Button>
      </div>
    </Box>
  );
}

/* ───────────── estádio ───────────── */

function StadiumBox({ season, ov, busy, run, ask }: { season: SeasonState; ov: Overview; busy: boolean; run: Run; clubId: string; ask: (r: ConfirmRequest) => void }) {
  const [seats, setSeats] = useState(5000);
  const cost = seats * ov.seatCost;
  const days = stadiumWorkDays(seats);
  const until = addDays(season.date, days);
  const work = ov.stadiumWork;
  const enough = ov.balance >= cost;
  const progress = work ? Math.min(100, Math.max(0, (daysBetween(work.started, season.date) / Math.max(1, daysBetween(work.started, work.until))) * 100)) : 0;
  return (
    <Box icon={<Building2 />} title="Estádio" hint={`${fmtMoney(ov.seatCost)} por lugar · obra de ${FINANCE.worksBaseDays} + ${FINANCE.worksDaysPer1000} dias por mil lugares`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-fg-muted">Capacidade</div>
          <div className="tabular text-xl font-extrabold">{fmtInt(ov.capacity)}</div>
        </div>
        {work && (
          <div className="text-right">
            <div className="text-[11px] text-warning">Em obras</div>
            <div className="tabular text-sm font-bold">+{fmtInt(work.seats)} lugares</div>
          </div>
        )}
      </div>
      {work ? (
        <div className="mt-3 space-y-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <motion.div className="h-full rounded-full bg-warning" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <Construction className="size-3.5 text-warning" /> Entrega em {fmtDate(work.until)} ({Math.max(0, daysBetween(season.date, work.until))} dias) · custou {fmtMoney(work.cost)}. Uma obra por vez.
          </p>
        </div>
      ) : (
        <>
          <label className="mt-3 block text-[11px] font-semibold tracking-wider text-fg-muted uppercase" htmlFor="stadium-seats">
            Novos lugares: <span className="tabular text-fg">{fmtInt(seats)}</span>
          </label>
          <input
            id="stadium-seats"
            type="range"
            min={1000}
            max={FINANCE.maxSeatsPerWork}
            step={1000}
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            className="mt-1 w-full accent-[var(--club-accent)]"
          />
          <div className="mt-2">
            <Effects
              rows={[
                ['Custo (pago agora)', fmtMoney(cost)],
                ['Caixa', fmtMoney(ov.balance), fmtMoney(ov.balance - cost), 'bad'],
                ['Capacidade', fmtInt(ov.capacity), fmtInt(ov.capacity + seats), 'good'],
                ['Prazo', `${days} dias · ${fmtDate(until)}`],
              ]}
            />
          </div>
          <Button
            variant="club"
            size="sm"
            className="mt-3"
            disabled={busy || !enough}
            title={enough ? undefined : 'Saldo insuficiente'}
            onClick={() =>
              ask({
                title: `Ampliar o estádio em ${fmtInt(seats)} lugares?`,
                confirmLabel: `Pagar ${fmtMoney(cost)} e iniciar obra`,
                irreversible: true,
                body: (
                  <Effects
                    rows={[
                      ['Custo', fmtMoney(cost)],
                      ['Caixa', fmtMoney(ov.balance), fmtMoney(ov.balance - cost), 'bad'],
                      ['Capacidade', fmtInt(ov.capacity), fmtInt(ov.capacity + seats), 'good'],
                      ['Entrega', fmtDate(until)],
                    ]}
                  />
                ),
                onConfirm: () => run({ op: 'stadium', seats }, `Obra iniciada: +${fmtInt(seats)} lugares em ${fmtDate(until)}.`),
              })
            }
          >
            <Building2 /> Ampliar estádio
          </Button>
        </>
      )}
    </Box>
  );
}

/* ───────────── luvas ───────────── */

function LuvasBox({ ov, busy, run, ask }: { ov: Overview; busy: boolean; run: Run; clubId: string; ask: (r: ConfirmRequest) => void }) {
  const total = ov.luvaDebts.reduce((t, d) => t + Math.max(0, d.total - (d.paid ?? 0)), 0);
  return (
    <Box icon={<HandCoins />} title="Luvas parceladas" hint="25% do valor do jogador livre · parcelas sem juros no dia 1">
      {ov.luvaDebts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-fg-muted">
          Nenhuma luva a pagar. Ao contratar um jogador livre no Mercado, você escolhe pagar à vista ou em 6/12 parcelas.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="text-fg-muted">Restante</span>
            <span className="tabular font-bold">
              {fmtMoney(total)} <span className="font-normal text-fg-subtle">· {fmtMoney(ov.monthlyLuvas)}/mês</span>
            </span>
          </div>
          <ul className="space-y-1.5">
            {ov.luvaDebts.map((d) => {
              const rest = Math.max(0, d.total - (d.paid ?? 0));
              const paidPct = d.total > 0 ? ((d.paid ?? 0) / d.total) * 100 : 0;
              return (
                <li key={d.playerId} className="rounded-lg border border-line/60 bg-bg/30 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{d.playerName ?? d.playerId}</div>
                      <div className="tabular text-[11px] text-fg-muted">
                        {d.remainingInstallments}x de {fmtMoney(d.monthly)} · falta {fmtMoney(rest)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || ov.balance < rest}
                      title={ov.balance < rest ? 'Saldo insuficiente' : undefined}
                      onClick={() =>
                        ask({
                          title: `Quitar a luva de ${d.playerName ?? 'jogador'}?`,
                          confirmLabel: `Pagar ${fmtMoney(rest)}`,
                          irreversible: true,
                          body: (
                            <Effects
                              rows={[
                                ['Parcelas restantes', `${d.remainingInstallments}x de ${fmtMoney(d.monthly)}`],
                                ['Caixa', fmtMoney(ov.balance), fmtMoney(ov.balance - rest), 'bad'],
                                ['Luvas por mês', fmtMoney(ov.monthlyLuvas), fmtMoney(ov.monthlyLuvas - d.monthly), 'good'],
                              ]}
                            />
                          ),
                          onConfirm: () => run({ op: 'luva', playerId: d.playerId }, `Luva de ${d.playerName ?? 'jogador'} quitada.`),
                        })
                      }
                    >
                      Quitar luva
                    </Button>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-success" style={{ width: `${paidPct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Box>
  );
}
