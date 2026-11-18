/**
 * Lobby online (/online e /online/:code) — (17/11) até 6 técnicos, inspirado em lobbies de party games
 * (cartões de vaga, coroa do host, código grande + QR) e no Football Manager em rede (pronto, presets do host).
 *  - Entrada: apelido, "Copiar link", criar sala (preset + modo de vez + pública), entrar com código / como espectador
 *    e "Salas abertas".
 *  - Sala: 6 vagas (cor, clube, força, orçamento, meta da diretoria, dificuldade, pronto/conexão, coroa), convite
 *    (código, link, QR), controles do host (expulsar, passar o host, trancar, pública), escolha de clube (livre,
 *    draft em serpentina, sorteio), configurações com presets, chat e reações.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft, Check, Crown, Dices, Eye, Gauge, Globe2, Loader2, Lock, LogIn, LogOut, MessageCircle, Play, Plus, QrCode as QrIcon, RefreshCw,
  Search, Shuffle, Timer, Unlock, UserPlus, Users, X,
} from 'lucide-react';
import {
  clubDifficulty, clubStrengthScore, DIFFICULTY_LABEL, DIFFICULTY_ORDER, PLAYER_COLORS, REACTIONS,
  type ClubIndexEntry, type Difficulty, type PublicRoomInfo, type RoomPlayer, type RoomPreview, type RoomSettings, type SettingsPreset,
} from '@cosmicfut/shared';
import { useClubIndex, useLeagues, useStates } from '@/data/hooks';
import { indexCrestPaths } from '@/data/source';
import { cachedBundle, ensureBundles } from '@/data/squads';
import { applyClubTheme } from '@/lib/color';
import { fmtMoney } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn, normalizeSearch } from '@/lib/utils';
import { isRoomCode, MATCH_SPEEDS, normalizeRoomCode, ROOM_CODE_LENGTH } from '@/online/config';
import { CopyLinkButton, QrCode, useInvite } from '@/online/invite';
import { loadNickname } from '@/online/socket';
import { useMode } from '@/store/mode';
import { useOnline, useMe } from '@/store/online';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Crest } from '@/components/game/Crest';
import { ChatBox, ConnectionBadge, CopyButton, Countdown, IndexCrest } from './common';
import { MyCareersSection } from './MyCareers';

const BRAZIL = 29;

export function OnlineLobbyPage() {
  const { code: rawCode } = useParams();
  const urlCode = rawCode ? normalizeRoomCode(rawCode) : null;
  const session = useOnline((s) => s.session);
  const room = useOnline((s) => s.room);
  const status = useOnline((s) => s.status);

  const inMyRoom = !!session && (!urlCode || urlCode === session.code);
  useEffect(() => {
    useOnline.getState().connect();
  }, []);
  useEffect(() => {
    if (inMyRoom) useMode.getState().setMode('online');
  }, [inMyRoom]);
  // (carreira online) sala com a temporada rolando (voltar pela lista / entrar desempregado): vai para o jogo.
  // Navegação num efeito: o <Navigate> logo depois do navigate() da entrada às vezes não saía da rota.
  const navigate = useNavigate();
  const location = useLocation();
  const running = inMyRoom && !!room && room.code === session?.code && room.phase !== 'lobby';
  useEffect(() => {
    if (running) navigate('/dashboard', { replace: true });
  }, [running, navigate, location.key]);
  let body;
  if (inMyRoom) {
    if (!room || room.code !== session.code || running) body = <Joining status={status} code={session.code} running={running} />;
    else body = <RoomView />;
  } else {
    body = <EntryView initialCode={urlCode && isRoomCode(urlCode) ? urlCode : ''} otherRoom={session?.code ?? null} />;
  }

  return (
    <div className="cf-backdrop relative min-h-dvh overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--club-primary)_20%,transparent),transparent_70%)]" />
      <div className="relative mx-auto max-w-[1280px] px-4 pb-16 sm:px-6 lg:px-8">
        <header className="flex h-16 items-center justify-between gap-3">
          <Logo />
          <ConnectionBadge />
        </header>
        {body}
      </div>
    </div>
  );
}

/** conectado e a sala não chegou em tanto tempo: a entrada travou (o anfitrião não respondeu) */
const JOIN_STUCK_MS = 12_000;
const JOIN_AUTO_RETRIES = 3;

