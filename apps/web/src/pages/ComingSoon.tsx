import { motion } from 'motion/react';
import { Link } from 'react-router';
import { ArrowLeft, Hourglass } from 'lucide-react';
import type { NavItem } from '@/app/nav';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/** Placeholder elegante para módulos ainda não implementados. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.08)} className="space-y-6">
      <motion.section variants={fadeUp} className="cf-card relative overflow-hidden px-6 py-14 text-center sm:py-20">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: 'radial-gradient(50% 70% at 50% 0%, color-mix(in oklab, var(--club-primary) 16%, transparent), transparent 70%)' }}
        />
        <div className="relative mx-auto grid size-20 place-items-center">
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full border border-dashed border-club-accent/40"
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          />
          <div className="grid size-14 place-items-center rounded-2xl border border-club-accent/30 bg-club-accent/10 text-club-accent shadow-[0_0_40px_-8px_var(--club-accent)]">
            <Icon className="size-7" />
          </div>
        </div>
        <Badge variant="club" className="relative mt-6">
          <Hourglass className="size-3" /> Em breve
        </Badge>
        <h1 className="relative mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">{item.label}</h1>
        <p className="relative mx-auto mt-2 max-w-md text-sm text-fg-muted">{item.blurb}</p>
        <Button asChild variant="outline" className="relative mt-7">
          <Link to="/dashboard">
            <ArrowLeft /> Voltar ao Dashboard
          </Link>
        </Button>
      </motion.section>
      <motion.div variants={fadeUp} className="grid gap-5 opacity-60 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="cf-card space-y-3 p-5">
            <div className="h-3 w-1/3 animate-shimmer rounded-full bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
            <div className="h-8 w-2/3 animate-shimmer rounded-lg bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
            <div className="h-2 w-full animate-shimmer rounded-full bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
