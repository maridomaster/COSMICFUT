/**
 * (Carreira online salva) "Minhas carreiras online": as carreiras que este navegador já entrou (token guardado), com a
 * situação ao vivo do servidor (data, técnicos on-line, vez de quem, última atividade). "Continuar" volta à vaga;
 * "Remover da lista" só apaga deste navegador. Também: entrar com código de vaga (outro aparelho) e restaurar backup.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Briefcase, Crown, FolderOpen, KeyRound, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { CareerStatus } from '@cosmicfut/shared';
import { forgetCareer, useSavedCareers, type SavedCareer } from '@/online/careers';
import { normalizeRoomCode, ROOM_CODE_LENGTH } from '@/online/config';
import { loadNickname } from '@/online/socket';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMode } from '@/store/mode';
import { useOnline } from '@/store/online';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IndexCrest, useClubName } from './common';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'no lobby', planning: 'planejamento', simulating: 'simulando', matchday: 'dia de jogo', 'season-end': 'fim de temporada', finished: 'encerrada',
};

function ago(ms: number | undefined): string {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 60_000) return 'agora';
  if (d < 3600_000) return `há ${Math.round(d / 60_000)} min`;
  if (d < 86_400_000) return `há ${Math.round(d / 3600_000)} h`;
  return `há ${Math.round(d / 86_400_000)} d`;
}

/** Atualiza a lista ao abrir e a cada 15 s. */
function useCareerList() {
  const list = useSavedCareers((s) => s.list);
  const status = useSavedCareers((s) => s.status);
  const loading = useSavedCareers((s) => s.loading);
  const error = useSavedCareers((s) => s.error);
  useEffect(() => {
    void useSavedCareers.getState().refresh();
    const id = setInterval(() => void useSavedCareers.getState().refresh(), 15_000);
    return () => clearInterval(id);
  }, []);
  return { list, status, loading, error };
}

function useContinue() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (code: string) => {
    setBusy(code);
    setError(null);
    const err = await useOnline.getState().resume(code);
    setBusy(null);
    if (err) return setError(`${code}: ${err}`);
    useMode.getState().setMode('online');
    navigate(`/online/${code}`);
  };
  return { go, busy, error };
}

