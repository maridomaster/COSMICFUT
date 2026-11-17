/**
 * (Táticas) 3 vagas de predefinição: salvar o desenho atual com um nome e trocar com um clique.
 *
 * - `PresetBar`: barra da tela de Táticas (salvar / carregar / apagar).
 * - `MatchPresetBar`: para o painel de Mudanças da partida — aplica tática + posicionamento por comandos
 *   (`set-tactic` + `set-shape`); o XI salvo NÃO é aplicado durante o jogo (seriam substituições).
 * - `usePresetActions`: API para outras telas (`apply(i)` antes do jogo).
 * As vagas ficam em `useGame().presets` (localStorage do slot + ClubSeasonState.tacticPresets no save/servidor).
 */
import { useState } from 'react';
import { Bookmark, BookmarkPlus, Check, Trash2, X } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { applyPreset, makePreset, PRESET_NAME_MAX, type MatchCommand, type Side, type TacticPreset } from '@cosmicfut/engine';
import { MENTALITIES } from '@/lib/lineup';
import { cn } from '@/lib/utils';
import { useGame } from '@/store/game';
import { Button } from '@/components/ui/button';

const SUGGESTIONS = ['4-3-3 Ofensivo', 'Retranca Copa', 'Pressão Total'];

export function presetSummary(p: TacticPreset): string {
  const m = MENTALITIES.find((x) => x.value === p.tactic.mentality)?.label ?? '';
  return `${p.tactic.formation}${p.positions ? '*' : ''} · ${m}${p.starters ? ' · com XI' : ''}`;
}

/** Ações de predefinição para a escalação ANTES do jogo (tela de táticas, pré-jogo). */
export function usePresetActions(players: Player[], opts: { unavailable?: Set<string>; fitness?: Record<string, number> } = {}) {
  const presets = useGame((s) => s.presets);
  const setPreset = useGame((s) => s.setPreset);
  return {
    presets,
    save: (index: number, name: string, includeXI: boolean) => {
      const { tactic, lineup } = useGame.getState();
      setPreset(index, makePreset(name, tactic, lineup, includeXI, new Date().toISOString()));
    },
    clear: (index: number) => setPreset(index, null),
    apply: (index: number): boolean => {
      const p = useGame.getState().presets[index];
      if (!p) return false;
      const { lineup } = useGame.getState();
      const out = applyPreset(p, lineup, players, opts);
      useGame.setState({ tactic: out.tactic, lineup: out.lineup });
      return true;
    },
  };
}

export function PresetBar({
  players,
  unavailable,
  fitness,
  onNotify,
}: {
  players: Player[];
  unavailable?: Set<string>;
  fitness?: Record<string, number>;
  onNotify: (msg: string) => void;
}) {
  const { presets, save, clear, apply } = usePresetActions(players, { unavailable, fitness });
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [withXI, setWithXI] = useState(true);
  const firstFree = presets.findIndex((p) => !p);

  const startSave = (i: number) => {
    setEditing(i);
    setName(presets[i]?.name ?? SUGGESTIONS[i] ?? '');
  };
  const confirm = () => {
    if (editing === null) return;
    const n = name.trim() || `Predefinição ${editing + 1}`;
    save(editing, n, withXI);
    onNotify(`Predefinição “${n}” salva na vaga ${editing + 1}`);
    setEditing(null);
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-1" data-testid="preset-bar">
      <div className="flex flex-wrap items-center gap-1">
        <span className="cf-label flex items-center gap-1 px-1 text-fg-muted" title="Predefinições: até 3 desenhos táticos salvos, aplicados com um clique">
          <Bookmark className="size-3.5" /> <span className="max-sm:hidden">Predefinições</span>
        </span>
        {presets.map((p, i) => (
          <div key={i} className={cn('flex h-7 min-w-0 flex-1 items-stretch overflow-hidden rounded-md border', p ? 'border-line-strong bg-surface' : 'border-dashed border-line')}>
            <button
              type="button"
              data-testid={`preset-slot-${i}`}
              disabled={!p}
              onClick={() => {
                if (apply(i)) onNotify(`Predefinição “${p!.name}” aplicada`);
              }}
              className="min-w-0 flex-1 px-2 text-left enabled:hover:bg-surface-2 disabled:cursor-default"
              title={p ? `Aplicar: ${presetSummary(p)}` : 'Vaga vazia'}
            >
              <div className={cn('truncate text-xs', p ? 'font-semibold' : 'text-fg-subtle')}>{p ? p.name : `Vaga ${i + 1} · vazia`}</div>
            </button>
            {p && (
              <button type="button" aria-label={`Apagar ${p.name}`} onClick={() => clear(i)} className="grid w-6 place-items-center text-fg-subtle hover:bg-danger/10 hover:text-danger">
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        ))}
        <Button size="sm" variant="outline" data-testid="preset-save" title="Salvar Predefinição (desenho, tática e titulares atuais)" aria-label="Salvar Predefinição" onClick={() => startSave(firstFree >= 0 ? firstFree : 0)}>
          <BookmarkPlus /> <span className="max-sm:hidden">Salvar</span>
        </Button>
      </div>
      {editing !== null && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <label className="flex items-center gap-1 text-[11px] text-fg-muted">
            Vaga
            <select
              aria-label="Vaga"
              value={editing}
              onChange={(e) => setEditing(Number(e.target.value))}
              className="rounded-md border border-line bg-surface px-1 py-0.5 text-xs text-fg"
            >
              {presets.map((p, i) => (
                <option key={i} value={i}>
                  {i + 1}
                  {p ? ` (substitui “${p.name}”)` : ''}
                </option>
              ))}
            </select>
          </label>
          <input
            autoFocus
            data-testid="preset-name"
            aria-label="Nome da predefinição"
            maxLength={PRESET_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Pressão Total"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs"
          />
          <label className="flex items-center gap-1 text-[11px] text-fg-muted">
            <input type="checkbox" checked={withXI} onChange={(e) => setWithXI(e.target.checked)} /> incluir titulares
          </label>
          <Button size="sm" variant="club" type="submit" data-testid="preset-confirm">
            <Check /> Salvar
          </Button>
          <button type="button" aria-label="Cancelar" onClick={() => setEditing(null)} className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Para a partida ao vivo (painel de Mudanças): troca de predefinição com um clique.
 * `command` é o mesmo do painel (envia ao motor local ou ao servidor). Durante o jogo aplica só tática e
 * posicionamento; o XI salvo fica para o próximo jogo.
 */
export function MatchPresetBar({
  side,
  command,
  onApplied,
}: {
  side: Side;
  command: (cmd: MatchCommand) => Promise<string | null> | string | null;
  onApplied?: (name: string) => void;
}) {
  const presets = useGame((s) => s.presets);
  const [busy, setBusy] = useState(false);
  if (!presets.some(Boolean)) return null;
  const run = async (p: TacticPreset) => {
    setBusy(true);
    try {
      const e1 = await command({ type: 'set-tactic', side, tactic: { ...p.tactic } });
      const e2 = e1 ? e1 : await command({ type: 'set-shape', side, positions: p.positions ?? null });
      if (!e2) onApplied?.(p.name);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="match-preset-bar">
      <span className="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
        <Bookmark className="size-3.5" /> Predefinições
      </span>
      {presets.map((p, i) =>
        p ? (
          <Button key={i} size="sm" variant="outline" disabled={busy} onClick={() => void run(p)} title={presetSummary(p)}>
            {p.name}
          </Button>
        ) : null,
      )}
    </div>
  );
}
