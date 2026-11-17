/**
 * (Carreira online salva) "Carreira e sala" (/sala): técnicos (on-line/off-line, clube, desempregado), convite e, para
 * o host, código de vaga (recuperar/reatribuir uma vaga em outro aparelho), backup, demissões ligadas/desligadas e
 * encerrar a carreira (com confirmação digitando o código).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, Crown, Download, KeyRound, Loader2, Power, ShieldAlert, Users } from 'lucide-react';
import type { RoomPlayer } from '@cosmicfut/shared';
import { cn } from '@/lib/utils';
import { useOnline, useMe } from '@/store/online';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CopyButton, IndexCrest, useClubName } from './common';
import { CopyLinkButton } from '@/online/invite';

function lastSeen(p: RoomPlayer): string {
  if (p.connected) return 'on-line';
  if (!p.lastSeen) return 'off-line';
  const d = Date.now() - p.lastSeen;
  if (d < 3600_000) return `visto há ${Math.max(1, Math.round(d / 60_000))} min`;
  if (d < 86_400_000) return `visto há ${Math.round(d / 3600_000)} h`;
  return `visto há ${Math.round(d / 86_400_000)} d`;
}

export function CareerRoomPage() {
  const room = useOnline((s) => s.room);
  const me = useMe();
  const clubName = useClubName();
  const navigate = useNavigate();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  if (!room || !me) return null;
  const isHost = me.isHost;
  const managers = room.players.filter((p) => !p.spectator);
  const spectators = room.players.filter((p) => p.spectator);
  const run = async (key: string, fn: () => Promise<string | null>, ok: string) => {
    setBusy(key);
    setMsg(null);
    const err = await fn();
    setBusy(null);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: ok });
  };
  const seat = async (p: RoomPlayer) => {
    setBusy(`seat${p.playerId}`);
    const r = await useOnline.getState().seatCode(p.playerId);
    setBusy(null);
    if (typeof r === 'string') setMsg({ ok: false, text: r });
    else setCodes({ ...codes, [p.playerId]: r.seatCode });
  };
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-club-accent uppercase">Carreira online salva</p>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Carreira e sala <span className="font-mono tracking-[0.2em]">{room.code}</span>
        </h1>
        <p className="text-sm text-fg-muted">A carreira fica salva no servidor. Quando todos saem ela pausa; quem voltar continua do mesmo ponto pela lista "Minhas carreiras online".</p>
      </header>
      {msg && (
        <p role="status" className={cn('rounded-xl border px-3 py-2 text-sm', msg.ok ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')}>
          {msg.text}
        </p>
      )}

      <section className="cf-card p-4" aria-label="Técnicos">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Users className="size-4 text-club-accent" /> Técnicos ({managers.length}/{room.maxPlayers ?? 6})
        </h2>
        <ul className="mt-3 divide-y divide-line">
          {managers.map((p) => (
            <li key={p.playerId} className="flex flex-wrap items-center gap-3 py-2">
              <span className={cn('size-2.5 rounded-full', p.connected ? 'bg-success' : 'bg-fg-subtle/50')} aria-label={p.connected ? 'on-line' : 'off-line'} />
              <IndexCrest id={p.clubId} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold" style={p.color ? { color: p.color } : undefined}>
                  {p.nickname}
                  {p.isHost && <Crown className="size-3.5 text-warning" aria-label="host" />}
                  {p.playerId === me.playerId && <span className="text-[10px] font-normal text-fg-subtle">(você)</span>}
                </div>
                <div className="text-[11px] text-fg-muted">
                  {p.clubId ? clubName(p.clubId) : (
                    <span className="inline-flex items-center gap-1">
                      <Briefcase className="size-3" /> desempregado{p.jobOffers ? ` · ${p.jobOffers} proposta(s)` : ''}
                    </span>
                  )}{' '}
                  · {lastSeen(p)}
                </div>
              </div>
              {isHost && (
                <div className="flex items-center gap-2">
                  {codes[p.playerId] ? (
                    <span className="flex items-center gap-1.5">
                      <code className="rounded-lg border border-club-accent/40 bg-club-accent/10 px-2 py-1 font-mono text-sm font-black tracking-[0.25em]">{codes[p.playerId]}</code>
                      <CopyButton text={codes[p.playerId]} label="Copiar" />
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void seat(p)} title="Código de uso único (24 h) para assumir esta vaga em outro aparelho ou passá-la a outra pessoa">
                      {busy === `seat${p.playerId}` ? <Loader2 className="animate-spin" /> : <KeyRound />} Código de vaga
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {spectators.length > 0 && <p className="mt-2 text-[11px] text-fg-muted">Espectadores: {spectators.map((p) => p.nickname).join(', ')}</p>}
        <p className="mt-2 text-[11px] text-fg-subtle">
          {isHost
            ? 'O código de vaga vale uma vez por 24 h: quem usar (em "Recuperar vaga") assume o lugar e o token antigo deixa de valer.'
            : 'Trocou de aparelho? Peça ao host um código de vaga.'}
        </p>
      </section>

      <section className="cf-card p-4" aria-label="Convite">
        <h2 className="text-sm font-bold">Convidar mais técnicos</h2>
        <p className="mt-1 text-xs text-fg-muted">Com a carreira rolando, quem entrar pelo código ou link começa desempregado e recebe propostas dos clubes que precisam de técnico (até 6 técnicos).</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyButton text={room.code} label="Copiar código" />
          <div className="w-64">
            <CopyLinkButton code={room.code} />
          </div>
        </div>
      </section>

      {isHost && (
        <section className="cf-card space-y-3 p-4" aria-label="Host">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <ShieldAlert className="size-4 text-club-accent" /> Host
          </h2>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2">
            <span>
              <span className="block text-sm font-semibold">Demissões: {room.settings.firing !== false ? 'ligadas' : 'desligadas'}</span>
              <span className="block text-[11px] text-fg-muted">A diretoria demite técnicos humanos com resultados muito ruins.</span>
            </span>
            <input
              type="checkbox"
              className="size-5 accent-[var(--club-accent)]"
              checked={room.settings.firing !== false}
              onChange={(e) => void run('firing', () => useOnline.getState().updateSettings({ firing: e.target.checked }), e.target.checked ? 'Demissões ligadas.' : 'Demissões desligadas.')}
              aria-label="Demissões ligadas"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void run('backup', () => useOnline.getState().downloadBackup(), 'Backup baixado. Guarde o arquivo: com ele dá para recriar a carreira.')}>
              {busy === 'backup' ? <Loader2 className="animate-spin" /> : <Download />} Baixar backup
            </Button>
          </div>
          <div className="rounded-xl border border-danger/40 bg-danger/5 p-3">
            <div className="text-sm font-bold text-danger">Encerrar a carreira</div>
            <p className="mt-0.5 text-[11px] text-fg-muted">Apaga a carreira no servidor para todos (sem volta, salvo por um backup). Digite o código da sala para confirmar.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase().slice(0, 6))} placeholder={room.code} aria-label="Código para confirmar" className="w-32 font-mono tracking-widest" />
              <Button
                size="sm"
                variant="outline"
                className="border-danger/50 text-danger"
                disabled={confirm !== room.code || !!busy}
                onClick={async () => {
                  setBusy('end');
                  const err = await useOnline.getState().endCareer(confirm);
                  setBusy(null);
                  if (err) return setMsg({ ok: false, text: err });
                  navigate('/inicio');
                }}
              >
                {busy === 'end' ? <Loader2 className="animate-spin" /> : <Power />} Encerrar carreira
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
