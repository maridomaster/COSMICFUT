/**
 * Carreiras: os slots de carreira solo (até 8) — continuar, nova, renomear, duplicar ("salvar como"),
 * exportar/importar (.json gerado localmente) e excluir (confirmação dupla).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, FolderOpen, Home, Loader2, Pencil, PlayCircle, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  MAX_CAREER_SLOTS, deleteCareer, downloadBlob, duplicateCareer, exportCareer, importCareer, openCareer, refreshSlots, renameCareer, useCareerSlots,
  type CareerSlotMeta,
} from '@/career/slots';
import { isLegacySlot } from '@/career/protocol';
import { indexCrestPaths } from '@/data/source';
import { applyClubTheme, computeClubTheme } from '@/lib/color';
import { fmtAgo, fmtBytes, fmtDate } from '@/lib/format';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { useSoloGame } from '@/store/game';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ui/confirm';
import { Crest } from '@/components/game/Crest';

type Notice = { kind: 'ok' | 'error'; text: string; quota?: boolean } | null;

const isQuotaMsg = (s: string) => /espaço|quota/i.test(s);

export function CareersPage() {
  const navigate = useNavigate();
  const slots = useCareerSlots((s) => s.slots);
  const status = useCareerSlots((s) => s.status);
  const loadError = useCareerSlots((s) => s.error);
  const migrated = useCareerSlots((s) => s.migrated);
  const activeId = useSoloGame((s) => s.slotId);
  const activeClub = useSoloGame((s) => s.clubId);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useNow();

  useEffect(() => applyClubTheme(null), []);
  useEffect(() => {
    void refreshSlots();
  }, []);

  const full = slots.length >= MAX_CAREER_SLOTS;

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ kind: 'ok', text: msg });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setNotice({ kind: 'error', text, quota: isQuotaMsg(text) });
    } finally {
      setBusy(null);
    }
  };

  const onContinue = (slot: CareerSlotMeta) =>
    run(`open:${slot.id}`, async () => {
      await openCareer(slot);
      navigate('/dashboard');
    });

  const onDuplicate = (slot: CareerSlotMeta) =>
    run(`dup:${slot.id}`, async () => {
      if (full) throw new Error(`Limite de ${MAX_CAREER_SLOTS} carreiras atingido. Exclua ou exporte uma carreira para liberar espaço.`);
      const copy = await duplicateCareer(slot);
      return `Cópia criada: ${copy.name}.`;
    });

  const onExport = (slot: CareerSlotMeta) =>
    run(`exp:${slot.id}`, async () => {
      const { blob, filename, bytes } = await exportCareer(slot.id);
      downloadBlob(blob, filename);
      return `Arquivo gerado: ${filename} (${fmtBytes(bytes)}).`;
    });

  const onImport = (file: File) =>
    run('import', async () => {
      if (full) throw new Error(`Limite de ${MAX_CAREER_SLOTS} carreiras atingido. Exclua uma carreira antes de importar.`);
      const meta = await importCareer(file);
      return `Carreira importada: ${meta.name}.`;
    });

  const onDelete = (slot: CareerSlotMeta) => {
    // confirmação dupla: a exclusão apaga o save deste navegador para sempre
    setConfirm({
      title: `Excluir “${slot.name}”?`,
      body: (
        <>
          A carreira com o <b className="text-fg">{slot.club.name}</b> (temporada {slot.season}) será removida deste navegador. Se quiser guardar uma cópia, use{' '}
          <b className="text-fg">Exportar</b> antes.
        </>
      ),
      confirmLabel: 'Continuar exclusão',
      onConfirm: () =>
        setTimeout(
          () =>
            setConfirm({
              title: 'Tem certeza absoluta?',
              body: (
                <>
                  “{slot.name}” será <b className="text-fg">apagada definitivamente</b>, sem lixeira. {slot.id === activeId && 'É a carreira aberta agora: ela será fechada.'}
                </>
              ),
              confirmLabel: 'Excluir para sempre',
              irreversible: true,
              onConfirm: () =>
                void run(`del:${slot.id}`, async () => {
                  await deleteCareer(slot.id);
                  return `“${slot.name}” foi excluída.`;
                }),
            }),
          0,
        ),
    });
  };

  return (
    <div className="cf-backdrop relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_22%,transparent),transparent_70%)]" />
      <div className="relative mx-auto max-w-[1200px] px-4 pb-16 sm:px-6 lg:px-8">
        <header className="flex h-16 items-center justify-between gap-2">
          <Logo />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => navigate('/inicio')} aria-label="Menu inicial">
              <Home /> <span className="hidden sm:inline">Menu inicial</span>
            </Button>
            {activeId && activeClub && (
              <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>
                <ArrowLeft /> <span className="hidden min-[380px]:inline">Voltar ao jogo</span>
              </Button>
            )}
          </div>
        </header>

        <motion.section initial="hidden" animate="show" variants={staggerContainer(0.08)} className="pt-6 pb-6 sm:pt-10">
          <motion.p variants={fadeUp} className="text-xs font-semibold tracking-[0.22em] text-brand-2 uppercase">
            Carreira solo
          </motion.p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <motion.h1 variants={fadeUp} className="text-3xl font-extrabold tracking-tight sm:text-5xl">
              Carreiras
            </motion.h1>
            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
              <span className="tabular mr-1 text-xs text-fg-muted" aria-label={`${slots.length} de ${MAX_CAREER_SLOTS} slots em uso`}>
                {slots.length}/{MAX_CAREER_SLOTS} slots
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void onImport(f);
                }}
              />
              <Button variant="outline" size="sm" disabled={!!busy || full} onClick={() => fileRef.current?.click()} title={full ? 'Limite de carreiras atingido' : 'Importar uma carreira exportada (.json)'}>
                {busy === 'import' ? <Loader2 className="animate-spin" /> : <Upload />} Importar
              </Button>
              <Button variant="club" size="sm" disabled={!!busy || full} onClick={() => navigate('/novo-jogo')} title={full ? 'Limite de carreiras atingido' : 'Escolher o clube da nova carreira'}>
                <Plus /> Nova carreira
              </Button>
            </motion.div>
          </div>
          <motion.p variants={fadeUp} className="mt-3 max-w-2xl text-sm text-fg-muted">
            Até {MAX_CAREER_SLOTS} carreiras salvas neste navegador, cada uma com o seu clube, a sua tática e o seu mercado. O jogo salva sozinho a cada Continuar.
          </motion.p>
        </motion.section>

        {migrated && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-club-accent/30 bg-club-accent/10 px-3.5 py-2.5 text-sm" role="status">
            <CheckCircle2 className="size-4 shrink-0 text-club-accent" />
            <span className="min-w-0 flex-1">Sua carreira foi movida para o slot 1, sem perder nada. Agora dá para ter outras ao lado dela.</span>
            <button aria-label="Fechar aviso" className="grid size-6 place-items-center rounded text-fg-muted hover:text-fg" onClick={() => useCareerSlots.setState({ migrated: false })}>
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {full && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm" role="status">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            <span>Todos os {MAX_CAREER_SLOTS} slots estão em uso. Exporte e exclua uma carreira para começar ou importar outra.</span>
          </div>
        )}
        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'mb-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm',
              notice.kind === 'error' ? 'border-warning/40 bg-warning/10' : 'border-club-accent/30 bg-club-accent/10',
            )}
          >
            {notice.kind === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-club-accent" />}
            <span className="min-w-0 flex-1 break-words">
              {notice.text}
              {notice.quota && ' Dica: exporte as carreiras que não está jogando para arquivo e exclua-as daqui.'}
            </span>
            <button aria-label="Fechar aviso" className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:text-fg" onClick={() => setNotice(null)}>
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {status === 'error' ? (
          <div className="cf-card p-8 text-center">
            <AlertTriangle className="mx-auto size-9 text-warning" />
            <p className="mt-3 font-semibold">Não foi possível ler as carreiras salvas</p>
            <p className="mt-1 text-sm text-fg-muted">{loadError}</p>
            <Button variant="outline" className="mt-5" onClick={() => void refreshSlots()}>
              Tentar de novo
            </Button>
          </div>
        ) : status !== 'ready' ? (
          <div className="grid gap-4 md:grid-cols-2" aria-busy>
            {[0, 1].map((i) => (
              <div key={i} className="h-44 animate-shimmer rounded-[var(--radius-card)] bg-[linear-gradient(90deg,var(--color-surface)_0%,var(--color-surface-2)_50%,var(--color-surface)_100%)] bg-[length:200%_100%]" />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <div className="cf-card grid place-items-center px-6 py-14 text-center">
            <FolderOpen className="size-9 text-fg-subtle" />
            <p className="mt-3 font-semibold">Nenhuma carreira salva</p>
            <p className="mt-1 max-w-sm text-sm text-fg-muted">Escolha um clube para começar, ou importe uma carreira exportada de outro navegador.</p>
            <Button variant="club" className="mt-5" onClick={() => navigate('/novo-jogo')}>
              <Plus /> Nova carreira
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {slots.map((slot, i) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                index={i}
                now={now}
                active={slot.id === activeId}
                busy={busy}
                full={full}
                onContinue={() => void onContinue(slot)}
                onRename={(name) => run(`ren:${slot.id}`, async () => void (await renameCareer(slot.id, name)))}
                onDuplicate={() => void onDuplicate(slot)}
                onExport={() => void onExport(slot)}
                onDelete={() => onDelete(slot)}
              />
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function SlotCard({
  slot, index, now, active, busy, full, onContinue, onRename, onDuplicate, onExport, onDelete,
}: {
  slot: CareerSlotMeta;
  index: number;
  now: number;
  active: boolean;
  busy: string | null;
  full: boolean;
  onContinue: () => void;
  onRename: (name: string) => Promise<void>;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const theme = useMemo(() => computeClubTheme(slot.club.colors), [slot.club.colors]);
  const style = {
    '--club-primary': theme.primary,
    '--club-secondary': theme.secondary,
    '--club-accent': theme.accent,
    '--club-on-accent': theme.onAccent,
  } as CSSProperties;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot.name);
  const mine = (k: string) => busy === `${k}:${slot.id}`;
  const disabled = !!busy;
  const hasData = !!slot.savedAt;
  // (Etapa 1) save de versão anterior: não abre (só exportar/excluir)
  const legacy = isLegacySlot(slot);
  const navigate = useNavigate();

  const submitRename = async () => {
    const name = draft.trim();
    if (!name || name === slot.name) {
      setEditing(false);
      setDraft(slot.name);
      return;
    }
    await onRename(name);
    setEditing(false);
  };

  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04, ease: EASE_OUT }}
      style={style}
      className={cn('relative overflow-hidden rounded-[var(--radius-card)] border bg-surface p-4', active ? 'border-club-accent/60' : 'border-line')}
      data-slot={slot.id}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-linear-to-b from-club-primary to-club-secondary" />
      <div className="flex items-start gap-3.5">
        <div className="relative grid size-16 shrink-0 place-items-center rounded-xl bg-[radial-gradient(circle,rgb(255_255_255/0.09),transparent_72%),var(--color-surface-2)] ring-1 ring-line">
          <Crest path={indexCrestPaths(slot.club)} name={slot.club.name} colors={slot.club.colors} size={52} />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitRename();
              }}
            >
              <Input
                autoFocus
                value={draft}
                maxLength={60}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditing(false);
                    setDraft(slot.name);
                  }
                }}
                aria-label="Nome da carreira"
                className="h-9"
              />
              <Button type="submit" size="sm" variant="club" disabled={mine('ren')}>
                {mine('ren') ? <Loader2 className="animate-spin" /> : 'Salvar'}
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-bold tracking-tight sm:text-lg" title={slot.name}>
                {slot.name}
              </h2>
              {active && !legacy && (
                <span className="shrink-0 rounded-md bg-club-accent px-1.5 py-0.5 text-[9px] font-black tracking-wider text-club-on-accent uppercase">aberta</span>
              )}
              {legacy && (
                <span className="shrink-0 rounded-md border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-warning uppercase" title="Save de uma versão anterior do jogo: não pode ser convertido para o calendário real (exportar ou excluir)">
                  legado
                </span>
              )}
            </div>
          )}
          <p className="truncate text-sm text-fg-muted">{slot.club.name}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div className="min-w-0">
              <dt className="text-fg-subtle">Temporada</dt>
              <dd className="tabular truncate font-semibold">
                {slot.season} · {fmtDate(slot.date, { day: '2-digit', month: 'short' })}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-fg-subtle">Último save</dt>
              <dd className="truncate font-semibold" title={slot.savedAt ? new Date(slot.savedAt).toLocaleString('pt-BR') : 'ainda não salva'}>
                {hasData ? fmtAgo(slot.savedAt, now) : 'ainda não salva'}
                <span className="font-normal text-fg-subtle"> · {fmtBytes(slot.bytes)}</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>
      {legacy && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-xs text-fg-muted" role="note">
          <b className="text-warning">Legado — iniciar nova carreira.</b> Esta carreira é de uma versão anterior (ano civil, um país só) e não abre no
          calendário real. Exporte para guardar ou exclua.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {legacy ? (
          <Button variant="outline" size="sm" onClick={() => navigate('/novo-jogo')} disabled={disabled || full} className="min-w-[7.5rem] flex-1 sm:flex-none" title={full ? 'Limite de carreiras atingido' : 'Escolher o clube da nova carreira'}>
            <Plus /> Nova carreira
          </Button>
        ) : (
          <Button variant="club" size="sm" onClick={onContinue} disabled={disabled} className="min-w-[7.5rem] flex-1 sm:flex-none">
            {mine('open') ? <Loader2 className="animate-spin" /> : <PlayCircle />} Continuar
          </Button>
        )}
        <div className="flex flex-1 flex-wrap justify-end gap-1">
          <IconAction label="Renomear" onClick={() => { setDraft(slot.name); setEditing(true); }} disabled={disabled || editing}>
            <Pencil />
          </IconAction>
          <IconAction label="Duplicar (salvar como)" onClick={onDuplicate} disabled={disabled || full || !hasData || legacy} busy={mine('dup')}>
            <Copy />
          </IconAction>
          <IconAction label="Exportar para arquivo" onClick={onExport} disabled={disabled || !hasData} busy={mine('exp')}>
            <Download />
          </IconAction>
          <IconAction label="Excluir" onClick={onDelete} disabled={disabled} busy={mine('del')} danger>
            <Trash2 />
          </IconAction>
        </div>
      </div>
    </motion.li>
  );
}

function IconAction({
  label, onClick, disabled, busy, danger, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn('px-2', danger && 'hover:bg-warning/10 hover:text-warning')}
    >
      {busy ? <Loader2 className="animate-spin" /> : children}
      <span className="hidden xl:inline">{label.split(' (')[0]}</span>
    </Button>
  );
}
