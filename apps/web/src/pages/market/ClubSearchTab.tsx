/**
 * (Mercado e Orçamentos) Aba "Buscar por Clube": escolha qualquer clube do mundo (busca por nome/país) e veja o elenco
 * atual inteiro — OVR, idade, posição, valor de mercado, salário, fim de contrato, situação (à venda, emprestável,
 * negociando, clube irritado) — com "Fazer proposta" direto para o modal de negociação.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ban, Handshake, Loader2, Search, X } from 'lucide-react';
import type { ClubIndexEntry, Country, Player } from '@cosmicfut/shared';
import {
  MARKET, blockMessage, contractEnd, cycleOfRegion, ddmm, marketWindow, monthsLeftOf, negotiationBlock, preContractOpen, regionOfClub,
  rejectionCount, seasonLabel, type SeasonState,
} from '@cosmicfut/engine';
import { ensureBundles, squads } from '@/data/squads';
import { fmtMoney, POSITION_ORDER } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { FitScroll } from '@/components/ui/fit-scroll';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Flag, OvrBadge, PositionChip } from '@/components/game/bits';
import { ClubMini } from './common';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** clube escolhido sobrevive à troca de aba */
let savedClub: string | null = null;

type SortKey = 'ovr' | 'pos' | 'age' | 'value' | 'wage' | 'contract';

