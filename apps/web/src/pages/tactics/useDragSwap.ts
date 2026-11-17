/**
 * Drag & drop com Pointer Events nativos (mouse, caneta e toque) + troca por toque/clique.
 *
 * - Cada item arrastável recebe `bind(id)`: pointerdown captura o ponteiro no próprio elemento,
 *   então pointermove/up continuam chegando nele mesmo fora da área (e no toque).
 * - Só vira "arrasto" depois de passar um limiar de movimento; abaixo disso, o pointerup é um TOQUE
 *   (onTap), que alimenta a troca em dois toques (seleciona um, toca no outro).
 * - O alvo é achado com document.elementFromPoint + closest('[data-drop-id],[data-drop-zone]'):
 *   o "fantasma" que segue o dedo tem pointer-events: none, então não atrapalha o hit-test.
 * - Perto das bordas da janela a página rola sozinha (essencial no mobile: campo em cima, banco embaixo).
 * - Teclado: Enter/Espaço disparam click com detail === 0 → tratado como toque.
 * Itens que devem arrastar no toque precisam de `touch-action: none` (no item ou numa alça).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from 'react';

export type DropTarget = { kind: 'player'; id: string } | { kind: 'zone'; zone: string };

interface Session {
  id: string;
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  dragging: boolean;
  touch: boolean;
}

const targetKey = (t: DropTarget | null) => (t ? (t.kind === 'player' ? `p:${t.id}` : `z:${t.zone}`) : null);

function hitTest(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const hit = el?.closest<HTMLElement>('[data-drop-id],[data-drop-zone]');
  if (!hit) return null;
  if (hit.dataset.dropId) return { kind: 'player', id: hit.dataset.dropId };
  return { kind: 'zone', zone: hit.dataset.dropZone! };
}

export function useDragSwap({
  onDrop,
  onTap,
  onMove,
}: {
  /** point = ponto de soltura (clientX/clientY): o campo usa para o posicionamento livre */
  onDrop: (sourceId: string, target: DropTarget, point: { x: number; y: number }) => void;
  onTap: (id: string) => void;
  /** (Táticas) a cada movimento do arrasto: alvo atual + ponto (prévia ao vivo da zona) */
  onMove?: (sourceId: string, target: DropTarget | null, point: { x: number; y: number }) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const session = useRef<Session | null>(null);
  const over = useRef<DropTarget | null>(null);
  const scrollRaf = useRef<number | null>(null);
  const handlers = useRef({ onDrop, onTap, onMove });
  handlers.current = { onDrop, onTap, onMove };

  const placeGhost = (x: number, y: number) => {
    const g = ghostRef.current;
    if (g) g.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  };

  const updateOver = (x: number, y: number) => {
    const t = hitTest(x, y);
    // não destaca o próprio item arrastado como alvo
    const valid = t && !(t.kind === 'player' && t.id === session.current?.id) ? t : null;
    over.current = valid;
    setOverKey((k) => (k === targetKey(valid) ? k : targetKey(valid)));
  };

  const stopAutoScroll = () => {
    if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = null;
  };

  const autoScroll = useCallback(() => {
    const s = session.current;
    if (!s?.dragging) return stopAutoScroll();
    const edge = 72;
    const h = window.innerHeight;
    let dy = 0;
    if (s.y < edge) dy = -Math.ceil(((edge - s.y) / edge) * 14);
    else if (s.y > h - edge) dy = Math.ceil(((s.y - (h - edge)) / edge) * 14);
    if (dy !== 0) {
      window.scrollBy(0, dy);
      updateOver(s.x, s.y);
    }
    scrollRaf.current = requestAnimationFrame(autoScroll);
  }, []);

  const end = () => {
    stopAutoScroll();
    session.current = null;
    over.current = null;
    setDragId(null);
    setOverKey(null);
    document.documentElement.style.removeProperty('cursor');
  };

  useEffect(() => stopAutoScroll, []);

  const bind = (id: string) => ({
    'data-drag-id': id,
    draggable: false,
    // impede o drag nativo do HTML (texto/imagem), que dispararia pointercancel no meio do arrasto
    onDragStart: (e: DragEvent<HTMLElement>) => e.preventDefault(),
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || session.current) return;
      // mouse: evita iniciar seleção de texto (que também cancela o ponteiro)
      if (e.pointerType === 'mouse') window.getSelection()?.removeAllRanges();
      session.current = {
        id,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        dragging: false,
        touch: e.pointerType !== 'mouse',
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* alguns navegadores recusam captura em elementos que somem: tudo bem */
      }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = session.current;
      if (!s || s.pointerId !== e.pointerId) return;
      s.x = e.clientX;
      s.y = e.clientY;
      if (!s.dragging) {
        const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
        if (dist < (s.touch ? 10 : 6)) return;
        s.dragging = true;
        setDragId(id);
        document.documentElement.style.cursor = 'grabbing';
        scrollRaf.current = requestAnimationFrame(autoScroll);
      }
      e.preventDefault();
      placeGhost(s.x, s.y);
      updateOver(s.x, s.y);
      handlers.current.onMove?.(s.id, over.current, { x: s.x, y: s.y });
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const s = session.current;
      if (!s || s.pointerId !== e.pointerId) return;
      if (s.dragging) {
        updateOver(e.clientX, e.clientY);
        const t = over.current;
        end();
        if (t) handlers.current.onDrop(s.id, t, { x: e.clientX, y: e.clientY });
        else handlers.current.onMove?.(s.id, null, { x: e.clientX, y: e.clientY });
      } else {
        end();
        handlers.current.onTap(s.id);
      }
    },
    onPointerCancel: () => {
      const id0 = session.current?.id;
      end();
      if (id0) handlers.current.onMove?.(id0, null, { x: 0, y: 0 });
    },
    onLostPointerCapture: () => {
      // se a captura se perder no meio de um arrasto (ex.: elemento desmontado), encerra limpo
      if (session.current?.dragging) end();
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      // cliques de ponteiro já viraram onTap no pointerup; aqui só teclado (detail 0)
      if (e.detail === 0) handlers.current.onTap(id);
    },
  });

  // posiciona o fantasma assim que ele monta (antes do paint, sem piscar no canto)
  useLayoutEffect(() => {
    const s = session.current;
    if (dragId && s) placeGhost(s.x, s.y);
  }, [dragId]);

  return { bind, dragId, overKey, ghostRef, isOver: (t: DropTarget) => overKey === targetKey(t) };
}