function Joining({ status, code, running }: { status: string; code: string; running: boolean }) {
  const navigate = useNavigate();
  const simHost = useOnline((s) => s.simHost);
  const hostStatus = useOnline((s) => s.hostStatus);
  const [tries, setTries] = useState(0);
  const [stuck, setStuck] = useState(false);
  // eu mesmo sou o anfitrião e estou carregando a carreira: pode demorar, não reconecta por cima
  const loadingHere = !!simHost?.me && hostStatus?.state === 'loading';
  useEffect(() => {
    if (status !== 'connected' || loadingHere) return;
    const t = setTimeout(() => {
      setStuck(true);
      if (running) navigate('/dashboard', { replace: true });
      else if (tries < JOIN_AUTO_RETRIES) {
        setTries((n) => n + 1);
        useOnline.getState().rejoinFresh();
      }
    }, JOIN_STUCK_MS);
    return () => clearTimeout(t);
  }, [status, tries, running, loadingHere, navigate]);

  const hostNick = simHost?.nickname && !simHost.me ? simHost.nickname : null;
  const line =
    status === 'reconnecting'
      ? 'Servidor indisponível — tentando de novo.'
      : loadingHere
        ? 'Você é o anfitrião da simulação: carregando a carreira neste navegador…'
        : simHost && simHost.state !== 'ok'
          ? `O anfitrião da simulação${hostNick ? ` (${hostNick})` : ''} saiu — escolhendo outro…`
          : status === 'connected' && hostNick
            ? `Esperando o anfitrião da simulação (${hostNick}) mandar a sala.`
            : 'Conectando ao servidor.';
  return (
    <div className="cf-card mx-auto mt-16 max-w-md p-8 text-center" aria-busy data-testid="joining-room">
      <Loader2 className="mx-auto size-9 animate-spin text-club-accent" />
      <h2 className="mt-4 text-lg font-bold">Entrando na sala {code}…</h2>
      <p className="mt-1 text-sm text-fg-muted">{line}</p>
      {stuck && (
        <p className="mt-2 text-xs text-warning" data-testid="joining-stuck">
          {tries >= JOIN_AUTO_RETRIES ? 'Está demorando mais que o normal. Tente de novo ou peça para o anfitrião dar F5.' : `Demorando mais que o normal — reconectando (${tries}/${JOIN_AUTO_RETRIES}).`}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {running ? (
          <Button onClick={() => navigate('/dashboard', { replace: true })}>
            <Play className="size-4" /> Ir para o jogo
          </Button>
        ) : (
          <Button
            variant="outline"
            data-testid="joining-retry"
            onClick={() => {
              setTries(0);
              useOnline.getState().rejoinFresh();
            }}
          >
            <RefreshCw className="size-4" /> Tentar de novo
          </Button>
        )}
        <Button variant="ghost" onClick={() => void useOnline.getState().leave().then(() => navigate('/online'))}>
          Esquecer esta sala
        </Button>
      </div>
    </div>
  );
}

/* ───────── presets ───────── */

const PRESETS: { id: Exclude<SettingsPreset, 'custom'>; label: string; hint: string }[] = [
  { id: 'rapido', label: 'Rápido', hint: 'Partidas simuladas na hora · 60 s por vez' },
  { id: 'classico', label: 'Clássico', hint: 'Partidas ao vivo · 120 s por vez' },
  { id: 'sem-pressa', label: 'Sem pressa', hint: 'Partidas ao vivo · sem cronômetro' },
];
const PRESET_LABEL: Record<SettingsPreset, string> = { rapido: 'Rápido', classico: 'Clássico', 'sem-pressa': 'Sem pressa', custom: 'Personalizado' };

/* ───────── criar / entrar ───────── */

/** Exceções cruas do navegador (inglês, ex.: "Maximum call stack size exceeded") nunca chegam ao jogador. */
function friendlyError(err: string): string {
  if (/maximum call stack|is not a function|cannot read|undefined|null|failed to fetch|networkerror|load failed/i.test(err)) {
    console.error('[online] erro técnico', err);
    return 'Falha inesperada na conexão com a sala. Tente de novo.';
  }
  return err;
}

function EntryView({ initialCode, otherRoom }: { initialCode: string; otherRoom: string | null }) {
  const navigate = useNavigate();
  const [nick, setNick] = useState(() => loadNickname());
  const [preset, setPreset] = useState<Exclude<SettingsPreset, 'custom'>>('sem-pressa');
  const [turnMode, setTurnMode] = useState<'turns' | 'simultaneous'>('turns');
  const [isPublic, setPublic] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [spectator, setSpectator] = useState(false);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RoomPreview | string | null>(null);

  useEffect(() => applyClubTheme(null), []);

  useEffect(() => {
    setPreview(null);
    if (code.length !== ROOM_CODE_LENGTH) return;
    let alive = true;
    void useOnline
      .getState()
      .preview(code)
      .then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [code]);

  const nickOk = nick.trim().length >= 2;
  /** última ação que falhou (botão "Tentar de novo" na caixa de erro) */
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const showError = (err: string, retry: (() => void) | null) => {
    setError(friendlyError(err));
    setRetryAction(() => retry);
  };
  const doCreate = async () => {
    if (!nickOk) return setError('Escolha um apelido (2 a 20 letras).');
    setBusy('create');
    setError(null);
    let err: string | null;
    try {
      err = await useOnline.getState().create(nick.trim(), { preset, turnMode, isPublic });
    } catch (e) {
      console.error('[online] criar sala', e);
      err = 'Falha inesperada ao criar a sala.';
    }
    setBusy(null);
    if (err) return showError(err, () => void doCreate());
    const code6 = useOnline.getState().session?.code;
    if (code6) navigate(`/online/${code6}`, { replace: true });
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    void doCreate();
  };
  const joinCode = async (c: string, asSpectator = spectator) => {
    if (!nickOk) return setError('Escolha um apelido (2 a 20 letras).');
    if (c.length !== ROOM_CODE_LENGTH) return setError('O código tem 6 letras.');
    setBusy('join');
    setError(null);
    let err: string | null;
    try {
      err = await useOnline.getState().join(c, nick.trim(), asSpectator);
    } catch (e) {
      console.error('[online] entrar na sala', e);
      err = 'Falha inesperada ao entrar na sala.';
    }
    setBusy(null);
    if (err) return showError(err, () => void joinCode(c, asSpectator));
    navigate(`/online/${c}`, { replace: true });
  };

  const pv = typeof preview === 'object' ? preview : null;
  const full = !!pv && pv.players.length >= pv.maxPlayers;
  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.07)} className="mx-auto max-w-4xl pt-4 sm:pt-8">
      <motion.button variants={fadeUp} onClick={() => navigate('/inicio')} className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> Menu inicial
      </motion.button>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <motion.p variants={fadeUp} className="text-xs font-semibold tracking-[0.22em] text-brand-2 uppercase">
            Online com amigos · até 6 técnicos
          </motion.p>
          <motion.h1 variants={fadeUp} className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Monte sua sala
          </motion.h1>
        </div>
        <motion.div variants={fadeUp} className="w-full sm:w-72">
          <CopyLinkButton />
        </motion.div>
      </div>
      {otherRoom && (
        <motion.div variants={fadeUp} className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Você ainda está na sala <b className="tracking-widest">{otherRoom}</b>. Entrar em outra sala tira você dela.
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => navigate(`/online/${otherRoom}`)}>
            Voltar à {otherRoom}
          </Button>
        </motion.div>
      )}

      <motion.label variants={fadeUp} className="mt-6 block">
        <span className="mb-1.5 block text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Seu apelido</span>
        <Input value={nick} onChange={(e) => setNick(e.target.value.slice(0, 20))} placeholder="Ex.: Professor Pardal" maxLength={20} aria-label="Apelido" />
      </motion.label>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <motion.form variants={fadeUp} onSubmit={(e) => void create(e)} className="cf-card flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Plus className="size-4 text-club-accent" /> Criar sala
          </h2>
          <p className="text-xs text-fg-muted">Você vira o host: escolhe o ritmo, como os clubes são escolhidos e inicia a temporada.</p>
          <Segmented
            label="Ritmo"
            value={preset}
            onChange={(v) => setPreset(v)}
            options={PRESETS.map((p) => ({ value: p.id, label: p.label, title: p.hint }))}
          />
          <p className="-mt-2 text-[11px] text-fg-subtle">{PRESETS.find((p) => p.id === preset)?.hint}</p>
          <Segmented
            label="Vez de jogar"
            value={turnMode}
            onChange={(v) => setTurnMode(v)}
            options={[
              { value: 'turns', label: 'Turnos (Brasfoot)', title: 'Cada técnico faz a sua vez, um de cada vez' },
              { value: 'simultaneous', label: 'Simultâneo', title: 'Todos ao mesmo tempo; a rodada segue quando todos marcam pronto' },
            ]}
          />
          <Toggle checked={isPublic} onChange={setPublic} label="Sala pública" hint='Aparece em "Salas abertas"' />
          <Button type="submit" variant="club" className="mt-auto" disabled={!!busy}>
            {busy === 'create' ? <Loader2 className="animate-spin" /> : <Plus />} Criar sala
          </Button>
        </motion.form>

        <motion.form
          variants={fadeUp}
          onSubmit={(e) => {
            e.preventDefault();
            void joinCode(code);
          }}
          className="cf-card flex flex-col gap-3 p-5"
        >
          <h2 className="flex items-center gap-2 text-base font-bold">
            <LogIn className="size-4 text-club-accent" /> Entrar com código
          </h2>
          <p className="text-xs text-fg-muted">Peça o código de 6 letras (ou o link de convite) para quem criou a sala.</p>
          <CodeInput value={code} onChange={setCode} />
          <div className="min-h-10 text-xs">
            {typeof preview === 'string' && <span className="text-danger">{preview}</span>}
            {pv && (
              <div className="rounded-lg border border-line bg-surface-2/50 px-2.5 py-1.5 text-fg-muted">
                <div className="flex items-center gap-1.5 font-semibold text-fg">
                  <Users className="size-3.5" /> {pv.players.length}/{pv.maxPlayers} técnicos · {pv.phase === 'lobby' ? 'no lobby' : 'temporada em andamento'}
                </div>
                <div className="truncate">{pv.players.map((p) => p.nickname).join(', ')}</div>
              </div>
            )}
          </div>
          {pv && pv.phase !== 'lobby' && !full && !spectator && (
            <p className="rounded-lg border border-club-accent/30 bg-club-accent/10 px-2.5 py-1.5 text-[11px] text-fg-muted">
              A carreira já está rolando: você entra <b className="text-fg">sem clube</b> e recebe propostas dos clubes que precisarem de técnico (Central de Empregos).
            </p>
          )}
          <Toggle checked={spectator || full} onChange={setSpectator} label="Entrar como espectador" hint="Assiste e conversa, sem clube" disabled={full} />
          <Button type="submit" variant="club" className="mt-auto" disabled={!!busy || code.length !== ROOM_CODE_LENGTH}>
            {busy === 'join' ? <Loader2 className="animate-spin" /> : spectator || full ? <Eye /> : <LogIn />} {pv && pv.phase !== 'lobby' && !spectator && !full ? 'Entrar na carreira' : 'Entrar'}
          </Button>
        </motion.form>
      </div>
      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span className="min-w-0 flex-1">{error}</span>
          {retryAction && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => retryAction()}>
              <RefreshCw /> Tentar de novo
            </Button>
          )}
        </div>
      )}
      <motion.div variants={fadeUp}>
        <MyCareersSection />
      </motion.div>
      <motion.div variants={fadeUp}>
        <OpenRooms onJoin={(c) => void joinCode(c, false)} busy={!!busy} />
      </motion.div>
    </motion.div>
  );
}