function CareerRow({ c, st, onContinue, busy }: { c: SavedCareer; st: CareerStatus | undefined; onContinue: () => void; busy: boolean }) {
  const clubName = useClubName();
  const gone = st && !st.found;
  const me = st?.me;
  return (
    <li className={cn('rounded-xl border border-line bg-surface-2/40 p-3', gone && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3">
        <IndexCrest id={me?.clubId ?? null} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm font-black tracking-widest">{c.code}</span>
            <span className="truncate text-sm font-semibold">
              {gone ? 'Carreira não encontrada' : me ? (me.clubId ? clubName(me.clubId) : me.spectator ? 'Espectador' : 'Sem clube (desempregado)') : 'Carregando…'}
            </span>
            {me?.isHost && <Crown className="size-3.5 text-warning" aria-label="Você é o host" />}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-muted">
            {gone
              ? 'A carreira foi encerrada pelo host ou a sua vaga foi passada para outro aparelho.'
              : st
                ? `${st.date ? fmtDate(st.date, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}${st.season ? ` · temporada ${st.season}` : ''} · ${PHASE_LABEL[st.phase ?? ''] ?? st.phase} · atividade ${ago(st.lastActivity)}`
                : `você: ${c.nickname}`}
          </div>
          {st?.turnOf && <div className="mt-0.5 text-[11px] font-semibold text-club-accent">Vez de {st.turnOf}</div>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="club" onClick={onContinue} disabled={busy || !!gone} aria-label={`Continuar a carreira ${c.code}`}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Continuar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remover ${c.code} da lista`}
            title="Remover da lista (só deste navegador)"
            onClick={() => {
              if (window.confirm(`Remover a carreira ${c.code} desta lista? Ela continua no servidor; você perde o acesso por este navegador (o host pode gerar um código de vaga).`)) forgetCareer(c.code);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {st?.managers && st.managers.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Técnicos">
          {st.managers.map((m, i) => (
            <li key={`${m.nickname}-${i}`} className="flex items-center gap-1.5 rounded-full border border-line bg-surface/60 py-0.5 pr-2 pl-1 text-[11px]">
              <span className={cn('size-2 rounded-full', m.online ? 'bg-success' : 'bg-fg-subtle/50')} title={m.online ? 'on-line' : 'off-line'} />
              <IndexCrest id={m.clubId} size={16} />
              <span className="font-semibold" style={m.color ? { color: m.color } : undefined}>{m.nickname}</span>
              {m.unemployed && <Briefcase className="size-3 text-fg-subtle" aria-label="desempregado" />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Seção completa (menu online). */
export function MyCareersSection() {
  const { list, status, loading, error } = useCareerList();
  const cont = useContinue();
  return (
    <section className="cf-card mt-5 p-5" aria-label="Minhas carreiras online">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <FolderOpen className="size-4 text-club-accent" /> Minhas carreiras online
        </h2>
        <Button variant="ghost" size="sm" onClick={() => void useSavedCareers.getState().refresh()} aria-label="Atualizar carreiras">
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar
        </Button>
      </div>
      <p className="mt-1 text-xs text-fg-muted">As carreiras com amigos ficam salvas no servidor. Quando todos saem, a carreira pausa e continua de onde parou.</p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {cont.error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {cont.error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="py-4 text-center text-xs text-fg-subtle">Nenhuma carreira online neste navegador ainda. Crie uma sala ou entre com um código.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {list.map((c) => (
            <CareerRow key={c.code} c={c} st={status[c.code]} busy={cont.busy === c.code} onContinue={() => void cont.go(c.code)} />
          ))}
        </ul>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ClaimSeatForm />
        <RestoreBackupForm />
      </div>
    </section>
  );
}

/** Card compacto (menu inicial): "Continuar carreira online". */
export function ContinueOnlineCard() {
  const { list, status } = useCareerList();
  const cont = useContinue();
  const clubName = useClubName();
  const navigate = useNavigate();
  const live = list.filter((c) => status[c.code]?.found !== false).slice(0, 3);
  if (!live.length) return null;
  return (
    <div className="cf-card mt-4 p-4" aria-label="Continuar carreira online">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold">Continuar carreira online</div>
        <button className="text-xs font-semibold text-brand-2 hover:underline" onClick={() => navigate('/online')}>
          Ver todas
        </button>
      </div>
      <ul className="mt-2 grid gap-2 sm:grid-cols-3">
        {live.map((c) => {
          const st = status[c.code];
          return (
            <li key={c.code}>
              <button
                onClick={() => void cont.go(c.code)}
                disabled={cont.busy === c.code}
                className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface-2/50 p-2 text-left transition-colors hover:border-brand-2/50"
              >
                <IndexCrest id={st?.me?.clubId ?? null} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{st?.me?.clubId ? clubName(st.me.clubId) : st?.me ? 'Sem clube' : c.code}</span>
                  <span className="block truncate text-[10px] text-fg-muted">
                    {c.code}
                    {st?.date ? ` · ${fmtDate(st.date, { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                    {st?.managers ? ` · ${st.managers.filter((m) => m.online).length}/${st.managers.length} on` : ''}
                  </span>
                </span>
                {cont.busy === c.code ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4 text-fg-subtle" />}
              </button>
            </li>
          );
        })}
      </ul>
      {cont.error && <p className="mt-2 text-xs text-danger">{cont.error}</p>}
    </div>
  );
}

function ClaimSeatForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [seat, setSeat] = useState('');
  const [nick, setNick] = useState(() => loadNickname());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== ROOM_CODE_LENGTH || seat.trim().length !== 6) return setError('Informe o código da sala e o código de vaga (6 caracteres cada).');
    setBusy(true);
    setError(null);
    const err = await useOnline.getState().claimSeat(code, seat.trim().toUpperCase(), nick.trim() || undefined);
    setBusy(false);
    if (err) return setError(err);
    useMode.getState().setMode('online');
    navigate(`/online/${code}`);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-xl border border-line bg-surface-2/30 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-bold">
        <KeyRound className="size-4 text-club-accent" /> Recuperar vaga (outro aparelho)
      </h3>
      <p className="mt-0.5 text-[11px] text-fg-muted">Peça ao host um código de vaga em "Carreira e sala".</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Input value={code} onChange={(e) => setCode(normalizeRoomCode(e.target.value))} placeholder="Sala (6)" aria-label="Código da sala" className="font-mono tracking-widest" />
        <Input value={seat} onChange={(e) => setSeat(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="Vaga (6)" aria-label="Código de vaga" className="font-mono tracking-widest" />
      </div>
      <Input className="mt-2" value={nick} onChange={(e) => setNick(e.target.value.slice(0, 20))} placeholder="Apelido (opcional)" aria-label="Apelido na vaga" />
      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}
      <Button type="submit" size="sm" variant="outline" className="mt-2 w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Assumir a vaga
      </Button>
    </form>
  );
}

function RestoreBackupForm() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) return setError('Arquivo grande demais (máximo 30 MB).');
    setBusy(true);
    setError(null);
    const err = await useOnline.getState().restoreBackup(f);
    setBusy(false);
    if (input.current) input.current.value = '';
    if (err) return setError(err);
    useMode.getState().setMode('online');
    navigate(`/online/${useOnline.getState().session!.code}`);
  };
  return (
    <div className="rounded-xl border border-line bg-surface-2/30 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-bold">
        <Upload className="size-4 text-club-accent" /> Restaurar backup
      </h3>
      <p className="mt-0.5 text-[11px] text-fg-muted">Cria a carreira de novo a partir do arquivo .json.gz que o host baixou. Você fica com a vaga do host; os outros entram com códigos de vaga.</p>
      <input ref={input} type="file" accept=".gz,.json,application/gzip,application/json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Arquivo de backup" />
      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}
      <Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />} Escolher arquivo…
      </Button>
    </div>
  );
}
