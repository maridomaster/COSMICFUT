/** (Fase 3) Tela dramática "Você foi demitido!" — aparece quando a diretoria encerra o contrato. */
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Briefcase, Inbox } from 'lucide-react';
import { useSoloSeason } from '@/store/season';
import { useMatch } from '@/store/match';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ClubCrest } from '@/components/game/status';

export function FiredOverlay() {
  const fired = useSoloSeason((s) => s.fired);
  const dismiss = useSoloSeason((s) => s.dismissFired);
  // depois do jogo ao vivo, espera o resumo da rodada ser visto
  const matchPhase = useMatch((s) => s.phase);
  const navigate = useNavigate();
  const show = !!fired && matchPhase !== 'live' && matchPhase !== 'post';
  const go = (to: string) => {
    dismiss();
    if (useMatch.getState().phase === 'done') useMatch.getState().reset();
    navigate(to);
  };
  return createPortal(
    <AnimatePresence>
      {show && fired && (
        <motion.div
          key="fired"
          role="alertdialog"
          aria-modal
          aria-labelledby="fired-title"
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/85 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-lg text-center"
            initial={{ scale: 1.15, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div initial={{ rotate: -8, y: -20, opacity: 0 }} animate={{ rotate: 0, y: 0, opacity: 1 }} transition={{ delay: 0.25, type: 'spring', stiffness: 160, damping: 12 }} className="mx-auto w-fit grayscale">
              <ClubCrest id={fired.clubId} size={96} />
            </motion.div>
            <h1 id="fired-title" className="mt-6 text-4xl font-black tracking-tight text-danger uppercase sm:text-5xl">
              Você foi demitido!
            </h1>
            <p className="mt-2 text-sm text-white/70">
              {fired.clubName} · {fmtDate(fired.date)}
            </p>
            <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed whitespace-pre-line text-white/90">{fired.body}</p>
            <p className="mt-4 text-xs text-white/60">A carreira continua: o mundo segue sendo simulado enquanto você procura um novo emprego.</p>
            <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
              <Button variant="club" size="lg" onClick={() => go('/empregos')} autoFocus>
                <Briefcase /> Central de Empregos
              </Button>
              <Button variant="outline" size="lg" onClick={() => go('/inbox')}>
                <Inbox /> Caixa de Entrada
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