/** "Salas abertas": salas públicas ainda no lobby (atualiza a cada 5 s). */
function OpenRooms({ onJoin, busy }: { onJoin: (code: string) => void; busy: boolean }) {
  const [rooms, setRooms] = useState<PublicRoomInfo[] | string | null>(null);
  const load = async () => setRooms(await useOnline.getState().listRooms());
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <section className="cf-card mt-5 p-5" aria-label="Salas abertas">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Globe2 className="size-4 text-club-accent" /> Salas abertas
        </h2>
        <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Atualizar salas">
          <RefreshCw /> Atualizar
        </Button>
      </div>
      {rooms === null ? (
        <p className="py-4 text-center text-xs text-fg-subtle">Procurando salas…</p>
      ) : typeof rooms === 'string' ? (
        <p className="py-4 text-center text-xs text-danger">{rooms}</p>
      ) : rooms.length === 0 ? (
        <p className="py-4 text-center text-xs text-fg-subtle">Nenhuma sala pública no momento. Crie uma e marque "Sala pública".</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {rooms.map((r) => (
            <li key={r.code} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 p-2.5">
              <IndexCrest id={r.hostClubId} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-black tracking-widest">{r.code}</span>
                  <span className="truncate text-xs text-fg-muted">de {r.host}</span>
                </div>
                <div className="truncate text-[11px] text-fg-subtle">
                  {r.players}/{r.maxPlayers} técnicos · {PRESET_LABEL[r.preset]} · {r.turnMode === 'turns' ? 'turnos' : 'simultâneo'}
                  {r.pickMode === 'draft' ? ' · draft' : r.pickMode === 'lottery' ? ' · sorteio' : ''}
                </div>
              </div>
              <Button size="sm" variant="club" disabled={busy || r.players >= r.maxPlayers} onClick={() => onJoin(r.code)}>
                Entrar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  return (
    <label className="relative block">
      <span className="sr-only">Código da sala</span>
      <input
        value={value}
        onChange={(e) => onChange(normalizeRoomCode(e.target.value))}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={ROOM_CODE_LENGTH + 4}
        aria-label="Código da sala"
        className="absolute inset-0 z-10 w-full cursor-text opacity-0"
      />
      <span className="grid grid-cols-6 gap-1.5" aria-hidden>
        {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => {
          const ch = value[i];
          const active = focus && i === Math.min(value.length, ROOM_CODE_LENGTH - 1);
          return (
            <span
              key={i}
              className={cn(
                'grid h-12 place-items-center rounded-xl border bg-surface-2/70 font-mono text-xl font-black transition-colors',
                active ? 'border-club-accent ring-2 ring-club-accent/25' : ch ? 'border-line-strong' : 'border-line',
              )}
            >
              {ch ?? <span className="text-fg-subtle/50">·</span>}
            </span>
          );
        })}
      </span>
    </label>
  );
}

/* ───────── controles pequenos ───────── */

function Segmented<T extends string | number>({ label, value, onChange, options, disabled }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; title?: string }[]; disabled?: boolean;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wider text-fg-muted uppercase">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl border border-line bg-surface-2/60 p-1">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 min-w-0 flex-1 truncate rounded-lg px-2 text-xs font-bold transition-colors disabled:opacity-50',
              value === o.value ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-[11px] text-fg-subtle">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span aria-hidden className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-club-accent' : 'bg-surface-3')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </span>
    </label>
  );
}

/* ───────── clubes: região, força, dificuldade, meta ───────── */

type Region = 'EU' | 'SA' | 'SAU';
const REGION_LABEL: Record<Region, string> = { EU: 'Europa', SA: 'América do Sul', SAU: 'Arábia' };
const EU_CODES = ['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL'];
const regionOfLeague = (leagueId: string): Region => {
  const code = leagueId.split('-')[0];
  return code === 'ARS' ? 'SAU' : EU_CODES.includes(code) ? 'EU' : 'SA';
};

interface PickClub {
  club: ClubIndexEntry;
  leagueId: string;
  leagueName: string;
  region: Region;
  difficulty: Difficulty;
  /** meta da diretoria pela força relativa na liga */
  goal: string;
}

const DIFF_STYLE: Record<Difficulty, string> = {
  facil: 'bg-success/15 text-success',
  medio: 'bg-sky-500/15 text-sky-300',
  dificil: 'bg-warning/15 text-warning',
  lendario: 'bg-fuchsia-500/15 text-fuchsia-300',
};

function DifficultyBadge({ d, className }: { d: Difficulty; className?: string }) {
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-wider uppercase', DIFF_STYLE[d], className)}>{DIFFICULTY_LABEL[d]}</span>;
}

/** Todos os clubes jogáveis (qualquer região): divisões nacionais reais + clubes só do estadual (Brasil). */
function usePickableClubs(): Map<string, PickClub> {
  const { data: index } = useClubIndex();
  const { data: leagues } = useLeagues();
  const { data: states } = useStates();
  return useMemo(() => {
    const byId = new Map((index ?? []).map((c) => [c.id, c]));
    const out = new Map<string, PickClub>();
    for (const d of leagues ?? []) {
      if (d.fictional || d.clubIds.length < 2) continue;
      const clubs = d.clubIds.map((id) => byId.get(id)).filter((c): c is ClubIndexEntry => !!c && !c.guest);
      const ranked = clubs.slice().sort((a, b) => clubStrengthScore(b) - clubStrengthScore(a));
      const n = ranked.length;
      ranked.forEach((c, i) => {
        if (out.has(c.id)) return;
        const pct = n > 1 ? i / (n - 1) : 0;
        const goal = d.division > 1
          ? pct <= 0.25 ? 'Acesso' : pct <= 0.75 ? 'Meio de tabela' : 'Evitar o rebaixamento'
          : pct <= 0.12 ? 'Título' : pct <= 0.35 ? 'Vaga continental' : pct <= 0.75 ? 'Meio de tabela' : 'Evitar o rebaixamento';
        // "1ª Divisão" sozinho é ambíguo (vários países): vem com o campeonato
        const dn = d.divisionName ?? d.name;
        const leagueName = /divis|apertura/i.test(dn) ? `${d.name.replace(/^Campeonato (de )?/, '')} · ${dn}` : dn;
        out.set(c.id, { club: c, leagueId: d.id, leagueName, region: regionOfLeague(d.id), difficulty: clubDifficulty(c), goal });
      });
    }
    for (const s of states ?? []) {
      for (const d of s.divisions) {
        if (d.clubIds.length < 2) continue;
        for (const id of d.clubIds) {
          const c = byId.get(id);
          if (!c || out.has(id) || c.countryId !== BRAZIL) continue;
          out.set(id, { club: c, leagueId: `EST-${s.state}`, leagueName: `Só estadual (${s.state})`, region: 'SA', difficulty: clubDifficulty(c), goal: 'Estadual' });
        }
      }
    }
    return out;
  }, [index, leagues, states]);
}

/** Overall médio do XI (11 melhores) — carrega o elenco sob demanda. */
function useClubOverall(id: string | null): number | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!id || cachedBundle(id)) return;
    let alive = true;
    void ensureBundles([id]).then(() => alive && force((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!id) return null;
  const ps = cachedBundle(id)?.players;
  if (!ps?.length) return null;
  const top = ps.map((p) => p.overall).sort((a, b) => b - a).slice(0, 11);
  return Math.round(top.reduce((s, x) => s + x, 0) / top.length);
}

/* ───────── sala ───────── */

function RoomView() {
  const navigate = useNavigate();
  const room = useOnline((s) => s.room)!;
  const me = useMe();
  const playerId = useOnline((s) => s.playerId);
  const clubs = usePickableClubs();
  const isHost = !!me?.isHost;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managers = room.players.filter((p) => !p.spectator);
  const spectators = room.players.filter((p) => p.spectator);
  const max = room.maxPlayers ?? 6;
  const missing = managers.filter((p) => !p.clubId);
  const myClub = me?.clubId ? clubs.get(me.clubId)?.club : undefined;
  const s = room.settings;
  const draftPending = s.pickMode === 'draft' && (!room.draft || room.draft.current !== null);

  useEffect(() => applyClubTheme(myClub?.colors ?? null), [myClub?.colors?.primary, myClub?.colors?.secondary]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true);
    setError(null);
    const err = await useOnline.getState().start();
    setBusy(false);
    if (err) setError(err);
  };
  const leave = async () => {
    await useOnline.getState().leave();
    navigate('/inicio');
  };

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-4 pt-2 lg:pt-4">
      <motion.div variants={fadeUp}>
        <InviteBar />
      </motion.div>

      <motion.section variants={fadeUp} aria-label="Técnicos">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-club-accent" /> Técnicos <span className="text-fg-subtle">({managers.length}/{max})</span>
          </h2>
          {spectators.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-fg-muted" title={spectators.map((p) => p.nickname).join(', ')}>
              <Eye className="size-3.5" /> {spectators.length} {spectators.length === 1 ? 'espectador' : 'espectadores'}: {spectators.map((p) => p.nickname).join(', ')}
            </span>
          )}
          <span className="ml-auto">
            <Reactions />
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: max }, (_, i) => managers[i] ?? null).map((p, i) => (
            <li key={p?.playerId ?? `empty-${i}`}>{p ? <SlotCard p={p} me={playerId} isHost={isHost} clubs={clubs} /> : <EmptySlot />}</li>
          ))}
        </ul>
      </motion.section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <motion.section variants={fadeUp} className="cf-card min-w-0 p-4 sm:p-5">
          {me?.spectator ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              <Eye className="mx-auto mb-2 size-6 text-fg-subtle" /> Você está como espectador: acompanha as partidas e o chat, sem clube.
            </p>
          ) : s.pickMode === 'draft' ? (
            <DraftPanel clubs={clubs} />
          ) : s.pickMode === 'lottery' ? (
            <LotteryPanel clubs={clubs} />
          ) : (
            <ClubPicker clubs={clubs} />
          )}
        </motion.section>

        <div className="min-w-0 space-y-4">
          <motion.section variants={fadeUp} className="cf-card p-4">
            {isHost ? <HostSettings /> : <SettingsSummary />}
            {isHost && (
              <>
                <Button variant="club" size="lg" className="mt-4 w-full" disabled={busy || missing.length > 0 || draftPending} onClick={() => void start()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Play fill="currentColor" />} Iniciar temporada
                </Button>
                {missing.length > 0 && <p className="mt-2 text-center text-xs text-fg-muted">Falta escolher clube: {missing.map((p) => p.nickname).join(', ')}</p>}
              </>
            )}
            {!isHost && (
              <p className="mt-3 text-xs text-fg-muted">
                <b className="text-fg">{room.players.find((p) => p.isHost)?.nickname}</b> é o host e inicia a temporada quando todos tiverem clube.
              </p>
            )}
            {error && <p className="mt-2 text-center text-xs text-danger">{error}</p>}
            <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => void leave()}>
              <LogOut /> Sair da sala
            </Button>
          </motion.section>

          {!me?.spectator && (
            <motion.section variants={fadeUp} className="cf-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Sua cor</h2>
              <ColorPicker />
            </motion.section>
          )}

          <motion.section variants={fadeUp} className="cf-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="size-4 text-club-accent" /> Chat
            </h2>
            <ChatBox className="h-64" />
          </motion.section>
        </div>
      </div>
    </motion.div>
  );
}

