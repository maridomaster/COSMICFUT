/**
 * Fim de temporada ONLINE (rota /fim-de-temporada no modo online).
 *
 *  - fase 'season-end' (season:end stage 'review'): campeões, acesso/rebaixamento, premiação, a PRÉVIA da virada
 *    calculada pelo servidor (`preview`) e os contratos vencendo do meu clube (`expiring[meuClube]`), com o pedido
 *    do jogador (`demand.wage`) como salário mínimo. "Enviar" manda `season:renew { renew, ready: true }`.
 *    Prazo (`deadline`) e quem falta (`room.seasonEnd.waitingFor`) ficam no topo.
 *  - depois da virada (season:end stage 'done'): o resumo (`summary`) com a mesma tela do solo (RolloverSummary).
 *
 * As telas/cartões da carreira solo (pages/season-end) são reaproveitados com o `world`/`state` da sala.
 */
import { MoneyField } from '@/components/ui/money-field';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, CalendarCheck, CheckCircle2, Clock, FileSignature, Globe2, Hourglass, Loader2, Pencil, Users } from 'lucide-react';
import type { NetExpiringPlayer, NetRenewTerms, Position, SeasonEndPayload } from '@cosmicfut/shared';
import { finalRanking, seasonOver, type SeasonState, type SeasonSummary, type WorldState } from '@cosmicfut/engine';
import { fmtMoney, fmtMoneySigned, overallColor } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { qualifierRows } from '@/season/continental';
import { clubStatusIn, compShort, myCompetitions } from '@/season/comps';
import { useSeason } from '@/store/season';
import { useMe, useOnline } from '@/store/online';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { PositionChip } from '@/components/game/bits';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { ChampionsCard, closingView, MovesCard, PrizesCard, QualifierList, RolloverSummary } from '@/pages/season-end/SeasonEndPage';
import { seasonLabel as cycleLabel, turnoverInfo } from '@cosmicfut/engine';
import { Countdown } from './common';

type Preview = Partial<Pick<SeasonSummary, 'season' | 'champions' | 'promoted' | 'relegated' | 'stateMoves' | 'serieD' | 'continental'>>;

import { FriendsLeaguePanel } from './FriendsPage';

export function OnlineSeasonEndPage() {
  const save = useSeason((s) => s.save);
  const phase = useOnline((s) => s.room?.phase);
  const review = useOnline((s) => s.seasonEnd);
  const done = useOnline((s) => s.seasonSummary);
  if (!save?.world) return <Waiting title="Carregando a temporada…" />;
  const { season: state, world, clubId } = save;

  if (phase === 'season-end') {
    if (!review) return <Waiting title="Recebendo o fim de temporada do servidor…" />;
    return (
      <>
        <Review key={review.season} state={state} world={world} clubId={clubId} review={review} />
        {/* (17/11) resumo da Liga dos Amigos no fim de temporada */}
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-extrabold tracking-tight">Liga dos Amigos · {review.season}</h2>
          <FriendsLeaguePanel compact />
        </section>
      </>
    );
  }
  if (phase === 'simulating' && seasonOver(state) && !done) {
    return <Waiting title="Virada de temporada em andamento…" text="Acesso e rebaixamento, renovações, aposentadorias, juniores e o calendário novo." />;
  }
  if (done) {
    // o 'done' pode chegar antes do snapshot com o mundo novo
    if (state.season <= done.season) return <Waiting title={`Montando a temporada ${done.season + 1}…`} />;
    // (13/11) o servidor manda humanReleased já filtrado para o meu clube (+ o mapa por clube, por garantia)
    const ids = done.releasedByClub?.[clubId];
    const mine = ids ? (id: string) => ids.includes(id) : undefined;
    return <RolloverSummary summary={done.summary} world={world} state={state} clubId={clubId} mine={mine} />;
  }
  return (
    <div className="cf-card mx-auto mt-6 max-w-lg p-8 text-center">
      <Hourglass className="mx-auto size-10 text-club-accent" />
      <h1 className="mt-4 text-xl font-extrabold">A temporada está em andamento</h1>
      <p className="mt-1 text-sm text-fg-muted">A tela de fim de temporada abre quando todas as competições da sala terminarem.</p>
      <Link to="/dashboard" className="mt-5 inline-block text-sm font-semibold text-club-accent hover:underline">
        Voltar ao painel
      </Link>
    </div>
  );
}

