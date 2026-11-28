/**
 * (28/11) Patrocínio master: contrato em vigor (marca, valor, metas) e propostas que chegam de tempos em tempos.
 * Solo e online (ação `finance` → op 'sponsor').
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { BadgeDollarSign, Check, Handshake, Target, Trophy, X } from 'lucide-react';
import { SPONSOR, sponsorSlotMonthly, type SeasonState, type SponsorDeal } from '@cosmicfut/engine';
import { fmtDate, fmtMoney } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { daysBetween } from '@/season/view';
import { useMarketActions } from '@/pages/market/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

function Goals({ deal, slotYear }: { deal: SponsorDeal; slotYear: number }) {
  if (!deal.goals.length) return <p className="text-xs text-fg-subtle">Sem metas.</p>;
  void slotYear;
  return (
    <ul className="space-y-1 text-xs">
      {deal.goals.map((g, i) => {
        const last = g.done ? Object.entries(g.done).at(-1) : undefined;
        return (
          <li key={i} className="flex items-center gap-1.5">
            {g.kind === 'title' ? <Trophy className="size-3.5 text-warning" /> : <Target className="size-3.5 text-club-accent" />}
            <span className="min-w-0 flex-1">{g.kind === 'title' ? 'Ganhar um título na temporada' : `Terminar a liga até o ${g.position}º lugar`}</span>
            <b className="tabular text-success">+{fmtMoney(g.bonus)}</b>
            {last && <span className={cn('text-[10px] font-semibold', last[1] ? 'text-success' : 'text-danger')}>{last[0]}: {last[1] ? 'cumprida' : 'não cumprida'}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function SponsorPanel({ season, clubId }: { season: SeasonState; clubId: string }) {
  const st = season.market?.sponsor?.[clubId];
  const actions = useMarketActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const slot = sponsorSlotMonthly(season.clubInfo?.[clubId]);
  const act = (o: SponsorDeal, accept: boolean) => {
    setBusy(o.id);
    void actions.finance({ op: 'sponsor', offerId: o.id, accept }).then((r) => {
      setBusy(null);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: accept ? `Contrato assinado com ${o.brand}.` : `Proposta de ${o.brand} recusada.` });
    });
  };
  const deal = st?.deal ?? null;
  return (
    <Card data-testid="sponsor-panel">
      <CardHeader
        icon={<BadgeDollarSign />}
        title="Patrocínio master"
        subtitle={`A marca principal da camisa: cota de ${fmtMoney(slot)}/mês (${Math.round(SPONSOR.slotShare * 100)}% do patrocínio do clube). Sem contrato, o clube recebe só os demais patrocínios.`}
      />
      <CardContent className="space-y-3">
        {msg && <p className={cn('rounded-xl border px-3 py-2 text-sm', msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger')} role="status">{msg.text}</p>}
        {!st ? (
          <p className="text-sm text-fg-muted">O patrocínio master começa no próximo dia da temporada.</p>
        ) : (
          <>
            <div className={cn('rounded-xl border p-3', deal ? 'border-club-accent/40 bg-club-accent/5' : 'border-danger/40 bg-danger/5')} data-testid="sponsor-deal">
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Contrato atual</div>
              {deal ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-lg font-black">{deal.brand}</span>
                    <span className="text-xs text-fg-muted">{deal.sector}</span>
                    <span className="tabular ml-auto font-bold text-success">{fmtMoney(deal.monthly)}/mês</span>
                  </div>
                  <p className="mb-2 text-xs text-fg-muted">até {deal.end ? fmtDate(deal.end) : '—'}{deal.default ? ' · o patrocinador que o clube já tinha' : ''}</p>
                  <Goals deal={deal} slotYear={slot * 12} />
                </>
              ) : (
                <p className="text-sm font-semibold text-danger">Sem patrocinador master — o clube deixa de receber {fmtMoney(slot)}/mês. Assine uma proposta abaixo.</p>
              )}
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                <Handshake className="size-3.5" /> Propostas ({st.offers.length})
              </div>
              {!st.offers.length ? (
                <p className="text-xs text-fg-subtle">Nenhuma no momento. Novas propostas chegam a partir de {fmtDate(st.nextOfferOn)}.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {st.offers.map((o) => {
                    const diff = o.monthly - (deal?.monthly ?? 0);
                    const left = o.expiresOn ? Math.max(0, daysBetween(season.date, o.expiresOn)) : null;
                    return (
                      <motion.div key={o.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: EASE_OUT }} className="cf-card flex flex-col gap-2 p-3" data-testid="sponsor-offer">
                        <div className="flex items-baseline gap-2">
                          <span className="font-black">{o.brand}</span>
                          <span className="text-[11px] text-fg-muted">{o.sector}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="tabular text-lg font-black text-success">{fmtMoney(o.monthly)}/mês</span>
                          <span className="text-[11px] text-fg-muted">· {o.years} {o.years > 1 ? 'anos' : 'ano'}</span>
                          {deal && <span className={cn('tabular ml-auto text-[11px] font-semibold', diff >= 0 ? 'text-success' : 'text-danger')}>{diff >= 0 ? '+' : ''}{fmtMoney(diff)} vs atual</span>}
                        </div>
                        <Goals deal={o} slotYear={slot * 12} />
                        <div className="mt-auto flex items-center gap-2 pt-1">
                          {left !== null && <span className="text-[11px] text-fg-subtle">expira em {left} {left === 1 ? 'dia' : 'dias'}</span>}
                          <Button size="sm" variant="outline" className="ml-auto" disabled={!!busy || !!actions.blocked} onClick={() => act(o, false)} data-testid="sponsor-decline">
                            <X /> Recusar
                          </Button>
                          <Button size="sm" variant="club" disabled={!!busy || !!actions.blocked} onClick={() => act(o, true)} data-testid="sponsor-accept">
                            <Check /> Assinar
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="text-[11px] text-fg-subtle">Assinar troca o contrato atual na hora. Os bônus das metas são pagos no último dia da temporada do clube.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