export function ClubSearchTab({
  season, humanId, clubMeta, countries, onOpen, onPropose,
}: {
  season: SeasonState;
  humanId: string;
  clubMeta: Map<string, ClubIndexEntry>;
  countries: Map<number, Country>;
  onOpen: (id: string) => void;
  onPropose: (id: string) => void;
}) {
  const [club, setClubState] = useState<string | null>(savedClub);
  const setClub = (id: string | null) => {
    savedClub = id;
    setClubState(id);
  };
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [sort, setSort] = useState<SortKey>('ovr');

  // clubes do mundo (sem convidados de fora do escopo, que não têm mercado)
  const all = useMemo(() => [...clubMeta.values()].filter((c) => !c.guest).map((c) => ({ c, key: norm(`${c.name} ${countries.get(c.countryId)?.name ?? ''}`) })), [clubMeta, countries]);
  const results = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    return all
      .filter((x) => words.every((w) => x.key.includes(w)))
      .sort((a, b) => Number(!norm(a.c.name).startsWith(words[0])) - Number(!norm(b.c.name).startsWith(words[0])) || a.c.level - b.c.level || (b.c.reputation ?? 0) - (a.c.reputation ?? 0))
      .slice(0, 30)
      .map((x) => x.c);
  }, [all, query]);

  // elenco: carrega o bundle (traits/lado) e lê o elenco EFETIVO da carreira (mercado, evolução)
  useEffect(() => {
    if (!club) return;
    let alive = true;
    setLoading(true);
    void ensureBundles([club]).finally(() => {
      if (!alive) return;
      setLoading(false);
      setTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
  }, [club]);

  const squad = useMemo(() => (club ? squads(club).slice() : []), [club, season, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const region = club ? regionOfClub(season, club) : null;
  const win = marketWindow(season, humanId);
  const m = season.market;
  const listed = new Set(m?.transferList ?? []);
  const loanListed = new Set(m?.loanList ?? []);
  const negotiating = new Set((m?.offers ?? []).filter((o) => o.toClubId === humanId && (o.status === 'negotiating' || o.status === 'agreed' || o.status === 'pending')).map((o) => o.playerId));
  const mine = club === humanId;

  const rows = useMemo(() => {
    const out = squad.map((p) => ({ p, end: contractEnd(season, p), months: club ? monthsLeftOf(season, p, club) : null }));
    const by: Record<SortKey, (a: (typeof out)[number], b: (typeof out)[number]) => number> = {
      ovr: (a, b) => b.p.overall - a.p.overall,
      pos: (a, b) => POSITION_ORDER.indexOf(a.p.position) - POSITION_ORDER.indexOf(b.p.position) || b.p.overall - a.p.overall,
      age: (a, b) => a.p.age - b.p.age,
      value: (a, b) => b.p.value - a.p.value,
      wage: (a, b) => b.p.wage - a.p.wage,
      contract: (a, b) => (a.months ?? 99) - (b.months ?? 99),
    };
    return out.sort(by[sort]);
  }, [squad, season, club, sort]);

  const meta = club ? clubMeta.get(club) : undefined;
  const totals = useMemo(() => ({
    value: squad.reduce((s, p) => s + p.value, 0),
    wage: squad.reduce((s, p) => s + p.wage, 0),
    ovr: squad.length ? squad.map((p) => p.overall).sort((a, b) => b - a).slice(0, 11).reduce((s, v) => s + v, 0) / Math.min(11, squad.length) : 0,
  }), [squad]);

  return (
    <div className="space-y-3">
      <Card className="relative p-2">
        <label className="sr-only" htmlFor="club-search">Clube</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            id="club-search"
            value={query}
            placeholder={club ? `${meta?.name ?? club} — buscar outro clube…` : 'Digite o nome do clube ou do país (ex.: Palmeiras, Arsenal, Itália)'}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoComplete="off"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="club-search-results"
          />
          {query && (
            <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')} className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-muted hover:text-fg">
              <X className="size-4" />
            </button>
          )}
        </div>
        {results.length > 0 && (
          <ul id="club-search-results" role="listbox" className="scrollbar-thin absolute right-3 left-3 z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.id === club}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setClub(c.id);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                >
                  <ClubMini id={c.id} meta={clubMeta} size={20} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-fg-muted">
                    <Flag country={countries.get(c.countryId)} /> {countries.get(c.countryId)?.name ?? ''}{c.id === humanId ? ' · seu clube' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && !results.length && <p className="mt-2 text-xs text-fg-muted">Nenhum clube encontrado.</p>}
      </Card>

      {!club ? (
        <Card className="grid place-items-center gap-1 px-4 py-8 text-center text-sm text-fg-muted">
          <Search className="size-8 text-fg-subtle" />
          Escolha um clube para ver o elenco inteiro e fazer propostas.
        </Card>
      ) : (
        <Card className="px-1.5 py-1.5 sm:px-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 pb-1.5">
            <ClubMini id={club} meta={clubMeta} size={24} withName className="text-sm font-bold" />
            <span className="flex items-center gap-1 text-xs text-fg-muted"><Flag country={meta ? countries.get(meta.countryId) : undefined} /> {meta ? countries.get(meta.countryId)?.name : ''}</span>
            <span className="text-xs text-fg-muted"><b className="text-fg">{squad.length}</b> jogadores · XI {totals.ovr.toFixed(1)} · valor {fmtMoney(totals.value)} · folha {fmtMoney(totals.wage)}/mês</span>
            <span className="ml-auto flex items-center gap-2 text-xs">
              <label htmlFor="club-sort" className="text-fg-muted">Ordenar</label>
              <NativeSelect id="club-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="text-xs [&_select]:h-7 [&_select]:text-xs">
                <option value="ovr">OVR</option>
                <option value="pos">Posição</option>
                <option value="age">Idade</option>
                <option value="value">Valor</option>
                <option value="wage">Salário</option>
                <option value="contract">Fim de contrato</option>
              </NativeSelect>
            </span>
          </div>
          {loading && !squad.length ? (
            <p className="flex items-center gap-2 px-2 py-6 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> carregando elenco…</p>
          ) : !squad.length ? (
            <p className="px-2 py-6 text-sm text-fg-muted">Elenco indisponível para este clube.</p>
          ) : (
            <FitScroll className="overflow-x-auto" bottom={28}>
              <table className="w-full min-w-[34rem] text-[13px]">
                <thead className="sticky top-0 z-[1] bg-surface">
                  <tr className="cf-label border-b border-line text-left">
                    <th className="px-2 py-1.5">Jogador</th>
                    <th className="px-1 py-1.5 text-center">OVR</th>
                    <th className="px-1 py-1.5 text-right">Idade</th>
                    <th className="px-1 py-1.5 text-right">Valor</th>
                    <th className="hidden px-1 py-1.5 text-right sm:table-cell">Salário</th>
                    <th className="hidden px-1 py-1.5 text-right md:table-cell">Contrato</th>
                    <th className="px-2 py-1.5 text-right">{mine ? '' : 'Ação'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {rows.map(({ p, end, months }) => (
                    <SquadRow
                      key={p.id}
                      p={p}
                      season={season}
                      humanId={humanId}
                      clubId={club}
                      endLabel={region && season.segment ? seasonLabel(cycleOfRegion(region), end) : String(end)}
                      months={months}
                      listed={listed.has(p.id)}
                      loanListed={loanListed.has(p.id)}
                      onLoan={m?.contracts[p.id]?.kind === 'loan'}
                      negotiating={negotiating.has(p.id)}
                      mine={mine}
                      windowOpen={win.open}
                      country={countries.get(p.nationalityId)}
                      onOpen={onOpen}
                      onPropose={onPropose}
                    />
                  ))}
                </tbody>
              </table>
            </FitScroll>
          )}
        </Card>
      )}
    </div>
  );
}

function SquadRow({
  p, season, humanId, clubId, endLabel, months, listed, loanListed, onLoan, negotiating, mine, windowOpen, country, onOpen, onPropose,
}: {
  p: Player; season: SeasonState; humanId: string; clubId: string; endLabel: string; months: number | null; listed: boolean; loanListed: boolean;
  onLoan: boolean; negotiating: boolean; mine: boolean; windowOpen: boolean; country: Country | undefined; onOpen: (id: string) => void; onPropose: (id: string) => void;
}) {
  const block = mine ? null : negotiationBlock(season, p.id, humanId);
  const refusals = mine || block ? 0 : rejectionCount(season, p.id, humanId);
  const pre = !mine && !windowOpen && preContractOpen(season, p, clubId);
  const canPropose = !mine && !block && (windowOpen || pre);
  const short = months !== null && months <= MARKET.preContractMonths;
  return (
    <tr className={cn(block && 'bg-danger/5', listed && !block && 'bg-warning/5')}>
      <td className="px-2 py-1">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => onOpen(p.id)}>
          <PositionChip position={p.position} />
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="truncate font-semibold">{p.name}</span>
            <span className="flex flex-wrap items-center gap-1 text-[10px] text-fg-muted">
              <Flag country={country} />
              {listed && <Tag tone="warning">À venda</Tag>}
              {loanListed && <Tag tone="info">Emprestável</Tag>}
              {onLoan && <Tag tone="muted">Emprestado</Tag>}
              {negotiating && <Tag tone="info">Negociando</Tag>}
              {refusals > 0 && <Tag tone="warning">{refusals} recusa{refusals > 1 ? 's' : ''}</Tag>}
              {block && <Tag tone="danger">Irritado até {ddmm(block.until)}</Tag>}
            </span>
          </span>
        </button>
      </td>
      <td className="px-1 py-1 text-center"><OvrBadge value={p.overall} size="sm" /></td>
      <td className="tabular px-1 py-1 text-right">{p.age}</td>
      <td className="tabular px-1 py-1 text-right">{fmtMoney(p.value)}</td>
      <td className="tabular hidden px-1 py-1 text-right sm:table-cell">{fmtMoney(p.wage)}</td>
      <td className={cn('tabular hidden px-1 py-1 text-right whitespace-nowrap md:table-cell', short && 'font-semibold text-warning')}>
        {endLabel}
        {months !== null && <span className="ml-1 text-[10px] font-normal text-fg-subtle">{months < 1 ? 'últ. mês' : `${Math.round(months)}m`}</span>}
      </td>
      <td className="px-2 py-1 text-right">
        {!mine && (
          <Button
            size="sm"
            variant={canPropose ? 'club' : 'outline'}
            disabled={!canPropose}
            title={block ? blockMessage(block.until) : !windowOpen && !pre ? 'Janela fechada' : undefined}
            onClick={() => onPropose(p.id)}
            className="whitespace-nowrap"
          >
            {block ? <Ban /> : <Handshake />} {block ? `Até ${ddmm(block.until)}` : pre ? 'Pré-contrato' : 'Fazer proposta'}
          </Button>
        )}
      </td>
    </tr>
  );
}

function Tag({ tone, children }: { tone: 'warning' | 'danger' | 'info' | 'muted'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded px-1 py-px text-[9px] font-bold tracking-wide uppercase',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-danger/15 text-danger',
        tone === 'info' && 'bg-club-accent/15 text-club-accent',
        tone === 'muted' && 'bg-surface-3 text-fg-muted',
      )}
    >
      {children}
    </span>
  );
}
