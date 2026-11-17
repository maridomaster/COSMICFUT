import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeftRight, Ban, Building2, FileClock, Handshake, History, Inbox, Loader2, Search, Star, Tag, UserPlus, Wallet, Users } from 'lucide-react';
import { MARKET, blockMessage, budgetOf, contractEnd, cycleOfRegion, marketWindow, monthsLeftOf, negotiationBlock, preContractOpen, regionOfClub, releaseClauseOf, seasonLabel, type TransferOffer } from '@cosmicfut/engine';
import { useCurrentClub } from '@/app/ClubContext';
import { useCountryMap, useTraitMap } from '@/data/hooks';
import { fmtDate, fmtMoney, POSITION_META } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useGame } from '@/store/game';
import { useSeasonState, useSeason, useWorld } from '@/store/season';
import { Button } from '@/components/ui/button';
import { PlayerDrawer } from '@/components/game/PlayerDrawer';
import { PageHeader } from '@/components/ui/page-header';
import { ListForSaleButton } from '@/components/game/market';
import { useMarketActions } from './actions';
import { ClubMini, CompareBar, resolvePlayer, useClubMeta, type ResolvedPlayer } from './common';
import { NegotiationModal, type NegotiationTarget } from './NegotiationModal';
import { DEFAULT_FILTERS, SearchTab, type SearchFilters } from './SearchTab';
import { ensureWorker, syncMarketIndex } from './searchClient';
import { FreeAgentsTab, HistoryTab, IncomingTab, LoansTab, NegotiationsTab, ShortlistTab, TransferListTab } from './tabs';
import { ClubSearchTab } from './ClubSearchTab';
import { WindowBanner } from './WindowBanner';

type TabKey = 'buscar' | 'clube' | 'observados' | 'negociacoes' | 'recebidas' | 'venda' | 'livres' | 'emprestimos' | 'movimentacoes';

/** filtros sobrevivem à troca de aba/página */
let savedFilters: SearchFilters = DEFAULT_FILTERS;

