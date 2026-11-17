/**
 * (Sala de Troféus) Vitrine premium dos títulos de um clube.
 *  - Todas as competições que o clube pode ganhar (país, UF, confederação + tudo o que já disputou/ganhou), em
 *    prateleiras por nível: Mundial e Continental, Nacional, Copas, Estaduais.
 *  - Ganho: troféu iluminado, emblema, "3×" e os anos como chips (clique = campanha daquela temporada).
 *  - Não ganho: silhueta escura + "Ainda não conquistado" e a melhor campanha.
 * Dados: só `world.history` (ChampionRecord) via clubTrophies/clubHistory — saves antigos funcionam sem migração.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crown, Handshake, Lock, Medal, Trophy, Volleyball, X } from 'lucide-react';
import { clubHistory, clubTrophies, type ChampionRecord, type ClubCampaign, type SeasonState } from '@cosmicfut/engine';
import { cn } from '@/lib/utils';
import { clubIndexEntry } from '@/data/clubIndex';
import {
  COUNTRY_CODE_BY_ID, SHELF_LABEL, SHELVES, compareIdentity, competitionIdentity, shelfOf, winnableCompetitionIds,
  type CompetitionIdentity,
} from '@/data/competitionIdentity';
import { CompetitionEmblem } from '@/components/game/CompetitionEmblem';
import { TrophyArt } from '@/components/game/TrophyArt';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { NativeSelect } from '@/components/ui/input';

const labelOf = (r: ChampionRecord) => r.seasonLabel ?? String(r.season);

export interface CabinetItem {
  idt: CompetitionIdentity;
  /** temporadas ganhas (mais recente primeiro) */
  seasons: string[];
  /** títulos secundários (Taça Guanabara, Apertura...) → temporadas */
  secondary: { title: string; seasons: string[] }[];
  /** melhor campanha sem título (texto + temporada) */
  best: { text: string; season: string } | null;
  /** disputou alguma vez */
  played: boolean;
}

/** Texto curto da campanha (mesma regra da lista "Campanhas por temporada"). */
export function campaignText(c: ClubCampaign): string {
  if (c.champion) return 'Campeão';
  if (c.vice) return 'Vice-campeão';
  if ((c.type === 'league' || (c.type === 'state' && !c.reach)) && c.position) return `${c.position}º lugar${c.of ? ` de ${c.of}` : ''}`;
  if (c.reach) return c.reach;
  return c.position ? `${c.position}º de ${c.of}` : 'Participou';
}

/** Nota da campanha para escolher a "melhor" (maior = melhor). */
function campaignScore(c: ClubCampaign): number {
  if (c.champion) return 1000;
  if (c.vice) return 900;
  if (c.reach) {
    const r = c.reach.toLowerCase();
    if (/semi/.test(r)) return 800;
    if (/quarta/.test(r)) return 700;
    if (/oitava/.test(r)) return 600;
    if (/final/.test(r)) return 850;
    return 500;
  }
  if (c.position && c.of) return 400 - c.position;
  return 0;
}

/** Monta a vitrine de um clube. Puro (exportado para reuso). */
export function buildCabinet(world: { history: ChampionRecord[] }, clubId: string, season?: SeasonState | null): CabinetItem[] {
  const trophies = clubTrophies(world, clubId);
  const history = clubHistory(world, clubId);
  const entry = clubIndexEntry(clubId);
  const country = entry ? COUNTRY_CODE_BY_ID[entry.countryId] ?? null : null;
  const camps = new Map<string, ClubCampaign[]>();
  for (const s of history) for (const c of s.campaigns) (camps.get(c.competitionId) ?? camps.set(c.competitionId, []).get(c.competitionId)!).push(c);
  const current = (season?.competitions ?? []).filter((c) => c.clubIds.includes(clubId)).map((c) => c.id);
  const ids = winnableCompetitionIds({ country, uf: entry?.state ?? null, played: [...camps.keys(), ...current], won: trophies.map((t) => t.competitionId) });
  const nameHint = new Map<string, { name: string; type: string }>();
  for (const t of trophies) nameHint.set(t.competitionId, { name: t.name, type: t.type });
  for (const [id, list] of camps) nameHint.set(id, { name: list[0].name, type: list[0].type });
  for (const c of season?.competitions ?? []) if (!nameHint.has(c.id)) nameHint.set(c.id, { name: c.name, type: c.type });
  return ids.map((id) => {
    const idt = competitionIdentity(id, nameHint.get(id));
    const main = trophies.filter((t) => t.competitionId === id && !t.secondary).map((t) => t.season);
    const sec = new Map<string, string[]>();
    for (const t of trophies) if (t.competitionId === id && t.secondary) (sec.get(t.secondary) ?? sec.set(t.secondary, []).get(t.secondary)!).push(t.season);
    const list = camps.get(id) ?? [];
    let best: CabinetItem['best'] = null;
    if (!main.length && list.length) {
      const b = list.slice().sort((a, b) => campaignScore(b) - campaignScore(a) || b.season.localeCompare(a.season))[0];
      best = { text: campaignText(b), season: b.season };
    }
    return {
      idt,
      seasons: [...new Set(main)].sort((a, b) => b.localeCompare(a)),
      secondary: [...sec.entries()].map(([title, s]) => ({ title, seasons: s.sort((a, b) => b.localeCompare(a)) })),
      best,
      played: list.length > 0 || current.includes(id),
    };
  });
}