/** Código grande + copiar + link público + QR; host: trancar e pública. */
function InviteBar() {
  const room = useOnline((s) => s.room)!;
  const me = useMe();
  const inv = useInvite(room.code);
  const [qr, setQr] = useState(false);
  const act = useOnline((s) => s.act);
  const toast = useOnline((s) => s.toast);
  const set = async (p: Partial<RoomSettings>) => {
    const err = await useOnline.getState().updateSettings(p);
    if (err) toast({ kind: 'error', title: 'Configuração', text: err });
  };
  void act;
  return (
    <section className="cf-card flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-[0.2em] text-fg-muted uppercase">Código da sala</div>
        <div className="font-mono text-4xl font-black tracking-[0.25em] text-fg sm:text-5xl" aria-label={`Código ${room.code.split('').join(' ')}`}>
          {room.code}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyButton text={room.code} label="Copiar código" />
          <Button variant="outline" size="sm" onClick={() => setQr((v) => !v)} aria-expanded={qr}>
            <QrIcon /> QR code
          </Button>
          {me?.isHost && (
            <>
              <Button variant="outline" size="sm" onClick={() => void set({ locked: !room.settings.locked })} aria-pressed={!!room.settings.locked} title="Trancada: ninguém novo entra">
                {room.settings.locked ? <Lock className="text-warning" /> : <Unlock />} {room.settings.locked ? 'Trancada' : 'Trancar'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void set({ isPublic: !room.settings.isPublic })} aria-pressed={!!room.settings.isPublic} title='Pública: aparece em "Salas abertas"'>
                <Globe2 className={room.settings.isPublic ? 'text-success' : ''} /> {room.settings.isPublic ? 'Pública' : 'Privada'}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="md:ml-auto md:w-80">
        <CopyLinkButton code={room.code} />
      </div>
      <AnimatePresence>
        {qr && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex flex-col items-center gap-1">
            <QrCode text={inv.link} size={132} />
            <span className="text-[10px] text-fg-subtle">Aponte a câmera para entrar</span>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Avatar({ p, size = 40 }: { p: RoomPlayer; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-black text-black/80 ring-2 ring-black/30"
      style={{ width: size, height: size, background: p.color ?? '#64748b', fontSize: size * 0.42 }}
      aria-hidden
    >
      {p.nickname.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Balão de reação recente do jogador (sobre o cartão / avatar). */
export function ReactionBubble({ playerId }: { playerId: string }) {
  const r = useOnline((s) => s.reactions.filter((x) => x.playerId === playerId).at(-1) ?? null);
  return (
    <AnimatePresence>
      {r && (
        <motion.span
          key={r.key}
          initial={{ opacity: 0, y: 8, scale: 0.6 }}
          animate={{ opacity: 1, y: -6, scale: 1 }}
          exit={{ opacity: 0, y: -24 }}
          className="pointer-events-none absolute -top-3 right-3 z-10 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-lg font-black shadow-xl"
          aria-label={`Reação ${r.emoji}`}
        >
          {r.emoji}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function SlotCard({ p, me, isHost, clubs }: { p: RoomPlayer; me: string | null; isHost: boolean; clubs: Map<string, PickClub> }) {
  const info = p.clubId ? clubs.get(p.clubId) : undefined;
  const ovr = useClubOverall(p.clubId);
  const act = useOnline((s) => s.act);
  const toast = useOnline((s) => s.toast);
  const room = useOnline((s) => s.room)!;
  const [menu, setMenu] = useState(false);
  const mine = p.playerId === me;
  const draft = room.draft;
  const picking = draft?.current === p.playerId;
  const run = async (ev: 'room:kick' | 'room:transfer-host') => {
    setMenu(false);
    if (ev === 'room:kick' && !window.confirm(`Remover ${p.nickname} da sala?`)) return;
    const err = await act(ev, { playerId: p.playerId });
    if (err) toast({ kind: 'error', title: 'Host', text: err });
  };
  return (
    <div
      className={cn('cf-card relative flex h-full flex-col gap-2 overflow-visible p-3', mine && 'ring-1 ring-club-accent/50', picking && 'ring-2 ring-warning/70')}
      style={{ borderTop: `3px solid ${p.color ?? '#64748b'}` }}
    >
      <ReactionBubble playerId={p.playerId} />
      <div className="flex items-center gap-2.5">
        <span className="relative">
          <Avatar p={p} />
          <span
            className={cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface', p.connected ? 'bg-success' : p.graceUntil ? 'animate-pulse bg-warning' : 'bg-fg-subtle')}
            title={p.connected ? 'Conectado' : p.graceUntil ? 'Reconectando…' : 'Desconectado'}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-bold">
            <span className="truncate">{p.nickname}</span>
            {p.isHost && <Crown className="size-4 shrink-0 text-warning" aria-label="Host" />}
            {mine && <span className="rounded bg-club-accent/20 px-1 text-[9px] font-black tracking-wider text-club-accent uppercase">você</span>}
          </div>
          <div className="text-[11px] text-fg-muted">
            {picking ? (
              <span className="font-semibold text-warning">
                escolhendo… <Countdown at={draft?.deadline ?? null} />
              </span>
            ) : p.clubId ? (
              <span className="text-success">clube escolhido</span>
            ) : (
              'sem clube'
            )}
          </div>
        </div>
        {isHost && !mine && (
          <div className="relative">
            <Button variant="ghost" size="sm" className="px-2" aria-label={`Ações para ${p.nickname}`} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              ⋯
            </Button>
            {menu && (
              <div className="absolute top-full right-0 z-20 mt-1 w-44 rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl" role="menu">
                <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-3" onClick={() => void run('room:transfer-host')}>
                  <Crown className="size-3.5 text-warning" /> Passar o host
                </button>
                <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger hover:bg-surface-3" onClick={() => void run('room:kick')}>
                  <X className="size-3.5" /> Expulsar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {info ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/40 p-2">
          <Crest path={indexCrestPaths(info.club)} name={info.club.name} colors={info.club.colors} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{info.club.name}</span>
              <DifficultyBadge d={info.difficulty} />
            </div>
            <div className="truncate text-[11px] text-fg-muted">
              {info.leagueName} · {REGION_LABEL[info.region]}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px] text-fg-muted">
              <span>
                OVR <b className="text-fg">{ovr ?? '…'}</b>
              </span>
              <span>
                Caixa <b className="text-fg">{info.club.finances ? fmtMoney(info.club.finances.balance) : '—'}</b>
              </span>
              <span>
                Meta <b className="text-fg">{info.goal}</b>
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-line py-4 text-xs text-fg-subtle">Aguardando escolha do clube</div>
      )}
    </div>
  );
}

function EmptySlot() {
  const room = useOnline((s) => s.room)!;
  const inv = useInvite(room.code);
  const toast = useOnline((s) => s.toast);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inv.link);
    } catch {
      /* ignore */
    }
    toast({ kind: 'success', title: 'Link copiado!', text: inv.link });
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex h-full min-h-[8.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong bg-surface/40 text-fg-muted transition-colors hover:border-club-accent/60 hover:text-fg"
      aria-label="Convidar: copiar o link da sala"
    >
      <UserPlus className="size-6" />
      <span className="text-sm font-bold">Convidar</span>
      <span className="text-[10px] text-fg-subtle">vaga livre · copia o link</span>
    </button>
  );
}

function Reactions() {
  const act = useOnline((s) => s.act);
  return (
    <div className="flex gap-1" role="group" aria-label="Reações">
      {REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => void act('room:react', { emoji: e })}
          className="grid h-8 min-w-8 place-items-center rounded-lg border border-line bg-surface-2/60 px-1.5 text-sm font-black transition-transform hover:scale-110 active:scale-95"
          aria-label={`Reagir ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function ColorPicker() {
  const room = useOnline((s) => s.room)!;
  const me = useMe();
  const act = useOnline((s) => s.act);
  const toast = useOnline((s) => s.toast);
  const used = new Map(room.players.filter((p) => p.playerId !== me?.playerId).map((p) => [p.color, p.nickname]));
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sua cor">
      {PLAYER_COLORS.map((c) => {
        const by = used.get(c);
        const sel = me?.color === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={sel}
            aria-label={by ? `Cor usada por ${by}` : `Cor ${c}`}
            disabled={!!by}
            title={by ? `Usada por ${by}` : undefined}
            onClick={async () => {
              const err = await act('room:set-color', { color: c });
              if (err) toast({ kind: 'error', title: 'Cor', text: err });
            }}
            className={cn('grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110 disabled:opacity-25', sel && 'ring-2 ring-white')}
            style={{ background: c }}
          >
            {sel && <Check className="size-4 text-black" />}
          </button>
        );
      })}
    </div>
  );
}

/* ───────── configurações ───────── */

function SettingsSummary() {
  const s = useOnline((st) => st.room!.settings);
  const items: [string, string][] = [
    ['Ritmo', PRESET_LABEL[s.preset ?? 'custom']],
    ['Vez', s.turnMode === 'simultaneous' ? 'Simultâneo' : 'Turnos'],
    ['Partidas', s.matchMode === 'quick' ? 'Rápidas (simuladas)' : 'Ao vivo'],
    ['Cronômetro', s.timerSec ? `${s.timerSec} s` : 'Sem'],
    ['Escolha', s.pickMode === 'draft' ? 'Draft (serpentina)' : s.pickMode === 'lottery' ? 'Sorteio' : 'Livre'],
    ['Transferências entre técnicos', s.h2hTransfers === false ? 'Não' : 'Sim'],
  ];
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Gauge className="size-4 text-club-accent" /> Configurações da sala
      </h2>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HostSettings() {
  const room = useOnline((s) => s.room)!;
  const update = useOnline((s) => s.updateSettings);
  const toast = useOnline((s) => s.toast);
  const [custom, setCustom] = useState(room.settings.preset === 'custom');
  const s = room.settings;
  const apply = async (p: Partial<RoomSettings>) => {
    const err = await update(p);
    if (err) toast({ kind: 'error', title: 'Configuração', text: err });
  };
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Gauge className="size-4 text-club-accent" /> Configurações (host)
      </h2>
      <Segmented
        label="Preset"
        value={(s.preset ?? 'custom') as SettingsPreset}
        onChange={(v) => {
          if (v === 'custom') return setCustom(true);
          void apply({ preset: v });
        }}
        options={[...PRESETS.map((p) => ({ value: p.id as SettingsPreset, label: p.label, title: p.hint })), { value: 'custom' as SettingsPreset, label: 'Personalizado' }]}
      />
      <Segmented
        label="Vez de jogar"
        value={s.turnMode ?? 'turns'}
        onChange={(v) => void apply({ turnMode: v })}
        options={[
          { value: 'turns', label: 'Turnos (Brasfoot)', title: 'Cada técnico na sua vez' },
          { value: 'simultaneous', label: 'Simultâneo (rápido)', title: 'Todos ao mesmo tempo + pronto' },
        ]}
      />
      <Segmented
        label="Escolha dos clubes"
        value={s.pickMode ?? 'free'}
        onChange={(v) => void apply({ pickMode: v })}
        options={[
          { value: 'free', label: 'Livre' },
          { value: 'draft', label: 'Draft', title: 'Draft (serpentina): um por vez, 45 s por escolha' },
          { value: 'lottery', label: 'Sorteio', title: 'Clubes sorteados numa faixa de dificuldade' },
        ]}
      />
      <Toggle checked={s.firing !== false} onChange={(v) => void apply({ firing: v })} label="Demissões: ligadas" hint="A diretoria pode demitir técnicos com resultados muito ruins" />
      <Toggle checked={s.lateJoin !== false} onChange={(v) => void apply({ lateJoin: v })} label="Entrada com a carreira rolando" hint="Novos técnicos entram desempregados e recebem propostas" />
      {(custom || s.preset === 'custom') && (
        <div className="space-y-2.5 rounded-xl border border-line bg-surface-2/30 p-2.5">
          <Segmented
            label="Partidas"
            value={s.matchMode ?? 'live'}
            onChange={(v) => void apply({ matchMode: v })}
            options={[
              { value: 'live', label: 'Ao vivo' },
              { value: 'quick', label: 'Rápidas', title: 'Simuladas na hora' },
            ]}
          />
          <Segmented
            label={s.turnMode === 'simultaneous' ? 'Cronômetro do planejamento' : 'Cronômetro por vez'}
            value={s.timerSec ?? 0}
            onChange={(v) => void apply({ timerSec: v })}
            options={[0, 60, 120, 300].map((t) => ({ value: t, label: t ? `${t} s` : 'Sem' }))}
          />
          <Toggle checked={s.h2hTransfers !== false} onChange={(v) => void apply({ h2hTransfers: v })} label="Transferências entre técnicos" />
          <Toggle checked={s.pauseVotes !== false} onChange={(v) => void apply({ pauseVotes: v })} label="Votar para pausar" hint="Durante as partidas ao vivo" />
          <Toggle checked={s.skipVotes !== false} onChange={(v) => void apply({ skipVotes: v })} label="Votar para pular" hint="Pular no tempo com o assistente" />
          <Segmented
            label="Regra AFK (assistente assume após)"
            value={s.afkRounds ?? 2}
            onChange={(v) => void apply({ afkRounds: v })}
            options={[0, 1, 2, 3, 5].map((n) => ({ value: n, label: n ? `${n} rod.` : 'Nunca' }))}
          />
        </div>
      )}
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Velocidade das partidas</span>
        <div role="radiogroup" aria-label="Velocidade das partidas" className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-2/60 p-1">
          {MATCH_SPEEDS.map((sp) => (
            <button
              key={sp.ms}
              type="button"
              role="radio"
              aria-checked={s.matchSpeedMs === sp.ms}
              title={sp.hint}
              onClick={() => void apply({ matchSpeedMs: sp.ms })}
              className={cn('h-8 rounded-lg text-xs font-bold transition-colors', s.matchSpeedMs === sp.ms ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg')}
            >
              {sp.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────── escolha de clube ───────── */

function ClubInfoCard({ info, action }: { info: PickClub; action?: ReactNode }) {
  const ovr = useClubOverall(info.club.id);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-club-accent/30 bg-club-accent/8 p-3">
      <Crest path={indexCrestPaths(info.club)} name={info.club.name} colors={info.club.colors} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-extrabold">{info.club.name}</span>
          <DifficultyBadge d={info.difficulty} />
        </div>
        <div className="text-xs text-fg-muted">
          {info.leagueName} · {REGION_LABEL[info.region]}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-fg-muted">
          <span>
            Overall do XI <b className="text-fg">{ovr ?? '…'}</b>
          </span>
          <span>
            Caixa <b className="text-fg">{info.club.finances ? fmtMoney(info.club.finances.balance) : '—'}</b>
          </span>
          {info.club.finances?.revenue ? (
            <span>
              Receita <b className="text-fg">{fmtMoney(info.club.finances.revenue)}</b>/ano
            </span>
          ) : null}
          <span>
            Meta da diretoria <b className="text-fg">{info.goal}</b>
          </span>
        </div>
      </div>
      {action}
    </div>
  );
}

function ClubPicker({ clubs, canPick = true, title = 'Escolha seu clube' }: { clubs: Map<string, PickClub>; canPick?: boolean; title?: string }) {
  const room = useOnline((s) => s.room)!;
  const me = useMe();
  const pick = useOnline((s) => s.pickClub);
  const { data: leagues } = useLeagues();
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<Region | ''>('');
  const [league, setLeague] = useState('');
  const [diff, setDiff] = useState<Difficulty | ''>('');
  const [sel, setSel] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = useMemo(() => new Map(room.players.filter((p) => p.clubId).map((p) => [p.clubId!, p])), [room.players]);
  const leagueOptions = useMemo(() => {
    const ids = new Map<string, string>();
    for (const c of clubs.values()) if (!region || c.region === region) ids.set(c.leagueId.startsWith('EST-') ? 'EST' : c.leagueId, c.leagueId.startsWith('EST-') ? 'Só estadual (Brasil)' : c.leagueName);
    const ordered = (leagues ?? []).map((d) => d.id).filter((id) => ids.has(id));
    return [...ordered.map((id) => [id, ids.get(id)!] as const), ...(ids.has('EST') ? [['EST', ids.get('EST')!] as const] : [])];
  }, [clubs, region, leagues]);
  const list = useMemo(() => {
    const q = normalizeSearch(query);
    const out: PickClub[] = [];
    for (const c of clubs.values()) {
      if (region && c.region !== region) continue;
      if (league && (league === 'EST' ? !c.leagueId.startsWith('EST-') : c.leagueId !== league)) continue;
      if (diff && c.difficulty !== diff) continue;
      if (q && !normalizeSearch(c.club.name).includes(q)) continue;
      out.push(c);
    }
    return out.sort((a, b) => clubStrengthScore(b.club) - clubStrengthScore(a.club)).slice(0, q ? 150 : 240);
  }, [clubs, region, league, diff, query]);

  const choose = async (id: string) => {
    setPending(true);
    setError(null);
    const err = await pick(id);
    setPending(false);
    if (err) setError(err);
    else setSel(null);
  };
  const random = () => {
    const free = list.filter((c) => !taken.has(c.club.id));
    if (!free.length) return setError('Nenhum clube livre com esses filtros.');
    setSel(free[Math.floor(Math.random() * free.length)].club.id);
  };
  const selected = sel ? clubs.get(sel) : me?.clubId ? clubs.get(me.clubId) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-fg-muted">Qualquer clube da Europa, América do Sul ou Arábia. Cada clube só pode ter um técnico.</p>
        </div>
        <Button variant="outline" size="sm" onClick={random} disabled={!canPick || pending}>
          <Shuffle /> Aleatório
        </Button>
      </div>
      {selected && (
        <div className="mt-3">
          <ClubInfoCard
            info={selected}
            action={
              sel && sel !== me?.clubId ? (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSel(null)}>
                    Cancelar
                  </Button>
                  <Button variant="club" size="sm" disabled={!canPick || pending || taken.has(sel)} onClick={() => void choose(sel)}>
                    {pending ? <Loader2 className="animate-spin" /> : <Check />} Escolher este clube
                  </Button>
                </div>
              ) : (
                <span className="rounded-lg bg-success/15 px-2 py-1 text-xs font-bold text-success">seu clube</span>
              )
            }
          />
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar clube…" className="pl-9" aria-label="Buscar clube" />
        </div>
        <NativeSelect value={region} onChange={(e) => { setRegion(e.target.value as Region | ''); setLeague(''); }} aria-label="Região">
          <option value="">Todas as regiões</option>
          {(Object.keys(REGION_LABEL) as Region[]).map((r) => (
            <option key={r} value={r}>
              {REGION_LABEL[r]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={league} onChange={(e) => setLeague(e.target.value)} aria-label="Liga">
          <option value="">Todas as ligas</option>
          {leagueOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={diff} onChange={(e) => setDiff(e.target.value as Difficulty | '')} aria-label="Dificuldade">
          <option value="">Toda dificuldade</option>
          {DIFFICULTY_ORDER.map((d) => (
            <option key={d} value={d}>
              {DIFFICULTY_LABEL[d]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {clubs.size === 0 && <p className="mt-6 text-center text-sm text-fg-muted">Carregando clubes…</p>}
      <ul className="scrollbar-thin mt-3 grid max-h-[28rem] grid-cols-1 gap-2 overflow-y-auto pr-1 min-[420px]:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => {
          const owner = taken.get(c.club.id);
          const mine = owner?.playerId === me?.playerId;
          const blocked = !!owner && !mine;
          return (
            <li key={c.club.id}>
              <button
                type="button"
                disabled={blocked}
                onClick={() => setSel(c.club.id)}
                aria-pressed={mine || sel === c.club.id}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors disabled:cursor-not-allowed',
                  mine ? 'border-club-accent bg-club-accent/12' : sel === c.club.id ? 'border-club-accent/60 bg-club-accent/6' : blocked ? 'border-line opacity-50' : 'border-line bg-surface-2/40 hover:border-line-strong',
                )}
              >
                <Crest path={indexCrestPaths(c.club)} name={c.club.name} colors={c.club.colors} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{c.club.name}</span>
                  <span className="block truncate text-[11px] text-fg-muted">{owner ? (mine ? 'seu clube' : `escolhido por ${owner.nickname}`) : c.leagueName}</span>
                </span>
                <DifficultyBadge d={c.difficulty} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DraftPanel({ clubs }: { clubs: Map<string, PickClub> }) {
  const room = useOnline((s) => s.room)!;
  const me = useMe();
  const act = useOnline((s) => s.act);
  const toast = useOnline((s) => s.toast);
  const d = room.draft;
  const nick = (id: string) => room.players.find((p) => p.playerId === id)?.nickname ?? '?';
  const myPick = d?.current === me?.playerId;
  const begin = async () => {
    const err = await act('draft:start');
    if (err) toast({ kind: 'error', title: 'Draft', text: err });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Timer className="size-4 text-club-accent" /> Draft (serpentina)
          </h2>
          <p className="text-xs text-fg-muted">Ordem sorteada, um clube por vez, 45 s por escolha (tempo esgotado: o melhor disponível). A ordem do draft vira a ordem das vezes, invertendo a cada rodada.</p>
        </div>
        {me?.isHost && (!d || d.current === null) && (
          <Button variant="club" size="sm" onClick={() => void begin()}>
            <Play /> {d ? 'Refazer draft' : 'Começar draft'}
          </Button>
        )}
      </div>
      {d && (
        <ol className="flex flex-wrap gap-2">
          {d.order.map((id, i) => {
            const pk = d.picks.find((x) => x.playerId === id);
            const now = d.current === id;
            return (
              <li key={id} className={cn('flex items-center gap-2 rounded-xl border px-2 py-1.5 text-xs', now ? 'border-warning bg-warning/10' : 'border-line bg-surface-2/40')}>
                <span className="font-black text-fg-subtle">{i + 1}º</span>
                <span className="font-semibold">{nick(id)}</span>
                {pk ? <IndexCrest id={pk.clubId} size={18} /> : now ? <Countdown at={d.deadline} /> : null}
                {pk?.auto && <span className="text-[10px] text-fg-subtle">(auto)</span>}
              </li>
            );
          })}
        </ol>
      )}
      {!d && <p className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-fg-muted">Aguardando o host começar o draft.</p>}
      {d && d.current !== null && (
        <div className={cn('rounded-xl border p-3', myPick ? 'border-warning/50' : 'border-line opacity-80')}>
          <p className="mb-2 text-sm font-semibold">{myPick ? 'Sua vez de escolher!' : `Vez de ${nick(d.current)} escolher…`}</p>
          <ClubPicker clubs={clubs} canPick={myPick} title={myPick ? 'Escolha agora' : 'Clubes disponíveis'} />
        </div>
      )}
      {d && d.current === null && <p className="text-sm text-success">Draft concluído! O host já pode iniciar a temporada.</p>}
    </div>
  );
}

function LotteryPanel({ clubs }: { clubs: Map<string, PickClub> }) {
  const room = useOnline((s) => s.room)!;
  const me = useMe();
  const act = useOnline((s) => s.act);
  const toast = useOnline((s) => s.toast);
  const band = room.settings.lotteryBand ?? 'any';
  const run = async () => {
    const err = await act('lottery:run');
    if (err) toast({ kind: 'error', title: 'Sorteio', text: err });
  };
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Dices className="size-4 text-club-accent" /> Sorteio de clubes
      </h2>
      <p className="text-xs text-fg-muted">O host sorteia um clube diferente para cada técnico dentro da faixa de dificuldade.</p>
      <Segmented
        label="Faixa de dificuldade"
        value={band}
        disabled={!me?.isHost}
        onChange={(v) => void useOnline.getState().updateSettings({ lotteryBand: v })}
        options={[{ value: 'any' as const, label: 'Qualquer' }, ...DIFFICULTY_ORDER.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))]}
      />
      {me?.isHost ? (
        <Button variant="club" onClick={() => void run()}>
          <Dices /> Sortear clubes
        </Button>
      ) : (
        <p className="text-sm text-fg-muted">Aguardando o host sortear.</p>
      )}
      {me?.clubId && clubs.get(me.clubId) && <ClubInfoCard info={clubs.get(me.clubId)!} />}
    </div>
  );
}
