import { useCallback, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { MoraleChip } from '@/components/game/chips';
import { useFitHeight } from '@/lib/useFitHeight';
import { useSeason } from '@/store/season';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, BatteryCharging, IdCard, MousePointerClick, RotateCcw, Trophy, X } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import {
  detectRole, FORMATIONS, improvisation, OUTFIELD_MIN_Y, pickBestXI, pickRestXI, shapeSlots, shapeStrength,
  type FormationSlot, type SlotPos, type Tactic,
} from '@cosmicfut/engine';
import { useCurrentClub } from '@/app/ClubContext';
import { useCountryMap, useTraitMap } from '@/data/hooks';
import { computeIndicators, ROLE_LABEL, shortName, statusOf } from '@/lib/lineup';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { POSITION_ORDER } from '@/lib/format';
import { useGame } from '@/store/game';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PlayerDrawer } from '@/components/game/PlayerDrawer';
import { isUnavailable, useHumanStatus } from '@/components/game/status';
import { Pitch, pitchToSlot, snapToSpot } from './Pitch';
import { BenchCard, FormationPicker, IndicatorsCard, OutCard, RolesCard, StyleCard, type ShapeInfo } from './panels';
import { PresetBar } from './presets';
import { useLineupAvailability } from './availability';
import { useDragSwap, type DropTarget } from './useDragSwap';

