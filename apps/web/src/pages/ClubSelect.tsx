import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft, Check, FolderOpen, Globe2, Info, Lock, Search, SlidersHorizontal, X } from 'lucide-react';
import type { ClubIndexEntry, Country } from '@cosmicfut/shared';
import { useClubIndex, useCountryMap, useLeagues, useStates } from '@/data/hooks';
import { BRAZIL_ID, careerPlayableClubs } from '@/career/data';
import { clubHasBundle, indexCrestPaths } from '@/data/source';
import { applyClubTheme, computeClubTheme } from '@/lib/color';
import { levelToStars } from '@/lib/format';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { cn, normalizeSearch } from '@/lib/utils';
import { useSoloGame as useGame } from '@/store/game';
import { useMode } from '@/store/mode';
import { MAX_CAREER_SLOTS, refreshSlots, startNewCareer, useCareerSlots } from '@/career/slots';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Crest } from '@/components/game/Crest';
import { Flag, Stars } from '@/components/game/bits';
import { commitHotseat, HotseatSetup, type HotseatDraft } from '@/pages/hotseat/Hotseat';

const PAGE = 60;
const STATE_ONLY = '__state_only__';

export function ClubSelectPage() {
  const navigate = useNavigate();
  const currentClubId = useGame((s) => s.clubId);
  const { data: index, origin, loading } = useClubIndex();
  const { data: leagues } = useLeagues();
  const { data: states } = useStates();
  const countries = useCountryMap();

  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<string>('all');
  const [league, setLeague] = useState<string>('all');
  const [limit, setLimit] = useState(PAGE);
  const [onlyLeague, setOnlyLeague] = useState(true);
  const [firstName, setFirstName] = useState('Técnico 1');
  const [extra, setExtra] = useState<HotseatDraft[]>([]);

  useEffect(() => applyClubTheme(null), []);
  useEffect(() => setLimit(PAGE), [query, country, league, onlyLeague]);

  /**
   * Clubes com carreira (Fase 1): divisões nacionais reais de qualquer país + TODOS os clubes dos
   * estaduais brasileiros (inclusive os que só jogam o estadual). Sem divisão nem estadual → sem carreira.
   */
  const { all: leagueClubs, stateOnly } = useMemo(() => careerPlayableClubs({ leagues: leagues ?? [], states: states ?? [] }), [leagues, states]);
  const hasLeague = (c: ClubIndexEntry) => leagueClubs.has(c.id);
  const noLeagueCount = useMemo(() => (index ?? []).filter((c) => !c.guest && !leagueClubs.has(c.id)).length, [index, leagueClubs]);

  const countryOptions = useMemo(() => {
    const ids = new Set((index ?? []).filter((c) => !c.guest).map((c) => c.countryId));
    return [...ids]
      .map((id) => ({ id, name: countries.get(id)?.name ?? `País ${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [index, countries]);

  const leagueOptions = useMemo(() => {
    const used = new Set((index ?? []).map((c) => c.leagueId).filter(Boolean));
    return (leagues ?? [])
      .filter((l) => used.has(l.id) && (country === 'all' || String(l.countryId) === country))
      .sort((a, b) => a.countryId - b.countryId || a.division - b.division);
  }, [leagues, index, country]);

  useEffect(() => {
    if (league !== 'all' && league !== STATE_ONLY && !leagueOptions.some((l) => l.id === league)) setLeague('all');
  }, [leagueOptions, league]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    return (index ?? [])
      // (Etapa 2) convidados (fora do escopo, só continentais) nunca são selecionáveis
      .filter((c) => !c.guest)
      .filter((c) => country === 'all' || String(c.countryId) === country)
      .filter((c) => league === 'all' || (league === STATE_ONLY ? stateOnly.has(c.id) : c.leagueId === league))
      .filter((c) => !q || normalizeSearch(c.name).includes(q))
      .filter((c) => !onlyLeague || leagueClubs.has(c.id))
      .sort((a, b) => {
        // clubes jogáveis primeiro, depois nível desc, depois nome
        const pa = origin ? Number(clubHasBundle(a.id, origin) && leagueClubs.has(a.id)) : 0;
        const pb = origin ? Number(clubHasBundle(b.id, origin) && leagueClubs.has(b.id)) : 0;
        return pb - pa || b.level - a.level || a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [index, query, country, league, origin, onlyLeague, leagueClubs, stateOnly]);

  const hasFilters = query || country !== 'all' || league !== 'all' || !onlyLeague;

  const [limitError, setLimitError] = useState<string | null>(null);
  const slotCount = useCareerSlots((s) => s.slots.length);
  useEffect(() => {
    void refreshSlots();
  }, []);

  const choose = async (club: ClubIndexEntry) => {
    // nova carreira = slot novo: a carreira atual continua salva no slot dela (o boot cria a SeasonState nova)
    try {
      commitHotseat(club.id, firstName, extra);
      await startNewCareer(club);
      navigate('/dashboard');
    } catch (e) {
      setLimitError(e instanceof Error ? e.message : String(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="cf-backdrop relative min-h-dvh overflow-hidden">
      {/* nebulosa de fundo */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_22%,transparent),transparent_70%)]" />
      <div className="relative mx-auto max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-8">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-1">
            {slotCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => navigate('/carreiras')}>
                <FolderOpen /> <span className="hidden min-[380px]:inline">Carreiras</span>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate('/inicio')}>
              <Globe2 /> <span className="hidden min-[380px]:inline">Jogar</span> Online
            </Button>
            {currentClubId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  useMode.getState().setMode('solo');
                  navigate('/dashboard');
                }}
              >
                <ArrowLeft /> <span className="hidden sm:inline">Voltar ao jogo</span>
              </Button>
            )}
          </div>
        </header>
        {/* (17/11) hot-seat: vários técnicos no mesmo computador */}
        <HotseatSetup index={(index ?? []).filter((c) => leagueClubs.has(c.id))} firstName={firstName} onFirstName={setFirstName} extra={extra} onExtra={setExtra} />

        <motion.section initial="hidden" animate="show" variants={staggerContainer(0.08)} className="pt-6 pb-8 sm:pt-10">
          <motion.p variants={fadeUp} className="text-xs font-semibold tracking-[0.22em] text-brand-2 uppercase">
            Novo jogo
          </motion.p>
          <motion.h1 variants={fadeUp} className="mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">
            Escolha seu clube
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-3 max-w-xl text-sm text-fg-muted sm:text-base">
            Assuma o comando de um dos {index?.length ?? '…'} clubes disponíveis. Cada escolha muda o elenco, o orçamento e as cores do seu painel.
            {slotCount > 0 && ` A nova carreira ganha um slot próprio (${slotCount}/${MAX_CAREER_SLOTS} em uso) e as outras continuam salvas.`}
          </motion.p>
          {(limitError || slotCount >= MAX_CAREER_SLOTS) && (
            <motion.div variants={fadeUp} role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm">
              <Info className="size-4 shrink-0 text-warning" />
              <span className="min-w-0 flex-1">{limitError ?? `Você já tem ${MAX_CAREER_SLOTS} carreiras. Exclua ou exporte uma para começar outra.`}</span>
              <Button size="sm" variant="outline" onClick={() => navigate('/carreiras')}>
                Gerenciar carreiras
              </Button>
            </motion.div>
          )}
        </motion.section>

        {/* filtros */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: EASE_OUT }}
          className="cf-card sticky top-3 z-10 flex flex-col gap-3 p-3 backdrop-blur-xl sm:flex-row sm:items-center"
          style={{ background: 'color-mix(in oklab, var(--color-surface) 85%, transparent)' }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar clube…" className="pl-9" aria-label="Buscar clube" />
            {query && (
              <button aria-label="Limpar busca" onClick={() => setQuery('')} className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-fg-subtle hover:text-fg">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <NativeSelect value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Filtrar por país" className="sm:w-48">
              <option value="all">Todos os países</option>
              {countryOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={league} onChange={(e) => setLeague(e.target.value)} aria-label="Filtrar por liga" className="sm:w-56">
              <option value="all">Todas as ligas</option>
              {stateOnly.size > 0 && (country === 'all' || country === String(BRAZIL_ID)) && <option value={STATE_ONLY}>Só estadual (Brasil)</option>}
              {leagueOptions.filter((l) => !l.fictional).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.divisionName}
                </option>
              ))}
            </NativeSelect>
          </div>
        </motion.div>

        {noLeagueCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/30 bg-warning/[0.07] px-3.5 py-2.5 text-xs text-fg-muted">
            <Info className="size-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1">
              Clubes que só jogam o estadual agora têm carreira completa. <b className="font-semibold text-fg">{noLeagueCount.toLocaleString('pt-BR')} clubes</b> (de países sem divisão nacional
              nos dados) ainda não disputam nenhuma competição e não podem ser escolhidos
              {onlyLeague ? ' (ocultos pelo filtro).' : '.'}
            </span>
            <label className="flex cursor-pointer items-center gap-2 font-semibold text-fg select-none">
              <input type="checkbox" checked={onlyLeague} onChange={(e) => setOnlyLeague(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
              Apenas clubes jogáveis
            </label>
          </div>
        )}

        <div className="mt-5 mb-3 flex items-center justify-between text-xs text-fg-muted">
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="size-3.5" />
            {filtered.length} {filtered.length === 1 ? 'clube' : 'clubes'}
          </span>
          {hasFilters && (
            <button
              className="font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              onClick={() => {
                setQuery('');
                setCountry('all');
                setLeague('all');
                setOnlyLeague(true);
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="h-[92px] animate-shimmer rounded-[var(--radius-card)] bg-[linear-gradient(90deg,var(--color-surface)_0%,var(--color-surface-2)_50%,var(--color-surface)_100%)] bg-[length:200%_100%]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="cf-card grid place-items-center py-16 text-center">
            <Search className="size-8 text-fg-subtle" />
            <p className="mt-3 font-semibold">Nenhum clube encontrado</p>
            <p className="text-sm text-fg-muted">Tente outro nome ou remova os filtros.</p>
          </div>
        ) : (
          <ul
            key={`${country}|${league}|${query}`}
            className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
          >
              {filtered.slice(0, limit).map((club, i) => (
                <ClubCard
                  key={club.id}
                  // stagger limitado: só os primeiros ~24 cards entram em cascata; o resto (e "mostrar mais") entra junto
                  delay={i < limit - PAGE ? 0 : Math.min(i % PAGE, 24) * 0.03}
                  club={club}
                  countryName={countries.get(club.countryId)?.name}
                  country={countries.get(club.countryId)}
                  playable={origin ? clubHasBundle(club.id, origin) && hasLeague(club) : false}
                  noLeague={!hasLeague(club)}
                  stateOnly={stateOnly.has(club.id)}
                  current={club.id === currentClubId}
                  onSelect={() => void choose(club)}
                />
              ))}
          </ul>
        )}

        {filtered.length > limit && (
          <div className="mt-6 flex justify-center">
            <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar mais ({filtered.length - limit})
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ClubCard({
  club,
  delay,
  country,
  countryName,
  playable,
  noLeague,
  stateOnly,
  current,
  onSelect,
}: {
  club: ClubIndexEntry;
  delay: number;
  country: Country | undefined;
  countryName: string | undefined;
  playable: boolean;
  noLeague: boolean;
  stateOnly: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const theme = useMemo(() => computeClubTheme(club.colors), [club.colors]);
  // Escopo local do tema: utilitários club-* dentro do card usam as cores deste clube.
  const style = {
    '--club-primary': theme.primary,
    '--club-secondary': theme.secondary,
    '--club-accent': theme.accent,
    '--club-on-accent': theme.onAccent,
  } as CSSProperties;

  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: EASE_OUT }}
      style={style}
    >
      <button
        type="button"
        disabled={!playable}
        onClick={onSelect}
        title={playable ? `Treinar o ${club.name}${stateOnly ? ' (só estadual)' : ''}` : noLeague ? 'Sem competição nesta versão' : 'Elenco indisponível na fixture de desenvolvimento'}
        className={cn(
          'group relative flex w-full items-center gap-3.5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-3.5 text-left transition-all duration-300',
          playable
            ? 'cursor-pointer hover:-translate-y-0.5 hover:border-club-accent/50 hover:shadow-[0_14px_40px_-18px_var(--club-primary)] focus-visible:border-club-accent focus-visible:outline-none'
            : 'cursor-not-allowed opacity-55',
          current && 'border-club-accent/60',
        )}
      >
        {/* faixa lateral + brilho nas cores do clube */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-linear-to-b from-club-primary to-club-secondary" />
        <span
          aria-hidden
          className="absolute -top-10 -left-10 size-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
          style={{ background: 'var(--club-primary)' }}
        />
        <div className="relative grid size-14 shrink-0 place-items-center rounded-xl bg-[radial-gradient(circle,rgb(255_255_255/0.09),transparent_72%),var(--color-surface-2)] ring-1 ring-line">
          <Crest path={indexCrestPaths(club)} name={club.name} colors={club.colors} size={48} />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold tracking-tight">{club.name}</span>
            {current && <Check className="size-4 shrink-0 text-club-accent" />}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
            <Flag country={country} />
            <span className="truncate">
              {countryName ?? '—'}
              {club.state ? ` · ${club.state}` : ''}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <Stars value={levelToStars(club.level)} size={12} />
            {!playable ? (
              <span className="flex items-center gap-1 text-[10px] text-fg-subtle">
                <Lock className="size-3" /> {noLeague ? 'sem competição' : 'sem dados'}
              </span>
            ) : stateOnly ? (
              <span className="rounded border border-line px-1 text-[9px] font-semibold tracking-wider text-fg-subtle uppercase">só estadual</span>
            ) : null}
          </div>
        </div>
      </button>
    </motion.li>
  );
}
