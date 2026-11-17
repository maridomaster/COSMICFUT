/**
 * Onboarding curto da primeira carreira: 4 cards de dica (Continuar, Táticas, Mercado, Competições),
 * dispensáveis, com destaque no elemento correspondente da interface. "Já vi" fica no localStorage
 * (conveniência por navegador: se o armazenamento falhar, o tour só aparece de novo).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, ChevronRight, Lightbulb, PlayCircle, Shirt, Trophy, X } from 'lucide-react';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/tooltip';

const KEY = 'cosmicfut:onboarding';

/** 'done' ou o passo atual ('0'…'3'); sobrevive a remontagens do shell e a recarregamentos. */
function load(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memo;
  }
}
let memo: string | null = null;
function save(v: string) {
  memo = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}
const seen = () => load() === 'done';
const markSeen = () => save('done');

interface Step {
  tour: string;
  icon: ReactNode;
  title: string;
  body: ReactNode;
  to?: string;
  cta?: string;
}

const STEPS: Step[] = [
  {
    tour: 'continue',
    icon: <PlayCircle />,
    title: 'Continuar faz o tempo andar',
    body: (
      <>
        O botão <b>Continuar</b>, no topo, avança dia a dia até o seu próximo jogo, uma proposta recebida ou uma notícia importante. Atalho: <Kbd>Espaço</Kbd>.
      </>
    ),
  },
  {
    tour: 'taticas',
    icon: <Shirt />,
    title: 'Monte o time em Táticas',
    body: 'Escolha a formação, arraste jogadores no campo para trocar posições e defina o banco, o capitão e o batedor de pênaltis.',
    to: '/taticas',
    cta: 'Abrir Táticas',
  },
  {
    tour: 'mercado',
    icon: <ArrowLeftRight />,
    title: 'Reforce o elenco no Mercado',
    body: 'Busque entre jogadores do mundo todo, observe os promissores e negocie em duas etapas: valor com o clube, depois o contrato com o jogador.',
    to: '/mercado',
    cta: 'Abrir Mercado',
  },
  {
    tour: 'competicoes',
    icon: <Trophy />,
    title: 'Acompanhe as Competições',
    body: 'Tabelas por fase, chaves do mata-mata, artilharia e campeões dos estaduais, da Copa e das Séries A a D.',
    to: '/competicoes',
    cta: 'Ver Competições',
  },
];

/** Elemento visível marcado com `data-tour` (a sidebar existe no desktop e no drawer mobile). */
function target(tour: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${tour}"]`)) if (el.offsetParent !== null) return el;
  return null;
}

export function Onboarding() {
  const [open, setOpen] = useState(() => !seen());
  const [i, setStep] = useState(() => Math.min(STEPS.length - 1, Math.max(0, Number(load()) || 0)));
  const setI = (n: number) => {
    save(String(n));
    setStep(n);
  };
  const navigate = useNavigate();
  const step = STEPS[i];

  // destaque no alvo (anel pulsante via CSS: [data-tour-active])
  useEffect(() => {
    if (!open) return;
    const el = target(step.tour);
    el?.setAttribute('data-tour-active', '');
    return () => el?.removeAttribute('data-tour-active');
  }, [open, step.tour]);

  const close = () => {
    markSeen();
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const last = i === STEPS.length - 1;
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="tour"
          role="region"
          aria-label="Dicas para começar"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-club-accent/40 bg-surface/95 p-4 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[23rem]"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-club-accent/15 text-club-accent [&_svg]:size-5">{step.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.16em] text-club-accent uppercase">
                <Lightbulb className="size-3" /> Dica {i + 1} de {STEPS.length}
              </p>
              <h2 className="mt-0.5 text-sm font-bold">{step.title}</h2>
            </div>
            <button type="button" aria-label="Fechar as dicas" onClick={close} className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{step.body}</p>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex flex-1 gap-1" aria-hidden>
              {STEPS.map((_, k) => (
                <span key={k} className={cn('h-1.5 rounded-full transition-all', k === i ? 'w-5 bg-club-accent' : 'w-1.5 bg-surface-3')} />
              ))}
            </div>
            {step.to && (
              <Button variant="ghost" size="sm" onClick={() => navigate(step.to!)}>
                {step.cta}
              </Button>
            )}
            <Button variant="club" size="sm" onClick={() => (last ? close() : setI(i + 1))}>
              {last ? 'Entendi' : 'Próxima'} {!last && <ChevronRight />}
            </Button>
          </div>
          {!last && (
            <button type="button" onClick={close} className="mt-2 text-[11px] text-fg-subtle hover:text-fg">
              Pular dicas
            </button>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
