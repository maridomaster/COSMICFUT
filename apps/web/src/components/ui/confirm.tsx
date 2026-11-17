import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { EASE_OUT } from '@/lib/motion';
import { Button } from './button';

export interface ConfirmRequest {
  title: string;
  /** consequências (linhas "antes → depois", avisos) */
  body: ReactNode;
  confirmLabel: string;
  /** ação sem volta (obra paga, quitação): destaque de alerta */
  irreversible?: boolean;
  onConfirm: () => void;
}

/** Diálogo de confirmação (modal acessível: foco no botão de cancelar, Esc fecha). */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  useEffect(() => {
    if (!request) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [request, onClose]);
  return createPortal(
    <AnimatePresence>
      {request && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <div key="wrap" className="pointer-events-none fixed inset-0 z-[71] grid place-items-end sm:place-items-center sm:p-4">
            <motion.div
              role="dialog"
              aria-modal
              aria-labelledby="confirm-title"
              className="pointer-events-auto w-full overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-w-md sm:rounded-2xl"
              initial={{ y: 30, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              <div className="px-5 pt-5">
                <h2 id="confirm-title" className="text-lg font-extrabold tracking-tight">
                  {request.title}
                </h2>
                <div className="mt-3 text-sm text-fg-muted">{request.body}</div>
                {request.irreversible && (
                  <p className="mt-3 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
                    <AlertTriangle className="size-4 shrink-0" /> Esta ação não pode ser desfeita.
                  </p>
                )}
              </div>
              <div className="mt-5 flex justify-end gap-2 border-t border-line px-5 py-3">
                <Button autoFocus variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button
                  variant="club"
                  onClick={() => {
                    request.onConfirm();
                    onClose();
                  }}
                >
                  {request.confirmLabel}
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
