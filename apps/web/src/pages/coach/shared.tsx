/**
 * (Fase 3) Carreira do técnico — peças compartilhadas da UI: hooks do estado (world.coach), barra de estabilidade com
 * as faixas do original (43% / 79%), cartão de proposta (aceitar/recusar com a multa) e o fluxo de confirmação.
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import {
  COACH, coachReputation, resignationFine, stabilityBand, type CoachActionResult, type CoachCareer, type JobOffer,
} from '@cosmicfut/engine';
import { useSeason } from '@/store/season';
import { useIsOnline } from '@/store/mode';
import { useOnline } from '@/store/online';
import type { CoachAction } from '@/career/protocol';
import { fmtDate, fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ui/confirm';
import { ClubCrest } from '@/components/game/status';

/* ───────────── hooks ───────────── */

/** Carreira do técnico do save solo (null no online ou em saves sem a opção). */
export function useCoachCareer(): CoachCareer | null {
  const online = useIsOnline();
  const cc = useSeason((s) => s.save?.world?.coach ?? null);
  return online ? null : cc;
}

/** Técnico desempregado (carreira solo com a opção ligada e sem clube; online: técnico da sala sem clube). */
export function useUnemployed(): boolean {
  const cc = useCoachCareer();
  const online = useIsOnline();
  // (Rodada ao vivo) espectador também não tem clube: mesma navegação restrita (tabelas, sala, rodada ao vivo)
  const onlineJobless = useOnline((s) => {
    const me = s.room?.players.find((p) => p.playerId === s.playerId);
    return !!me?.unemployed || !!me?.spectator;
  });
  return online ? onlineJobless : !!cc && !cc.coach.clubId;
}

/** Propostas de emprego pendentes (contador do menu): solo pela carreira do técnico; online pela sala. */
export function usePendingJobCount(): number {
  const solo = usePendingOffers().length;
  const online = useIsOnline();
  const n = useOnline((s) => s.room?.players.find((p) => p.playerId === s.playerId)?.jobOffers ?? 0);
  return online ? n : solo;
}

/** E-mails não lidos (contador do menu). */
export function useUnreadMail(): number {
  const cc = useCoachCareer();
  return cc ? cc.inbox.reduce((n, m) => n + (m.read ? 0 : 1), 0) : 0;
}

/** Propostas pendentes. */
export function usePendingOffers(): JobOffer[] {
  const cc = useCoachCareer();
  const date = useSeason((s) => s.save?.season.date ?? '');
  return cc ? cc.offers.filter((o) => o.status === 'pending' && o.expiresAt >= date) : [];
}

/** Executa uma ação da carreira do técnico com estado de carregamento e mensagem de retorno. */
export function useCoachAction() {
  const coachAction = useSeason((s) => s.coachAction);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, action: CoachAction): Promise<CoachActionResult | null> => {
    setBusy(key);
    try {
      const r = await coachAction(action);
      setFeedback(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error ?? 'Não foi possível concluir.' });
      return r;
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, feedback, clearFeedback: () => setFeedback(null) };
}

/* ───────────── estabilidade ───────────── */

export const BAND_META: Record<ReturnType<typeof stabilityBand>, { label: string; color: string; text: string }> = {
  shielded: { label: 'Blindado', color: 'var(--color-success)', text: 'text-success' },
  stable: { label: 'Estável', color: 'var(--club-accent)', text: 'text-club-accent' },
  danger: { label: 'Prestes a cair', color: 'var(--color-warning)', text: 'text-warning' },
  critical: { label: 'Por um fio', color: 'var(--color-danger)', text: 'text-danger' },
};

/** Barra 0–100 com marcas em 43% e 79% (faixas do original). */
export function StabilityBar({ value, className, size = 'md', label }: { value: number; className?: string; size?: 'sm' | 'md'; label?: string }) {
  const band = stabilityBand(value);
  const meta = BAND_META[band];
  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn('relative overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-1.5' : 'h-3')}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-label={label ?? 'Estabilidade'}
      >
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: meta.color }} />
        <span className="absolute inset-y-0 w-px bg-fg/40" style={{ left: `${COACH.danger}%` }} aria-hidden />
        <span className="absolute inset-y-0 w-px bg-fg/40" style={{ left: `${COACH.shielded}%` }} aria-hidden />
      </div>
    </div>
  );
}

export function BandChip({ value, className }: { value: number; className?: string }) {
  const meta = BAND_META[stabilityBand(value)];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase', meta.text, className)}>
      {meta.label}
    </span>
  );
}