export function TrophyRoom({
  world, clubId, human, options, onClub, season,
}: { world: { history: ChampionRecord[] }; clubId: string; human: string; options: string[]; onClub: (id: string) => void; season?: SeasonState | null }) {
  const items = useMemo(() => buildCabinet(world, clubId, season), [world, clubId, season]);
  const [open, setOpen] = useState<{ compId: string; season: string } | null>(null);
  const shelves = useMemo(
    () =>
      SHELVES.map((sh) => ({ sh, list: items.filter((i) => shelfOf(i.idt) === sh).sort((a, b) => compareIdentity(a.idt, b.idt)) })).filter((s) => s.list.length > 0),
    [items],
  );
  const total = items.reduce((s, i) => s + i.seasons.length, 0);
  const extra = items.reduce((s, i) => s + i.secondary.reduce((n, x) => n + x.seasons.length, 0), 0);
  const conquered = items.filter((i) => i.seasons.length > 0).length;
  const entry = clubIndexEntry(clubId);
  const color = entry?.colors.primary ?? 'var(--club-primary)';

  return (
    <div className="space-y-5">
      {/* cabeçalho da sala */}
      <section className="cf-card relative overflow-hidden p-4 sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(70% 140% at 0% 0%, color-mix(in oklab, ${color} 28%, transparent), transparent 70%), radial-gradient(40% 90% at 100% 0%, rgb(251 191 36 / 0.12), transparent 70%)` }}
        />
        <div className="relative flex flex-wrap items-center gap-4">
          <ClubCrest id={clubId} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-warning uppercase">Sala de troféus</p>
            <h2 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{clubLabel(clubId)}</h2>
            <p className="text-xs text-fg-muted">
              {total === 0 ? 'Nenhum título na carreira ainda' : `${total} ${total === 1 ? 'título' : 'títulos'}`}
              {extra > 0 && ` + ${extra} ${extra === 1 ? 'taça/turno' : 'taças/turnos'}`}
              {` · ${conquered} de ${items.length} competições conquistadas`}
            </p>
          </div>
          {options.length > 1 && (
            <NativeSelect aria-label="Clube" value={clubId} onChange={(e) => { setOpen(null); onClub(e.target.value); }} className="w-full sm:w-56">
              {options.map((id) => (
                <option key={id} value={id}>
                  {clubLabel(id)}
                  {id === human ? ' (seu clube)' : ''}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SHELVES.map((sh) => {
            const list = items.filter((i) => shelfOf(i.idt) === sh);
            const n = list.reduce((s, i) => s + i.seasons.length, 0);
            return (
              <div key={sh} className="rounded-xl border border-line/70 bg-surface-2/50 px-3 py-2">
                <div className="text-[10px] font-semibold tracking-[0.14em] text-fg-subtle uppercase">{SHELF_LABEL[sh]}</div>
                <div className="flex items-baseline gap-1">
                  <span className={cn('tabular text-xl font-black', n > 0 ? 'text-warning' : 'text-fg-subtle')}>{n}</span>
                  <span className="text-[11px] text-fg-muted">{n === 1 ? 'título' : 'títulos'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {shelves.map(({ sh, list }) => {
        const won = list.filter((i) => i.seasons.length).length;
        const openHere = open && list.some((i) => i.idt.id === open.compId) ? open : null;
        return (
          <section key={sh} className="cf-card relative overflow-hidden" aria-label={SHELF_LABEL[sh]}>
            {/* luz de prateleira (de cima) */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(251_191_36/0.10),transparent_75%)]" />
            <header className="relative flex items-end justify-between gap-2 px-4 pt-4 sm:px-5">
              <div>
                <h3 className="text-sm font-extrabold tracking-[0.12em] uppercase">{SHELF_LABEL[sh]}</h3>
                <p className="text-[11px] text-fg-subtle">
                  {won} de {list.length} conquistad{list.length === 1 ? 'a' : 'as'}
                </p>
              </div>
            </header>
            <div className="relative grid grid-cols-2 gap-x-2 gap-y-5 px-2 pt-3 pb-4 sm:grid-cols-3 sm:px-4 lg:grid-cols-4 xl:grid-cols-5">
              {list.map((it) => (
                <TrophySlot key={it.idt.id} item={it} active={openHere?.compId === it.idt.id ? openHere.season : null} onSeason={(s) => setOpen(open?.compId === it.idt.id && open.season === s ? null : { compId: it.idt.id, season: s })} />
              ))}
            </div>
            <AnimatePresence initial={false}>
              {openHere && (
                <motion.div key={`${openHere.compId}:${openHere.season}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <CampaignPanel world={world} clubId={clubId} compId={openHere.compId} season={openHere.season} onClose={() => setOpen(null)} />
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}

function TrophySlot({ item, active, onSeason }: { item: CabinetItem; active: string | null; onSeason: (season: string) => void }) {
  const { idt, seasons, secondary, best } = item;
  const won = seasons.length > 0;
  const { secondary: glow, accent } = idt.colors;
  return (
    <div className={cn('group relative flex min-w-0 flex-col items-center rounded-2xl px-1.5 pt-2 pb-2 text-center transition-colors', won ? 'hover:bg-surface-2/40' : 'opacity-90')}>
      <div className="relative flex h-32 w-full items-end justify-center sm:h-36">
        {/* holofote */}
        {won && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-2 top-0 bottom-1 rounded-t-[50%] opacity-90 transition-opacity group-hover:opacity-100"
            style={{ background: `radial-gradient(55% 70% at 50% 62%, color-mix(in oklab, ${glow} 38%, transparent), transparent 72%), linear-gradient(to bottom, rgb(255 255 255 / 0.06), transparent 40%)` }}
          />
        )}
        <TrophyArt compId={idt.id} identity={idt} height={won ? 112 : 100} locked={!won} className="relative z-[1] max-h-full" />
        <div className="absolute top-0 left-1 z-[2]">
          <CompetitionEmblem compId={idt.id} identity={idt} size={28} className={cn(!won && 'opacity-60 grayscale-[60%]')} />
        </div>
        {won ? (
          <span className="tabular absolute top-0 right-1 z-[2] rounded-lg bg-warning px-1.5 py-0.5 text-sm font-black text-[#1a1203] shadow-[0_4px_14px_rgb(251_191_36/0.45)]">
            {seasons.length}×
          </span>
        ) : (
          <span className="absolute top-0.5 right-1.5 z-[2] text-fg-subtle" title="Ainda não conquistado">
            <Lock className="size-3.5" />
          </span>
        )}
      </div>
      {/* prateleira / pedestal iluminado */}
      <div aria-hidden className="relative h-2 w-[88%] rounded-full" style={{ background: won ? `linear-gradient(90deg, transparent, color-mix(in oklab, ${accent} 55%, #6b4f16), transparent)` : 'linear-gradient(90deg, transparent, var(--color-line-strong), transparent)', boxShadow: won ? `0 -6px 18px color-mix(in oklab, ${glow} 45%, transparent)` : undefined }} />
      <div className="mt-2 line-clamp-2 min-h-[2.4em] text-[13px] leading-tight font-bold" title={idt.name}>
        {idt.name}
      </div>
      {won ? (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1">
          {seasons.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={active === s}
              title={`Ver a campanha de ${s}`}
              onClick={() => onSeason(s)}
              className={cn(
                'tabular rounded-md border px-1.5 py-0.5 text-[11px] font-bold transition-colors',
                active === s ? 'border-warning bg-warning text-[#1a1203]' : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-[11px] leading-snug text-fg-subtle">
          <div className="font-semibold">Ainda não conquistado</div>
          {best ? (
            <button type="button" onClick={() => onSeason(best.season)} className="text-fg-muted hover:text-fg hover:underline" title={`Ver a campanha de ${best.season}`}>
              Melhor: {best.text} ({best.season})
            </button>
          ) : (
            !item.played && <div>Nunca disputado</div>
          )}
        </div>
      )}
      {secondary.length > 0 && (
        <div className="mt-1.5 space-y-0.5 text-[10px] text-fg-muted">
          {secondary.map((x) => (
            <div key={x.title} className="flex flex-wrap items-center justify-center gap-1">
              <Medal className="size-3 text-warning/80" />
              <span className="font-semibold">{x.title}</span>
              {x.seasons.map((s) => (
                <button key={s} type="button" onClick={() => onSeason(s)} className="tabular rounded border border-line px-1 hover:border-warning/50 hover:text-warning">
                  {s}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Campanha do clube numa competição/temporada (abre ao clicar num chip de ano). */
function CampaignPanel({ world, clubId, compId, season, onClose }: { world: { history: ChampionRecord[] }; clubId: string; compId: string; season: string; onClose: () => void }) {
  const rec = world.history.find((r) => r.competitionId === compId && labelOf(r) === season);
  const camp = useMemo(() => clubHistory(world, clubId).find((s) => s.season === season), [world, clubId, season]);
  const mine = camp?.campaigns.find((c) => c.competitionId === compId);
  const others = (camp?.campaigns ?? []).filter((c) => c.competitionId !== compId);
  const idt = competitionIdentity(compId, rec ? { name: rec.name, type: rec.type } : undefined);
  const myScorer = rec?.scorers?.find((r) => r[2] === clubId);
  const myAssist = rec?.assists?.find((r) => r[2] === clubId);
  return (
    <div className="border-t border-line/70 bg-surface-2/40 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <CompetitionEmblem compId={compId} identity={idt} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">Campanha {season}</div>
          <div className="truncate text-base font-extrabold">{idt.name}</div>
          <div className={cn('text-sm font-bold', mine?.champion ? 'text-warning' : 'text-fg-muted')}>
            {mine ? campaignText(mine) : rec ? 'Sem participação registrada' : 'Temporada sem registro'}
            {mine?.titles.length ? <span className="ml-1 text-xs font-semibold text-warning">+ {mine.titles.join(', ')}</span> : null}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar campanha" className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
      {rec && (
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <Fact label="Campeão">
            {rec.championId ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <ClubCrest id={rec.championId} size={18} /> <span className="truncate font-semibold">{clubLabel(rec.championId)}</span>
                {rec.championId === clubId && <Crown className="size-3.5 shrink-0 text-warning" />}
              </span>
            ) : '—'}
          </Fact>
          <Fact label="Vice">
            {rec.viceId ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <ClubCrest id={rec.viceId} size={18} /> <span className="truncate font-semibold">{clubLabel(rec.viceId)}</span>
              </span>
            ) : '—'}
          </Fact>
          {rec.scorers?.[0] && (
            <Fact label="Artilheiro">
              <span className="inline-flex min-w-0 items-center gap-1">
                <Volleyball className="size-3 shrink-0" /> <span className="truncate">{rec.scorers[0][1]} ({clubLabel(rec.scorers[0][2], true)}) · {rec.scorers[0][3]} gols</span>
              </span>
            </Fact>
          )}
          {(myScorer || myAssist) && (
            <Fact label="Destaques do clube">
              <span className="truncate">
                {myScorer && `${myScorer[1]}: ${myScorer[3]} ${myScorer[3] === 1 ? 'gol' : 'gols'}`}
                {myScorer && myAssist && ' · '}
                {myAssist && (
                  <span className="inline-flex items-center gap-1">
                    <Handshake className="size-3" /> {myAssist[1]}: {myAssist[3]} assist.
                  </span>
                )}
              </span>
            </Fact>
          )}
        </div>
      )}
      {others.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-fg-subtle uppercase">Outras competições em {season}</div>
          <div className="flex flex-wrap gap-1.5">
            {others.map((c) => {
              const o = competitionIdentity(c.competitionId, { name: c.name, type: c.type });
              return (
                <span key={c.competitionId} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]', c.champion ? 'border-warning/50 bg-warning/10 text-warning' : 'border-line/70 text-fg-muted')}>
                  <CompetitionEmblem compId={c.competitionId} identity={o} size={16} />
                  <span className="font-semibold">{o.name}</span>
                  <span>· {campaignText(c)}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line/60 bg-surface/60 px-2.5 py-1.5">
      <span className="w-20 shrink-0 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">{label}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

/** Ícone para listas compactas (campeão / vice / participou). */
export function CampaignIcon({ c }: { c: ClubCampaign }) {
  return c.champion ? <Crown className="size-4 shrink-0 text-warning" /> : c.vice ? <Medal className="size-4 shrink-0 text-fg-muted" /> : <Trophy className="size-4 shrink-0 text-fg-subtle" />;
}
