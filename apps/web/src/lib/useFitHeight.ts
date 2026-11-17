import { useLayoutEffect, type RefObject } from 'react';

/**
 * (Atualização 41 — visual compacto) Faz uma lista/tabela caber na janela: define `max-height` do elemento como
 * "do topo dele até o fim da tela" (com a página no topo), para a rolagem acontecer DENTRO da tabela (cabeçalho fixo)
 * em vez de rolar a página inteira. Só a partir de `minWidth` (desktop); no celular a página rola normalmente.
 */
export function useFitHeight(ref: RefObject<HTMLElement | null>, { min = 280, bottom = 16, minWidth = 1024 }: { min?: number; bottom?: number; minWidth?: number } = {}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const calc = () => {
      if (!mq.matches) {
        el.style.maxHeight = '';
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = `${Math.max(min, Math.floor(window.innerHeight - top - bottom))}px`;
      if (el.style.maxHeight !== next) el.style.maxHeight = next;
    };
    calc();
    // as páginas entram com animação (translateY): recalcula depois que ela termina
    const late = window.setTimeout(calc, 450);
    // fora do callback do observer (evita o aviso "ResizeObserver loop")
    let t = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(calc, 0);
    });
    // o que está acima da tabela pode mudar de altura (filtros que quebram linha, avisos)
    if (el.parentElement) ro.observe(el.parentElement);
    const main = el.closest('main');
    if (main) ro.observe(main);
    window.addEventListener('resize', calc);
    mq.addEventListener('change', calc);
    return () => {
      window.clearTimeout(late);
      window.clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', calc);
      mq.removeEventListener('change', calc);
    };
  }, [ref, min, bottom, minWidth]);
}