export function TacticsPage() {
  const { bundle } = useCurrentClub();
  const players = bundle.players;
  const tactic = useGame((s) => s.tactic);
  const lineup = useGame((s) => s.lineup);
  const setTactic = useGame((s) => s.setTactic);
  const setLineup = useGame((s) => s.setLineup);
  const setSlotPosition = useGame((s) => s.setSlotPosition);
  const setPositions = useGame((s) => s.setPositions);
  const swapPlayers = useGame((s) => s.swapPlayers);
  const benchPlayer = useGame((s) => s.benchPlayer);
  const unlistPlayer = useGame((s) => s.unlistPlayer);
  const setCaptain = useGame((s) => s.setCaptain);
  const setPenaltyTaker = useGame((s) => s.setPenaltyTaker);
  const countries = useCountryMap();
  const traits = useTraitMap();
  const status = useHumanStatus();
  const avail = useLineupAvailability();
  // lesão + suspensão para a competição do PRÓXIMO jogo (status global só como reserva fora de temporada)
  const unavailable = useMemo(
    () => (avail.competitionId ? avail.unavailable : new Set([...[...status].filter(([, s]) => isUnavailable(s)).map(([id]) => id), ...avail.unavailable])),
    [status, avail.unavailable, avail.competitionId],
  );
  const fitness = avail.fitness;
  const morale = useSeason((s) => s.save?.season.clubs[bundle.club.id]?.morale);
  // (Atualização 41) colunas laterais do desktop com a altura da tela (rolam por dentro)
  const midRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  useFitHeight(midRef, { bottom: 18, min: 360 });
  useFitHeight(sideRef, { bottom: 18, min: 360 });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** (Táticas) prévia do arrasto no campo: slot e posição (atualizada quando a zona muda) */
  const [preview, setPreview] = useState<{ index: number; pos: SlotPos } | null>(null);
  const pitchRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const positions = lineup?.positions;
  const shape = useMemo(() => shapeSlots(tactic.formation, positions), [tactic.formation, positions]);
  // com prévia, os indicadores já mostram o efeito de soltar ali
  const slots = useMemo<FormationSlot[]>(() => {
    if (!preview) return shape as FormationSlot[];
    const pos = (positions && positions.length === 11 ? positions.slice() : new Array<SlotPos | null>(11).fill(null));
    pos[preview.index] = preview.pos;
    return shapeSlots(tactic.formation, pos) as FormationSlot[];
  }, [shape, preview, positions, tactic.formation]);
  const moved = useMemo(() => new Set((positions ?? []).flatMap((p, i) => (p ? [i] : []))), [positions]);
  const indicators = useMemo(() => {
    const ind = computeIndicators(lineup, slots, byId);
    const out = (lineup?.starters ?? []).filter((id) => unavailable.has(id)).map((id) => byId.get(id)?.name ?? id);
    if (out.length) ind.alerts.unshift({ level: 'danger', text: `Indisponível entre os titulares: ${out.join(', ')}` });
    return ind;
  }, [lineup, slots, byId, unavailable]);
  const shapeInfo = useMemo<ShapeInfo>(() => {
    const xi = slots.map((_, i) => byId.get(lineup?.starters[i] ?? ''));
    const st = shapeStrength(slots, xi, fitness);
    const improvised = xi.flatMap((p, i) => {
      if (!p) return [];
      const imp = improvisation(p, slots[i]);
      return imp.penalty > 0 ? [{ id: p.id, name: shortName(p.name), role: ROLE_LABEL[slots[i].role], penalty: imp.penalty }] : [];
    });
    return { def: st.def, mid: st.mid, att: st.att, issues: st.balance.issues, improvised };
  }, [slots, byId, lineup, fitness]);
  const starters = useMemo(() => (lineup?.starters ?? []).map((id) => byId.get(id)).filter((p): p is Player => !!p), [lineup, byId]);
  const bench = useMemo(() => (lineup?.bench ?? []).map((id) => byId.get(id)).filter((p): p is Player => !!p), [lineup, byId]);
  const out = useMemo(
    () =>
      players
        .filter((p) => statusOf(lineup, p.id) === 'out')
        .sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) || b.overall - a.overall),
    [players, lineup],
  );

  const notify = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((m) => (m === msg ? null : m)), 1800);
  };

  const swap = (a: string, b: string) => {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (statusOf(lineup, a) === 'out' && statusOf(lineup, b) === 'out') {
      notify('Os dois estão fora da lista — leve um deles ao banco primeiro');
      return;
    }
    swapPlayers(a, b);
    if (pa && pb) notify(`${shortName(pa.name)} ⇄ ${shortName(pb.name)}`);
  };

  /** ponto da tela → posição normalizada no campo (null fora do campo) */
  const pointToPos = (pt: { x: number; y: number }): SlotPos | null => {
    const el = pitchRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (pt.x < r.left || pt.x > r.right || pt.y < r.top || pt.y > r.bottom) return null;
    const s = pitchToSlot(((pt.x - r.left) / r.width) * 100, ((pt.y - r.top) / r.height) * 100);
    return { x: Math.min(0.97, Math.max(0.03, s.x)), y: Math.min(0.95, Math.max(OUTFIELD_MIN_Y, s.y)) };
  };
  const starterIndex = (id: string) => lineup?.starters.indexOf(id) ?? -1;

  const onMove = (src: string, target: DropTarget | null, pt: { x: number; y: number }) => {
    const i = starterIndex(src);
    const raw = target?.kind === 'zone' && target.zone === 'pitch' && i > 0 && shape[i]?.role !== 'GK' ? pointToPos(pt) : null;
    if (!raw) return setPreview((p) => (p ? null : p));
    // encaixa no ponto mais próximo: o círculo destacado é exatamente onde o jogador vai ficar
    const pos = snapToSpot(raw);
    setPreview((p) => (p && p.index === i && p.pos.x === pos.x && p.pos.y === pos.y ? p : { index: i, pos }));
  };

  const onDrop = (src: string, target: DropTarget, pt: { x: number; y: number }) => {
    setSelectedId(null);
    setPreview(null);
    if (target.kind === 'player') return swap(src, target.id);
    if (target.zone === 'pitch') {
      const i = starterIndex(src);
      const p = byId.get(src);
      if (i < 0) return notify('Solte sobre um titular para trocar — ou arraste um titular para mudar a posição dele');
      if (shape[i]?.role === 'GK') return notify('O goleiro fica no gol');
      const raw = pointToPos(pt);
      if (!raw) return;
      const pos = snapToSpot(raw);
      setSlotPosition(i, pos);
      const role = detectRole(pos.x, pos.y);
      const pen = p ? improvisation(p, { role, x: pos.x, y: pos.y, natural: [] }).penalty : 0;
      return notify(`${p ? shortName(p.name) : 'Jogador'} → ${ROLE_LABEL[role]}${pen > 0 ? ` (improvisado −${pen})` : ''}`);
    }
    const st = statusOf(lineup, src);
    if (target.zone === 'bench') {
      if (st === 'out') {
        if (bench.length >= 9) notify('Banco cheio: solte sobre um reserva para trocar');
        else benchPlayer(src);
      }
    } else if (target.zone === 'out' && st === 'bench') unlistPlayer(src);
  };

  const onTap = (id: string) => {
    if (!selectedId) return setSelectedId(id);
    if (selectedId === id) return setSelectedId(null);
    swap(selectedId, id);
    setSelectedId(null);
  };

  const dnd = useDragSwap({ onDrop, onTap, onMove });

  const pick = (mode: 'best' | 'rest') => {
    const fn = mode === 'best' ? pickBestXI : pickRestXI;
    const l = fn(players, shape, { unavailable, fitness, current: lineup });
    setLineup(l);
    setSelectedId(null);
    notify(mode === 'best' ? 'Melhor Elenco: força máxima escalada' : 'Descansar Time: titulares cansados poupados');
  };

  const onFreeSlot = () => {
    if (selectedId && statusOf(lineup, selectedId) === 'out') {
      benchPlayer(selectedId);
      setSelectedId(null);
    } else notify('Selecione um não relacionado para levá-lo ao banco');
  };

  const changeTactic = (patch: Partial<Tactic>) => setTactic(patch, players);
  const closeCard = useCallback(() => setCardId(null), []);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const dragged = dnd.dragId ? byId.get(dnd.dragId) : undefined;

  return (
    // (Atualização 41) 3 colunas no desktop — campo (altura limitada pela tela) · força/estilo/funções · banco/fora —
    // para caber em 1280×720 sem rolar a página; no celular a ordem continua campo → banco → fora → força → funções → estilo.
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      <motion.div variants={fadeUp}>
        <PageHeader
          title="Táticas"
          eyebrow="Gestão"
          meta={avail.competitionName ? `Próximo jogo: ${avail.competitionName}` : undefined}
          description="Arraste uma ficha para outra (troca) ou para qualquer ponto do campo (posição livre). Toque em um jogador e depois em outro para trocar."
          actions={
            <>
              {morale !== undefined && <MoraleChip value={morale} label className="h-7 px-2" />}
              <Button
                variant="club"
                size="sm"
                data-testid="btn-best-xi"
                title={`Os 11 disponíveis com maior overall efetivo na formação atual${avail.competitionName ? ` (suspensões: ${avail.competitionName})` : ''}`}
                onClick={() => pick('best')}
              >
                <Trophy /> Melhor Elenco
              </Button>
              <Button variant="outline" size="sm" data-testid="btn-rest-xi" title="Prioriza a condição física: poupa os titulares cansados" onClick={() => pick('rest')}>
                <BatteryCharging /> Descansar Time
              </Button>
            </>
          }
        />
      </motion.div>

      {/* mobile: campo → banco → fora → indicadores → funções → estilo; desktop: 3 colunas */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(15rem,17rem)_minmax(14rem,16rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)_minmax(15rem,18rem)]">
        <div className="contents lg:block">
          <motion.div variants={fadeUp} className="order-1 lg:order-none">
            <Card className="p-2.5">
              <FormationPicker formations={FORMATIONS} value={tactic.formation} onChange={(f) => changeTactic({ formation: f })} />
              <div className="mt-1.5">
                <PresetBar players={players} unavailable={unavailable} fitness={fitness} onNotify={notify} />
              </div>
              <div className="relative mt-2">
                <Pitch ref={pitchRef} slots={slots} lineup={lineup} byId={byId} dnd={dnd} selectedId={selectedId} status={status} fitness={fitness} moved={moved} hoverSpot={preview?.pos ?? null} />
                {/* (Atualização 41) aviso de formação personalizada sobre o campo (não empurra o campo para baixo) */}
                {moved.size > 0 && (
                  <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 rounded-md border border-club-accent/40 bg-black/70 py-0.5 pr-0.5 pl-2 text-[11px] text-white backdrop-blur-sm" title={`Formação personalizada: ${moved.size} ${moved.size === 1 ? 'posição movida' : 'posições movidas'}`}>
                    <span>
                      {tactic.formation}* · <b>{moved.size}</b> {moved.size === 1 ? 'movida' : 'movidas'}
                    </span>
                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px] text-white hover:text-white" data-testid="btn-reset-shape" onClick={() => setPositions(null)}>
                      <RotateCcw /> Restaurar formação
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-1.5 min-h-8">
                <AnimatePresence mode="wait" initial={false}>
                  {selected ? (
                    <motion.div
                      key="sel"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2, ease: EASE_OUT }}
                      className="flex items-center gap-2 rounded-lg border border-club-accent/40 bg-club-accent/10 px-2.5 py-1 text-xs"
                    >
                      <ArrowLeftRight className="size-3.5 shrink-0 text-club-accent" />
                      <span className="min-w-0 flex-1 truncate">
                        <b className="font-semibold">{selected.name}</b> selecionado — toque em outro jogador para trocar.
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setCardId(selected.id)}>
                        <IdCard /> <span className="hidden sm:inline">Card</span>
                      </Button>
                      <button aria-label="Cancelar seleção" onClick={() => setSelectedId(null)} className="grid size-6 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
                        <X className="size-3.5" />
                      </button>
                    </motion.div>
                  ) : flash ? (
                    <motion.div
                      key={`flash-${flash}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2, ease: EASE_OUT }}
                      role="status"
                      className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/70 px-2.5 py-1.5 text-xs text-fg"
                    >
                      <ArrowLeftRight className="size-3.5 shrink-0 text-club-accent" />
                      {flash}
                    </motion.div>
                  ) : (
                    <motion.p
                      key="hint"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-1.5 px-1 py-1.5 text-[11px] text-fg-subtle"
                    >
                      <MousePointerClick className="size-3.5 shrink-0" />
                      Arraste entre campo, banco e não relacionados — ou toque em um e depois no outro.
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </Card>
          </motion.div>
        </div>

        <div ref={midRef} className="scrollbar-thin contents lg:flex lg:flex-col lg:gap-3 lg:overflow-y-auto lg:pr-0.5">
          <motion.div variants={fadeUp} className="order-4 lg:order-none">
            <IndicatorsCard ind={indicators} shape={shapeInfo} />
          </motion.div>
          <motion.div variants={fadeUp} className="order-5 lg:order-none">
            <RolesCard starters={starters} lineup={lineup} onCaptain={setCaptain} onPenalty={setPenaltyTaker} />
          </motion.div>
          <motion.div variants={fadeUp} className="order-6 lg:order-none">
            <StyleCard tactic={tactic} onChange={changeTactic} />
          </motion.div>
        </div>

        <div ref={sideRef} className="contents lg:flex lg:flex-col lg:gap-3">
          <motion.div variants={fadeUp} className="order-2 lg:order-none lg:shrink-0">
            <BenchCard bench={bench} dnd={dnd} selectedId={selectedId} onFreeSlot={onFreeSlot} status={status} />
          </motion.div>
          <motion.div variants={fadeUp} className="order-3 flex min-h-0 flex-col lg:order-none lg:flex-1">
            <OutCard players={out} dnd={dnd} selectedId={selectedId} status={status} />
          </motion.div>
        </div>
      </div>
      {/* Fantasma que segue o ponteiro durante o arrasto (portal: fora de ancestrais com transform) */}
      {createPortal(
      <div ref={dnd.ghostRef} className="pointer-events-none fixed top-0 left-0 z-[60]" style={{ display: dragged ? 'block' : 'none' }} aria-hidden>
        {dragged && (
          <div className="flex scale-110 flex-col items-center drop-shadow-[0_12px_24px_rgb(0_0_0/0.6)]">
            <span
              className="grid size-12 place-items-center rounded-full border-[3px] border-club-accent bg-[radial-gradient(circle_at_30%_25%,color-mix(in_oklab,var(--club-primary)_70%,#1c2433),#0b0f17_85%)] text-base font-black text-white"
              style={{ boxShadow: '0 0 24px color-mix(in oklab, var(--club-accent) 60%, transparent)' }}
            >
              {dragged.overall}
            </span>
            <span className="mt-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white">{shortName(dragged.name)}</span>
            {preview && (() => {
              const role = detectRole(preview.pos.x, preview.pos.y);
              const pen = improvisation(dragged, { role, x: preview.pos.x, y: preview.pos.y, natural: [] }).penalty;
              return (
                <span className="mt-0.5 rounded-md bg-club-accent px-1.5 py-0.5 text-[11px] font-black whitespace-nowrap text-club-on-accent" data-testid="drag-zone">
                  {ROLE_LABEL[role]}
                  {pen > 0 ? ` −${pen}` : ''}
                </span>
              );
            })()}
          </div>
        )}
      </div>,
        document.body,
      )}

      <PlayerDrawer player={cardId ? (byId.get(cardId) ?? null) : null} onClose={closeCard} countries={countries} traits={traits} />
    </motion.div>
  );
}
