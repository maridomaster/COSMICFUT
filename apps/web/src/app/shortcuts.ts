/**
 * Atalhos de teclado globais (carreira solo):
 *  - Espaço: Continuar (fora de campos de texto e de botões/controles com foco, sem diálogo aberto);
 *  - Espaço na Partida ao vivo: pausa / retoma.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useMatch } from '@/store/match';

/** Elemento que já usa o Espaço (digitação ou ativação nativa). */
function consumesSpace(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') return true;
  if (tag === 'A' && el.hasAttribute('href')) return true;
  const role = el.getAttribute('role');
  return !!role && ['button', 'tab', 'radio', 'checkbox', 'switch', 'menuitem', 'option', 'slider', 'textbox', 'combobox', 'columnheader'].includes(role);
}

const dialogOpen = () => !!document.querySelector('[role="dialog"][aria-modal], [role="dialog"][aria-modal="true"], dialog[open]');

export function useSpaceShortcut(onContinue: () => void, enabled: boolean): void {
  const location = useLocation();
  const ref = useRef({ onContinue, enabled, path: location.pathname });
  ref.current = { onContinue, enabled, path: location.pathname };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      if (consumesSpace(e.target) || dialogOpen()) return;
      const { onContinue, enabled, path } = ref.current;
      if (path.startsWith('/partida')) {
        const m = useMatch.getState();
        if (m.phase !== 'live') return;
        e.preventDefault();
        if (m.running) m.pause();
        else m.play();
        return;
      }
      if (!enabled) return;
      e.preventDefault();
      onContinue();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
