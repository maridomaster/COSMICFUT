/** Menu inicial: Carreira Solo ou Online com amigos. */
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Globe2, User, Users } from 'lucide-react';
import { indexCrestPaths } from '@/data/source';
import { applyClubTheme } from '@/lib/color';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { useSoloGame } from '@/store/game';
import { useMode } from '@/store/mode';
import { useOnline } from '@/store/online';
import { refreshSlots, useCareerSlots } from '@/career/slots';
import { Logo } from '@/components/brand/Logo';
import { Crest } from '@/components/game/Crest';
import { CopyLinkButton } from '@/online/invite';
import { ContinueOnlineCard } from './MyCareers';

export function StartMenuPage() {
  const navigate = useNavigate();
  const solo = useSoloGame((s) => s.clubPreview);
  const session = useOnline((s) => s.session);
  const slotCount = useCareerSlots((s) => s.slots.length);
  useEffect(() => applyClubTheme(null), []);
  // lê o índice de carreiras (e migra o save único antigo para o slot 1, se for a primeira vez)
  useEffect(() => {
    void refreshSlots();
  }, []);

  // Solo: com carreiras salvas, vai para a tela Carreiras (continuar, nova, importar…)
  const playSolo = () => {
    useMode.getState().setMode('solo');
    navigate(solo || slotCount > 0 ? '/carreiras' : '/novo-jogo');
  };
  const playOnline = () => navigate(session ? `/online/${session.code}` : '/online');

  return (
    <div className="cf-backdrop relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_22%,transparent),transparent_70%)]" />
      <div className="relative mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-12 sm:px-6">
        <header className="flex h-16 items-center">
          <Logo />
        </header>
        <motion.div initial="hidden" animate="show" variants={staggerContainer(0.08)} className="flex flex-1 flex-col justify-center py-8">
          <motion.p variants={fadeUp} className="text-xs font-semibold tracking-[0.22em] text-brand-2 uppercase">
            Bem-vindo, técnico
          </motion.p>
          <motion.h1 variants={fadeUp} className="mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">
            Como você quer jogar?
          </motion.h1>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <motion.button variants={fadeUp} onClick={playSolo} className="cf-card group flex flex-col items-start gap-3 p-6 text-left transition-colors hover:border-brand/50">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand/15 text-brand">
                <User className="size-6" />
              </span>
              <span className="text-xl font-extrabold tracking-tight">Carreira Solo</span>
              <span className="text-sm text-fg-muted">Uma temporada só sua, salva neste navegador. Mercado de transferências, finanças e Match Day no seu ritmo.</span>
              {solo ? (
                <span className="mt-1 flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-2.5 py-1.5 text-xs font-semibold">
                  <Crest path={indexCrestPaths(solo)} name={solo.name} colors={solo.colors} size={22} />
                  <span className="truncate">
                    {solo.name}
                    {slotCount > 1 ? ` · ${slotCount} carreiras` : ''}
                  </span>
                </span>
              ) : slotCount > 0 ? (
                <span className="mt-1 text-xs font-semibold text-brand">
                  {slotCount === 1 ? '1 carreira salva' : `${slotCount} carreiras salvas`}
                </span>
              ) : (
                <span className="mt-1 text-xs font-semibold text-brand">Escolher um clube</span>
              )}
              <ArrowRight className="mt-auto size-5 text-fg-subtle transition-transform group-hover:translate-x-1" />
            </motion.button>
            <motion.button variants={fadeUp} onClick={playOnline} className="cf-card group flex flex-col items-start gap-3 p-6 text-left transition-colors hover:border-brand-2/50">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand-2/15 text-brand-2">
                <Users className="size-6" />
              </span>
              <span className="text-xl font-extrabold tracking-tight">Online com amigos</span>
              <span className="text-sm text-fg-muted">Crie uma sala, mande o link e disputem a mesma temporada. Rodadas sincronizadas e partidas ao vivo, inclusive frente a frente.</span>
              {session ? (
                <span className="mt-1 flex items-center gap-2 rounded-xl border border-brand-2/30 bg-brand-2/10 px-2.5 py-1.5 text-xs font-semibold text-brand-2">
                  <Globe2 className="size-4" /> Voltar à sala {session.code}
                </span>
              ) : (
                <span className="mt-1 text-xs font-semibold text-brand-2">Criar ou entrar numa sala</span>
              )}
              <ArrowRight className="mt-auto size-5 text-fg-subtle transition-transform group-hover:translate-x-1" />
            </motion.button>
          </div>
          <motion.div variants={fadeUp}>
            <ContinueOnlineCard />
          </motion.div>
          <motion.div variants={fadeUp} className="cf-card mt-4 flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">Jogar online com amigos (até 6)</div>
              <div className="text-xs text-fg-muted">Copie o link do jogo e mande para a galera; depois crie a sala e passe o código.</div>
            </div>
            <CopyLinkButton className="sm:w-72" size="md" />
          </motion.div>
          <motion.p variants={fadeUp} className="mt-6 text-center text-xs text-fg-subtle">
            Os modos são separados: jogar online não altera o save da sua carreira solo.
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
