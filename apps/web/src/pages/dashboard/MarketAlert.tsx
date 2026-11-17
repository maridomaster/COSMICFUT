import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Handshake, Inbox } from 'lucide-react';
import { fmtMoney } from '@/lib/format';
import { useSeason } from '@/store/season';

/** Aviso no Dashboard: ofertas recebidas pendentes e acordos aguardando contrato. */
export function MarketAlert({ clubId }: { clubId: string }) {
  const offers = useSeason((s) => s.save?.season.market?.offers);
  const incoming = (offers ?? []).filter((o) => o.fromClubId === clubId && o.status === 'pending');
  const agreed = (offers ?? []).filter((o) => o.toClubId === clubId && o.status === 'agreed');
  const best = incoming.reduce<(typeof incoming)[number] | null>((b, o) => (!b || o.fee > b.fee ? o : b), null);
  return (
    <AnimatePresence>
      {(incoming.length > 0 || agreed.length > 0) && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="grid gap-2.5 md:grid-cols-2">
          {incoming.length > 0 && (
            <Link
              to="/mercado?tab=recebidas"
              className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-warning/35 bg-warning/10 px-4 py-3 transition-colors hover:bg-warning/15"
            >
              <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-warning/20 text-warning">
                <Inbox className="size-5" />
                <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-warning text-[10px] font-black text-bg">{incoming.length}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">
                  {incoming.length} oferta{incoming.length > 1 ? 's' : ''} recebida{incoming.length > 1 ? 's' : ''}
                </div>
                {best && (
                  <div className="truncate text-xs text-fg-muted">
                    Maior: {best.toName} oferece {fmtMoney(best.fee)} por {best.player.name}
                  </div>
                )}
              </div>
              <ArrowRight className="size-4 text-warning transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
          {agreed.length > 0 && (
            <Link
              to="/mercado?tab=negociacoes"
              className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-club-accent/35 bg-club-accent/10 px-4 py-3 transition-colors hover:bg-club-accent/15"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-club-accent/20 text-club-accent">
                <Handshake className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">Acordo fechado, falta o contrato</div>
                <div className="truncate text-xs text-fg-muted">{agreed.map((o) => o.player.name).join(', ')}</div>
              </div>
              <ArrowRight className="size-4 text-club-accent transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