function Waiting({ title, text }: { title: string; text?: string }) {
  return (
    <div className="cf-card mx-auto mt-10 max-w-md p-8 text-center" aria-busy>
      <Loader2 className="mx-auto size-9 animate-spin text-club-accent" />
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      {text && <p className="mt-1 text-sm text-fg-muted">{text}</p>}
    </div>
  );
}

/* ═════════════════════ fase 'season-end' ═════════════════════ */

interface RenewRow {
  on: boolean;
  wage: number;
  years: number;
}

const clampYears = (p: NetExpiringPlayer, y: number) => Math.min(p.demand.maxYears, Math.max(p.demand.minYears, y));

function Review({ state: full, world, clubId, review }: { state: SeasonState; world: WorldState; clubId: string; review: SeasonEndPayload }) {
  // (Etapa 1) balanço só das competições da região que vira (as outras seguem em andamento)
  const state = useMemo(() => closingView(full), [full]);
  const ti = useMemo(() => turnoverInfo(full), [full]);
  const nextLabel = cycleLabel(ti.cycle, ti.season + 1);
  const room = useOnline((s) => s.room);
  const me = useMe();
  const renew = useOnline((s) => s.renew);
  const busy = useOnline((s) => s.renewBusy);
  const setReady = useOnline((s) => s.setReady);
  const readyBusy = useOnline((s) => s.readyBusy);
  const mine = useMemo(() => myCompetitions(state, clubId), [state, clubId]);
  const expiring = useMemo(() => (review.expiring?.[clubId] ?? []).slice().sort((a, b) => b.overall - a.overall), [review, clubId]);
  const [terms, setTerms] = useState<Record<string, RenewRow>>(() =>
    Object.fromEntries(
      // padrão (como no solo): renova os 12 melhores com até 33 anos, pagando o pedido
      expiring.map((p, i) => [p.playerId, { on: i < 12 && p.age <= 33, years: clampYears(p, 2), wage: p.demand.wage }]),
    ),
  );
  const patch = (id: string, p: Partial<RenewRow>) => setTerms((t) => ({ ...t, [id]: { ...t[id], ...p } }));
  const setAll = (on: boolean) => setTerms((t) => Object.fromEntries(Object.entries(t).map(([id, r]) => [id, { ...r, on }])));
  const payAll = () => setTerms((t) => Object.fromEntries(expiring.map((p) => [p.playerId, { ...t[p.playerId], wage: p.demand.wage }])));

  const renewing = expiring.filter((p) => terms[p.playerId]?.on);
  const refusing = renewing.filter((p) => terms[p.playerId].wage < p.demand.wage);
  const wageDelta = renewing.filter((p) => !refusing.includes(p)).reduce((t, p) => t + (terms[p.playerId].wage - p.wage), 0);
  const titles = mine.filter((c) => c.championId === clubId);
  const prizes = state.clubs[clubId]?.finance?.prizes ?? 0;
  const ready = !!me?.ready;
  const waitingIds = room?.seasonEnd?.waitingFor ?? review.waitingFor ?? [];
  const waiting = (room?.players ?? []).filter((p) => waitingIds.includes(p.playerId));
  const deadline = room?.seasonEnd?.deadline ?? review.deadline ?? null;

  const send = async () => {
    const map: Record<string, NetRenewTerms> = {};
    for (const p of renewing) map[p.playerId] = { wage: Math.round(terms[p.playerId].wage), years: terms[p.playerId].years };
    const err = await renew(map, true);
    if (!err) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.section variants={fadeUp} className="cf-card relative overflow-hidden p-5 sm:p-7">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_120%_at_0%_0%,color-mix(in_oklab,var(--club-primary)_28%,transparent),transparent_70%)]" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center">
          <ClubCrest id={clubId} size={84} className="mx-auto md:mx-0" />
          <div className="min-w-0 flex-1 text-center md:text-left">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-club-accent uppercase">Fim de temporada · sala {room?.code}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-4xl">Temporada {ti.label} encerrada</h1>
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
                  <span
                    key={c.id}
                    className={cn(
                      'rounded-lg border px-2 py-1 text-[11px]',
                      st.tone === 'gold' ? 'border-warning/50 bg-warning/10 text-warning' : st.tone === 'good' ? 'border-success/40 text-success' : st.tone === 'bad' ? 'border-danger/40 text-danger' : 'border-line text-fg-muted',
                    )}
                  >
                    <b className="font-semibold text-fg">{compShort(c)}:</b> {st.text}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-2/50 px-3 py-2 text-xs" role="status" aria-live="polite">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-club-accent" />
            Virada automática em <b className="text-fg">{deadline ? <Countdown at={deadline} /> : '—'}</b>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <Users className="size-3.5 text-club-accent" />
            {waiting.length ? (
              <span className="min-w-0 truncate">
                Aguardando: <b className="text-fg">{waiting.map((p) => (p.playerId === me?.playerId ? 'você' : p.nickname)).join(', ')}</b>
              </span>
            ) : (
              'Todos prontos: virada em instantes'
            )}
          </span>
          <span className="w-full text-[11px] text-fg-subtle sm:w-auto">Quem não responder até o prazo renova automaticamente (pelo pedido) os jogadores com menos de 33 anos.</span>
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
        <PreviewCard preview={(review.preview ?? {}) as Preview} state={state} world={world} clubId={clubId} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader
            icon={<FileSignature />}
            title="Contratos vencendo"
            subtitle={
              expiring.length
                ? `${expiring.length === 1 ? '1 jogador' : `${expiring.length} jogadores`} com contrato até o fim de ${ti.label}. Quem não for renovado sai como livre.`
                : 'Nenhum contrato do seu elenco vence nesta virada.'
            }
            action={
              expiring.length > 0 && !ready ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <button className="font-semibold text-club-accent hover:underline" onClick={() => setAll(true)}>
                    Todos
                  </button>
                  <button className="font-semibold text-fg-muted hover:underline" onClick={() => setAll(false)}>
                    Nenhum
                  </button>
                  <button className="font-semibold text-fg-muted hover:underline" onClick={payAll} title="Oferece a cada jogador exatamente o salário pedido">
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
                const t = terms[p.playerId];
                if (!t) return null;
                const low = t.on && t.wage < p.demand.wage;
                return (
                  <div
                    key={p.playerId}
                    className={cn('rounded-xl border px-3 py-2', !t.on ? 'border-line/60 bg-surface-2/35' : low ? 'border-danger/60 bg-danger/[0.08]' : 'border-success/35 bg-surface-2/60')}
                  >
                    <label className="grid cursor-pointer grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_auto] items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={t.on}
                        disabled={ready}
                        onChange={() => patch(p.playerId, { on: !t.on })}
                        className="size-4 accent-[var(--club-accent)]"
                        aria-label={`Renovar ${p.name}`}
                      />
                      <PositionChip position={p.position as Position} />
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
                            <span className="font-semibold text-fg">{fmtMoney(p.demand.wage)}</span>
                            <span className="block text-[10px] text-fg-subtle">
                              {p.demand.minYears === p.demand.maxYears ? `${p.demand.minYears} ${p.demand.minYears > 1 ? 'anos' : 'ano'}` : `${p.demand.minYears}–${p.demand.maxYears} anos`}
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
                          <MoneyField value={t.wage || 0} className="w-44 shrink-0">
                            <Input
                              inputMode="numeric"
                              disabled={ready}
                              aria-label={`Salário oferecido a ${p.name}`}
                              value={t.wage.toLocaleString('pt-BR')}
                              onChange={(e) => patch(p.playerId, { wage: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })}
                              className="tabular h-8 w-32 text-sm font-semibold"
                            />
                          </MoneyField>
                          <span className="text-[11px] text-fg-subtle">/mês</span>
                        </div>
                        <NativeSelect
                          aria-label={`Duração do contrato de ${p.name}`}
                          value={String(t.years)}
                          disabled={ready}
                          className="w-28 [&_select]:h-8 [&_select]:text-xs"
                          onChange={(e) => patch(p.playerId, { years: Number(e.target.value) })}
                        >
                          {/* só a faixa preferida: dentro dela o pedido do servidor vale como está */}
                          {Array.from({ length: p.demand.maxYears - p.demand.minYears + 1 }, (_, i) => p.demand.minYears + i).map((y) => (
                            <option key={y} value={y}>
                              {y} {y > 1 ? 'anos' : 'ano'}
                            </option>
                          ))}
                        </NativeSelect>
                        {low ? <span className="text-[11px] font-semibold text-danger">abaixo do pedido: vai recusar e sair livre</span> : <span className="text-[11px] text-success">aceita</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="pt-2 text-[11px] text-fg-subtle">
                O pedido de cada jogador vem do servidor (salário mínimo aceito, para a duração na faixa preferida). Abaixo dele, o jogador recusa e sai como livre. Variação na
                folha: <b className="text-fg">{fmtMoneySigned(wageDelta)}</b>/mês
                {refusing.length > 0 && <span className="text-danger"> · {refusing.length === 1 ? '1 recusa prevista' : `${refusing.length} recusas previstas`}</span>}.
              </p>
            </CardContent>
          )}
        </Card>
      </motion.div>

      <motion.div
        variants={fadeUp}
        className={cn('flex flex-col items-stretch gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center', ready ? 'border-success/40 bg-success/[0.06]' : 'border-club-accent/30 bg-club-accent/[0.06]')}
      >
        <div className="min-w-0 flex-1 text-sm text-fg-muted">
          {ready ? (
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-success" /> Renovações enviadas. A virada começa quando todos estiverem prontos (ou no fim do prazo).
            </span>
          ) : (
            <>
              A virada aplica acesso e rebaixamento, renovações ({renewing.length - refusing.length}
              {refusing.length ? `, ${refusing.length} devem recusar` : ''}), aposentadorias da região{ti.aging ? ', a evolução anual e os juniores (1º de julho)' : ''} e monta o calendário de {nextLabel}.
            </>
          )}
        </div>
        {ready ? (
          <Button variant="outline" size="lg" disabled={readyBusy} onClick={() => void setReady(false)}>
            {readyBusy ? <Loader2 className="animate-spin" /> : <Pencil />} Alterar renovações
          </Button>
        ) : (
          <Button variant="club" size="lg" disabled={busy} onClick={() => void send()}>
            {busy ? <Loader2 className="animate-spin" /> : <CalendarCheck />} Enviar e ficar pronto
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Prévia EXATA da virada calculada pelo servidor: acesso/rebaixamento nacional e vagas continentais. */
function PreviewCard({ preview, state, world, clubId }: { preview: Preview; state: SeasonState; world: WorldState; clubId: string }) {
  const code = world.countryCode;
  const league = state.competitions.find((c) => c.id === `${code}-1`);
  const cupName = state.competitions.find((c) => c.id === `${code}-CUP`)?.name ?? 'Copa Nacional';
  const cont = preview.continental;
  const rows = useMemo(() => {
    if (!cont) return null;
    const order = league ? (league.format ? finalRanking(league) : league.clubIds) : undefined;
    return qualifierRows(cont.qualifiers, [...cont.libertadores, ...cont.sulamericana], { leagueName: league?.name ?? 'campeonato nacional', cupName, order });
  }, [cont, league, cupName]);
  const divName = (id: string) => state.competitions.find((c) => c.id === id)?.name.replace(/^Brasileirão /, '') ?? id;
  const promoted = Object.entries(preview.promoted ?? {});
  const relegated = Object.entries(preview.relegated ?? {});
  const chip = (id: string, up: boolean) => (
    <span
      key={id}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
        id === clubId ? (up ? 'border-success bg-success/15 font-bold text-success' : 'border-danger bg-danger/15 font-bold text-danger') : 'border-line',
      )}
    >
      <ClubCrest id={id} size={14} />
      {clubLabel(id, true)}
    </span>
  );
  if (!promoted.length && !relegated.length && !rows) return null;
  return (
    <Card>
      <CardHeader icon={<Globe2 />} title={`Prévia de ${state.season + 1}`} subtitle="Calculada pelo servidor com as tabelas finais (é o que a virada vai aplicar)" />
      <CardContent className="space-y-4">
        {(promoted.length > 0 || relegated.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {promoted.map(([div, ids]) => (
              <div key={`p${div}`}>
                <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-success">
                  <ArrowUp className="size-3.5" /> Sobem da {divName(div)}
                </div>
                <div className="flex flex-wrap gap-1">{ids.map((id) => chip(id, true))}</div>
              </div>
            ))}
            {relegated.map(([div, ids]) => (
              <div key={`r${div}`}>
                <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-danger">
                  <ArrowDown className="size-3.5" /> Caem da {divName(div)}
                </div>
                <div className="flex flex-wrap gap-1">{ids.map((id) => chip(id, false))}</div>
              </div>
            ))}
          </div>
        )}
        {rows && (
          <div>
            <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Classificados às continentais de {state.season + 1}</div>
            <QualifierList rows={rows} clubId={clubId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