/** Mini barra de confiança (diretoria/torcida). */
export function ConfidenceRow({ label, value, icon }: { label: string; value: number; icon?: ReactNode }) {
  const color = value < 30 ? 'var(--color-danger)' : value < 50 ? 'var(--color-warning)' : 'var(--color-success)';
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-fg-muted [&_svg]:size-3.5">
          {icon}
          {label}
        </span>
        <span className="tabular font-bold">{Math.round(value)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(2, value)}%`, background: color }} />
      </div>
    </div>
  );
}

export function reputationLabel(rep: number): string {
  if (rep >= 80) return 'Lenda';
  if (rep >= 60) return 'Renomado';
  if (rep >= 40) return 'Respeitado';
  if (rep >= 20) return 'Promissor';
  return 'Iniciante';
}

/** Reputação 0–100 do técnico. */
export function useCoachRep(): number {
  const cc = useCoachCareer();
  return cc ? coachReputation(cc.coach) : 0;
}

/* ───────────── propostas ───────────── */

export function NationalBadge({ size = 32 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-lg border border-club-accent/30 bg-club-accent/10 text-club-accent" style={{ width: size, height: size }}>
      <ShieldCheck className="size-1/2" />
    </span>
  );
}

const KIND_LABEL: Record<JobOffer['kind'], string> = { invite: 'Convite', application: 'Candidatura aprovada', pressure: 'Pressão funcionou' };

/**
 * Cartão de proposta: aceitar (com a multa de 6 meses quando já empregado num clube) ou recusar.
 * Depois de aceitar um clube, leva ao Dashboard do novo clube.
 */
export function OfferCard({ offer, compact }: { offer: JobOffer; compact?: boolean }) {
  const cc = useCoachCareer();
  const navigate = useNavigate();
  const { run, busy, feedback } = useCoachAction();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  if (!cc) return null;
  const employed = !!cc.coach.clubId && offer.clubId !== undefined;
  const fine = resignationFine(cc.coach);
  const accept = () => {
    const go = async (payFine: boolean) => {
      const r = await run('accept', { type: 'accept', offerId: offer.id, payFine });
      if (r?.ok && r.clubChanged) navigate('/dashboard');
    };
    if (employed) {
      setConfirm({
        title: `Assumir o ${offer.name}?`,
        body: (
          <div className="space-y-2">
            <p>Deseja pagar a multa e assumir o novo time?</p>
            <p className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
              Multa de rescisão (6 meses): <b className="text-fg">{fmtMoney(fine)}</b>
              <br />
              Suas economias: <b className="text-fg">{fmtMoney(cc.coach.savings)}</b> → <b className="text-fg">{fmtMoney(cc.coach.savings - fine)}</b>
            </p>
            <p className="text-xs">Você não poderá voltar ao clube atual nos próximos 30 dias.</p>
          </div>
        ),
        confirmLabel: 'Pagar a multa e assumir',
        irreversible: true,
        onConfirm: () => void go(true),
      });
    } else if (offer.nationalTeamId !== undefined && cc.coach.nationalTeamId !== null) {
      setConfirm({
        title: `Assumir a ${offer.name}?`,
        body: <p>Você deixará a seleção que treina hoje. O cargo de seleção não tem multa.</p>,
        confirmLabel: 'Assumir a seleção',
        onConfirm: () => void go(false),
      });
    } else void go(false);
  };
  return (
    <div className={cn('rounded-2xl border border-club-accent/30 bg-club-accent/5 p-4', compact && 'p-3')}>
      <div className="flex items-start gap-3">
        {offer.clubId ? <ClubCrest id={offer.clubId} size={40} /> : <NationalBadge size={40} />}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold tracking-[0.16em] text-club-accent uppercase">{KIND_LABEL[offer.kind]}</div>
          <div className="truncate text-base font-bold">{offer.name}</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            Salário {fmtMoney(offer.wage)}/mês · Duração: {offer.years} ano · Estabilidade {offer.stability}%
            {offer.division ? ` · ${offer.division}ª divisão` : ''}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">Válida até {fmtDate(offer.expiresAt, { day: '2-digit', month: 'short' })}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="club" size="sm" onClick={accept} disabled={!!busy}>
          {busy === 'accept' ? <Loader2 className="animate-spin" /> : <Check />} Aceitar
        </Button>
        <Button variant="outline" size="sm" onClick={() => void run('decline', { type: 'decline', offerId: offer.id })} disabled={!!busy}>
          {busy === 'decline' ? <Loader2 className="animate-spin" /> : <X />} Recusar
        </Button>
        {employed && (
          <span className="self-center text-[11px] text-fg-subtle">
            <Briefcase className="mr-1 inline size-3" />
            multa de {fmtMoney(fine)}
          </span>
        )}
      </div>
      {feedback && <p className={cn('mt-2 text-xs', feedback.ok ? 'text-success' : 'text-warning')}>{feedback.text}</p>}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** Mensagem de retorno de uma ação (sucesso/erro). */
export function Feedback({ feedback, onClose }: { feedback: { ok: boolean; text: string } | null; onClose?: () => void }) {
  if (!feedback) return null;
  return (
    <div role="status" className={cn('flex items-start gap-2 rounded-xl border px-3 py-2 text-sm whitespace-pre-line', feedback.ok ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')}>
      <span className="min-w-0 flex-1">{feedback.text}</span>
      {onClose && (
        <button aria-label="Fechar" className="text-fg-muted hover:text-fg" onClick={onClose}>
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