export function MarketPage() {
  const { bundle } = useCurrentClub();
  const season = useSeasonState();
  const humanId = bundle.club.id;
  const players = bundle.players;
  const market = season.market;
  const countries = useCountryMap();
  const traits = useTraitMap();
  const clubMeta = useClubMeta();
  const shortlist = useGame((s) => s.shortlist);
  const toggleShortlist = useGame((s) => s.toggleShortlist);
  const lineup = useGame((s) => s.lineup);
  const actions = useMarketActions();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey | null) ?? 'buscar';
  const setTab = (t: TabKey) => setParams(t === 'buscar' ? {} : { tab: t }, { replace: true });

  const [filters, setFiltersState] = useState<SearchFilters>(savedFilters);
  const setFilters = useCallback((f: SearchFilters | ((f: SearchFilters) => SearchFilters)) => {
    setFiltersState((cur) => {
      const next = typeof f === 'function' ? f(cur) : f;
      savedFilters = next;
      return next;
    });
  }, []);

  // worker de busca + clubes efetivos (transferências da temporada)
  useEffect(() => {
    ensureWorker();
  }, []);
  // índice de mercado: idades/overall/clubes atuais, juniores e aposentados da carreira
  const world = useWorld();
  useEffect(() => {
    syncMarketIndex(season, world);
  }, [season, world]);

  const balance = season.clubs[humanId]?.balance ?? 0;
  // (Etapa 1) janela da região do clube humano (Europa, Arábia ou América do Sul)
  const win = marketWindow(season, humanId);
  // (Mercado e Orçamentos) orçamentos separados (null = carreira sem economia)
  const budget = budgetOf(season, humanId);
  const wageNow = players.reduce((t, p) => t + p.wage, 0);
  // (Etapa 5) a lista também tem os excedentes da IA: só os do elenco do humano contam aqui
  const listed = new Set((market?.transferList ?? []).filter((id) => players.some((p) => p.id === id)));
  const open = (market?.offers ?? []).filter((o) => o.toClubId === humanId && (o.status === 'negotiating' || o.status === 'agreed'));
  const wageIn = open.reduce((t, o) => t + (o.wage ?? o.askedWage ?? Math.round(o.player.wage * 1.15)), 0);
  const wageOut = players.filter((p) => listed.has(p.id)).reduce((t, p) => t + p.wage, 0);
  const wageProjected = wageNow + wageIn - wageOut;
  const incoming = (market?.offers ?? []).filter((o) => o.fromClubId === humanId && o.status === 'pending').length;

  // detalhe do jogador
  const [detail, setDetail] = useState<ResolvedPlayer | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const openPlayer = useCallback(
    (id: string) => {
      setLoadingId(id);
      void resolvePlayer(useSeason.getState().save!.season, id).then((r) => {
        setLoadingId(null);
        setDetail(r);
      });
    },
    [],
  );
  const closeDetail = useCallback(() => setDetail(null), []);

  // negociação
  const [target, setTarget] = useState<NegotiationTarget | null>(null);
  const closeNeg = useCallback(() => setTarget(null), []);
  const continueOffer = (o: TransferOffer) => {
    void resolvePlayer(season, o.playerId).then((r) => setTarget({ player: o.player, clubId: o.fromClubId, sellerInfo: r?.sellerInfo, offerId: o.id }));
  };
  const startNegotiation = (d: ResolvedPlayer) => {
    // (online) 'pending' = minha proposta a outro humano aguardando resposta
    const existing = market?.offers.find((o) => o.playerId === d.player.id && o.toClubId === humanId && (o.status === 'negotiating' || o.status === 'agreed' || o.status === 'pending'));
    setDetail(null);
    setTarget({ player: d.player, clubId: d.clubId, sellerInfo: d.sellerInfo, offerId: existing?.id });
  };
  // (Mercado e Orçamentos) 'Buscar por Clube': proposta direto da lista do elenco
  const proposeById = (id: string) => {
    setLoadingId(id);
    void resolvePlayer(useSeason.getState().save!.season, id).then((r) => {
      setLoadingId(null);
      if (r) startNegotiation(r);
    });
  };
  const detailBlock = detail && detail.clubId && detail.clubId !== humanId ? negotiationBlock(season, detail.player.id, humanId) : null;

  const tabs: { key: TabKey; label: string; icon: ReactNode; badge?: number }[] = [
    { key: 'buscar', label: 'Buscar', icon: <Search /> },
    { key: 'clube', label: 'Buscar por Clube', icon: <Building2 /> },
    { key: 'observados', label: 'Observados', icon: <Star />, badge: shortlist.length || undefined },
    { key: 'negociacoes', label: 'Negociações', icon: <Handshake />, badge: open.length || undefined },
    { key: 'recebidas', label: 'Ofertas recebidas', icon: <Inbox />, badge: incoming || undefined },
    { key: 'venda', label: 'À venda', icon: <Tag />, badge: listed.size || undefined },
    { key: 'livres', label: 'Livres e pré-contratos', icon: <UserPlus /> },
    { key: 'emprestimos', label: 'Empréstimos e contratos', icon: <FileClock /> },
    { key: 'movimentacoes', label: 'Movimentações', icon: <History /> },
  ];

  const mine = detail ? detail.clubId === humanId : false;
  const comparison = useMemo(() => {
    if (!detail || mine) return null;
    const samePos = players.filter((p) => p.position === detail.player.position);
    const starters = samePos.filter((p) => lineup?.starters.includes(p.id));
    const ref = (starters.length ? starters : samePos).slice().sort((a, b) => b.overall - a.overall)[0];
    return ref;
  }, [detail, mine, players, lineup]);

  return (
    // (Atualização 41) Mercado compacto: faixa da janela (com os orçamentos) → título numa linha com Caixa/Folha/Elenco
    // → abas. Os indicadores repetidos (orçamento de transferências e folha já estão na faixa) saíram.
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-2.5">
      {/* (Mercado e Orçamentos) faixa fixa da janela + orçamentos */}
      <WindowBanner season={season} clubId={humanId} />

      <motion.div variants={fadeUp}>
        <PageHeader
          title="Mercado"
          eyebrow="Gestão"
          description="Duas etapas: valor ao clube (ou a multa rescisória), depois contrato com o jogador. Também empréstimos, livres e pré-contratos."
          actions={
            <>
              <MarketKpi icon={<Wallet />} label="Caixa" value={<span className={balance < 0 ? 'text-danger' : ''}>{fmtMoney(balance)}</span>} title="Saldo do clube" />
              {(!budget || wageProjected !== wageNow) && (
                <MarketKpi
                  icon={<Users />}
                  label={budget ? 'Folha projetada' : 'Folha'}
                  value={
                    <span className="flex items-baseline gap-1">
                      {fmtMoney(wageNow)}
                      {wageProjected !== wageNow && <span className={cn('text-[11px]', wageProjected > wageNow ? 'text-warning' : 'text-success')}>→ {fmtMoney(wageProjected)}</span>}
                    </span>
                  }
                  title={wageProjected !== wageNow ? 'Folha mensal atual → projetada (negociações abertas e lista de venda)' : 'Folha salarial por mês'}
                />
              )}
              <MarketKpi icon={<ArrowLeftRight />} label="Elenco" value={players.length} title={`Jogadores no elenco (mínimo ${market?.rules.minSquad ?? 18}, máximo ${market?.rules.maxSquad ?? 32})`} />
            </>
          }
        />
        {actions.online && (
          <p className={cn('mt-1.5 rounded-lg border px-2.5 py-1 text-[11px]', actions.blocked ? 'border-warning/40 bg-warning/10 text-warning' : 'border-line bg-surface-2/60 text-fg-muted')} role="status">
            {actions.blocked ?? 'Sala online: o servidor decide cada negociação. Propostas por jogadores de outro técnico esperam a resposta dele até o fim do planejamento.'}
          </p>
        )}
      </motion.div>

      {/* abas */}
      <motion.div variants={fadeUp} className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'none' }}>
        <div role="tablist" aria-label="Seções do mercado" className="flex w-max gap-0.5 rounded-lg border border-line bg-surface-2/60 p-0.5">
          {tabs.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                ref={on ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={cn('relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition-colors [&_svg]:size-3.5', on ? 'text-club-on-accent' : 'text-fg-muted hover:text-fg')}
              >
                {on && <motion.span layoutId="market-tab" className="absolute inset-0 rounded-md bg-club-accent" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="relative flex items-center gap-1.5">
                  {t.icon}
                  {t.label}
                  {t.badge !== undefined && (
                    <span className={cn('tabular grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-black', on ? 'bg-club-on-accent/20' : t.key === 'recebidas' ? 'bg-warning text-bg' : 'bg-surface-3')}>{t.badge}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>
      <motion.div variants={fadeUp} key={tab}>
        {tab === 'buscar' && <SearchTab filters={filters} setFilters={setFilters} humanId={humanId} balance={balance} countries={countries} clubMeta={clubMeta} onOpen={openPlayer} />}
        {tab === 'clube' && <ClubSearchTab season={season} humanId={humanId} clubMeta={clubMeta} countries={countries} onOpen={openPlayer} onPropose={proposeById} />}
        {tab === 'observados' && <ShortlistTab onOpen={openPlayer} countries={countries} clubMeta={clubMeta} moves={market?.moves} />}
        {tab === 'negociacoes' && <NegotiationsTab season={season} humanId={humanId} clubMeta={clubMeta} onContinue={continueOffer} />}
        {tab === 'recebidas' && <IncomingTab season={season} humanId={humanId} clubMeta={clubMeta} />}
        {tab === 'venda' && <TransferListTab season={season} humanId={humanId} players={players} countries={countries} onOpen={openPlayer} />}
        {tab === 'livres' && <FreeAgentsTab season={season} humanId={humanId} clubMeta={clubMeta} countries={countries} onOpen={openPlayer} />}
        {tab === 'emprestimos' && <LoansTab season={season} humanId={humanId} clubMeta={clubMeta} players={players} />}
        {tab === 'movimentacoes' && <HistoryTab season={season} humanId={humanId} clubMeta={clubMeta} />}
      </motion.div>

      {loadingId && (
        <div className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg-muted shadow-lg">
          <Loader2 className="size-4 animate-spin" /> abrindo card…
        </div>
      )}

      <PlayerDrawer
        player={detail?.player ?? null}
        onClose={closeDetail}
        countries={countries}
        traits={traits}
        showLineupStatus={mine}
        context={
          detail && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <ClubMini id={detail.clubId} meta={clubMeta} withName />
              <span>·</span>
              <span>contrato até {(() => {
                // (Etapa 1) temporada contratual do ciclo do clube ("2027" ou "2026/27")
                const r = detail.clubId ? regionOfClub(season, detail.clubId) : null;
                const end = contractEnd(season, detail.player);
                return r && season.segment ? seasonLabel(cycleOfRegion(r), end) : end;
              })()}</span>
              {detail.clubId && (() => {
                // (Etapa 5) meses restantes e multa rescisória
                const mo = monthsLeftOf(season, detail.player, detail.clubId);
                return (
                  <>
                    <span>·</span>
                    <span className={cn(mo !== null && mo <= MARKET.preContractMonths && 'font-semibold text-warning')}>{mo === null ? '' : mo < 1 ? 'último mês' : `${Math.round(mo)} meses`}</span>
                    <span>·</span>
                    <span>multa {fmtMoney(releaseClauseOf(season, detail.player, detail.clubId))}</span>
                  </>
                );
              })()}
            </span>
          )
        }
        actions={
          detail &&
          (mine ? (
            <>
              <ListForSaleButton playerId={detail.player.id} />
              <Button
                variant="outline"
                size="sm"
                disabled={!!actions.blocked}
                aria-pressed={(market?.loanList ?? []).includes(detail.player.id)}
                onClick={() => void actions.setLoanListed([detail.player.id], !(market?.loanList ?? []).includes(detail.player.id))}
              >
                {(market?.loanList ?? []).includes(detail.player.id) ? 'Tirar da lista de empréstimo' : 'Oferecer por empréstimo'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="club" size="sm" onClick={() => startNegotiation(detail)} disabled={!detail.clubId ? false : !!detailBlock || (!win.open && !preContractOpen(season, detail.player, detail.clubId))}>
                {detailBlock ? <Ban /> : <Handshake />} {!detail.clubId ? 'Contratar (livre)' : !win.open && preContractOpen(season, detail.player, detail.clubId) ? 'Pré-contrato' : 'Fazer proposta'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => toggleShortlist(detail.player.id)} aria-pressed={shortlist.includes(detail.player.id)}>
                <Star fill={shortlist.includes(detail.player.id) ? 'currentColor' : 'none'} className={shortlist.includes(detail.player.id) ? 'text-warning' : ''} />
                {shortlist.includes(detail.player.id) ? 'Observando' : 'Observar'}
              </Button>
              {detailBlock && <span className="w-full text-[11px] font-semibold text-danger" role="status">{blockMessage(detailBlock.until)}</span>}
              {!win.open && detail.clubId && <span className="w-full text-[11px] text-warning">Janela fechada: propostas só a partir de {fmtDate(win.opensOn!, { day: '2-digit', month: 'short' })}.</span>}
            </>
          ))
        }
        extra={
          detail && !mine ? (
            <section className="px-5 pt-6">
              <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Comparação com seu titular</h3>
              {comparison ? (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-1.5 text-xs">
                    <span className="truncate font-semibold text-club-accent">{detail.player.name}</span>
                    <span className="truncate text-fg-muted">
                      {comparison.name} ({POSITION_META[comparison.position].short})
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    <CompareBar label="Overall" a={detail.player.overall} b={comparison.overall} />
                    <CompareBar label="Potencial" a={detail.player.potential} b={comparison.potential} delay={0.05} />
                    <CompareBar label="Idade" a={detail.player.age} b={comparison.age} invert delay={0.1} />
                    <CompareBar label="Valor" a={detail.player.value} b={comparison.value} fmt={fmtMoney} delay={0.15} />
                    <CompareBar label="Salário" a={detail.player.wage} b={comparison.wage} fmt={fmtMoney} invert delay={0.2} />
                  </div>
                </>
              ) : (
                <p className="text-xs text-fg-muted">Você não tem jogadores nessa posição — seria reforço imediato.</p>
              )}
            </section>
          ) : undefined
        }
      />

      <NegotiationModal target={target} onClose={closeNeg} clubMeta={clubMeta} />
    </motion.div>
  );
}

/** (Atualização 41) Número-chave compacto (pílula de 28px) no cabeçalho do Mercado. */
function MarketKpi({ icon, label, value, title }: { icon: ReactNode; label: string; value: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-2 [&_svg]:size-3.5 [&_svg]:text-club-accent">
      {icon}
      <span className="cf-label">{label}</span>
      <span className="tabular text-[13px] font-bold text-fg">{value}</span>
    </span>
  );
}