/**
 * (17/11) Convite: URL pública do túnel (GET /public-url), botão "Copiar link" e QR code.
 *  - Aberto em localhost (o host): o link usa a URL pública quando o lançador abriu o túnel — nunca sai "localhost".
 *  - Aberto pelo túnel (amigos): a própria origem.
 *  - Sem túnel em localhost: copia a origem local e mostra a dica do atalho da Área de Trabalho.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import qrcode from 'qrcode-generator';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOnline } from '@/store/online';
import { Button } from '@/components/ui/button';
import { inviteBase, isLocalHost, SERVER_URL } from './config';

interface PublicUrlStore {
  url: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const usePublicUrlStore = create<PublicUrlStore>()((set) => ({
  url: null,
  loaded: false,
  refresh: async () => {
    try {
      const r = await fetch(`${SERVER_URL}/public-url`, { headers: { Accept: 'application/json' } });
      const j = (await r.json()) as { url?: string | null };
      const url = typeof j.url === 'string' && /^https?:\/\//.test(j.url) ? j.url.replace(/\/+$/, '') : null;
      set({ url, loaded: true });
    } catch {
      set({ url: null, loaded: true });
    }
  },
}));

/** Base do convite (atualiza a URL pública ao montar: ela muda a cada execução do lançador). */
export function useInvite(code?: string | null): { link: string; base: string; publicUrl: string | null; localOnly: boolean; loaded: boolean } {
  const url = usePublicUrlStore((s) => s.url);
  const loaded = usePublicUrlStore((s) => s.loaded);
  useEffect(() => {
    void usePublicUrlStore.getState().refresh();
  }, []);
  const base = inviteBase(url);
  return {
    base,
    link: code ? `${base}/online/${code}` : base,
    publicUrl: url,
    // em localhost sem túnel: o link só funciona na mesma rede/máquina
    localOnly: isLocalHost() && !url,
    loaded,
  };
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** Botão destacado "Copiar link" (menu online: o jogo; dentro da sala: o convite /online/CODE). */
export function CopyLinkButton({ code, className, size = 'lg' }: { code?: string | null; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const inv = useInvite(code);
  const copy = async () => {
    // pega a URL mais nova antes de copiar (o túnel pode ter acabado de abrir)
    await usePublicUrlStore.getState().refresh();
    const url = usePublicUrlStore.getState().url;
    const base = inviteBase(url);
    const link = code ? `${base}/online/${code}` : base;
    await copyText(link);
    useOnline.getState().toast({ kind: 'success', title: 'Link copiado!', text: link });
  };
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Button variant="club" size={size} onClick={() => void copy()} className="w-full font-extrabold" aria-label="Copiar link">
        <Link2 /> Copiar link
      </Button>
      <span className="truncate text-center text-[11px] text-fg-subtle" title={inv.link}>
        {inv.link.replace(/^https?:\/\//, '')}
      </span>
      {inv.localOnly && inv.loaded && (
        <span className="rounded-lg border border-warning/30 bg-warning/10 px-2 py-1 text-center text-[11px] text-warning">
          Para amigos de fora, abra pelo atalho COSMICFUT da Área de Trabalho
        </span>
      )}
    </div>
  );
}

/** QR code (SVG) de um texto. */
export function QrCode({ text, size = 144, className }: { text: string; size?: number; className?: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { d, n: n + 4 };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${path.n} ${path.n}`} width={size} height={size} role="img" aria-label="QR code do convite" className={cn('rounded-lg bg-white', className)} shapeRendering="crispEdges">
      <path d={path.d} fill="#0b0f14" />
    </svg>
  );
}
