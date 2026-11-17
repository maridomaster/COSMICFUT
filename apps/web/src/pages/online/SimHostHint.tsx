/**
 * (Online grátis: GitHub Pages + Cloudflare) Dica discreta sobre o ANFITRIÃO DA SIMULAÇÃO — o navegador de um dos
 * técnicos roda a sala. Mostra quando sou eu ("não feche a aba"), quando o anfitrião caiu ("Reconectando…") e
 * quando o novo anfitrião está retomando a rodada a partir do último ponto salvo.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cpu, Loader2 } from 'lucide-react';
import { IS_EDGE } from '@/online/config';
import { useIsOnline } from '@/store/mode';
import { useOnline } from '@/store/online';
import { cn } from '@/lib/utils';

export function SimHostHint() {
  const online = useIsOnline();
  const session = useOnline((s) => s.session);
  const simHost = useOnline((s) => s.simHost);
  const hostStatus = useOnline((s) => s.hostStatus);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (simHost?.state !== 'resuming') return;
    setResuming(true);
    const t = setTimeout(() => setResuming(false), 8000);
    return () => clearTimeout(t);
  }, [simHost?.state, simHost?.epoch]);

  if (!IS_EDGE || !online || !session || !simHost) return null;
  let text: string | null = null;
  let tone: 'info' | 'warn' = 'info';
  let spin = false;
  if (simHost.state === 'lost') {
    text = 'Anfitrião da simulação desconectou — reconectando…';
    tone = 'warn';
    spin = true;
  } else if (resuming) {
    text = simHost.me ? 'Você assumiu a simulação — retomando a rodada…' : `Retomando… (anfitrião agora: ${simHost.nickname ?? 'outro técnico'})`;
    tone = 'warn';
    spin = true;
  } else if (simHost.me && hostStatus?.state === 'loading') {
    text = 'Carregando a sala neste navegador (anfitrião da simulação)…';
    spin = true;
  } else if (simHost.me) {
    text = 'Você é o anfitrião da simulação (não feche a aba durante a rodada)';
  }
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          key={text}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          role="status"
          className="pointer-events-none fixed bottom-2 left-2 z-[55] max-w-[calc(100vw-1rem)]"
        >
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-lg backdrop-blur',
              tone === 'warn' ? 'border-warning/40 bg-[#2a2210]/90 text-warning' : 'border-line bg-surface/85 text-fg-muted',
            )}
            title="Modo online grátis: a simulação da sala roda no navegador de um dos técnicos."
          >
            {spin ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Cpu className="size-3.5 shrink-0" />}
            <span className="truncate">{text}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
